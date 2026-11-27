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
 * SEC-02: ATMOSPHERE PROCESSOR (36x20 = 2160x1200)
 *
 * Asymmetric 3-lane topology around an OFF-CENTER East-Central opaque Reactor Core (cols 23..24, rows 9..10):
 * - Lane A (North Service Artery): Rail-Lance corridor broken by a 2-tile bulkhead jog (max ~480px lane)
 * - Lane B (West-South Turbine Cryo Maze): Tight 180-240px bends favoring Incinerator + Cryo + Shock + Mines
 * - Lane C (East Cargo Bay + Heavy Shortcut): Wide cargo deck with AIRLOCK-02 on the main spine & D-05 guarding a 15+ tile shortcut!
 */
export class Sector02Blueprint {
  public static createSector02(): ColonyBlueprint {
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

    // 1. Cross-Hatched Air-Handling Shafts (CAD detail + pre-marked dynamic breach zones)
    carveRect(4, 6, 6, 11, 'AIR_SHAFT');
    carveRect(15, 6, 19, 8, 'AIR_SHAFT');
    carveRect(19, 12, 21, 15, 'AIR_SHAFT');
    carveRect(27, 4, 29, 7, 'AIR_SHAFT');
    carveRect(27, 12, 30, 14, 'AIR_SHAFT');

    // 2. LANE A — North Service Artery (VENT-01 NW -> stepped Rail-Lance artery -> North Core entry)
    carveRect(1, 1, 11, 3, 'CORRIDOR'); // NW Intake Hall (540px)
    carveRect(10, 3, 12, 5, 'CORRIDOR'); // Bulkhead jog down (breaks infinite horizontal sightline!)
    carveRect(12, 4, 24, 5, 'CORRIDOR'); // Mid-North Service Artery
    tiles[4][17] = 'BULKHEAD'; // Small baffle breaking full horizontal line along row 4? Wait: keep 2-wide!
    // Restore (17,4) and carve clean 2-wide jog at cols 19..20 -> row 3..4 instead!
    tiles[4][17] = 'CORRIDOR';
    carveRect(18, 3, 21, 4, 'CORRIDOR');
    tiles[5][19] = 'BULKHEAD';
    tiles[5][20] = 'BULKHEAD';
    // North Core Spine (connects North Service Artery -> Core Chamber via D-03)
    carveRect(23, 5, 24, 7, 'CORRIDOR');
    // Upper North Bypass linking NE Cargo Bay <-> North Service Artery (guarded by D-01!)
    carveRect(13, 1, 34, 2, 'CORRIDOR');
    carveRect(13, 2, 14, 4, 'CORRIDOR');
    // Chicane on Upper North Bypass so NE can't be sniped end-to-end
    carveRect(24, 2, 26, 3, 'CORRIDOR');
    tiles[1][25] = 'BULKHEAD';

    // 3. LANE B — West-South Cryo / Turbine Maze (VENT-02 SW -> tight bends -> West Core Turbine Approach)
    // West Outer Spine linking VENT-01 <-> VENT-02
    carveRect(1, 4, 2, 18, 'CORRIDOR');
    // SW Cryogenic Sump Room
    carveRect(1, 16, 10, 18, 'CORRIDOR');
    // Tight 2-wide S-bend Maze ascending toward Central Turbine Approach
    carveRect(8, 12, 10, 16, 'CORRIDOR');
    carveRect(10, 12, 15, 13, 'CORRIDOR');
    carveRect(13, 9, 15, 12, 'CORRIDOR');
    // Central Turbine Approach (AIRLOCK-01 + D-04 -> Core West)
    carveRect(15, 9, 20, 10, 'CORRIDOR');
    // Flanking sightline alcoves along Turbine Approach
    carveRect(15, 11, 18, 11, 'CORRIDOR');
    // South Long Manifold linking SW Sump <-> SE Slag Conduit (guarded by D-02!)
    carveRect(11, 17, 25, 18, 'CORRIDOR');
    carveRect(19, 16, 22, 17, 'CORRIDOR');
    tiles[18][20] = 'BULKHEAD';
    tiles[18][21] = 'BULKHEAD';

    // 4. LANE C — East Heavy Cargo Bay & Shortcut Approaches (VENT-03 NE & VENT-04 SE)
    // NE Exhaust Stack & Upper East Cargo Deck
    carveRect(30, 1, 34, 8, 'CORRIDOR');
    // Bulkhead cargo container chicane in East Cargo Deck (keeps 2-wide clearance around it)
    carveRect(31, 4, 32, 5, 'BULKHEAD');
    // East Core Shortcut (D-05 guards a 15+ tile shortcut straight from Cargo Deck to Core!)
    carveRect(27, 9, 34, 10, 'CORRIDOR');
    // Separate NE Cargo Deck from SE Slag Conduit with structural reactor hull so D-05 & D-06 each guard true 14-18t shortcuts!
    // (Pre-marked AIR_SHAFT at cols 32..33, rows 11..14 collapses if SEC02-BREACH-02 triggers!)
    carveRect(32, 11, 33, 14, 'AIR_SHAFT');
    // SE Slag Conduit -> South Core Spine (AIRLOCK-03 + D-06)
    carveRect(23, 15, 34, 18, 'CORRIDOR');
    carveRect(27, 16, 29, 16, 'BULKHEAD'); // Chicane divider keeping 2-wide lanes above/below (rows 15 & 17..18)
    carveRect(23, 12, 24, 15, 'CORRIDOR'); // South Core Spine

    // 5. Off-Center Reactor Core Chamber (East-Center: cols 21..26, rows 8..11)
    carveRect(21, 8, 26, 11, 'CORRIDOR');

    // 6. 6 Weldable Corridor Blast Doors (D-01 .. D-06) guarding real 14-18 tile shortcuts!
    const blastDoors: BlastDoorDef[] = [
      {
        id: 'D-01',
        label: 'D-01 N-BYPASS',
        tiles: [
          { col: 17, row: 1 },
          { col: 17, row: 2 },
        ],
        center: { x: 17 * ts + ts * 0.5, y: 2 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-02',
        label: 'D-02 S-SUMP',
        tiles: [
          { col: 15, row: 17 },
          { col: 15, row: 18 },
        ],
        center: { x: 15 * ts + ts * 0.5, y: 18 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-03',
        label: 'D-03 N-TURBINE',
        tiles: [
          { col: 23, row: 7 },
          { col: 24, row: 7 },
        ],
        center: { x: 24 * ts, y: 7 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
      {
        id: 'D-04',
        label: 'D-04 W-CORE',
        tiles: [
          { col: 20, row: 9 },
          { col: 20, row: 10 },
        ],
        center: { x: 20 * ts + ts * 0.5, y: 10 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-05',
        label: 'D-05 E-CARGO',
        tiles: [
          { col: 27, row: 9 },
          { col: 27, row: 10 },
        ],
        center: { x: 27 * ts + ts * 0.5, y: 10 * ts },
        orientation: 'VERTICAL',
      },
      {
        id: 'D-06',
        label: 'D-06 S-CORE',
        tiles: [
          { col: 23, row: 12 },
          { col: 24, row: 12 },
        ],
        center: { x: 24 * ts, y: 12 * ts + ts * 0.5 },
        orientation: 'HORIZONTAL',
      },
    ];

    for (const door of blastDoors) {
      for (const t of door.tiles) {
        tiles[t.row][t.col] = 'BLAST_DOOR';
      }
    }

    // 7. 3 Primary-Spine Emergency Airlocks (flushing strictly outward away from Core!)
    const airlocks: AirlockChamberDef[] = [
      {
        id: 'AIRLOCK-01',
        label: 'AIRLOCK W-TURB',
        tiles: [
          { col: 16, row: 9 },
          { col: 17, row: 9 },
          { col: 18, row: 9 },
          { col: 16, row: 10 },
          { col: 17, row: 10 },
          { col: 18, row: 10 },
        ],
        bounds: { x: 16 * ts, y: 9 * ts, width: 3 * ts, height: 2 * ts },
        center: { x: 17.5 * ts, y: 10 * ts },
        flushDir: { x: -1, y: 0 }, // Strictly WEST away from Core!
      },
      {
        id: 'AIRLOCK-02',
        label: 'AIRLOCK E-CARGO',
        tiles: [
          { col: 29, row: 9 },
          { col: 30, row: 9 },
          { col: 31, row: 9 },
          { col: 29, row: 10 },
          { col: 30, row: 10 },
          { col: 31, row: 10 },
        ],
        bounds: { x: 29 * ts, y: 9 * ts, width: 3 * ts, height: 2 * ts },
        center: { x: 30.5 * ts, y: 10 * ts },
        flushDir: { x: 1, y: 0 }, // Strictly EAST away from Core!
      },
      {
        id: 'AIRLOCK-03',
        label: 'AIRLOCK S-SLAG',
        tiles: [
          { col: 23, row: 13 },
          { col: 24, row: 13 },
          { col: 23, row: 14 },
          { col: 24, row: 14 },
          { col: 23, row: 15 },
          { col: 24, row: 15 },
        ],
        bounds: { x: 23 * ts, y: 13 * ts, width: 2 * ts, height: 3 * ts },
        center: { x: 24 * ts, y: 14.5 * ts },
        flushDir: { x: 0, y: 1 }, // Strictly SOUTH away from Core!
      },
    ];

    for (const al of airlocks) {
      for (const t of al.tiles) {
        tiles[t.row][t.col] = 'AIRLOCK';
      }
    }

    // 8. Buildable Duct Grates (10 forward junction grates — ZERO universal Core god-grates!)
    const grateCoords: Array<[number, number]> = [
      [7, 2],
      [16, 4],
      [23, 6],
      [33, 4],
      [9, 14],
      [14, 11],
      [19, 10],
      [28, 10],
      [25, 17],
      [11, 17],
    ];
    for (const [gc, gr] of grateCoords) {
      tiles[gr][gc] = 'DUCT_GRATE';
    }

    // 8B. Non-Buildable Aux Skitterer Spawn Grates (`SPAWN_GRATE`)
    const spawnGrateCoords: Array<[number, number]> = [
      [13, 5], // GRATE-01 (North Service Artery)
      [12, 12], // GRATE-02 (SW Turbine Maze)
      [33, 7], // GRATE-03 (NE Cargo Bay)
      [28, 17], // GRATE-04 (SE Slag Conduit)
    ];
    for (const [sgc, sgr] of spawnGrateCoords) {
      tiles[sgr][sgc] = 'SPAWN_GRATE';
    }

    // 9. Tactical Mount Hardpoints (strong forward junctions; only 2 awkward last-stand pads in Core!)
    const mountCoords: Array<[number, number]> = [
      // Lane A — North Service Artery
      [3, 1],
      [9, 1],
      [10, 4],
      [15, 4],
      [21, 3],
      [22, 5],
      [20, 1],
      [28, 1],
      // Lane B — West-South Turbine Maze
      [2, 9],
      [3, 16],
      [8, 17],
      [8, 13],
      [13, 13],
      [13, 9],
      [15, 11],
      [18, 11],
      [19, 9],
      [17, 17],
      [21, 16],
      // Lane C — East Cargo Bay & SE Slag Conduit
      [30, 2],
      [30, 7],
      [33, 2],
      [28, 9],
      [32, 9],
      [32, 15],
      [30, 15],
      [26, 15],
      [26, 18],
      [23, 18],
      // Core Last-Stand Corners (ONLY 2 awkward pads — opaque Core prevents cross-firing!)
      [21, 8],
      [26, 11],
    ];
    for (const [mc, mr] of mountCoords) {
      tiles[mr][mc] = 'MOUNT_PAD';
    }

    // 10. Off-Center Opaque Reactor Core (2x2 at cols 23..24, rows 9..10)
    const coreTiles = [
      { col: 23, row: 9 },
      { col: 24, row: 9 },
      { col: 23, row: 10 },
      { col: 24, row: 10 },
    ];
    for (const ct of coreTiles) {
      tiles[ct.row][ct.col] = 'CORE';
    }
    const coreCenter: Vec2 = { x: 24 * ts, y: 10 * ts };

    // 11. 4 Outer Breach Vents + 4 Non-Buildable Spawn Grates (same IDs for seamless wave compatibility)
    const vents: BreachVentDef[] = [
      {
        id: 'VENT-01',
        label: 'VENT-01 [NW INTAKE]',
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
        label: 'VENT-03 [NE EXHAUST]',
        col: 34,
        row: 2,
        pos: tileCenter(34, 2),
      },
      {
        id: 'VENT-04',
        label: 'VENT-04 [SE SLAG]',
        col: 34,
        row: 17,
        pos: tileCenter(34, 17),
      },
      {
        id: 'GRATE-01',
        label: 'AUX GRATE N-1',
        col: 13,
        row: 5,
        pos: tileCenter(13, 5),
        isAuxGrate: true,
      },
      {
        id: 'GRATE-02',
        label: 'AUX GRATE W-2',
        col: 12,
        row: 12,
        pos: tileCenter(12, 12),
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
        col: 28,
        row: 17,
        pos: tileCenter(28, 17),
        isAuxGrate: true,
      },
    ];

    // 12. Dynamic Hull Breaches (W15 opens NW Turbine Shaft bypass; W25/secondary opens SW Core Bypass!)
    const br1Tiles = [
      { col: 17, row: 6 },
      { col: 17, row: 7 },
      { col: 17, row: 8 },
    ];
    const br2Tiles = [
      { col: 20, row: 12 },
      { col: 20, row: 13 },
      { col: 20, row: 14 },
      { col: 20, row: 15 },
    ];
    const dynamicBreaches: DynamicBreachDef[] = [
      {
        id: 'SEC02-BREACH-01',
        triggerWaves: [15, 45, 75],
        triggerWaveMod10: 5,
        label: 'TURBINE AIR-SHAFT COLLAPSE',
        tiles: br1Tiles,
        previewLines: makeFractureLines(br1Tiles, ts),
      },
      {
        id: 'SEC02-BREACH-02',
        triggerWaves: [25, 55, 85],
        triggerWaveMod10: 15,
        label: 'SOUTH CONDENSER RUPTURE',
        tiles: br2Tiles,
        previewLines: makeFractureLines(br2Tiles, ts),
      },
    ];

    const roomLabels: RoomLabelDef[] = [
      { text: 'ATMOSPHERE CORE', subText: 'TURBINE // 3 SEALS', x: 24 * ts, y: 8.4 * ts },
      { text: 'NORTH SERVICE ARTERY', subText: 'HIGH-PRESSURE INTAKE', x: 16 * ts, y: 4.9 * ts },
      { text: 'CRYOGENIC SUMP', subText: 'SW MAZE', x: 6.0 * ts, y: 17.5 * ts },
      { text: 'TURBINE EXCHANGE', x: 13 * ts, y: 12.8 * ts },
      { text: 'HEAVY CARGO BAY', subText: 'EAST DECK', x: 32.2 * ts, y: 3.1 * ts },
      { text: 'SLAG CONDUIT', subText: 'SE MANIFOLD', x: 30.2 * ts, y: 17.6 * ts },
    ];

    return {
      sectorId: 'SEC-02',
      sectorName: 'ATMOSPHERE PROCESSOR — TURBINE DECK',
      code: 'SEC-02',
      name: 'ATMOSPHERE PROCESSOR — TURBINE DECK',
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
