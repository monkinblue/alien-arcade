import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getSharedFirestore, type UplinkConnectionStatus } from '../../services/leaderboard';
import type { FlakScoreEntry } from './types';

const FLAK_LOCAL_STORAGE_KEY = 'nostromo_flak_scores_v1';
const SHARED_CALLSIGN_KEY = 'nostromo_lander_last_callsign_v1';

interface FirestoreFlakDoc {
  callsign?: unknown;
  score?: unknown;
  wave?: unknown;
  maxChain?: unknown;
  accuracy?: unknown;
  createdAt?: Timestamp | null;
}

const ARCHIVE_SEED_SCORES: FlakScoreEntry[] = [
  {
    id: 'archive-1',
    callsign: 'HICKS-01',
    score: 48200,
    wave: 8,
    maxChain: 8,
    accuracy: 78,
    date: '2179-07-14',
    isArchiveFallback: true,
  },
  {
    id: 'archive-2',
    callsign: 'VASQUEZ',
    score: 36950,
    wave: 7,
    maxChain: 6,
    accuracy: 72,
    date: '2179-07-14',
    isArchiveFallback: true,
  },
  {
    id: 'archive-3',
    callsign: 'BISHOP',
    score: 29400,
    wave: 6,
    maxChain: 4,
    accuracy: 84,
    date: '2179-07-13',
    isArchiveFallback: true,
  },
  {
    id: 'archive-4',
    callsign: 'APONE',
    score: 18600,
    wave: 4,
    maxChain: 4,
    accuracy: 66,
    date: '2179-07-12',
    isArchiveFallback: true,
  },
  {
    id: 'archive-5',
    callsign: 'HUDSON',
    score: 11250,
    wave: 3,
    maxChain: 2,
    accuracy: 59,
    date: '2179-07-11',
    isArchiveFallback: true,
  },
];

export class FlakLeaderboardService {
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private status: UplinkConnectionStatus = 'LOADING';
  private onlineEntries: FlakScoreEntry[] = [];
  private localEntries: FlakScoreEntry[] = [];

  constructor() {
    this.loadLocalArchive();
    this.initRealtimeSubscription();
  }

