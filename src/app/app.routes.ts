import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'explore', pathMatch: 'full' },
    { path: 'feed', loadComponent: () => import('./features/feed/feed').then(m => m.Feed), canActivate: [authGuard] },
    { path: 'explore', loadComponent: () => import('./features/explore/explore').then(m => m.Explore), canActivate: [authGuard] },
    { path: 'destination/:country', loadComponent: () => import('./features/destination/destination').then(m => m.Destination), canActivate: [authGuard] },
    { path: 'upload', loadComponent: () => import('./features/upload/upload').then(m => m.Upload), canActivate: [authGuard] },
    { path: 'upload-image', loadComponent: () => import('./features/upload-image/upload-image').then(m => m.UploadImage), canActivate: [authGuard] },
    { path: 'globe', loadComponent: () => import('./features/globe/globe').then(m => m.Globe), canActivate: [authGuard] },
    { path: 'search', loadComponent: () => import('./features/search/search').then(m => m.Search), canActivate: [authGuard] },
    { path: 'profile', loadComponent: () => import('./features/profile/profile').then(m => m.Profile), canActivate: [authGuard] },
    { path: 'profile/:userId', loadComponent: () => import('./features/profile/profile').then(m => m.Profile), canActivate: [authGuard] },
    { path: 'activity', loadComponent: () => import('./features/activity/activity').then(m => m.Activity), canActivate: [authGuard] },
    { path: 'messages', loadComponent: () => import('./features/messages/messages').then(m => m.Messages), canActivate: [authGuard] },
    { path: 'messages/:conversationId', loadComponent: () => import('./features/messages/chat').then(m => m.Chat), canActivate: [authGuard] },
    { path: 'login', loadComponent: () => import('./features/auth/login').then(m => m.Login) },
    { path: 'register', loadComponent: () => import('./features/auth/register').then(m => m.Register) },
];
