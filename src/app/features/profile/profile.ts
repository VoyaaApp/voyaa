import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, viewChild, viewChildren, HostListener } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { InteractionService } from '../../core/services/interaction.service';
import { BlockService } from '../../core/services/block.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { ReportPanel } from '../../shared/components/report-panel/report-panel';
import { TripPicker } from '../../shared/components/trip-picker/trip-picker';
import { TripService, Trip, WISHLIST_ID } from '../../core/services/trip.service';
import { TripMapView } from './trip-map/trip-map';
import { CommentPanel } from '../../shared/components/comment-panel/comment-panel';
import { PostCard } from '../../shared/components/post-card/post-card';
import { timeAgo } from '../../shared/utils/time';
import { sharePost } from '../../shared/utils/share';
import { db, auth } from '../../core/services/firebase.service';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, setDoc, increment, addDoc, onSnapshot, orderBy, limit, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { COUNTRY_FLAGS, COUNTRY_CODES, REGION_MAP, COUNTRY_COORDS } from '../../shared/data/geo';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, ConfirmDialog, RouterLink, PostCard, CommentPanel, ReportPanel, TripPicker, TripMapView],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit, OnDestroy {
  authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private interaction = inject(InteractionService);
  private blockService = inject(BlockService);
  private tripService = inject(TripService);

  profileUser: any = null;
  videos: any[] = [];
  posts: any[] = [];
  gridItems: any[] = [];
  isOwnProfile = true;
  isFollowing = false;
  isEditing = false;
  showMenu = false;
  showCreateMenu = false;
  showOtherMenu = false;
  isBlocked = false;
  blockedByThem = false;
  showReportPanel = false;
  reportReason = '';
  reportDetails = '';
  reportLoading = false;
  reportSuccess = false;
  showVideoViewer = false;
  showImageViewer = false;
  imageViewerPost: any = null;
  viewerStartIndex = 0;
  viewerMuted = false;
  showMuteIndicator = false;
  muteIndicatorFading = false;

  // Comments (video viewer)
  showComments = false;
  private activeVideo: any = null;

  // Header unread counts
  unreadMessages = 0;
  unreadNotifications = 0;
  private unsubMessages: (() => void) | null = null;
  private unsubNotifications: (() => void) | null = null;

  viewerContainer = viewChild<ElementRef>('viewerContainer');
  viewerVideos = viewChildren<ElementRef>('viewerVideo');
  private viewerObserver: IntersectionObserver | null = null;
  private viewerIndex = 0;

  editUsername = '';
  editBio = '';
  editNationality = '';
  editError = '';
  countries = Object.keys(COUNTRY_COORDS).sort();
  readonly usernameMin = 3;

  getThumbUrl(url: string): string {
    if (!url) return '';
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_500,c_fill,q_auto,f_auto/')
      .replace(/\.[^.]+$/, '.jpg');
  }

  getPostImageUrls(post: any): string[] {
    return (post.images || []).map((img: any) => img.url);
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

  // Grid pagination
  private readonly GRID_PAGE_SIZE = 20;
  private lastVideoDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  private lastPostDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  private videosExhausted = false;
  private postsExhausted = false;
  allGridLoaded = false;
  loadingMoreGrid = false;
  private gridSentinelObserver: IntersectionObserver | null = null;
  private profileUserId: string | null = null;

  // User list (followers/following)
  showUserList = false;
  userListTitle = '';
  userList: { uid: string; username: string; photoURL: string }[] = [];
  userListLoading = false;

  // Saved tab
  activeTab: 'posts' | 'saved' | 'stamps' = 'posts';
  savedTrips: { trip: Trip; bookmarks: any[]; coverUrl: string }[] = [];
  savedGroupVideos: any[] = [];
  savedGroupTrip: Trip | null = null;
  showSavedGroup = false;
  savedEditMode = false;
  showEditTrip = false;
  editTripName = '';
  editTripDate = '';
  showTripMap = false;
  tripMapTrip: Trip | null = null;
  tripMapBookmarks: any[] = [];

  // Passport features

  travelStats = { countries: 0, continents: 0, videos: 0 };
  stamps: { country: string; flag: string; firstVisit: string; postCount: number }[] = [];
  badges: { name: string; icon: string; description: string; earned: boolean }[] = [];
  activeBadge: { name: string; icon: string; description: string; earned: boolean } | null = null;

  // Confirm dialog state
  showConfirm = false;
  confirmMessage = '';
  confirmText = 'Confirm';
  confirmDestructive = false;
  private confirmAction: (() => void) | null = null;

  ngOnDestroy() {
    this.viewerObserver?.disconnect();
    this.gridSentinelObserver?.disconnect();
    this.unsubMessages?.();
    this.unsubNotifications?.();
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

    // Listen for unread messages/notifications
    if (this.isOwnProfile) {
      const mq = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', userId)
      );
      this.unsubMessages = onSnapshot(mq, (snapshot) => {
        let total = 0;
        snapshot.docs.forEach(d => {
          total += d.data()['unreadCount_' + userId] || 0;
        });
        this.unreadMessages = total;
        this.cdr.detectChanges();
      });

      const nq = query(
        collection(db, 'users', userId, 'notifications'),
        where('read', '==', false)
      );
      this.unsubNotifications = onSnapshot(nq, (snapshot) => {
        this.unreadNotifications = snapshot.size;
        this.cdr.detectChanges();
      });
    }

    // Load user profile — render immediately
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      this.profileUser = { uid: userId, ...userDoc.data() };
      this.profileUser.followerCount = this.profileUser.followerCount || 0;
      this.profileUser.followingCount = this.profileUser.followingCount || 0;
    }
    this.loading = false;
    this.profileUserId = userId;
    this.cdr.detectChanges();

    // Load first page of videos and posts in parallel
    const videoQuery = query(collection(db, 'videos'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(this.GRID_PAGE_SIZE));
    const postQuery = query(collection(db, 'posts'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(this.GRID_PAGE_SIZE));
    const [snapshot, psnap] = await Promise.all([
      getDocs(videoQuery),
      getDocs(postQuery),
    ]);

    if (snapshot.docs.length < this.GRID_PAGE_SIZE) this.videosExhausted = true;
    if (snapshot.docs.length > 0) this.lastVideoDoc = snapshot.docs[snapshot.docs.length - 1];
    if (psnap.docs.length < this.GRID_PAGE_SIZE) this.postsExhausted = true;
    if (psnap.docs.length > 0) this.lastPostDoc = psnap.docs[psnap.docs.length - 1];
    this.allGridLoaded = this.videosExhausted && this.postsExhausted;

    this.videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), liked: false, bookmarked: false, _type: 'video' }));
    this.posts = psnap.docs.map(doc => ({ id: doc.id, ...doc.data(), liked: false, _type: 'post' }));

    // Merge into grid items sorted by date
    this.gridItems = [...this.videos, ...this.posts]
      .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    this.computePassportData();
    this.cdr.detectChanges();

    // Set up sentinel observer for infinite scroll
    requestAnimationFrame(() => this.setupGridSentinel());

    // Batch check likes for current user (deferred — UI already visible)
    const currentUid = this.authService.currentUser()?.uid;
    if (currentUid) {
      this.loadGridInteractions(this.videos, this.posts, currentUid);

      // Check if following
      if (!this.isOwnProfile) {
        const followDoc = await getDoc(doc(db, 'users', userId, 'followers', currentUid));
        this.isFollowing = followDoc.exists();
        this.checkBlocked();
        this.cdr.detectChanges();
      }
    }
  }

  async loadMoreGrid() {
    if (this.allGridLoaded || this.loadingMoreGrid || !this.profileUserId) return;
    this.loadingMoreGrid = true;

    const fetches: Promise<any>[] = [];

    if (!this.videosExhausted && this.lastVideoDoc) {
      fetches.push(
        getDocs(query(collection(db, 'videos'), where('userId', '==', this.profileUserId), orderBy('createdAt', 'desc'), startAfter(this.lastVideoDoc), limit(this.GRID_PAGE_SIZE)))
      );
    } else {
      fetches.push(Promise.resolve(null));
    }

    if (!this.postsExhausted && this.lastPostDoc) {
      fetches.push(
        getDocs(query(collection(db, 'posts'), where('userId', '==', this.profileUserId), orderBy('createdAt', 'desc'), startAfter(this.lastPostDoc), limit(this.GRID_PAGE_SIZE)))
      );
    } else {
      fetches.push(Promise.resolve(null));
    }

    const [videoSnap, postSnap] = await Promise.all(fetches);

    if (videoSnap) {
      if (videoSnap.docs.length < this.GRID_PAGE_SIZE) this.videosExhausted = true;
      if (videoSnap.docs.length > 0) this.lastVideoDoc = videoSnap.docs[videoSnap.docs.length - 1];
      const newVideos = videoSnap.docs.map((d: any) => ({ id: d.id, ...d.data(), liked: false, bookmarked: false, _type: 'video' }));
      this.videos = [...this.videos, ...newVideos];
    }

    if (postSnap) {
      if (postSnap.docs.length < this.GRID_PAGE_SIZE) this.postsExhausted = true;
      if (postSnap.docs.length > 0) this.lastPostDoc = postSnap.docs[postSnap.docs.length - 1];
      const newPosts = postSnap.docs.map((d: any) => ({ id: d.id, ...d.data(), liked: false, _type: 'post' }));
      this.posts = [...this.posts, ...newPosts];
    }

    this.allGridLoaded = this.videosExhausted && this.postsExhausted;
    this.gridItems = [...this.videos, ...this.posts]
      .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    this.computePassportData();
    this.loadingMoreGrid = false;
    this.cdr.detectChanges();

    // Defer interaction checks for new items
    const currentUid = this.authService.currentUser()?.uid;
    if (currentUid) {
      const newVids = videoSnap ? videoSnap.docs.map((d: any) => this.videos.find((v: any) => v.id === d.id)).filter(Boolean) : [];
      const newPosts = postSnap ? postSnap.docs.map((d: any) => this.posts.find((p: any) => p.id === d.id)).filter(Boolean) : [];
      this.loadGridInteractions(newVids, newPosts, currentUid);
    }
  }

  private loadGridInteractions(videos: any[], posts: any[], currentUid: string) {
    Promise.all([
      ...videos.map(async (video) => {
        const [likeDoc, bookmarkDoc] = await Promise.all([
          getDoc(doc(db, 'videos', video.id, 'likes', currentUid)),
          getDoc(doc(db, 'users', currentUid, 'bookmarks', video.id)),
        ]);
        video.liked = likeDoc.exists();
        video.bookmarked = bookmarkDoc.exists();
      }),
      ...posts.map(async (post) => {
        const likeDoc2 = await getDoc(doc(db, 'posts', post.id, 'likes', currentUid));
        post.liked = likeDoc2.exists();
      }),
    ]).then(() => this.cdr.detectChanges());
  }

  private setupGridSentinel() {
    this.gridSentinelObserver?.disconnect();
    const sentinel = document.querySelector('.grid-sentinel');
    if (!sentinel) return;
    this.gridSentinelObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        this.loadMoreGrid();
      }
    }, { threshold: 0.1 });
    this.gridSentinelObserver.observe(sentinel);
  }

  private computePassportData() {
    // Travel stats
    const countrySet = new Set<string>();
    const continentSet = new Set<string>();
    const countryFirstVisit = new Map<string, string>();
    const countryPostCount = new Map<string, number>();

    // Count both videos and image posts
    const allItems = [...this.videos, ...this.posts];
    for (const v of allItems) {
      const country = v.location?.country;
      if (!country) continue;
      countrySet.add(country);
      const region = REGION_MAP[country];
      if (region) continentSet.add(region);
      countryPostCount.set(country, (countryPostCount.get(country) || 0) + 1);
      const existing = countryFirstVisit.get(country);
      if (!existing || v.createdAt < existing) {
        countryFirstVisit.set(country, v.createdAt);
      }
    }

    this.travelStats = {
      countries: countrySet.size,
      continents: continentSet.size,
      videos: allItems.length,
    };

    // Stamps
    this.stamps = Array.from(countrySet).map(country => ({
      country,
      flag: this.getFlagUrl(country),
      firstVisit: new Date(countryFirstVisit.get(country)!).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      postCount: countryPostCount.get(country) || 0,
    })).sort((a, b) => (countryFirstVisit.get(a.country)! > countryFirstVisit.get(b.country)! ? 1 : -1));

    // Badges
    const nc = countrySet.size;
    const nr = continentSet.size;
    const nv = allItems.length;
    this.badges = [
      { name: 'First Stamp', icon: 'workspace_premium', description: 'Create your first post', earned: nv >= 1 },
      { name: 'Explorer', icon: 'explore', description: 'Post from 3+ countries', earned: nc >= 3 },
      { name: 'Globe Trotter', icon: 'language', description: 'Post from 5+ countries', earned: nc >= 5 },
      { name: 'Continental', icon: 'public', description: 'Post from 3+ continents', earned: nr >= 3 },
      { name: 'Storyteller', icon: 'auto_stories', description: 'Create 10+ posts', earned: nv >= 10 },
      { name: 'World Traveler', icon: 'flight_takeoff', description: 'Post from 10+ countries', earned: nc >= 10 },
    ];
  }

  getFlagUrl(country: string): string {
    const code = COUNTRY_CODES[country];
    if (!code) return '';
    return `https://flagcdn.com/w80/${code}.png`;
  }

  getFlag(country: string): string {
    return this.getFlagUrl(country);
  }

  showBadgeInfo(badge: { name: string; icon: string; description: string; earned: boolean }) {
    this.activeBadge = this.activeBadge?.name === badge.name ? null : badge;
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
    this.editNationality = this.profileUser.nationality || '';
    this.editError = '';
    this.isEditing = true;
  }

  async toggleFollow() {
    if (this.isOwnProfile || this.isBlocked || this.blockedByThem) return;
    const targetUid = this.profileUser.uid;
    const result = await this.interaction.toggleFollow(targetUid, this.isFollowing);
    this.isFollowing = result.following;
    this.profileUser.followerCount += result.delta;
    this.cdr.detectChanges();
  }

  async sendMessage() {
    const uid = auth.currentUser?.uid;
    const targetUid = this.profileUser.uid;
    if (!uid || !targetUid || uid === targetUid) return;

    if (this.isBlocked || this.blockedByThem) return;

    // Check if target user allows messages from non-followers
    const targetData = this.profileUser;
    if (targetData.allowMessages === false && !this.isFollowing) {
      // Check if target follows us (mutual isn't required, just we follow them)
      const followerDoc = await getDoc(doc(db, 'users', targetUid, 'followers', uid));
      if (!followerDoc.exists()) {
        this.openConfirm('This user only accepts messages from followers.', 'OK', false, () => {});
        return;
      }
    }

    // Check for existing conversation
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    const snapshot = await getDocs(q);
    const existing = snapshot.docs.find(d => {
      const participants = d.data()['participants'] as string[];
      return participants.includes(targetUid);
    });

    if (existing) {
      this.router.navigate(['/messages', existing.id]);
    } else {
      const convoRef = await addDoc(collection(db, 'conversations'), {
        participants: [uid, targetUid],
        lastMessage: '',
        updatedAt: new Date(),
        ['unreadCount_' + uid]: 0,
        ['unreadCount_' + targetUid]: 0,
      });
      this.router.navigate(['/messages', convoRef.id]);
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
    if (!/^[a-zA-Z0-9_. ]+$/.test(trimmedName)) {
      this.editError = 'Only letters, numbers, spaces, underscores and dots allowed.';
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
      nationality: this.editNationality,
    });

    this.profileUser.username = trimmedName;
    this.profileUser.bio = trimmedBio;
    this.profileUser.nationality = this.editNationality;
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

  onGridItemClick(item: any) {
    if (item._type === 'post') {
      this.imageViewerPost = item;
      this.showImageViewer = true;
      this.cdr.detectChanges();
    } else {
      const videoIndex = this.videos.indexOf(item);
      if (videoIndex >= 0) this.openVideoViewer(videoIndex);
    }
  }

  closeImageViewer() {
    this.showImageViewer = false;
    this.imageViewerPost = null;
    this.showImagePostComments = false;
    this.cdr.detectChanges();
  }

  // Image post comments
  showImagePostComments = false;

  openImagePostComments() {
    this.showImagePostComments = true;
    this.cdr.detectChanges();
  }

  closeImagePostComments() {
    this.showImagePostComments = false;
    this.cdr.detectChanges();
  }

  onImagePostCommentCountChange(delta: number) {
    if (this.imageViewerPost) this.imageViewerPost.commentCount += delta;
    this.cdr.detectChanges();
  }

  async shareImagePost() {
    const post = this.imageViewerPost;
    if (!post) return;
    await sharePost(post.title);
  }

  async deletePost(post: any, event?: Event) {
    event?.stopPropagation();
    this.openConfirm('Delete this post?', 'Delete', true, async () => {
      await deleteDoc(doc(db, 'posts', post.id));
      this.posts = this.posts.filter(p => p.id !== post.id);
      this.gridItems = this.gridItems.filter(i => i !== post);
      if (this.showImageViewer && this.imageViewerPost?.id === post.id) {
        this.closeImageViewer();
      }
      this.cdr.detectChanges();
    });
  }

  async deleteVideo(video: any) {
    this.openConfirm('Delete this video?', 'Delete', true, async () => {
      await deleteDoc(doc(db, 'videos', video.id));
      this.videos = this.videos.filter(v => v.id !== video.id);
      this.gridItems = this.gridItems.filter(i => i !== video);
      this.closeVideoViewer();
      this.cdr.detectChanges();
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
    // No long-press behavior
  }

  onViewerPointerUp(event: Event, video: any) {
    clearTimeout(this.pressTimer);

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
    if (!this.isPaused) {
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
      setTimeout(() => { this.pauseIndicatorFading = true; this.cdr.detectChanges(); }, 400);
      setTimeout(() => { this.showPauseIndicator = false; this.cdr.detectChanges(); }, 800);
    } else {
      this.showPauseIndicator = true;
      this.pauseIndicatorFading = false;
      this.cdr.detectChanges();
    }
  }

  toggleViewerMute() {
    this.viewerMuted = !this.viewerMuted;
  }

  async toggleLike(video: any) {
    const result = await this.interaction.toggleLike('videos', video.id, video.userId, video.title, video.liked);
    video.liked = result.liked;
    video.likeCount += result.delta;
    this.cdr.detectChanges();
  }

  async toggleBookmark(video: any) {
    if (video.bookmarked) {
      video.bookmarked = await this.interaction.toggleBookmark(video.id, true, {});
      this.cdr.detectChanges();
      return;
    }
    this.pendingBookmarkVideo = video;
    this.tripPickerTrips = await this.tripService.getTrips(this.authService.currentUser()!.uid);
    this.showTripPicker = true;
    this.cdr.detectChanges();
  }

  // Trip picker
  showTripPicker = false;
  tripPickerTrips: Trip[] = [];
  private pendingBookmarkVideo: any = null;

  async onTripSelected(tripId: string) {
    const video = this.pendingBookmarkVideo;
    if (!video) return;
    video.bookmarked = await this.interaction.toggleBookmark(video.id, false, {
      country: video.location?.country || '',
      city: video.location?.city || '',
      cloudinaryUrl: video.cloudinaryUrl || '',
      title: video.title || '',
      tripId,
    });
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
    this.cdr.detectChanges();
  }

  onTripCreated(trip: Trip) {
    this.tripPickerTrips = [trip, ...this.tripPickerTrips];
  }

  closeTripPicker() {
    this.showTripPicker = false;
    this.pendingBookmarkVideo = null;
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

  async switchTab(tab: 'posts' | 'saved' | 'stamps') {
    this.activeTab = tab;
    if (tab === 'saved' && this.savedTrips.length === 0) {
      await this.loadSavedBookmarks();
    }
  }

  async loadSavedBookmarks() {
    const uid = this.profileUser?.uid;
    if (!uid) return;

    const [bookmarkSnap, trips] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'bookmarks')),
      this.tripService.getTrips(uid),
    ]);
    const bookmarks = bookmarkSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    // Enrich bookmarks with actual post/video data for thumbnails
    await Promise.all(bookmarks.map(async (b) => {
      if (!b._type) {
        const postDoc = await getDoc(doc(db, 'posts', b.id));
        if (postDoc.exists()) {
          const data = postDoc.data();
          b._type = 'post';
          b.images = data['images'];
          b.thumbnailUrl = data['thumbnailUrl'] || data['images']?.[0]?.url || '';
        } else {
          b._type = 'video';
        }
      }
      if (b._type === 'post' && !b.thumbnailUrl && !b.images?.length) {
        const postDoc = await getDoc(doc(db, 'posts', b.id));
        if (postDoc.exists()) {
          const data = postDoc.data();
          b.images = data['images'];
          b.thumbnailUrl = data['thumbnailUrl'] || data['images']?.[0]?.url || '';
        }
      }
    }));

    // Group by tripId
    const tripMap = new Map<string, any[]>();
    for (const b of bookmarks) {
      const tid = b.tripId || WISHLIST_ID;
      if (!tripMap.has(tid)) tripMap.set(tid, []);
      tripMap.get(tid)!.push(b);
    }

    // Build trip cards — Wishlist first, then user trips
    const result: { trip: Trip; bookmarks: any[]; coverUrl: string }[] = [];

    const wishlistBookmarks = tripMap.get(WISHLIST_ID) || [];
    if (wishlistBookmarks.length > 0 || trips.length === 0) {
      const cover = this.getBookmarkCover(wishlistBookmarks);
      result.push({
        trip: { id: WISHLIST_ID, name: 'Wishlist', createdAt: '', updatedAt: '' },
        bookmarks: wishlistBookmarks,
        coverUrl: cover,
      });
    }

    for (const t of trips) {
      const tBookmarks = tripMap.get(t.id) || [];
      result.push({
        trip: t,
        bookmarks: tBookmarks,
        coverUrl: t.coverUrl || this.getBookmarkCover(tBookmarks),
      });
    }

    this.savedTrips = result;
    this.cdr.detectChanges();
  }

  private getBookmarkCover(bookmarks: any[]): string {
    if (bookmarks.length === 0) return '';
    const first = bookmarks[0];
    if (first.cloudinaryUrl) {
      return first.cloudinaryUrl
        .replace('/video/upload/', '/video/upload/so_0,w_400,h_400,c_fill,q_auto,f_auto/')
        .replace(/\.[^.]+$/, '.jpg');
    }
    return first.thumbnailUrl || first.images?.[0]?.url || '';
  }

  openSavedGroup(entry: { trip: Trip; bookmarks: any[]; coverUrl: string }) {
    this.savedGroupTrip = entry.trip;
    this.savedGroupVideos = entry.bookmarks;
    this.showSavedGroup = true;
  }

  closeSavedGroup() {
    this.showSavedGroup = false;
    this.savedEditMode = false;
    this.showEditTrip = false;
  }

  async deleteSavedTrip(entry: { trip: Trip; bookmarks: any[] }, event: Event) {
    event.stopPropagation();
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    if (entry.trip.id === WISHLIST_ID) {
      // Delete all wishlist bookmarks
      await Promise.all(entry.bookmarks.map(v => deleteDoc(doc(db, 'users', uid, 'bookmarks', v.id))));
    } else {
      await this.tripService.deleteTrip(entry.trip.id);
    }
    this.savedTrips = this.savedTrips.filter(g => g.trip.id !== entry.trip.id);
    if (this.savedTrips.length === 0) this.savedEditMode = false;
    this.cdr.detectChanges();
  }

  async deleteSavedItem(item: any, event: Event) {
    event.stopPropagation();
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'bookmarks', item.id));
    this.savedGroupVideos = this.savedGroupVideos.filter(v => v.id !== item.id);
    const entry = this.savedTrips.find(g => g.trip.id === this.savedGroupTrip?.id);
    if (entry) {
      entry.bookmarks = entry.bookmarks.filter((v: any) => v.id !== item.id);
      entry.coverUrl = this.getBookmarkCover(entry.bookmarks);
      if (entry.bookmarks.length === 0 && entry.trip.id !== WISHLIST_ID) {
        await this.tripService.deleteTrip(entry.trip.id);
        this.savedTrips = this.savedTrips.filter(g => g.trip.id !== entry.trip.id);
        this.showSavedGroup = false;
        this.savedEditMode = false;
      }
    }
    if (this.savedGroupVideos.length === 0) this.savedEditMode = false;
    this.cdr.detectChanges();
  }

  getCountdown(date: string): string {
    const diff = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Past';
    if (diff === 0) return 'Today!';
    if (diff === 1) return 'Tomorrow';
    if (diff <= 30) return `${diff} days`;
    const months = Math.round(diff / 30);
    return months === 1 ? 'In 1 month' : `In ${months} months`;
  }

  openEditTrip() {
    if (!this.savedGroupTrip || this.savedGroupTrip.id === WISHLIST_ID) return;
    this.editTripName = this.savedGroupTrip.name;
    this.editTripDate = this.savedGroupTrip.date || '';
    this.showEditTrip = true;
  }

  async saveEditTrip() {
    if (!this.savedGroupTrip || this.savedGroupTrip.id === WISHLIST_ID) return;
    const data: any = { name: this.editTripName.trim() };
    if (this.editTripDate) data.date = this.editTripDate;
    else data.date = '';
    await this.tripService.updateTrip(this.savedGroupTrip.id, data);
    this.savedGroupTrip.name = data.name;
    this.savedGroupTrip.date = data.date || undefined;
    const entry = this.savedTrips.find(g => g.trip.id === this.savedGroupTrip!.id);
    if (entry) { entry.trip.name = data.name; entry.trip.date = data.date || undefined; }
    this.showEditTrip = false;
    this.cdr.detectChanges();
  }

  async onSavedItemClick(item: any) {
    if (item._type === 'post') {
      // Fetch full post data so likes/comments/title are populated
      const postDoc = await getDoc(doc(db, 'posts', item.id));
      if (postDoc.exists()) {
        const data = postDoc.data();
        const uid = this.authService.currentUser()?.uid;
        let liked = false;
        if (uid) {
          const likeDoc = await getDoc(doc(db, 'posts', item.id, 'likes', uid));
          liked = likeDoc.exists();
        }
        this.imageViewerPost = { ...item, ...data, id: item.id, liked, bookmarked: true };
      } else {
        this.imageViewerPost = item;
      }
      this.showImageViewer = true;
      this.cdr.detectChanges();
    } else {
      // Find the video in the videos array and open viewer
      const videoIndex = this.videos.findIndex(v => v.id === item.id || v.id === item.videoId);
      if (videoIndex >= 0) {
        this.openVideoViewer(videoIndex);
      } else {
        // Bookmarked video from another user — fetch and open standalone
        const videoId = item.videoId || item.id;
        const videoDoc = await getDoc(doc(db, 'videos', videoId));
        if (videoDoc.exists()) {
          const videoData = { id: videoDoc.id, ...videoDoc.data(), liked: false, bookmarked: true } as any;
          const uid = this.authService.currentUser()?.uid;
          if (uid) {
            const likeDoc = await getDoc(doc(db, 'videos', videoId, 'likes', uid));
            videoData.liked = likeDoc.exists();
          }
          this.videos.push(videoData);
          this.openVideoViewer(this.videos.length - 1);
        }
      }
    }
  }

  openComments(video: any) {
    this.activeVideo = video;
    this.showComments = true;
    this.cdr.detectChanges();
  }

  closeComments() {
    this.showComments = false;
    this.activeVideo = null;
  }

  onCommentCountChange(delta: number) {
    if (this.activeVideo) this.activeVideo.commentCount += delta;
    this.cdr.detectChanges();
  }

  get commentsVideoId(): string { return this.activeVideo?.id || ''; }
  get commentsOwnerId(): string { return this.activeVideo?.userId || ''; }
  get commentsTitle(): string { return this.activeVideo?.title || ''; }

  async checkBlocked() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.profileUser?.uid) return;
    const [blockDoc, reverseDoc] = await Promise.all([
      getDoc(doc(db, 'users', uid, 'blockedUsers', this.profileUser.uid)),
      getDoc(doc(db, 'users', this.profileUser.uid, 'blockedUsers', uid)),
    ]);
    this.isBlocked = blockDoc.exists();
    this.blockedByThem = reverseDoc.exists();
    this.cdr.detectChanges();
  }

  async blockUser() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.profileUser?.uid) return;
    this.showOtherMenu = false;
    if (this.isBlocked) {
      await deleteDoc(doc(db, 'users', uid, 'blockedUsers', this.profileUser.uid));
      this.blockService.removeBlock(this.profileUser.uid);
      this.isBlocked = false;
      this.cdr.detectChanges();
    } else {
      this.openConfirm(`Block ${this.profileUser.username}? They won't be able to message you.`, 'Block', true, async () => {
        const targetUid = this.profileUser.uid;
        await setDoc(doc(db, 'users', uid, 'blockedUsers', targetUid), { blockedAt: new Date().toISOString() });
        this.blockService.addBlock(targetUid);
        this.isBlocked = true;

        // Mutual unfollow
        const followerRef = doc(db, 'users', targetUid, 'followers', uid);
        const followingRef = doc(db, 'users', uid, 'following', targetUid);
        const reverseFollowerRef = doc(db, 'users', uid, 'followers', targetUid);
        const reverseFollowingRef = doc(db, 'users', targetUid, 'following', uid);

        const [f1, f2] = await Promise.all([
          getDoc(followerRef),
          getDoc(reverseFollowerRef),
        ]);

        if (f1.exists()) {
          await deleteDoc(followerRef);
          await deleteDoc(followingRef);
          await updateDoc(doc(db, 'users', targetUid), { followerCount: increment(-1) });
          await updateDoc(doc(db, 'users', uid), { followingCount: increment(-1) });
        }
        if (f2.exists()) {
          await deleteDoc(reverseFollowerRef);
          await deleteDoc(reverseFollowingRef);
          await updateDoc(doc(db, 'users', uid), { followerCount: increment(-1) });
          await updateDoc(doc(db, 'users', targetUid), { followingCount: increment(-1) });
        }

        this.isFollowing = false;
        this.profileUser.followerCount = Math.max(0, this.profileUser.followerCount - (f1.exists() ? 1 : 0));
        this.cdr.detectChanges();
      });
    }
  }

  reportUser() {
    this.showOtherMenu = false;
    this.showReportPanel = true;
    this.reportReason = '';
    this.reportDetails = '';
    this.reportSuccess = false;
  }

  async submitReport() {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.reportReason) return;
    this.reportLoading = true;
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: uid,
        reportedUserId: this.profileUser.uid,
        reportedContentId: null,
        contentType: 'user',
        reason: this.reportReason,
        details: this.reportDetails.trim(),
        createdAt: new Date().toISOString(),
      });
      this.reportSuccess = true;
    } catch {
      // silently fail
    } finally {
      this.reportLoading = false;
      this.cdr.detectChanges();
    }
  }

  closeReportPanel() {
    this.showReportPanel = false;
    this.reportReason = '';
    this.reportDetails = '';
    this.reportSuccess = false;
  }

  // ── Share ──

  showCopiedToast = false;

  async onShare(video: any) {
    const copied = await sharePost(video.title);
    if (copied) {
      this.showCopiedToast = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.showCopiedToast = false; this.cdr.detectChanges(); }, 2000);
    }
  }

  // ── Content Report (from PostCard) ──
  showContentReportPanel = false;
  contentReportId = '';
  contentReportType: 'video' | 'post' = 'post';
  contentReportOwnerId = '';

  openContentReport(data: { contentId: string; contentType: string; contentOwnerId: string }) {
    this.contentReportId = data.contentId;
    this.contentReportType = data.contentType as 'video' | 'post';
    this.contentReportOwnerId = data.contentOwnerId;
    this.showContentReportPanel = true;
    this.cdr.detectChanges();
  }

  closeContentReport() {
    this.showContentReportPanel = false;
  }
}
