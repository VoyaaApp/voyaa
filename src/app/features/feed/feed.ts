import { Component, AfterViewInit, OnDestroy, ElementRef, viewChildren, viewChild, HostListener, inject, ChangeDetectorRef } from '@angular/core';
import { collection, getDocs, orderBy, query, doc, setDoc, deleteDoc, getDoc, updateDoc, increment, addDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { timeAgo } from '../../shared/utils/time';
import { formatCount } from '../../shared/utils/format';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TopBar } from '../../shared/components/top-bar/top-bar';

@Component({
  selector: 'app-feed',
  imports: [FormsModule, RouterLink, ConfirmDialog, TopBar],
  templateUrl: './feed.html',
  styleUrl: './feed.scss',
})
export class Feed implements AfterViewInit, OnDestroy {
  videos: any[] = [];
  isMuted = true;
  showMuteIndicator = false;
  muteIndicatorFading = false;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;
  currentIndex = 0;
  loading = true;
  loadError = false;
  timeAgo = timeAgo;
  formatCount = formatCount;
  private pressTimer: any = null;
  private tapTimer: any = null;
  private isLongPress = false;
  private pendingTap = false;
  private viewedIds = new Set<string>();

  // Pull to refresh
  pullDistance = 0;
  isPulling = false;
  isRefreshing = false;
  private touchStartY = 0;

  videoElements = viewChildren<ElementRef>('videoPlayer');
  feedContainer = viewChild<ElementRef>('feedContainer');

  private observer: IntersectionObserver | null = null;
  private cdr = inject(ChangeDetectorRef);
  authService = inject(AuthService);

  // Confirm dialog state
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

  constructor() {
    this.loadVideos();
  }

  async loadVideos() {
    this.loadError = false;
    try {
    const q = query(collection(db, 'videos'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    this.videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), liked: false, bookmarked: false, username: '', photoURL: '', following: false }));

    const userId = this.authService.currentUser()?.uid;

