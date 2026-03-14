import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, addDoc, getDocs, doc, deleteDoc,
  query, limit as firestoreLimit, where,
  serverTimestamp, Timestamp
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { SessionPort, SessionRecord } from '../../core/ports/session.port';

@Injectable({ providedIn: 'root' })
export class FirestoreSessionAdapter implements SessionPort {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async save(session: SessionRecord): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    await addDoc(collection(this.firestore, 'sessions'), {
      ...session,
      userId: uid ?? 'anonymous',
      startedAt: serverTimestamp(),
    });
  }

  async getRecent(n: number): Promise<(SessionRecord & { id: string; startedAt: Date })[]> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return [];

    const snap = await getDocs(
      query(
        collection(this.firestore, 'sessions'),
        where('userId', '==', uid),
        firestoreLimit(n)
      )
    );

    return snap.docs
      .map(doc => {
        const data = doc.data();
        const ts = data['startedAt'] as Timestamp | null;
        return {
          id: doc.id,
          agentId: data['agentId'] as string,
          topic: data['topic'] as string,
          storyText: data['storyText'] as string,
          durationSeconds: data['durationSeconds'] as number,
          startedAt: ts ? ts.toDate() : new Date(),
        };
      })
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'sessions', id));
  }
}
