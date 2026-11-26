import type { Vec2 } from '../types';
import {
  PERIMETER_CONSTANTS,
  type AirlockChamberDef,
  type BlastDoorDef,
  type BreachVentDef,
  type HostileKind,
  type RoomLabelDef,
  type TileKind,
  type WaveDefinition,
  type WaveSpawnGroup,
} from './types';

export interface ColonyBlueprint {
  code: string;
  name: string;
  cols: number;
  rows: number;
  tileSize: number;
  tiles: TileKind[][];
  coreCenter: Vec2;
  coreTiles: Array<{ col: number; row: number }>;
  vents: BreachVentDef[];
  blastDoors: BlastDoorDef[];
  airlocks: AirlockChamberDef[];
  roomLabels: RoomLabelDef[];
}

function tileCenter(col: number, row: number): Vec2 {
  const ts = PERIMETER_CONSTANTS.TILE_SIZE;
  return { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
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

    // 1. Decorative Cross-Hatched Air-Handling Sub-Ducts (non-walkable CAD detail connecting vents & grates)
    carveRect(1, 5, 2, 12, 'AIR_SHAFT');
    carveRect(29, 5, 30, 12, 'AIR_SHAFT');
    carveRect(6, 5, 13, 5, 'AIR_SHAFT');
    carveRect(18, 5, 25, 5, 'AIR_SHAFT');
    carveRect(6, 12, 13, 12, 'AIR_SHAFT');
    carveRect(18, 12, 25, 12, 'AIR_SHAFT');

    // 2. Main Colony Corridors & Rooms (2-3 tiles wide for clean squad movement & crossfire)
    // North Wing Corridor (VENT-01 NW <-> North Cryo Bay <-> VENT-03 NE)
    carveRect(1, 1, 7, 3, 'CORRIDOR');
    carveRect(9, 1, 22, 3, 'CORRIDOR');
    carveRect(24, 1, 30, 3, 'CORRIDOR');

    // South Sub-Level Corridor (VENT-02 SW <-> Hydro & Coolant <-> VENT-04 SE)
    carveRect(1, 14, 30, 16, 'CORRIDOR');

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

    // 4. 3 Designated Emergency Airlock Purge Chambers
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
        flushDir: { x: 0, y: -1 },
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
        flushDir: { x: 0, y: 1 },
      },
      {
        id: 'AIRLOCK-03',
        label: 'AIRLOCK S-03',
        tiles: [
          { col: 10, row: 14 },
          { col: 11, row: 14 },
          { col: 12, row: 14 },
          { col: 10, row: 15 },
          { col: 11, row: 15 },
          { col: 12, row: 15 },
          { col: 10, row: 16 },
          { col: 11, row: 16 },
          { col: 12, row: 16 },
        ],
        bounds: { x: 10 * ts, y: 14 * ts, width: 3 * ts, height: 3 * ts },
        center: { x: 11.5 * ts, y: 15.5 * ts },
        flushDir: { x: -1, y: 0 },
      },
    ];

    for (const al of airlocks) {
      for (const t of al.tiles) {
        tiles[t.row][t.col] = 'AIRLOCK';
      }
    }

    // 5. Corridor Duct Grates (Cryo-Stasis Valve mounts + 4 Auxiliary Skitterer Floor Grates)
    const grateCoords: Array<[number, number]> = [
      [5, 2],
      [12, 2], // GRATE-01 (Aux Skitterer Grate)
      [19, 2],
      [26, 2],
      [15, 6],
      [7, 8], // GRATE-02 (Aux Skitterer Grate)
      [9, 9],
      [22, 8],
      [24, 9], // GRATE-03 (Aux Skitterer Grate)
      [16, 11],
      [6, 15],
      [15, 15],
      [20, 15], // GRATE-04 (Aux Skitterer Grate)
      [25, 15],
    ];
    for (const [gc, gr] of grateCoords) {
      tiles[gr][gc] = 'DUCT_GRATE';
    }

    // 6. Tactical Deck Mount Hardpoints (for UA 571-C, M240 Incinerator, M314 Motion Relay)
    const mountCoords: Array<[number, number]> = [
      // North Wing
      [3, 1],
      [6, 1],
      [10, 1],
      [14, 1],
      [17, 1],
      [21, 1],
      [25, 1],
      [28, 1],
      [11, 3],
      [20, 3],
      // West Approach & Spine
      [5, 8],
      [6, 7],
      [9, 7],
      [6, 10],
      [9, 10],
      // Central Med-Lab / Core Bastion Corners
      [13, 7],
      [18, 7],
      [13, 10],
      [18, 10],
      [14, 8],
      [17, 9],
      // East Approach & Spine
      [26, 8],
      [22, 7],
      [25, 7],
      [22, 10],
      [25, 10],
      // South Sub-Level Corridor
      [2, 14],
      [7, 14],
      [14, 14],
      [17, 14],
      [23, 14],
      [29, 14],
      [8, 16],
      [22, 16],
    ];
    for (const [mc, mr] of mountCoords) {
      tiles[mr][mc] = 'MOUNT_PAD';
    }

    // 7. Central Reactor Core / Med-Lab Objective (2x2)
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

    // 8. 4 Outer Breach Points (VENT-01..VENT-04) + 4 Auxiliary Floor Grates
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

    const roomLabels: RoomLabelDef[] = [
      { text: 'REACTOR CORE', subText: 'MED-LAB // 3 SEALS', x: 16 * ts, y: 7.35 * ts },
      { text: 'CRYO-STASIS JUNCTION', subText: 'SUB-SECTOR 01-N', x: 15.5 * ts, y: 2.15 * ts },
      { text: 'NW INTAKE', x: 4.2 * ts, y: 2.8 * ts },
      { text: 'NE CARGO DUCT', x: 27.2 * ts, y: 2.8 * ts },
      { text: 'WEST JUNCTION', x: 8.2 * ts, y: 8.9 * ts },
      { text: 'EAST JUNCTION', x: 23.8 * ts, y: 8.9 * ts },
      { text: 'HYDRO-PROCESSING', subText: 'SW CONDUIT', x: 5.5 * ts, y: 15.8 * ts },
      { text: 'COOLANT MANIFOLD', subText: 'SE SUB-DUCT', x: 24.5 * ts, y: 15.8 * ts },
    ];

    return {
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
    };
  }

  /**
   * Returns handcrafted Endless Hive Siege opening waves (1..10) featuring Crushers, Spitters,
   * Screamers, Mutators, and Wave 10 Xeno Queen Matriarch — plus procedurally escalated Deep Siege (11+)!
   */
  public static getWaveDefinition(waveNumber: number): WaveDefinition {
    const openingWaves: WaveDefinition[] = [
      {
        waveNumber: 1,
        title: 'PERIMETER CONTACT // NW & SW PROBE',
        scrapBonus: 60,
        mutator: 'NONE',
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
        groups: [
          { ventId: 'VENT-01', kind: 'CRUSHER', count: 1, intervalSec: 4.0, delaySec: 1.2 },
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
    const mutatorPool = [
      'GRID_BROWNOUT',
      'ACIDIC_SURGE',
      'SUBFLOOR_BREACH',
      'THERMAL_SPIKE',
    ] as const;
    const mutator =
      waveNumber % 4 === 0 ? mutatorPool[(Math.floor(waveNumber / 4) - 1) % mutatorPool.length] : 'NONE';

    const groups: WaveSpawnGroup[] = [];
    if (isQueenWave) {
      const queenCount = Math.min(3, Math.floor(waveNumber / 10));
      groups.push({
        ventId: outerVents[waveNumber % outerVents.length],
        kind: 'QUEEN',
        count: queenCount,
        intervalSec: 9.0,
        delaySec: 1.2,
      });
    } else if (isCrusherWave) {
      const crusherCount = Math.min(4, 1 + Math.floor(tier / 6));
      groups.push({
        ventId: outerVents[waveNumber % outerVents.length],
        kind: 'CRUSHER',
        count: crusherCount,
        intervalSec: 5.5,
        delaySec: 1.0,
      });
    }

    outerVents.forEach((vId, idx) => {
      const kind = kinds[(waveNumber + idx * 2) % kinds.length];
      const baseCount =
        kind === 'PRAETORIAN'
          ? 3 + Math.floor(tier * 0.65)
          : kind === 'SCREAMER' || kind === 'SPITTER'
            ? 4 + Math.floor(tier * 0.85)
            : 9 + Math.floor(tier * 1.6);
      groups.push({
        ventId: vId,
        kind,
        count: baseCount,
        intervalSec: Math.max(0.48, (kind === 'PRAETORIAN' ? 2.6 : 1.05) - tier * 0.028),
        delaySec: 1.4 + idx * 1.4,
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
        intervalSec: Math.max(0.22, 0.3 - tier * 0.005),
        delaySec: 5.5 + g * 2.8,
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
      scrapBonus: 155 + tier * 14 + (isQueenWave ? 120 : isCrusherWave ? 65 : 0),
      mutator,
      hasBoss: isQueenWave ? 'QUEEN' : isCrusherWave ? 'CRUSHER' : undefined,
      groups,
    };
  }
}
