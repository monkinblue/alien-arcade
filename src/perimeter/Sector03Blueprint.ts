import type { Vec2 } from '../types';
import {
  PERIMETER_CONSTANTS,
  type AirlockChamberDef,
  type BlastDoorDef,
  type BreachVentDef,
  type ColonyBlueprint,
  type DynamicBreachDef,
  type RoomLabelDef,
  type TileKind,
} from './types';

function tileCenter(col: number, row: number): Vec2 {
  const ts = PERIMETER_CONSTANTS.TILE_SIZE;
  return { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
}

function makeFractureLines(tiles: Array<{ col: number; row: number }>, ts: number) {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const t of tiles) {
    const x = t.col * ts;
    const y = t.row * ts;
    lines.push(
      { x1: x + 8, y1: y + 8, x2: x + ts - 8, y2: y + ts - 8 },
      { x1: x + ts - 8, y1: y + 8, x2: x + 8, y2: y + ts - 8 }
    );
  }
  return lines;
}

/**
 * SEC-03: HIVE SUB-LEVEL (36x20 = 2160x1200)
 *
 * Asymmetric 3-lane deep-colony nest around an OFF-CENTER West-South opaque Core (cols 10..11, rows 12..13):
 * - Lane A (North-West Bio-Descent): Tight elevated intake + AIRLOCK-01 directly on North Core Spine & D-04 West Shortcut
 * - Lane B (Central Hive Warren): Multi-bend close-quarters labyrinth with staggered resin pillars (Incinerator/Cryo/Shock)
 * - Lane C (South Bio-Artery): Long stepped Rail-Lance trench with AIRLOCK-03 & D-06 guarding the South Core flank!
 */
export class Sector03Blueprint {
  public static createSector03(): ColonyBlueprint {
    const cols = 36;
    const rows = 20;
    const ts = PERIMETER_CONSTANTS.TILE_SIZE; // 60 -> 2160x1200

    const tiles: TileKind[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => 'BULKHEAD' as TileKind)
    );

    const carveRect = (c1: number, r1: number, c2: number, r2: number, kind: TileKind) => {
      for (let r = Math.max(0, r1); r <= Math.min(rows - 1, r2); r++) {
        for (let c = Math.max(0, c1); c <= Math.min(cols - 1, c2); c++) {
          tiles[r][c] = kind;
        }
      }
    };

    // 1. Sub-Hive Ventilation Shafts (CAD detail + pre-marked dynamic breach zones)
    carveRect(4, 6, 8, 10, 'AIR_SHAFT');
    carveRect(13, 8, 15, 10, 'AIR_SHAFT');
    carveRect(26, 6, 30, 12, 'AIR_SHAFT');
    carveRect(13, 15, 17, 15, 'AIR_SHAFT');

    // 2. LANE A — North-West Bio-Descent & West Outer Spine
    carveRect(1, 1, 13, 3, 'CORRIDOR'); // NW Resin Chute
    // Chicane in NW Chute (2-wide)
    carveRect(6, 3, 8, 4, 'CORRIDOR');
    tiles[1][7] = 'BULKHEAD';
    // North Core Spine (AIRLOCK-01 + D-03 -> Core North!)
    carveRect(10, 4, 11, 10, 'CORRIDOR');
    // West Outer Spine: split at rows 7..8 so D-03 & D-04 each guard distinct fronts with long detours!
    carveRect(1, 4, 2, 6, 'CORRIDOR');
    carveRect(1, 9, 2, 18, 'CORRIDOR');
    carveRect(3, 12, 7, 13, 'CORRIDOR'); // West Core Approach (D-04 guards direct shortcut from SW Spine!)
    // SW Sump Drain connecting VENT-02 <-> South Core Spine
    carveRect(1, 17, 12, 18, 'CORRIDOR');

