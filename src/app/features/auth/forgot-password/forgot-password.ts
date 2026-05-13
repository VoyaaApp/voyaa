import { Component, inject, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  email = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  async sendReset() {
    if (!this.email) {
      this.errorMessage = 'Please enter your email address.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.errorMessage = 'Please enter a valid email address.';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await this.authService.resetPassword(this.email);
      this.successMessage = 'Password reset email sent. Check your inbox.';
    } catch (error: any) {
      this.errorMessage = error.message;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }
}
