import { Component, OnDestroy, inject, ChangeDetectorRef, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { environment } from '../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { db } from '../../core/services/firebase.service';
import { collection, addDoc } from 'firebase/firestore';
import { ImageEditor, ImageEditState } from '../../shared/components/image-editor/image-editor';
import { ContentFilterService } from '../../core/services/content-filter.service';

interface LocationSuggestion {
  display: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

interface ImageItem {
  file: File;
  editState: ImageEditState;
}

@Component({
  selector: 'app-upload-image',
  imports: [FormsModule, ImageEditor],
  templateUrl: './upload-image.html',
  styleUrl: './upload-image.scss',
})
export class UploadImage implements OnDestroy {
  private router = inject(Router);
  private location = inject(Location);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private contentFilter = inject(ContentFilterService);

  images: ImageItem[] = [];
  activeIndex = 0;
  step: 'edit' | 'details' = 'edit';
  previewIndex = 0;
  title = '';
  isUploading = false;
  uploadProgress = 0;
  uploadStatus = '';
  errorMessage = '';
  showSuccessToast = false;

  // Location
  locationQuery = '';
  locationCity = '';
  locationCountry = '';
  locationDisplay = '';
  locationLat = 0;
  locationLon = 0;
  locationSuggestions: LocationSuggestion[] = [];
  showLocationDropdown = false;
  isSearchingLocation = false;
  private searchTimer: any = null;

  // Drag reorder
  private dragIndex = -1;

  // Swipe between images
  private swipeStartX = 0;
  private swipeDeltaX = 0;
  private isSwiping = false;

  private thumbUrlCache = new Map<File, string>();
  previewUrls: string[] = [];

  goBack() {
    this.location.back();
  }

  ngOnDestroy() {
    clearTimeout(this.searchTimer);
    this.thumbUrlCache.forEach(url => URL.revokeObjectURL(url));
    this.previewUrls.forEach(url => URL.revokeObjectURL(url));
  }

  async goToDetails() {
    this.previewUrls.forEach(url => URL.revokeObjectURL(url));
    this.previewUrls = [];
    for (const img of this.images) {
      const blob = await this.exportImage(img);
      this.previewUrls.push(URL.createObjectURL(blob));
    }
    this.previewIndex = 0;
    this.step = 'details';
    this.cdr.detectChanges();
  }

  getThumbUrl(img: ImageItem): string {
    if (!this.thumbUrlCache.has(img.file)) {
      this.thumbUrlCache.set(img.file, URL.createObjectURL(img.file));
    }
    return this.thumbUrlCache.get(img.file)!;
  }

  // ── Image selection ──

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const remaining = 10 - this.images.length;
    const files = Array.from(input.files).slice(0, remaining);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      this.images.push({
        file,
        editState: this.defaultEditState(),
      });
    }
    if (this.images.length > 0 && this.activeIndex >= this.images.length) {
      this.activeIndex = this.images.length - 1;
    }
    input.value = '';
    this.cdr.detectChanges();
  }

  private defaultEditState(): ImageEditState {
    return {
      filter: 'none',
      brightness: 1,
      contrast: 1,
      saturation: 1,
      rotation: 0,
      cropX: 0, cropY: 0, cropW: 9999, cropH: 9999,
    };
  }

  removeImage(index: number) {
    this.images.splice(index, 1);
    if (this.activeIndex >= this.images.length) {
      this.activeIndex = Math.max(0, this.images.length - 1);
    }
    this.cdr.detectChanges();
  }

  selectImage(index: number) {
    this.activeIndex = index;
    this.cdr.detectChanges();
  }

  onEditStateChange(state: ImageEditState) {
    if (this.images[this.activeIndex]) {
      this.images[this.activeIndex].editState = state;
    }
  }

  // ── Drag reorder ──

  onDragStart(event: DragEvent, index: number) {
    this.dragIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();
    if (this.dragIndex < 0 || this.dragIndex === dropIndex) return;
    const item = this.images.splice(this.dragIndex, 1)[0];
    this.images.splice(dropIndex, 0, item);
    this.activeIndex = dropIndex;
    this.dragIndex = -1;
    this.cdr.detectChanges();
  }

  moveImage(from: number, to: number) {
    const item = this.images.splice(from, 1)[0];
    this.images.splice(to, 0, item);
    this.activeIndex = to;
    this.cdr.detectChanges();
  }

  // ── Swipe between images ──

  onSwipeStart(event: TouchEvent) {
    if (this.images.length < 2) return;
    // Only swipe when touching the canvas preview, not the tool controls
    const target = event.target as HTMLElement;
    if (target.closest('.editor-tools')) return;
    this.isSwiping = true;
    this.swipeStartX = event.touches[0].clientX;
    this.swipeDeltaX = 0;
  }

  onSwipeMove(event: TouchEvent) {
    if (!this.isSwiping) return;
    this.swipeDeltaX = event.touches[0].clientX - this.swipeStartX;
  }

  onSwipeEnd() {
    if (!this.isSwiping) return;
    this.isSwiping = false;
    const threshold = 60;
    if (this.swipeDeltaX < -threshold && this.activeIndex < this.images.length - 1) {
      this.activeIndex++;
      this.cdr.detectChanges();
    } else if (this.swipeDeltaX > threshold && this.activeIndex > 0) {
      this.activeIndex--;
      this.cdr.detectChanges();
    }
  }

  // ── Location ──

  onLocationInput() {
    clearTimeout(this.searchTimer);
    const q = this.locationQuery.trim();
    if (q.length < 2) {
      this.locationSuggestions = [];
      this.showLocationDropdown = false;
      return;
    }
    this.isSearchingLocation = true;
    this.searchTimer = setTimeout(() => this.searchLocations(q), 400);
  }

  async searchLocations(query: string) {
    try {
      const params = new URLSearchParams({
        q: query, format: 'json', addressdetails: '1', limit: '8', 'accept-language': 'en', dedupe: '1',
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'Voyaa/1.0' },
      });
      const results = await res.json();
      this.locationSuggestions = results
        .map((r: any) => {
          const addr = r.address || {};
          const city = addr.city || addr.town || addr.village || addr.county || addr.state || '';
          const country = addr.country || '';
          if (!country) return null;
          const display = city ? `${city}, ${country}` : country;
          return { display, city, country, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
        })
        .filter((s: any): s is LocationSuggestion => s !== null)
        .filter((s: LocationSuggestion, i: number, arr: LocationSuggestion[]) =>
          arr.findIndex(x => x.display === s.display) === i
        );
      this.showLocationDropdown = this.locationSuggestions.length > 0;
    } catch {
      this.locationSuggestions = [];
      this.showLocationDropdown = false;
    } finally {
      this.isSearchingLocation = false;
      this.cdr.detectChanges();
    }
  }

  selectLocation(s: LocationSuggestion) {
    this.locationCity = s.city;
    this.locationCountry = s.country;
    this.locationDisplay = s.display;
    this.locationLat = s.lat;
    this.locationLon = s.lon;
    this.locationQuery = '';
    this.locationSuggestions = [];
    this.showLocationDropdown = false;
  }

  clearLocation() {
    this.locationCity = '';
    this.locationCountry = '';
    this.locationDisplay = '';
    this.locationLat = 0;
    this.locationLon = 0;
    this.locationQuery = '';
    this.locationSuggestions = [];
    this.showLocationDropdown = false;
  }

  // ── Upload ──

  async upload() {
    if (this.images.length === 0) {
      this.errorMessage = 'Please select at least one image.';
      return;
    }
    if (!this.title) {
      this.errorMessage = 'Please enter a title.';
      return;
    }
    if (!this.locationCountry || !this.locationCity) {
      this.errorMessage = 'Please select a location.';
      return;
    }
    if (!this.contentFilter.isClean(this.title)) {
      this.errorMessage = 'Your title contains inappropriate language. Please revise it.';
      return;
    }

    this.isUploading = true;
    this.uploadProgress = 0;
    this.uploadStatus = 'Processing images...';
    this.errorMessage = '';
    this.cdr.detectChanges();

    try {
      const uploadedImages: { url: string; publicId: string }[] = [];
      const total = this.images.length;

      for (let i = 0; i < total; i++) {
        this.uploadStatus = `Uploading image ${i + 1} of ${total}...`;
        this.uploadProgress = Math.round((i / total) * 100);
        this.cdr.detectChanges();

        const img = this.images[i];
        // Get the editor component to export the blob
        const blob = await this.exportImage(img);

        const formData = new FormData();
        formData.append('file', blob, `image_${i}.jpg`);
        formData.append('upload_preset', environment.cloudinary.uploadPreset);

        const data: any = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/image/upload`);
          xhr.onload = () => {
            const res = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(res);
            else reject(new Error(res.error?.message || 'Upload failed'));
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(formData);
        });

        uploadedImages.push({ url: data.secure_url, publicId: data.public_id });
      }

      this.uploadStatus = 'Saving...';
      this.uploadProgress = 100;
      this.cdr.detectChanges();

      await addDoc(collection(db, 'posts'), {
        userId: this.authService.currentUser()?.uid,
        type: 'image',
        images: uploadedImages,
        thumbnailUrl: uploadedImages[0].url,
        title: this.title,
        location: {
          country: this.locationCountry,
          city: this.locationCity,
          lat: this.locationLat,
          lon: this.locationLon,
        },
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date().toISOString(),
      });

      this.isUploading = false;
      this.showSuccessToast = true;
      this.cdr.detectChanges();
      setTimeout(() => this.router.navigate(['/profile']), 1500);
    } catch (error: any) {
      this.errorMessage = error.message || 'Something went wrong.';
      this.isUploading = false;
      this.cdr.detectChanges();
    }
  }

  private async exportImage(img: ImageItem): Promise<Blob> {
    // Render image with edit state to canvas and export
    const s = img.editState;
    const image = new Image();
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        image.onload = () => resolve();
        image.src = e.target?.result as string;
      };
      reader.readAsDataURL(img.file);
    });

    // Determine final dimensions after rotation
    const rot = s.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const fullW = isRotated ? image.height : image.width;
    const fullH = isRotated ? image.width : image.height;

    // Clamp crop to actual image size
    const cropW = Math.min(s.cropW, fullW);
    const cropH = Math.min(s.cropH, fullH);
    const cropX = Math.min(s.cropX, fullW - cropW);
    const cropY = Math.min(s.cropY, fullH - cropH);

    // Limit output size to 2048px
    const maxDim = 2048;
    let outW = cropW;
    let outH = cropH;
    if (outW > maxDim || outH > maxDim) {
      const scale = Math.min(maxDim / outW, maxDim / outH);
      outW = Math.round(outW * scale);
      outH = Math.round(outH * scale);
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext('2d')!;

    // Scale to output size
    const sx = outW / cropW;
    const sy = outH / cropH;
    ctx.scale(sx, sy);

    // Apply filters
    let filterStr = s.filter !== 'none' ? s.filter : '';
    const parts: string[] = [];
    if (s.brightness !== 1) parts.push(`brightness(${s.brightness})`);
    if (s.contrast !== 1) parts.push(`contrast(${s.contrast})`);
    if (s.saturation !== 1) parts.push(`saturate(${s.saturation})`);
    if (parts.length) filterStr = (filterStr ? filterStr + ' ' : '') + parts.join(' ');
    if (filterStr) ctx.filter = filterStr;

    ctx.save();
    ctx.translate(-cropX, -cropY);
    ctx.translate(fullW / 2, fullH / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();

    return new Promise((resolve) => {
      offscreen.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92);
    });
  }
}