    // 3. LANE B — Central Hive Warren (VENT-03 NE -> twisted multi-bend labyrinth -> East Core Approach)
    carveRect(19, 1, 34, 3, 'CORRIDOR'); // NE Nest Cavern
    carveRect(25, 3, 27, 4, 'CORRIDOR');
    tiles[1][26] = 'BULKHEAD'; // Breaks end-to-end horizontal sightline
    // High Upper Cross-Link from NW Chute <-> NE Nest Cavern (guarded by D-01 so D-03 & D-05 guard 14+ tile shortcuts!)
    carveRect(14, 1, 18, 2, 'CORRIDOR');
    // Connector from NE Nest Cavern into Central Warren
    carveRect(19, 4, 22, 5, 'CORRIDOR');
    // Central Warren Chamber & Baffle Pillars (short 180-300px sightlines!)
    carveRect(18, 6, 24, 12, 'CORRIDOR');
    carveRect(20, 7, 21, 8, 'BULKHEAD');
    carveRect(21, 10, 22, 10, 'BULKHEAD');
    // Upper Warren Pocket above breach zone (connects cleanly when SEC03-BREACH-01 opens!)
    carveRect(14, 6, 17, 7, 'CORRIDOR');
    // East Core Approach (AIRLOCK-02 + D-05 -> Core East!)
    carveRect(14, 12, 23, 13, 'CORRIDOR');

    // 4. LANE C — South Bio-Artery & East Outer Spine (VENT-04 SE -> stepped Rail trench -> South Core)
    // East Outer Vertical Spine linking VENT-03 <-> VENT-04 (guarded by D-02!)
    carveRect(32, 4, 34, 18, 'CORRIDOR');
    // SE Egg Chamber -> North jog -> South-Central Rail Trench
    carveRect(25, 16, 34, 18, 'CORRIDOR');
    carveRect(24, 14, 27, 16, 'CORRIDOR');
    tiles[18][25] = 'BULKHEAD';
    tiles[18][26] = 'BULKHEAD';
    // South-Central Rail Trench (cols 13..24, rows 16..18 — ~540px Rail firing corridor!)
    carveRect(13, 16, 24, 18, 'CORRIDOR');
    tiles[16][18] = 'BULKHEAD'; // Small rib breaking upper row while leaving rows 17..18 clean 2-wide!
    // South Core Spine (D-06 -> Core South!)
    carveRect(10, 15, 11, 17, 'CORRIDOR');

    // 5. Off-Center Reactor Core Chamber (West-South: cols 8..13, rows 11..14)
    carveRect(8, 11, 13, 14, 'CORRIDOR');

