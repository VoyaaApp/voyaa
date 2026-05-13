import { Component, inject, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPassword implements OnInit {
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  code = '';
  email = '';
  newPassword = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;
  verifying = true;
  invalid = false;

  async ngOnInit() {
    this.code = this.route.snapshot.queryParamMap.get('oobCode') || '';
    if (!this.code) {
      this.invalid = true;
      this.verifying = false;
      return;
    }
    try {
      this.email = await this.authService.verifyResetCode(this.code);
      this.verifying = false;
    } catch {
      this.invalid = true;
      this.verifying = false;
    }
    this.cdr.markForCheck();
  }

  async resetPassword() {
    this.errorMessage = '';
    if (!this.newPassword || !this.confirmPassword) {
      this.errorMessage = 'Please fill in both fields.';
      return;
    }
    if (this.newPassword.length < 8) {
      this.errorMessage = 'Password must be at least 8 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    this.isLoading = true;
    try {
      await this.authService.confirmReset(this.code, this.newPassword);
      this.successMessage = 'Password has been reset successfully.';
    } catch (e: any) {
      this.errorMessage = e.code === 'auth/expired-action-code'
        ? 'This reset link has expired. Please request a new one.'
        : e.code === 'auth/weak-password'
        ? 'Password is too weak. Please choose a stronger one.'
        : e.message;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }
}
