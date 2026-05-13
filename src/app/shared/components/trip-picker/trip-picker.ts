import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TripService, Trip, WISHLIST_ID } from '../../../core/services/trip.service';

@Component({
  selector: 'app-trip-picker',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible) {
      <div class="backdrop" (click)="close()"></div>
      <div class="sheet">
        <div class="handle"></div>
        <h3>Save to trip</h3>

        <div class="trip-list">
          <!-- Wishlist always first -->
          <button class="trip-option" [class.selected]="selectedTripId === wishlistId" (click)="select(wishlistId)">
            <span class="material-symbols-rounded trip-icon">bookmark</span>
            <span class="trip-name">Wishlist</span>
            @if (selectedTripId === wishlistId) {
              <span class="material-symbols-rounded check">check_circle</span>
            }
          </button>

          @for (trip of trips; track trip.id) {
            <button class="trip-option" [class.selected]="selectedTripId === trip.id" (click)="select(trip.id)">
              <span class="material-symbols-rounded trip-icon">luggage</span>
              <span class="trip-name">{{ trip.name }}</span>
              @if (trip.date) {
                <span class="trip-date">{{ getCountdown(trip.date) }}</span>
              }
              @if (selectedTripId === trip.id) {
                <span class="material-symbols-rounded check">check_circle</span>
              }
            </button>
          }
        </div>

        <!-- Create new trip -->
        @if (!showCreate) {
          <button class="create-btn" (click)="showCreate = true">
            <span class="material-symbols-rounded">add_circle</span>
            Create new trip
          </button>
        } @else {
          <div class="create-form">
            <input
              type="text"
              [(ngModel)]="newName"
              placeholder="Trip name (e.g. Japan 2027)"
              class="create-input"
              maxlength="50"
              (keydown.enter)="createAndSelect()">
            <div class="date-row">
              <label class="date-label">
                <span class="material-symbols-rounded">calendar_today</span>
                Departure date (optional)
              </label>
              <input type="date" [(ngModel)]="newDate" class="date-input" [min]="todayStr">
            </div>
            <div class="create-actions">
              <button class="cancel-btn" (click)="showCreate = false; newName = ''; newDate = ''">Cancel</button>
              <button class="confirm-btn" [disabled]="!newName.trim()" (click)="createAndSelect()">Create & Save</button>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 1000;
      animation: fadeIn 0.2s ease-out;
    }

    .sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1a1a1a;
      border-radius: 16px 16px 0 0;
      padding: 12px 20px;
      padding-bottom: max(20px, env(safe-area-inset-bottom));
      z-index: 1001;
      max-height: 70vh;
      overflow-y: auto;
      animation: slideUp 0.25s ease-out;

      @media (min-width: 768px) {
        bottom: auto;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 400px;
        border-radius: 16px;
        animation: fadeScale 0.2s ease-out;
      }
    }

    .handle {
      width: 36px;
      height: 4px;
      background: #444;
      border-radius: 2px;
      margin: 0 auto 16px;

      @media (min-width: 768px) { display: none; }
    }

    h3 {
      color: #fff;
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 16px;
    }

    .trip-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .trip-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 12px;
      background: none;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
      width: 100%;
      text-align: left;
      font-family: 'Inter', sans-serif;

      &:hover { background: rgba(255, 255, 255, 0.05); }
      &.selected { background: rgba(56, 145, 166, 0.12); }

      .trip-icon {
        font-size: 22px;
        color: rgba(255, 255, 255, 0.4);
      }

      .trip-name {
        flex: 1;
        color: #fff;
        font-size: 15px;
        font-weight: 500;
      }

      .trip-date {
        color: rgba(255, 255, 255, 0.35);
        font-size: 12px;
      }

      .check {
        font-size: 20px;
        color: #3891a6;
        font-variation-settings: 'FILL' 1;
      }
    }

    .create-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 14px 12px;
      margin-top: 8px;
      background: none;
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      color: #3891a6;
      font-size: 15px;
      font-weight: 500;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
      transition: background 0.15s;

      &:hover { background: rgba(255, 255, 255, 0.03); }

      .material-symbols-rounded { font-size: 22px; }
    }

    .create-form {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .create-input {
      width: 100%;
      padding: 12px 14px;
      background: #111;
      border: 1px solid #333;
      border-radius: 10px;
      color: #fff;
      font-size: 15px;
      font-family: 'Inter', sans-serif;
      outline: none;
      box-sizing: border-box;

      &::placeholder { color: #555; }
      &:focus { border-color: #3891a6; }
    }

    .date-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .date-label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 13px;

      .material-symbols-rounded { font-size: 16px; }
    }

    .date-input {
      padding: 10px 14px;
      background: #111;
      border: 1px solid #333;
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      font-family: 'Inter', sans-serif;
      outline: none;
      color-scheme: dark;

      &:focus { border-color: #3891a6; }
    }

    .create-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .cancel-btn {
      padding: 10px 18px;
      background: none;
      border: 1px solid #333;
      border-radius: 8px;
      color: #aaa;
      font-size: 14px;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
    }

    .confirm-btn {
      padding: 10px 18px;
      background: linear-gradient(135deg, #3891a6, #7ec8a4);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      font-family: 'Inter', sans-serif;
      cursor: pointer;

      &:disabled { opacity: 0.4; cursor: default; }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }

    @keyframes fadeScale {
      from { opacity: 0; transform: translate(-50%, -48%); }
      to { opacity: 1; transform: translate(-50%, -50%); }
    }
  `],
})
export class TripPicker {
  @Input() visible = false;
  @Input() trips: Trip[] = [];
  @Output() selected = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
  @Output() tripCreated = new EventEmitter<Trip>();

  wishlistId = WISHLIST_ID;
  selectedTripId = WISHLIST_ID;
  showCreate = false;
  newName = '';
  newDate = '';
  todayStr = new Date().toISOString().split('T')[0];

  private cdr = inject(ChangeDetectorRef);
  private tripService = inject(TripService);

  select(tripId: string) {
    this.selectedTripId = tripId;
    this.selected.emit(tripId);
    this.close();
  }

  close() {
    this.showCreate = false;
    this.newName = '';
    this.newDate = '';
    this.closed.emit();
  }

  async createAndSelect() {
    const name = this.newName.trim();
    if (!name) return;
    const trip = await this.tripService.createTrip(name, this.newDate || undefined);
    this.tripCreated.emit(trip);
    this.select(trip.id);
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
