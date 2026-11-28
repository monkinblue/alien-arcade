import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import type { CartridgeProgramId } from '../shell/Cartridge';
import { maskCallsignForDisplay } from './callsignGuard';
import { getSharedFirestore } from './leaderboard';

export interface HubProgramLeader {
  callsign: string;
  score: number;
}

export interface HubProgramLeaderState {
  status: 'LOADING' | 'LIVE' | 'OFFLINE';
  leader: HubProgramLeader | null;
  topScores: HubProgramLeader[];
  latencyMs: number | null;
}

const COLLECTION_BY_PROGRAM: Record<CartridgeProgramId, string> = {
  lander: 'scores',
  perimeter: 'perimeter_scores',
  flak: 'flak_scores',
  trench: 'trench_scores',
  approach: 'approach_scores',
};

/**
 * Real-time Firestore global leader watcher for the MU-TH-UR 6000 OS Hub.
 * Reuses the shared Firestore db and maintains 5 lightweight `limit(5)` onSnapshot
 * subscriptions across `scores`, `perimeter_scores`, `flak_scores`, `trench_scores`,
 * and `approach_scores` to power both `#01` program badges and the CLI unified `SCORES` board.
 */
export class HubLeadersService {
  private unsubscribers: Unsubscribe[] = [];
  private state: Record<CartridgeProgramId, HubProgramLeaderState> = {
    lander: { status: 'LOADING', leader: null, topScores: [], latencyMs: null },
    perimeter: { status: 'LOADING', leader: null, topScores: [], latencyMs: null },
    flak: { status: 'LOADING', leader: null, topScores: [], latencyMs: null },
    trench: { status: 'LOADING', leader: null, topScores: [], latencyMs: null },
    approach: { status: 'LOADING', leader: null, topScores: [], latencyMs: null },
  };

  constructor() {
    this.initSubscriptions();
  }

  private initSubscriptions(): void {
    const db = getSharedFirestore();
    if (!db) {
      (Object.keys(COLLECTION_BY_PROGRAM) as CartridgeProgramId[]).forEach((pid) => {
        this.state[pid] = { status: 'OFFLINE', leader: null, topScores: [], latencyMs: null };
      });
      return;
    }

    const startTime = performance.now();
    (Object.keys(COLLECTION_BY_PROGRAM) as CartridgeProgramId[]).forEach((programId) => {
      const colName = COLLECTION_BY_PROGRAM[programId];
      try {
        const q = query(collection(db, colName), orderBy('score', 'desc'), limit(5));
        const unsub = onSnapshot(
          q,
          (snapshot) => {
            const elapsed = Math.max(8, Math.round(performance.now() - startTime));
            const existingPing = this.state[programId].latencyMs;
            const latencyMs = existingPing ?? Math.min(999, elapsed);
            const parsed: HubProgramLeader[] = [];
            snapshot.forEach((docSnap) => {
              const raw = docSnap.data() as { callsign?: unknown; score?: unknown };
              if (
                typeof raw.callsign === 'string' &&
                typeof raw.score === 'number' &&
                Number.isFinite(raw.score)
              ) {
                const callsign = maskCallsignForDisplay(raw.callsign, 'PILOT');
                const score = Math.max(1, Math.round(raw.score));
                parsed.push({ callsign, score });
              }
            });
            this.state[programId] = {
              status: 'LIVE',
              leader: parsed[0] ?? null,
              topScores: parsed,
              latencyMs,
            };
          },
          (err) => {
            console.warn(`[MU-TH-UR HUB] Top-score stream unavailable for ${colName}:`, err);
            this.state[programId] = {
              status: 'OFFLINE',
              leader: null,
              topScores: [],
              latencyMs: null,
            };
          }
        );
        this.unsubscribers.push(unsub);
      } catch (err) {
        console.warn(`[MU-TH-UR HUB] Failed to subscribe to ${colName}:`, err);
        this.state[programId] = {
          status: 'OFFLINE',
          leader: null,
          topScores: [],
          latencyMs: null,
        };
      }
    });
  }

  public getLeaderState(programId: CartridgeProgramId): HubProgramLeaderState {
    return this.state[programId];
  }

  public getTopScores(programId: CartridgeProgramId): readonly HubProgramLeader[] {
    return this.state[programId].topScores;
  }

  public getUplinkSummary(): { liveCount: number; totalCount: number; avgPingMs: number | null } {
    const ids = Object.keys(COLLECTION_BY_PROGRAM) as CartridgeProgramId[];
    let liveCount = 0;
    let pingSum = 0;
    let pingCount = 0;
    for (const id of ids) {
      const st = this.state[id];
      if (st.status === 'LIVE') {
        liveCount++;
        if (st.latencyMs !== null) {
          pingSum += st.latencyMs;
          pingCount++;
        }
      }
    }
    return {
      liveCount,
      totalCount: ids.length,
      avgPingMs: pingCount > 0 ? Math.round(pingSum / pingCount) : null,
    };
  }

  public formatBadgeText(programId: CartridgeProgramId): string {
    const s = this.state[programId];
    if (s.status === 'LOADING') {
      return '[AWAITING UPLINK...]';
    }
    if (!s.leader) {
      return '[UNCLAIMED]';
    }
    return `[TOP: ${s.leader.callsign} // ${s.leader.score.toLocaleString()} PTS]`;
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore
      }
    }
    this.unsubscribers = [];
  }
}
