import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { auth } from '../services/firebase.service';
import { onAuthStateChanged } from 'firebase/auth';

export const authGuard = () => {
  const router = inject(Router);

  return new Promise<boolean>((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(true);
      } else {
        router.navigate(['/login']);
        resolve(false);
      }
    });
  });
};