  private loadLocalArchive(): void {
    try {
      const raw = window.localStorage.getItem(FLAK_LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.localEntries = (parsed as FlakScoreEntry[]).slice(0, 25);
          this.localEntries.sort((a, b) => b.score - a.score);
          return;
        }
      }
    } catch {
      // Fallback to seeded archive
    }
    this.localEntries = ARCHIVE_SEED_SCORES.map((e) => ({ ...e }));
  }

  private saveLocalArchive(): void {
    try {
      window.localStorage.setItem(
        FLAK_LOCAL_STORAGE_KEY,
        JSON.stringify(this.localEntries.slice(0, 25))
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private initRealtimeSubscription(): void {
    try {
      this.db = getSharedFirestore();
      if (!this.db) {
        this.status = 'OFFLINE';
        return;
      }

      // Single-field index query ONLY: orderBy('score', 'desc'), limit(25)
      const q = query(
        collection(this.db, 'flak_scores'),
        orderBy('score', 'desc'),
        limit(25)
      );

      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list: FlakScoreEntry[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data() as FirestoreFlakDoc;
            if (typeof raw.callsign !== 'string' || typeof raw.score !== 'number') {
              return;
            }
            const wave =
              typeof raw.wave === 'number' && Number.isFinite(raw.wave)
                ? Math.max(1, Math.min(99, Math.round(raw.wave)))
                : 1;
            const maxChain =
              typeof raw.maxChain === 'number' && Number.isFinite(raw.maxChain)
                ? Math.max(1, Math.min(99, Math.round(raw.maxChain)))
                : 1;
            const accuracy =
              typeof raw.accuracy === 'number' && Number.isFinite(raw.accuracy)
                ? Math.max(0, Math.min(100, Math.round(raw.accuracy)))
                : 0;

            let dateStr = 'LIVE';
            if (raw.createdAt && typeof raw.createdAt.toDate === 'function') {
              try {
                dateStr = raw.createdAt.toDate().toISOString().slice(0, 10);
              } catch {
                dateStr = 'LIVE';
              }
            }

            list.push({
              id: docSnap.id,
              callsign: raw.callsign.trim().slice(0, 16).toUpperCase() || 'GUNNER',
              score: Math.max(1, Math.min(5000000, Math.round(raw.score))),
              wave,
              maxChain,
              accuracy,
              date: dateStr,
              isArchiveFallback: false,
            });
          });

          list.sort((a, b) => b.score - a.score);
          this.onlineEntries = list;
          this.status = 'LIVE';
        },
        (err) => {
          console.warn('[FLAK NET UPLINK] Firestore flak_scores unavailable, using local archive:', err);
          this.status = 'OFFLINE';
        }
      );
    } catch (err) {
      console.warn('[FLAK NET UPLINK] Firestore subscription init error:', err);
      this.status = 'OFFLINE';
    }
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public getStatus(): UplinkConnectionStatus {
    return this.status;
  }

  public getSavedCallsign(): string {
    try {
      const saved = window.localStorage.getItem(SHARED_CALLSIGN_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim().slice(0, 16).toUpperCase();
      }
    } catch {
      // Ignore
    }
    return 'GUNNER-01';
  }

  public saveCallsign(raw: string): string {
    const cleaned = raw.trim().slice(0, 16).toUpperCase() || 'GUNNER-01';
    try {
      window.localStorage.setItem(SHARED_CALLSIGN_KEY, cleaned);
    } catch {
      // Ignore
    }
    return cleaned;
  }

  public getReigningLeader(): FlakScoreEntry | null {
    if (this.onlineEntries.length > 0) {
      return this.onlineEntries[0];
    }
    return this.localEntries.length > 0 ? this.localEntries[0] : null;
  }

  public getEntries(): { entries: readonly FlakScoreEntry[]; showingArchiveFallback: boolean } {
    if (this.onlineEntries.length > 0) {
      return { entries: this.onlineEntries, showingArchiveFallback: false };
    }
    return { entries: this.localEntries, showingArchiveFallback: true };
  }

  /**
   * Submits finalized run score to Firestore `flak_scores` with EXACTLY the 6 required keys
   * (zero extra fields, no profanity filter) and mirrors locally as offline fallback.
   */
  public async submitScore(params: {
    callsign: string;
    score: number;
    wave: number;
    maxChain: number;
    accuracy: number;
  }): Promise<{
    ok: boolean;
    rank: number;
    offlineFallback: boolean;
    docId?: string;
  }> {
    const callsign = this.saveCallsign(params.callsign);
    const score = Math.max(1, Math.min(5000000, Math.round(params.score)));
    const wave = Math.max(1, Math.min(99, Math.round(params.wave)));
    const maxChain = Math.max(1, Math.min(99, Math.round(params.maxChain)));
    const accuracy = Math.max(0, Math.min(100, Math.round(params.accuracy)));

    // Always mirror into localStorage fallback archive
    const localId = `local-${Date.now()}`;
    const localEntry: FlakScoreEntry = {
      id: localId,
      callsign,
      score,
      wave,
      maxChain,
      accuracy,
      date: new Date().toISOString().slice(0, 10),
      isArchiveFallback: true,
    };
    this.localEntries.push(localEntry);
    this.localEntries.sort((a, b) => b.score - a.score);
    if (this.localEntries.length > 25) {
      this.localEntries.length = 25;
    }
    this.saveLocalArchive();

    if (!this.db) {
      const idx = this.localEntries.findIndex((e) => e.id === localEntry.id);
      return { ok: false, rank: Math.max(1, idx + 1), offlineFallback: true, docId: localId };
    }

    try {
      // EXACT 6-key Firestore document schema:
      // callsign (1-16), score (1..5000000), wave (1..99), maxChain (1..99), accuracy (0..100), createdAt
      const docRef = await addDoc(collection(this.db, 'flak_scores'), {
        callsign,
        score,
        wave,
        maxChain,
        accuracy,
        createdAt: serverTimestamp(),
      });

      let higherCount = 0;
      for (const item of this.onlineEntries) {
        if (item.score > score) higherCount++;
      }
      return { ok: true, rank: higherCount + 1, offlineFallback: false, docId: docRef.id };
    } catch (err) {
      console.warn('[FLAK NET UPLINK] Firestore flak_scores write fell back to local archive:', err);
      const idx = this.localEntries.findIndex((e) => e.id === localEntry.id);
      return { ok: false, rank: Math.max(1, idx + 1), offlineFallback: true, docId: localId };
    }
  }
}
