import type { Vec2 } from '../types';
import {
  PERIMETER_CONSTANTS,
  type AirlockChamberDef,
  type BlastDoorDef,
  type BreachVentDef,
  type ColonyBlueprint,
  type DynamicBreachDef,
  type HostileKind,
  type RoomLabelDef,
  type SectorBlueprint,
  type TileKind,
  type WaveDefinition,
  type WaveMutatorId,
  type WaveSpawnGroup,
} from './types';

export type { ColonyBlueprint, SectorBlueprint };

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
 * Smoothed progressive wave HP multiplier:
 * - Waves 1..10: fair linear ramp (1.0x -> 1.9x)
 * - Waves 11..18: smoothed ramp (1.9 * 1.115^(w-10)) preventing the old W15 brick wall
 * - Waves 19+: accelerating Deep Endless escalation (1.9 * 1.115^8 * 1.155^(w-18))
 */
export function getWaveHpScale(waveNumber: number): number {
  if (waveNumber <= 10) {
    return 1 + Math.max(0, waveNumber - 1) * 0.1;
  }
  if (waveNumber <= 18) {
    return 1.9 * Math.pow(1.115, waveNumber - 10);
  }
  return 1.9 * Math.pow(1.115, 8) * Math.pow(1.155, waveNumber - 18);
}

