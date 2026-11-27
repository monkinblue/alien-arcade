import type { Vec2 } from '../types';
import type { BlastDoorState, ColonyBlueprint, HostileKind, TileKind } from './types';

export type FlowPathTier = 'standard' | 'sapper' | 'heavy';

export const FLOW_DOOR_PENALTY: Record<FlowPathTier, number> = {
  standard: 10.5, // SKITTERER, DRONE, STALKER, SCREAMER
  sapper: 5.5, // SPITTER, BURSTER (actively target sealed doors)
  heavy: 4.0, // PRAETORIAN, CRUSHER, QUEEN (smash through choked blast doors)
};

export class FlowFieldPathfinder {
  private cols: number;
  private rows: number;
  private tileSize: number;

  // 3-Tier Cost fields from Core (lower = closer to Reactor Core)
  private standardDist: Float32Array;
  private sapperDist: Float32Array;
  private heavyDist: Float32Array;

  // Reusable binary min-heap buffers to keep 3-tier + congestion recomputes sub-millisecond
  private heapIdx: Int32Array;
  private heapVal: Float32Array;
  private visited: Uint8Array;

  // Map from grid index (r * cols + c) to BlastDoor ID if that cell is part of a Blast Door
  private doorIdAtCell: Array<string | null>;

  constructor(blueprint: ColonyBlueprint) {
    this.cols = blueprint.cols;
    this.rows = blueprint.rows;
    this.tileSize = blueprint.tileSize;
    const total = this.cols * this.rows;
    this.standardDist = new Float32Array(total);
    this.sapperDist = new Float32Array(total);
    this.heavyDist = new Float32Array(total);
    this.heapIdx = new Int32Array(total * 4);
    this.heapVal = new Float32Array(total * 4);
    this.visited = new Uint8Array(total);
    this.doorIdAtCell = new Array<string | null>(total).fill(null);

    for (const door of blueprint.blastDoors) {
      for (const t of door.tiles) {
        if (t.row >= 0 && t.row < this.rows && t.col >= 0 && t.col < this.cols) {
          this.doorIdAtCell[t.row * this.cols + t.col] = door.id;
        }
      }
    }
  }

  public static isWalkableKind(kind: TileKind): boolean {
    return kind !== 'BULKHEAD' && kind !== 'AIR_SHAFT';
  }

  public static tierForHostile(kind: HostileKind): FlowPathTier {
    if (kind === 'PRAETORIAN' || kind === 'CRUSHER' || kind === 'QUEEN') {
      return 'heavy';
    }
    if (kind === 'SPITTER' || kind === 'BURSTER') {
      return 'sapper';
    }
    return 'standard';
  }

