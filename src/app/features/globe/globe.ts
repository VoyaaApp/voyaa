import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, ChangeDetectionStrategy, ElementRef, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { COUNTRY_COORDS, REGION_MAP, REGION_BOUNDS } from '../../shared/data/geo';
import { formatCount, getThumbUrl } from '../../shared/utils/format';

declare const L: any;

interface Destination {
  country: string;
  postCount: number;
  cities: { name: string; count: number }[];
  thumbnail: string;
  thumbnailType: 'video' | 'image';
}

interface CityMarker {
  country: string;
  city: string;
  lat: number;
  lon: number;
  postCount: number;
  thumbnail: string;
  thumbnailType: 'video' | 'image';
}

interface CountryMarker {
  country: string;
  lat: number;
  lon: number;
  postCount: number;
  thumbnail: string;
  thumbnailType: 'video' | 'image';
}

@Component({
  selector: 'app-globe',
  imports: [FormsModule],
  templateUrl: './globe.html',
  styleUrl: './globe.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Globe implements OnInit, OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  mapContainer = viewChild<ElementRef>('mapContainer');

  destinations: Destination[] = [];
  filteredDestinations: Destination[] = [];
  cityMarkers: CityMarker[] = [];
  countryMarkers: CountryMarker[] = [];
  searchQuery = '';
  formatCount = formatCount;

  regions = ['All', 'Asia', 'Europe', 'Americas', 'Africa', 'Middle East', 'Oceania'];
  activeRegion = 'All';

  selectedDestination: Destination | null = null;
  selectedCity: CityMarker | null = null;
  isFavourited = false;

  private map: any = null;
  private markers: { marker: any; country: string; city: string; type: 'city' | 'country' }[] = [];

  private static cache: { destinations: Destination[]; cityMarkers: CityMarker[]; countryMarkers: CountryMarker[] } | null = null;

  getThumbUrl = getThumbUrl;

  getThumbnail(item: { thumbnail: string; thumbnailType: 'video' | 'image' }): string {
    if (!item.thumbnail) return '';
    return item.thumbnailType === 'video' ? this.getThumbUrl(item.thumbnail) : item.thumbnail;
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
    // Use cached data if available (repeat visits are instant)
    if (Globe.cache) {
      this.destinations = Globe.cache.destinations;
      this.cityMarkers = Globe.cache.cityMarkers;
      this.countryMarkers = Globe.cache.countryMarkers;
      this.filteredDestinations = this.destinations;
      this.cdr.detectChanges();
      setTimeout(() => this.initMap(), 50);
      return;
    }

    const [videoSnap, postSnap] = await Promise.all([
      getDocs(collection(db, 'videos')),
      getDocs(collection(db, 'posts')),
    ]);
    const allItems: any[] = [
      ...videoSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'video' })),
      ...postSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'post' })),
    ];

    const countryMap = new Map<string, { items: any[]; cities: Map<string, number> }>();
    const cityMap = new Map<string, { country: string; city: string; lat: number; lon: number; items: any[] }>();

    for (const item of allItems) {
      const country = item.location?.country;
      const city = item.location?.city;
      if (!country) continue;

      // Country-level grouping
      if (!countryMap.has(country)) {
        countryMap.set(country, { items: [], cities: new Map() });
      }
      const entry = countryMap.get(country)!;
      entry.items.push(item);
      if (city) {
        entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
      }

      // City-level grouping (only items with a city)
      if (city) {
        const cityKey = `${country}|${city}`;
        if (!cityMap.has(cityKey)) {
          const loc = item.location;
          const hasCoords = loc?.lat && loc?.lon;
          cityMap.set(cityKey, { country, city, lat: hasCoords ? loc.lat : 0, lon: hasCoords ? loc.lon : 0, items: [] });
        }
        cityMap.get(cityKey)!.items.push(item);
      }
    }

    const pickThumb = (items: any[]) => {
      const first = items[0];
      if (!first) return { thumbnail: '', thumbnailType: 'image' as const };
      if (first._type === 'video') return { thumbnail: first.cloudinaryUrl || '', thumbnailType: 'video' as const };
      return { thumbnail: first.thumbnailUrl || first.images?.[0]?.url || '', thumbnailType: 'image' as const };
    };

    this.destinations = Array.from(countryMap.entries())
      .map(([country, data]) => ({
        country,
        postCount: data.items.length,
        cities: Array.from(data.cities.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        ...pickThumb(data.items),
      }))
      .sort((a, b) => b.postCount - a.postCount);

    this.cityMarkers = Array.from(cityMap.values())
      .map(data => ({
        country: data.country,
        city: data.city,
        lat: data.lat,
        lon: data.lon,
        postCount: data.items.length,
        ...pickThumb(data.items),
      }))
      .sort((a, b) => b.postCount - a.postCount);

    // Country markers — use country centroid coords
    this.countryMarkers = this.destinations.map(d => {
      const coords = COUNTRY_COORDS[d.country];
      return {
        country: d.country,
        lat: coords ? coords[0] : 0,
        lon: coords ? coords[1] : 0,
        postCount: d.postCount,
        thumbnail: d.thumbnail,
        thumbnailType: d.thumbnailType,
      };
    });

    // Geocode cities that lack stored coordinates (parallel)
    const toGeocode = this.cityMarkers.filter(cm => !cm.lat && !cm.lon);
    await Promise.all(toGeocode.map(async (cm) => {
      const coords = await this.geocodeCity(cm.city, cm.country);
      if (coords) {
        cm.lat = coords[0];
        cm.lon = coords[1];
      } else {
        const fallback = COUNTRY_COORDS[cm.country];
        if (fallback) {
          cm.lat = fallback[0];
          cm.lon = fallback[1];
        }
      }
    }));

    this.filteredDestinations = this.destinations;

    // Cache for repeat visits
    Globe.cache = {
      destinations: this.destinations,
      cityMarkers: this.cityMarkers,
      countryMarkers: this.countryMarkers,
    };

    this.cdr.detectChanges();

    setTimeout(() => this.initMap(), 50);
  }


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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
    }).addTo(this.map);

    this.map.on('click', () => this.closePreview());

    // City markers (teal)
    for (const cm of this.cityMarkers) {
      if (!cm.lat && !cm.lon) continue;

      const size = Math.min(10 + cm.postCount * 5, 28);
      const icon = L.divIcon({
        className: 'map-marker',
        html: `<div class="marker-wrapper">
                 <div class="marker-dot city" style="width:${size}px;height:${size}px;">
                   <span class="marker-count">${cm.postCount}</span>
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
      this.markers.push({ marker, country: cm.country, city: cm.city, type: 'city' });
    }

    // Country markers (green)
    for (const cm of this.countryMarkers) {
      if (!cm.lat && !cm.lon) continue;

      const size = Math.min(14 + cm.postCount * 4, 32);
      const icon = L.divIcon({
        className: 'map-marker',
        html: `<div class="marker-wrapper">
                 <div class="marker-dot country" style="width:${size}px;height:${size}px;">
                   <span class="marker-count">${cm.postCount}</span>
                 </div>
                 <span class="marker-label">${cm.country}</span>
               </div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([cm.lat, cm.lon], { icon }).addTo(this.map);
      marker.on('click', (e: any) => {
        e.originalEvent?.stopPropagation();
        this.selectCountryMarker(cm);
      });
      this.markers.push({ marker, country: cm.country, city: '', type: 'country' });
    }
  }

  selectCountryMarker(cm: CountryMarker) {
    // Find the matching destination for the preview card
    const dest = this.destinations.find(d => d.country === cm.country);
    if (dest) {
      this.selectedDestination = dest;
      this.selectedCity = null;
      this.checkFavouriteStatus(cm.country);
      this.cdr.detectChanges();
      if (this.map) {
        this.map.flyTo([cm.lat, cm.lon], 4, { duration: 1 });
      }
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
    const country = this.selectedDestination?.country || this.selectedCity?.country;
    if (!uid || !country) return;
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
    if (this.selectedCity) {
      this.router.navigate(['/destination', this.selectedCity.country, this.selectedCity.city]);
    } else if (this.selectedDestination) {
      this.router.navigate(['/destination', this.selectedDestination.country]);
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
