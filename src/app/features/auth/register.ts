import { Component, inject, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { doc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { sendEmailVerification } from 'firebase/auth';
import { db } from '../../core/services/firebase.service';
import { COUNTRY_COORDS } from '../../shared/data/geo';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  email = '';
  password = '';
  username = '';
  nationality = '';
  errorMessage = '';
  isLoading = false;
  dobDay = '';
  dobMonth = '';
  dobYear = '';
  countries = Object.keys(COUNTRY_COORDS).sort();

  readonly usernameMin = 3;
  readonly usernameMax = 20;
  readonly passwordMin = 8;
  readonly passwordMax = 64;
  readonly emailMax = 254;
  usernameError = '';
  passwordError = '';
  emailError = '';
  showPassword = false;
  agreedToTerms = false;
  legalDialog: 'terms' | 'privacy' | null = null;

  days = Array.from({ length: 31 }, (_, i) => i + 1);
  months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];
  years = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i);

  validateUsername(): boolean {
    const u = this.username.trim();
    if (u.length < this.usernameMin) {
      this.usernameError = `Username must be at least ${this.usernameMin} characters.`;
      return false;
    }
    if (u.length > this.usernameMax) {
      this.usernameError = `Username must be at most ${this.usernameMax} characters.`;
      return false;
    }
    if (!/^[a-zA-Z0-9_. ]+$/.test(u)) {
      this.usernameError = 'Only letters, numbers, spaces, underscores and dots allowed.';
      return false;
    }
    this.usernameError = '';
    return true;
  }

  validatePassword(): boolean {
    if (this.password.length < this.passwordMin) {
      this.passwordError = `Password must be at least ${this.passwordMin} characters.`;
      return false;
    }
    if (this.password.length > this.passwordMax) {
      this.passwordError = `Password must be at most ${this.passwordMax} characters.`;
      return false;
    }
    this.passwordError = '';
    return true;
  }

  validateEmail(): boolean {
    if (this.email.length > this.emailMax) {
      this.emailError = `Email must be at most ${this.emailMax} characters.`;
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.emailError = 'Please enter a valid email address.';
      return false;
    }
    this.emailError = '';
    return true;
  }

  async register() {
    if (!this.email || !this.password || !this.username || !this.nationality || !this.dobDay || !this.dobMonth || !this.dobYear) {
      this.errorMessage = 'All fields are required.';
      return;
    }

    if (!this.validateEmail() || !this.validateUsername() || !this.validatePassword()) {
      return;
    }

    // Validate date of birth
    const day = parseInt(this.dobDay, 10);
    const month = parseInt(this.dobMonth, 10);
    const year = parseInt(this.dobYear, 10);
    if (isNaN(day) || isNaN(month) || isNaN(year) || month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > new Date().getFullYear()) {
      this.errorMessage = 'Please enter a valid date of birth.';
      return;
    }
    const dob = new Date(year, month - 1, day);
    if (dob.getFullYear() !== year || dob.getMonth() !== month - 1 || dob.getDate() !== day) {
      this.errorMessage = 'Please enter a valid date of birth.';
      return;
    }

    // Check age (must be at least 13)
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 13) {
      this.errorMessage = 'You must be at least 13 years old to sign up.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const dateOfBirth = `${this.dobYear}-${this.dobMonth.padStart(2, '0')}-${this.dobDay.padStart(2, '0')}`;

    // Check username uniqueness
    const usernameQuery = query(collection(db, 'users'), where('username', '==', this.username.trim()));
    const usernameSnap = await getDocs(usernameQuery);
    if (!usernameSnap.empty) {
      this.errorMessage = 'This username is already taken.';
      this.isLoading = false;
      this.cdr.markForCheck();
      return;
    }

    // Check email uniqueness
    const emailQuery = query(collection(db, 'users'), where('email', '==', this.email.trim()));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      this.errorMessage = 'An account with this email already exists.';
      this.isLoading = false;
      this.cdr.markForCheck();
      return;
    }

    this.authService.register(this.email, this.password)
    .then((userCredential) => {
      sendEmailVerification(userCredential.user).catch(() => {});
      return setDoc(doc(db, 'users', userCredential.user.uid), {
        username: this.username.trim(),
        email: this.email.trim(),
        nationality: this.nationality,
        dateOfBirth,
        createdAt: new Date().toISOString(),
      });
    })
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
