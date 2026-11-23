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
import type { TrenchScoreEntry } from './types';

const CALLSIGN_STORAGE_KEY = 'nostromo_lander_last_callsign_v1';
const LOCAL_FALLBACK_KEY = 'muthur_trench_scores_fallback_v1';

interface FirestoreTrenchScoreDoc {
  callsign?: unknown;
  score?: unknown;
  distance?: unknown;
  maxMach?: unknown;
  grazes?: unknown;
  createdAt?: Timestamp | null;
}

const ARCHIVE_FALLBACK: TrenchScoreEntry[] = [
  {
    id: 'trench-seed-1',
    callsign: 'FERRO-01',
    score: 28400,
    distance: 7640,
    maxMach: 3.6,
    grazes: 18,
    date: '2179-06-14',
    isArchiveFallback: true,
  },
  {
    id: 'trench-seed-2',
    callsign: 'SPUNKMEYER',
    score: 19250,
    distance: 5420,
    maxMach: 3.1,
    grazes: 12,
    date: '2179-06-12',
    isArchiveFallback: true,
  },
  {
    id: 'trench-seed-3',
    callsign: 'RIPLEY-8',
    score: 13800,
    distance: 3890,
    maxMach: 2.7,
    grazes: 9,
    date: '2179-06-10',
    isArchiveFallback: true,
  },
];

export class TrenchLeaderboardService {
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private status: UplinkConnectionStatus = 'LOADING';
  private onlineScores: TrenchScoreEntry[] = [];
  private localScores: TrenchScoreEntry[] = [];

  constructor() {
    this.localScores = this.loadLocalFallback();
    this.initRealtimeSubscription();
  }