export class Sector01Blueprint {
  public static createSector01(): ColonyBlueprint {
    const cols = PERIMETER_CONSTANTS.GRID_COLS; // 32
    const rows = PERIMETER_CONSTANTS.GRID_ROWS; // 18
    const ts = PERIMETER_CONSTANTS.TILE_SIZE; // 60

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

    // 1. Decorative & Breachable Cross-Hatched Air-Handling Sub-Ducts (non-walkable until breached)
    carveRect(1, 5, 2, 12, 'AIR_SHAFT');
    carveRect(29, 5, 30, 12, 'AIR_SHAFT');
    carveRect(6, 5, 13, 5, 'AIR_SHAFT');
    carveRect(18, 5, 25, 5, 'AIR_SHAFT');
    carveRect(6, 12, 13, 12, 'AIR_SHAFT');
    carveRect(18, 12, 25, 12, 'AIR_SHAFT');
    // Pre-marked fracture shaft connectors for W5 / W15 / W25 Dynamic Hull Breaches
    tiles[6][10] = 'AIR_SHAFT';
    tiles[11][23] = 'AIR_SHAFT';
    tiles[6][21] = 'AIR_SHAFT';

    // 2. Main Colony Corridors & Rooms (2-3 tiles wide with staggered bulkhead chicanes capping sightlines <= ~540px)
    // North Wing Corridor (VENT-01 NW <-> North Cryo Bay <-> VENT-03 NE)
    carveRect(1, 1, 7, 3, 'CORRIDOR');
    carveRect(9, 1, 22, 3, 'CORRIDOR');
    carveRect(24, 1, 30, 3, 'CORRIDOR');
    // Staggered 2-wide bulkhead chicanes in North Wing to break 1770px infinite Rail sightlines
    carveRect(9, 4, 12, 4, 'CORRIDOR');
    carveRect(10, 1, 11, 2, 'BULKHEAD');
    carveRect(13, 3, 14, 3, 'BULKHEAD');
    carveRect(18, 4, 22, 4, 'CORRIDOR');
    carveRect(19, 1, 20, 2, 'BULKHEAD');
    tiles[3][6] = 'BULKHEAD';
    tiles[3][25] = 'BULKHEAD';

    // South Sub-Level Corridor (VENT-02 SW <-> Hydro & Coolant <-> VENT-04 SE)
    carveRect(1, 14, 30, 16, 'CORRIDOR');
    // Staggered 2-wide bulkhead chicanes in South Corridor capping horizontal lanes <= 540px
    carveRect(9, 13, 12, 13, 'CORRIDOR');
    carveRect(10, 15, 11, 16, 'BULKHEAD');
    carveRect(20, 13, 23, 13, 'CORRIDOR');
    carveRect(21, 15, 22, 16, 'BULKHEAD');
    tiles[14][8] = 'BULKHEAD';
    tiles[14][18] = 'BULKHEAD';
    tiles[14][24] = 'BULKHEAD';

    // West Vertical Spine (connects NW <-> West Core Approach <-> SW)
    carveRect(3, 4, 4, 13, 'CORRIDOR');

    // East Vertical Spine (connects NE <-> East Core Approach <-> SE)
    carveRect(27, 4, 28, 13, 'CORRIDOR');

    // North-Central Med-Lab Spine (connects North Cryo Bay -> Core)
    carveRect(15, 4, 16, 6, 'CORRIDOR');

    // South-Central Sub-Duct Spine (connects South Sub-Level -> Core)
    carveRect(15, 11, 16, 13, 'CORRIDOR');

    // West & East Core Approaches
    carveRect(5, 8, 12, 9, 'CORRIDOR');
    carveRect(19, 8, 26, 9, 'CORRIDOR');
    // Flanking alcoves along West & East Core Approaches for turret sightlines
    carveRect(6, 7, 10, 7, 'CORRIDOR');
    carveRect(6, 10, 10, 10, 'CORRIDOR');
    carveRect(21, 7, 25, 7, 'CORRIDOR');
    carveRect(21, 10, 25, 10, 'CORRIDOR');

    // Central Med-Lab & Reactor Core Chamber (cols 13..18, rows 7..10)
    carveRect(13, 7, 18, 10, 'CORRIDOR');

    // 3. 6 Weldable Corridor Blast Doors (D-01 .. D-06) — each spans full doorway width!
    const blastDoors: BlastDoorDef[] = [
      {
        id: 'D-01',
        label: 'D-01 NW LOCK',
        tiles: [
          { col: 8, row: 2 },
          { col: 8, row: 3 },
        ],
        center: { x: 8 * ts + ts * 0.5, y: 3 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-02',
        label: 'D-02 NE LOCK',
        tiles: [
          { col: 23, row: 2 },
          { col: 23, row: 3 },
        ],
        center: { x: 23 * ts + ts * 0.5, y: 3 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-03',
        label: 'D-03 N-MED',
        tiles: [
          { col: 15, row: 5 },
          { col: 16, row: 5 },
        ],
        center: { x: 16 * ts, y: 5 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
      {
        id: 'D-04',
        label: 'D-04 W-CORE',
        tiles: [
          { col: 11, row: 8 },
          { col: 11, row: 9 },
        ],
        center: { x: 11 * ts + ts * 0.5, y: 9 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-05',
        label: 'D-05 E-CORE',
        tiles: [
          { col: 20, row: 8 },
          { col: 20, row: 9 },
        ],
        center: { x: 20 * ts + ts * 0.5, y: 9 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-06',
        label: 'D-06 S-DUCT',
        tiles: [
          { col: 15, row: 12 },
          { col: 16, row: 12 },
        ],
        center: { x: 16 * ts, y: 12 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
    ];

    for (const door of blastDoors) {
      for (const t of door.tiles) {
        tiles[t.row][t.col] = 'BLAST_DOOR';
      }
    }

    // 4. 3 Designated Emergency Airlock Purge Chambers (all on active traffic spines, flushing strictly AWAY from Core!)
    const airlocks: AirlockChamberDef[] = [
      {
        id: 'AIRLOCK-01',
        label: 'AIRLOCK W-01',
        tiles: [
          { col: 3, row: 6 },
          { col: 4, row: 6 },
          { col: 3, row: 7 },
          { col: 4, row: 7 },
          { col: 3, row: 8 },
          { col: 4, row: 8 },
          { col: 3, row: 9 },
          { col: 4, row: 9 },
        ],
        bounds: { x: 3 * ts, y: 6 * ts, width: 2 * ts, height: 4 * ts },
        center: { x: 4 * ts, y: 8 * ts },
        flushDir: { x: -1, y: 0 }, // Strictly WEST away from Core!
      },
      {
        id: 'AIRLOCK-02',
        label: 'AIRLOCK E-02',
        tiles: [
          { col: 27, row: 6 },
          { col: 28, row: 6 },
          { col: 27, row: 7 },
          { col: 28, row: 7 },
          { col: 27, row: 8 },
          { col: 28, row: 8 },
          { col: 27, row: 9 },
          { col: 28, row: 9 },
        ],
        bounds: { x: 27 * ts, y: 6 * ts, width: 2 * ts, height: 4 * ts },
        center: { x: 28 * ts, y: 8 * ts },
        flushDir: { x: 1, y: 0 }, // Strictly EAST away from Core!
      },
      {
        id: 'AIRLOCK-03',
        label: 'AIRLOCK S-03',
        tiles: [
          { col: 15, row: 13 },
          { col: 16, row: 13 },
          { col: 15, row: 14 },
          { col: 16, row: 14 },
          { col: 15, row: 15 },
          { col: 16, row: 15 },
        ],
        bounds: { x: 15 * ts, y: 13 * ts, width: 2 * ts, height: 3 * ts },
        center: { x: 16 * ts, y: 14.5 * ts },
        flushDir: { x: 0, y: 1 }, // Strictly SOUTH away from Core on South-Central spine!
      },
    ];

    for (const al of airlocks) {
      for (const t of al.tiles) {
        tiles[t.row][t.col] = 'AIRLOCK';
      }
    }

    // 5. Buildable Corridor Duct Grates (Cryo-Stasis / Arc-Shock mounts — pushed outward off Core!)
    const grateCoords: Array<[number, number]> = [
      [5, 2],
      [19, 3],
      [26, 2],
      [15, 4], // Pushed outward from (15,6) onto North Spine approach
      [9, 9], // West Junction Cryo grate (used in Tutorial Drill Step 5)
      [22, 8],
      [6, 15],
      [14, 15], // Flanking South-Central spine outside AIRLOCK-03
      [17, 16], // Pushed outward from (16,11) to South-Central flank
      [25, 15],
    ];
    for (const [gc, gr] of grateCoords) {
      tiles[gr][gc] = 'DUCT_GRATE';
    }

    // 5B. Non-Buildable Auxiliary Skitterer Floor Grates (`SPAWN_GRATE`: cannot build turrets on top!)
    const spawnGrateCoords: Array<[number, number]> = [
      [12, 2], // GRATE-01
      [7, 8], // GRATE-02
      [24, 9], // GRATE-03
      [20, 15], // GRATE-04
    ];
    for (const [sgc, sgr] of spawnGrateCoords) {
      tiles[sgr][sgc] = 'SPAWN_GRATE';
    }

    // 6. Tactical Deck Mount Hardpoints
    // Removed Core god-pads (14,8) & (17,9) and dead outer pads (6,1), (21,1), (25,1);
    // relocated to forward choke sightlines: (12,8), (19,9), (4,4), (4,13), (27,13)!
    const mountCoords: Array<[number, number]> = [
      // North Wing
      [3, 1],
      [9, 4],
      [14, 1],
      [17, 1],
      [28, 1],
      [11, 3],
      [20, 3],
      // West Approach & Spine (forward chokes + Tutorial West Killbox pads intact!)
      [4, 4],
      [4, 13],
      [5, 8],
      [6, 7],
      [9, 7],
      [6, 10],
      [9, 10],
      [12, 8], // West Core approach just east of D-04 (replaces removed god-pad (14,8))
      // Central Med-Lab / Core Chamber Corners (Core is now opaque — each guards only its quadrant!)
      [13, 7],
      [18, 7],
      [13, 10],
      [18, 10],
      // East Approach & Spine
      [19, 9], // East Core approach just west of D-05 (replaces removed god-pad (17,9))
      [26, 8],
      [22, 7],
      [25, 7],
      [22, 10],
      [25, 10],
      [27, 13],
      // South Sub-Level Corridor
      [2, 14],
      [7, 14],
      [14, 14],
      [17, 14],
      [23, 14],
      [29, 14],
      [8, 16],
      [23, 16],
    ];
    for (const [mc, mr] of mountCoords) {
      tiles[mr][mc] = 'MOUNT_PAD';
    }

    // 7. Central Reactor Core / Med-Lab Objective (2x2 — OPAQUE to LOS!)
    const coreTiles = [
      { col: 15, row: 8 },
      { col: 16, row: 8 },
      { col: 15, row: 9 },
      { col: 16, row: 9 },
    ];
    for (const ct of coreTiles) {
      tiles[ct.row][ct.col] = 'CORE';
    }
    const coreCenter: Vec2 = { x: 16 * ts, y: 9 * ts };

    // 8. 4 Outer Breach Points (VENT-01..VENT-04) + 4 Non-Buildable Auxiliary Spawn Grates
    const vents: BreachVentDef[] = [
      {
        id: 'VENT-01',
        label: 'VENT-01 [NW SHAFT]',
        col: 1,
        row: 2,
        pos: tileCenter(1, 2),
      },
      {
        id: 'VENT-02',
        label: 'VENT-02 [SW HYDRO]',
        col: 1,
        row: 15,
        pos: tileCenter(1, 15),
      },
      {
        id: 'VENT-03',
        label: 'VENT-03 [NE INTAKE]',
        col: 30,
        row: 2,
        pos: tileCenter(30, 2),
      },
      {
        id: 'VENT-04',
        label: 'VENT-04 [SE COOLANT]',
        col: 30,
        row: 15,
        pos: tileCenter(30, 15),
      },
      {
        id: 'GRATE-01',
        label: 'AUX GRATE N-1',
        col: 12,
        row: 2,
        pos: tileCenter(12, 2),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-02',
        label: 'AUX GRATE W-2',
        col: 7,
        row: 8,
        pos: tileCenter(7, 8),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-03',
        label: 'AUX GRATE E-3',
        col: 24,
        row: 9,
        pos: tileCenter(24, 9),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-04',
        label: 'AUX GRATE S-4',
        col: 20,
        row: 15,
        pos: tileCenter(20, 15),
        isAuxGrate: true,
      },
    ];

    // 9. Dynamic Hull Breaches (telegraphed in Prep on W5 / W15 / W25, collapsing AIR_SHAFT bypass corridors!)
    const br1Tiles = [
      { col: 10, row: 5 },
      { col: 10, row: 6 },
    ];
    const br2Tiles = [
      { col: 23, row: 11 },
      { col: 23, row: 12 },
    ];
    const br3Tiles = [
      { col: 21, row: 5 },
      { col: 21, row: 6 },
    ];
    const dynamicBreaches: DynamicBreachDef[] = [
      {
        id: 'SEC01-BREACH-01',
        triggerWaves: [5, 35, 65],
        triggerWaveMod10: 5,
        label: 'NW AIR-SHAFT COLLAPSE',
        tiles: br1Tiles,
        previewLines: makeFractureLines(br1Tiles, ts),
      },
      {
        id: 'SEC01-BREACH-02',
        triggerWaves: [15, 45, 75],
        triggerWaveMod10: 15,
        label: 'SE MANIFOLD RUPTURE',
        tiles: br2Tiles,
        previewLines: makeFractureLines(br2Tiles, ts),
      },
      {
        id: 'SEC01-BREACH-03',
        triggerWaves: [25, 55, 85],
        triggerWaveMod10: 25,
        label: 'NE COOLANT SHAFT BREACH',
        tiles: br3Tiles,
        previewLines: makeFractureLines(br3Tiles, ts),
      },
    ];

    const roomLabels: RoomLabelDef[] = [
      { text: 'REACTOR CORE', subText: 'MED-LAB // 3 SEALS', x: 16 * ts, y: 7.35 * ts },
      { text: 'CRYO-STASIS JUNCTION', subText: 'SUB-SECTOR 01-N', x: 15.5 * ts, y: 2.15 * ts },
      { text: 'NW INTAKE', x: 4.2 * ts, y: 2.8 * ts },
      { text: 'NE CARGO DUCT', x: 27.2 * ts, y: 2.8 * ts },
      { text: 'WEST JUNCTION', x: 8.2 * ts, y: 8.9 * ts },
      { text: 'EAST JUNCTION', x: 23.8 * ts, y: 8.9 * ts },
      { text: 'HYDRO-PROCESSING', subText: 'SW CONDUIT', x: 5.5 * ts, y: 15.8 * ts },
      { text: 'COOLANT MANIFOLD', subText: 'SE SUB-DUCT', x: 25.5 * ts, y: 15.8 * ts },
    ];

    return {
      sectorId: 'SEC-01',
      sectorName: 'HADLEY MED-LAB & SUB-LEVEL DUCTS',
      code: 'SEC-01',
      name: 'HADLEY MED-LAB & SUB-LEVEL DUCTS',
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

  /**
   * Returns handcrafted Endless Hive Siege opening waves (1..10) featuring Crushers, Spitters,
   * Screamers, Mutators, and Wave 10 Xeno Queen Matriarch — plus procedurally escalated Deep Siege (11+)
   * with fixed spawn parity, monotonic mutator cadence, smoothed W11-18 HP scaling, and trimmed W15 Crushers!
   */
  public static getWaveDefinition(waveNumber: number): WaveDefinition {
    const hpScale = getWaveHpScale(waveNumber);

    const openingWaves: WaveDefinition[] = [
      {
        waveNumber: 1,
        title: 'PERIMETER CONTACT // NW & SW PROBE',
        scrapBonus: 60,
        mutator: 'NONE',
        hpScale: getWaveHpScale(1),
        groups: [
          { ventId: 'VENT-01', kind: 'DRONE', count: 4, intervalSec: 1.8, delaySec: 0.6 },
          { ventId: 'VENT-02', kind: 'SKITTERER', count: 8, intervalSec: 0.65, delaySec: 3.4 },
          { ventId: 'VENT-01', kind: 'DRONE', count: 3, intervalSec: 1.65, delaySec: 8.8 },
        ],
      },
      {
        waveNumber: 2,
        title: 'FLOOR GRATE SWARM // SKITTERER & RECON STALKERS',
        scrapBonus: 70,
        mutator: 'NONE',
        hpScale: getWaveHpScale(2),
        groups: [
          { ventId: 'VENT-01', kind: 'DRONE', count: 4, intervalSec: 1.45, delaySec: 0.5 },
          { ventId: 'GRATE-01', kind: 'SKITTERER', count: 14, intervalSec: 0.44, delaySec: 5.5 },
          { ventId: 'VENT-03', kind: 'DRONE', count: 4, intervalSec: 1.45, delaySec: 4.0 },
          { ventId: 'VENT-03', kind: 'STALKER', count: 2, intervalSec: 2.6, delaySec: 9.2 },
        ],
      },
      {
        waveNumber: 3,
        title: 'CORROSIVE BREACH // ACID BURSTERS',
        scrapBonus: 85,
        mutator: 'NONE',
        hpScale: getWaveHpScale(3),
        groups: [
          { ventId: 'VENT-02', kind: 'BURSTER', count: 5, intervalSec: 2.0, delaySec: 0.6 },
          { ventId: 'VENT-04', kind: 'DRONE', count: 8, intervalSec: 1.2, delaySec: 1.6 },
          { ventId: 'GRATE-02', kind: 'SKITTERER', count: 14, intervalSec: 0.42, delaySec: 6.2 },
        ],
      },
      {
        waveNumber: 4,
        title: 'GRID BROWNOUT // SIGNAL STALKER INFILTRATION',
        scrapBonus: 95,
        mutator: 'GRID_BROWNOUT',
        hpScale: getWaveHpScale(4),
        groups: [
          { ventId: 'VENT-03', kind: 'STALKER', count: 6, intervalSec: 1.8, delaySec: 0.8 },
          { ventId: 'VENT-01', kind: 'DRONE', count: 8, intervalSec: 1.15, delaySec: 1.8 },
          { ventId: 'VENT-04', kind: 'BURSTER', count: 4, intervalSec: 2.0, delaySec: 4.5 },
        ],
      },
      {
        waveNumber: 5,
        title: 'MINI-BOSS // JUGGERNAUT CRUSHER VANGUARD',
        scrapBonus: 120,
        mutator: 'NONE',
        hasBoss: 'CRUSHER',
        hpScale: getWaveHpScale(5),
        groups: [
          {
            ventId: 'VENT-01',
            kind: 'CRUSHER',
            count: 1,
            intervalSec: 4.0,
            delaySec: 1.2,
            hpOverride: 960, // Softened W5 Crusher so casual builds aren't brick-walled at W5
          },
          { ventId: 'VENT-01', kind: 'DRONE', count: 8, intervalSec: 1.05, delaySec: 2.4 },
          { ventId: 'VENT-04', kind: 'PRAETORIAN', count: 1, intervalSec: 4.0, delaySec: 5.2 },
          { ventId: 'GRATE-03', kind: 'SKITTERER', count: 14, intervalSec: 0.38, delaySec: 6.5 },
        ],
      },
      {
        waveNumber: 6,
        title: 'ACID ARTILLERY // SPITTER PINCER ASSAULT',
        scrapBonus: 125,
        mutator: 'NONE',
        hpScale: getWaveHpScale(6),
        groups: [
          { ventId: 'VENT-01', kind: 'SPITTER', count: 4, intervalSec: 2.4, delaySec: 0.8 },
          { ventId: 'VENT-02', kind: 'BURSTER', count: 5, intervalSec: 1.75, delaySec: 1.4 },
          { ventId: 'VENT-03', kind: 'STALKER', count: 5, intervalSec: 1.55, delaySec: 2.4 },
          { ventId: 'VENT-04', kind: 'PRAETORIAN', count: 2, intervalSec: 3.8, delaySec: 4.2 },
          { ventId: 'GRATE-04', kind: 'SKITTERER', count: 14, intervalSec: 0.36, delaySec: 6.8 },
        ],
      },
      {
        waveNumber: 7,
        title: 'RADAR INTERFERENCE // BIO-SCREAMER SWARM',
        scrapBonus: 135,
        mutator: 'NONE',
        hpScale: getWaveHpScale(7),
        groups: [
          { ventId: 'VENT-03', kind: 'SCREAMER', count: 3, intervalSec: 3.2, delaySec: 1.0 },
          { ventId: 'GRATE-01', kind: 'SKITTERER', count: 16, intervalSec: 0.34, delaySec: 5.5 },
          { ventId: 'GRATE-02', kind: 'SKITTERER', count: 16, intervalSec: 0.34, delaySec: 8.5 },
          { ventId: 'VENT-02', kind: 'STALKER', count: 6, intervalSec: 1.35, delaySec: 1.6 },
          { ventId: 'VENT-04', kind: 'SPITTER', count: 4, intervalSec: 2.1, delaySec: 5.2 },
        ],
      },
      {
        waveNumber: 8,
        title: 'ACIDIC SURGE // ARMORED PHALANX',
        scrapBonus: 155,
        mutator: 'ACIDIC_SURGE',
        hpScale: getWaveHpScale(8),
        groups: [
          { ventId: 'VENT-01', kind: 'PRAETORIAN', count: 3, intervalSec: 3.2, delaySec: 0.6 },
          { ventId: 'VENT-03', kind: 'PRAETORIAN', count: 2, intervalSec: 3.2, delaySec: 2.0 },
          { ventId: 'VENT-02', kind: 'BURSTER', count: 7, intervalSec: 1.4, delaySec: 3.0 },
          { ventId: 'VENT-04', kind: 'SPITTER', count: 5, intervalSec: 1.9, delaySec: 4.2 },
        ],
      },
      {
        waveNumber: 9,
        title: 'BLACKOUT PACKS // SCREAMER & STALKER SURGE',
        scrapBonus: 165,
        mutator: 'NONE',
        hpScale: getWaveHpScale(9),
        groups: [
          { ventId: 'VENT-01', kind: 'STALKER', count: 8, intervalSec: 1.2, delaySec: 0.4 },
          { ventId: 'VENT-04', kind: 'SCREAMER', count: 4, intervalSec: 2.5, delaySec: 1.4 },
          { ventId: 'GRATE-03', kind: 'SKITTERER', count: 20, intervalSec: 0.3, delaySec: 6.0 },
          { ventId: 'VENT-02', kind: 'PRAETORIAN', count: 3, intervalSec: 3.0, delaySec: 4.5 },
          { ventId: 'VENT-03', kind: 'BURSTER', count: 8, intervalSec: 1.3, delaySec: 5.5 },
        ],
      },
      {
        waveNumber: 10,
        title: 'BOSS // XENO MATRIARCH QUEEN BREACH',
        scrapBonus: 260,
        mutator: 'NONE',
        hasBoss: 'QUEEN',
        hpScale: getWaveHpScale(10),
        groups: [
          { ventId: 'VENT-01', kind: 'QUEEN', count: 1, intervalSec: 6.0, delaySec: 1.2 },
          { ventId: 'VENT-01', kind: 'PRAETORIAN', count: 2, intervalSec: 3.6, delaySec: 3.4 },
          { ventId: 'VENT-02', kind: 'SPITTER', count: 4, intervalSec: 2.1, delaySec: 2.2 },
          { ventId: 'VENT-03', kind: 'STALKER', count: 8, intervalSec: 1.15, delaySec: 1.6 },
          { ventId: 'VENT-04', kind: 'BURSTER', count: 8, intervalSec: 1.25, delaySec: 2.8 },
          { ventId: 'GRATE-01', kind: 'SKITTERER', count: 16, intervalSec: 0.3, delaySec: 6.2 },
          { ventId: 'GRATE-04', kind: 'SKITTERER', count: 16, intervalSec: 0.3, delaySec: 9.0 },
        ],
      },
    ];

    if (waveNumber <= openingWaves.length) {
      return openingWaves[waveNumber - 1];
    }

    // Procedural Endless Hive Siege Escalation (Waves 11+)
    const tier = waveNumber - 10;
    const outerVents = ['VENT-01', 'VENT-02', 'VENT-03', 'VENT-04'];
    const grates = ['GRATE-01', 'GRATE-02', 'GRATE-03', 'GRATE-04'];
    const kinds: HostileKind[] = [
      'DRONE',
      'BURSTER',
      'STALKER',
      'PRAETORIAN',
      'SPITTER',
      'SCREAMER',
    ];

    const isQueenWave = waveNumber % 10 === 0;
    const isCrusherWave = !isQueenWave && waveNumber % 5 === 0;
    const mutatorPool: readonly Exclude<WaveMutatorId, 'NONE'>[] = [
      'GRID_BROWNOUT',
      'ACIDIC_SURGE',
      'SUBFLOOR_BREACH',
      'THERMAL_SPIKE',
    ];

    // Monotonic mutator schedule starting from W4 (0:W4 BROWNOUT, 1:W8 ACIDIC, 2:W12 SUBFLOOR, 3:W15 THERMAL,
    // 4:W18 BROWNOUT, 5:W20 ACIDIC, 6:W22 SUBFLOOR, 7:W24 THERMAL...) — zero back-to-back repeats, all 4 by W15!
    let mutator: WaveMutatorId = 'NONE';
    if (waveNumber < 20) {
      if (waveNumber >= 12 && waveNumber % 3 === 0) {
        const mutatorCount = 2 + Math.floor((waveNumber - 12) / 3);
        mutator = mutatorPool[mutatorCount % mutatorPool.length];
      }
    } else if (waveNumber % 2 === 0) {
      const mutatorCount = 5 + Math.floor((waveNumber - 20) / 2);
      mutator = mutatorPool[mutatorCount % mutatorPool.length];
    }

    const groups: WaveSpawnGroup[] = [];
    // Split multi-boss spawns across OPPOSITE perimeter vents so 1 hallway can't stack-pierce all bosses!
    const oppositeVents = ['VENT-01', 'VENT-04', 'VENT-02', 'VENT-03'];
    if (isQueenWave) {
      const queenCount = Math.min(4, Math.floor(waveNumber / 10));
      for (let q = 0; q < queenCount; q++) {
        groups.push({
          ventId: oppositeVents[(waveNumber + q) % oppositeVents.length],
          kind: 'QUEEN',
          count: 1,
          intervalSec: 8.0,
          delaySec: 1.2 + q * 4.5,
        });
      }
      // Queen waves past W10 also bring armored Crusher escorts from flanking vents
      groups.push({
        ventId: oppositeVents[(waveNumber + 2) % oppositeVents.length],
        kind: 'CRUSHER',
        count: Math.min(3, Math.floor(waveNumber / 10)),
        intervalSec: 5.5,
        delaySec: 4.0,
      });
    } else if (isCrusherWave) {
      // Smooth Crusher Stampede scaling: W15 = 2 Crushers (trimmed from 3!), W25 = 3, W35 = 4, W45+ = 5
      const crusherCount = Math.min(5, 2 + Math.floor(Math.max(0, waveNumber - 15) / 10));
      for (let c = 0; c < crusherCount; c++) {
        groups.push({
          ventId: oppositeVents[(waveNumber + c) % oppositeVents.length],
          kind: 'CRUSHER',
          count: 1,
          intervalSec: 5.0,
          delaySec: 1.0 + c * 3.0,
        });
      }
    } else if (waveNumber >= 13 && (waveNumber >= 18 || waveNumber % 2 === 1)) {
      // Deep Endless vanguard Crushers keep pressure high even on non-milestone waves!
      const vanguardCrushers = waveNumber >= 22 ? 2 : 1;
      for (let c = 0; c < vanguardCrushers; c++) {
        groups.push({
          ventId: oppositeVents[(waveNumber + c) % oppositeVents.length],
          kind: 'CRUSHER',
          count: 1,
          intervalSec: 6.0,
          delaySec: 2.2 + c * 4.2,
        });
      }
    }

    // Fixed W11+ spawn parity: `(waveNumber * 2 + idx) % 6` mixes armored, corrosive, stealth & ranged castes on EVERY wave!
    outerVents.forEach((vId, idx) => {
      const kind = kinds[(waveNumber * 2 + idx) % kinds.length];
      const baseCount =
        kind === 'PRAETORIAN'
          ? 3 + Math.floor(tier * 0.72)
          : kind === 'SCREAMER' || kind === 'SPITTER'
            ? 4 + Math.floor(tier * 0.9)
            : 9 + Math.floor(tier * 1.65);
      groups.push({
        ventId: vId,
        kind,
        count: baseCount,
        intervalSec: Math.max(0.42, (kind === 'PRAETORIAN' ? 2.5 : 1.02) - tier * 0.032),
        delaySec: 1.4 + idx * 1.3,
      });
    });

    // Sub-floor grate Skitterer eruptions (all 4 grates during SUBFLOOR_BREACH!)
    const activeGrateCount = mutator === 'SUBFLOOR_BREACH' ? 4 : 2;
    for (let g = 0; g < activeGrateCount; g++) {
      const grateId = grates[(waveNumber + g) % grates.length];
      groups.push({
        ventId: grateId,
        kind: 'SKITTERER',
        count: (mutator === 'SUBFLOOR_BREACH' ? 16 : 18) + tier * 2,
        intervalSec: Math.max(0.2, 0.3 - tier * 0.006),
        delaySec: 5.5 + g * 2.6,
      });
    }

    const title = isQueenWave
      ? `BOSS // MATRIARCH QUEEN SIEGE — WAVE ${String(waveNumber).padStart(2, '0')}`
      : isCrusherWave
        ? `MINI-BOSS // CRUSHER STAMPEDE — WAVE ${String(waveNumber).padStart(2, '0')}`
        : mutator !== 'NONE'
          ? `${mutator.replace('_', ' ')} // WAVE ${String(waveNumber).padStart(2, '0')}`
          : `DEEP HIVE SIEGE // WAVE ${String(waveNumber).padStart(2, '0')} OVERRUN`;

    return {
      waveNumber,
      title,
      scrapBonus: 145 + Math.min(115, tier * 8) + (isQueenWave ? 90 : isCrusherWave ? 50 : 0),
      mutator,
      hasBoss: isQueenWave ? 'QUEEN' : isCrusherWave ? 'CRUSHER' : undefined,
      hpScale,
      groups,
    };
  }
}
