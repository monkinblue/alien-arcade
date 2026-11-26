import type { Vec2 } from '../types';
import type { ColonyBlueprint } from './Sector01Blueprint';
import type { BlastDoorState, TileKind } from './types';

export class FlowFieldPathfinder {
  private cols: number;
  private rows: number;
  private tileSize: number;

  // Cost fields from Core (lower = closer to Reactor Core)
  private standardDist: Float32Array;
  private crusherDist: Float32Array;

  // Map from grid index (r * cols + c) to BlastDoor ID if that cell is part of a Blast Door
  private doorIdAtCell: Array<string | null>;

  constructor(blueprint: ColonyBlueprint) {
    this.cols = blueprint.cols;
    this.rows = blueprint.rows;
    this.tileSize = blueprint.tileSize;
    const total = this.cols * this.rows;
    this.standardDist = new Float32Array(total);
    this.crusherDist = new Float32Array(total);
    this.doorIdAtCell = new Array<string | null>(total).fill(null);

    for (const door of blueprint.blastDoors) {
      for (const t of door.tiles) {
        this.doorIdAtCell[t.row * this.cols + t.col] = door.id;
      }
    }
  }

  public static isWalkableKind(kind: TileKind): boolean {
    return kind !== 'BULKHEAD' && kind !== 'AIR_SHAFT';
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

  public getFlowDistance(col: number, row: number): number {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 1e9;
    return this.standardDist[row * this.cols + col];
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
   * Rebuilds both the Standard Flanking Flow-Field and the Heavy Crusher Flow-Field
   * whenever Blast Doors are welded, damaged significantly, unsealed, or breached.
   */
  public recompute(blueprint: ColonyBlueprint, doors: Map<string, BlastDoorState>): void {
    this.computeField(blueprint, doors, 22.0, this.standardDist);
    this.computeField(blueprint, doors, 8.0, this.crusherDist);
  }

  private computeField(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    weldedDoorPenalty: number,
    outDist: Float32Array
  ): void {
    const total = this.cols * this.rows;
    outDist.fill(1e9);

    // Simple binary-heap / bucket queue (576 cells -> tiny array scan/queue is instantaneous)
    const visited = new Uint8Array(total);
    for (const ct of blueprint.coreTiles) {
      const idx = ct.row * this.cols + ct.col;
      outDist[idx] = 0;
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

    for (let step = 0; step < total; step++) {
      let bestIdx = -1;
      let bestVal = 1e9;
      for (let i = 0; i < total; i++) {
        if (!visited[i] && outDist[i] < bestVal) {
          bestVal = outDist[i];
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      visited[bestIdx] = 1;

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
        if (visited[nIdx]) continue;

        let cellCost = stepLen;
        const dId = this.doorIdAtCell[nIdx];
        if (dId) {
          const ds = doors.get(dId);
          if (ds && ds.welded && ds.hp > 0) {
            const hpRatio = Math.max(0.2, ds.hp / Math.max(1, ds.maxHp));
            cellCost += weldedDoorPenalty * (0.35 + 0.65 * hpRatio);
          }
        }

        const cand = bestVal + cellCost;
        if (cand < outDist[nIdx]) {
          outDist[nIdx] = cand;
        }
      }
    }
  }

  /**
   * Samples the optimal corridor flow vector for an entity at virtual position (x, y),
   * and detects if the entity's next step is blocked by a welded Blast Door to batter!
   */
  public sampleDirection(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    pos: Vec2,
    isHeavyCrusher: boolean
  ): { dir: Vec2; batteringDoor: BlastDoorState | null } {
    const field = isHeavyCrusher ? this.crusherDist : this.standardDist;
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(pos.x / this.tileSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(pos.y / this.tileSize)));

    // Check if an adjacent cardinal cell with strictly lower cost is a welded Blast Door within battering reach
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

    // Check if bestNeighborCell (or an immediately adjacent cell we're pressed against) is a welded Blast Door!
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
   * Traces an active corridor path polyline from a breach vent to the Core for subtle tactical CAD visualization.
   */
  public traceRoutePreview(
    blueprint: ColonyBlueprint,
    doors: Map<string, BlastDoorState>,
    startCol: number,
    startRow: number
  ): Vec2[] {
    const pts: Vec2[] = [];
    let cc = startCol;
    let cr = startRow;
    const visited = new Set<number>();

    for (let step = 0; step < 64; step++) {
      pts.push({
        x: cc * this.tileSize + this.tileSize * 0.5,
        y: cr * this.tileSize + this.tileSize * 0.5,
      });
      if (blueprint.tiles[cr]?.[cc] === 'CORE') break;
      const curIdx = cr * this.cols + cc;
      visited.add(curIdx);

      let nextC = cc;
      let nextR = cr;
      let best = this.standardDist[curIdx];

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
        if (this.standardDist[nIdx] < best) {
          best = this.standardDist[nIdx];
          nextC = nc;
          nextR = nr;
        }
      }

      if (nextC === cc && nextR === cr) break;
      // Stop trace at a welded door so player visually sees the path terminate/reroute!
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
