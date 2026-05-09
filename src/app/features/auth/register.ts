import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { doc, setDoc } from 'firebase/firestore';
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

  register() {
    if (!this.email || !this.password || !this.username || !this.dobDay || !this.dobMonth || !this.dobYear) {
      this.errorMessage = 'All fields are required.';
      return;
    }

    if (this.password.length < 8) {
      this.errorMessage = 'Password must be at least 8 characters.';
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

    this.authService.register(this.email, this.password)
    .then((userCredential) => {
      return setDoc(doc(db, 'users', userCredential.user.uid), {
        username: this.username,
        email: this.email,
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
