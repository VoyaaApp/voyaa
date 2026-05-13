import { Injectable } from '@angular/core';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, writeBatch } from 'firebase/firestore';
import { db, auth } from './firebase.service';

export interface Trip {
  id: string;
  name: string;
  date?: string;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const WISHLIST_ID = '__wishlist__';

@Injectable({ providedIn: 'root' })
export class TripService {

  async getTrips(uid: string): Promise<Trip[]> {
    const snapshot = await getDocs(collection(db, 'users', uid, 'trips'));
    const trips = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trip));
    trips.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return trips;
  }

  async createTrip(name: string, date?: string): Promise<Trip> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    const now = new Date().toISOString();
    const data: Omit<Trip, 'id'> = { name, createdAt: now, updatedAt: now };
    if (date) data.date = date;
    const ref = await addDoc(collection(db, 'users', uid, 'trips'), data);
    return { id: ref.id, ...data };
  }

  async updateTrip(tripId: string, data: Partial<{ name: string; date: string; coverUrl: string }>): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'trips', tripId), { ...data, updatedAt: new Date().toISOString() });
  }

  async deleteTrip(tripId: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Move orphaned bookmarks to wishlist
    const bookmarksRef = collection(db, 'users', uid, 'bookmarks');
    const q = query(bookmarksRef, where('tripId', '==', tripId));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => {
      batch.update(d.ref, { tripId: WISHLIST_ID });
    });
    batch.delete(doc(db, 'users', uid, 'trips', tripId));
    await batch.commit();
  }
}
