import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, ChangeDetectionStrategy, ElementRef, viewChild, AfterViewChecked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from '../../core/services/firebase.service';
import { AuthService } from '../../core/services/auth.service';
import { BlockService } from '../../core/services/block.service';

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: any;
}

@Component({
  selector: 'app-chat',
  imports: [FormsModule],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat implements OnInit, OnDestroy, AfterViewChecked {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private location = inject(Location);
  authService = inject(AuthService);
  private blockService = inject(BlockService);

  messagesContainer = viewChild<ElementRef>('messagesContainer');

  conversationId = '';
  recipientName = '';
  recipientAvatar = '';
  recipientId = '';
  messages: ChatMessage[] = [];
  newMessage = '';
  loading = true;
  isBlockedConversation = false;
  private unsubscribe: (() => void) | null = null;
  private shouldScroll = false;
  private markedRead = false;

  ngOnInit() {
    this.conversationId = this.route.snapshot.paramMap.get('conversationId') || '';
    if (this.conversationId) {
      this.loadConversationInfo();
      this.loadMessages();
      this.markAsRead();
    }
  }

  ngOnDestroy() {
    if (this.unsubscribe) this.unsubscribe();
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  goBack() {
    this.router.navigate(['/messages'], { replaceUrl: true });
  }

  goToProfile() {
    if (this.recipientId) {
      this.router.navigate(['/profile', this.recipientId]);
    }
  }

  private async loadConversationInfo() {
    try {
      const convoDoc = await getDoc(doc(db, 'conversations', this.conversationId));
      if (!convoDoc.exists()) return;
      const data = convoDoc.data();
      const uid = auth.currentUser?.uid;
      this.recipientId = (data['participants'] as string[]).find(id => id !== uid) || '';

      if (this.recipientId) {
        const userDoc = await getDoc(doc(db, 'users', this.recipientId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          this.recipientName = userData['username'] || 'Unknown';
          this.recipientAvatar = userData['photoURL'] || '';
        }
        // Check both directions of blocking
        const uid = auth.currentUser?.uid;
        if (uid) {
          const [blockedByMe, blockedByThem] = await Promise.all([
            getDoc(doc(db, 'users', uid, 'blockedUsers', this.recipientId)),
            getDoc(doc(db, 'users', this.recipientId, 'blockedUsers', uid)),
          ]);
          this.isBlockedConversation = blockedByMe.exists() || blockedByThem.exists();
        }
      }
      this.cdr.detectChanges();
    } catch {}
  }

  private loadMessages() {
    const q = query(
      collection(db, 'conversations', this.conversationId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      this.messages = snapshot.docs.map(d => ({
        id: d.id,
        senderId: d.data()['senderId'],
        text: d.data()['text'],
        createdAt: d.data()['createdAt'],
      }));
      this.loading = false;
      this.shouldScroll = true;
      if (!this.markedRead) {
        this.markedRead = true;
        this.markAsRead();
      }
      this.cdr.detectChanges();
    });
  }

  async sendMessage() {
    const text = this.newMessage.trim();
    if (!text || this.isBlockedConversation) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    this.newMessage = '';

    try {
      await addDoc(collection(db, 'conversations', this.conversationId, 'messages'), {
        senderId: uid,
        text,
        createdAt: serverTimestamp(),
      });

      // Update conversation metadata
      await updateDoc(doc(db, 'conversations', this.conversationId), {
        lastMessage: text,
        updatedAt: serverTimestamp(),
        ['unreadCount_' + this.recipientId]: increment(1),
      });

      // If onSnapshot hasn't picked it up yet, manually add
      if (!this.messages.some(m => m.text === text && m.senderId === uid)) {
        this.messages = [...this.messages, {
          id: 'pending-' + Date.now(),
          senderId: uid,
          text,
          createdAt: { toMillis: () => Date.now() },
        }];
        this.shouldScroll = true;
        this.cdr.detectChanges();
      }
    } catch {}
  }

  private async markAsRead() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'conversations', this.conversationId), {
        ['unreadCount_' + uid]: 0,
      });
    } catch {}
  }

  private scrollToBottom() {
    const el = this.messagesContainer()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  isOwnMessage(msg: ChatMessage): boolean {
    return msg.senderId === auth.currentUser?.uid;
  }

  formatTime(timestamp: any): string {
    if (!timestamp) return '';
    const ms = timestamp?.toMillis?.() || timestamp?.seconds * 1000 || 0;
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
