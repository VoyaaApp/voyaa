import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { collection, getDocs, orderBy, query, doc, writeBatch, where, onSnapshot, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { timeAgo } from '../../shared/utils/time';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

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
  selector: 'app-activity',
  imports: [RouterLink, FormsModule],
  templateUrl: './activity.html',
  styleUrl: './activity.scss',
})
export class Activity implements OnInit, OnDestroy {
  activeTab: 'activity' | 'messages' = 'activity';
  notifications: any[] = [];
  loading = true;
  timeAgo = timeAgo;

  // Messages
  conversations: Conversation[] = [];
  messagesLoading = true;
  searchQuery = '';
  searchResults: any[] = [];
  showSearch = false;
  private searchTimer: any = null;
  private unsubMessages: (() => void) | null = null;

  authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private location = inject(Location);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  goBack() {
    // If we arrived via query param (from chat back button), go to explore
    // to avoid activity/messages navigation loop
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab) {
      this.router.navigate(['/explore'], { replaceUrl: true });
    } else {
      this.location.back();
    }
  }

  async ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'messages') this.activeTab = 'messages';
    await this.loadNotifications();
    this.loadConversations();
  }

  ngOnDestroy() {
    this.unsubMessages?.();
    clearTimeout(this.searchTimer);
  }

  switchTab(tab: 'activity' | 'messages') {
    this.activeTab = tab;
  }

  // ── Notifications ──

  private async loadNotifications() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;

    const q = query(
      collection(db, 'users', uid, 'notifications'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    this.notifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

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
      case 'like': return `liked your post`;
      case 'follow': return `started following you`;
      case 'comment': return `commented on your post`;
      default: return 'interacted with you';
    }
  }

  // ── Messages ──

  private loadConversations() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );

    this.unsubMessages = onSnapshot(q, async (snapshot) => {
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

      // Sort by most recent
      convos.sort((a, b) => {
        const aMs = a.lastMessageTime?.toMillis?.() || a.lastMessageTime?.seconds * 1000 || 0;
        const bMs = b.lastMessageTime?.toMillis?.() || b.lastMessageTime?.seconds * 1000 || 0;
        return bMs - aMs;
      });

      this.conversations = convos;
      this.messagesLoading = false;
      this.cdr.detectChanges();
    }, () => {
      // If query fails (e.g. no index), still stop loading
      this.messagesLoading = false;
      this.cdr.detectChanges();
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
    } catch {}
  }

  async startConversation(recipientId: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const existing = this.conversations.find(c => c.recipientId === recipientId);
    if (existing) {
      this.router.navigate(['/messages', existing.id]);
      return;
    }

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

  msgTimeAgo(timestamp: any): string {
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
