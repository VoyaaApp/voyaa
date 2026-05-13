import { Injectable } from '@angular/core';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, increment, addDoc, collection } from 'firebase/firestore';
import { db, auth } from '../services/firebase.service';

@Injectable({ providedIn: 'root' })
export class InteractionService {

  async toggleLike(
    collectionType: 'videos' | 'posts',
    itemId: string,
    ownerId: string,
    title: string,
    currentlyLiked: boolean
  ): Promise<{ liked: boolean; delta: number }> {
    const uid = auth.currentUser?.uid;
    if (!uid) return { liked: currentlyLiked, delta: 0 };

    const likeRef = doc(db, collectionType, itemId, 'likes', uid);
    const itemRef = doc(db, collectionType, itemId);

    if (currentlyLiked) {
      await deleteDoc(likeRef);
      await updateDoc(itemRef, { likeCount: increment(-1) });
      return { liked: false, delta: -1 };
    } else {
      await setDoc(likeRef, { userId: uid, createdAt: new Date().toISOString() });
      await updateDoc(itemRef, { likeCount: increment(1) });

      if (ownerId && ownerId !== uid) {
        await this.sendNotification(ownerId, {
          type: 'like',
          videoId: itemId,
          videoTitle: title,
        });
      }
      return { liked: true, delta: 1 };
    }
  }

  async toggleBookmark(
    itemId: string,
    currentlyBookmarked: boolean,
    bookmarkData?: Record<string, any>
  ): Promise<boolean> {
    const uid = auth.currentUser?.uid;
    if (!uid) return currentlyBookmarked;

    const bookmarkRef = doc(db, 'users', uid, 'bookmarks', itemId);

    if (currentlyBookmarked) {
      await deleteDoc(bookmarkRef);
      return false;
    } else {
      await setDoc(bookmarkRef, {
        videoId: itemId,
        createdAt: new Date().toISOString(),
        ...bookmarkData,
      });
      return true;
    }
  }

  async toggleFollow(
    targetUid: string,
    currentlyFollowing: boolean
  ): Promise<{ following: boolean; delta: number }> {
    const uid = auth.currentUser?.uid;
    if (!uid || targetUid === uid) return { following: currentlyFollowing, delta: 0 };

    const followerRef = doc(db, 'users', targetUid, 'followers', uid);
    const followingRef = doc(db, 'users', uid, 'following', targetUid);
    const targetUserRef = doc(db, 'users', targetUid);
    const currentUserRef = doc(db, 'users', uid);

    if (currentlyFollowing) {
      await deleteDoc(followerRef);
      await deleteDoc(followingRef);
      await updateDoc(targetUserRef, { followerCount: increment(-1) });
      await updateDoc(currentUserRef, { followingCount: increment(-1) });
      return { following: false, delta: -1 };
    } else {
      await setDoc(followerRef, { userId: uid, createdAt: new Date().toISOString() });
      await setDoc(followingRef, { userId: targetUid, createdAt: new Date().toISOString() });
      await updateDoc(targetUserRef, { followerCount: increment(1) });
      await updateDoc(currentUserRef, { followingCount: increment(1) });

      await this.sendNotification(targetUid, { type: 'follow' });
      return { following: true, delta: 1 };
    }
  }

  private async sendNotification(
    toUserId: string,
    data: Record<string, any>
  ): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const userDoc = await getDoc(doc(db, 'users', uid));
    const d = userDoc.exists() ? userDoc.data() : {};

    await addDoc(collection(db, 'users', toUserId, 'notifications'), {
      ...data,
      fromUserId: uid,
      fromUsername: d['username'] || '',
      fromPhotoURL: d['photoURL'] || '',
      createdAt: new Date().toISOString(),
      read: false,
    });
  }
}
