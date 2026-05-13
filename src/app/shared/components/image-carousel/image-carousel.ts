import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-image-carousel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="carousel" [style.aspect-ratio]="aspectRatio"
      (touchstart)="onSwipeStart($event)"
      (touchmove)="onSwipeMove($event)"
      (touchend)="onSwipeEnd()">
      <div class="track" [style.transform]="'translateX(' + trackOffset + '%)'">
        @for (img of images; track $index) {
          <div class="slide">
            <img [src]="img" [style.object-fit]="objectFit" alt="">
          </div>
        }
      </div>
      @if (images.length > 1) {
        <div class="dots">
          @for (img of images; track $index) {
            <span class="dot" [class.active]="$index === currentIndex"></span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .carousel {
      position: relative;
      width: 100%;
      overflow: hidden;
      background: #111;
    }

    .track {
      display: flex;
      height: 100%;
      transition: transform 0.3s ease;
    }

    .slide {
      min-width: 100%;
      height: 100%;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .dots {
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      background: rgba(0, 0, 0, 0.35);
      padding: 5px 10px;
      border-radius: 12px;

      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.5);
        transition: all 0.2s;

        &.active {
          background: #fff;
          width: 18px;
          border-radius: 4px;
        }
      }
    }
  `]
})
export class ImageCarousel {
  @Input() images: string[] = [];
  @Input() currentIndex = 0;
  @Input() aspectRatio = '1';
  @Input() objectFit: 'cover' | 'contain' = 'cover';
  @Output() indexChange = new EventEmitter<number>();

  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeDelta = 0;
  private swipeLocked: 'horizontal' | 'vertical' | null = null;

  get trackOffset() {
    return -this.currentIndex * 100;
  }

  onSwipeStart(event: TouchEvent) {
    if (this.images.length < 2) return;
    this.swipeStartX = event.touches[0].clientX;
    this.swipeStartY = event.touches[0].clientY;
    this.swipeDelta = 0;
    this.swipeLocked = null;
  }

  onSwipeMove(event: TouchEvent) {
    const dx = event.touches[0].clientX - this.swipeStartX;
    const dy = event.touches[0].clientY - this.swipeStartY;
    if (!this.swipeLocked) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        this.swipeLocked = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
      }
    }
    if (this.swipeLocked === 'horizontal') {
      event.preventDefault();
      this.swipeDelta = dx;
    }
  }

  onSwipeEnd() {
    const threshold = 60;
    const max = this.images.length - 1;
    let newIndex = this.currentIndex;
    if (this.swipeDelta < -threshold && this.currentIndex < max) {
      newIndex = this.currentIndex + 1;
    } else if (this.swipeDelta > threshold && this.currentIndex > 0) {
      newIndex = this.currentIndex - 1;
    }
    this.swipeDelta = 0;
    if (newIndex !== this.currentIndex) {
      this.indexChange.emit(newIndex);
    }
  }
}
