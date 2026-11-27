import { Sector01Blueprint, getWaveHpScale } from './Sector01Blueprint';
import { Sector02Blueprint } from './Sector02Blueprint';
import { Sector03Blueprint } from './Sector03Blueprint';
import type {
  ColonyBlueprint,
  DynamicBreachDef,
  SectorBlueprint,
  SectorId,
  WaveDefinition,
} from './types';

export type { ColonyBlueprint, SectorBlueprint };
export { getWaveHpScale };

export const SECTOR_ORDER: readonly SectorId[] = ['SEC-01', 'SEC-02', 'SEC-03'] as const;

export interface SectorMeta {
  id: SectorId;
  name: string;
  shortName: string;
  cols: number;
  rows: number;
}

export const SECTOR_META: Record<SectorId, SectorMeta> = {
  'SEC-01': {
    id: 'SEC-01',
    name: 'HADLEY MED-LAB & SUB-LEVEL DUCTS',
    shortName: 'MED-LAB',
    cols: 32,
    rows: 18,
  },
  'SEC-02': {
    id: 'SEC-02',
    name: 'ATMOSPHERE PROCESSOR — TURBINE DECK',
    shortName: 'ATMO PROC',
    cols: 36,
    rows: 20,
  },
  'SEC-03': {
    id: 'SEC-03',
    name: 'HIVE SUB-LEVEL — BIO-CONTAINMENT',
    shortName: 'HIVE SUB',
    cols: 36,
    rows: 20,
  },
};

/**
 * Instantiates a fresh mutable ColonyBlueprint for the requested SectorId.
 * Always allocates a brand-new tile grid so dynamic hull breaches never leak across runs.
 */
export function createSectorBlueprint(sectorId: SectorId): ColonyBlueprint {
  switch (sectorId) {
    case 'SEC-02':
      return Sector02Blueprint.createSector02();
    case 'SEC-03':
      return Sector03Blueprint.createSector03();
    case 'SEC-01':
    default:
      return Sector01Blueprint.createSector01();
  }
}

/**
 * Resolves the active SectorId for a given wave number:
 * Rotates every 10 waves post-Queen (W1-10 SEC-01, W11-20 SEC-02, W21-30 SEC-03, W31+ cycles).
 */
export function getSectorIdForWave(waveNumber: number): SectorId {
  const block = Math.floor(Math.max(0, waveNumber - 1) / 10);
  return SECTOR_ORDER[block % SECTOR_ORDER.length];
}

export function getNextSectorId(current: SectorId): SectorId {
  const idx = SECTOR_ORDER.indexOf(current);
  return SECTOR_ORDER[(idx + 1) % SECTOR_ORDER.length];
}

/**
 * Returns any unopened Dynamic Hull Breaches scheduled to telegraph during Prep and collapse at launch of `waveNumber`.
 * Matches explicit `triggerWaves` first; falls back to `waveNumber % 10 === 5` on unopened breaches when cycling sectors.
 */
export function getDynamicBreachesForWave(
  blueprint: ColonyBlueprint,
  waveNumber: number,
  openedBreachIds: ReadonlySet<string>
): DynamicBreachDef[] {
  const exact = blueprint.dynamicBreaches.filter(
    (b) => !openedBreachIds.has(b.id) && b.triggerWaves.includes(waveNumber)
  );
  if (exact.length > 0) return exact;

  if (waveNumber >= 5 && waveNumber % 10 === 5) {
    const fallback =
      blueprint.dynamicBreaches.find(
        (b) => !openedBreachIds.has(b.id) && b.triggerWaveMod10 === 5
      ) ?? blueprint.dynamicBreaches.find((b) => !openedBreachIds.has(b.id));
    return fallback ? [fallback] : [];
  }
  return [];
}

/**
 * Collapses a Dynamic Hull Breach's pre-marked AIR_SHAFT / BULKHEAD tiles into walkable 'CORRIDOR' tiles.
 * Caller should recompute FlowFieldPathfinder afterward!
 */
export function applyDynamicBreach(blueprint: ColonyBlueprint, breach: DynamicBreachDef): void {
  for (const t of breach.tiles) {
    if (t.row >= 0 && t.row < blueprint.rows && t.col >= 0 && t.col < blueprint.cols) {
      blueprint.tiles[t.row][t.col] = 'CORRIDOR';
    }
  }
}

/**
 * Returns the WaveDefinition for any wave number (all 3 sectors share VENT-01..04 & GRATE-01..04 IDs).
 */
export function getWaveDefinition(waveNumber: number, _sectorId?: SectorId): WaveDefinition {
  return Sector01Blueprint.getWaveDefinition(waveNumber);
}
