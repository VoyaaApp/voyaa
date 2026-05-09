import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
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
  private unsubscribe: (() => void) | null = null;

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
  }

  ngOnDestroy() {
    if (this.unsubscribe) this.unsubscribe();
  }
}
