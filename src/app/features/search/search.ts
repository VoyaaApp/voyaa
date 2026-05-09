import { Component, inject, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { db } from '../../core/services/firebase.service';
import { collection, getDocs } from 'firebase/firestore';

@Component({
  selector: 'app-search',
  imports: [FormsModule],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class Search implements OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  searchQuery = '';
  results: any[] = [];
  hasSearched = false;
  searching = false;
  private debounceTimer: any = null;
  cachedUsers: any[] | null = null;

  ngOnDestroy() {
    clearTimeout(this.debounceTimer);
  }

  onInputChange() {
    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.results = [];
      this.hasSearched = false;
      return;
    }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onSearch(), 300);
  }

  async onSearch() {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return;

    this.searching = true;
    this.hasSearched = true;
    this.cdr.detectChanges();

    if (!this.cachedUsers) {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      this.cachedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    }

    this.results = this.cachedUsers
      .filter((user: any) => user.username?.toLowerCase().includes(q));

    this.searching = false;
    this.cdr.detectChanges();
  }

  goToProfile(uid: string) {
    this.router.navigate(['/profile', uid]);
  }
}
