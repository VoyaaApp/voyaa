import { Injectable, inject, signal, effect } from '@angular/core';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class UnreadService {
  private authService = inject(AuthService);

  readonly unreadMessages = signal(0);
  readonly unreadNotifications = signal(0);

  private unsubMessages: (() => void) | null = null;
  private unsubNotifications: (() => void) | null = null;
  private listening = false;

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      if (user && !this.listening) {
        this.startListening(user.uid);
      } else if (!user && this.listening) {
        this.stopListening();
      }
    });
  }

  private startListening(uid: string) {
    this.listening = true;

    const mq = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    this.unsubMessages = onSnapshot(mq, (snapshot) => {
      let total = 0;
      snapshot.docs.forEach(d => {
        total += d.data()['unreadCount_' + uid] || 0;
      });
      this.unreadMessages.set(total);
    });

    const nq = query(
      collection(db, 'users', uid, 'notifications'),
      where('read', '==', false)
    );
    this.unsubNotifications = onSnapshot(nq, (snapshot) => {
      this.unreadNotifications.set(snapshot.size);
    });
  }

  private stopListening() {
    this.unsubMessages?.();
    this.unsubNotifications?.();
    this.unsubMessages = null;
    this.unsubNotifications = null;
    this.unreadMessages.set(0);
    this.unreadNotifications.set(0);
    this.listening = false;
  }
}
