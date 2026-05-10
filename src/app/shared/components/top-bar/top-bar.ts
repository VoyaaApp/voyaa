import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../../core/services/firebase.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
})
export class TopBar implements OnInit, OnDestroy {
  unreadCount = 0;
  unreadMessages = 0;
  get totalUnread() { return this.unreadCount + this.unreadMessages; }
  private unsubscribe: (() => void) | null = null;
  private unsubMessages: (() => void) | null = null;

  authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  ngOnInit() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;

    const q = query(
      collection(db, 'users', uid, 'notifications'),
      where('read', '==', false)
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      this.unreadCount = snapshot.size;
      this.cdr.detectChanges();
    });

    // Listen for unread messages
    const mq = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    this.unsubMessages = onSnapshot(mq, (snapshot) => {
      let total = 0;
      snapshot.docs.forEach(d => {
        total += d.data()['unreadCount_' + uid] || 0;
      });
      this.unreadMessages = total;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubMessages) this.unsubMessages();
  }
}
