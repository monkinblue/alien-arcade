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
import {
  APPROACH_SUBMIT_COOLDOWN_MS,
  checkSubmissionGate,
  maskCallsignForDisplay,
  recordSubmissionTimestamp,
  sanitizeCallsignDraft,
  SCORE_CAPS,
  validateCallsignForSubmit,
} from '../../services/callsignGuard';
import { getSharedFirestore, type UplinkConnectionStatus } from '../../services/leaderboard';
import type { ApproachScoreEntry, ShiftPhaseId } from './types';

const APPROACH_LOCAL_STORAGE_KEY = 'muthur_approach_scores_v1';
const SHARED_CALLSIGN_KEY = 'nostromo_lander_last_callsign_v1';
const DEFAULT_CALLSIGN = 'RAPCON-01';

const VALID_SHIFT_PHASES: ReadonlySet<ShiftPhaseId> = new Set([
  'ALPHA',
  'BRAVO',
  'CHARLIE',
  'DELTA',
  'ECHO',
]);

interface FirestoreApproachDoc {
  callsign?: unknown;
  score?: unknown;
  landed?: unknown;
  maxMult?: unknown;
  phase?: unknown;
  createdAt?: Timestamp | null;
}

const ARCHIVE_SEED_SCORES: ApproachScoreEntry[] = [
  {
    id: 'approach-archive-1',
    callsign: 'BOREALIS-1',
    score: 84600,
    landed: 64,
    maxMult: 5.0,
    phase: 'ECHO',
    date: '2179-08-04',
    isArchiveFallback: true,
  },
  {
    id: 'approach-archive-2',
    callsign: 'FERRO-07',
    score: 56250,
    landed: 46,
    maxMult: 4.5,
    phase: 'DELTA',
    date: '2179-08-03',
    isArchiveFallback: true,
  },
  {
    id: 'approach-archive-3',
    callsign: 'BISHOP-ATC',
    score: 38900,
    landed: 33,
    maxMult: 3.75,
    phase: 'CHARLIE',
    date: '2179-08-02',
    isArchiveFallback: true,
  },
  {
    id: 'approach-archive-4',
    callsign: 'RIPLEY-118',
    score: 21450,
    landed: 19,
    maxMult: 3.0,
    phase: 'BRAVO',
    date: '2179-08-01',
    isArchiveFallback: true,
  },
  {
    id: 'approach-archive-5',
    callsign: 'SPUNKMEYER',
    score: 9800,
    landed: 9,
    maxMult: 2.25,
    phase: 'ALPHA',
    date: '2179-07-31',
    isArchiveFallback: true,
  },
];

function sanitizeShiftPhase(raw: unknown): ShiftPhaseId {
  if (typeof raw === 'string' && VALID_SHIFT_PHASES.has(raw as ShiftPhaseId)) {
    return raw as ShiftPhaseId;
  }
  return 'ALPHA';
}

function clampMaxMult(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1.0;
  const clamped = Math.max(1, Math.min(SCORE_CAPS.approach.maxMult, raw));
  return Math.round(clamped * 100) / 100;
}

export class ApproachLeaderboardService {
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private status: UplinkConnectionStatus = 'LOADING';
  private onlineEntries: ApproachScoreEntry[] = [];
  private localEntries: ApproachScoreEntry[] = [];

  constructor() {
    this.loadLocalArchive();
    this.initRealtimeSubscription();
  }

