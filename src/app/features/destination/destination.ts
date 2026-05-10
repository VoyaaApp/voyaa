import { Component, OnInit, inject, ChangeDetectorRef, ElementRef, viewChild, viewChildren } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { collection, getDocs, query, where, doc, getDoc, setDoc, deleteDoc, updateDoc, increment, addDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { FormsModule } from '@angular/forms';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { timeAgo } from '../../shared/utils/time';
import { formatCount } from '../../shared/utils/format';

@Component({
  selector: 'app-destination',
  imports: [FormsModule, RouterLink, ConfirmDialog],
  templateUrl: './destination.html',
  styleUrl: './destination.scss',
})
export class Destination implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  authService = inject(AuthService);

  country = '';
  cities: { name: string; videos: any[] }[] = [];
  loading = true;
  timeAgo = timeAgo;
  formatCount = formatCount;
  totalVideos = 0;

  getThumbUrl(url: string): string {
    if (!url) return '';
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
      .replace(/\.[^.]+$/, '.jpg');
  }

  // Video viewer
  showViewer = false;
  viewerVideos: any[] = [];
  viewerIndex = 0;
  viewerMuted = true;
  showMuteIndicator = false;
  muteIndicatorFading = false;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;
  private pressTimer: any = null;
  private tapTimer: any = null;
  private isLongPress = false;
  private pendingTap = false;

  viewerContainer = viewChild<ElementRef>('viewerContainer');
  viewerVideoEls = viewChildren<ElementRef>('viewerVideo');
  private viewerObserver: IntersectionObserver | null = null;

  // Comments
  showComments = false;
  comments: any[] = [];
  newComment = '';
  replyingTo: any = null;
  private activeVideoId = '';
  private commentsUnsubscribe: (() => void) | null = null;

  // Confirm
  showConfirm = false;
  confirmMessage = '';
  private confirmAction: (() => void) | null = null;

  onConfirmed() {
    this.showConfirm = false;
    this.confirmAction?.();
    this.confirmAction = null;
  }

  onCancelled() {
    this.showConfirm = false;
    this.confirmAction = null;
  }

  async ngOnInit() {
    this.country = decodeURIComponent(this.route.snapshot.paramMap.get('country') || '');
    if (!this.country) {
      this.router.navigate(['/explore']);
      return;
    }

    const q = query(collection(db, 'videos'), where('location.country', '==', this.country));
    const snapshot = await getDocs(q);
    const videos: any[] = snapshot.docs.map(d => ({ id: d.id, ...d.data(), liked: false, bookmarked: false, username: '', photoURL: '' }));
    this.totalVideos = videos.length;

    // Fetch user data in parallel
    const userId = this.authService.currentUser()?.uid;
    const userIds = [...new Set(videos.map(v => v.userId))];
    const userCache = new Map<string, any>();
    await Promise.all(userIds.map(async (uid) => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) userCache.set(uid, userDoc.data());
    }));

    for (const video of videos) {
      const userData = userCache.get(video.userId);
      if (userData) {
        video.username = userData['username'];
        video.photoURL = userData['photoURL'] || '';
      }
    }

    if (userId) {
      await Promise.all(videos.map(async (video) => {
        const [likeDoc, bookmarkDoc] = await Promise.all([
          getDoc(doc(db, 'videos', video.id, 'likes', userId)),
          getDoc(doc(db, 'users', userId, 'bookmarks', video.id)),
        ]);
        video.liked = likeDoc.exists();
        video.bookmarked = bookmarkDoc.exists();
      }));
    }

    // Group by city
    const cityMap = new Map<string, any[]>();
    for (const video of videos) {
      const city = video.location?.city || 'Other';
      if (!cityMap.has(city)) cityMap.set(city, []);
      cityMap.get(city)!.push(video);
    }

    this.cities = Array.from(cityMap.entries())
      .map(([name, vids]) => ({ name, videos: vids.sort((a: any, b: any) => b.createdAt?.localeCompare(a.createdAt)) }))
      .sort((a, b) => b.videos.length - a.videos.length);

    this.loading = false;
    this.cdr.detectChanges();
  }

  private location = inject(Location);

  goBack() {
    this.location.back();
  }

  openViewer(cityVideos: any[], index: number) {
    this.viewerVideos = cityVideos;
    this.viewerIndex = index;
    this.showViewer = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      const container = this.viewerContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.clientHeight * index;
      }
      this.setupViewerObserver();
    });
  }

  closeViewer() {
    this.showViewer = false;
    this.closeComments();
    this.viewerObserver?.disconnect();
    this.viewerObserver = null;
  }

  private setupViewerObserver() {
    this.viewerObserver?.disconnect();

    this.viewerObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          video.play();
          this.isPaused = false;
          const idx = this.viewerVideoEls().findIndex(el => el.nativeElement === video);
          if (idx !== -1) this.viewerIndex = idx;
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.75 });

    this.viewerVideoEls().forEach(el => {
      this.viewerObserver!.observe(el.nativeElement);
    });
  }

  onPointerDown(event: Event, video: any) {
    // No long-press behavior
  }

  onPointerUp(event: Event, video: any) {
    clearTimeout(this.pressTimer);

    if (this.pendingTap) {
      clearTimeout(this.tapTimer);
      this.pendingTap = false;
      this.onDoubleTap(video);
    } else {
      this.pendingTap = true;
      this.tapTimer = setTimeout(() => {
        this.pendingTap = false;
        this.togglePause();
      }, 300);
    }
  }

  onDoubleTap(video: any) {
    if (!video.liked) {
      this.toggleLike(video);
    }
    video.showHeart = true;
    setTimeout(() => { video.showHeart = false; this.cdr.detectChanges(); }, 800);
    this.cdr.detectChanges();
  }

  togglePause() {
    const el = this.viewerVideoEls()[this.viewerIndex]?.nativeElement as HTMLVideoElement;
    if (!el) return;
    if (el.paused) { el.play(); this.isPaused = false; }
    else { el.pause(); this.isPaused = true; }
    if (!this.isPaused) {
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
      setTimeout(() => { this.pauseIndicatorFading = true; this.cdr.detectChanges(); }, 400);
      setTimeout(() => { this.showPauseIndicator = false; this.cdr.detectChanges(); }, 800);
    } else {
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
    }
  }

  toggleMute() {
    this.viewerMuted = !this.viewerMuted;
  }

  async toggleLike(video: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;
    const likeRef = doc(db, 'videos', video.id, 'likes', userId);
    const videoRef = doc(db, 'videos', video.id);

    if (video.liked) {
      video.liked = false;
      video.likeCount--;
      await deleteDoc(likeRef);
      await updateDoc(videoRef, { likeCount: increment(-1) });
    } else {
      video.liked = true;
      video.likeCount++;
      await setDoc(likeRef, { userId, createdAt: new Date().toISOString() });
      await updateDoc(videoRef, { likeCount: increment(1) });
    }
  }

  async toggleBookmark(video: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;
    const bookmarkRef = doc(db, 'users', userId, 'bookmarks', video.id);

    if (video.bookmarked) {
      video.bookmarked = false;
      await deleteDoc(bookmarkRef);
    } else {
      video.bookmarked = true;
      await setDoc(bookmarkRef, {
        videoId: video.id,
        country: video.location?.country || '',
        city: video.location?.city || '',
        cloudinaryUrl: video.cloudinaryUrl || '',
        title: video.title || '',
        createdAt: new Date().toISOString(),
      });
    }
  }

  openComments(video: any) {
    this.activeVideoId = video.id;
    this.showComments = true;
    this.comments = [];
    this.replyingTo = null;

    const userId = this.authService.currentUser()?.uid;
    const commentsRef = collection(db, 'videos', video.id, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    this.commentsUnsubscribe = onSnapshot(q, async (snapshot) => {
      const allComments: any[] = snapshot.docs.map(d => ({ id: d.id, ...d.data(), liked: false, showReplies: false, replies: [] as any[] }));

      if (userId) {
        await Promise.all(allComments.map(async (comment) => {
          const likeDoc = await getDoc(doc(db, 'videos', video.id, 'comments', comment.id, 'likes', userId));
          comment.liked = likeDoc.exists();
        }));
      }

      const needPhoto = allComments.filter(c => !c.photoURL);
      if (needPhoto.length > 0) {
        await Promise.all(needPhoto.map(async (comment) => {
          const uDoc = await getDoc(doc(db, 'users', comment.userId));
          comment.photoURL = uDoc.exists() ? uDoc.data()['photoURL'] || '' : '';
        }));
      }

      const topLevel = allComments.filter(c => !c.parentId);
      const replies = allComments.filter(c => c.parentId);
      const prevShowState = new Map(this.comments.map(c => [c.id, c.showReplies]));

      topLevel.forEach(c => {
        c.replies = replies.filter(r => r.parentId === c.id);
        c.replyCount = c.replies.length;
        c.showReplies = prevShowState.get(c.id) || false;
      });

      this.comments = topLevel;
      this.cdr.detectChanges();
    });
  }

  closeComments() {
    this.showComments = false;
    this.replyingTo = null;
    this.commentsUnsubscribe?.();
    this.commentsUnsubscribe = null;
  }

  startReply(comment: any) {
    this.replyingTo = comment;
    this.newComment = '';
  }

  cancelReply() {
    this.replyingTo = null;
    this.newComment = '';
  }

  async toggleCommentLike(comment: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    const likeRef = doc(db, 'videos', this.activeVideoId, 'comments', comment.id, 'likes', userId);
    const commentRef = doc(db, 'videos', this.activeVideoId, 'comments', comment.id);

    if (comment.liked) {
      comment.liked = false;
      comment.likeCount = (comment.likeCount || 1) - 1;
      await deleteDoc(likeRef);
      await updateDoc(commentRef, { likeCount: increment(-1) });
    } else {
      comment.liked = true;
      comment.likeCount = (comment.likeCount || 0) + 1;
      await setDoc(likeRef, { userId, createdAt: new Date().toISOString() });
      await updateDoc(commentRef, { likeCount: increment(1) });
    }
    this.cdr.detectChanges();
  }

  async postComment() {
    if (!this.newComment.trim()) return;
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    const text = this.newComment.trim();
    this.newComment = '';
    const parentId = this.replyingTo?.id || null;
    this.replyingTo = null;
    this.cdr.detectChanges();

    const userDoc = await getDoc(doc(db, 'users', userId));
    const username = userDoc.exists() ? userDoc.data()['username'] : 'Anonymous';
    const photoURL = userDoc.exists() ? userDoc.data()['photoURL'] || '' : '';

    const commentData: any = {
      userId, username, photoURL, text,
      createdAt: new Date().toISOString(),
      likeCount: 0,
    };
    if (parentId) commentData.parentId = parentId;
    await addDoc(collection(db, 'videos', this.activeVideoId, 'comments'), commentData);

    const videoRef = doc(db, 'videos', this.activeVideoId);
    await updateDoc(videoRef, { commentCount: increment(1) });

    const video = this.viewerVideos.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount++;

    if (parentId) {
      const parent = this.comments.find(c => c.id === parentId);
      if (parent) parent.showReplies = true;
    }

    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const userId = this.authService.currentUser()?.uid;
    if (comment.userId !== userId) return;

    this.confirmMessage = 'Delete this comment?';
    this.confirmAction = async () => {
      await deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', comment.id));

      if (!comment.parentId && comment.replies?.length) {
        await Promise.all(comment.replies.map((r: any) =>
          deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', r.id))
        ));
      }

      const videoRef = doc(db, 'videos', this.activeVideoId);
      const deleteCount = comment.parentId ? 1 : 1 + (comment.replies?.length || 0);
      await updateDoc(videoRef, { commentCount: increment(-deleteCount) });

      const video = this.viewerVideos.find(v => v.id === this.activeVideoId);
      if (video) video.commentCount -= deleteCount;

      this.cdr.detectChanges();
    };
    this.showConfirm = true;
  }
}
