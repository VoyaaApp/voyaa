import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { doc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../core/services/firebase.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  username = '';
  errorMessage = '';
  isLoading = false;
  dobDay = '';
  dobMonth = '';
  dobYear = '';

  readonly usernameMin = 3;
  readonly usernameMax = 20;
  readonly passwordMin = 8;
  readonly passwordMax = 64;
  readonly emailMax = 254;
  usernameError = '';
  passwordError = '';
  emailError = '';
  showPassword = false;

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
    if (!/^[a-zA-Z0-9_]+$/.test(u)) {
      this.usernameError = 'Only letters, numbers and underscores allowed.';
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
    if (!this.email || !this.password || !this.username || !this.dobDay || !this.dobMonth || !this.dobYear) {
      this.errorMessage = 'All fields are required.';
      return;
    }

    if (!this.validateEmail() || !this.validateUsername() || !this.validatePassword()) {
      return;
    }

    // Check age (must be at least 13)
    const dob = new Date(+this.dobYear, +this.dobMonth - 1, +this.dobDay);
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
      return;
    }

    // Check email uniqueness
    const emailQuery = query(collection(db, 'users'), where('email', '==', this.email.trim()));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      this.errorMessage = 'An account with this email already exists.';
      this.isLoading = false;
      return;
    }

    this.authService.register(this.email, this.password)
    .then((userCredential) => {
      return setDoc(doc(db, 'users', userCredential.user.uid), {
        username: this.username.trim(),
        email: this.email.trim(),
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
    });
  }
}
