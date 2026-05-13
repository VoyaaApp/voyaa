import { Component, inject, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  email = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  showPassword = false;
  emailError = '';
  passwordError = '';

  validateEmail(): boolean {
    if (!this.email) {
      this.emailError = 'Email is required.';
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.emailError = 'Please enter a valid email address.';
      return false;
    }
    this.emailError = '';
    return true;
  }

  validatePassword(): boolean {
    if (!this.password) {
      this.passwordError = 'Password is required.';
      return false;
    }
    if (this.password.length < 8) {
      this.passwordError = 'Password must be at least 8 characters.';
      return false;
    }
    this.passwordError = '';
    return true;
  }

  login() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter email and password.';
      return;
    }
    if (!this.validateEmail() || !this.validatePassword()) {
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    this.authService.login(this.email, this.password)
      .then(() => {
        this.router.navigate(['/explore']);
      })
      .catch((error) => {
        this.errorMessage = error.message;
      })
      .finally(() => {
        this.isLoading = false;
        this.cdr.markForCheck();
      });
  }
}
