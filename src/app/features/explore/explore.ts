import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef, ElementRef, viewChild, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, increment, addDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { COUNTRY_COORDS, REGION_MAP } from '../../shared/data/geo';
import { formatCount } from '../../shared/utils/format';

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
  _type: 'video' | 'post';
  images?: { url: string; publicId: string }[];
  thumbnailUrl?: string;
  imageIndex?: number;
}

@Component({
  selector: 'app-explore',
  imports: [FormsModule, RouterLink],
  templateUrl: './explore.html',
  styleUrl: './explore.scss',
})
export class Explore implements OnInit, AfterViewInit, OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  authService = inject(AuthService);
  mapContainer = viewChild<ElementRef>('mapContainer');

  allVideoCards: VideoCard[] = [];
  displayedVideos: VideoCard[] = [];
  followedUids = new Set<string>();
  favouriteCountries = new Set<string>();
  searchQuery = '';
  searchUsers: any[] = [];
  private cachedUsers: any[] | null = null;
  private searchDebounce: any = null;
  loading = true;
  showCreateMenu = false;
  formatCount = formatCount;
  isMuted = true;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;
  private pressTimer: any = null;
  private tapTimer: any = null;
  private pendingTap = false;
  private userPausedVideo: HTMLVideoElement | null = null;

  // Image carousel swipe
  private carouselSwipeStartX = 0;
  private carouselSwipeDelta = 0;

  // Image tap
  private imageTapPending = false;
  private imageTapTimer: any = null;

  // Lightbox
  lightboxPost: VideoCard | null = null;
  lightboxIndex = 0;
  private lightboxSwipeStartX = 0;
  private lightboxSwipeDelta = 0;

  // Messages
  unreadMessages = 0;
  private unsubMessages: (() => void) | null = null;

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
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.miniMap) {
      this.miniMap.remove();
      this.miniMap = null;
    }
    this.followingObserver?.disconnect();
    this.commentsUnsubscribe?.();
    clearTimeout(this.pressTimer);
    clearTimeout(this.tapTimer);
    this.unsubMessages?.();
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

  onSearch() {
    this.updateDisplayedVideos();

    clearTimeout(this.searchDebounce);
    const q = this.searchQuery.trim().toLowerCase();
    if (q.length < 2) {
      this.searchUsers = [];
      this.cdr.detectChanges();
      return;
    }

    this.searchDebounce = setTimeout(async () => {
      if (!this.cachedUsers) {
        const snapshot = await getDocs(collection(db, 'users'));
        this.cachedUsers = snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
      }
      const query = this.searchQuery.trim().toLowerCase();
      this.searchUsers = this.cachedUsers
        .filter((u: any) => u.username?.toLowerCase().includes(query))
        .slice(0, 5);
      this.cdr.detectChanges();
    }, 300);
  }

  goToProfile(uid: string) {
    this.searchQuery = '';
    this.searchUsers = [];
    this.updateDisplayedVideos();
    this.router.navigate(['/profile', uid]);
  }

  private updateDisplayedVideos() {
    let videos = this.allVideoCards;

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

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      videos = videos.filter(v =>
        v.country.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        v.userName.toLowerCase().includes(q) ||
        (v.title || '').toLowerCase().includes(q)
      );
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

  getTimeAgo(createdAt: any): string {
    const ms = createdAt?.toMillis?.() || createdAt?.seconds * 1000 || 0;
    if (!ms) return '';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
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
      } else {
        vid.pause();
        this.isPaused = true;
        this.userPausedVideo = vid;
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
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const collName = video._type === 'post' ? 'posts' : 'videos';
    const likeRef = doc(db, collName, video.id, 'likes', userId);
    const itemRef = doc(db, collName, video.id);

    if (video.liked) {
      video.liked = false;
      video.likeCount--;
      await deleteDoc(likeRef);
      await updateDoc(itemRef, { likeCount: increment(-1) });
    } else {
      video.liked = true;
      video.likeCount++;
      await setDoc(likeRef, { userId, createdAt: new Date().toISOString() });
      await updateDoc(itemRef, { likeCount: increment(1) });

      if (video.userId !== userId) {
        const currentUserRef = doc(db, 'users', userId);
        const currentUserDoc = await getDoc(currentUserRef);
        const fromUsername = currentUserDoc.exists() ? currentUserDoc.data()['username'] : '';
        const fromPhotoURL = currentUserDoc.exists() ? currentUserDoc.data()['photoURL'] || '' : '';
        await addDoc(collection(db, 'users', video.userId, 'notifications'), {
          type: 'like', fromUserId: userId, fromUsername, fromPhotoURL,
          videoId: video.id, videoTitle: video.title,
          createdAt: new Date().toISOString(), read: false,
        });
      }
    }
    this.cdr.detectChanges();
  }

  async toggleFollowingBookmark(video: VideoCard) {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const bookmarkRef = doc(db, 'users', userId, 'bookmarks', video.id);

    if (video.bookmarked) {
      video.bookmarked = false;
      await deleteDoc(bookmarkRef);
    } else {
      video.bookmarked = true;
      const bookmarkData: any = {
        videoId: video.id, country: video.country, city: video.city,
        title: video.title || '', _type: video._type,
        createdAt: new Date().toISOString(),
      };
      if (video._type === 'post') {
        bookmarkData.images = video.images;
        bookmarkData.thumbnailUrl = video.thumbnailUrl || video.images?.[0]?.url || '';
      } else {
        bookmarkData.cloudinaryUrl = video.cloudinaryUrl;
      }
      await setDoc(bookmarkRef, bookmarkData);
    }
    this.cdr.detectChanges();
  }

  // ── Image carousel swipe ──

  onCarouselSwipeStart(event: TouchEvent, video: VideoCard) {
    if ((video.images?.length || 0) < 2) return;
    this.carouselSwipeStartX = event.touches[0].clientX;
    this.carouselSwipeDelta = 0;
  }

  onCarouselSwipeMove(event: TouchEvent) {
    this.carouselSwipeDelta = event.touches[0].clientX - this.carouselSwipeStartX;
  }

  onCarouselSwipeEnd(video: VideoCard) {
    const threshold = 60;
    const idx = video.imageIndex || 0;
    const max = (video.images?.length || 1) - 1;
    if (this.carouselSwipeDelta < -threshold && idx < max) {
      video.imageIndex = idx + 1;
    } else if (this.carouselSwipeDelta > threshold && idx > 0) {
      video.imageIndex = idx - 1;
    }
    this.carouselSwipeDelta = 0;
    this.cdr.detectChanges();
  }

  onImageTap(video: VideoCard) {
    if (Math.abs(this.carouselSwipeDelta) > 10) return; // was a swipe, not a tap
    if (this.imageTapPending) {
      clearTimeout(this.imageTapTimer);
      this.imageTapPending = false;
      // Double tap = like
      if (!video.liked) {
        this.toggleFollowingLike(video);
      }
      video.showHeart = true;
      this.cdr.detectChanges();
      setTimeout(() => { video.showHeart = false; this.cdr.detectChanges(); }, 800);
      return;
    }
    this.imageTapPending = true;
    this.imageTapTimer = setTimeout(() => {
      this.imageTapPending = false;
      // Single tap = open lightbox
      this.openLightbox(video);
    }, 250);
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
  comments: any[] = [];
  newComment = '';
  posting = false;
  replyingTo: any = null;
  private activeVideoId = '';
  private commentsUnsubscribe: (() => void) | null = null;

  openComments(video: VideoCard) {
    this.activeVideoId = video.id;
    this.showComments = true;
    this.comments = [];
    this.replyingTo = null;

    const userId = auth.currentUser?.uid;
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
    const userId = auth.currentUser?.uid;
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
    const userId = auth.currentUser?.uid;
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

    const commentData: any = {
      userId, username, photoURL, text,
      createdAt: new Date().toISOString(),
      likeCount: 0,
    };
    if (parentId) commentData.parentId = parentId;
    await addDoc(collection(db, 'videos', this.activeVideoId, 'comments'), commentData);

    await updateDoc(doc(db, 'videos', this.activeVideoId), { commentCount: increment(1) });

    const video = this.allVideoCards.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount++;

    if (parentId) {
      const parent = this.comments.find(c => c.id === parentId);
      if (parent) parent.showReplies = true;
    }

    if (video && video.userId !== userId) {
      await addDoc(collection(db, 'users', video.userId, 'notifications'), {
        type: 'comment', fromUserId: userId, fromUsername: username, fromPhotoURL: photoURL,
        videoId: video.id, videoTitle: video.title,
        createdAt: new Date().toISOString(), read: false,
      });
    }

    this.posting = false;
    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const userId = auth.currentUser?.uid;
    if (comment.userId !== userId) return;

    await deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', comment.id));

    if (!comment.parentId && comment.replies?.length) {
      await Promise.all(comment.replies.map((r: any) =>
        deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', r.id))
      ));
    }

    const deleteCount = comment.parentId ? 1 : 1 + (comment.replies?.length || 0);
    await updateDoc(doc(db, 'videos', this.activeVideoId), { commentCount: increment(-deleteCount) });

    const video = this.allVideoCards.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount -= deleteCount;

    this.cdr.detectChanges();
  }
}
