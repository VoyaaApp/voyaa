import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  template: `
    @if (visible()) {
      <div class="dialog-backdrop" (click)="cancelled.emit()"></div>
      <div class="dialog-box">
        <p class="dialog-message">{{ message() }}</p>
        <div class="dialog-actions">
          <button class="cancel-btn" (click)="cancelled.emit()">Cancel</button>
          <button class="confirm-btn" [class.destructive]="destructive()" (click)="confirmed.emit()">
            {{ confirmText() }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 300;
    }

    .dialog-box {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #1a1a1a;
      border-radius: 14px;
      padding: 24px;
      z-index: 301;
      width: 280px;
      animation: dialogIn 0.2s ease-out;
    }

    .dialog-message {
      color: #fff;
      font-size: 15px;
      text-align: center;
      line-height: 1.4;
      margin-bottom: 20px;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;

      button {
        flex: 1;
        padding: 11px;
        border-radius: 8px;
        border: none;
        font-size: 14px;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        cursor: pointer;
        transition: opacity 0.2s;

        &:hover {
          opacity: 0.85;
        }
      }

      .cancel-btn {
        background: #333;
        color: #fff;
      }

      .confirm-btn {
        background: linear-gradient(135deg, #FF6B6B, #FF8E53);
        color: #fff;

        &.destructive {
          background: #ff4d4d;
        }
      }
    }

    @keyframes dialogIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
  `,
})
export class ConfirmDialog {
  visible = input(false);
  message = input('Are you sure?');
  confirmText = input('Confirm');
  destructive = input(false);

  confirmed = output();
  cancelled = output();
}
