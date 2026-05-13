import { Component, Input, Output, EventEmitter, ElementRef, viewChild, AfterViewInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-avatar-cropper',
  templateUrl: './avatar-cropper.html',
  styleUrl: './avatar-cropper.scss',
})
export class AvatarCropper implements AfterViewInit, OnDestroy {
  @Input() imageSource = '';
  @Output() cropped = new EventEmitter<Blob>();
  @Output() cancelled = new EventEmitter<void>();

  private cropArea = viewChild<ElementRef>('cropArea');
  private imgEl = viewChild<ElementRef>('cropImg');

  scale = 1;
  translateX = 0;
  translateY = 0;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // Pinch zoom state
  private initialPinchDist = 0;
  private pinchBaseScale = 1;

  private readonly CIRCLE_SIZE = 280;
  private readonly OUTPUT_SIZE = 512;
  private readonly MIN_SCALE = 1;
  private readonly MAX_SCALE = 5;

  private imgNaturalW = 0;
  private imgNaturalH = 0;
  private imgDisplayW = 0;
  private imgDisplayH = 0;
  private baseScale = 1;

  ngAfterViewInit() {
    const area = this.cropArea()?.nativeElement as HTMLElement;
    if (area) {
      area.addEventListener('wheel', this.onWheel, { passive: false });
    }
  }

  ngOnDestroy() {
    const area = this.cropArea()?.nativeElement as HTMLElement;
    if (area) {
      area.removeEventListener('wheel', this.onWheel);
    }
  }

  onImageLoad() {
    const img = this.imgEl()?.nativeElement as HTMLImageElement;
    if (!img) return;
    this.imgNaturalW = img.naturalWidth;
    this.imgNaturalH = img.naturalHeight;

    // Fit so the shorter side fills the circle
    const scaleW = this.CIRCLE_SIZE / this.imgNaturalW;
    const scaleH = this.CIRCLE_SIZE / this.imgNaturalH;
    this.baseScale = Math.max(scaleW, scaleH);
    this.imgDisplayW = this.imgNaturalW * this.baseScale;
    this.imgDisplayH = this.imgNaturalH * this.baseScale;

    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
  }

  get imgTransform(): string {
    // Center the image in the circle, then apply user's pan and zoom
    const cx = (this.CIRCLE_SIZE - this.imgDisplayW * this.scale) / 2 + this.translateX;
    const cy = (this.CIRCLE_SIZE - this.imgDisplayH * this.scale) / 2 + this.translateY;
    return `translate(${cx}px, ${cy}px) scale(${this.scale})`;
  }

  get imgWidth(): number {
    return this.imgDisplayW;
  }

  get imgHeight(): number {
    return this.imgDisplayH;
  }

  // --- Pointer drag ---
  onPointerDown(e: PointerEvent) {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.translateX += dx;
    this.translateY += dy;
    this.clampPosition();
  }

  onPointerUp() {
    this.dragging = false;
  }

  // --- Touch pinch zoom ---
  onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      this.dragging = false;
      this.initialPinchDist = this.getTouchDist(e);
      this.pinchBaseScale = this.scale;
    }
  }

  onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = this.getTouchDist(e);
      const newScale = this.pinchBaseScale * (dist / this.initialPinchDist);
      this.scale = Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, newScale));
      this.clampPosition();
    }
  }

  // --- Wheel zoom ---
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.002;
    this.scale = Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, this.scale + delta));
    this.clampPosition();
  };

  private getTouchDist(e: TouchEvent): number {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private clampPosition() {
    const scaledW = this.imgDisplayW * this.scale;
    const scaledH = this.imgDisplayH * this.scale;
    // How far can the user pan before the circle edge would show empty space
    const maxX = Math.max(0, (scaledW - this.CIRCLE_SIZE) / 2);
    const maxY = Math.max(0, (scaledH - this.CIRCLE_SIZE) / 2);
    this.translateX = Math.min(maxX, Math.max(-maxX, this.translateX));
    this.translateY = Math.min(maxY, Math.max(-maxY, this.translateY));
  }

  async confirm() {
    const img = this.imgEl()?.nativeElement as HTMLImageElement;
    if (!img) return;

    const canvas = document.createElement('canvas');
    canvas.width = this.OUTPUT_SIZE;
    canvas.height = this.OUTPUT_SIZE;
    const ctx = canvas.getContext('2d')!;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(this.OUTPUT_SIZE / 2, this.OUTPUT_SIZE / 2, this.OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Map display coords to source image coords
    // The visible circle starts at the point where the image's top-left + centering + translate = 0
    const displayScale = this.baseScale * this.scale;

    // In display coords, the image's top-left corner relative to the circle is:
    //   cx_display = (CIRCLE_SIZE - imgDisplayW * scale) / 2 + translateX
    //   cy_display = (CIRCLE_SIZE - imgDisplayH * scale) / 2 + translateY
    // The circle top-left in image display coords is the negative of that.
    const imgOffsetX = (this.imgDisplayW * this.scale - this.CIRCLE_SIZE) / 2 - this.translateX;
    const imgOffsetY = (this.imgDisplayH * this.scale - this.CIRCLE_SIZE) / 2 - this.translateY;

    // Convert from display pixels to natural image pixels
    const sx = imgOffsetX / displayScale;
    const sy = imgOffsetY / displayScale;
    const sSize = this.CIRCLE_SIZE / displayScale;

    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, this.OUTPUT_SIZE, this.OUTPUT_SIZE);

    canvas.toBlob(blob => {
      if (blob) this.cropped.emit(blob);
    }, 'image/jpeg', 0.9);
  }
}
