import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNav } from './shared/components/bottom-nav/bottom-nav';
import { AuthService } from './core/services/auth.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  authService = inject(AuthService);
  protected readonly title = signal('voyaa');
  isOffline = signal(false);
  showVerifyBanner = signal(false);
  private onlineHandler = () => this.isOffline.set(false);
  private offlineHandler = () => this.isOffline.set(true);

  ngOnInit() {
    this.isOffline.set(!navigator.onLine);
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
  }

  dismissVerifyBanner() {
    this.showVerifyBanner.set(false);
  }
}
