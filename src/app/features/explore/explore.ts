import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef, ElementRef, viewChild, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, increment, addDoc, onSnapshot, orderBy, query } from 'firebase/firestore';
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
  loading = true;
  formatCount = formatCount;

  tabs = ['Following', 'Trending', 'Favourited', 'All', 'Asia', 'Europe', 'Americas', 'Africa', 'Middle East', 'Oceania'];
  activeTab = 'Following';

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
      }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });

    // Load user-specific data
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      await Promise.all(this.allVideoCards.map(async (video) => {
        const [likeDoc, bookmarkDoc] = await Promise.all([
          getDoc(doc(db, 'videos', video.id, 'likes', currentUid)),
          getDoc(doc(db, 'users', currentUid, 'bookmarks', video.id)),
        ]);
        video.liked = likeDoc.exists();
        video.bookmarked = bookmarkDoc.exists();
      }));

      const followingSnap = await getDocs(collection(db, 'users', currentUid, 'following'));
      this.followedUids = new Set(followingSnap.docs.map(d => d.id));

      const favSnap = await getDocs(collection(db, 'users', currentUid, 'favouriteCountries'));
      this.favouriteCountries = new Set(favSnap.docs.map(d => d.id));
    }

    this.updateDisplayedVideos();
    this.loading = false;
    this.cdr.detectChanges();

    setTimeout(() => this.initMiniMap(), 50);
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.miniMap) {
      this.miniMap.remove();
      this.miniMap = null;
    }
    this.followingObserver?.disconnect();
    this.commentsUnsubscribe?.();
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
    this.cdr.detectChanges();
  }

  private updateDisplayedVideos() {
    let videos = this.allVideoCards;

    switch (this.activeTab) {
      case 'Following':
        videos = videos.filter(v => this.followedUids.has(v.userId));
        break;
      case 'Trending':
        videos = [...videos].sort((a, b) => (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount));
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
      case 'All': return 'All videos';
      default: return this.activeTab;
    }
  }

  get tabEmptyMessage(): string {
    switch (this.activeTab) {
      case 'Following': return 'Follow creators to see their videos here';
      case 'Favourited': return 'Star countries on the globe to see videos here';
      default: return 'No videos found';
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
        if (vid === bestVideo) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    requestAnimationFrame(() => {
      this.followingVideoElements().forEach(el => {
        this.followingObserver!.observe(el.nativeElement);
      });
    });
  }

  togglePlayback(event: Event) {
    const video = (event.currentTarget as HTMLElement).querySelector('video');
    if (!video) return;
    video.paused ? video.play() : video.pause();
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
      await setDoc(bookmarkRef, {
        videoId: video.id, country: video.country, city: video.city,
        cloudinaryUrl: video.cloudinaryUrl, title: video.title || '',
        createdAt: new Date().toISOString(),
      });
    }
    this.cdr.detectChanges();
  }

  // Comments
  showComments = false;
  comments: any[] = [];
  newComment = '';
  posting = false;
  private activeVideoId = '';
  private commentsUnsubscribe: (() => void) | null = null;

  openComments(video: VideoCard) {
    this.activeVideoId = video.id;
    this.showComments = true;
    this.comments = [];

    const commentsRef = collection(db, 'videos', video.id, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    this.commentsUnsubscribe = onSnapshot(q, async (snapshot) => {
      this.comments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const needPhoto = this.comments.filter(c => !c.photoURL);
      if (needPhoto.length > 0) {
        await Promise.all(needPhoto.map(async (comment) => {
          const uDoc = await getDoc(doc(db, 'users', comment.userId));
          comment.photoURL = uDoc.exists() ? uDoc.data()['photoURL'] || '' : '';
        }));
      }
      this.cdr.detectChanges();
    });
  }

  closeComments() {
    this.showComments = false;
    this.commentsUnsubscribe?.();
    this.commentsUnsubscribe = null;
  }

  async postComment() {
    if (!this.newComment.trim() || this.posting) return;
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    this.posting = true;
    const text = this.newComment.trim();
    this.newComment = '';
    this.cdr.detectChanges();

    const userDoc = await getDoc(doc(db, 'users', userId));
    const username = userDoc.exists() ? userDoc.data()['username'] : 'Anonymous';
    const photoURL = userDoc.exists() ? userDoc.data()['photoURL'] || '' : '';

    await addDoc(collection(db, 'videos', this.activeVideoId, 'comments'), {
      userId, username, photoURL,
      text,
      createdAt: new Date().toISOString(),
    });

    await updateDoc(doc(db, 'videos', this.activeVideoId), { commentCount: increment(1) });

    const video = this.allVideoCards.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount++;

    if (video && video.userId !== userId) {
      await addDoc(collection(db, 'users', video.userId, 'notifications'), {
        type: 'comment', fromUserId: userId, fromUsername: username, fromPhotoURL: photoURL,
        videoId: video.id, videoTitle: video.title,
        createdAt: new Date().toISOString(), read: false,
      });
    }

    this.newComment = '';
    this.posting = false;
    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const userId = auth.currentUser?.uid;
    if (comment.userId !== userId) return;
    await deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', comment.id));
    await updateDoc(doc(db, 'videos', this.activeVideoId), { commentCount: increment(-1) });
    const video = this.allVideoCards.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount--;
    this.cdr.detectChanges();
  }
}