  private loadLocalArchive(): void {
    try {
      const raw = window.localStorage.getItem(APPROACH_LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = (parsed as ApproachScoreEntry[])
            .filter((e) => Boolean(e && typeof e.callsign === 'string' && typeof e.score === 'number'))
            .slice(0, 25);
          if (valid.length > 0) {
            this.localEntries = valid.sort((a, b) => b.score - a.score);
            return;
          }
        }
      }
    } catch {
      // Fallback to seeded LV-118 archive
    }
    this.localEntries = ARCHIVE_SEED_SCORES.map((e) => ({ ...e }));
  }

  private saveLocalArchive(): void {
    try {
      window.localStorage.setItem(
        APPROACH_LOCAL_STORAGE_KEY,
        JSON.stringify(this.localEntries.slice(0, 25))
      );
    } catch {
      // Ignore storage quota / private browsing errors
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
        collection(this.db, 'approach_scores'),
        orderBy('score', 'desc'),
        limit(25)
      );

      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list: ApproachScoreEntry[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data() as FirestoreApproachDoc;
            if (typeof raw.callsign !== 'string' || typeof raw.score !== 'number') {
              return;
            }
            if (!Number.isFinite(raw.score)) return;

            const score = Math.max(1, Math.min(SCORE_CAPS.approach.score, Math.round(raw.score)));
            const landed =
              typeof raw.landed === 'number' && Number.isFinite(raw.landed)
                ? Math.max(0, Math.min(SCORE_CAPS.approach.landed, Math.round(raw.landed)))
                : 0;
            const maxMult = clampMaxMult(raw.maxMult);
            const phase = sanitizeShiftPhase(raw.phase);

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
              callsign: maskCallsignForDisplay(raw.callsign, DEFAULT_CALLSIGN),
              score,
              landed,
              maxMult,
              phase,
              date: dateStr,
              isArchiveFallback: false,
            });
          });

          list.sort((a, b) => b.score - a.score);
          this.onlineEntries = list.slice(0, 25);
          this.status = 'LIVE';
        },
        (err) => {
          console.warn(
            '[BOREALIS APPROACH UPLINK] Firestore approach_scores unavailable, using local archive:',
            err
          );
          this.status = 'OFFLINE';
        }
      );
    } catch (err) {
      console.warn('[BOREALIS APPROACH UPLINK] Firestore subscription init error:', err);
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
      const clean = saved ? sanitizeCallsignDraft(saved) : '';
      if (clean.length > 0) {
        return clean;
      }
    } catch {
      // Ignore storage access errors
    }
    return DEFAULT_CALLSIGN;
  }

  public saveCallsign(raw: string): string {
    const cleaned = sanitizeCallsignDraft(raw) || DEFAULT_CALLSIGN;
    try {
      window.localStorage.setItem(SHARED_CALLSIGN_KEY, cleaned);
    } catch {
      // Ignore storage quota errors
    }
    return cleaned;
  }

  public getReigningLeader(): ApproachScoreEntry | null {
    if (this.onlineEntries.length > 0) {
      return this.onlineEntries[0];
    }
    return this.localEntries.length > 0 ? this.localEntries[0] : null;
  }

  public getEntries(): {
    entries: readonly ApproachScoreEntry[];
    showingArchiveFallback: boolean;
  } {
    if (this.onlineEntries.length > 0) {
      return { entries: this.onlineEntries, showingArchiveFallback: false };
    }
    return { entries: this.localEntries, showingArchiveFallback: true };
  }

  /**
   * Submits finalized shift score to Firestore `approach_scores` with EXACTLY the 6 required keys:
   * `{ callsign, score, landed, maxMult, phase, createdAt }`
   * after strict callsign regex/profanity validation, >=5s playtime check, and 30s cooldown verification.
   */
  public async submitScore(params: {
    callsign: string;
    score: number;
    landed: number;
    maxMult: number;
    phase: ShiftPhaseId;
    playtimeSec?: number;
  }): Promise<{
    ok: boolean;
    rank: number;
    offlineFallback: boolean;
    docId?: string;
    submittedScore?: number;
    rejectedReason?: string;
  }> {
    const validation = validateCallsignForSubmit(params.callsign);
    if (!validation.ok) {
      return {
        ok: false,
        rank: 1,
        offlineFallback: false,
        rejectedReason: validation.error,
      };
    }

    const gate = checkSubmissionGate(
      'approach',
      params.playtimeSec ?? 999,
      APPROACH_SUBMIT_COOLDOWN_MS
    );
    if (!gate.allowed) {
      return {
        ok: false,
        rank: 1,
        offlineFallback: false,
        rejectedReason: gate.reason,
      };
    }

    const callsign = this.saveCallsign(validation.callsign);
    const rawScore = Number.isFinite(params.score) ? Math.round(params.score) : 1;
    const rawLanded = Number.isFinite(params.landed) ? Math.round(params.landed) : 0;
    const score = Math.max(1, Math.min(SCORE_CAPS.approach.score, rawScore));
    const landed = Math.max(0, Math.min(SCORE_CAPS.approach.landed, rawLanded));
    const maxMult = clampMaxMult(params.maxMult);
    const phase = sanitizeShiftPhase(params.phase);

    // Mirror into localStorage fallback archive
    const localId = `local-${Date.now()}`;
    const localEntry: ApproachScoreEntry = {
      id: localId,
      callsign,
      score,
      landed,
      maxMult,
      phase,
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
      recordSubmissionTimestamp('approach');
      const idx = this.localEntries.findIndex((e) => e.id === localId);
      return {
        ok: false,
        rank: Math.max(1, idx + 1),
        offlineFallback: true,
        docId: localId,
        submittedScore: score,
      };
    }

    try {
      // EXACT 6-key Firestore schema mirrored 1:1 in `firestore.rules`:
      // callsign (^[A-Z0-9_-]{1,12}$), score (int 1..10000000), landed (int 0..999),
      // maxMult (number 1..5), phase ('ALPHA'|'BRAVO'|'CHARLIE'|'DELTA'|'ECHO'), createdAt
      const docRef = await addDoc(collection(this.db, 'approach_scores'), {
        callsign,
        score,
        landed,
        maxMult,
        phase,
        createdAt: serverTimestamp(),
      });
      recordSubmissionTimestamp('approach');

      const merged = [
        ...this.onlineEntries.filter((e) => e.id !== docRef.id),
        { ...localEntry, id: docRef.id, isArchiveFallback: false },
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, 25);
      this.onlineEntries = merged;
      this.status = 'LIVE';

      const rankIdx = merged.findIndex((e) => e.id === docRef.id);
      return {
        ok: true,
        rank: rankIdx >= 0 ? rankIdx + 1 : merged.length + 1,
        offlineFallback: false,
        docId: docRef.id,
        submittedScore: score,
      };
    } catch (err) {
      console.warn(
        '[BOREALIS APPROACH UPLINK] Firestore approach_scores write fell back to local archive:',
        err
      );
      const idx = this.localEntries.findIndex((e) => e.id === localId);
      return {
        ok: false,
        rank: Math.max(1, idx + 1),
        offlineFallback: true,
        docId: localId,
        submittedScore: score,
      };
    }
  }
}
