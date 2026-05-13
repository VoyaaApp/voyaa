import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { collection, query, where, orderBy, onSnapshot, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthService } from '../../core/services/auth.service';
import { BlockService } from '../../core/services/block.service';
import { Location } from '@angular/common';

interface Conversation {
  id: string;
  recipientId: string;
  recipientName: string;
  recipientAvatar: string;
  lastMessage: string;
  lastMessageTime: any;
  unreadCount: number;
}

@Component({
  selector: 'app-messages',
  imports: [FormsModule],
  templateUrl: './messages.html',
  styleUrl: './messages.scss',
})
export class Messages implements OnInit, OnDestroy {
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private location = inject(Location);
  authService = inject(AuthService);
  private blockService = inject(BlockService);

  conversations: Conversation[] = [];
  loading = true;
  searchQuery = '';
  searchResults: any[] = [];
  showSearch = false;
  private searchTimer: any = null;
  private unsubscribe: (() => void) | null = null;

  ngOnInit() {
    this.loadConversations();
  }

  ngOnDestroy() {
    if (this.unsubscribe) this.unsubscribe();
    clearTimeout(this.searchTimer);
  }

  goBack() {
    this.location.back();
  }

  private loadConversations() {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }

      const uid = user.uid;
      this.blockService.ensureLoaded();

      const q = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', uid),
        orderBy('updatedAt', 'desc')
      );

      this.unsubscribe = onSnapshot(q, async (snapshot) => {
        const convos: Conversation[] = [];

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const recipientId = (data['participants'] as string[]).find(id => id !== uid)!;

          let recipientName = 'Unknown';
          let recipientAvatar = '';
          try {
            const userDoc = await getDoc(doc(db, 'users', recipientId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              recipientName = userData['username'] || 'Unknown';
              recipientAvatar = userData['photoURL'] || '';
            }
          } catch {}

          const unreadCount = data['unreadCount_' + uid] || 0;

          convos.push({
            id: docSnap.id,
            recipientId,
            recipientName,
            recipientAvatar,
            lastMessage: data['lastMessage'] || '',
            lastMessageTime: data['updatedAt'],
            unreadCount,
          });
        }

        this.conversations = convos.filter(c => !this.blockService.isBlocked(c.recipientId));
        this.loading = false;
        this.cdr.detectChanges();
      });
    });
  }

  onSearchInput() {
    clearTimeout(this.searchTimer);
    const q = this.searchQuery.trim().toLowerCase();
    if (q.length < 2) {
      this.searchResults = [];
      return;
    }
    this.searchTimer = setTimeout(() => this.searchUsers(q), 300);
  }

  private async searchUsers(q: string) {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const uid = auth.currentUser?.uid;
      this.searchResults = snapshot.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter((u: any) => u.uid !== uid && u.username?.toLowerCase().includes(q))
        .slice(0, 10);
      this.cdr.detectChanges();
    } catch {
      this.searchResults = [];
      this.cdr.detectChanges();
    }
  }

  async startConversation(recipientId: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Check for existing conversation
    const existing = this.conversations.find(c => c.recipientId === recipientId);
    if (existing) {
      this.router.navigate(['/messages', existing.id]);
      return;
    }

    // Also check Firestore for conversations not yet loaded
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    const snapshot = await getDocs(q);
    const existingDoc = snapshot.docs.find(d => {
      const participants = d.data()['participants'] as string[];
      return participants.includes(recipientId);
    });

    if (existingDoc) {
      this.router.navigate(['/messages', existingDoc.id]);
      return;
    }

    // Create new conversation
    const convoRef = await addDoc(collection(db, 'conversations'), {
      participants: [uid, recipientId],
      lastMessage: '',
      updatedAt: serverTimestamp(),
      ['unreadCount_' + uid]: 0,
      ['unreadCount_' + recipientId]: 0,
    });

    this.router.navigate(['/messages', convoRef.id]);
  }

  openChat(convo: Conversation) {
    this.router.navigate(['/messages', convo.id]);
  }

  timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const ms = timestamp?.toMillis?.() || timestamp?.seconds * 1000 || (typeof timestamp === 'string' ? new Date(timestamp).getTime() : 0);
    if (!ms) return '';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
