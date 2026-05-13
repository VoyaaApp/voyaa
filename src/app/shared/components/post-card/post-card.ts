import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef, inject, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImageCarousel } from '../image-carousel/image-carousel';
import { formatCount } from '../../utils/format';
import { timeAgo } from '../../utils/time';
import { InteractionService } from '../../../core/services/interaction.service';

@Component({
  selector: 'app-post-card',
  imports: [ImageCarousel, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './post-card.html',
  styleUrl: './post-card.scss',
})
export class PostCard implements OnDestroy {
  @Input() images: string[] = [];
  @Input() currentIndex = 0;
  @Input() aspectRatio = '1';
  @Input() objectFit: 'cover' | 'contain' = 'cover';
  @Input() postId = '';
  @Input() postType: 'post' | 'video' = 'post';
  @Input() userId = '';
  @Input() username = '';
  @Input() userAvatar = '';
  @Input() title = '';
  @Input() city = '';
  @Input() country = '';
  @Input() createdAt = '';
  @Input() liked = false;
  @Input() likeCount = 0;
  @Input() commentCount = 0;
  @Input() bookmarked = false;
  @Input() bookmarkData: any = null;
  @Input() isVideo = false;
  @Input() videoUrl = '';
  @Input() currentUid = '';

  @Output() indexChange = new EventEmitter<number>();
  @Output() likeChange = new EventEmitter<{ liked: boolean; likeCount: number }>();
  @Output() bookmarkChange = new EventEmitter<boolean>();
  @Output() commentsOpen = new EventEmitter<void>();
  @Output() shareClick = new EventEmitter<void>();
  @Output() profileClick = new EventEmitter<string>();
  @Output() locationClick = new EventEmitter<{ city: string; country: string }>();
  @Output() singleTap = new EventEmitter<void>();
  @Output() playVideo = new EventEmitter<void>();
  @Output() reportClick = new EventEmitter<{ contentId: string; contentType: string; contentOwnerId: string }>();
  @Output() blockClick = new EventEmitter<string>();
  @Output() deleteClick = new EventEmitter<void>();
  @Output() saveToTrip = new EventEmitter<void>();

  showHeart = false;
  showMenu = false;
  private tapPending = false;
  private tapTimer: any = null;
  private cdr = inject(ChangeDetectorRef);
  private interaction = inject(InteractionService);

  ngOnDestroy() {
    clearTimeout(this.tapTimer);
  }

  formatCount = formatCount;

  get location(): string {
    if (this.city && this.country) return `${this.city}, ${this.country}`;
    return this.country || this.city || '';
  }

  get timeAgoStr(): string {
    return this.createdAt ? timeAgo(this.createdAt) : '';
  }

  onTap() {
    if (this.tapPending) {
      clearTimeout(this.tapTimer);
      this.tapPending = false;
      this.doubleTapLike();
      return;
    }
    this.tapPending = true;
    this.tapTimer = setTimeout(() => {
      this.tapPending = false;
      this.singleTap.emit();
    }, 300);
  }

  private doubleTapLike() {
    if (!this.liked) {
      this.toggleLike();
    }
    this.showHeart = true;
    this.cdr.detectChanges();
    setTimeout(() => { this.showHeart = false; this.cdr.detectChanges(); }, 800);
  }

  async toggleLike() {
    const collName = this.postType === 'post' ? 'posts' : 'videos';
    const result = await this.interaction.toggleLike(collName as 'videos' | 'posts', this.postId, this.userId, this.title, this.liked);
    this.liked = result.liked;
    this.likeCount += result.delta;
    this.likeChange.emit({ liked: this.liked, likeCount: this.likeCount });
    this.cdr.detectChanges();
  }

  async toggleBookmark() {
    if (!this.bookmarked) {
      // Emit to parent to show trip picker
      this.saveToTrip.emit();
      return;
    }
    this.bookmarked = await this.interaction.toggleBookmark(this.postId, this.bookmarked, {});
    this.bookmarkChange.emit(this.bookmarked);
    this.cdr.detectChanges();
  }

  async completeBookmark(tripId: string) {
    this.bookmarked = await this.interaction.toggleBookmark(this.postId, false, {
      country: this.country, city: this.city,
      title: this.title, _type: this.postType,
      tripId,
      ...(this.bookmarkData || {}),
    });
    this.bookmarkChange.emit(this.bookmarked);
    this.cdr.detectChanges();
  }
}
