import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UnreadService } from '../../../core/services/unread.service';

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopBar {
  private unread = inject(UnreadService);

  get unreadCount() { return this.unread.unreadNotifications(); }
  get unreadMessages() { return this.unread.unreadMessages(); }
}
