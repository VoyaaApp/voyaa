import { Component, Input, Output, EventEmitter, ElementRef, viewChild, AfterViewInit, OnChanges, SimpleChanges, ChangeDetectorRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface FilterPreset {
  name: string;
  filter: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { name: 'Normal', filter: 'none' },
  { name: 'Clarendon', filter: 'contrast(1.2) saturate(1.35)' },
  { name: 'Gingham', filter: 'brightness(1.05) hue-rotate(-10deg)' },
  { name: 'Moon', filter: 'grayscale(1) contrast(1.1) brightness(1.1)' },
  { name: 'Lark', filter: 'contrast(0.9) brightness(1.1) saturate(0.8)' },
  { name: 'Reyes', filter: 'sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)' },
  { name: 'Juno', filter: 'contrast(1.1) brightness(1.05) saturate(1.3)' },
  { name: 'Slumber', filter: 'saturate(0.66) brightness(1.05) sepia(0.1)' },
  { name: 'Crema', filter: 'saturate(0.9) contrast(0.95) brightness(1.05) sepia(0.05)' },
  { name: 'Ludwig', filter: 'contrast(1.05) saturate(1.1) brightness(1.02)' },
  { name: 'Aden', filter: 'hue-rotate(20deg) saturate(0.85) brightness(1.2) contrast(0.9)' },
  { name: 'Perpetua', filter: 'brightness(1.05) saturate(1.1)' },
];

export interface ImageEditState {
  filter: string;
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

@Component({
  selector: 'app-image-editor',
  imports: [FormsModule],
  templateUrl: './image-editor.html',
  styleUrl: './image-editor.scss',
})
export class ImageEditor implements AfterViewInit, OnChanges {
  private cdr = inject(ChangeDetectorRef);

  @Input() imageFile!: File;
  @Input() editState!: ImageEditState;
  @Output() editStateChange = new EventEmitter<ImageEditState>();

  canvas = viewChild<ElementRef<HTMLCanvasElement>>('editorCanvas');
  filterCanvas = viewChild<ElementRef<HTMLCanvasElement>>('filterCanvas');

  activeTab: 'crop' | 'filters' | 'adjust' | 'rotate' = 'filters';
  filters = FILTER_PRESETS;
  aspectRatios = [
    { label: 'Free', value: 0 },
    { label: '1:1', value: 1 },
    { label: '4:5', value: 4 / 5 },
    { label: '16:9', value: 16 / 9 },
  ];
  activeAspect = 0;
  filterThumbs: string[] = [];

  private img = new Image();
  private imgLoaded = false;

  // Crop state
  private cropMode: 'none' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' = 'none';
  private cropDragStartX = 0;
  private cropDragStartY = 0;
  private cropOrigX = 0;
  private cropOrigY = 0;
  private cropOrigW = 0;
  private cropOrigH = 0;
  private canvasRect: DOMRect | null = null;
  private displayScale = 1;
  private readonly HANDLE_HIT = 24; // px hit area for corner handles

  ngAfterViewInit() {
    this.loadImage();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['imageFile'] && !changes['imageFile'].firstChange) {
      this.loadImage();
    }
    if (changes['editState'] && !changes['editState'].firstChange && this.imgLoaded) {
      this.renderPreview();
    }
  }

  private loadImage() {
    if (!this.imageFile) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.img = new Image();
      this.img.onload = () => {
        this.imgLoaded = true;
        this.renderPreview();
        this.generateFilterThumbs();
      };
      this.img.src = e.target?.result as string;
    };
    reader.readAsDataURL(this.imageFile);
  }

  private renderPreview() {
    const el = this.canvas()?.nativeElement;
    if (!el || !this.imgLoaded) return;
    const ctx = el.getContext('2d')!;

    const rot = this.editState.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const srcW = isRotated ? this.img.height : this.img.width;
    const srcH = isRotated ? this.img.width : this.img.height;

    // Fit to container
    const container = el.parentElement!;
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    const scale = Math.min(maxW / srcW, maxH / srcH, 1);
    const drawW = Math.round(srcW * scale);
    const drawH = Math.round(srcH * scale);

    el.width = drawW;
    el.height = drawH;
    this.displayScale = this.img.width / (isRotated ? drawH : drawW);

    ctx.clearRect(0, 0, drawW, drawH);
    ctx.save();

    // Build filter string
    let filterStr = this.editState.filter !== 'none' ? this.editState.filter : '';
    const adjustParts: string[] = [];
    if (this.editState.brightness !== 1) adjustParts.push(`brightness(${this.editState.brightness})`);
    if (this.editState.contrast !== 1) adjustParts.push(`contrast(${this.editState.contrast})`);
    if (this.editState.saturation !== 1) adjustParts.push(`saturate(${this.editState.saturation})`);
    if (adjustParts.length) filterStr = (filterStr ? filterStr + ' ' : '') + adjustParts.join(' ');
    if (filterStr) ctx.filter = filterStr;

    // Rotation
    ctx.translate(drawW / 2, drawH / 2);
    ctx.rotate((rot * Math.PI) / 180);
    const rW = isRotated ? drawH : drawW;
    const rH = isRotated ? drawW : drawH;
    ctx.drawImage(this.img, -rW / 2, -rH / 2, rW, rH);
    ctx.restore();

    // Draw crop overlay
    if (this.activeTab === 'crop') {
      const s = this.editState;
      const cx = s.cropX / this.displayScale;
      const cy = s.cropY / this.displayScale;
      const cw = s.cropW / this.displayScale;
      const ch = s.cropH / this.displayScale;

      // Dim area outside crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, drawW, cy);
      ctx.fillRect(0, cy + ch, drawW, drawH - cy - ch);
      ctx.fillRect(0, cy, cx, ch);
      ctx.fillRect(cx + cw, cy, drawW - cx - cw, ch);

      // Crop border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, cw, ch);

      // Grid lines (rule of thirds)
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + (cw * i) / 3, cy);
        ctx.lineTo(cx + (cw * i) / 3, cy + ch);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy + (ch * i) / 3);
        ctx.lineTo(cx + cw, cy + (ch * i) / 3);
        ctx.stroke();
      }

      // Corner handles (L-shaped brackets)
      const hl = Math.min(20, cw / 4, ch / 4); // handle arm length
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      // Top-left
      ctx.beginPath();
      ctx.moveTo(cx, cy + hl);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + hl, cy);
      ctx.stroke();

      // Top-right
      ctx.beginPath();
      ctx.moveTo(cx + cw - hl, cy);
      ctx.lineTo(cx + cw, cy);
      ctx.lineTo(cx + cw, cy + hl);
      ctx.stroke();

      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(cx, cy + ch - hl);
      ctx.lineTo(cx, cy + ch);
      ctx.lineTo(cx + hl, cy + ch);
      ctx.stroke();

      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(cx + cw - hl, cy + ch);
      ctx.lineTo(cx + cw, cy + ch);
      ctx.lineTo(cx + cw, cy + ch - hl);
      ctx.stroke();
    }

    this.cdr.detectChanges();
  }

  private generateFilterThumbs() {
    const size = 80;
    const fc = this.filterCanvas()?.nativeElement;
    if (!fc) return;
    fc.width = size;
    fc.height = size;
    const ctx = fc.getContext('2d')!;

    this.filterThumbs = this.filters.map(f => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      if (f.filter !== 'none') ctx.filter = f.filter;
      const aspect = this.img.width / this.img.height;
      let sw = size, sh = size;
      if (aspect > 1) sh = size / aspect;
      else sw = size * aspect;
      ctx.drawImage(this.img, (size - sw) / 2, (size - sh) / 2, sw, sh);
      ctx.restore();
      return fc.toDataURL('image/jpeg', 0.6);
    });
    this.cdr.detectChanges();
  }

  // ── Tool actions ──

  selectFilter(filter: string) {
    this.editState = { ...this.editState, filter };
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  onAdjust() {
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  rotate() {
    const rot = (this.editState.rotation + 90) % 360;
    const isNowRotated = rot === 90 || rot === 270;
    // Reset crop to full image after rotation
    const w = isNowRotated ? this.img.height : this.img.width;
    const h = isNowRotated ? this.img.width : this.img.height;
    this.editState = { ...this.editState, rotation: rot, cropX: 0, cropY: 0, cropW: w, cropH: h };
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  setAspectRatio(ratio: number) {
    this.activeAspect = ratio;
    const rot = this.editState.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const imgW = isRotated ? this.img.height : this.img.width;
    const imgH = isRotated ? this.img.width : this.img.height;

    if (ratio === 0) {
      // Free — reset to full
      this.editState = { ...this.editState, cropX: 0, cropY: 0, cropW: imgW, cropH: imgH };
    } else {
      // Fit ratio within image bounds, centered
      let cw = imgW;
      let ch = cw / ratio;
      if (ch > imgH) {
        ch = imgH;
        cw = ch * ratio;
      }
      const cx = (imgW - cw) / 2;
      const cy = (imgH - ch) / 2;
      this.editState = { ...this.editState, cropX: Math.round(cx), cropY: Math.round(cy), cropW: Math.round(cw), cropH: Math.round(ch) };
    }
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  resetCrop() {
    this.activeAspect = 0;
    const rot = this.editState.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const imgW = isRotated ? this.img.height : this.img.width;
    const imgH = isRotated ? this.img.width : this.img.height;
    this.editState = { ...this.editState, cropX: 0, cropY: 0, cropW: imgW, cropH: imgH };
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  // ── Crop interaction ──

  onCropPointerDown(event: PointerEvent) {
    if (this.activeTab !== 'crop') return;
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    this.canvasRect = el.getBoundingClientRect();
    el.setPointerCapture(event.pointerId);

    const px = event.clientX - this.canvasRect.left;
    const py = event.clientY - this.canvasRect.top;

    // Current crop rect in display coordinates
    const cx = this.editState.cropX / this.displayScale;
    const cy = this.editState.cropY / this.displayScale;
    const cw = this.editState.cropW / this.displayScale;
    const ch = this.editState.cropH / this.displayScale;

    const hit = this.HANDLE_HIT;

    // Check corners first
    if (Math.abs(px - cx) < hit && Math.abs(py - cy) < hit) {
      this.cropMode = 'resize-tl';
    } else if (Math.abs(px - (cx + cw)) < hit && Math.abs(py - cy) < hit) {
      this.cropMode = 'resize-tr';
    } else if (Math.abs(px - cx) < hit && Math.abs(py - (cy + ch)) < hit) {
      this.cropMode = 'resize-bl';
    } else if (Math.abs(px - (cx + cw)) < hit && Math.abs(py - (cy + ch)) < hit) {
      this.cropMode = 'resize-br';
    } else if (px >= cx && px <= cx + cw && py >= cy && py <= cy + ch) {
      // Inside crop → move mode
      this.cropMode = 'move';
    } else {
      this.cropMode = 'none';
      return;
    }

    this.cropDragStartX = px;
    this.cropDragStartY = py;
    this.cropOrigX = this.editState.cropX;
    this.cropOrigY = this.editState.cropY;
    this.cropOrigW = this.editState.cropW;
    this.cropOrigH = this.editState.cropH;
  }

  onCropPointerMove(event: PointerEvent) {
    if (this.cropMode === 'none' || !this.canvasRect) return;
    const el = this.canvas()?.nativeElement;
    if (!el) return;

    const px = event.clientX - this.canvasRect.left;
    const py = event.clientY - this.canvasRect.top;
    const dx = (px - this.cropDragStartX) * this.displayScale;
    const dy = (py - this.cropDragStartY) * this.displayScale;

    const rot = this.editState.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const imgW = isRotated ? this.img.height : this.img.width;
    const imgH = isRotated ? this.img.width : this.img.height;

    let newX = this.cropOrigX;
    let newY = this.cropOrigY;
    let newW = this.cropOrigW;
    let newH = this.cropOrigH;

    if (this.cropMode === 'move') {
      newX = this.cropOrigX + dx;
      newY = this.cropOrigY + dy;
      // Clamp position
      newX = Math.max(0, Math.min(newX, imgW - newW));
      newY = Math.max(0, Math.min(newY, imgH - newH));
    } else {
      // Resize from corner
      switch (this.cropMode) {
        case 'resize-tl':
          newX = this.cropOrigX + dx;
          newY = this.cropOrigY + dy;
          newW = this.cropOrigW - dx;
          newH = this.cropOrigH - dy;
          break;
        case 'resize-tr':
          newY = this.cropOrigY + dy;
          newW = this.cropOrigW + dx;
          newH = this.cropOrigH - dy;
          break;
        case 'resize-bl':
          newX = this.cropOrigX + dx;
          newW = this.cropOrigW - dx;
          newH = this.cropOrigH + dy;
          break;
        case 'resize-br':
          newW = this.cropOrigW + dx;
          newH = this.cropOrigH + dy;
          break;
      }

      // Enforce aspect ratio if set
      if (this.activeAspect > 0) {
        const targetH = newW / this.activeAspect;
        if (this.cropMode === 'resize-tl' || this.cropMode === 'resize-bl') {
          // Anchor right side
          const rightEdge = newX + newW;
          newH = targetH;
          if (this.cropMode === 'resize-tl') {
            newY = this.cropOrigY + this.cropOrigH - newH;
          }
        } else {
          // Anchor left side
          newH = targetH;
          if (this.cropMode === 'resize-tr') {
            newY = this.cropOrigY + this.cropOrigH - newH;
          }
        }
      }

      // Enforce minimum size
      const minSize = 30;
      if (newW < minSize) newW = minSize;
      if (newH < minSize) newH = minSize;

      // Clamp to image bounds
      if (newX < 0) { newW += newX; newX = 0; }
      if (newY < 0) { newH += newY; newY = 0; }
      if (newX + newW > imgW) newW = imgW - newX;
      if (newY + newH > imgH) newH = imgH - newY;
    }

    this.editState = {
      ...this.editState,
      cropX: Math.round(newX),
      cropY: Math.round(newY),
      cropW: Math.round(newW),
      cropH: Math.round(newH),
    };
    this.editStateChange.emit(this.editState);
    this.renderPreview();
  }

  onCropPointerUp() {
    this.cropMode = 'none';
  }

  switchTab(tab: 'crop' | 'filters' | 'adjust' | 'rotate') {
    this.activeTab = tab;
    this.renderPreview();
  }

  // ── Export ──

  async exportBlob(): Promise<Blob> {
    const s = this.editState;
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d')!;

    offscreen.width = s.cropW;
    offscreen.height = s.cropH;

    // Build filter
    let filterStr = s.filter !== 'none' ? s.filter : '';
    const adjustParts: string[] = [];
    if (s.brightness !== 1) adjustParts.push(`brightness(${s.brightness})`);
    if (s.contrast !== 1) adjustParts.push(`contrast(${s.contrast})`);
    if (s.saturation !== 1) adjustParts.push(`saturate(${s.saturation})`);
    if (adjustParts.length) filterStr = (filterStr ? filterStr + ' ' : '') + adjustParts.join(' ');
    if (filterStr) ctx.filter = filterStr;

    // Draw with rotation + crop
    const rot = s.rotation % 360;
    const isRotated = rot === 90 || rot === 270;
    const fullW = isRotated ? this.img.height : this.img.width;
    const fullH = isRotated ? this.img.width : this.img.height;

    ctx.save();
    ctx.translate(-s.cropX, -s.cropY);
    ctx.translate(fullW / 2, fullH / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(this.img, -this.img.width / 2, -this.img.height / 2);
    ctx.restore();

    return new Promise((resolve) => {
      offscreen.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92);
    });
  }
}
