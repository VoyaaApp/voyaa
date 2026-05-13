import { Component, inject, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { db } from '../../core/services/firebase.service';
import { collection, getDocs } from 'firebase/firestore';

@Component({
  selector: 'app-search',
  imports: [FormsModule],
  templateUrl: './search.html',
  styleUrl: './search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search implements OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  searchQuery = '';
  results: any[] = [];
  suggestedUsers: any[] = [];
  hasSearched = false;
  searching = false;
  showSuggestions = false;
  private debounceTimer: any = null;
  cachedUsers: any[] | null = null;

  ngOnDestroy() {
    clearTimeout(this.debounceTimer);
  }

  private readonly FEATURED_UID = 'JEppIX3EG0PTjXJ0jL3CT3GXRvJ3';

  async onFocus() {
    if (this.searchQuery.trim().length >= 2) return;
    if (!this.cachedUsers) {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      this.cachedUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    }
    const sorted = [...this.cachedUsers];
    const idx = sorted.findIndex((u: any) => u.uid === this.FEATURED_UID);
    if (idx > 0) {
      const [featured] = sorted.splice(idx, 1);
      sorted.unshift(featured);
    }
    this.suggestedUsers = sorted.slice(0, 10);
    this.showSuggestions = true;
    this.cdr.detectChanges();
  }

  onInputChange() {
    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.results = [];
      this.hasSearched = false;
      this.showSuggestions = q.length === 0;
      return;
    }
    this.showSuggestions = false;
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
