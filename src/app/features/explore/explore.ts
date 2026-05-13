import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef, ElementRef, viewChild, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { collection, getDocs, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { InteractionService } from '../../core/services/interaction.service';
import { BlockService } from '../../core/services/block.service';
import { CommentPanel } from '../../shared/components/comment-panel/comment-panel';
import { PostCard } from '../../shared/components/post-card/post-card';
import { ReportPanel } from '../../shared/components/report-panel/report-panel';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { TripPicker } from '../../shared/components/trip-picker/trip-picker';
import { TripService, Trip, WISHLIST_ID } from '../../core/services/trip.service';
import { COUNTRY_COORDS, REGION_MAP } from '../../shared/data/geo';
import { formatCount } from '../../shared/utils/format';
import { timeAgo } from '../../shared/utils/time';
import { sharePost } from '../../shared/utils/share';

declare const L: any;

interface VideoCard {
  id: string;
  cloudinaryUrl: string;
  country: string;
  city: string;
  createdAt: any;
  userId: string;
  userName: string;
  userAvatar: string;
  title?: string;
  liked: boolean;
  bookmarked: boolean;
  likeCount: number;
  commentCount: number;
  viewCount?: number;
  showHeart?: boolean;
  showMenu?: boolean;
  _type: 'video' | 'post';
  images?: { url: string; publicId: string }[];
  thumbnailUrl?: string;
  imageIndex?: number;
}

@Component({
  selector: 'app-explore',
  imports: [RouterLink, PostCard, CommentPanel, ReportPanel, ConfirmDialog, TripPicker],
  templateUrl: './explore.html',
  styleUrl: './explore.scss',
})
export class Explore implements OnInit, AfterViewInit, OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  authService = inject(AuthService);
  private interaction = inject(InteractionService);
  private blockService = inject(BlockService);
  private tripService = inject(TripService);
  mapContainer = viewChild<ElementRef>('mapContainer');

  allVideoCards: VideoCard[] = [];
  displayedVideos: VideoCard[] = [];

  followedUids = new Set<string>();
  favouriteCountries = new Set<string>();
  loading = true;
  loadError = false;
  formatCount = formatCount;
  timeAgo = timeAgo;
  isMuted = false;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;
  pausedVideoCard: VideoCard | null = null;
  private pressTimer: any = null;
  private tapTimer: any = null;
  private pendingTap = false;
  private userPausedVideo: HTMLVideoElement | null = null;

  // Lightbox
  lightboxPost: VideoCard | null = null;
  lightboxIndex = 0;
  private lightboxSwipeStartX = 0;
  private lightboxSwipeDelta = 0;

  // Messages & Notifications
  unreadMessages = 0;
  unreadNotifications = 0;
  private unsubMessages: (() => void) | null = null;
  private unsubNotifications: (() => void) | null = null;

  tabs = ['All', 'Following', 'Trending', 'Favourited', 'Asia', 'Europe', 'Americas', 'Africa', 'Middle East', 'Oceania'];
  activeTab = 'All';

  followingVideoElements = viewChildren<ElementRef>('followingVideo');
  private followingObserver: IntersectionObserver | null = null;

  private miniMap: any = null;
  private allVideos: any[] = [];

  /** Convert Cloudinary video URL to an image thumbnail */
  getThumbUrl(url: string): string {
    if (!url) return '';
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
      .replace(/\.[^.]+$/, '.jpg');
  }

  async ngOnInit() {
    this.listenUnreadMessages();
    this.listenUnreadNotifications();
    await this.loadContent();
  }

  async loadContent() {
    this.loadError = false;
    this.loading = true;
    this.cdr.detectChanges();
    try {
    await this.blockService.ensureLoaded();
    const snapshot = await getDocs(collection(db, 'videos'));
    this.allVideos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Batch fetch all user profiles
    const userIds = [...new Set(this.allVideos.map(v => v.userId).filter(Boolean))];
    const userMap = new Map<string, { displayName: string; avatarUrl: string }>();
    await Promise.all(userIds.map(async (uid) => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        userMap.set(uid, { displayName: data['username'] || 'Unknown', avatarUrl: data['photoURL'] || '' });
      }
    }));

    // Build video cards
    this.allVideoCards = this.allVideos
      .filter(v => v.cloudinaryUrl && v.location?.country)
      .map(v => ({
        id: v.id,
        cloudinaryUrl: v.cloudinaryUrl,
        country: v.location?.country || '',
        city: v.location?.city || '',
        createdAt: v.createdAt,
        userId: v.userId,
        userName: userMap.get(v.userId)?.displayName || 'Unknown',
        userAvatar: userMap.get(v.userId)?.avatarUrl || '',
        title: v.title || '',
        liked: false,
        bookmarked: false,
        likeCount: v.likeCount || 0,
        commentCount: v.commentCount || 0,
        viewCount: v.viewCount || 0,
        _type: 'video' as const,
      }));

    // Load image posts
    const postSnap = await getDocs(collection(db, 'posts'));
    const allPosts = postSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const postUserIds = [...new Set(allPosts.map((p: any) => p.userId).filter(Boolean))] as string[];
    await Promise.all(postUserIds.filter(uid => !userMap.has(uid)).map(async (uid) => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        userMap.set(uid, { displayName: data['username'] || 'Unknown', avatarUrl: data['photoURL'] || '' });
      }
    }));
    const postCards: VideoCard[] = allPosts
      .filter((p: any) => p.images?.length && p.location?.country)
      .map((p: any) => ({
        id: p.id,
        cloudinaryUrl: '',
        country: p.location?.country || '',
        city: p.location?.city || '',
        createdAt: p.createdAt,
        userId: p.userId,
        userName: userMap.get(p.userId)?.displayName || 'Unknown',
        userAvatar: userMap.get(p.userId)?.avatarUrl || '',
        title: p.title || '',
        liked: false,
        bookmarked: false,
        likeCount: p.likeCount || 0,
        commentCount: p.commentCount || 0,
        viewCount: 0,
        _type: 'post' as const,
        images: p.images,
        thumbnailUrl: p.thumbnailUrl,
        imageIndex: 0,
      }));
    this.allVideoCards = [...this.allVideoCards, ...postCards]
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      });

    // Load user-specific data
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      await Promise.all(this.allVideoCards.map(async (card) => {
        const collName = card._type === 'post' ? 'posts' : 'videos';
        const likeDoc2 = await getDoc(doc(db, collName, card.id, 'likes', currentUid));
        card.liked = likeDoc2.exists();
        if (card._type === 'video') {
          const bookmarkDoc = await getDoc(doc(db, 'users', currentUid, 'bookmarks', card.id));
          card.bookmarked = bookmarkDoc.exists();
        }
      }));

      const followingSnap = await getDocs(collection(db, 'users', currentUid, 'following'));
      this.followedUids = new Set(followingSnap.docs.map(d => d.id));

      const favSnap = await getDocs(collection(db, 'users', currentUid, 'favouriteCountries'));
      this.favouriteCountries = new Set(favSnap.docs.map(d => d.id));
    }

    this.updateDisplayedVideos();
    this.loading = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.initMiniMap();
      this.setupFollowingObserver();
    }, 50);
    } catch {
      this.loadError = true;
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.miniMap) {
      this.miniMap.remove();
      this.miniMap = null;
    }
    this.followingObserver?.disconnect();
    clearTimeout(this.pressTimer);
    clearTimeout(this.tapTimer);
    this.unsubMessages?.();
    this.unsubNotifications?.();
  }

  private listenUnreadMessages() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const mq = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    this.unsubMessages = onSnapshot(mq, (snapshot) => {
      let total = 0;
      snapshot.docs.forEach(d => {
        total += d.data()['unreadCount_' + uid] || 0;
      });
      this.unreadMessages = total;
      this.cdr.detectChanges();
    });
  }

  private listenUnreadNotifications() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const nq = query(
      collection(db, 'users', uid, 'notifications'),
      where('read', '==', false)
    );
    this.unsubNotifications = onSnapshot(nq, (snapshot) => {
      this.unreadNotifications = snapshot.size;
      this.cdr.detectChanges();
    });
  }

  /** Small non-interactive map preview with destination dots */
  private initMiniMap() {
    const el = this.mapContainer()?.nativeElement;
    if (!el || this.miniMap) return;

    this.miniMap = L.map(el, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 2,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
    }).addTo(this.miniMap);

    // Build country counts from allVideos for map dots
    const countryCounts = new Map<string, number>();
    for (const v of this.allVideos) {
      const country = v.location?.country;
      if (country) countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
    }

    for (const [country, count] of countryCounts) {
      const coords = COUNTRY_COORDS[country];
      if (!coords) continue;

      const size = Math.min(8 + count * 2, 18);
      const icon = L.divIcon({
        className: 'map-marker',
        html: `<div class="marker-dot" style="width:${size}px;height:${size}px;"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      L.marker(coords, { icon, interactive: false }).addTo(this.miniMap);
    }
  }

  selectTab(tab: string) {
    this.activeTab = tab;
    this.updateDisplayedVideos();
    this.cdr.detectChanges();
    setTimeout(() => this.setupFollowingObserver(), 100);
  }

  private updateDisplayedVideos() {
    let videos = this.allVideoCards.filter(v => !this.blockService.isBlocked(v.userId));

    switch (this.activeTab) {
      case 'Following':
        videos = videos.filter(v => this.followedUids.has(v.userId));
        break;
      case 'Trending':
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        videos = [...videos]
          .filter(v => {
            const t = v.createdAt?.toMillis?.() || v.createdAt?.seconds * 1000 || (typeof v.createdAt === 'string' ? new Date(v.createdAt).getTime() : 0);
            return t >= thirtyDaysAgo;
          })
          .sort((a, b) => (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount));
        break;
      case 'Favourited':
        videos = videos.filter(v => this.favouriteCountries.has(v.country));
        break;
      case 'All':
        break;
      default:
        videos = videos.filter(v => REGION_MAP[v.country] === this.activeTab);
        break;
    }

    this.displayedVideos = videos.slice(0, 30);
  }

  get tabIcon(): string {
    switch (this.activeTab) {
      case 'Following': return 'people';
      case 'Trending': return 'local_fire_department';
      case 'Favourited': return 'star';
      default: return 'explore';
    }
  }

  get tabTitle(): string {
    switch (this.activeTab) {
      case 'Following': return 'From creators you follow';
      case 'Trending': return 'Trending now';
      case 'Favourited': return 'From your favourite countries';
      case 'All': return 'All posts';
      default: return this.activeTab;
    }
  }

  get tabEmptyMessage(): string {
    switch (this.activeTab) {
      case 'Following': return 'Follow creators to see their posts here';
      case 'Favourited': return 'Star countries on the globe to see posts here';
      default: return 'No posts found';
    }
  }

  openGlobe() {
    this.router.navigate(['/globe']);
  }

  private setupFollowingObserver() {
    this.followingObserver?.disconnect();
    const visibilityMap = new Map<HTMLVideoElement, number>();

    this.followingObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement;
        visibilityMap.set(video, entry.intersectionRatio);
        if (!entry.isIntersecting) {
          visibilityMap.delete(video);
          if (video === this.userPausedVideo) {
            this.userPausedVideo = null;
            this.isPaused = false;
            this.showPauseIndicator = false;
          }
        }
      });

      // Find the most visible video and only play that one
      let bestVideo: HTMLVideoElement | null = null;
      let bestRatio = 0;
      visibilityMap.forEach((ratio, video) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestVideo = video;
        }
      });

      this.followingVideoElements().forEach(el => {
        const vid = el.nativeElement as HTMLVideoElement;
        if (vid === bestVideo && vid !== this.userPausedVideo) {
          vid.play().catch(() => {});
        } else {
          if (vid !== this.userPausedVideo) {
            vid.pause();
          }
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    requestAnimationFrame(() => {
      this.followingVideoElements().forEach(el => {
        this.followingObserver!.observe(el.nativeElement);
      });
    });
  }

  activeVideoEl: HTMLVideoElement | null = null;

  togglePlayback(event: Event, video: VideoCard) {
    const targetEl = (event.currentTarget as HTMLElement).querySelector('video') as HTMLVideoElement;
    if (!targetEl) return;

    // Double-tap detection
    if (this.pendingTap) {
      clearTimeout(this.tapTimer);
      this.pendingTap = false;
      // Double tap = like
      if (!video.liked) {
        this.toggleFollowingLike(video);
      }
      video.showHeart = true;
      this.cdr.detectChanges();
      setTimeout(() => { video.showHeart = false; this.cdr.detectChanges(); }, 800);
      return;
    }
    this.pendingTap = true;
    this.activeVideoEl = targetEl;
    this.tapTimer = setTimeout(() => {
      this.pendingTap = false;
      const vid = this.activeVideoEl;
      if (!vid) return;
      if (vid.paused) {
        vid.play();
        this.isPaused = false;
        this.userPausedVideo = null;
        this.pausedVideoCard = null;
      } else {
        vid.pause();
        this.isPaused = true;
        this.userPausedVideo = vid;
        this.pausedVideoCard = video;
      }
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
    }, 300);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
  }

  openProfile(userId: string) {
    this.router.navigate(['/profile', userId]);
  }

  getDateString(createdAt: any): string {
    const ms = createdAt?.toMillis?.() || createdAt?.seconds * 1000 || 0;
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async toggleFollowingLike(video: VideoCard) {
    const collName = video._type === 'post' ? 'posts' : 'videos';
    const result = await this.interaction.toggleLike(collName as 'videos' | 'posts', video.id, video.userId, video.title || '', video.liked);
    video.liked = result.liked;
    video.likeCount += result.delta;
    this.cdr.detectChanges();
  }

  async toggleFollowingBookmark(video: VideoCard) {
    if (video.bookmarked) {
      video.bookmarked = await this.interaction.toggleBookmark(video.id, true, {});
      this.cdr.detectChanges();
      return;
    }
    this.pendingBookmarkVideo = video as any;
    this.tripPickerTrips = await this.tripService.getTrips(this.authService.currentUser()!.uid);
    this.showTripPicker = true;
    this.cdr.detectChanges();
  }

  // Trip picker
  showTripPicker = false;
  tripPickerTrips: Trip[] = [];
  private pendingBookmarkVideo: any = null;

  async onTripSelected(tripId: string) {
    const video = this.pendingBookmarkVideo;
    if (!video) return;
    const bookmarkData: any = {
      country: video.country, city: video.city,
      title: video.title || '', _type: video._type, tripId,
    };
    if (video._type === 'post') {
      bookmarkData.images = video.images;
      bookmarkData.thumbnailUrl = video.thumbnailUrl || video.images?.[0]?.url || '';
    } else {
      bookmarkData.cloudinaryUrl = video.cloudinaryUrl;
    }
    video.bookmarked = await this.interaction.toggleBookmark(video.id, false, bookmarkData);
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
    this.cdr.detectChanges();
  }

  onTripCreated(trip: Trip) {
    this.tripPickerTrips = [trip, ...this.tripPickerTrips];
  }

  closeTripPicker() {
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
  }

  // ── Image carousel helpers ──

  getImageUrls(video: VideoCard): string[] {
    return video.images?.map(img => img.url) || [];
  }

  openLightbox(video: VideoCard) {
    this.lightboxPost = video;
    this.lightboxIndex = video.imageIndex || 0;
    this.cdr.detectChanges();
  }

  closeLightbox() {
    this.lightboxPost = null;
    this.cdr.detectChanges();
  }

  onLightboxSwipeStart(event: TouchEvent) {
    this.lightboxSwipeStartX = event.touches[0].clientX;
    this.lightboxSwipeDelta = 0;
  }

  onLightboxSwipeMove(event: TouchEvent) {
    this.lightboxSwipeDelta = event.touches[0].clientX - this.lightboxSwipeStartX;
  }

  onLightboxSwipeEnd() {
    const threshold = 60;
    const max = (this.lightboxPost?.images?.length || 1) - 1;
    if (this.lightboxSwipeDelta < -threshold && this.lightboxIndex < max) {
      this.lightboxIndex++;
    } else if (this.lightboxSwipeDelta > threshold && this.lightboxIndex > 0) {
      this.lightboxIndex--;
    }
    this.lightboxSwipeDelta = 0;
    this.cdr.detectChanges();
  }

  // Comments
  showComments = false;
  private activeVideo: VideoCard | null = null;

  openComments(video: VideoCard) {
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
  get commentsCollectionType(): 'videos' | 'posts' { return this.activeVideo?._type === 'post' ? 'posts' : 'videos'; }
  get commentsOwnerId(): string { return this.activeVideo?.userId || ''; }
  get commentsTitle(): string { return this.activeVideo?.title || ''; }

  // ── Share ──

  showCopiedToast = false;

  async onShare(video: VideoCard) {
    const copied = await sharePost(video.title);
    if (copied) {
      this.showCopiedToast = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.showCopiedToast = false; this.cdr.detectChanges(); }, 2000);
    }
  }

  // ── Report / Block ──
  showReportPanel = false;
  reportContentId = '';
  reportContentType: 'video' | 'post' = 'video';
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

  openReportVideo(video: VideoCard) {
    this.openReport({ contentId: video.id, contentType: video._type, contentOwnerId: video.userId });
  }

  closeReport() {
    this.showReportPanel = false;
  }

  confirmBlock(userId: string) {
    const v = this.allVideoCards.find(c => c.userId === userId);
    this.blockTargetId = userId;
    this.blockTargetName = v?.userName || 'this user';
    this.showBlockConfirm = true;
    this.cdr.detectChanges();
  }

  async doBlock() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.blockTargetId) return;
    const { setDoc, doc: fbDoc } = await import('firebase/firestore');
    await setDoc(fbDoc(db, 'users', uid, 'blockedUsers', this.blockTargetId), { blockedAt: new Date().toISOString() });
    this.blockService.addBlock(this.blockTargetId);
    this.allVideoCards = this.allVideoCards.filter(v => v.userId !== this.blockTargetId);
    this.updateDisplayedVideos();
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
      this.allVideoCards = this.allVideoCards.filter(v => v.id !== video.id);
      this.updateDisplayedVideos();
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
}
