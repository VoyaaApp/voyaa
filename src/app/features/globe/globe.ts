import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef, ElementRef, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { COUNTRY_COORDS, REGION_MAP, REGION_BOUNDS } from '../../shared/data/geo';
import { formatCount } from '../../shared/utils/format';

declare const L: any;

interface Destination {
  country: string;
  videoCount: number;
  cities: { name: string; count: number }[];
  thumbnail: string;
}

interface CityMarker {
  country: string;
  city: string;
  lat: number;
  lon: number;
  videoCount: number;
  thumbnail: string;
}

@Component({
  selector: 'app-globe',
  imports: [FormsModule],
  templateUrl: './globe.html',
  styleUrl: './globe.scss',
})
export class Globe implements OnInit, AfterViewInit, OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  mapContainer = viewChild<ElementRef>('mapContainer');

  destinations: Destination[] = [];
  filteredDestinations: Destination[] = [];
  cityMarkers: CityMarker[] = [];
  searchQuery = '';
  formatCount = formatCount;

  regions = ['All', 'Asia', 'Europe', 'Americas', 'Africa', 'Middle East', 'Oceania'];
  activeRegion = 'All';

  selectedDestination: Destination | null = null;
  selectedCity: CityMarker | null = null;
  isFavourited = false;

  private map: any = null;
  private markers: { marker: any; country: string; city: string }[] = [];

  getThumbUrl(url: string): string {
    if (!url) return '';
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
      .replace(/\.[^.]+$/, '.jpg');
  }

  private async geocodeCity(city: string, country: string): Promise<[number, number] | null> {
    try {
      const params = new URLSearchParams({
        q: `${city}, ${country}`,
        format: 'json',
        limit: '1',
        'accept-language': 'en',
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'Voyaa/1.0' },
      });
      const results = await res.json();
      if (results.length > 0) {
        return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
      }
    } catch {}
    return null;
  }

  async ngOnInit() {
    const snapshot = await getDocs(collection(db, 'videos'));
    const allVideos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const countryMap = new Map<string, { videos: any[]; cities: Map<string, number> }>();
    const cityMap = new Map<string, { country: string; city: string; lat: number; lon: number; videos: any[] }>();

    for (const video of allVideos) {
      const country = (video as any).location?.country;
      const city = (video as any).location?.city;
      if (!country) continue;

      // Country-level grouping (for sidebar)
      if (!countryMap.has(country)) {
        countryMap.set(country, { videos: [], cities: new Map() });
      }
      const entry = countryMap.get(country)!;
      entry.videos.push(video);
      if (city) {
        entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
      }

      // City-level grouping (for markers)
      const cityKey = `${country}|${city || 'Unknown'}`;
      if (!cityMap.has(cityKey)) {
        const loc = (video as any).location;
        const hasCoords = loc?.lat && loc?.lon;
        const lat = hasCoords ? loc.lat : 0;
        const lon = hasCoords ? loc.lon : 0;
        cityMap.set(cityKey, { country, city: city || 'Unknown', lat, lon, videos: [] });
      }
      cityMap.get(cityKey)!.videos.push(video);
    }

    this.destinations = Array.from(countryMap.entries())
      .map(([country, data]) => ({
        country,
        videoCount: data.videos.length,
        cities: Array.from(data.cities.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        thumbnail: data.videos[0]?.cloudinaryUrl || '',
      }))
      .sort((a, b) => b.videoCount - a.videoCount);

    this.cityMarkers = Array.from(cityMap.values())
      .map(data => ({
        country: data.country,
        city: data.city,
        lat: data.lat,
        lon: data.lon,
        videoCount: data.videos.length,
        thumbnail: data.videos[0]?.cloudinaryUrl || '',
      }))
      .sort((a, b) => b.videoCount - a.videoCount);

    // Geocode cities that lack stored coordinates
    const toGeocode = this.cityMarkers.filter(cm => !cm.lat && !cm.lon && cm.city !== 'Unknown');
    for (const cm of toGeocode) {
      const coords = await this.geocodeCity(cm.city, cm.country);
      if (coords) {
        cm.lat = coords[0];
        cm.lon = coords[1];
      } else {
        // Fallback to country centroid
        const fallback = COUNTRY_COORDS[cm.country];
        if (fallback) {
          cm.lat = fallback[0];
          cm.lon = fallback[1];
        }
      }
    }

    this.filteredDestinations = this.destinations;
    this.cdr.detectChanges();

    setTimeout(() => this.initMap(), 50);
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private initMap() {
    const el = this.mapContainer()?.nativeElement;
    if (!el || this.map) return;

    const worldBounds = L.latLngBounds(L.latLng(-60, -180), L.latLng(85, 180));

    this.map = L.map(el, {
      center: [10, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 14,
      zoomControl: false,
      attributionControl: false,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
    });

    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        if (data.latitude && data.longitude) {
          this.map?.flyTo([data.latitude, data.longitude], 4, { duration: 1.5 });
        }
      })
      .catch(() => {});

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
    }).addTo(this.map);

    this.map.on('click', () => this.closePreview());

    for (const cm of this.cityMarkers) {
      if (!cm.lat && !cm.lon) continue;

      const size = Math.min(10 + cm.videoCount * 5, 28);
      const icon = L.divIcon({
        className: 'map-marker',
        html: `<div class="marker-wrapper">
                 <div class="marker-dot" style="width:${size}px;height:${size}px;">
                   <span class="marker-count">${cm.videoCount}</span>
                 </div>
                 <span class="marker-label">${cm.city}</span>
               </div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([cm.lat, cm.lon], { icon }).addTo(this.map);
      marker.on('click', (e: any) => {
        e.originalEvent?.stopPropagation();
        this.selectCity(cm);
      });
      this.markers.push({ marker, country: cm.country, city: cm.city });
    }
  }

  selectDestination(dest: Destination) {
    this.selectedDestination = dest;
    this.selectedCity = null;
    this.checkFavouriteStatus(dest.country);
    this.cdr.detectChanges();
    const coords = COUNTRY_COORDS[dest.country];
    if (coords && this.map) {
      this.map.flyTo(coords, 4, { duration: 1 });
    }
  }

  selectCity(cm: CityMarker) {
    this.selectedCity = cm;
    this.selectedDestination = null;
    this.checkFavouriteStatus(cm.country);
    this.cdr.detectChanges();
    if (this.map) {
      this.map.flyTo([cm.lat, cm.lon], 6, { duration: 1 });
    }
  }

  private async checkFavouriteStatus(country: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) { this.isFavourited = false; return; }
    const favDoc = await getDoc(doc(db, 'users', uid, 'favouriteCountries', country));
    this.isFavourited = favDoc.exists();
    this.cdr.detectChanges();
  }

  async toggleFavourite() {
    const uid = auth.currentUser?.uid;
    if (!uid || !this.selectedDestination) return;
    const country = this.selectedDestination.country;
    const favRef = doc(db, 'users', uid, 'favouriteCountries', country);
    if (this.isFavourited) {
      await deleteDoc(favRef);
      this.isFavourited = false;
    } else {
      await setDoc(favRef, { country, addedAt: new Date().toISOString() });
      this.isFavourited = true;
    }
    this.cdr.detectChanges();
  }

  closePreview() {
    if (this.selectedDestination || this.selectedCity) {
      this.selectedDestination = null;
      this.selectedCity = null;
      this.cdr.detectChanges();
    }
  }

  exploreDestination() {
    const country = this.selectedCity?.country || this.selectedDestination?.country;
    if (country) {
      this.router.navigate(['/destination', country]);
    }
  }

  filterByRegion(region: string) {
    this.activeRegion = region;
    this.applyFilters();

    if (this.map) {
      if (region === 'All') {
        this.map.flyTo([10, 0], 2, { duration: 1.2 });
      } else {
        const bounds = REGION_BOUNDS[region];
        if (bounds) {
          this.map.flyToBounds(bounds, { duration: 1.2, paddingTopLeft: [0, 150], paddingBottomRight: [0, 0] });
        }
      }
    }
  }

  searchSuggestions: Destination[] = [];
  showSuggestions = false;

  onSearch() {
    const q = this.searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      this.activeRegion = 'All';
      this.searchSuggestions = this.destinations.filter(d =>
        d.country.toLowerCase().includes(q) ||
        d.cities.some(c => c.name.toLowerCase().includes(q))
      ).slice(0, 5);
      this.showSuggestions = this.searchSuggestions.length > 0;
    } else {
      this.searchSuggestions = [];
      this.showSuggestions = false;
    }
    this.applyFilters();
  }

  selectSuggestion(dest: Destination) {
    this.searchQuery = dest.country;
    this.showSuggestions = false;
    this.searchSuggestions = [];
    this.selectDestination(dest);
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
    this.updateMarkerVisibility();
    this.closePreview();
  }

  private updateMarkerVisibility() {
    const visibleCountries = new Set(this.filteredDestinations.map(d => d.country));
    for (const { marker, country } of this.markers) {
      const el = marker.getElement();
      if (!el) continue;
      el.style.opacity = visibleCountries.has(country) ? '1' : '0.15';
      el.style.transition = 'opacity 0.3s';
    }
  }

  goBack() {
    this.router.navigate(['/explore']);
  }
}
