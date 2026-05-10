import { Component, Input, Output, EventEmitter, ChangeDetectorRef, inject } from '@angular/core';

@Component({
  selector: 'app-image-viewer',
  imports: [],
  templateUrl: './image-viewer.html',
  styleUrl: './image-viewer.scss',
})
export class ImageViewer {
  private cdr = inject(ChangeDetectorRef);

  @Input() images: string[] = [];
  @Input() title = '';
  @Input() username = '';
  @Input() userAvatar = '';
  @Input() location = '';
  @Input() likeCount = 0;
  @Input() liked = false;
  @Output() close = new EventEmitter<void>();
  @Output() toggleLike = new EventEmitter<void>();

  currentIndex = 0;

  // Swipe state
  private touchStartX = 0;
  private touchDeltaX = 0;
  private isSwiping = false;
  translateX = 0;

  get dotArray(): number[] {
    return Array.from({ length: this.images.length }, (_, i) => i);
  }

  onTouchStart(event: TouchEvent) {
    this.isSwiping = true;
    this.touchStartX = event.touches[0].clientX;
    this.touchDeltaX = 0;
  }

  onTouchMove(event: TouchEvent) {
    if (!this.isSwiping) return;
    this.touchDeltaX = event.touches[0].clientX - this.touchStartX;
    this.translateX = this.touchDeltaX;
    this.cdr.detectChanges();
  }

  onTouchEnd() {
    if (!this.isSwiping) return;
    this.isSwiping = false;

    const threshold = 60;
    if (this.touchDeltaX < -threshold && this.currentIndex < this.images.length - 1) {
      this.currentIndex++;
    } else if (this.touchDeltaX > threshold && this.currentIndex > 0) {
      this.currentIndex--;
    }
    this.translateX = 0;
    this.cdr.detectChanges();
  }

  goTo(index: number) {
    this.currentIndex = index;
  }

  prev() {
    if (this.currentIndex > 0) this.currentIndex--;
  }

  next() {
    if (this.currentIndex < this.images.length - 1) this.currentIndex++;
  }
}