  public isPassableCell(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    col: number,
    row: number
  ): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const kind = blueprint.tiles[row][col];
    if (!FlowFieldPathfinder.isWalkableKind(kind)) return false;
    const dId = this.doorIdAtCell[row * this.cols + col];
    if (dId) {
      const ds = doors.get(dId);
      if (ds && ds.welded && ds.hp > 0) return false;
    }
    return true;
  }

  public getFlowDistance(col: number, row: number, tier: FlowPathTier = 'standard'): number {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 1e9;
    const field =
      tier === 'heavy'
        ? this.heavyDist
        : tier === 'sapper'
          ? this.sapperDist
          : this.standardDist;
    return field[row * this.cols + col];
  }

  public getWeldedDoorAtCell(
    doors: Map<string, BlastDoorState>,
    col: number,
    row: number
  ): BlastDoorState | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    const dId = this.doorIdAtCell[row * this.cols + col];
    if (!dId) return null;
    const ds = doors.get(dId);
    if (ds && ds.welded && ds.hp > 0) return ds;
    return null;
  }

  /**
   * Rebuilds all 3 Caste Flow-Fields (Standard 10.5, Sapper 5.5, Heavy 4.0) whenever Blast Doors
   * change state, cross HP bands, dynamic breaches open, or active-wave congestion updates.
   */
  public recompute(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    congestionCost?: Float32Array
  ): void {
    this.computeField(blueprint, doors, FLOW_DOOR_PENALTY.standard, this.standardDist, congestionCost);
    this.computeField(blueprint, doors, FLOW_DOOR_PENALTY.sapper, this.sapperDist, congestionCost);
    this.computeField(blueprint, doors, FLOW_DOOR_PENALTY.heavy, this.heavyDist, congestionCost);
  }

  private computeField(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    weldedDoorPenalty: number,
    outDist: Float32Array,
    congestionCost?: Float32Array
  ): void {
    const total = this.cols * this.rows;
    outDist.fill(1e9);
    this.visited.fill(0);

    const heapIdx = this.heapIdx;
    const heapVal = this.heapVal;
    let heapSize = 0;

    const pushHeap = (idx: number, val: number) => {
      if (heapSize >= heapIdx.length) return;
      let i = heapSize++;
      heapIdx[i] = idx;
      heapVal[i] = val;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapVal[p] <= heapVal[i]) break;
        const ti = heapIdx[p];
        const tv = heapVal[p];
        heapIdx[p] = heapIdx[i];
        heapVal[p] = heapVal[i];
        heapIdx[i] = ti;
        heapVal[i] = tv;
        i = p;
      }
    };

    const popHeap = (): number => {
      const top = heapIdx[0];
      heapSize--;
      if (heapSize > 0) {
        heapIdx[0] = heapIdx[heapSize];
        heapVal[0] = heapVal[heapSize];
        let i = 0;
        while (true) {
          const l = (i << 1) + 1;
          const r = l + 1;
          let smallest = i;
          if (l < heapSize && heapVal[l] < heapVal[smallest]) smallest = l;
          if (r < heapSize && heapVal[r] < heapVal[smallest]) smallest = r;
          if (smallest === i) break;
          const ti = heapIdx[i];
          const tv = heapVal[i];
          heapIdx[i] = heapIdx[smallest];
          heapVal[i] = heapVal[smallest];
          heapIdx[smallest] = ti;
          heapVal[smallest] = tv;
          i = smallest;
        }
      }
      return top;
    };

    for (const ct of blueprint.coreTiles) {
      if (ct.row >= 0 && ct.row < this.rows && ct.col >= 0 && ct.col < this.cols) {
        const idx = ct.row * this.cols + ct.col;
        outDist[idx] = 0;
        pushHeap(idx, 0);
      }
    }

    const dirs: Array<[number, number, number]> = [
      [1, 0, 1.0],
      [-1, 0, 1.0],
      [0, 1, 1.0],
      [0, -1, 1.0],
      [1, 1, 1.414],
      [-1, 1, 1.414],
      [1, -1, 1.414],
      [-1, -1, 1.414],
    ];

    const hasCongestion = Boolean(congestionCost && congestionCost.length >= total);

    while (heapSize > 0) {
      const bestIdx = popHeap();
      if (this.visited[bestIdx]) continue;
      this.visited[bestIdx] = 1;
      const bestVal = outDist[bestIdx];

      const cr = Math.floor(bestIdx / this.cols);
      const cc = bestIdx % this.cols;

      for (const [dc, dr, stepLen] of dirs) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;

        const nKind = blueprint.tiles[nr][nc];
        if (!FlowFieldPathfinder.isWalkableKind(nKind)) continue;

        // Prevent cutting diagonally across bulkhead corners or sealed doors!
        if (dc !== 0 && dr !== 0) {
          if (
            !this.isPassableCell(blueprint, doors, cc + dc, cr) ||
            !this.isPassableCell(blueprint, doors, cc, cr + dr)
          ) {
            continue;
          }
        }

        const nIdx = nr * this.cols + nc;
        if (this.visited[nIdx]) continue;

        let cellCost = stepLen;
        const dId = this.doorIdAtCell[nIdx];
        if (dId) {
          const ds = doors.get(dId);
          if (ds && ds.welded && ds.hp > 0) {
            const hpRatio = Math.max(0.2, ds.hp / Math.max(1, ds.maxHp));
            cellCost += weldedDoorPenalty * (0.35 + 0.65 * hpRatio);
          }
        }
        if (hasCongestion && congestionCost![nIdx] > 0) {
          cellCost += congestionCost![nIdx];
        }

        const cand = bestVal + cellCost;
        if (cand < outDist[nIdx]) {
          outDist[nIdx] = cand;
          pushHeap(nIdx, cand);
        }
      }
    }
  }

  /**
   * Samples the optimal corridor flow vector for an entity at virtual position (x, y),
   * and detects if the entity's next step is blocked by a welded Blast Door to batter!
   *
   * Supports both parameter orders:
   * - `(blueprint, doors, pos, tierOrHeavy)` (legacy + tier)
   * - `(pos, tier, doors, blueprint)` (compact tier-first overload)
   */
  public sampleDirection(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    pos: Vec2,
    tierOrHeavy: FlowPathTier | boolean
  ): { dir: Vec2; batteringDoor: BlastDoorState | null };
  public sampleDirection(
    pos: Vec2,
    tier: FlowPathTier,
    doors: Map<string, BlastDoorState>,
    blueprint: ColonyBlueprint
  ): { dir: Vec2; batteringDoor: BlastDoorState | null };
  public sampleDirection(
    arg0: ColonyBlueprint | Vec2,
    arg1: Map<string, BlastDoorState> | FlowPathTier,
    arg2: Vec2 | Map<string, BlastDoorState>,
    arg3: FlowPathTier | boolean | ColonyBlueprint
  ): { dir: Vec2; batteringDoor: BlastDoorState | null } {
    let blueprint: ColonyBlueprint;
    let doors: Map<string, BlastDoorState>;
    let pos: Vec2;
    let tier: FlowPathTier;

    if ('tiles' in arg0) {
      blueprint = arg0;
      doors = arg1 as Map<string, BlastDoorState>;
      pos = arg2 as Vec2;
      const tArg = arg3 as FlowPathTier | boolean;
      tier = typeof tArg === 'boolean' ? (tArg ? 'heavy' : 'standard') : tArg;
    } else {
      pos = arg0;
      tier = arg1 as FlowPathTier;
      doors = arg2 as Map<string, BlastDoorState>;
      blueprint = arg3 as ColonyBlueprint;
    }

    const field =
      tier === 'heavy'
        ? this.heavyDist
        : tier === 'sapper'
          ? this.sapperDist
          : this.standardDist;

    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(pos.x / this.tileSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(pos.y / this.tileSize)));

    // Check if an adjacent cell with strictly lower cost is a welded Blast Door within battering reach
    let bestNeighborCol = col;
    let bestNeighborRow = row;
    let bestVal = field[row * this.cols + col];

    const neighbors: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];

    for (const [dc, dr] of neighbors) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
      if (!FlowFieldPathfinder.isWalkableKind(blueprint.tiles[nr][nc])) continue;

      if (dc !== 0 && dr !== 0) {
        if (
          !this.isPassableCell(blueprint, doors, col + dc, row) ||
          !this.isPassableCell(blueprint, doors, col, row + dr)
        ) {
          continue;
        }
      }

      const v = field[nr * this.cols + nc];
      if (v < bestVal) {
        bestVal = v;
        bestNeighborCol = nc;
        bestNeighborRow = nr;
      }
    }

    // Check if bestNeighborCell is a welded Blast Door within battering reach
    const targetDoor = this.getWeldedDoorAtCell(doors, bestNeighborCol, bestNeighborRow);
    if (targetDoor) {
      const doorCx = bestNeighborCol * this.tileSize + this.tileSize * 0.5;
      const doorCy = bestNeighborRow * this.tileSize + this.tileSize * 0.5;
      const dx = doorCx - pos.x;
      const dy = doorCy - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < this.tileSize * 0.88) {
        return {
          dir: dist > 1e-3 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 },
          batteringDoor: targetDoor,
        };
      }
    }

    const targetX = bestNeighborCol * this.tileSize + this.tileSize * 0.5;
    const targetY = bestNeighborRow * this.tileSize + this.tileSize * 0.5;
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      const coreDx = blueprint.coreCenter.x - pos.x;
      const coreDy = blueprint.coreCenter.y - pos.y;
      const cLen = Math.max(1, Math.hypot(coreDx, coreDy));
      return { dir: { x: coreDx / cLen, y: coreDy / cLen }, batteringDoor: null };
    }
    return { dir: { x: dx / len, y: dy / len }, batteringDoor: null };
  }

  /**
   * Traces an active corridor path polyline from a breach vent to the Core for tactical CAD visualization.
   */
  public traceRoutePreview(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    startCol: number,
    startRow: number,
    tier: FlowPathTier = 'standard'
  ): Vec2[] {
    const field =
      tier === 'heavy'
        ? this.heavyDist
        : tier === 'sapper'
          ? this.sapperDist
          : this.standardDist;

    const pts: Vec2[] = [];
    let cc = startCol;
    let cr = startRow;
    const visited = new Set<number>();

    for (let step = 0; step < 96; step++) {
      pts.push({
        x: cc * this.tileSize + this.tileSize * 0.5,
        y: cr * this.tileSize + this.tileSize * 0.5,
      });
      if (blueprint.tiles[cr]?.[cc] === 'CORE') break;
      const curIdx = cr * this.cols + cc;
      visited.add(curIdx);

      let nextC = cc;
      let nextR = cr;
      let best = field[curIdx];

      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
        if (!FlowFieldPathfinder.isWalkableKind(blueprint.tiles[nr][nc])) continue;
        if (dc !== 0 && dr !== 0) {
          if (
            !this.isPassableCell(blueprint, doors, cc + dc, cr) ||
            !this.isPassableCell(blueprint, doors, cc, cr + dr)
          ) {
            continue;
          }
        }
        const nIdx = nr * this.cols + nc;
        if (visited.has(nIdx)) continue;
        if (field[nIdx] < best) {
          best = field[nIdx];
          nextC = nc;
          nextR = nr;
        }
      }

      if (nextC === cc && nextR === cr) break;
      // Stop trace at a welded door so player visually sees the path terminate/target the sealed bulkhead
      if (this.getWeldedDoorAtCell(doors, nextC, nextR)) {
        pts.push({
          x: nextC * this.tileSize + this.tileSize * 0.5,
          y: nextR * this.tileSize + this.tileSize * 0.5,
        });
        break;
      }
      cc = nextC;
      cr = nextR;
    }
    return pts;
  }
}
