import { Component, OnDestroy, inject, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { environment } from '../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { db } from '../../core/services/firebase.service';
import { collection, addDoc } from 'firebase/firestore';
import { ContentFilterService } from '../../core/services/content-filter.service';
import { LocationSearchService, LocationSuggestion } from '../../core/services/location-search.service';

@Component({
  selector: 'app-upload',
  imports: [FormsModule],
  templateUrl: './upload.html',
  styleUrl: './upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Upload implements OnDestroy {
  private router = inject(Router);
  private location = inject(Location);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private contentFilter = inject(ContentFilterService);
  private locationSearch = inject(LocationSearchService);

  goBack() {
    this.location.back();
  }

  selectedFile: File | null = null;
  videoPreviewUrl: string | null = null;
  title = '';
  isUploading = false;
  uploadProgress = 0;
  uploadStatus = '';
  errorMessage = '';
  showSuccessToast = false;

  // Location autocomplete
  locationQuery = '';
  locationCity = '';
  locationCountry = '';
  locationDisplay = '';
  locationLat = 0;
  locationLon = 0;
  locationSuggestions: LocationSuggestion[] = [];
  showLocationDropdown = false;
  isSearchingLocation = false;

  ngOnDestroy() {
    if (this.videoPreviewUrl) {
      URL.revokeObjectURL(this.videoPreviewUrl);
    }
    this.locationSearch.cancel();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      if (this.videoPreviewUrl) {
        URL.revokeObjectURL(this.videoPreviewUrl);
      }
      this.selectedFile = input.files[0];
      this.videoPreviewUrl = URL.createObjectURL(this.selectedFile);
      this.cdr.detectChanges();
    }
  }

  onLocationInput() {
    this.locationSearch.search(this.locationQuery, (results, loading) => {
      this.locationSuggestions = results;
      this.isSearchingLocation = loading;
      this.showLocationDropdown = results.length > 0;
      this.cdr.detectChanges();
    });
  }

  selectLocation(suggestion: LocationSuggestion) {
    this.locationCity = suggestion.city;
    this.locationCountry = suggestion.country;
    this.locationDisplay = suggestion.display;
    this.locationLat = suggestion.lat;
    this.locationLon = suggestion.lon;
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

  async upload() {
    if (!this.selectedFile || !this.title || !this.locationCountry) {
      this.errorMessage = 'Please fill in all fields and select a video.';
      return;
    }

    if (!this.selectedFile.type.startsWith('video/')) {
      this.errorMessage = 'Please select a video file.';
      return;
    }

    if (this.selectedFile.size > 100 * 1024 * 1024) {
      this.errorMessage = 'Video must be under 100MB.';
      return;
    }

    if (!this.contentFilter.isClean(this.title)) {
      this.errorMessage = 'Your title contains inappropriate language. Please revise it.';
      return;
    }

    this.isUploading = true;
    this.uploadProgress = 0;
    this.uploadStatus = 'Uploading video...';
    this.errorMessage = '';

    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);
      formData.append('upload_preset', environment.cloudinary.uploadPreset);
      formData.append('resource_type', 'video');

      const data: any = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/video/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            this.uploadProgress = Math.round((e.loaded / e.total) * 100);
            this.cdr.detectChanges();
          }
        };

        xhr.onload = () => {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(res);
          else reject(new Error(res.error?.message || 'Upload failed'));
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      this.uploadStatus = 'Saving...';
      this.cdr.detectChanges();

      await addDoc(collection(db, 'videos'), {
        userId: this.authService.currentUser()?.uid,
        cloudinaryUrl: data.secure_url,
        publicId: data.public_id,
        thumbnailUrl: data.secure_url.replace('/upload/', '/upload/so_0/').replace('.mp4', '.jpg'),
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

      this.router.navigate(['/feed']);
    } catch (error: any) {
      this.errorMessage = error.message || 'Something went wrong.';
    } finally {
      this.isUploading = false;
      this.cdr.detectChanges();
    }
  }
}
