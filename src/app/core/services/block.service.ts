import { Injectable, inject, effect } from '@angular/core';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class BlockService {
  private authService = inject(AuthService);
  private blockedIds = new Set<string>();
  private unsub: (() => void) | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    // Clean up listener when user logs out
    effect(() => {
      const user = this.authService.currentUser();
      if (!user) {
        this.destroy();
      }
    });
  }

  /** Ensure blocked list is loaded (safe to call multiple times) */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) { this.loaded = true; return; }
    const snap = await getDocs(collection(db, 'users', uid, 'blockedUsers'));
    this.blockedIds = new Set(snap.docs.map(d => d.id));
    this.loaded = true;
    this.listen(uid);
  }

  /** Live-sync blocked list so changes are reflected immediately */
  private listen(uid: string) {
    this.unsub?.();
    this.unsub = onSnapshot(collection(db, 'users', uid, 'blockedUsers'), (snap) => {
      this.blockedIds = new Set(snap.docs.map(d => d.id));
    });
  }

  /** Check if a user is blocked */
  isBlocked(userId: string): boolean {
    return this.blockedIds.has(userId);
  }

  /** Add to local set immediately (Firestore write handled by caller) */
  addBlock(userId: string) {
    this.blockedIds.add(userId);
  }

  /** Remove from local set immediately (Firestore write handled by caller) */
  removeBlock(userId: string) {
    this.blockedIds.delete(userId);
  }

  /** Get the full set for bulk filtering */
  get blocked(): Set<string> {
    return this.blockedIds;
  }

  destroy() {
    this.unsub?.();
    this.unsub = null;
    this.blockedIds.clear();
    this.loaded = false;
    this.loadPromise = null;
  }
}
