import { Component, Input, Output, EventEmitter, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject, ElementRef, viewChild } from '@angular/core';
import { COUNTRY_COORDS } from '../../../shared/data/geo';
import { Trip } from '../../../core/services/trip.service';

declare const L: any;

@Component({
  selector: 'app-trip-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="trip-map-overlay">
      <div class="trip-map-header">
        <button class="back-btn" (click)="closed.emit()">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="header-info">
          <h2>{{ trip?.name }}</h2>
          @if (trip?.date) {
            <span class="countdown">{{ getCountdown(trip!.date!) }}</span>
          }
        </div>
        <span class="post-count">{{ bookmarks.length }} {{ bookmarks.length === 1 ? 'pin' : 'pins' }}</span>
      </div>

      <div class="map-container" #mapEl></div>

      @if (selectedPin) {
        <div class="pin-card" (click)="pinClicked.emit(selectedPin)">
          @if (getPinThumb(selectedPin)) {
            <img [src]="getPinThumb(selectedPin)" alt="">
          }
          <div class="pin-card-info">
            <span class="pin-title">{{ selectedPin.title || 'Saved post' }}</span>
            <span class="pin-location">{{ selectedPin.city ? selectedPin.city + ', ' : '' }}{{ selectedPin.country }}</span>
          </div>
          <button class="pin-close" (click)="$event.stopPropagation(); selectedPin = null">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      }

      <div class="post-list">
        <div class="post-list-header">
          <span class="material-symbols-rounded">photo_library</span>
          <span>Saved posts</span>
        </div>
        <div class="post-grid">
          @for (item of bookmarks; track item.id) {
            <div class="post-item" (click)="pinClicked.emit(item)" [class.highlighted]="selectedPin?.id === item.id">
              @if (getPinThumb(item)) {
                <img [src]="getPinThumb(item)" alt="" loading="lazy">
              } @else {
                <div class="post-placeholder">
                  <span class="material-symbols-rounded">image</span>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .trip-map-overlay {
      position: fixed;
      inset: 0;
      z-index: 500;
      background: #080808;
      display: flex;
      flex-direction: column;
      animation: fadeIn 0.2s ease-out;
    }

    .trip-map-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      padding-top: max(12px, env(safe-area-inset-top));
      background: #0a0a0a;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 0;
      .material-symbols-rounded { color: #fff; font-size: 24px; }
    }

    .header-info {
      flex: 1;
      display: flex;
      flex-direction: column;

      h2 {
        color: #fff;
        font-size: 18px;
        font-weight: 700;
        margin: 0;
        line-height: 1.2;
      }

      .countdown {
        color: #7ec8a4;
        font-size: 12px;
        font-weight: 600;
      }
    }

    .post-count {
      color: rgba(255, 255, 255, 0.4);
      font-size: 13px;
      white-space: nowrap;
    }

    .map-container {
      flex: 1;
      min-height: 200px;
    }

    .pin-card {
      position: absolute;
      bottom: 200px;
      left: 16px;
      right: 16px;
      background: #1a1a1a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      cursor: pointer;
      z-index: 501;
      animation: slideUp 0.2s ease-out;

      img {
        width: 56px;
        height: 56px;
        border-radius: 8px;
        object-fit: cover;
      }

      .pin-card-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;

        .pin-title {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
        }

        .pin-location {
          color: rgba(255, 255, 255, 0.4);
          font-size: 12px;
        }
      }

      .pin-close {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        .material-symbols-rounded { color: rgba(255, 255, 255, 0.4); font-size: 20px; }
      }
    }

    .post-list {
      flex-shrink: 0;
      max-height: 180px;
      background: #0a0a0a;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      overflow-y: auto;
    }

    .post-list-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px 6px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 13px;
      font-weight: 600;

      .material-symbols-rounded { font-size: 16px; }
    }

    .post-grid {
      display: flex;
      gap: 4px;
      padding: 0 16px 12px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;

      &::-webkit-scrollbar { display: none; }
    }

    .post-item {
      flex-shrink: 0;
      width: 80px;
      height: 80px;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: border-color 0.2s;

      &.highlighted { border-color: #3891a6; }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .post-placeholder {
        width: 100%;
        height: 100%;
        background: #1a1a1a;
        display: flex;
        align-items: center;
        justify-content: center;
        .material-symbols-rounded { font-size: 24px; color: #333; }
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `],
})
export class TripMapView implements AfterViewInit, OnDestroy {
  @Input() trip: Trip | null = null;
  @Input() bookmarks: any[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() pinClicked = new EventEmitter<any>();

  mapEl = viewChild<ElementRef>('mapEl');
  selectedPin: any = null;
  private map: any = null;
  private markers: any[] = [];
  private geocodeCache = new Map<string, [number, number]>();
  private cdr = inject(ChangeDetectorRef);

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 50);
  }

  ngOnDestroy() {
    if (this.map) { this.map.remove(); this.map = null; }
  }

  private async initMap() {
    const el = this.mapEl()?.nativeElement;
    if (!el || typeof L === 'undefined') return;

    this.map = L.map(el, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
    }).addTo(this.map);

    // Geocode and place markers
    const bounds: [number, number][] = [];

    for (const b of this.bookmarks) {
      const coords = await this.getCoords(b);
      if (!coords) continue;
      bounds.push(coords);

      const icon = L.divIcon({
        className: 'trip-marker',
        html: `<div class="trip-pin"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker(coords, { icon }).addTo(this.map);
      marker.on('click', () => {
        this.selectedPin = b;
        this.cdr.detectChanges();
      });
      this.markers.push(marker);
    }

    // Fit bounds
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        this.map.setView(bounds[0], 10);
      } else {
        this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    }

    // Add marker styles dynamically
    const style = document.createElement('style');
    style.textContent = `
      .trip-pin {
        width: 14px;
        height: 14px;
        background: #3891a6;
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      }
      .trip-marker { background: none !important; border: none !important; }
    `;
    document.head.appendChild(style);
  }

  private async getCoords(bookmark: any): Promise<[number, number] | null> {
    const city = bookmark.city;
    const country = bookmark.country;
    if (!country) return null;

    // Try city + country geocoding first
    if (city) {
      const key = `${city},${country}`;
      if (this.geocodeCache.has(key)) return this.geocodeCache.get(key)!;
      const coords = await this.geocodeCity(city, country);
      if (coords) {
        this.geocodeCache.set(key, coords);
        return coords;
      }
    }

    // Fall back to country coords
    const cc = (COUNTRY_COORDS as Record<string, [number, number]>)[country];
    return cc || null;
  }

  private async geocodeCity(city: string, country: string): Promise<[number, number] | null> {
    try {
      const params = new URLSearchParams({ q: `${city}, ${country}`, format: 'json', limit: '1' });
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

  getPinThumb(item: any): string {
    if (item.cloudinaryUrl) {
      return item.cloudinaryUrl
        .replace('/video/upload/', '/video/upload/so_0,w_200,h_200,c_fill,q_auto,f_auto/')
        .replace(/\.[^.]+$/, '.jpg');
    }
    return item.thumbnailUrl || item.images?.[0]?.url || '';
  }

  getCountdown(date: string): string {
    const diff = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Past';
    if (diff === 0) return 'Today!';
    if (diff === 1) return 'Tomorrow';
    if (diff <= 30) return `${diff} days`;
    const months = Math.round(diff / 30);
    return months === 1 ? 'In 1 month' : `In ${months} months`;
  }
}
