/** Firestore `users/{uid}` document */
export interface VoyaaUser {
  uid: string;
  username: string;
  email: string;
  photoURL: string;
  bio: string;
  nationality: string;
  dateOfBirth?: string;
  allowMessages: boolean;
  followerCount: number;
  followingCount: number;
  createdAt: string;
}

/** Location sub-object used in videos and posts */
export interface PostLocation {
  country: string;
  city?: string;
  lat?: number;
  lon?: number;
}

/** Firestore `videos/{id}` document */
export interface Video {
  id: string;
  userId: string;
  cloudinaryUrl: string;
  title: string;
  location: PostLocation;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: string;
}

/** Firestore `posts/{id}` document */
export interface Post {
  id: string;
  userId: string;
  title: string;
  location: PostLocation;
  images: { url: string; publicId: string }[];
  thumbnailUrl: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
}

/** Firestore `videos/{id}/comments/{id}` or `posts/{id}/comments/{id}` */
export interface Comment {
  id: string;
  userId: string;
  username: string;
  photoURL: string;
  text: string;
  parentId?: string;
  likeCount: number;
  createdAt: string;
}

/** Firestore `users/{uid}/bookmarks/{id}` */
export interface Bookmark {
  id: string;
  videoId?: string;
  tripId: string;
  country?: string;
  city?: string;
  title?: string;
  cloudinaryUrl?: string;
  images?: { url: string; publicId: string }[];
  thumbnailUrl?: string;
  _type: 'video' | 'post';
  createdAt: string;
}

/** Firestore `conversations/{id}` */
export interface Conversation {
  id: string;
  participants: string[];
  lastMessage: string;
  updatedAt: any;
  [key: `unreadCount_${string}`]: number;
}

/** Firestore `users/{uid}/notifications/{id}` */
export interface Notification {
  id: string;
  type: 'like' | 'follow' | 'comment';
  fromUserId: string;
  fromUsername: string;
  fromPhotoURL: string;
  videoId?: string;
  videoTitle?: string;
  createdAt: string;
  read: boolean;
}

/** Enriched video card used in explore/feed/destination views */
export interface FeedItem {
  id: string;
  cloudinaryUrl: string;
  country: string;
  city: string;
  createdAt: any;
  userId: string;
  username: string;
  photoURL: string;
  title: string;
  liked: boolean;
  bookmarked: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  following?: boolean;
  showHeart?: boolean;
  showMenu?: boolean;
  _type: 'video' | 'post';
  images?: { url: string; publicId: string }[];
  thumbnailUrl?: string;
  imageIndex?: number;
  followAnimating?: boolean;
  likeAnimating?: boolean;
}
