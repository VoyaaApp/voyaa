import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { auth } from '../services/firebase.service';
import { onAuthStateChanged } from 'firebase/auth';

export const guestGuard = () => {
  const router = inject(Router);

  return new Promise<boolean>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        router.navigate(['/explore']);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};