    // 6. 6 Weldable Corridor Blast Doors (D-01 .. D-06) guarding real 14-18 tile shortcuts!
    const blastDoors: BlastDoorDef[] = [
      {
        id: 'D-01',
        label: 'D-01 N-WARREN',
        tiles: [
          { col: 16, row: 1 },
          { col: 16, row: 2 },
        ],
        center: { x: 16 * ts + ts * 0.5, y: 2 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-02',
        label: 'D-02 E-SPINE',
        tiles: [
          { col: 32, row: 10 },
          { col: 33, row: 10 },
          { col: 34, row: 10 },
        ],
        center: { x: 33.5 * ts, y: 10 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
      {
        id: 'D-03',
        label: 'D-03 N-CORE',
        tiles: [
          { col: 10, row: 9 },
          { col: 11, row: 9 },
        ],
        center: { x: 11 * ts, y: 9 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
      {
        id: 'D-04',
        label: 'D-04 W-CORE',
        tiles: [
          { col: 6, row: 12 },
          { col: 6, row: 13 },
        ],
        center: { x: 6 * ts + ts * 0.5, y: 13 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-05',
        label: 'D-05 E-CORE',
        tiles: [
          { col: 15, row: 12 },
          { col: 15, row: 13 },
        ],
        center: { x: 15 * ts + ts * 0.5, y: 13 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-06',
        label: 'D-06 S-CORE',
        tiles: [
          { col: 10, row: 16 },
          { col: 11, row: 16 },
        ],
        center: { x: 11 * ts, y: 16 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
    ];

    for (const door of blastDoors) {
      for (const t of door.tiles) {
        tiles[t.row][t.col] = 'BLAST_DOOR';
      }
    }

    // 7. 3 Primary-Spine Emergency Airlocks (all flushing strictly outward away from Core!)
    const airlocks: AirlockChamberDef[] = [
      {
        id: 'AIRLOCK-01',
        label: 'AIRLOCK N-CHUTE',
        tiles: [
          { col: 10, row: 5 },
          { col: 11, row: 5 },
          { col: 10, row: 6 },
          { col: 11, row: 6 },
          { col: 10, row: 7 },
          { col: 11, row: 7 },
        ],
        bounds: { x: 10 * ts, y: 5 * ts, width: 2 * ts, height: 3 * ts },
        center: { x: 11 * ts, y: 6.5 * ts },
        flushDir: { x: 0, y: -1 }, // Strictly NORTH away from Core!
      },
      {
        id: 'AIRLOCK-02',
        label: 'AIRLOCK E-WARREN',
        tiles: [
          { col: 17, row: 12 },
          { col: 18, row: 12 },
          { col: 19, row: 12 },
          { col: 17, row: 13 },
          { col: 18, row: 13 },
          { col: 19, row: 13 },
        ],
        bounds: { x: 17 * ts, y: 12 * ts, width: 3 * ts, height: 2 * ts },
        center: { x: 18.5 * ts, y: 13 * ts },
        flushDir: { x: 1, y: 0 }, // Strictly EAST away from Core!
      },
      {
        id: 'AIRLOCK-03',
        label: 'AIRLOCK S-TRENCH',
        tiles: [
          { col: 14, row: 17 },
          { col: 15, row: 17 },
          { col: 16, row: 17 },
          { col: 14, row: 18 },
          { col: 15, row: 18 },
          { col: 16, row: 18 },
        ],
        bounds: { x: 14 * ts, y: 17 * ts, width: 3 * ts, height: 2 * ts },
        center: { x: 15.5 * ts, y: 18 * ts },
        flushDir: { x: 1, y: 0 }, // Strictly EAST away from Core!
      },
    ];

    for (const al of airlocks) {
      for (const t of al.tiles) {
        tiles[t.row][t.col] = 'AIRLOCK';
      }
    }

    // 8. Buildable Duct Grates (10 forward junction grates — ZERO universal Core god-grates!)
    const grateCoords: Array<[number, number]> = [
      [10, 3],
      [4, 12],
      [10, 10],
      [16, 13],
      [19, 9],
      [23, 6],
      [28, 2],
      [33, 13],
      [22, 17],
      [8, 17],
    ];
    for (const [gc, gr] of grateCoords) {
      tiles[gr][gc] = 'DUCT_GRATE';
    }

    // 8B. Non-Buildable Aux Skitterer Spawn Grates (`SPAWN_GRATE`)
    const spawnGrateCoords: Array<[number, number]> = [
      [4, 2], // GRATE-01 (NW Resin Chute)
      [23, 9], // GRATE-02 (Central Hive Warren)
      [33, 7], // GRATE-03 (East Hive Spine)
      [19, 17], // GRATE-04 (South Bio-Artery)
    ];
    for (const [sgc, sgr] of spawnGrateCoords) {
      tiles[sgr][sgc] = 'SPAWN_GRATE';
    }

    // 9. Tactical Mount Hardpoints (split across all 3 fronts; only 2 awkward Core last-stand pads!)
    const mountCoords: Array<[number, number]> = [
      // Lane A — North-West Descent & West Spine
      [3, 1],
      [9, 2],
      [12, 2],
      [11, 8],
      [2, 10],
      [3, 13],
      [5, 12],
      [7, 13],
      [4, 17],
      [9, 18],
      // Lane B — Central Hive Warren
      [14, 2],
      [19, 4],
      [15, 7],
      [18, 6],
      [18, 10],
      [22, 7],
      [23, 11],
      [21, 13],
      [16, 12],
      [21, 2],
      [31, 2],
      // Lane C — South Bio-Artery & East Spine
      [32, 6],
      [32, 15],
      [29, 16],
      [25, 14],
      [23, 16],
      [20, 18],
      [17, 16],
      [13, 17],
      [12, 15],
      // Core Last-Stand Corners (ONLY 2 awkward pads — opaque Core blocks cross-firing!)
      [8, 11],
      [13, 14],
    ];
    for (const [mc, mr] of mountCoords) {
      tiles[mr][mc] = 'MOUNT_PAD';
    }

    // 10. Off-Center Opaque Reactor Core (2x2 at West-South: cols 10..11, rows 12..13)
    const coreTiles = [
      { col: 10, row: 12 },
      { col: 11, row: 12 },
      { col: 10, row: 13 },
      { col: 11, row: 13 },
    ];
    for (const ct of coreTiles) {
      tiles[ct.row][ct.col] = 'CORE';
    }
    const coreCenter: Vec2 = { x: 11 * ts, y: 13 * ts };

    // 11. 4 Outer Breach Vents + 4 Non-Buildable Spawn Grates
    const vents: BreachVentDef[] = [
      {
        id: 'VENT-01',
        label: 'VENT-01 [NW RESIN]',
        col: 1,
        row: 2,
        pos: tileCenter(1, 2),
      },
      {
        id: 'VENT-02',
        label: 'VENT-02 [SW SUMP]',
        col: 1,
        row: 17,
        pos: tileCenter(1, 17),
      },
      {
        id: 'VENT-03',
        label: 'VENT-03 [NE NEST]',
        col: 34,
        row: 2,
        pos: tileCenter(34, 2),
      },
      {
        id: 'VENT-04',
        label: 'VENT-04 [SE EGG BAY]',
        col: 34,
        row: 17,
        pos: tileCenter(34, 17),
      },
      {
        id: 'GRATE-01',
        label: 'AUX GRATE N-1',
        col: 4,
        row: 2,
        pos: tileCenter(4, 2),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-02',
        label: 'AUX GRATE C-2',
        col: 23,
        row: 9,
        pos: tileCenter(23, 9),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-03',
        label: 'AUX GRATE E-3',
        col: 33,
        row: 7,
        pos: tileCenter(33, 7),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-04',
        label: 'AUX GRATE S-4',
        col: 19,
        row: 17,
        pos: tileCenter(19, 17),
        isAuxGrate: true,
      },
    ];

    // 12. Dynamic Hull Breaches (W25 opens Central Resin Shaft bypassing D-03 & D-05!)
    const br1Tiles = [
      { col: 14, row: 8 },
      { col: 14, row: 9 },
      { col: 14, row: 10 },
      { col: 14, row: 11 },
    ];
    const br2Tiles = [
      { col: 3, row: 10 },
      { col: 4, row: 10 },
      { col: 5, row: 10 },
      { col: 6, row: 10 },
      { col: 7, row: 10 },
      { col: 8, row: 10 },
    ];
    // Mark (3,10) as AIR_SHAFT so the full West Fissure telegraph sits cleanly on AIR_SHAFT tiles!
    tiles[10][3] = 'AIR_SHAFT';

    const dynamicBreaches: DynamicBreachDef[] = [
      {
        id: 'SEC03-BREACH-01',
        triggerWaves: [25, 55, 85],
        triggerWaveMod10: 5,
        label: 'HIVE RESIN SHAFT COLLAPSE',
        tiles: br1Tiles,
        previewLines: makeFractureLines(br1Tiles, ts),
      },
      {
        id: 'SEC03-BREACH-02',
        triggerWaves: [35, 65, 95],
        triggerWaveMod10: 25,
        label: 'WEST BULKHEAD FISSURE',
        tiles: br2Tiles,
        previewLines: makeFractureLines(br2Tiles, ts),
      },
    ];

    const roomLabels: RoomLabelDef[] = [
      { text: 'SUB-LEVEL CORE', subText: 'BIO-VAULT // 3 SEALS', x: 11 * ts, y: 11.4 * ts },
      { text: 'NW RESIN CHUTE', x: 6.2 * ts, y: 2.3 * ts },
      { text: 'CENTRAL HIVE WARREN', subText: 'CLOSE-QUARTERS NEST', x: 21.2 * ts, y: 9.2 * ts },
      { text: 'NE NEST CAVERN', x: 28.5 * ts, y: 2.3 * ts },
      { text: 'SOUTH BIO-ARTERY', subText: 'FIRING TRENCH', x: 20.0 * ts, y: 17.5 * ts },
      { text: 'SE EGG CHAMBER', x: 30.2 * ts, y: 17.6 * ts },
    ];

    return {
      sectorId: 'SEC-03',
      sectorName: 'HIVE SUB-LEVEL — BIO-CONTAINMENT',
      code: 'SEC-03',
      name: 'HIVE SUB-LEVEL — BIO-CONTAINMENT',
      cols,
      rows,
      tileSize: ts,
      tiles,
      coreCenter,
      coreTiles,
      vents,
      blastDoors,
      airlocks,
      roomLabels,
      dynamicBreaches,
    };
  }
}
