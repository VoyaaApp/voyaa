import { Injectable, signal } from '@angular/core';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, User, sendPasswordResetEmail, updatePassword,
  updateEmail, sendEmailVerification, deleteUser,
  reauthenticateWithCredential, EmailAuthProvider,
  verifyPasswordResetCode, confirmPasswordReset
} from 'firebase/auth';
import { auth } from './firebase.service';
import { db } from './firebase.service';
import { collection, getDocs, deleteDoc, doc, query, where, writeBatch } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.currentUser.set(user);
    });
  }

  register(email: string, password: string) {
    return createUserWithEmailAndPassword(auth, email, password);
  }

  login(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  logout() {
    return signOut(auth);
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(auth, email, {
      url: 'https://voyaaapp.github.io/voyaa/reset-password',
      handleCodeInApp: true
    });
  }

  verifyResetCode(code: string) {
    return verifyPasswordResetCode(auth, code);
  }

  confirmReset(code: string, newPassword: string) {
    return confirmPasswordReset(auth, code, newPassword);
  }

  verifyEmail() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    return sendEmailVerification(user);
  }

  private async reauthenticate(currentPassword: string) {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Not signed in');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  }

  async changePassword(currentPassword: string, newPassword: string) {
    await this.reauthenticate(currentPassword);
    await updatePassword(auth.currentUser!, newPassword);
  }

  async changeEmail(currentPassword: string, newEmail: string) {
    await this.reauthenticate(currentPassword);
    const user = auth.currentUser!;
    await updateEmail(user, newEmail);
    // Sync email in Firestore user doc
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'users', user.uid), { email: newEmail });
  }

  async deleteAccount(currentPassword: string) {
    await this.reauthenticate(currentPassword);
    const user = auth.currentUser!;
    const uid = user.uid;

    // Delete subcollections under user doc
    const subcollections = ['notifications', 'bookmarks', 'blockedUsers', 'followers', 'following'];
    for (const sub of subcollections) {
      const snap = await getDocs(collection(db, 'users', uid, sub));
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      if (!snap.empty) await batch.commit();
    }

    // Delete user's videos and their subcollections
    const videosSnap = await getDocs(query(collection(db, 'videos'), where('userId', '==', uid)));
    for (const videoDoc of videosSnap.docs) {
      const commentsSnap = await getDocs(collection(db, 'videos', videoDoc.id, 'comments'));
      for (const c of commentsSnap.docs) await deleteDoc(c.ref);
      const likesSnap = await getDocs(collection(db, 'videos', videoDoc.id, 'likes'));
      for (const l of likesSnap.docs) await deleteDoc(l.ref);
      await deleteDoc(videoDoc.ref);
    }

    // Delete user's posts
    const postsSnap = await getDocs(query(collection(db, 'posts'), where('userId', '==', uid)));
    for (const postDoc of postsSnap.docs) await deleteDoc(postDoc.ref);

    // Remove user from followers/following of other users
    const followersSnap = await getDocs(collection(db, 'users', uid, 'followers'));
    for (const f of followersSnap.docs) {
      await deleteDoc(doc(db, 'users', f.id, 'following', uid)).catch(() => {});
    }
    const followingSnap = await getDocs(collection(db, 'users', uid, 'following'));
    for (const f of followingSnap.docs) {
      await deleteDoc(doc(db, 'users', f.id, 'followers', uid)).catch(() => {});
    }

    // Delete user document
    await deleteDoc(doc(db, 'users', uid));

    // Delete Firebase Auth user
    await deleteUser(user);
  }
}