  private initRealtimeSubscription(): void {
    try {
      this.db = getSharedFirestore();
      if (!this.db) {
        this.status = 'OFFLINE';
        return;
      }

      const q = query(collection(this.db, 'trench_scores'), orderBy('score', 'desc'), limit(25));
      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const next: TrenchScoreEntry[] = [];
          snapshot.forEach((docSnap) => {
            const parsed = this.parseDoc(docSnap.id, docSnap.data() as FirestoreTrenchScoreDoc);
            if (parsed) next.push(parsed);
          });
          next.sort((a, b) => b.score - a.score);
          this.onlineScores = next.slice(0, 25);
          this.status = 'LIVE';
        },
        (err) => {
          console.warn('[TRENCH UPLINK] Firestore listener error:', err);
          this.status = 'OFFLINE';
        }
      );
    } catch (err) {
      console.warn('[TRENCH UPLINK] Failed to subscribe to trench_scores:', err);
      this.status = 'OFFLINE';
    }
  }

  private parseDoc(id: string, raw: FirestoreTrenchScoreDoc): TrenchScoreEntry | null {
    if (typeof raw.callsign !== 'string' || typeof raw.score !== 'number') return null;
    if (!Number.isFinite(raw.score)) return null;

    const callsign = raw.callsign.trim().slice(0, 16).toUpperCase() || 'PILOT';
    const score = Math.max(1, Math.min(5_000_000, Math.round(raw.score)));
    const distance =
      typeof raw.distance === 'number' && Number.isFinite(raw.distance)
        ? Math.max(0, Math.min(999_999, Math.round(raw.distance)))
        : 0;
    const maxMach =
      typeof raw.maxMach === 'number' && Number.isFinite(raw.maxMach)
        ? Math.round(Math.max(0, Math.min(20, raw.maxMach)) * 10) / 10
        : 1.0;
    const grazes =
      typeof raw.grazes === 'number' && Number.isFinite(raw.grazes)
        ? Math.max(0, Math.min(9999, Math.round(raw.grazes)))
        : 0;

    let dateStr = new Date().toISOString().slice(0, 10);
    if (raw.createdAt && typeof raw.createdAt.toDate === 'function') {
      try {
        dateStr = raw.createdAt.toDate().toISOString().slice(0, 10);
      } catch {
        // Keep fallback
      }
    }

    return {
      id,
      callsign,
      score,
      distance,
      maxMach,
      grazes,
      date: dateStr,
      isArchiveFallback: false,
    };
  }

  private loadLocalFallback(): TrenchScoreEntry[] {
    try {
      const raw = window.localStorage.getItem(LOCAL_FALLBACK_KEY);
      if (!raw) return ARCHIVE_FALLBACK.map((e) => ({ ...e }));
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return ARCHIVE_FALLBACK.map((e) => ({ ...e }));
      const valid = parsed
        .filter((e): e is TrenchScoreEntry => Boolean(e && typeof e.callsign === 'string'))
        .slice(0, 25);
      return valid.length > 0 ? valid : ARCHIVE_FALLBACK.map((e) => ({ ...e }));
    } catch {
      return ARCHIVE_FALLBACK.map((e) => ({ ...e }));
    }
  }

  private saveLocalFallback(entries: TrenchScoreEntry[]): void {
    try {
      window.localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(entries.slice(0, 25)));
    } catch {
      // Ignore private browsing quota errors
    }
  }

  public getStatus(): UplinkConnectionStatus {
    return this.status;
  }

  public getEntries(): TrenchScoreEntry[] {
    if (this.status === 'LIVE') {
      return this.onlineScores;
    }
    return this.localScores;
  }

  public getTopLeader(): TrenchScoreEntry | null {
    const list = this.getEntries();
    return list.length > 0 ? list[0] : null;
  }

  public getSavedCallsign(): string {
    try {
      const saved = window.localStorage.getItem(CALLSIGN_STORAGE_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim().toUpperCase().slice(0, 16);
      }
    } catch {
      // Ignore
    }
    return 'VECTOR-04';
  }

  public saveCallsign(callsign: string): void {
    const clean = callsign.trim().toUpperCase().slice(0, 16);
    if (!clean) return;
    try {
      window.localStorage.setItem(CALLSIGN_STORAGE_KEY, clean);
    } catch {
      // Ignore
    }
  }

  public async submitScore(params: {
    callsign: string;
    score: number;
    distance: number;
    maxMach: number;
    grazes: number;
  }): Promise<{ ok: boolean; online: boolean; rank: number; docId?: string; error?: string }> {
    const cleanCallsign =
      params.callsign
        .replace(/[^A-Za-z0-9 _-]/g, '')
        .trim()
        .toUpperCase()
        .slice(0, 16) || 'PILOT';

    const cleanScore = Math.max(1, Math.min(5_000_000, Math.round(params.score)));
    const cleanDistance = Math.max(0, Math.min(999_999, Math.round(params.distance)));
    const cleanMaxMach = Math.round(Math.max(0, Math.min(20, params.maxMach)) * 10) / 10;
    const cleanGrazes = Math.max(0, Math.min(9999, Math.round(params.grazes)));

    this.saveCallsign(cleanCallsign);

    const localId = `local-${Date.now()}`;
    const localEntry: TrenchScoreEntry = {
      id: localId,
      callsign: cleanCallsign,
      score: cleanScore,
      distance: cleanDistance,
      maxMach: cleanMaxMach,
      grazes: cleanGrazes,
      date: new Date().toISOString().slice(0, 10),
      isArchiveFallback: false,
    };

    const nextLocal = [...this.localScores.filter((e) => !e.isArchiveFallback), localEntry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
    this.localScores = nextLocal;
    this.saveLocalFallback(nextLocal);

    if (!this.db) {
      const rank = nextLocal.findIndex((e) => e.id === localId) + 1;
      return { ok: true, online: false, rank: Math.max(1, rank), docId: localId };
    }

    try {
      // Exact 6-field schema for Firestore `trench_scores` (no extra keys!)
      const docRef = await addDoc(collection(this.db, 'trench_scores'), {
        callsign: cleanCallsign,
        score: cleanScore,
        distance: cleanDistance,
        maxMach: cleanMaxMach,
        grazes: cleanGrazes,
        createdAt: serverTimestamp(),
      });

      const insertedId = docRef.id;
      const merged = [
        ...this.onlineScores.filter((e) => e.id !== insertedId),
        { ...localEntry, id: insertedId },
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, 25);
      this.onlineScores = merged;
      this.status = 'LIVE';

      const rank = merged.findIndex((e) => e.id === insertedId) + 1;
      return { ok: true, online: true, rank: Math.max(1, rank), docId: insertedId };
    } catch (err) {
      console.warn('[TRENCH UPLINK] Score submission failed; kept local fallback:', err);
      const rank = nextLocal.findIndex((e) => e.id === localId) + 1;
      return {
        ok: true,
        online: false,
        rank: Math.max(1, rank),
        docId: localId,
        error: String(err),
      };
    }
  }

  public dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
