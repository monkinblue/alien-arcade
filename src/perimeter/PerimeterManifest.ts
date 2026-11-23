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
import { getSharedFirestore, type UplinkConnectionStatus } from '../services/leaderboard';
import type { PerimeterManifestEntry, PerimeterMode } from './types';

const MANIFEST_STORAGE_KEY = 'interface2037_perimeter_manifest_v1';
const SHARED_CALLSIGN_KEY = 'nostromo_lander_last_callsign_v1';
const LEGACY_PERIMETER_CALLSIGN_KEY = 'interface2037_callsign_v1';

interface FirestorePerimeterDoc {
  callsign?: unknown;
  score?: unknown;
  waves?: unknown;
  kills?: unknown;
  mode?: unknown;
  createdAt?: Timestamp | null;
}

const SEEDED_RECORDS: PerimeterManifestEntry[] = [
  {
    callsign: 'HICKS',
    waves: 10,
    kills: 412,
    score: 54800,
    mode: 'SECTOR_01',
    date: '2179-07-14',
  },
  {
    callsign: 'VASQUEZ',
    waves: 14,
    kills: 638,
    score: 79400,
    mode: 'ENDLESS_SIEGE',
    date: '2179-07-14',
  },
  {
    callsign: 'BISHOP',
    waves: 10,
    kills: 388,
    score: 49200,
    mode: 'SECTOR_01',
    date: '2179-07-13',
  },
  {
    callsign: 'RIPLEY',
    waves: 12,
    kills: 510,
    score: 64150,
    mode: 'ENDLESS_SIEGE',
    date: '2179-07-15',
  },
  {
    callsign: 'HUDSON',
    waves: 7,
    kills: 245,
    score: 28600,
    mode: 'SECTOR_01',
    date: '2179-07-12',
  },
];

export class PerimeterManifest {
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private status: UplinkConnectionStatus = 'LOADING';
  private onlineEntries: PerimeterManifestEntry[] = [];
  private localEntries: PerimeterManifestEntry[] = [];

  constructor() {
    this.loadLocal();
    this.initRealtimeSubscription();
  }

