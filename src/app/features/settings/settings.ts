import { Component, inject, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { BlockService } from '../../core/services/block.service';
import { db } from '../../core/services/firebase.service';
import { collection, getDocs, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings implements OnInit {
  private authService = inject(AuthService);
  private blockService = inject(BlockService);
  private router = inject(Router);
  private location = inject(Location);
  private cdr = inject(ChangeDetectorRef);

  // Section visibility
  activeSection: 'password' | 'email' | 'delete' | 'blocked' | null = null;

  // Change password
  currentPasswordForPw = '';
  newPassword = '';
  confirmPassword = '';
  pwError = '';
  pwSuccess = '';
  pwLoading = false;

  // Change email
  currentPasswordForEmail = '';
  newEmail = '';
  emailError = '';
  emailSuccess = '';
  emailLoading = false;

  // Delete account
  currentPasswordForDelete = '';
  deleteConfirmText = '';
  deleteError = '';
  deleteLoading = false;
  showDeleteConfirm = false;

  // Blocked users
  blockedUsers: { id: string; username: string }[] = [];
  blockedLoading = false;

  // Privacy
  allowMessages = true;

  // Logout
  showLogoutConfirm = false;

  // Legal dialog
  legalDialog: 'terms' | 'privacy' | null = null;

  ngOnInit() {
    this.loadPrivacySettings();
  }

  goBack() {
    this.location.back();
  }

  toggleSection(section: typeof this.activeSection) {
    if (this.activeSection === section) {
      this.activeSection = null;
    } else {
      this.activeSection = section;
      this.clearForms();
      if (section === 'blocked') this.loadBlockedUsers();
    }
  }

  private clearForms() {
    this.currentPasswordForPw = this.newPassword = this.confirmPassword = '';
    this.pwError = this.pwSuccess = '';
    this.currentPasswordForEmail = this.newEmail = '';
    this.emailError = this.emailSuccess = '';
    this.currentPasswordForDelete = this.deleteConfirmText = '';
    this.deleteError = '';
    this.showDeleteConfirm = false;
  }

  // ── Change Password ──
  async changePassword() {
    this.pwError = this.pwSuccess = '';
    if (!this.currentPasswordForPw || !this.newPassword || !this.confirmPassword) {
      this.pwError = 'All fields are required.';
      return;
    }
    if (this.newPassword.length < 8 || this.newPassword.length > 64) {
      this.pwError = 'New password must be 8–64 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.pwError = 'Passwords do not match.';
      return;
    }
    this.pwLoading = true;
    try {
      await this.authService.changePassword(this.currentPasswordForPw, this.newPassword);
      this.pwSuccess = 'Password changed successfully.';
      this.currentPasswordForPw = this.newPassword = this.confirmPassword = '';
    } catch (e: any) {
      this.pwError = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.' : e.message;
    } finally {
      this.pwLoading = false;
      this.cdr.markForCheck();
    }
  }

  // ── Change Email ──
  async changeEmail() {
    this.emailError = this.emailSuccess = '';
    if (!this.currentPasswordForEmail || !this.newEmail) {
      this.emailError = 'All fields are required.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.newEmail)) {
      this.emailError = 'Please enter a valid email address.';
      return;
    }
    this.emailLoading = true;
    try {
      await this.authService.changeEmail(this.currentPasswordForEmail, this.newEmail);
      this.emailSuccess = 'Email changed successfully.';
      this.currentPasswordForEmail = this.newEmail = '';
    } catch (e: any) {
      this.emailError = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.' : e.message;
    } finally {
      this.emailLoading = false;
      this.cdr.markForCheck();
    }
  }

  // ── Delete Account ──
  initiateDelete() {
    this.deleteError = '';
    if (!this.currentPasswordForDelete) {
      this.deleteError = 'Please enter your password.';
      return;
    }
    if (this.deleteConfirmText !== 'DELETE') {
      this.deleteError = 'Please type DELETE to confirm.';
      return;
    }
    this.showDeleteConfirm = true;
  }

  async confirmDelete() {
    this.deleteLoading = true;
    this.deleteError = '';
    try {
      await this.authService.deleteAccount(this.currentPasswordForDelete);
      this.router.navigate(['/login']);
    } catch (e: any) {
      this.deleteError = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
        ? 'Password is incorrect.' : e.message;
      this.showDeleteConfirm = false;
    } finally {
      this.deleteLoading = false;
      this.cdr.markForCheck();
    }
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
  }

  // ── Blocked Users ──
  async loadBlockedUsers() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    this.blockedLoading = true;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'blockedUsers'));
      const users: { id: string; username: string }[] = [];
      for (const d of snap.docs) {
        const userDoc = await getDoc(doc(db, 'users', d.id));
        users.push({ id: d.id, username: userDoc.exists() ? (userDoc.data() as any).username : 'Unknown' });
      }
      this.blockedUsers = users;
    } catch {
      this.blockedUsers = [];
    } finally {
      this.blockedLoading = false;
      this.cdr.markForCheck();
    }
  }

  async unblockUser(userId: string) {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'blockedUsers', userId));
    this.blockService.removeBlock(userId);
    this.blockedUsers = this.blockedUsers.filter(u => u.id !== userId);
    this.cdr.markForCheck();
  }

  // ── Privacy ──
  async loadPrivacySettings() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      this.allowMessages = (userDoc.data() as any).allowMessages !== false;
    }
    this.cdr.markForCheck();
  }

  async toggleAllowMessages() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    this.allowMessages = !this.allowMessages;
    await updateDoc(doc(db, 'users', uid), { allowMessages: this.allowMessages });
    this.cdr.markForCheck();
  }

  // ── Logout ──
  logout() {
    this.showLogoutConfirm = true;
  }

  async confirmLogout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }

  cancelLogout() {
    this.showLogoutConfirm = false;
  }
}
