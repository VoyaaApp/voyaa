import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef, ElementRef, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { COUNTRY_COORDS, REGION_MAP } from '../../shared/data/geo';
import { formatCount } from '../../shared/utils/format';

declare const L: any;

interface Destination {
  country: string;
  videoCount: number;
  cities: { name: string; count: number }[];
  thumbnail: string;
  recentCount?: number;
}

interface FollowingVideo {
  id: string;
  cloudinaryUrl: string;
  country: string;
  city: string;
  createdAt: any;
  userId: string;
  userName: string;
  userAvatar: string;
  title?: string;
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
  mapContainer = viewChild<ElementRef>('mapContainer');

  destinations: Destination[] = [];
  filteredDestinations: Destination[] = [];
  trendingDestinations: Destination[] = [];
  followingVideos: FollowingVideo[] = [];
  searchQuery = '';
  loading = true;
  formatCount = formatCount;

  regions = ['All', 'Asia', 'Europe', 'Americas', 'Africa', 'Middle East', 'Oceania'];
  activeRegion = 'All';

  expandedVideoId: string | null = null;

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

    const countryMap = new Map<string, { videos: any[]; cities: Map<string, number> }>();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCountMap = new Map<string, number>();

    for (const video of this.allVideos) {
      const country = video.location?.country;
      const city = video.location?.city;
      if (!country) continue;

      if (!countryMap.has(country)) {
        countryMap.set(country, { videos: [], cities: new Map() });
      }
      const entry = countryMap.get(country)!;
      entry.videos.push(video);
      if (city) {
        entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
      }

      // Track recent uploads for trending
      const createdAt = video.createdAt?.toMillis?.() || video.createdAt?.seconds * 1000 || 0;
      if (createdAt > sevenDaysAgo) {
        recentCountMap.set(country, (recentCountMap.get(country) || 0) + 1);
      }
    }

    this.destinations = Array.from(countryMap.entries())
      .map(([country, data]) => ({
        country,
        videoCount: data.videos.length,
        cities: Array.from(data.cities.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        thumbnail: data.videos[0]?.cloudinaryUrl || '',
        recentCount: recentCountMap.get(country) || 0,
      }))
      .sort((a, b) => b.videoCount - a.videoCount);

    this.filteredDestinations = this.destinations;

    // Trending: destinations with recent uploads, sorted by recent count
    this.trendingDestinations = this.destinations
      .filter(d => (d.recentCount || 0) > 0)
      .sort((a, b) => (b.recentCount || 0) - (a.recentCount || 0))
      .slice(0, 6);

    this.loading = false;
    this.cdr.detectChanges();

    setTimeout(() => this.initMiniMap(), 50);

    // Load following videos in parallel
    this.loadFollowingVideos();
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.miniMap) {
      this.miniMap.remove();
      this.miniMap = null;
    }
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

    // Add simple dots for each destination
    for (const dest of this.destinations) {
      const coords = COUNTRY_COORDS[dest.country];
      if (!coords) continue;

      const size = Math.min(8 + dest.videoCount * 2, 18);
      const icon = L.divIcon({
        className: 'map-marker',
        html: `<div class="marker-dot" style="width:${size}px;height:${size}px;"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      L.marker(coords, { icon, interactive: false }).addTo(this.miniMap);
    }
  }

  filterByRegion(region: string) {
    this.activeRegion = region;
    this.applyFilters();
  }

  onSearch() {
    this.applyFilters();
  }

  private applyFilters() {
    let filtered = this.destinations;

    if (this.activeRegion !== 'All') {
      filtered = filtered.filter(d => REGION_MAP[d.country] === this.activeRegion);
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(d =>
        d.country.toLowerCase().includes(q) ||
        d.cities.some(c => c.name.toLowerCase().includes(q))
      );
    }

    this.filteredDestinations = filtered;
  }

  goToDestination(country: string) {
    this.router.navigate(['/destination', country]);
  }

  openGlobe() {
    this.router.navigate(['/globe']);
  }

  private async loadFollowingVideos() {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    // Get list of followed user IDs
    const followingSnap = await getDocs(collection(db, 'users', currentUid, 'following'));
    const followedUids = followingSnap.docs.map(d => d.id);
    if (followedUids.length === 0) return;

    // Get videos from followed users (already loaded in allVideos)
    const followedVideos = this.allVideos
      .filter(v => followedUids.includes(v.userId))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      })
      .slice(0, 20);

    if (followedVideos.length === 0) return;

    // Batch fetch user profiles
    const userIds = [...new Set(followedVideos.map((v: any) => v.userId))];
    const userMap = new Map<string, { displayName: string; avatarUrl: string }>();
    await Promise.all(
      userIds.map(async (uid) => {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          userMap.set(uid, {
            displayName: data['username'] || 'Unknown',
            avatarUrl: data['photoURL'] || '',
          });
        }
      })
    );

    this.followingVideos = followedVideos.map((v: any) => ({
      id: v.id,
      cloudinaryUrl: v.cloudinaryUrl || '',
      country: v.location?.country || '',
      city: v.location?.city || '',
      createdAt: v.createdAt,
      userId: v.userId,
      userName: userMap.get(v.userId)?.displayName || 'Unknown',
      userAvatar: userMap.get(v.userId)?.avatarUrl || '',
      title: v.title || '',
    }));

    this.cdr.detectChanges();
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

  toggleVideo(videoId: string) {
    this.expandedVideoId = this.expandedVideoId === videoId ? null : videoId;
  }

  togglePlayback(event: Event) {
    const video = (event.currentTarget as HTMLElement).querySelector('video');
    if (!video) return;
    video.paused ? video.play() : video.pause();
  }

  openProfile(userId: string) {
    this.router.navigate(['/profile', userId]);
  }
}
