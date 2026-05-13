import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, viewChildren, viewChild, HostListener, inject, ChangeDetectorRef } from '@angular/core';
import { collection, getDocs, orderBy, query, doc, getDoc, updateDoc, increment, limit, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { InteractionService } from '../../core/services/interaction.service';
import { BlockService } from '../../core/services/block.service';
import { CommentPanel } from '../../shared/components/comment-panel/comment-panel';
import { timeAgo } from '../../shared/utils/time';
import { formatCount, getThumbUrl } from '../../shared/utils/format';
import { sharePost } from '../../shared/utils/share';
import { RouterLink } from '@angular/router';
import { TopBar } from '../../shared/components/top-bar/top-bar';
import { ReportPanel } from '../../shared/components/report-panel/report-panel';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { TripPicker } from '../../shared/components/trip-picker/trip-picker';
import { TripService, Trip, WISHLIST_ID } from '../../core/services/trip.service';

@Component({
  selector: 'app-feed',
  imports: [RouterLink, TopBar, CommentPanel, ReportPanel, ConfirmDialog, TripPicker],
  templateUrl: './feed.html',
  styleUrl: './feed.scss',
})
export class Feed implements OnInit, AfterViewInit, OnDestroy {
  videos: any[] = [];
  isMuted = true;
  getThumbUrl = getThumbUrl;
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

  // Pagination
  private readonly PAGE_SIZE = 5;
  private lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  allLoaded = false;
  loadingMore = false;
  private sentinelObserver: IntersectionObserver | null = null;

  videoElements = viewChildren<ElementRef>('videoPlayer');
  feedContainer = viewChild<ElementRef>('feedContainer');

  private observer: IntersectionObserver | null = null;
  private cdr = inject(ChangeDetectorRef);
  authService = inject(AuthService);
  private interaction = inject(InteractionService);
  private blockService = inject(BlockService);
  private tripService = inject(TripService);

  // Trip picker
  showTripPicker = false;
  trips: Trip[] = [];
  private pendingBookmarkVideo: any = null;

  ngOnInit() {
    this.loadVideos();
  }

  ngAfterViewInit() {}

  async loadVideos() {
    this.loadError = false;
    try {
    await this.blockService.ensureLoaded();
    this.lastDoc = null;
    this.allLoaded = false;
    const q = query(collection(db, 'videos'), orderBy('createdAt', 'desc'), limit(this.PAGE_SIZE));
    const snapshot = await getDocs(q);

    if (snapshot.docs.length < this.PAGE_SIZE) {
      this.allLoaded = true;
    }
    if (snapshot.docs.length > 0) {
      this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    this.videos = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data(), liked: false, bookmarked: false, username: '', photoURL: '', following: false }) as any)
      .filter((v: any) => !this.blockService.isBlocked(v.userId));

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

    this.loading = false;
    this.cdr.detectChanges();

    // Wait for DOM to render, then set up observer
    if (this.videos.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
        this.setupObserver();
        this.setupSentinelObserver();
      });
    });
    }

    // Defer interaction checks — videos are already visible
    if (userId) {
      this.loadInteractions(this.videos, userId);
    }
    } catch (err) {
      this.loading = false;
      this.loadError = true;
      this.cdr.detectChanges();
    }
  }

  async loadMore() {
    if (this.allLoaded || this.loadingMore || !this.lastDoc) return;
    this.loadingMore = true;

    const q = query(
      collection(db, 'videos'),
      orderBy('createdAt', 'desc'),
      startAfter(this.lastDoc),
      limit(this.PAGE_SIZE)
    );
    const snapshot = await getDocs(q);

    if (snapshot.docs.length < this.PAGE_SIZE) {
      this.allLoaded = true;
    }
    if (snapshot.docs.length > 0) {
      this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    const newVideos = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data(), liked: false, bookmarked: false, username: '', photoURL: '', following: false }) as any)
      .filter((v: any) => !this.blockService.isBlocked(v.userId));

    // Fetch user data for new videos
    const userIds = [...new Set(newVideos.map((v: any) => v.userId))];
    const userCache = new Map<string, any>();
    await Promise.all(userIds.map(async (uid) => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) userCache.set(uid, userDoc.data());
    }));
    for (const video of newVideos) {
      const userData = userCache.get(video.userId);
      if (userData) {
        video.username = userData['username'];
        video.photoURL = userData['photoURL'] || '';
      }
    }

    this.videos = [...this.videos, ...newVideos];
    this.loadingMore = false;
    this.cdr.detectChanges();

    // Observe new video elements for autoplay
    requestAnimationFrame(() => {
      const allEls = this.videoElements();
      const newEls = allEls.slice(allEls.length - newVideos.length);
      newEls.forEach(el => this.observer?.observe(el.nativeElement));
    });

    // Defer interaction checks for new batch
    const userId = this.authService.currentUser()?.uid;
    if (userId) {
      this.loadInteractions(newVideos, userId);
    }
  }

  private loadInteractions(videos: any[], userId: string) {
    Promise.all(videos.map(async (video) => {
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
    })).then(() => this.cdr.detectChanges());
  }

  private setupSentinelObserver() {
    this.sentinelObserver?.disconnect();
    const container = this.feedContainer()?.nativeElement;
    if (!container) return;
    const sentinel = container.querySelector('.feed-sentinel');
    if (!sentinel) return;

    this.sentinelObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        this.loadMore();
      }
    }, { threshold: 0.1 });
    this.sentinelObserver.observe(sentinel);
  }

  async toggleFollow(video: any) {
    const currentUid = this.authService.currentUser()?.uid;
    if (!currentUid || video.userId === currentUid) return;

    video.followAnimating = true;
    this.cdr.detectChanges();
    setTimeout(() => { video.followAnimating = false; this.cdr.detectChanges(); }, 400);

    const result = await this.interaction.toggleFollow(video.userId, video.following);
    video.following = result.following;

    // Sync follow state across all videos by same creator
    this.videos.forEach(v => {
      if (v.userId === video.userId) v.following = video.following;
    });
    this.cdr.detectChanges();
  }

  async toggleLike(video: any) {
    if (!video.liked) {
      video.likeAnimating = true;
      setTimeout(() => { video.likeAnimating = false; this.cdr.detectChanges(); }, 400);
    }
    const result = await this.interaction.toggleLike('videos', video.id, video.userId, video.title, video.liked);
    video.liked = result.liked;
    video.likeCount += result.delta;
    if (!result.liked) video.likeAnimating = false;
    this.cdr.detectChanges();
  }

  async toggleBookmark(video: any) {
    if (video.bookmarked) {
      video.bookmarked = await this.interaction.toggleBookmark(video.id, true, {});
      this.cdr.detectChanges();
      return;
    }
    this.pendingBookmarkVideo = video;
    this.trips = await this.tripService.getTrips(this.authService.currentUser()!.uid);
    this.showTripPicker = true;
    this.cdr.detectChanges();
  }

  async onTripSelected(tripId: string) {
    const video = this.pendingBookmarkVideo;
    if (!video) return;
    video.bookmarked = await this.interaction.toggleBookmark(video.id, false, {
      country: video.location?.country || '',
      city: video.location?.city || '',
      cloudinaryUrl: video.cloudinaryUrl || '',
      title: video.title || '',
      tripId,
    });
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
    this.cdr.detectChanges();
  }

  onTripCreated(trip: Trip) {
    this.trips = [trip, ...this.trips];
  }

  closeTripPicker() {
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
  }

  // Comments
  showComments = false;
  private activeVideo: any = null;

  openComments(video: any) {
    this.activeVideo = video;
    this.showComments = true;
    this.cdr.detectChanges();
  }

  closeComments() {
    this.showComments = false;
    this.activeVideo = null;
  }

  onCommentCountChange(delta: number) {
    if (this.activeVideo) this.activeVideo.commentCount += delta;
    this.cdr.detectChanges();
  }

  get commentsVideoId(): string { return this.activeVideo?.id || ''; }
  get commentsOwnerId(): string { return this.activeVideo?.userId || ''; }
  get commentsTitle(): string { return this.activeVideo?.title || ''; }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.sentinelObserver?.disconnect();
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
          this.showPauseIndicator = false;
          this.pauseIndicatorFading = false;
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

  // ── Share ──

  showCopiedToast = false;

  // Report / Block
  showReportPanel = false;
  reportContentId = '';
  reportContentType: 'video' | 'post' = 'video';
  reportContentOwnerId = '';

  showBlockConfirm = false;
  blockTargetId = '';
  blockTargetName = '';

  openReport(video: any) {
    this.reportContentId = video.id;
    this.reportContentType = 'video';
    this.reportContentOwnerId = video.userId;
    this.showReportPanel = true;
    this.cdr.detectChanges();
  }

  closeReport() {
    this.showReportPanel = false;
  }

  confirmBlock(video: any) {
    this.blockTargetId = video.userId;
    this.blockTargetName = video.username || 'this user';
    this.showBlockConfirm = true;
    this.cdr.detectChanges();
  }

  async doBlock() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.blockTargetId) return;
    const { setDoc, doc: fbDoc } = await import('firebase/firestore');
    await setDoc(fbDoc(db, 'users', uid, 'blockedUsers', this.blockTargetId), { blockedAt: new Date().toISOString() });
    this.blockService.addBlock(this.blockTargetId);
    this.videos = this.videos.filter(v => v.userId !== this.blockTargetId);
    this.showBlockConfirm = false;
    this.cdr.detectChanges();
  }

  cancelBlock() {
    this.showBlockConfirm = false;
  }

  // Delete confirmation
  showDeleteConfirm = false;
  pendingDeleteVideo: any = null;
  deleteError = false;

  deleteVideo(video: any) {
    this.pendingDeleteVideo = video;
    this.showDeleteConfirm = true;
    this.cdr.detectChanges();
  }

  async doDeleteVideo() {
    this.showDeleteConfirm = false;
    const video = this.pendingDeleteVideo;
    if (!video) return;
    try {
      const { deleteDoc, doc: fbDoc } = await import('firebase/firestore');
      await deleteDoc(fbDoc(db, 'videos', video.id));
      this.videos = this.videos.filter(v => v.id !== video.id);
    } catch {
      this.deleteError = true;
      setTimeout(() => { this.deleteError = false; this.cdr.detectChanges(); }, 3000);
    }
    this.pendingDeleteVideo = null;
    this.cdr.detectChanges();
  }

  cancelDeleteVideo() {
    this.showDeleteConfirm = false;
    this.pendingDeleteVideo = null;
  }

  async onShare(video: any) {
    const copied = await sharePost(video.title);
    if (copied) {
      this.showCopiedToast = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.showCopiedToast = false; this.cdr.detectChanges(); }, 2000);
    }
  }
}