    // Deduplicate user fetches
    const userIds = [...new Set(this.videos.map(v => v.userId))];
    const userCache = new Map<string, any>();
    await Promise.all(userIds.map(async (uid) => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) userCache.set(uid, userDoc.data());
    }));

    // Apply user data
    for (const video of this.videos) {
      const userData = userCache.get(video.userId);
      if (userData) {
        video.username = userData['username'];
        video.photoURL = userData['photoURL'] || '';
      }
    }

    // Batch like + follow checks in parallel
    if (userId) {
      await Promise.all(this.videos.map(async (video) => {
        const [likeDoc, bookmarkDoc] = await Promise.all([
          getDoc(doc(db, 'videos', video.id, 'likes', userId)),
          getDoc(doc(db, 'users', userId, 'bookmarks', video.id)),
        ]);
        video.liked = likeDoc.exists();
        video.bookmarked = bookmarkDoc.exists();
        if (video.userId !== userId) {
          const followDoc = await getDoc(doc(db, 'users', video.userId, 'followers', userId));
          video.following = followDoc.exists();
        }
      }));
    }

    this.loading = false;
    this.cdr.detectChanges();

    // Wait for DOM to render, then set up observer
    if (this.videos.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
        this.setupObserver();
      });
    });
    }
    } catch (err) {
      this.loading = false;
      this.loadError = true;
      this.cdr.detectChanges();
    }
  }

  async toggleFollow(video: any) {
    const currentUid = this.authService.currentUser()?.uid;
    if (!currentUid || video.userId === currentUid) return;

    video.followAnimating = true;
    this.cdr.detectChanges();
    setTimeout(() => { video.followAnimating = false; this.cdr.detectChanges(); }, 400);

    const followerRef = doc(db, 'users', video.userId, 'followers', currentUid);
    const followingRef = doc(db, 'users', currentUid, 'following', video.userId);
    const targetUserRef = doc(db, 'users', video.userId);
    const currentUserRef = doc(db, 'users', currentUid);

    if (video.following) {
      video.following = false;
      await deleteDoc(followerRef);
      await deleteDoc(followingRef);
      await updateDoc(targetUserRef, { followerCount: increment(-1) });
      await updateDoc(currentUserRef, { followingCount: increment(-1) });
    } else {
      video.following = true;
      await setDoc(followerRef, { userId: currentUid, createdAt: new Date().toISOString() });
      await setDoc(followingRef, { userId: video.userId, createdAt: new Date().toISOString() });
      await updateDoc(targetUserRef, { followerCount: increment(1) });
      await updateDoc(currentUserRef, { followingCount: increment(1) });

      // Send notification
      const currentUserDoc = await getDoc(currentUserRef);
      const fromUsername = currentUserDoc.exists() ? currentUserDoc.data()['username'] : '';
      const fromPhotoURL = currentUserDoc.exists() ? currentUserDoc.data()['photoURL'] || '' : '';
      await addDoc(collection(db, 'users', video.userId, 'notifications'), {
        type: 'follow',
        fromUserId: currentUid,
        fromUsername,
        fromPhotoURL,
        createdAt: new Date().toISOString(),
        read: false,
      });
    }

    // Sync follow state across all videos by same creator
    this.videos.forEach(v => {
      if (v.userId === video.userId) v.following = video.following;
    });
    this.cdr.detectChanges();
  }

  async toggleLike(video: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    const likeRef = doc(db, 'videos', video.id, 'likes', userId);
    const videoRef = doc(db, 'videos', video.id);

    if (video.liked) {
      // Unlike
      video.liked = false;
      video.likeAnimating = false;
      video.likeCount--;
      await deleteDoc(likeRef);
      await updateDoc(videoRef, { likeCount: increment(-1) });
    } else {
      // Like
      video.liked = true;
      video.likeAnimating = true;
      video.likeCount++;
      await setDoc(likeRef, { userId, createdAt: new Date().toISOString() });
      await updateDoc(videoRef, { likeCount: increment(1) });
      setTimeout(() => { video.likeAnimating = false; this.cdr.detectChanges(); }, 400);

      // Send notification (don't notify self)
      if (video.userId !== userId) {
        const currentUserRef = doc(db, 'users', userId);
        const currentUserDoc = await getDoc(currentUserRef);
        const fromUsername = currentUserDoc.exists() ? currentUserDoc.data()['username'] : '';
        const fromPhotoURL = currentUserDoc.exists() ? currentUserDoc.data()['photoURL'] || '' : '';
        await addDoc(collection(db, 'users', video.userId, 'notifications'), {
          type: 'like',
          fromUserId: userId,
          fromUsername,
          fromPhotoURL,
          videoId: video.id,
          videoTitle: video.title,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
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

  // Comments
  showComments = false;
  comments: any[] = [];
  newComment = '';
  posting = false;
  replyingTo: any = null;
  private activeVideoId = '';
  private commentsUnsubscribe: (() => void) | null = null;

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

      // Check which comments the user has liked
      if (userId) {
        await Promise.all(allComments.map(async (comment) => {
          const likeDoc = await getDoc(doc(db, 'videos', video.id, 'comments', comment.id, 'likes', userId));
          comment.liked = likeDoc.exists();
        }));
      }

      // Enrich missing photoURLs
      const needPhoto = allComments.filter(c => !c.photoURL);
      if (needPhoto.length > 0) {
        await Promise.all(needPhoto.map(async (comment) => {
          const uDoc = await getDoc(doc(db, 'users', comment.userId));
          comment.photoURL = uDoc.exists() ? uDoc.data()['photoURL'] || '' : '';
        }));
      }

      // Separate top-level and replies
      const topLevel = allComments.filter(c => !c.parentId);
      const replies = allComments.filter(c => c.parentId);

      // Preserve showReplies state from previous render
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
    if (this.commentsUnsubscribe) {
      this.commentsUnsubscribe();
      this.commentsUnsubscribe = null;
    }
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
    if (!this.newComment.trim() || this.posting) return;

    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    this.posting = true;
    const text = this.newComment.trim();
    this.newComment = '';
    const parentId = this.replyingTo?.id || null;
    this.replyingTo = null;
    this.cdr.detectChanges();

    const userDoc = await getDoc(doc(db, 'users', userId));
    const username = userDoc.exists() ? userDoc.data()['username'] : 'Anonymous';
    const photoURL = userDoc.exists() ? userDoc.data()['photoURL'] || '' : '';

    const commentsRef = collection(db, 'videos', this.activeVideoId, 'comments');
    const commentData: any = {
      userId,
      username,
      photoURL,
      text,
      createdAt: new Date().toISOString(),
      likeCount: 0,
    };
    if (parentId) {
      commentData.parentId = parentId;
    }
    await addDoc(commentsRef, commentData);

    // Update comment count on video
    const videoRef = doc(db, 'videos', this.activeVideoId);
    await updateDoc(videoRef, { commentCount: increment(1) });

    // Update local count
    const video = this.videos.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount++;

    // Expand replies if this was a reply
    if (parentId) {
      const parent = this.comments.find(c => c.id === parentId);
      if (parent) parent.showReplies = true;
    }

    // Send notification
    if (video && video.userId !== userId) {
      await addDoc(collection(db, 'users', video.userId, 'notifications'), {
        type: 'comment',
        fromUserId: userId,
        fromUsername: username,
        fromPhotoURL: photoURL,
        videoId: video.id,
        videoTitle: video.title,
        createdAt: new Date().toISOString(),
        read: false,
      });
    }

    this.posting = false;
    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const userId = this.authService.currentUser()?.uid;
    if (comment.userId !== userId) return;

    this.confirmMessage = 'Delete this comment?';
    this.confirmAction = async () => {
      await deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', comment.id));

      // Also delete replies if it's a top-level comment
      if (!comment.parentId && comment.replies?.length) {
        await Promise.all(comment.replies.map((r: any) =>
          deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', r.id))
        ));
      }

      const videoRef = doc(db, 'videos', this.activeVideoId);
      const deleteCount = comment.parentId ? 1 : 1 + (comment.replies?.length || 0);
      await updateDoc(videoRef, { commentCount: increment(-deleteCount) });

      const video = this.videos.find(v => v.id === this.activeVideoId);
      if (video) video.commentCount -= deleteCount;

      this.cdr.detectChanges();
    };
    this.showConfirm = true;
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    this.observer?.disconnect();
    this.commentsUnsubscribe?.();
    clearTimeout(this.pressTimer);
    clearTimeout(this.tapTimer);
  }

  setupObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          video.play();
          this.isPaused = false;
          const index = this.videoElements().findIndex(el => el.nativeElement === video);
          if (index !== -1) {
            this.currentIndex = index;
            this.trackView(this.videos[index]);
          }
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.75 });

    this.videoElements().forEach(el => {
      this.observer!.observe(el.nativeElement);
    });

    // First video is already visible — play it immediately
    const firstVideo = this.videoElements()[0]?.nativeElement as HTMLVideoElement;
    if (firstVideo) {
      firstVideo.play();
      if (this.videos[0]) this.trackView(this.videos[0]);
    }
  }

  private async trackView(video: any) {
    if (!video || this.viewedIds.has(video.id)) return;
    this.viewedIds.add(video.id);
    video.viewCount = (video.viewCount || 0) + 1;
    const videoRef = doc(db, 'videos', video.id);
    await updateDoc(videoRef, { viewCount: increment(1) });
  }

  // Pull to refresh
  onTouchStart(event: TouchEvent) {
    const container = this.feedContainer()?.nativeElement;
    if (container && container.scrollTop === 0) {
      this.touchStartY = event.touches[0].clientY;
      this.isPulling = true;
    }
  }

  onTouchMove(event: TouchEvent) {
    if (!this.isPulling || this.isRefreshing) return;
    const delta = event.touches[0].clientY - this.touchStartY;
    if (delta > 0) {
      this.pullDistance = Math.min(delta * 0.5, 80);
      this.cdr.detectChanges();
    } else {
      this.pullDistance = 0;
      this.isPulling = false;
    }
  }

  async onTouchEnd() {
    if (!this.isPulling) return;
    if (this.pullDistance > 50) {
      this.isRefreshing = true;
      this.pullDistance = 50;
      this.cdr.detectChanges();
      await this.loadVideos();
      this.isRefreshing = false;
    }
    this.pullDistance = 0;
    this.isPulling = false;
    this.cdr.detectChanges();
  }

  onPointerDown(event: Event, video: any) {
    // No long-press behavior
  }

  onPointerUp(event: Event, video: any) {
    if (this.pendingTap) {
      clearTimeout(this.tapTimer);
      this.pendingTap = false;
      this.onDoubleTap(video);
    } else {
      this.pendingTap = true;
      this.tapTimer = setTimeout(() => {
        this.pendingTap = false;
        this.togglePause(video);
      }, 300);
    }
  }

  onDoubleTap(video: any) {
    if (!video.liked) {
      this.toggleLike(video);
    }
    video.showHeart = true;
    setTimeout(() => {
      video.showHeart = false;
      this.cdr.detectChanges();
    }, 800);
    this.cdr.detectChanges();
  }

  togglePause(video: any) {
    const el = this.videoElements()[this.currentIndex]?.nativeElement as HTMLVideoElement;
    if (!el) return;
    if (el.paused) {
      el.play();
      this.isPaused = false;
    } else {
      el.pause();
      this.isPaused = true;
    }
    if (!this.isPaused) {
      // Playing: show briefly then fade
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.pauseIndicatorFading = true;
        this.cdr.detectChanges();
      }, 400);
      setTimeout(() => {
        this.showPauseIndicator = false;
        this.cdr.detectChanges();
      }, 800);
    } else {
      // Paused: stay visible
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.showMuteIndicator = true;
    this.muteIndicatorFading = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.muteIndicatorFading = true;
      this.cdr.detectChanges();
    }, 500);

    setTimeout(() => {
      this.showMuteIndicator = false;
      this.cdr.detectChanges();
    }, 1000);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.goToVideo(this.currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.goToVideo(this.currentIndex - 1);
    }
  }

  goToVideo(index: number) {
    if (index < 0 || index >= this.videos.length) return;
    this.currentIndex = index;
    const container = this.feedContainer()?.nativeElement;
    const cardHeight = container.clientHeight;
    const targetScroll = cardHeight * index;
    const startScroll = container.scrollTop;
    const distance = targetScroll - startScroll;
    const duration = 400;
    let startTime: number;

    container.style.scrollSnapType = 'none';

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress * (2 - progress); // ease-out

      container.scrollTop = startScroll + distance * ease;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        container.style.scrollSnapType = 'y mandatory';
      }
    };

    requestAnimationFrame(animate);
  }
}
