import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, viewChild, viewChildren, HostListener } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { timeAgo } from '../../shared/utils/time';
import { db, auth } from '../../core/services/firebase.service';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, setDoc, increment, addDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, ConfirmDialog, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit, OnDestroy {
  authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  profileUser: any = null;
  videos: any[] = [];
  isOwnProfile = true;
  isFollowing = false;
  isEditing = false;
  showMenu = false;
  showVideoViewer = false;
  viewerStartIndex = 0;
  viewerMuted = true;
  showMuteIndicator = false;
  muteIndicatorFading = false;

  // Comments
  showComments = false;
  comments: any[] = [];
  newComment = '';
  private activeVideoId = '';
  private commentsUnsubscribe: (() => void) | null = null;

  viewerContainer = viewChild<ElementRef>('viewerContainer');
  viewerVideos = viewChildren<ElementRef>('viewerVideo');
  private viewerObserver: IntersectionObserver | null = null;
  private viewerIndex = 0;

  editUsername = '';
  editBio = '';
  editError = '';
  readonly usernameMin = 3;

  getThumbUrl(url: string): string {
    if (!url) return '';
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
      .replace(/\.[^.]+$/, '.jpg');
  }
  readonly usernameMax = 20;
  readonly bioMax = 150;
  uploadingImage = false;
  loading = true;
  timeAgo = timeAgo;
  private pressTimer: any = null;
  private tapTimer: any = null;
  private isLongPress = false;
  private pendingTap = false;
  showPauseIndicator = false;
  pauseIndicatorFading = false;
  isPaused = false;

  // User list (followers/following)
  showUserList = false;
  userListTitle = '';
  userList: { uid: string; username: string; photoURL: string }[] = [];
  userListLoading = false;

  // Saved tab
  activeTab: 'posts' | 'saved' = 'posts';
  savedGroups: { country: string; videos: any[]; thumbnail: string }[] = [];
  savedGroupVideos: any[] = [];
  savedGroupCountry = '';
  showSavedGroup = false;

  // Confirm dialog state
  showConfirm = false;
  confirmMessage = '';
  confirmText = 'Confirm';
  confirmDestructive = false;
  private confirmAction: (() => void) | null = null;

  ngOnDestroy() {
    this.commentsUnsubscribe?.();
    this.viewerObserver?.disconnect();
    clearTimeout(this.pressTimer);
    clearTimeout(this.tapTimer);
  }

  async ngOnInit() {
    const routeUserId = this.route.snapshot.paramMap.get('userId');
    let userId = routeUserId || this.authService.currentUser()?.uid;

    // Wait for auth if no userId yet
    if (!userId) {
      userId = await new Promise<string | undefined>((resolve) => {
        const unsub = auth.onAuthStateChanged((user) => {
          unsub();
          resolve(user?.uid);
        });
      });
    }
    if (!userId) return;

    this.isOwnProfile = userId === this.authService.currentUser()?.uid;

    // Load user profile
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      this.profileUser = { uid: userId, ...userDoc.data() };
      this.profileUser.followerCount = this.profileUser.followerCount || 0;
      this.profileUser.followingCount = this.profileUser.followingCount || 0;
    }

    // Load user's videos
    const q = query(collection(db, 'videos'), where('userId', '==', userId));
    const snapshot = await getDocs(q);
    this.videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), liked: false, bookmarked: false }));
    this.videos.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Batch check likes for current user
    const currentUid = this.authService.currentUser()?.uid;
    if (currentUid) {
      await Promise.all(this.videos.map(async (video) => {
        const [likeDoc, bookmarkDoc] = await Promise.all([
          getDoc(doc(db, 'videos', video.id, 'likes', currentUid)),
          getDoc(doc(db, 'users', currentUid, 'bookmarks', video.id)),
        ]);
        video.liked = likeDoc.exists();
        video.bookmarked = bookmarkDoc.exists();
      }));

      // Check if following
      if (!this.isOwnProfile) {
        const followDoc = await getDoc(doc(db, 'users', userId, 'followers', currentUid));
        this.isFollowing = followDoc.exists();
      }
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  onDoubleTap(video: any) {
    if (!video.liked) {
      this.toggleLike(video);
    }
    video.showHeart = true;
    setTimeout(() => {
      video.showHeart = false;
      this.cdr.detectChanges();
    }, 800);
    this.cdr.detectChanges();
  }

  openEdit() {
    this.editUsername = this.profileUser.username || '';
    this.editBio = this.profileUser.bio || '';
    this.editError = '';
    this.isEditing = true;
  }

  async toggleFollow() {
    const currentUid = this.authService.currentUser()?.uid;
    if (!currentUid || this.isOwnProfile) return;

    const targetUid = this.profileUser.uid;
    const followerRef = doc(db, 'users', targetUid, 'followers', currentUid);
    const followingRef = doc(db, 'users', currentUid, 'following', targetUid);
    const targetUserRef = doc(db, 'users', targetUid);
    const currentUserRef = doc(db, 'users', currentUid);

    if (this.isFollowing) {
      this.isFollowing = false;
      this.profileUser.followerCount--;
      await deleteDoc(followerRef);
      await deleteDoc(followingRef);
      await updateDoc(targetUserRef, { followerCount: increment(-1) });
      await updateDoc(currentUserRef, { followingCount: increment(-1) });
    } else {
      this.isFollowing = true;
      this.profileUser.followerCount++;
      await setDoc(followerRef, { userId: currentUid, createdAt: new Date().toISOString() });
      await setDoc(followingRef, { userId: targetUid, createdAt: new Date().toISOString() });
      await updateDoc(targetUserRef, { followerCount: increment(1) });
      await updateDoc(currentUserRef, { followingCount: increment(1) });
    }
  }

  cancelEdit() {
    this.isEditing = false;
  }

  async saveProfile() {
    const trimmedName = this.editUsername.trim();
    const trimmedBio = this.editBio.trim();
    this.editError = '';

    if (trimmedName.length < this.usernameMin) {
      this.editError = `Username must be at least ${this.usernameMin} characters.`;
      return;
    }
    if (trimmedName.length > this.usernameMax) {
      this.editError = `Username must be at most ${this.usernameMax} characters.`;
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedName)) {
      this.editError = 'Only letters, numbers and underscores allowed.';
      return;
    }
    if (trimmedBio.length > this.bioMax) {
      this.editError = `Bio must be at most ${this.bioMax} characters.`;
      return;
    }

    // Check username uniqueness if changed
    if (trimmedName !== this.profileUser.username) {
      const usernameQuery = query(collection(db, 'users'), where('username', '==', trimmedName));
      const snap = await getDocs(usernameQuery);
      if (!snap.empty) {
        this.editError = 'This username is already taken.';
        return;
      }
    }

    const userRef = doc(db, 'users', this.profileUser.uid);
    await updateDoc(userRef, {
      username: trimmedName,
      bio: trimmedBio,
    });

    this.profileUser.username = trimmedName;
    this.profileUser.bio = trimmedBio;
    this.isEditing = false;
    this.cdr.detectChanges();
  }

  async onAvatarPick(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.uploadingImage = true;
    this.cdr.detectChanges();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', environment.cloudinary.uploadPreset);
    formData.append('folder', 'voyaa_avatars');

    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      const photoURL = data.secure_url;

      const userRef = doc(db, 'users', this.profileUser.uid);
      await updateDoc(userRef, { photoURL });
      this.profileUser.photoURL = photoURL;
    } catch (err) {
      console.error('Avatar upload failed', err);
    }

    this.uploadingImage = false;
    this.cdr.detectChanges();
  }

  toggleMenu() {
    this.showMenu = !this.showMenu;
  }

  closeMenu() {
    this.showMenu = false;
  }

  openConfirm(message: string, confirmText: string, destructive: boolean, action: () => void) {
    this.confirmMessage = message;
    this.confirmText = confirmText;
    this.confirmDestructive = destructive;
    this.confirmAction = action;
    this.showConfirm = true;
  }

  onConfirmed() {
    this.showConfirm = false;
    this.confirmAction?.();
    this.confirmAction = null;
  }

  onCancelled() {
    this.showConfirm = false;
    this.confirmAction = null;
  }

  logout() {
    this.showMenu = false;
    this.openConfirm('Are you sure you want to log out?', 'Log Out', true, () => {
      this.authService.logout().then(() => {
        this.router.navigate(['/login']);
      });
    });
  }

  openVideoViewer(index: number) {
    this.viewerStartIndex = index;
    this.viewerIndex = index;
    this.showVideoViewer = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      const container = this.viewerContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.clientHeight * index;
      }
      this.setupViewerObserver();
    });
  }

  closeVideoViewer() {
    this.showVideoViewer = false;
    this.closeComments();
    if (this.viewerObserver) {
      this.viewerObserver.disconnect();
      this.viewerObserver = null;
    }
  }

  private setupViewerObserver() {
    if (this.viewerObserver) {
      this.viewerObserver.disconnect();
    }

    this.viewerObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          video.play();
          const idx = this.viewerVideos().findIndex(el => el.nativeElement === video);
          if (idx !== -1) this.viewerIndex = idx;
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.75 });

    this.viewerVideos().forEach(el => {
      this.viewerObserver!.observe(el.nativeElement);
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    if (!this.showVideoViewer) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.goToViewerVideo(this.viewerIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.goToViewerVideo(this.viewerIndex - 1);
    }
  }

  goToViewerVideo(index: number) {
    if (index < 0 || index >= this.videos.length) return;
    this.viewerIndex = index;
    const container = this.viewerContainer()?.nativeElement;
    if (!container) return;
    const cardHeight = container.clientHeight;
    const targetScroll = cardHeight * index;
    const startScroll = container.scrollTop;
    const distance = targetScroll - startScroll;
    const duration = 400;
    let startTime: number;

    container.style.scrollSnapType = 'none';

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress * (2 - progress);

      container.scrollTop = startScroll + distance * ease;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        container.style.scrollSnapType = 'y mandatory';
      }
    };

    requestAnimationFrame(animate);
  }

  onViewerPointerDown(event: Event, video: any) {
    this.isLongPress = false;
    this.pressTimer = setTimeout(() => {
      this.isLongPress = true;
      this.toggleViewerMute();
    }, 500);
  }

  onViewerPointerUp(event: Event, video: any) {
    clearTimeout(this.pressTimer);
    if (this.isLongPress) return;

    if (this.pendingTap) {
      clearTimeout(this.tapTimer);
      this.pendingTap = false;
      this.onDoubleTap(video);
    } else {
      this.pendingTap = true;
      this.tapTimer = setTimeout(() => {
        this.pendingTap = false;
        this.toggleViewerPause(video);
      }, 300);
    }
  }

  toggleViewerPause(video: any) {
    const el = this.viewerVideos()[this.viewerIndex]?.nativeElement as HTMLVideoElement;
    if (!el) return;
    if (el.paused) {
      el.play();
      this.isPaused = false;
    } else {
      el.pause();
      this.isPaused = true;
    }
    this.showPauseIndicator = true;
    this.pauseIndicatorFading = false;
    this.cdr.detectChanges();
    setTimeout(() => { this.pauseIndicatorFading = true; this.cdr.detectChanges(); }, 400);
    setTimeout(() => { this.showPauseIndicator = false; this.cdr.detectChanges(); }, 800);
  }

  toggleViewerMute() {
    this.viewerMuted = !this.viewerMuted;
    this.showMuteIndicator = true;
    this.muteIndicatorFading = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.muteIndicatorFading = true;
      this.cdr.detectChanges();
    }, 500);

    setTimeout(() => {
      this.showMuteIndicator = false;
      this.cdr.detectChanges();
    }, 1000);
  }

  async toggleLike(video: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    const likeRef = doc(db, 'videos', video.id, 'likes', userId);
    const videoRef = doc(db, 'videos', video.id);

    if (video.liked) {
      video.liked = false;
      video.likeCount--;
      await deleteDoc(likeRef);
      await updateDoc(videoRef, { likeCount: increment(-1) });
    } else {
      video.liked = true;
      video.likeCount++;
      await setDoc(likeRef, { userId, createdAt: new Date().toISOString() });
      await updateDoc(videoRef, { likeCount: increment(1) });
    }
  }

  async toggleBookmark(video: any) {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;
    const bookmarkRef = doc(db, 'users', userId, 'bookmarks', video.id);

    if (video.bookmarked) {
      video.bookmarked = false;
      await deleteDoc(bookmarkRef);
    } else {
      video.bookmarked = true;
      await setDoc(bookmarkRef, {
        videoId: video.id,
        country: video.location?.country || '',
        city: video.location?.city || '',
        cloudinaryUrl: video.cloudinaryUrl || '',
        title: video.title || '',
        createdAt: new Date().toISOString(),
      });
    }
  }

  async openUserList(type: 'followers' | 'following') {
    this.userListTitle = type === 'followers' ? 'Followers' : 'Following';
    this.showUserList = true;
    this.userList = [];
    this.userListLoading = true;
    this.cdr.detectChanges();

    const uid = this.profileUser.uid;
    const colRef = type === 'followers'
      ? collection(db, 'users', uid, 'followers')
      : collection(db, 'users', uid, 'following');
    const snapshot = await getDocs(colRef);

    const userIds = snapshot.docs.map(d => d.id);
    const users: { uid: string; username: string; photoURL: string }[] = [];
    await Promise.all(userIds.map(async (id) => {
      const userDoc = await getDoc(doc(db, 'users', id));
      if (userDoc.exists()) {
        const data = userDoc.data();
        users.push({ uid: id, username: data['username'] || 'User', photoURL: data['photoURL'] || '' });
      }
    }));

    this.userList = users;
    this.userListLoading = false;
    this.cdr.detectChanges();
  }

  closeUserList() {
    this.showUserList = false;
  }

  goToUserProfile(uid: string) {
    this.showUserList = false;
    this.router.navigate(['/profile', uid]);
  }

  async switchTab(tab: 'posts' | 'saved') {
    this.activeTab = tab;
    if (tab === 'saved' && this.savedGroups.length === 0) {
      await this.loadSavedBookmarks();
    }
  }

  async loadSavedBookmarks() {
    const uid = this.profileUser?.uid;
    if (!uid) return;
    const snapshot = await getDocs(collection(db, 'users', uid, 'bookmarks'));
    const bookmarks = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    const groups = new Map<string, any[]>();
    for (const b of bookmarks) {
      const country = b.country || 'Unknown';
      if (!groups.has(country)) groups.set(country, []);
      groups.get(country)!.push(b);
    }

    this.savedGroups = Array.from(groups.entries()).map(([country, videos]) => ({
      country,
      videos,
      thumbnail: videos[0]?.cloudinaryUrl || '',
    }));
    this.cdr.detectChanges();
  }

  openSavedGroup(group: { country: string; videos: any[]; thumbnail: string }) {
    this.savedGroupCountry = group.country;
    this.savedGroupVideos = group.videos;
    this.showSavedGroup = true;
  }

  closeSavedGroup() {
    this.showSavedGroup = false;
  }

  openComments(video: any) {
    this.activeVideoId = video.id;
    this.showComments = true;
    this.comments = [];

    const commentsRef = collection(db, 'videos', video.id, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    this.commentsUnsubscribe = onSnapshot(q, async (snapshot) => {
      this.comments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const needPhoto = this.comments.filter(c => !c.photoURL);
      if (needPhoto.length > 0) {
        await Promise.all(needPhoto.map(async (comment) => {
          const uDoc = await getDoc(doc(db, 'users', comment.userId));
          comment.photoURL = uDoc.exists() ? uDoc.data()['photoURL'] || '' : '';
        }));
      }
      this.cdr.detectChanges();
    });
  }

  closeComments() {
    this.showComments = false;
    if (this.commentsUnsubscribe) {
      this.commentsUnsubscribe();
      this.commentsUnsubscribe = null;
    }
  }

  async postComment() {
    if (!this.newComment.trim()) return;
    const userId = this.authService.currentUser()?.uid;
    if (!userId) return;

    const userDoc = await getDoc(doc(db, 'users', userId));
    const username = userDoc.exists() ? userDoc.data()['username'] : 'Anonymous';
    const photoURL = userDoc.exists() ? userDoc.data()['photoURL'] || '' : '';

    const commentsRef = collection(db, 'videos', this.activeVideoId, 'comments');
    await addDoc(commentsRef, {
      userId,
      username,
      photoURL,
      text: this.newComment.trim(),
      createdAt: new Date().toISOString(),
    });

    const videoRef = doc(db, 'videos', this.activeVideoId);
    await updateDoc(videoRef, { commentCount: increment(1) });

    const video = this.videos.find(v => v.id === this.activeVideoId);
    if (video) video.commentCount++;

    this.newComment = '';
    this.cdr.detectChanges();
  }

  async deleteComment(comment: any) {
    const userId = this.authService.currentUser()?.uid;
    if (comment.userId !== userId) return;

    this.openConfirm('Delete this comment?', 'Delete', true, async () => {
      await deleteDoc(doc(db, 'videos', this.activeVideoId, 'comments', comment.id));
      const videoRef = doc(db, 'videos', this.activeVideoId);
      await updateDoc(videoRef, { commentCount: increment(-1) });
      const video = this.videos.find(v => v.id === this.activeVideoId);
      if (video) video.commentCount--;
      this.cdr.detectChanges();
    });
  }

  async deleteVideo(video: any, event: Event) {
    event.stopPropagation();
    this.openConfirm('Delete this video?', 'Delete', true, async () => {
      await deleteDoc(doc(db, 'videos', video.id));
      this.videos = this.videos.filter(v => v.id !== video.id);
      this.cdr.detectChanges();
    });
  }
}
