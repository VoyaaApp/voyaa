import { Component, Input, Output, EventEmitter, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from '../../../core/services/firebase.service';

@Component({
  selector: 'app-report-panel',
  imports: [FormsModule],
  template: `
    @if (visible) {
      <div class="report-backdrop" (click)="close()"></div>
      <div class="report-panel">
        <div class="report-header">
          <h3>Report Content</h3>
          <button (click)="close()" aria-label="Close">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        @if (reportSuccess) {
          <div class="report-body">
            <span class="material-symbols-rounded report-icon">check_circle</span>
            <p>Report submitted. We'll review it shortly.</p>
            <button class="report-done-btn" (click)="close()">Done</button>
          </div>
        } @else {
          <div class="report-body">
            <p class="report-prompt">Why are you reporting this?</p>
            @for (reason of reasons; track reason) {
              <label class="report-option" [class.selected]="reportReason === reason">
                <input type="radio" name="reportReason" [value]="reason" [(ngModel)]="reportReason">
                {{ reason }}
              </label>
            }
            <textarea [(ngModel)]="reportDetails" placeholder="Additional details (optional)" rows="3" aria-label="Report details"></textarea>
            <button class="report-submit-btn" (click)="submitReport()" [disabled]="!reportReason || reportLoading">
              {{ reportLoading ? 'Submitting...' : 'Submit Report' }}
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .report-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 9998;
    }

    .report-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1a1a1a;
      border-radius: 16px 16px 0 0;
      z-index: 9999;
      max-height: 80vh;
      overflow-y: auto;
      padding-bottom: env(safe-area-inset-bottom);

      @media (min-width: 768px) {
        left: 50%;
        bottom: auto;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 400px;
        border-radius: 12px;
        max-height: 70vh;
      }
    }

    .report-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);

      h3 {
        font-size: 16px;
        font-weight: 600;
        color: #fff;
        margin: 0;
      }

      button {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        padding: 4px;
        display: flex;
      }
    }

    .report-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;

      .report-icon {
        font-size: 48px;
        color: #7ec8a4;
        text-align: center;
        display: block;
        margin: 8px auto;
      }

      .report-prompt {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.6);
        margin: 0 0 4px;
      }

      .report-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;

        &:hover { background: rgba(255, 255, 255, 0.04); }
        &.selected {
          border-color: #3891a6;
          background: rgba(56, 145, 166, 0.1);
        }

        input[type="radio"] { accent-color: #3891a6; }
      }

      textarea {
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: #0a0a0a;
        color: #fff;
        font-size: 14px;
        font-family: 'Inter', sans-serif;
        resize: none;

        &::placeholder { color: #555; }
      }

      .report-submit-btn {
        padding: 12px;
        border-radius: 8px;
        border: none;
        background: linear-gradient(135deg, #3891a6, #7ec8a4);
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 4px;
        transition: opacity 0.2s;

        &:hover { opacity: 0.9; }
        &:disabled { opacity: 0.5; cursor: not-allowed; }
      }

      .report-done-btn {
        padding: 12px;
        border-radius: 8px;
        border: none;
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        margin-top: 8px;
      }

      p {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.6);
        text-align: center;
        margin: 0;
      }
    }
  `,
})
export class ReportPanel {
  @Input() visible = false;
  @Input() contentId = '';
  @Input() contentType: 'video' | 'post' | 'comment' = 'post';
  @Input() contentOwnerId = '';
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape() { if (this.visible) this.closed.emit(); }

  private cdr = inject(ChangeDetectorRef);

  reasons = ['Spam', 'Harassment', 'Inappropriate content', 'Nudity or sexual content', 'Violence', 'Other'];
  reportReason = '';
  reportDetails = '';
  reportLoading = false;
  reportSuccess = false;

  async submitReport() {
    const uid = auth.currentUser?.uid;
    if (!uid || !this.reportReason) return;
    this.reportLoading = true;
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: uid,
        reportedUserId: this.contentOwnerId,
        reportedContentId: this.contentId,
        contentType: this.contentType,
        reason: this.reportReason,
        details: this.reportDetails.trim(),
        createdAt: new Date().toISOString(),
      });
      this.reportSuccess = true;
    } catch {
      // silently fail
    } finally {
      this.reportLoading = false;
      this.cdr.detectChanges();
    }
  }

  close() {
    this.visible = false;
    this.reportReason = '';
    this.reportDetails = '';
    this.reportSuccess = false;
    this.reportLoading = false;
    this.closed.emit();
  }
}
