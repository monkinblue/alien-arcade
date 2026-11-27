import type { HostileKind } from './types';

export interface WikiStatRow {
  cols: string[];
  accent?: string;
}

export interface BestiaryCardEntry {
  kind: HostileKind;
  name: string;
  code: string;
  roleTag: string;
  accent: string;
  statsLine: string;
  threat: string;
  counter: string;
}

export type WikiBlock =
  | { kind: 'heading'; text: string; accent?: string }
  | { kind: 'paragraph'; text: string; accent?: string }
  | { kind: 'bullets'; items: Array<{ lead: string; body: string; accent?: string }> }
  | { kind: 'callout'; tone: 'tip' | 'warn' | 'combo'; title: string; lines: string[] }
  | { kind: 'formula'; title: string; expr: string; notes: string[] }
  | { kind: 'table'; headers: string[]; colFracs: number[]; rows: WikiStatRow[] }
  | { kind: 'bestiary'; entries: BestiaryCardEntry[] };

export interface WikiChapter {
  id: string;
  code: string;
  shortTitle: string;
  fullTitle: string;
  subtitle: string;
  accent: string;
  blocks: WikiBlock[];
}

export const PERIMETER_WIKI_CHAPTERS: WikiChapter[] = [
  // =========================================================================
  // CHAPTER 01: CORE MISSION & CONTROLS
  // =========================================================================
  {
    id: 'basics',
    code: '01',
    shortTitle: 'CORE LOOP & KEYS',
    fullTitle: '01 // COLONY DEFENSE DOCTRINE & CONTROLS',
    subtitle: 'OBJECTIVES · HARDPOINTS · SECTOR EVOLUTION · KEYBOARD & MOUSE',
    accent: '#44FF77',
    blocks: [
      {
        kind: 'heading',
        text: '1-PAGE CONTROLS QUICK-REFERENCE (KEYBOARD & MOUSE)',
        accent: '#4CEEFF',
      },
      {
        kind: 'table',
        headers: ['INPUT / KEY', 'ACTION', 'TACTICAL NOTE'],
        colFracs: [0.24, 0.38, 0.38],
        rows: [
          { cols: ['[1] – [8]', 'Select Hardware Build Tool', 'Hold SHIFT while clicking to multi-deploy!'], accent: '#44FF77' },
          { cols: ['CLICK + DRAG', 'Place & aim directional turret cone', 'Magnetic snap locks pads within 48px; RIGHT-CLICK cancels'], accent: '#44FF77' },
          { cols: ['[R] / SHIFT+DRAG', 'Rotate selected turret +45° / Reroll Draft', '1 press = instant +45° step; [R] rerolls active Protocol Drafts'], accent: '#FFB000' },
          { cols: ['[SPACE] / [P]', 'Tactical Pause (Wave) / Amber Pause Banner', '[SPACE] freezes combat while building · [SPACE] peeks map in Draft!'], accent: '#FFB000' },
          { cols: ['[E] / SHIFT+E', 'Rearm selected Sentry (or Rearm ALL)', 'Auto-falls back to Rearm All if a non-Sentry is selected'], accent: '#FFB000' },
          { cols: ['[U] / [A] / [B]', 'Upgrade MK-II/IV · Pick MK-III Branch A/B', 'Select MK-II turret -> press [A] or [B] to specialize immediately'], accent: '#4CEEFF' },
          { cols: ['[K] / [DEL]', 'Toggle Turret Power / Scrap Unit (65%)', 'Mid-wave power-on has a 2.5s spin-up · [DEL] only (no Backspace)'], accent: '#FF6247' },
          { cols: ['[F] / [O] / [V]', 'M40 Flare / Overclock (2×O) / Airlock Purge', 'Double-tap [O] to Overclock selected turret immediately'], accent: '#FFB000' },
          { cols: ['[L] / [C] / [X]', 'Floodlight (40% Bat) / Coolant / Smart Shed', 'Instant map-wide reactor engineering responses'], accent: '#4CEEFF' },
          { cols: ['[ENTER] / [Z]', 'Launch Wave (Prep) / Toggle 2X Speed', 'SCROLL / MIDDLE-DRAG / WASD zooms (1.0x–2.5x) & pans CAD'], accent: '#44FF77' },
          { cols: ['[H] / [ESC] / [M]', 'Controls Quick-Card / System Menu / Mute', '[H] works inside Protocol Drafts · [W] inside [H] opens full Wiki'], accent: '#4CEEFF' },
        ],
      },
      {
        kind: 'heading',
        text: 'MISSION DIRECTIVE — ENDLESS HIVE SIEGE',
      },
      {
        kind: 'paragraph',
        text: "You command the automated perimeter defenses of Hadley's Hope across escalating colony sectors (SEC-01 Med-Lab 32×18, SEC-02 Atmosphere Processor 36×20, and SEC-03 Hive Sub-Level 36×20). Xenomorph waves erupt from 4 outer Breach Vents (VENT-01..04) and 4 internal hazard-striped Sub-Floor Spawn Grates (GRATE-01..04). Stop them from breaching the opaque central REACTOR CORE.",
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: '3 CORE BULKHEAD SEALS & AEGIS BARRIER:',
            body: 'If any hostile reaches the Reactor Core, 1 Bulkhead Seal blows and triggers a 160px emergency shockwave clearing immediate stragglers. Lose all 3 seals and the sector falls. Rebuild blown seals between waves for 480 Scrap, or draft the AEGIS CORE ENERGY BARRIER Protocol for a rechargeable 1-hit energy shield (regenerates every 5 waves)!',
            accent: '#FFB000',
          },
          {
            lead: 'SECTOR EVOLUTION & EXTRACTION CADENCE:',
            body: 'Telegraphed AIR_SHAFT Hull Breaches open new flank tunnels on Waves 5/15/25, and Post-Queen Sector Extractions on Waves 11/21/31 automatically liquidate all turrets at 100% Scrap while carrying Protocols, Omegas, Reactor kW, Seals, Streak & Score into a fresh 36×20 Sector (SEC-01 → SEC-02 → SEC-03)!',
            accent: '#00F0FF',
          },
          {
            lead: 'TWO RESOURCES (SCRAP & REACTOR kW):',
            body: 'SCRAP funds hardware, MK-II/III/IV upgrades, door welds, mines, reloads, Ordnance Resupply, Draft Rerolls, and Reactor expansions up to 295 kW. REACTOR kW is your live electrical budget (starts 115 kW; ONLY AUX_BUS Protocols push the hard cap from 295 kW up to 375 kW).',
            accent: '#44FF77',
          },
          {
            lead: 'PERFECT-WAVE STREAK & SCORING:',
            body: 'Clearing a wave without losing a Core Seal adds +0.25x to your Streak Multiplier (up to 2.50x at 6+ flawless waves!). Combined with Station Mutators (+50% Score AND +20% Scrap!), your active score multiplier scales to 3.75x+ (and higher with Endgame Telemetry Directives)!',
            accent: '#00F0FF',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'SECTOR FLOOR TILE & HARDPOINT TYPES',
      },
      {
        kind: 'table',
        headers: ['TILE TYPE', 'VISUAL CUE', 'COMPATIBLE HARDWARE', 'TACTICAL ROLE'],
        colFracs: [0.22, 0.22, 0.28, 0.28],
        rows: [
          {
            cols: ['MOUNT PAD [+]', 'Square pad with + reticle', '[1] Sentry · [2] Incin · [3] Rail · [6] M314', 'Directional guns & motion relays'],
            accent: '#44FF77',
          },
          {
            cols: ['DUCT GRATE', 'Green louvered floor vent', '[4] Cryo Valve · [5] Arc-Shock Coil', '360° LOS-bound crowd-control zones'],
            accent: '#00F0FF',
          },
          {
            cols: ['SPAWN GRATE', 'Amber/rust hazard-striped hatch', 'NON-BUILDABLE (Skitterer Hatch!)', 'Auxiliary sub-floor breach point (5s rattle)'],
            accent: '#FF6622',
          },
          {
            cols: ['BLAST DOOR', 'D-01 .. D-06 doorways', '[7] Arc-Weld Seal (480 HP · max 3)', 'Reroutes paths & delays sappers/heavies'],
            accent: '#FFB000',
          },
          {
            cols: ['CORRIDOR FLOOR', 'Open walkable tiles', '[8] M18 Proximity Claymore (6/wave)', '0 kW wave-scaled mines & grate traps'],
            accent: '#9EF5B8',
          },
          {
            cols: ['AIRLOCK CHAMBER', 'Orange dashed W-01/E-02/S-03', '[V] Airlock Vent Purge (1x + Resupply)', 'Outward decompression flush + %HP blast'],
            accent: '#FF8844',
          },
          {
            cols: ['REACTOR CORE', 'Armored green bulkhead ring', 'OPAQUE OBJECTIVE (Blocks LOS!)', 'Turrets cannot shoot through the Core'],
            accent: '#44FF77',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'MAGNETIC HARDPOINT SNAP & SMART FLOW AIM',
        lines: [
          'Every directional turret automatically aims upstream toward incoming open enemy flow routes (including North aux grates!) when hovering a pad.',
          'Fine-tune exact firing lanes by holding Left-Click and dragging out your cone, holding SHIFT+DRAG on a placed turret, or pressing [R] for instant 45° steps.',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 02: VISION, DARKNESS, ILLUMINATION & LASER TRIPWIRES
  // =========================================================================
  {
    id: 'vision',
    code: '02',
    shortTitle: 'VISION & TRIPWIRE',
    fullTitle: '02 // DARKNESS, ILLUMINATION, LOS & M314 LASER TRIPWIRES',
    subtitle: '55% DARK CONE · 100% LIT CRIT · TRUE WALL/CORE LOS · STALKER REVEAL',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'DARKNESS VS. ILLUMINATION (THE TWO ARCS ON EVERY TURRET)',
      },
      {
        kind: 'paragraph',
        text: 'Every combat turret draws TWO raycasted range arcs: a bright SOLID INNER ARC (55% range) and a DASHED OUTER ARC (100% illuminated range). Baseline Core radar is compressed to 500px (16.7m), making M314 Relays, Flares, and Floodlight vital across outer lanes.',
      },
      {
        kind: 'table',
        headers: ['TARGET STATE', 'ENGAGEMENT RANGE', 'ACCURACY', 'DAMAGE BONUS', 'STALKERS?'],
        colFracs: [0.22, 0.21, 0.19, 0.20, 0.18],
        rows: [
          {
            cols: ['UNLIT / DARK', '55% (Solid Inner Arc)', '80% (Rail: 90%)', '1.00x (Ω-Night: +35%)', 'INVISIBLE!'],
            accent: '#FFB000',
          },
          {
            cols: ['OPTICAL / SENSOR LIT', '100% (Full Dashed Cone)', '100% (Zero Miss!)', '+20% CRIT (+Optics)', '100% EXPOSED!'],
            accent: '#44FF77',
          },
          {
            cols: ['CRYO / NAPALM ONLY', 'Reveals silhouette', 'Stalker: 50% Evade!', 'No Full Lit Crit', '50% EVASION!'],
            accent: '#9BF8FF',
          },
          {
            cols: ['REACTOR BLACKOUT', '0% (Turrets Offline)', 'OFFLINE (3.5s)', 'OFFLINE', 'HIDDEN'],
            accent: '#FF3318',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: 'OPTICAL ILLUMINATION VS. THERMAL/CRYO REVEAL',
        lines: [
          'True OPTICAL/SENSOR illumination comes from M314 Relay Sweeps, M314 Laser Tripwires, M314 MK-III FLOODLIGHT, M40 Flares [F], [L] Floodlight, Arc-Shock Coils, and the 135px Core Light.',
          'Napalm burn & Cryo plumes expose targets visually, but do NOT grant full +20% illuminated crit — and Signal Stalkers retain 50% evasion in Cryo-only chokes until hit by optical/sensor reveal!',
        ],
      },
      {
        kind: 'heading',
        text: 'ALL ILLUMINATION & SENSOR SOURCES',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'M314 MOTION RELAY SWEEP [6]:',
            body: 'Pulses a 390px (430px MK-II) radar wave every 1.55s (1.25s MK-III) that optically illuminates every hostile it crosses for 1.55s — revealing Stalkers and lighting corridors continuously.',
            accent: '#44FF77',
          },
          {
            lead: 'M314 RED LASER TRIPWIRE [6]:',
            body: 'Projects a continuous red laser up to 235px (7.8m) across a corridor. Any hostile crossing the beam is optically illuminated for 5.0s and radar-pinned for 2.5s! (Disabled temporarily while a Screamer jams the relay or acid drops Wire Integrity < 20%.)',
            accent: '#FF5533',
          },
          {
            lead: 'M314 MK-III BRANCH A (FLOODLIGHT, +2 kW):',
            body: 'Creates a PERMANENT 280px (9.3m) 360° optical halo that is 100% IMMUNE TO SCREAMER JAMS, adds +15% crit inside the halo, and burns Stalker stealth for 6.0s!',
            accent: '#00F0FF',
          },
          {
            lead: 'M40 STROBE FLARE [F] (0 kW · 18s CD):',
            body: 'Free 0 kW optical flare lighting a 255px radius for 12.0s (+2.5s per OPTICS+ stack). Immune to Screamer jams and prevents turrets from shooting Screamer phantom blips!',
            accent: '#FFF0B8',
          },
          {
            lead: 'EMERGENCY FLOODLIGHT [L] (40% BAT · 20s CD):',
            body: 'Lights the ENTIRE MAP for 7.5s (+2.5s per OPTICS+ stack), grants +25% bonus crit, instantly PURGES ALL SCREAMER JAMS, and exposes every Stalker map-wide! (Disabled if NIGHT-HUNTER OPTICS Omega is locked.)',
            accent: '#00F0FF',
          },
          {
            lead: 'CORE LIGHT & ARC COIL TAG:',
            body: 'The Reactor Core radiates a 135px sterile light ring (67px in Grid Brownout). Arc-Shock Coil zaps optically tag targets for 4.0s and strip Stalker stealth.',
            accent: '#FFB000',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'TRUE LINE-OF-SIGHT (WALLS, DOORS, OPAQUE CORE & GRATES)',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'OPAQUE REACTOR CORE & BULKHEADS:',
            body: 'Solid bulkheads, welded Blast Doors, AND the central Reactor Core completely block turret LOS and Rail-Lance beams! You can no longer shoot across the Core — plan crossfires around each approach.',
            accent: '#44FF77',
          },
          {
            lead: 'LOS-BOUND CRYO & SHOCK GRATES:',
            body: 'Both Cryo-Stasis Plumes and Arc-Shock Coils strictly enforce wall-LOS. They never chill or stun enemies through solid bulkheads — position them at open corridor junctions!',
            accent: '#00F0FF',
          },
          {
            lead: 'SCREAMER JAM COUNTERPLAY:',
            body: 'Bio-Screamers jam M314 radial sweeps, Relay stat links (+Range/+Crit), AND Laser Tripwires for 3.4s, and spawn purple ERR? phantom blips that waste 1 turret burst unless covered by M314 FLOODLIGHT, [F] Flare, or [L] Floodlight!',
            accent: '#E066FF',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 03: ORDNANCE, MK-III BRANCHES & MK-IV REFITS
  // =========================================================================
  {
    id: 'ordnance',
    code: '03',
    shortTitle: 'ARSENAL & MK-IV',
    fullTitle: '03 // COMPLETE 8-UNIT ORDNANCE, MK-III TREES & MK-IV REFITS',
    subtitle: 'REBALANCED STATS · 12 MK-III BRANCHES · LATE-GAME MK-IV OVERHAULS',
    accent: '#FFB000',
    blocks: [
      {
        kind: 'heading',
        text: 'BASE HARDWARE SPECIFICATIONS [KEYS 1–8]',
      },
      {
        kind: 'table',
        headers: ['UNIT', 'COST / kW', 'RANGE / ARC', 'DAMAGE & RATE', 'SPECIAL TRAITS'],
        colFracs: [0.18, 0.14, 0.17, 0.23, 0.28],
        rows: [
          {
            cols: ['[1] UA 571-C', '100S / 22kW', '350px (11.7m) 60°', '16.5 (MK2: 22) / 0.088s', '320-rd drum (MK2: 440); exact 60Hz ROF; heat +2.6'],
            accent: '#44FF77',
          },
          {
            cols: ['[2] M240 INCIN', '125S / 26kW', '204px (6.8m) 76°', '64/88/140 DPS (Top-3 Cap)', '100%/50%/25% (1.75x) cloud cap; burns Acid (+15S)'],
            accent: '#FFB000',
          },
          {
            cols: ['[3] M99 RAIL', '150S / 30kW', '460px (15.3m) 32°', '112 (MK2: 155) / 1.72s', '100% AP; pierces 4 (MK2: 5); 10% dark miss; shoots Eggs'],
            accent: '#00F0FF',
          },
          {
            cols: ['[4] CRYO VALVE', '80S / 14kW', '142px (MK2: 1.22x) LOS', '58% Slow (29% Boss) · +35% Shat', 'Duct Grate; slows Crusher charge 30%; cools guns'],
            accent: '#9BF8FF',
          },
          {
            cols: ['[5] ARC COIL', '95S / 18kW', '168px (MK2: 1.18x) LOS', '42/58 × +12%/Wave · 4/5 chains', 'Scales w/ Wave, CAP-DRIVE & OPTICS+; 0.65s stun'],
            accent: '#00F0FF',
          },
          {
            cols: ['[6] M314 RELAY', '65S / 10kW', '390px (MK2: 430px) · 235px', '0 DMG (Force Multiplier)', '+24% Range & +18% Sentry DMG within 255px!'],
            accent: '#44FF77',
          },
          {
            cols: ['[7] DOOR SEAL', '65S / 0kW', 'Doorway (480 HP)', 'Max 3 Active (+Bulkhead)', 'Instant Prep; 1.5s torch mid-wave; 4s repair CD'],
            accent: '#FFB000',
          },
          {
            cols: ['[8] M18 MINE', '50S / 0kW', '54px Trig · 152px Blast', '195×(1+0.14(W-1)) · 0.95s Stun', '6/wave (+4 Ω-Sapper); 50% Acid/Egg Scrap; blocks in Acid'],
            accent: '#FF8844',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'UPGRADE TIERS, MK-IV OVERHAUL REFITS & SPIN-UP RULES',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'MK-II UNIVERSAL BOOST:',
            body: 'Costs 60–125 Scrap (0 extra kW!). Increases Range (+12% combat / +22% Cryo / +18% Shock / +10.5% M314), Damage ~+33%, Cooling Rate 11.5 -> 16.0/s, Sentry Drum 320 -> 440 RDS, Rail Pierce 4 -> 5, Arc Chains 4 -> 5.',
            accent: '#44FF77',
          },
          {
            lead: 'MK-IV OVERHAUL REFITS (450S / 700S / 1000S — 3 LEVELS PER MK-III):',
            body: 'Once a turret reaches MK-III, click MK-IV REFIT (or press [U]) to install up to 3 Overhaul tiers! Each tier grants +10% DMG (or +10% M314 sweep range) at the cost of +1 kW — turning late-game Scrap into lethal firepower while keeping Reactor kW tight! 100% of refit Scrap refunds on Sector Extraction.',
            accent: '#FFE066',
          },
          {
            lead: 'MID-WAVE POWER SPIN-UP (2.5S) & THERMAL LOCK:',
            body: 'Toggling a turret ONLINE [K] during an active wave requires a 2.5s capacitor spin-up (cyan progress arc). Overheating to 100% locks barrels until 32% heat; use Cryo Valves or [C] Coolant Flush (-78 heat). Scrapping [DEL] refunds 65% of all invested Scrap (100% automatically on Sector Extraction!).',
            accent: '#FF6247',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'ALL 12 BRANCHING MK-III SPECIALIZATIONS (A VS. B)',
      },
      {
        kind: 'table',
        headers: ['UNIT (COST / +kW)', 'BRANCH A — PRECISION / BURST', 'BRANCH B — CONTROL / UTILITY'],
        colFracs: [0.22, 0.39, 0.39],
        rows: [
          {
            cols: ['UA 571-C (240S / +4kW)', 'A: AP SABOT — +45% DMG, pierces 65% frontal armor', 'B: TWIN-LINK — 640 drum, +35% ROF (0.064s), low heat (1.9), 2-target 40% splash!'],
            accent: '#44FF77',
          },
          {
            cols: ['M240 INCIN (250S / +4kW)', 'A: THERMITE — +65% burn DPS (140) & -35% Armor Melt (4s)', 'B: FIREWALL — +45% cloud radius, 5.2s flame, -25% slow & Egg targeting!'],
            accent: '#FFB000',
          },
          {
            cols: ['M99 RAIL (280S / +6/+4kW)', 'A: OVERPEN — Pierces up to 12 lined foes (+40% DMG, 92% keep)', 'B: CAPACITOR — -35% recharge (0.86s), Boss stagger + 2.6s recovery!'],
            accent: '#00F0FF',
          },
          {
            cols: ['CRYO VALVE (190S / +2/0kW)', 'A: DEEP FREEZE — 72% slow (36% Boss) & +55% Shatter!', 'B: CRYO COOLER — 0 extra kW, true 320px 2x cooling aura, -20% heat & +15% ROF to cooled guns!'],
            accent: '#9BF8FF',
          },
          {
            cols: ['ARC COIL (210S / +4/+2kW)', 'A: TESLA CHAIN — 7 chains, +35% DMG + 5% max-HP shock (450 boss cap)', 'B: EMP PULSE — 1.2s stun (0.65s boss), -50% armor shred & 4.0s caster silence!'],
            accent: '#00F0FF',
          },
          {
            cols: ['M314 RELAY (175S / +2/+2kW)', 'A: FLOODLIGHT — 280px jam-immune optical halo, +15% crit & 6s Stalker burn!', 'B: TGT MATRIX — Linked guns get +32% Range & +32% Crit!'],
            accent: '#44FF77',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 04: DAMAGE, ARMOR, CRITS & SYNERGY COMBOS
  // =========================================================================
  {
    id: 'combat',
    code: '04',
    shortTitle: 'DAMAGE & ARMOR',
    fullTitle: '04 // BALLISTICS, CARAPACE ARMOR & SYNERGY MULTIPLIERS',
    subtitle: 'FRONTAL DEFLECTION · SHARED PROTOCOL BUCKET · NAPALM CAP · COMBOS',
    accent: '#FF6633',
    blocks: [
      {
        kind: 'heading',
        text: 'HEAVY DIRECTIONAL CARAPACE ARMOR (PRAETORIAN · CRUSHER · QUEEN)',
      },
      {
        kind: 'paragraph',
        text: 'Praetorians, Juggernaut Crushers, and the Matriarch Queen wear dense frontal chitin. Firing un-upgraded UA 571-C Sentries straight into their face triggers RICOCHET deflection (70% reduction; softened to 60% vs early W1–W6 Crushers). Armor can now be pierced OR actively melted/shredded!',
      },
      {
        kind: 'table',
        headers: ['ATTACK ANGLE / COUNTER', 'MULTIPLIER', 'MECHANIC DETAILS'],
        colFracs: [0.30, 0.18, 0.52],
        rows: [
          {
            cols: ['Sentry -> Frontal Cone', '0.30x (W5: 0.40x)', 'Triggers sparks + RICOCHET unless countered by AP/Melt/Shred'],
            accent: '#FF3318',
          },
          {
            cols: ['Sentry -> Side / Rear', '1.00x / 1.40x', 'Side = full penetration; Flank/Rear = +40% FLANK CRIT!'],
            accent: '#44FF77',
          },
          {
            cols: ['AP Sabot + DU-10MM', 'Up to 1.00x + Boss+', 'AP caps at 100%; excess AP converts 50% into bonus BOSS DAMAGE!'],
            accent: '#8EF5AB',
          },
          {
            cols: ['Thermite / EMP Shred', '-35% / -50% Armor', 'Thermite Incin melts armor 4s; EMP Coil shreds frontal armor 4s!'],
            accent: '#FFB000',
          },
          {
            cols: ['Rail / Incin / Arc / Mine', '100% BYPASS!', 'Completely ignores directional frontal carapace at all angles!'],
            accent: '#00F0FF',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'REBALANCED DAMAGE & NAPALM STACKING FORMULAS',
      },
      {
        kind: 'formula',
        title: 'SHARED ADDITIVE PROTOCOL BUCKET (SENTRY & RAIL-LANCE)',
        expr: 'CardBucket = 1.00 + (0.15 × DU) + (0.15 × OPTICS if Lit) + (0.20 × SHATTER if Chilled)',
        notes: [
          'Base combat synergies (Lit +20%, Matrix +32%, Floodlight +15%, Cryo Shatter +35%/+55%, Flank +40%, MK-IV +10%/lvl) apply cleanly alongside the shared Protocol Card Bucket — preventing runaway single-build exploits.',
          'Rail-Lance applies per-target illumination, honors MK-III Deep Freeze (+55% Shatter), and pierces up to 12 targets on OVERPEN.',
        ],
      },
      {
        kind: 'formula',
        title: 'M240 INCINERATOR TOP-3 DIMINISHING NAPALM CAP',
        expr: 'Per-Target Burn DPS = Top1(100%) + Top2(50%) + Top3(25%)   [Max 1.75x overlap!]',
        notes: [
          'Base cloud DPS is buffed to 64 (MK-I) / 88 (MK-II) / 140 (MK-III Thermite), plus +25%/stack THERMITE Protocol.',
          'Stacking 10 Incinerators on one tile no longer creates infinite DPS — pair 1–2 Incinerators with Rail, Sentry, Shock, and Cryo!',
        ],
      },
      {
        kind: 'heading',
        text: 'HIGH-VALUE TACTICAL COMBOS',
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 1: THERMITE + EMP + AP SABOT BOSS SHRED',
        lines: [
          'Tag a Crusher or Queen with Thermite Incinerator (-35% armor melt) or EMP Arc Coil (-50% frontal armor shred & 4s silence), then unload AP Sabot Sentries & Capacitor Rail-Lance!',
          'Add the THERMAL SHOCK Omega Directive so Cryo/Rail hits on Burning targets trigger an 8% Max-HP Shatter Detonation (4s ICD)!',
        ],
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 2: ACID STERILIZATION & CLAYMORE CLEANUP',
        lines: [
          'Incinerator Napalm burns Acid Pools 4.2x faster for +15 Scrap (+12 FLAT Scrap per THERMITE stack, exempt from late-wave yield decay — DOUBLED during ACIDIC SURGE!).',
          'M18 Claymores also vaporize Acid Pools & Egg Sacs for 50% sterilization Scrap and scale +14% blast damage every wave!',
        ],
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 3: AIRLOCK DECOMPRESSION FLUSH (+100% KILL SCORE)',
        lines: [
          'Triggering [V] Airlock Purge on W-01 / E-02 / S-03 now deals 35% CURRENT HP (15% Boss) + 100 FLAT DMG, flushes enemies 290px outward away from Core, stuns 1.75s, clears Acid Pools, and pays 2x score on decompression kills!',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 05: XENOMORPH BESTIARY & DOOR AI
  // =========================================================================
  {
    id: 'bestiary',
    code: '05',
    shortTitle: 'BESTIARY & DOORS',
    fullTitle: '05 // XENOMORPH BESTIARY, DOOR AI & CONGESTION ROUTING',
    subtitle: 'ALL 9 CASTES · 3-TIER DOOR AI · CONGESTION FLANKING · COUNTERS',
    accent: '#B8FF3B',
    blocks: [
      {
        kind: 'formula',
        title: 'SMOOTHED WAVE HP SCALING & W11+ MIXED CASTES',
        expr: 'W1–10: 1 + (W-1)×0.10   |   W11–18: 1.90 × 1.115^(W-10)   |   W19+: × 1.155/wave',
        notes: [
          'W11+ endless waves now mix ALL 6 non-boss castes evenly on every wave (no more even/odd drought), and W5 Crusher starts at 960 HP (60% MK-I/II frontal deflect on W1–W6).',
        ],
      },
      {
        kind: 'heading',
        text: '3-TIER DOOR AI & ACTIVE KILLBOX CONGESTION ROUTING',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: '3-TIER WELDED DOOR PENALTIES (NO MORE 0-HIT FUNNELS!):',
            body: 'Standard Swarm (Skitterer/Drone/Stalker/Screamer) = 10.5-tile penalty; Sappers (Spitter/Burster) = 5.5-tile penalty (actively hunt sealed doors!); Heavies & Bosses (Praetorian/Crusher/Queen) = 4.0-tile penalty (smash straight through choked blast doors!).',
            accent: '#FFB000',
          },
          {
            lead: 'CONGESTION & DAMAGED-DOOR ATTRACTION:',
            body: 'During active waves, the flow-field recomputes every 1.0s with cell congestion (+0.65/hostile + 1.5 in Cryo/Napalm) AND immediately whenever a welded door crosses 75%/50%/25% HP! Trailing packs sense clogged meatgrinders or weakened doors and peel off to breach your flanks.',
            accent: '#FF5522',
          },
          {
            lead: 'DOOR SURVIVABILITY COUNTERBALANCE:',
            body: 'Base Blast Door HP is raised to 480 HP with a faster 1.5s mid-wave Arc-Weld torch — and drafting ELECTRIFIED BULKHEAD PLATING gives +50% Door HP, +1 Max Seal, 55 DPS melee recoil, and 50% Spitter acid reflection!',
            accent: '#44FF77',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'LIVE XENOMORPH SPECIMEN RECOGNITION & COUNTERPLAY',
      },
      {
        kind: 'bestiary',
        entries: [
          {
            kind: 'SKITTERER',
            name: 'SKITTERER SWARMER',
            code: 'SKT',
            roleTag: 'FAST SWARM',
            accent: '#44FF77',
            statsLine: 'HP: 26  |  SPD: 120 px/s  |  DOOR: 12 DPS (10.5t)  |  3S / 45 PTS',
            threat: 'Erratic 6-legged swarmer erupting from non-buildable hazard-striped SPAWN GRATES (5s amber rattle telegraph).',
            counter: 'Arc-Shock Coil [5], Incinerator [2], Twin-Link MK-III splash, or drop an M18 Claymore [8] on the rattling hatch!',
          },
          {
            kind: 'DRONE',
            name: 'XENO DRONE',
            code: 'DRN',
            roleTag: 'PACK HUNTER',
            accent: '#44FF77',
            statsLine: 'HP: 90  |  SPD: 88 px/s  |  DOOR: 24 DPS (10.5t)  |  8S / 110 PTS',
            threat: 'Relentless biomechanical pack hunter that drains Sentry drums and tests clogged choke flanks under congestion.',
            counter: 'UA 571-C Sentry [1] crossfire, Twin-Link splash, or M99 Rail-Lance [3] down stepped corridors.',
          },
          {
            kind: 'BURSTER',
            name: 'ACID BURSTER',
            code: 'BRS',
            roleTag: 'SAPPER / ACID',
            accent: '#C8FF44',
            statsLine: 'HP: 118  |  SPD: 68 px/s  |  DOOR: 28 DPS + 110 DET (5.5t)  |  13S / 175 PTS',
            threat: 'Sapper caste! Battering a welded door for 1.5s triggers a 110 DMG acid-detonation! Acid pools within 60px corrode turrets (+25% CD, +8 heat/s) & block Claymores.',
            counter: 'Delete BEFORE they reach welded doors; sterilize pools with M240 Incinerator [2] (+15S+ bonus) or M18 Mines.',
          },
          {
            kind: 'STALKER',
            name: 'SIGNAL STALKER',
            code: 'STK',
            roleTag: 'STEALTH CLOAK',
            accent: '#B6FFE0',
            statsLine: 'HP: 98  |  SPD: 96 px/s  |  DOOR: 26 DPS (10.5t)  |  15S / 210 PTS',
            threat: 'Invisible in dark corridors AND retains 50% evasion in Cryo-only chokes without optical/sensor illumination!',
            counter: 'M314 Relay / MK-III FLOODLIGHT (6s stealth burn!), [F] Flare, [L] Floodlight, or Arc-Shock Coil [5] (4s tag).',
          },
          {
            kind: 'SPITTER',
            name: 'ACID SPITTER',
            code: 'SPT',
            roleTag: 'SAPPER / RANGED',
            accent: '#B8FF3B',
            statsLine: 'HP: 128  |  SPD: 64 px/s  |  RNG: 320px (5.5t)  |  18S / 240 PTS',
            threat: 'Sapper sniper! Spits corrosive globs from 320px at welded Blast Doors (55 burst + 38 DPS acid) and turrets (halves Cryo Valve plume rate & slows fire!).',
            counter: 'Snipe with M99 Rail-Lance [3], wash off acid with [C] Coolant Flush, silence 4s with EMP Coil, or reflect 50% acid with BULKHEAD ARMOR!',
          },
          {
            kind: 'SCREAMER',
            name: 'BIO-SCREAMER JAMMER',
            code: 'SCR',
            roleTag: 'RADAR JAMMER',
            accent: '#E066FF',
            statsLine: 'HP: 142  |  SPD: 74 px/s  |  JAM: 300px / 3.4s  |  22S / 280 PTS',
            threat: 'Sonic pulse disables M314 sweeps, Relay buffs AND Tripwires for 3.4s, and spawns purple ERR? phantom blips that waste 1 turret burst unless optically lit!',
            counter: 'M314 MK-III FLOODLIGHT halo & [F] Flares ignore jams; [L] Floodlight purges jams instantly; EMP Coil silences Screamers for 4.0s!',
          },
          {
            kind: 'PRAETORIAN',
            name: 'PRAETORIAN CRUSHER',
            code: 'PRT',
            roleTag: 'HEAVY (4.0t DOOR)',
            accent: '#FF8C24',
            statsLine: 'HP: 460  |  SPD: 48 px/s  |  DOOR: 68 DPS (4.0t)  |  32S / 420 PTS',
            threat: '70% frontal carapace deflection and 4.0-tile door penalty — pushes directly through welded doors instead of taking long detours.',
            counter: 'M99 Rail-Lance [3], Thermite Incin (-35% melt), EMP Coil (-50% shred), Cryo Shatter, and Flank Sentries (+40% rear crit).',
          },
          {
            kind: 'CRUSHER',
            name: '★ JUGGERNAUT CRUSHER',
            code: 'CRSH',
            roleTag: 'MINI-BOSS (W5+)',
            accent: '#FF7722',
            statsLine: 'HP: 960  |  SPD: 44 px/s  |  DOOR: 135 (324 RAM!)  |  95S / 1150 PTS',
            threat: 'Armored battering ram (60% deflect W1–6, 70% W7+) that CHARGES welded Blast Doors for 2.4x (324 DPS)! Cryo slows charge 30% but no longer hard-cancels it.',
            counter: 'Hard-stagger charges with Capacitor Rail MK-III, Arc/EMP Coil [5], M18 Claymore [8], or [V] Airlock Purge!',
          },
          {
            kind: 'QUEEN',
            name: '★ XENO MATRIARCH QUEEN',
            code: 'QUEEN',
            roleTag: 'BOSS (W10 / W20+)',
            accent: '#FF3355',
            statsLine: 'HP: 2650  |  SPD: 34 px/s  |  50% CRYO RESIST  |  240S / 2800 PTS',
            threat: '50% Cryo slow resist (max 36% Deep Freeze slow) & 210 door DPS. Lays wave-scaled Egg Clutches at 75% & 40% HP (50% Napalm resist; hatches 3 Skitterers in 5s!).',
            counter: 'All turrets auto-prioritize Eggs <2s from hatch! Combine EMP Silence (blocks eggs 4s), Capacitor/Overpen Rail, AP Sabot, and [O] Overclock!',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 06: REACTOR, BATTERY, RESUPPLY & COMMAND ABILITIES
  // =========================================================================
  {
    id: 'reactor',
    code: '06',
    shortTitle: 'REACTOR & SKILLS',
    fullTitle: '06 // REACTOR BUS (295->375 kW), RESUPPLY & ACTIVE SYSTEMS',
    subtitle: 'SCRAP VS. AUX CAP · BATTERY · ORDNANCE RESUPPLY · ALL 6 SKILLS',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'REACTOR kW SCALING (115 -> 295 SCRAP CAP -> 375 AUX CAP)',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'INDEPENDENT AUTO-UNLOCKS (W2–W12):',
            body: 'Start at 115 kW. Clearing Waves 2, 4, 6, 8, 10 & 12 grants 6 independent +15 kW auto-unlocks (+90 kW total) — buying early Scrap expansions or drafting AUX_BUS NEVER eats your free even-wave unlocks!',
            accent: '#44FF77',
          },
          {
            lead: '295 kW SCRAP CAP VS. 375 kW AUX_BUS CAP:',
            body: 'Left-panel Scrap Bus expansions (+15 kW, 220S + 120S/step) cap strictly at 295 kW. ONLY drafting +20kW AUX_BUS Protocols (max 4 stacks) raises the Reactor ceiling above 295 kW up to the 375 kW hard cap — making AUX_BUS permanently valuable through Wave 30+!',
            accent: '#00F0FF',
          },
          {
            lead: 'RESERVE BATTERY & 3.5S BLACKOUT BUFFER:',
            body: 'Unused Free kW charges Reserve Battery (1.15–3.75%/s, +40%/stack CAP-DRIVE). Battery absorbs power surges (-26%/s) to prevent Breaker trips; if Battery hits 0% for 4.0s of sustained overload, the Main Breaker trips for a 3.5s Sector Blackout. Overload decays at 1.0x when cleared.',
            accent: '#FF3318',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'ALL 6 ACTIVE COMMAND SYSTEMS & TACTICAL RESUPPLY',
      },
      {
        kind: 'table',
        headers: ['KEY / SYSTEM', 'COST / COOLDOWN', 'DURATION / SURGE', 'EFFECT & BEST TIMING'],
        colFracs: [0.19, 0.19, 0.19, 0.43],
        rows: [
          {
            cols: ['[F] M40 FLARE', '0 kW · 18s CD', '12.0s (+2.5s Opt)', '255px optical light (100% rng, +20% crit, jam-immune, blocks phantoms)'],
            accent: '#FFF0B8',
          },
          {
            cols: ['[O] OVERCLOCK', '+22kW (-20%/Cap)', '8.0s (+2.0s Cap)', '265px zone: 2x ROF, 2x servo & trimmed 1.15x heat! Double-tap [O] on unit'],
            accent: '#FFB000',
          },
          {
            cols: ['[V] AIRLOCK PURGE', '0 kW · 1x+ / Wave', 'Instant Blast', '35% curr HP (15% Boss) + 100 flat DMG, 290px outward push, 1.75s stun, 2x score!'],
            accent: '#44FF77',
          },
          {
            cols: ['[L] FLOODLIGHT', '40% Bat · 20s CD', '7.5s (+2.5s Opt)', 'MAP-WIDE light, +25% crit, instant Screamer jam purge & Stalker reveal!'],
            accent: '#00F0FF',
          },
          {
            cols: ['[C] COOL FLUSH', '+10 kW · 20s CD', '1.6s Surge', 'Vents -78 Heat instantly, breaks Thermal Lock, washes off Spitter Acid!'],
            accent: '#9BF8FF',
          },
          {
            cols: ['[X] SMART SHED', '0 kW · Instant', 'Priority Toggle', 'Sheds ONLY enough lowest-priority aux units to clear overload (not all aux!)'],
            accent: '#FFB000',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'LATE-GAME SCRAP SINK: CONTEXTUAL ORDNANCE RESUPPLY (250S+)',
        lines: [
          'When Airlock Purge reaches 0 charges or M18 Claymore stock hits 0, an inline +1 PURGE (250S+) or +6 MINES (250S+) resupply button appears directly on [V] PURGE / [8] M18 MINE (+100S per extra purchase in the same wave; resets every wave).',
          'Combine Resupply with MK-IV Overhaul Refits (450/700/1000S) and Paid Protocol Rerolls (150/300S) so late-game Scrap always converts into survival!',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 07: PROTOCOLS, OMEGA DIRECTIVES & SECTOR EVOLUTION
  // =========================================================================
  {
    id: 'progression',
    code: '07',
    shortTitle: 'PROTOCOLS & OMEGA',
    fullTitle: '07 // PROTOCOLS, OMEGA DIRECTIVES & SECTOR EVOLUTION',
    subtitle: '10 REWORKED PROTOCOLS · BOSS OMEGAS · ENDGAME DIRECTIVES · SECTORS',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'ALL 10 REWORKED MU-TH-UR PROTOCOLS (EVERY 3 WAVES · REROLL [R])',
      },
      {
        kind: 'table',
        headers: ['CODE', 'PROTOCOL NAME', 'PERMANENT EFFECT PER STACK', 'MAX'],
        colFracs: [0.16, 0.27, 0.49, 0.08],
        rows: [
          { cols: ['DU-10MM', 'Depleted Uranium Rounds', '+15% Sentry/Rail DMG (shared bucket) · +25% AP to 100% (excess -> 50% Boss DMG)', '3'], accent: '#FFB000' },
          { cols: ['AUTO-BELT', 'Autoloader Belt Feeds', '-45% Rearm Time/Cost · Auto-Rearms empty Sentries · +20% Drum · -15% Sentry Heat', '2'], accent: '#44FF77' },
          { cols: ['+20kW BUS', 'Auxiliary Reactor Capacitor', '+20 kW immediately AND raises hard cap +20 kW (295 -> 375 kW!)', '4'], accent: '#00F0FF' },
          { cols: ['SHATTER+', 'Cryo-Shatter Resonance', '+20% Shatter DMG (shared bucket) · +15% LOS-bound Cryo & Shock radius', '2'], accent: '#9BF8FF' },
          { cols: ['THERMITE', 'Thermite Napalm Catalyst', '+25% Burn DPS · +12 FLAT Sterilize Scrap (100% exempt from yield decay!)', '2'], accent: '#FF7733' },
          { cols: ['OPTICS+', 'High-Gain Thermal Optics', '+15% Lit Crit DMG (shared bucket) · +2.5s Flare & Floodlight duration', '2'], accent: '#FFF6CC' },
          { cols: ['CAP-DRIVE', 'Reserve Battery Overdrive', '+40% Battery Charge · +2.0s Overclock · -20% OC Surge kW · +25% Shock DMG', '2'], accent: '#44FFDD' },
          { cols: ['SALVAGE+', 'Weyland Salvage Requisition', '+25% ALL Scrap (fractional carryover, incl. Acid/Eggs) · +1 FREE Draft Reroll!', '2'], accent: '#FFB000' },
          { cols: ['DOOR-ARMOR', 'Electrified Bulkhead Plating', '+50% Door HP · +1 Max Seal · 55 DPS melee recoil · 50% Spitter acid reflect!', '2'], accent: '#8EF5AB' },
          { cols: ['AEGIS-SHD', 'Aegis Core Energy Barrier', '+1 Core Seal immediately · Rechargeable 1-hit Core Barrier (every 5 waves!)', '2'], accent: '#00F0FF' },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'DRAFT REROLLS [R] & REPEATABLE ENDGAME DIRECTIVES',
        lines: [
          'Press [R] (or click REROLL) in any draft modal: FREE with SALVAGE+ stacks, otherwise 150S / 300S (+150S/use per draft).',
          'Once regular Protocols stack out in deep waves, MU-TH-UR offers 3 distinct repeatable ENDGAME DIRECTIVES: EMERGENCY ORDNANCE (+1 Purge + 250S), REACTOR OVERDRIVE (+5% Global OC & Turret DMG), and COMBAT TELEMETRY (+15% Permanent Score Multiplier)!',
        ],
      },
      {
        kind: 'heading',
        text: 'BOSS-MILESTONE OMEGA DIRECTIVES (AFTER W5 / W10 / W15 / W20)',
      },
      {
        kind: 'table',
        headers: ['CODE', 'OMEGA DIRECTIVE', 'HIGH-IMPACT UPSIDE', 'HIGH-RISK TRADE-OFF'],
        colFracs: [0.16, 0.23, 0.34, 0.27],
        rows: [
          { cols: ['Ω-OVERPRES', 'Volatile Overpressure', '+30% ALL Turret Fire Rate', '+35% Barrel Heat buildup'], accent: '#FF6622' },
          { cols: ['Ω-THRMSHK', 'Thermal Shock Detonation', 'Cryo/Rail vs Burning = 8% Max-HP blast (4s ICD)', 'Clears Burn & Cryo on trigger'], accent: '#00F0FF' },
          { cols: ['Ω-SAPPER', 'Breach Sapper Protocol', '+4 Mines/wave, +50% DMG, 4s Napalm, auto-seeds grates', 'Uses Boss Omega slot for ordnance'], accent: '#FFB000' },
          { cols: ['Ω-NIGHTOPT', 'Night-Hunter Optics', '+35% DMG in Darkness & 0% Dark Miss chance', 'Disables [L] Emergency Floodlight'], accent: '#D477FF' },
        ],
      },
      {
        kind: 'heading',
        text: 'STATION MUTATORS (+20% WAVE SCRAP & +50% WAVE SCORE!)',
      },
      {
        kind: 'table',
        headers: ['MUTATOR', 'EFFECT ON SECTOR', 'COUNTER-STRATEGY'],
        colFracs: [0.22, 0.39, 0.39],
        rows: [
          { cols: ['GRID BROWNOUT', 'Core sterile light radius halved (67px)', 'Deploy M314 Relays, Flares [F] & Floodlight [L]'], accent: '#FFB000' },
          { cols: ['ACIDIC SURGE', 'Bigger/longer Acid Pools (Spitters drop pools)', 'Incinerators farm 2X Sterilize Scrap goldmine!'], accent: '#B8FF3B' },
          { cols: ['SUB-FLOOR BREACH', 'ALL 4 Spawn Grates erupt with Skitterers', 'Mine grates [8] or cover with Arc Coils / Twin-Link'], accent: '#FF5522' },
          { cols: ['THERMAL SPIKE', '+28% Barrel Heat buildup; -35% Flush CD', 'Pair Cryo Cooler (320px aura) & spam [C] Flush'], accent: '#FF8833' },
        ],
      },
      {
        kind: 'heading',
        text: 'SECTOR EVOLUTION CADENCE (5W BREACH / 10W EXTRACTION)',
      },
      {
        kind: 'bullets',
        items: [
          { lead: 'WAVES 01–04 (SEC-01 MED-LAB · 32×18):', body: 'Learn lanes, first Protocol Draft after W3, Grid Brownout on W4. Check amber fracture lines during W5 Prep!', accent: '#44FF77' },
          { lead: 'WAVE 05 (HULL BREACH + CRUSHER + OMEGA #1):', body: 'First telegraphed AIR_SHAFT Hull Breach collapses into a new flank corridor! Beat the 960 HP Crusher to draft your first Boss OMEGA DIRECTIVE.', accent: '#FFB000' },
          { lead: 'WAVE 10 -> 11 (QUEEN BOSS -> SEC-02 EXTRACTION):', body: 'Defeat the Matriarch Queen & draft Omega #2. At Wave 11, all turrets auto-liquidate at 100% SCRAP and deploy into SEC-02 ATMOSPHERE PROCESSOR (36×20, off-center East Core, 3 asymmetric lanes)!', accent: '#00F0FF' },
          { lead: 'WAVE 15 / 20 -> 21 (BREACH + TWIN BOSS -> SEC-03):', body: 'Wave 15 opens a SEC-02 Hull Breach & deploys 2 Crushers (all 4 mutators seen by W15!). Wave 21 extracts at 100% Scrap into SEC-03 HIVE SUB-LEVEL (36×20, off-center West-South Core)! W31+ cycles Sectors indefinitely.', accent: '#FF5522' },
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 08: PRO KILLBOX DOCTRINE
  // =========================================================================
  {
    id: 'strategy',
    code: '08',
    shortTitle: 'PRO KILLBOX GUIDE',
    fullTitle: '08 // VETERAN USCM KILLBOX ARCHITECTURE & DEEP-WAVE PLAYBOOK',
    subtitle: 'MULTI-FRONT DEFENSE · DOOR DEFENSE · SECTOR EXTRACTIONS · HIGH SCORES',
    accent: '#44FF77',
    blocks: [
      {
        kind: 'heading',
        text: 'THE NEW DOCTRINE: LAYERED MULTI-FRONT DEFENSE (NO STATIC CHEESE)',
      },
      {
        kind: 'paragraph',
        text: 'Because Sappers (Spitters/Bursters) and Heavies actively attack welded Blast Doors, and trailing packs route around congested killboxes, pure 0-hit door-funneling is dead. Great commanders use 1–2 Blast Doors to shape tempo while defending forward junctions with balanced weapon synergies!',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'WAVES 01–04 OPENING (280S / 115 kW):',
            body: 'Anchor two primary lanes with UA 571-C Sentries [1] + an M314 Motion Relay [6] (aim its red Tripwire perpendicular across the choke!). Keep a Cryo Valve [4] or Arc-Shock Coil [5] on a forward Duct Grate with clean corridor LOS — never assume a grate works through bulkheads!',
            accent: '#44FF77',
          },
          {
            lead: 'WAVE 05 PREP (HULL BREACH & CRUSHER COUNTER):',
            body: 'Watch for pulsing amber fracture lines during W5 Prep — that AIR_SHAFT collapses into a live corridor on launch! Bring an M99 Rail-Lance [3], Arc Coil [5], or M18 Claymore [8] to hard-stagger the Crusher’s door-ramming charge (remember: Cryo only slows charge 30%!).',
            accent: '#FFB000',
          },
          {
            lead: 'MID-GAME SYNERGIES (WAVES 06–15):',
            body: 'Mix 1–2 Incinerators (Thermite armor melt + Acid sterilization Scrap) with Rail-Lances (Capacitor stagger / Overpen 12-pierce), Shock Coils (Tesla %HP scaling or EMP silence + armor shred!), Cryo Cooler MK-III (320px -20% heat / +15% ROF aura!), and Twin-Link or AP Sabot Sentries.',
            accent: '#00F0FF',
          },
          {
            lead: 'SECTOR EXTRACTION (W11 / W21 / W31) & LATE-GAME SINKS:',
            body: 'Before a Queen wave (W10/W20), spend Scrap boldly — Sector Extraction refunds 100% of all deployed turret & MK-IV Scrap on the next wave! Past W20, invest excess Scrap into MK-IV Overhaul Refits (450/700/1000S), Ordnance Resupply (+1 Purge / +6 Mines), and AUX_BUS Protocols to break past 295 kW up to 375 kW!',
            accent: '#FF6633',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'HIGH-SCORE LEADERBOARD SECRETS',
        lines: [
          '1. PROTECT YOUR FLAWLESS STREAK — 6+ flawless waves lock in 2.50x Score (3.75x on Mutator waves!). Draft AEGIS CORE BARRIER so one stray Skitterer never breaks your streak!',
          '2. MASTER [SPACE] TACTICAL PAUSE & [Z] 2X SPEED — Pause when Spawn Grates rattle (5s), when a Spitter targets a welded door, or when the Queen lays Egg Clutches (remember: [K] toggling a turret ON mid-wave takes 2.5s spin-up!).',
          '3. FARM AIRLOCK FLUSHES & STERILIZATION — Airlock Purge kills pay 2x Score (buy +1 Purge inline on [V] when spent for 250S+), while THERMITE Sterilize Scrap never decays in deep waves!',
        ],
      },
    ],
  },
];
