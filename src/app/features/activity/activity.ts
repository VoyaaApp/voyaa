import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { Location } from '@angular/common';
import { collection, getDocs, orderBy, query, doc, writeBatch } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { timeAgo } from '../../shared/utils/time';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-activity',
  imports: [RouterLink],
  templateUrl: './activity.html',
  styleUrl: './activity.scss',
})
export class Activity implements OnInit {
  notifications: any[] = [];
  loading = true;
  timeAgo = timeAgo;

  authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private location = inject(Location);

  goBack() {
    this.location.back();
  }

  async ngOnInit() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;

    const q = query(
      collection(db, 'users', uid, 'notifications'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    this.notifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Batch mark all as read
    const unread = this.notifications.filter(n => !n.read);
    if (unread.length > 0) {
      const batch = writeBatch(db);
      for (const notif of unread) {
        batch.update(doc(db, 'users', uid, 'notifications', notif.id), { read: true });
      }
      await batch.commit();
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  getIcon(type: string): string {
    switch (type) {
      case 'like': return 'favorite';
      case 'follow': return 'person_add';
      case 'comment': return 'chat_bubble';
      default: return 'notifications';
    }
  }

  getMessage(notif: any): string {
    switch (notif.type) {
      case 'like': return `liked your video`;
      case 'follow': return `started following you`;
      case 'comment': return `commented on your video`;
      default: return 'interacted with you';
    }
  }
}
