import {
  Component, Input, Output, EventEmitter, OnChanges, OnDestroy,
  SimpleChanges, inject, ChangeDetectorRef, ChangeDetectionStrategy,
  ElementRef, viewChild, HostListener,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  collection, doc, getDoc, setDoc, deleteDoc, updateDoc,
  increment, addDoc, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { db, auth } from '../../../core/services/firebase.service';
import { ContentFilterService } from '../../../core/services/content-filter.service';
import { BlockService } from '../../../core/services/block.service';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';
import { timeAgo } from '../../utils/time';

@Component({
  selector: 'app-comment-panel',
  imports: [FormsModule, RouterLink, ConfirmDialog],
  templateUrl: './comment-panel.html',
  styleUrl: './comment-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentPanel implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Input() collectionType: 'videos' | 'posts' = 'videos';
  @Input() itemId = '';
  @Input() itemOwnerId = '';
  @Input() itemTitle = '';

  @Output() closed = new EventEmitter<void>();
  @Output() commentCountChange = new EventEmitter<number>();

  @HostListener('document:keydown.escape')
  onEscape() { if (this.visible) this.closed.emit(); }

  comments: any[] = [];
  newComment = '';
  posting = false;
  commentError = '';
  replyingTo: any = null;
  timeAgo = timeAgo;

  showConfirm = false;
  confirmMessage = '';
  private confirmAction: (() => void) | null = null;

  commentInputRef = viewChild<ElementRef>('commentInput');
  private cdr = inject(ChangeDetectorRef);
  private contentFilter = inject(ContentFilterService);
  private blockService = inject(BlockService);
  private unsub: (() => void) | null = null;
  private destroyed = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['visible'] || changes['itemId'] || changes['collectionType']) {
      if (this.visible && this.itemId) {
        this.open();
      } else if (!this.visible) {
        this.cleanup();
      }
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.cleanup();
  }

  private open() {
    this.comments = [];
    this.replyingTo = null;
    this.newComment = '';

    const uid = auth.currentUser?.uid;
    const commentsRef = collection(db, this.collectionType, this.itemId, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    this.unsub?.();
    this.unsub = onSnapshot(q, async (snapshot) => {
      const allComments: any[] = snapshot.docs
        .map(d => ({
          id: d.id, ...d.data(), liked: false, showReplies: false, replies: [] as any[],
        }))
        .filter((c: any) => !this.blockService.isBlocked(c.userId));

      if (uid) {
        await Promise.all(allComments.map(async (comment) => {
          const likeDoc = await getDoc(
            doc(db, this.collectionType, this.itemId, 'comments', comment.id, 'likes', uid),
          );
          comment.liked = likeDoc.exists();
        }));
      }

      // Enrich missing photoURLs
      const needPhoto = allComments.filter(c => !c.photoURL);
      if (needPhoto.length > 0) {
        await Promise.all(needPhoto.map(async (comment) => {
          const uDoc = await getDoc(doc(db, 'users', comment.userId));
          comment.photoURL = uDoc.exists() ? uDoc.data()['photoURL'] || '' : '';
        }));
      }

      // Separate top-level and replies
      const topLevel = allComments.filter(c => !c.parentId);
      const replies = allComments.filter(c => c.parentId);
      const prevShowState = new Map(this.comments.map(c => [c.id, c.showReplies]));

      topLevel.forEach(c => {
        c.replies = replies.filter(r => r.parentId === c.id);
        c.replyCount = c.replies.length;
        c.showReplies = prevShowState.get(c.id) || false;
      });

      this.comments = topLevel;
      if (!this.destroyed) this.cdr.detectChanges();
    });
  }

  private cleanup() {
    this.unsub?.();
    this.unsub = null;
    this.comments = [];
    this.replyingTo = null;
    this.newComment = '';
  }

  close() {
    this.cleanup();
    this.closed.emit();
  }

  startReply(comment: any) {
    this.replyingTo = comment;
    this.newComment = '';
    this.cdr.detectChanges();
    this.commentInputRef()?.nativeElement?.focus();
  }

  cancelReply() {
    this.replyingTo = null;
    this.newComment = '';
  }

  async toggleCommentLike(comment: any) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const likeRef = doc(db, this.collectionType, this.itemId, 'comments', comment.id, 'likes', uid);
    const commentRef = doc(db, this.collectionType, this.itemId, 'comments', comment.id);

    if (comment.liked) {
      comment.liked = false;
      comment.likeCount = (comment.likeCount || 1) - 1;
      await deleteDoc(likeRef);
      await updateDoc(commentRef, { likeCount: increment(-1) });
    } else {
      comment.liked = true;
      comment.likeCount = (comment.likeCount || 0) + 1;
      await setDoc(likeRef, { userId: uid, createdAt: new Date().toISOString() });
      await updateDoc(commentRef, { likeCount: increment(1) });
    }
    this.cdr.detectChanges();
  }

  async postComment() {
    if (!this.newComment.trim() || this.posting) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (!this.contentFilter.isClean(this.newComment)) {
      this.commentError = 'Your comment contains inappropriate language. Please revise it.';
      return;
    }

    this.commentError = '';
    this.posting = true;
    const text = this.newComment.trim();
    this.newComment = '';
    const parentId = this.replyingTo?.id || null;
    this.replyingTo = null;
    this.cdr.detectChanges();

    const userDoc = await getDoc(doc(db, 'users', uid));
    const username = userDoc.exists() ? userDoc.data()['username'] : 'Anonymous';
    const photoURL = userDoc.exists() ? userDoc.data()['photoURL'] || '' : '';

    const commentData: any = {
      userId: uid, username, photoURL, text,
      createdAt: new Date().toISOString(),
      likeCount: 0,
    };
    if (parentId) commentData.parentId = parentId;
    await addDoc(collection(db, this.collectionType, this.itemId, 'comments'), commentData);

    // Update comment count on the parent document
    await updateDoc(doc(db, this.collectionType, this.itemId), { commentCount: increment(1) });
    this.commentCountChange.emit(1);

    // Expand replies if this was a reply
    if (parentId) {
      const parent = this.comments.find(c => c.id === parentId);
      if (parent) parent.showReplies = true;
    }

    // Send notification to item owner
    if (this.itemOwnerId && this.itemOwnerId !== uid) {
      await addDoc(collection(db, 'users', this.itemOwnerId, 'notifications'), {
        type: 'comment',
        fromUserId: uid,
        fromUsername: username,
        fromPhotoURL: photoURL,
        videoId: this.itemId,
        videoTitle: this.itemTitle,
        createdAt: new Date().toISOString(),
        read: false,
      });
    }

    this.posting = false;
    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const uid = auth.currentUser?.uid;
    if (comment.userId !== uid) return;

    this.confirmMessage = 'Delete this comment?';
    this.confirmAction = async () => {
      await deleteDoc(doc(db, this.collectionType, this.itemId, 'comments', comment.id));

      // Also delete replies if it's a top-level comment
      if (!comment.parentId && comment.replies?.length) {
        await Promise.all(comment.replies.map((r: any) =>
          deleteDoc(doc(db, this.collectionType, this.itemId, 'comments', r.id)),
        ));
      }

      const deleteCount = comment.parentId ? 1 : 1 + (comment.replies?.length || 0);
      await updateDoc(doc(db, this.collectionType, this.itemId), { commentCount: increment(-deleteCount) });
      this.commentCountChange.emit(-deleteCount);
      this.cdr.detectChanges();
    };
    this.showConfirm = true;
    this.cdr.detectChanges();
  }

  onConfirmed() {
    this.showConfirm = false;
    this.confirmAction?.();
    this.confirmAction = null;
  }

  onCancelled() {
    this.showConfirm = false;
    this.confirmAction = null;
  }

  get currentUid(): string | undefined {
    return auth.currentUser?.uid;
  }
}
