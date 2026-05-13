import { Component, OnInit, AfterViewInit, OnDestroy, inject, ChangeDetectorRef, ChangeDetectionStrategy, ElementRef } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { InteractionService } from '../../core/services/interaction.service';
import { BlockService } from '../../core/services/block.service';
import { CommentPanel } from '../../shared/components/comment-panel/comment-panel';
import { PostCard } from '../../shared/components/post-card/post-card';
import { ReportPanel } from '../../shared/components/report-panel/report-panel';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { TripPicker } from '../../shared/components/trip-picker/trip-picker';
import { TripService, Trip, WISHLIST_ID } from '../../core/services/trip.service';
import { timeAgo } from '../../shared/utils/time';
import { formatCount, getThumbUrl } from '../../shared/utils/format';
import { sharePost } from '../../shared/utils/share';

@Component({
  selector: 'app-destination',
  imports: [CommentPanel, PostCard, RouterLink, ReportPanel, ConfirmDialog, TripPicker],
  templateUrl: './destination.html',
  styleUrl: './destination.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Destination implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private locationService = inject(Location);
  private elRef = inject(ElementRef);
  authService = inject(AuthService);
  private interaction = inject(InteractionService);
  private blockService = inject(BlockService);
  private tripService = inject(TripService);

  country = '';
  city = '';
  feedItems: any[] = [];
  loading = true;
  loadError = false;
  deleteError = false;
  showDeleteConfirm = false;
  private pendingDeleteItem: any = null;
  timeAgo = timeAgo;
  formatCount = formatCount;

  getThumbUrl = getThumbUrl;

  getPostImages(item: any): string[] {
    if (item._type === 'video') {
      return [this.getThumbUrl(item.cloudinaryUrl)];
    }
    return (item.images || []).map((img: any) => img.url);
  }

  get headerTitle(): string {
    return this.city ? `${this.city}, ${this.country}` : this.country;
  }

  // Inline video autoplay
  videoMuted = false;
  private observer: IntersectionObserver | null = null;
  private currentPlayingVideo: HTMLVideoElement | null = null;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;
  pausedVideoCard: any = null;

  // Comments
  showComments = false;
  private activeItem: any = null;

  openComments(item: any) {
    this.activeItem = item;
    this.showComments = true;
    this.cdr.detectChanges();
  }

  closeComments() {
    this.showComments = false;
    this.activeItem = null;
  }

  onCommentCountChange(delta: number) {
    if (this.activeItem) this.activeItem.commentCount += delta;
    this.cdr.detectChanges();
  }

  get commentsItemId(): string { return this.activeItem?.id || ''; }
  get commentsOwnerId(): string { return this.activeItem?.userId || ''; }
  get commentsTitle(): string { return this.activeItem?.title || ''; }
  get commentsCollectionType(): 'videos' | 'posts' { return this.activeItem?._type === 'video' ? 'videos' : 'posts'; }

  async ngOnInit() {
    this.country = decodeURIComponent(this.route.snapshot.paramMap.get('country') || '');
    this.city = decodeURIComponent(this.route.snapshot.paramMap.get('city') || '');
    if (!this.country) {
      this.router.navigate(['/explore']);
      return;
    }

    try {
      await this.blockService.ensureLoaded();

      // Fetch both collections filtered by country
      const videoQ = query(collection(db, 'videos'), where('location.country', '==', this.country));
      const postQ = query(collection(db, 'posts'), where('location.country', '==', this.country));
      const [videoSnap, postSnap] = await Promise.all([getDocs(videoQ), getDocs(postQ)]);

      let items: any[] = [
        ...videoSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'video', liked: false, bookmarked: false, username: '', photoURL: '' })),
        ...postSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'post', liked: false, bookmarked: false, username: '', photoURL: '' })),
      ].filter((i: any) => !this.blockService.isBlocked(i.userId));

      // Filter by city if specified
      if (this.city) {
        items = items.filter(i => i.location?.city === this.city);
      }

      // Fetch user data
      const userId = this.authService.currentUser()?.uid;
      const userIds = [...new Set(items.map(i => i.userId))];
      const userCache = new Map<string, any>();
      await Promise.all(userIds.map(async (uid) => {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) userCache.set(uid, userDoc.data());
      }));

      for (const item of items) {
        const userData = userCache.get(item.userId);
        if (userData) {
          item.username = userData['username'];
          item.photoURL = userData['photoURL'] || '';
        }
      }

      // Fetch like/bookmark state
      if (userId) {
        await Promise.all(items.map(async (item) => {
          const collName = item._type === 'video' ? 'videos' : 'posts';
          const [likeDoc, bookmarkDoc] = await Promise.all([
            getDoc(doc(db, collName, item.id, 'likes', userId)),
            getDoc(doc(db, 'users', userId, 'bookmarks', item.id)),
          ]);
          item.liked = likeDoc.exists();
          item.bookmarked = bookmarkDoc.exists();
        }));
      }

      // Sort by createdAt descending
      items.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt || '';
        const bTime = b.createdAt?.seconds || b.createdAt || '';
        return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
      });

      this.feedItems = items;
      this.loading = false;
      this.cdr.detectChanges();
      setTimeout(() => this.setupVideoObserver());
    } catch {
      this.loading = false;
      this.loadError = true;
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {
    this.setupVideoObserver();
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  private setupVideoObserver() {
    this.observer?.disconnect();
    const videos = this.elRef.nativeElement.querySelectorAll('video.feed-video');
    if (!videos.length) return;

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (this.currentPlayingVideo && this.currentPlayingVideo !== video) {
            this.currentPlayingVideo.pause();
          }
          video.play();
          this.currentPlayingVideo = video;
        } else {
          video.pause();
          if (this.currentPlayingVideo === video) {
            this.currentPlayingVideo = null;
          }
        }
      }
    }, { threshold: 0.6 });

    videos.forEach((v: Element) => this.observer!.observe(v));
  }

  toggleVideoMute() {
    this.videoMuted = !this.videoMuted;
  }

  toggleVideoPlay(event: Event, item?: any) {
    const video = event.target as HTMLVideoElement;
    if (video.paused) {
      if (this.currentPlayingVideo && this.currentPlayingVideo !== video) {
        this.currentPlayingVideo.pause();
      }
      video.play();
      this.currentPlayingVideo = video;
      this.isPaused = false;
      this.pausedVideoCard = item || null;
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
      setTimeout(() => { this.pauseIndicatorFading = true; this.cdr.detectChanges(); }, 400);
      setTimeout(() => { this.showPauseIndicator = false; this.pausedVideoCard = null; this.cdr.detectChanges(); }, 800);
    } else {
      video.pause();
      this.isPaused = true;
      this.pausedVideoCard = item || null;
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
    }
  }

  goBack() {
    this.locationService.back();
  }

  onLikeChange(item: any, event: { liked: boolean; likeCount: number }) {
    item.liked = event.liked;
    item.likeCount = event.likeCount;
    this.cdr.detectChanges();
  }

  onBookmarkChange(item: any, bookmarked: boolean) {
    item.bookmarked = bookmarked;
    this.cdr.detectChanges();
  }

  async onShare(item: any) {
    await sharePost(item.title);
  }

  async toggleLike(item: any) {
    const collName = item._type === 'video' ? 'videos' : 'posts';
    const result = await this.interaction.toggleLike(collName, item.id, item.userId, item.title || '', item.liked);
    item.liked = result.liked;
    item.likeCount = (item.likeCount || 0) + result.delta;
    this.cdr.detectChanges();
  }

  async toggleBookmark(item: any) {
    if (item.bookmarked) {
      item.bookmarked = await this.interaction.toggleBookmark(item.id, true, {});
      this.cdr.detectChanges();
      return;
    }
    this.pendingBookmarkItem = item;
    this.tripPickerTrips = await this.tripService.getTrips(this.authService.currentUser()!.uid);
    this.showTripPicker = true;
    this.cdr.detectChanges();
  }

  // Trip picker
  showTripPicker = false;
  tripPickerTrips: Trip[] = [];
  private pendingBookmarkItem: any = null;

  async onTripSelected(tripId: string) {
    const item = this.pendingBookmarkItem;
    if (!item) return;
    item.bookmarked = await this.interaction.toggleBookmark(item.id, false, {
      title: item.title,
      thumbnail: item._type === 'video' ? this.getThumbUrl(item.cloudinaryUrl) : item.images?.[0]?.url || '',
      country: item.location?.country || this.country || '',
      city: item.location?.city || this.city || '',
      tripId,
    });
    this.showTripPicker = false;
    this.pendingBookmarkItem = null;
    this.cdr.detectChanges();
  }

  onTripCreated(trip: Trip) {
    this.tripPickerTrips = [trip, ...this.tripPickerTrips];
  }

  closeTripPicker() {
    this.showTripPicker = false;
    this.pendingBookmarkItem = null;
  }

  // Report / Block
  showReportPanel = false;
  reportContentId = '';
  reportContentType: 'video' | 'post' = 'post';
  reportContentOwnerId = '';

  showBlockConfirm = false;
  blockTargetId = '';
  blockTargetName = '';

  openReport(data: { contentId: string; contentType: string; contentOwnerId: string }) {
    this.reportContentId = data.contentId;
    this.reportContentType = data.contentType as 'video' | 'post';
    this.reportContentOwnerId = data.contentOwnerId;
    this.showReportPanel = true;
    this.cdr.detectChanges();
  }

  openReportVideo(item: any) {
    this.openReport({ contentId: item.id, contentType: 'video', contentOwnerId: item.userId });
  }

  closeReport() {
    this.showReportPanel = false;
  }

  confirmBlock(userId: string) {
    const item = this.feedItems.find(i => i.userId === userId);
    this.blockTargetId = userId;
    this.blockTargetName = item?.username || 'this user';
    this.showBlockConfirm = true;
    this.cdr.detectChanges();
  }

  async doBlock() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.blockTargetId) return;
    const { setDoc, doc: fbDoc } = await import('firebase/firestore');
    await setDoc(fbDoc(db, 'users', uid, 'blockedUsers', this.blockTargetId), { blockedAt: new Date().toISOString() });
    this.blockService.addBlock(this.blockTargetId);
    this.feedItems = this.feedItems.filter(i => i.userId !== this.blockTargetId);
    this.showBlockConfirm = false;
    this.cdr.detectChanges();
  }

  cancelBlock() {
    this.showBlockConfirm = false;
  }

  deleteVideo(item: any) {
    this.pendingDeleteItem = item;
    this.showDeleteConfirm = true;
    this.cdr.detectChanges();
  }

  deletePost(item: any) {
    this.pendingDeleteItem = item;
    this.showDeleteConfirm = true;
    this.cdr.detectChanges();
  }

  async doDeleteVideo() {
    if (!this.pendingDeleteItem) return;
    this.showDeleteConfirm = false;
    try {
      const { deleteDoc, doc: fbDoc } = await import('firebase/firestore');
      const col = this.pendingDeleteItem._type === 'video' ? 'videos' : 'posts';
      await deleteDoc(fbDoc(db, col, this.pendingDeleteItem.id));
      this.feedItems = this.feedItems.filter(i => i.id !== this.pendingDeleteItem.id);
    } catch {
      this.deleteError = true;
      setTimeout(() => { this.deleteError = false; this.cdr.detectChanges(); }, 3000);
    }
    this.pendingDeleteItem = null;
    this.cdr.detectChanges();
  }

  cancelDeleteVideo() {
    this.showDeleteConfirm = false;
    this.pendingDeleteItem = null;
  }

  loadContent() {
    this.loading = true;
    this.loadError = false;
    this.cdr.detectChanges();
    this.ngOnInit();
  }
}