  private loadLocal(): void {
    try {
      const raw = window.localStorage.getItem(MANIFEST_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.localEntries = (parsed as PerimeterManifestEntry[]).slice(0, 25);
          this.sortEntries(this.localEntries);
          return;
        }
      }
    } catch {
      // Fallback to seeded archive if storage unavailable
    }
    this.localEntries = SEEDED_RECORDS.map((e) => ({ ...e }));
    this.sortEntries(this.localEntries);
  }

  private sortEntries(list: PerimeterManifestEntry[]): void {
    list.sort((a, b) => b.score - a.score || b.waves - a.waves);
    if (list.length > 25) {
      list.length = 25;
    }
  }

  private saveLocal(): void {
    try {
      window.localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(this.localEntries));
    } catch {
      // Ignore quota errors
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
        collection(this.db, 'perimeter_scores'),
        orderBy('score', 'desc'),
        limit(25)
      );

      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list: PerimeterManifestEntry[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data() as FirestorePerimeterDoc;
            if (typeof raw.callsign !== 'string' || typeof raw.score !== 'number') {
              return;
            }
            const mode: PerimeterMode =
              raw.mode === 'ENDLESS' || raw.mode === 'ENDLESS_SIEGE'
                ? 'ENDLESS_SIEGE'
                : 'SECTOR_01';
            const waves =
              typeof raw.waves === 'number' && Number.isFinite(raw.waves)
                ? Math.max(1, Math.min(999, Math.round(raw.waves)))
                : 1;
            const kills =
              typeof raw.kills === 'number' && Number.isFinite(raw.kills)
                ? Math.max(0, Math.min(100000, Math.round(raw.kills)))
                : 0;
            const score = Math.max(1, Math.min(5000000, Math.round(raw.score)));

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
              callsign: raw.callsign.trim().slice(0, 16).toUpperCase() || 'MARINE-01',
              waves,
              kills,
              score,
              mode,
              date: dateStr,
            });
          });

          this.sortEntries(list);
          this.onlineEntries = list;
          this.status = 'LIVE';
        },
        (err) => {
          console.warn(
            '[PERIMETER UPLINK] Firestore perimeter_scores unavailable, using local archive:',
            err
          );
          this.status = 'OFFLINE';
        }
      );
    } catch (err) {
      console.warn('[PERIMETER UPLINK] Firestore subscription init error:', err);
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
      const shared = window.localStorage.getItem(SHARED_CALLSIGN_KEY)?.trim().toUpperCase();
      if (shared && shared.length > 0) return shared.slice(0, 16);
      const legacy = window.localStorage.getItem(LEGACY_PERIMETER_CALLSIGN_KEY)?.trim().toUpperCase();
      if (legacy && legacy.length > 0) return legacy.slice(0, 16);
    } catch {
      // Ignore
    }
    return 'HICKS-01';
  }

  public saveCallsign(raw: string): string {
    const cleanSign = raw.trim().toUpperCase().slice(0, 16) || 'MARINE-01';
    try {
      window.localStorage.setItem(SHARED_CALLSIGN_KEY, cleanSign);
      window.localStorage.setItem(LEGACY_PERIMETER_CALLSIGN_KEY, cleanSign);
    } catch {
      // Ignore
    }
    return cleanSign;
  }

  public getReigningLeader(): PerimeterManifestEntry | null {
    return this.onlineEntries.length > 0 ? this.onlineEntries[0] : null;
  }

  public getManifestEntries(mode?: PerimeterMode): {
    entries: readonly PerimeterManifestEntry[];
    showingArchiveFallback: boolean;
  } {
    if (this.onlineEntries.length > 0) {
      const filtered = mode
        ? this.onlineEntries.filter((e) => e.mode === mode)
        : this.onlineEntries;
      return { entries: filtered, showingArchiveFallback: false };
    }
    const filteredLocal = mode
      ? this.localEntries.filter((e) => e.mode === mode)
      : this.localEntries;
    return { entries: filteredLocal, showingArchiveFallback: true };
  }

  public getTopEntries(mode?: PerimeterMode, maxCount = 15): PerimeterManifestEntry[] {
    return this.getManifestEntries(mode).entries.slice(0, maxCount);
  }

  /**
   * Submits a finalized Hadley's Perimeter run to Firestore `perimeter_scores` with EXACTLY
   * the 6 required keys (`callsign`, `score`, `waves`, `kills`, `mode`, `createdAt`) and mirrors locally.
   */
  public async submitScore(entry: Omit<PerimeterManifestEntry, 'date'>): Promise<{
    ok: boolean;
    rank: number;
    offlineFallback: boolean;
    docId?: string;
  }> {
    const callsign = this.saveCallsign(entry.callsign);
    const score = Math.max(1, Math.min(5000000, Math.round(entry.score)));
    const waves = Math.max(1, Math.min(999, Math.round(entry.waves)));
    const kills = Math.max(0, Math.min(100000, Math.round(entry.kills)));
    const firestoreMode: 'CAMPAIGN' | 'ENDLESS' =
      entry.mode === 'ENDLESS_SIEGE' ? 'ENDLESS' : 'CAMPAIGN';

    // Always mirror locally as offline fallback
    const localId = `local-${Date.now()}`;
    const fullLocal: PerimeterManifestEntry = {
      id: localId,
      callsign,
      waves,
      kills,
      score,
      mode: entry.mode,
      date: new Date().toISOString().slice(0, 10),
    };
    this.localEntries.push(fullLocal);
    this.sortEntries(this.localEntries);
    this.saveLocal();

    if (!this.db) {
      const localIdx = this.localEntries.indexOf(fullLocal);
      return { ok: false, rank: localIdx >= 0 ? localIdx + 1 : 1, offlineFallback: true, docId: localId };
    }

    try {
      // EXACT 6-key Firestore document schema (ZERO extra keys, no profanity filter):
      // callsign (1-16), score (1..5000000), waves (1..999), kills (0..100000), mode ('CAMPAIGN' | 'ENDLESS'), createdAt
      const docRef = await addDoc(collection(this.db, 'perimeter_scores'), {
        callsign,
        score,
        waves,
        kills,
        mode: firestoreMode,
        createdAt: serverTimestamp(),
      });

      let higherCount = 0;
      for (const item of this.onlineEntries) {
        if (item.score > score) higherCount++;
      }
      return { ok: true, rank: higherCount + 1, offlineFallback: false, docId: docRef.id };
    } catch (err) {
      console.warn('[PERIMETER UPLINK] Firestore perimeter_scores write fell back to local archive:', err);
      const localIdx = this.localEntries.indexOf(fullLocal);
      return { ok: false, rank: localIdx >= 0 ? localIdx + 1 : 1, offlineFallback: true, docId: localId };
    }
  }
}
