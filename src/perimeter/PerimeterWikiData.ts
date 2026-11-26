export interface WikiStatRow {
  cols: string[];
  accent?: string;
}

export type WikiBlock =
  | { kind: 'heading'; text: string; accent?: string }
  | { kind: 'paragraph'; text: string; accent?: string }
  | { kind: 'bullets'; items: Array<{ lead: string; body: string; accent?: string }> }
  | { kind: 'callout'; tone: 'tip' | 'warn' | 'combo'; title: string; lines: string[] }
  | { kind: 'formula'; title: string; expr: string; notes: string[] }
  | { kind: 'table'; headers: string[]; colFracs: number[]; rows: WikiStatRow[] };

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
    subtitle: 'OBJECTIVES · HARDPOINTS · ECONOMY · KEYBOARD & MOUSE INTERFACE',
    accent: '#44FF77',
    blocks: [
      {
        kind: 'heading',
        text: 'MISSION DIRECTIVE — ENDLESS HIVE SIEGE',
      },
      {
        kind: 'paragraph',
        text: "You command the automated perimeter defenses of Hadley's Hope (Sector 01 Med-Lab). Xenomorph waves erupt from 4 outer corner Breach Vents (VENT-01..04) and 4 internal Sub-Floor Grates (GRATE-01..04). Your single directive: stop them from breaching the central REACTOR CORE.",
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: '3 CORE BULKHEAD SEALS:',
            body: 'If any hostile reaches the Reactor Core, 1 Bulkhead Seal blows and triggers an emergency 160px inner shockwave clearing immediate stragglers. Lose all 3 seals and the sector falls. Blown seals can be rebuilt between waves for 480 Scrap (or via the SEAL FABRICATION Protocol).',
            accent: '#FFB000',
          },
          {
            lead: 'TWO RESOURCES (SCRAP & REACTOR kW):',
            body: 'SCRAP buys hardware, upgrades, door welds, claymores, ammo reloads, and Reactor expansions. REACTOR kW is your live electrical budget (starts at 115 kW). Every active turret draws kW; toggle units offline [P] or shed support [X] to manage power.',
            accent: '#44FF77',
          },
          {
            lead: 'PERFECT-WAVE STREAK & SCORING:',
            body: 'Clearing a wave without losing a Core Seal adds +0.25x to your Streak Multiplier (up to 2.50x at 6+ flawless waves!). Combined with Station Mutators (1.50x), your active score multiplier scales up to 3.75x!',
            accent: '#00F0FF',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'SECTOR 01 FLOOR TILE & HARDPOINT TYPES',
      },
      {
        kind: 'table',
        headers: ['TILE TYPE', 'VISUAL CUE', 'COMPATIBLE HARDWARE', 'TACTICAL ROLE'],
        colFracs: [0.22, 0.22, 0.28, 0.28],
        rows: [
          {
            cols: ['MOUNT PAD [+]', 'Square pad with + reticle', '[1] Sentry · [2] Incin · [3] Rail · [6] M314', 'Directional guns & radar relays'],
            accent: '#44FF77',
          },
          {
            cols: ['DUCT GRATE', 'Cross-hatched floor vent', '[4] Cryo Valve · [5] Arc-Shock Coil', '360° crowd-control & debuff zones'],
            accent: '#00F0FF',
          },
          {
            cols: ['BLAST DOOR', 'D-01 .. D-06 doorways', '[7] Arc-Weld Door Seal (max 3 active)', 'Seal corridors to reroute swarm path'],
            accent: '#FFB000',
          },
          {
            cols: ['CORRIDOR FLOOR', 'Open walkable tiles', '[8] M18 Proximity Claymore (max 8)', '0 kW emergency mines & blast traps'],
            accent: '#9EF5B8',
          },
          {
            cols: ['AIRLOCK CHAMBER', 'Orange dashed W-01/E-02/S-03', '[V] Airlock Vent Purge (1x per wave)', 'Decompression knockback & kill zone'],
            accent: '#FF8844',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'COMPLETE COMMANDER CONTROL REFERENCE',
      },
      {
        kind: 'table',
        headers: ['INPUT / KEY', 'ACTION', 'PRO TIP'],
        colFracs: [0.24, 0.38, 0.38],
        rows: [
          { cols: ['[1] – [8]', 'Select Hardware Build Tool', 'Hold SHIFT while placing to multi-deploy!'] },
          { cols: ['CLICK + DRAG', 'Place & aim directional turret cone', 'Magnetic snap locks onto pads within 48px'] },
          { cols: ['[R] / SHIFT+DRAG', 'Rotate preview or selected turret aim', 'Works mid-wave; servos slew smoothly'] },
          { cols: ['[SPACE]', 'Tactical Pause (build/aim while frozen!)', 'Use freely during boss fights & reloads'] },
          { cols: ['[E] / SHIFT+E', 'Rearm selected Sentry / Rearm ALL Sentries', 'Instant in Prep; 2.8s belt-feed mid-wave'] },
          { cols: ['[U] / [P] / [DEL]', 'Upgrade / Toggle Power / Recycle (65% refund)', 'Click any unit or Left Rack card to inspect'] },
          { cols: ['[F] / [O] / [V]', 'M40 Flare / Overclock (2x O quick!) / Airlock Purge', 'Double-tap [O] to Overclock selected turret'] },
          { cols: ['[L] / [C] / [X]', 'Floodlight (60% Bat) / Coolant Flush / Shed Aux', 'Instant map-wide engineering responses'] },
          { cols: ['SCROLL / WASD', 'Zoom (1.0x–2.5x) & Pan CAD Blueprint', 'Right/Mid-drag pans; quick Right-Click cancels'] },
          { cols: ['[H] / [TAB]', 'Open MU-TH-UR Wiki / System Command Menu', 'Pauses simulation automatically while open'] },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'MAGNETIC HARDPOINT SNAP & SMART DEFAULT AIM',
        lines: [
          'Every directional turret automatically aims upstream toward incoming enemy flow paths when hovering a pad.',
          'You can still fine-tune exact cone lanes by holding Left-Click and dragging out your desired line of fire, or pressing [R] in 45° increments.',
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
    subtitle: '55% DARK CONE · 100% LIT CRIT · LINE-OF-SIGHT · STALKER DECLOAK',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'DARKNESS VS. ILLUMINATION (THE TWO ARCS ON EVERY TURRET)',
      },
      {
        kind: 'paragraph',
        text: 'Notice every combat turret draws TWO range arcs: a bright SOLID INNER ARC (55% range) and a fainter DASHED OUTER ARC (100% range). Hadley corridors are dark unless actively lit by a sensor or thermal source.',
      },
      {
        kind: 'table',
        headers: ['TARGET STATE', 'ENGAGEMENT RANGE', 'ACCURACY', 'DAMAGE BONUS', 'STALKERS?'],
        colFracs: [0.22, 0.21, 0.19, 0.20, 0.18],
        rows: [
          {
            cols: ['UNLIT / DARK', '55% (Solid Inner Arc)', '80% (20% Dark Miss!)', '1.00x (Base)', 'INVISIBLE!'],
            accent: '#FFB000',
          },
          {
            cols: ['ILLUMINATED (LIT)', '100% (Full Dashed Cone)', '100% (Zero Miss!)', '+20% CRIT (+Optics)', 'DECLOAKED!'],
            accent: '#44FF77',
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
        title: 'DO COMBAT WEAPONS SHARE PASSIVE IR VISION?',
        lines: [
          'NO — passive turret IR cones (solid 55% inner arcs) do NOT mark targets as Illuminated for other turrets.',
          'An enemy inside Sentry A-02’s 55% cone is NOT unlocked for Rail-Lance R-01’s outer dashed 55–100% cone unless a true Illumination source hits it (M314 Relay, M40 Flare, Floodlight, Core Light, Napalm Burn, Cryo Plume, or Arc Coil).',
        ],
      },
      {
        kind: 'heading',
        text: 'ALL 8 ILLUMINATION SOURCES (HOW TO UNLOCK 100% RANGE + CRIT)',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'M314 MOTION RELAY SWEEP [6]:',
            body: 'Pulses a 465px (558px MK-II) radar wave every 1.55s (1.25s MK-III) that illuminates every hostile it crosses for 1.55s — revealing Stalkers and lighting corridors continuously!',
            accent: '#44FF77',
          },
          {
            lead: 'M314 RED LASER TRIPWIRE [6]:',
            body: 'Projects a continuous red laser up to 235px (7.8m) across a corridor to the opposite wall. Any hostile (including cloaked Stalkers!) crossing the beam is FULL-ILLUMINATED for 5.0 SECONDS and radar-pinned for 2.5s!',
            accent: '#FF5533',
          },
          {
            lead: 'M314 MK-III BRANCH A (FLOODLIGHT):',
            body: 'Upgrading an M314 to MK-III-A creates a PERMANENT 240px (8.0m) 360° bright white illumination halo — zero downtime even if a Screamer jams radar pulses!',
            accent: '#00F0FF',
          },
          {
            lead: 'M40 STROBE FLARE [F] (0 kW):',
            body: 'Free 0 kW tactical flare (15s CD) that lights a massive 255px radius for 12.0s (+4s per OPTICS+ Protocol). Essential early game & during Screamer jams.',
            accent: '#FFF0B8',
          },
          {
            lead: 'EMERGENCY FLOODLIGHT [L]:',
            body: 'Spends 60% Reserve Battery (20s CD) to light the ENTIRE MAP for 7.5s (+4s per OPTICS+). Unlocks 100% sniper range & crit on every turret simultaneously!',
            accent: '#00F0FF',
          },
          {
            lead: 'CORE LIGHT, NAPALM, CRYO & ARC COIL:',
            body: 'The Reactor Core has a 135px sterile light ring (halved during Grid Brownout). Burning hostiles (Napalm), chilled hostiles (Cryo), and zapped hostiles (Arc Coil — tags for 4.0s!) all count as Illuminated!',
            accent: '#FFB000',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'DEEP DIVE: M314 LASER TRIPWIRE & LINE-OF-SIGHT RULES',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'AIMING THE TRIPWIRE:',
            body: 'Unlike radar sweeps (which are 360°), the M314 Laser Tripwire aims along the direction you drag/rotate [R]. Aim it perpendicularly ACROSS a high-traffic choke hallway so every alien must step through it.',
            accent: '#FFB000',
          },
          {
            lead: 'TRIPWIRE ACID CORROSION:',
            body: 'Corrosive Acid Pools touching the tripwire midpoint drain Wire Integrity at -30%/sec. Below 20% integrity, the laser cuts out until acid clears (recalibrates automatically at +12%/sec). Sterilize acid with Napalm to keep tripwires alive!',
            accent: '#B8FF3B',
          },
          {
            lead: 'SCREAMER IMMUNITY:',
            body: 'Bio-Screamers jam M314 radial radar pulses for 3.4s, BUT the physical Laser Tripwire beam stays ACTIVE during radar jams!',
            accent: '#CC66FF',
          },
          {
            lead: 'TRUE WALL & DOOR LINE-OF-SIGHT:',
            body: 'Every turret raycasts true LOS. Solid bulkheads AND welded Blast Doors completely block turret vision and bullets. Unsealing a door immediately opens fire lanes; welding one blocks enemy movement AND your own shots through that doorway.',
            accent: '#8EF5AB',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 03: ORDNANCE & MK-III SPECIALIZATIONS
  // =========================================================================
  {
    id: 'ordnance',
    code: '03',
    shortTitle: 'ARSENAL & MK-III',
    fullTitle: '03 // COMPLETE 8-UNIT ORDNANCE SPECIFICATION & MK-III TREES',
    subtitle: 'STATS · RANGE · HEAT · RELOADS · ALL 12 BRANCHING SPECIALIZATIONS',
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
            cols: ['[1] UA 571-C', '100S / 22kW', '350px (11.7m) 60°', '16.5 (MK2: 22) / 0.088s', '320-rd drum (MK2: 440); 2 rds/burst; heat +2.6'],
            accent: '#44FF77',
          },
          {
            cols: ['[2] M240 INCIN', '125S / 26kW', '204px (6.8m) 76°', '56 DPS (MK2: 76) / 3.4s', 'Ignores armor; lights foes; sterilizes Acid Pools!'],
            accent: '#FFB000',
          },
          {
            cols: ['[3] M99 RAIL', '150S / 30kW', '540px (18.0m) 32°', '112 (MK2: 155) / 1.72s', '100% Armor Pierce; pierces 4 (MK2: 5) lined foes'],
            accent: '#00F0FF',
          },
          {
            cols: ['[4] CRYO VALVE', '80S / 14kW', '142px (4.7m) 360°', '58% Slow · +35% Shatter', 'Duct Grate; cancels Crusher charge; cools guns -24/s'],
            accent: '#9BF8FF',
          },
          {
            cols: ['[5] ARC COIL', '95S / 18kW', '168px (5.6m) 360°', '42 (MK2: 58) · 4 chains', 'Duct Grate; 0.68s stun; decloaks Stalkers (4s tag)'],
            accent: '#00F0FF',
          },
          {
            cols: ['[6] M314 RELAY', '65S / 10kW', '465px Sweep · 235px Wire', '0 DMG (Force Multiplier)', '+24% Range (all) & +18% Sentry DMG within 255px!'],
            accent: '#44FF77',
          },
          {
            cols: ['[7] DOOR SEAL', '55S / 0kW', 'Doorway (380 HP)', 'Max 3 Active Seals', 'Instant in Prep; 2.0s torch mid-wave; 4s repair CD'],
            accent: '#FFB000',
          },
          {
            cols: ['[8] M18 MINE', '35S / 0kW', '54px Trig · 152px Blast', '195 AOE DMG · 1.15s Stun', '0.6s arm; max 8; vaporizes Acid Pools & Egg Sacs!'],
            accent: '#FF8844',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'UPGRADE TIERS, BARREL HEAT & AMMO LOGISTICS',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'MK-II UNIVERSAL BOOST:',
            body: 'Costs 60–125 Scrap (0 extra kW!). Increases Range +12%, Damage ~+33%, Cooling Rate from 11.5/s to 16.0/s, Sentry Drum from 320 to 440 RDS (instant refill!), Rail Pierce 4 -> 5, Arc Chains 4 -> 5.',
            accent: '#44FF77',
          },
          {
            lead: 'THERMAL OVERHEAT LOCK:',
            body: 'If a turret reaches 100% HEAT, it enters THERMAL LOCK and cannot fire until cooled back down to 32% HEAT. Use nearby Cryo Valves (-24 to -46 Heat/sec) or [C] Coolant Flush (-78 Heat instant) to prevent lockouts!',
            accent: '#FF5533',
          },
          {
            lead: 'SENTRY REARM & RECYCLING:',
            body: 'Rearm cost scales proportionally to missing rounds (max 45S full empty). Instant during Prep; 2.8s offline belt-feed mid-wave (reduced by AUTOLOADER Protocol). Scrapping [DEL] refunds 65% of all invested Scrap.',
            accent: '#FFB000',
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
            cols: ['UA 571-C (240S / +4kW)', 'A: AP SABOT — +45% DMG, pierces 65% frontal armor', 'B: TWIN-LINK — 640-rd drum, +35% ROF (0.064s), knockback'],
            accent: '#44FF77',
          },
          {
            cols: ['M240 INCIN (250S / +4kW)', 'A: THERMITE — +65% burn DPS & +35% vs Heavy/Boss', 'B: FIREWALL — +45% cloud radius & 5.2s flame wall'],
            accent: '#FFB000',
          },
          {
            cols: ['M99 RAIL (280S / +6/+4kW)', 'A: OVERPEN — Infinite pierce, +40% DMG, 92% pen keep', 'B: CAPACITOR — -35% recharge (0.86s), 0.72s Boss stun!'],
            accent: '#00F0FF',
          },
          {
            cols: ['CRYO VALVE (190S / +2/0kW)', 'A: DEEP FREEZE — 72% slow & +55% Shatter bonus!', 'B: CRYO COOLER — 0 extra kW, 2x gun cooling aura & radius'],
            accent: '#9BF8FF',
          },
          {
            cols: ['ARC COIL (210S / +4/+2kW)', 'A: TESLA CHAIN — Chains 7 targets, +35% arc damage', 'B: EMP PULSE — 1.25s stun, slows Bosses 2.5s!'],
            accent: '#00F0FF',
          },
          {
            cols: ['M314 RELAY (175S / +4/+2kW)', 'A: FLOODLIGHT — Permanent 240px 360° bright lit halo', 'B: TGT MATRIX — Linked guns get +32% Range & +32% Crit!'],
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
    subtitle: 'FRONTAL DEFLECTION · FLANK CRITS · SHATTER · STERILIZATION · MATH',
    accent: '#FF6633',
    blocks: [
      {
        kind: 'heading',
        text: 'HEAVY DIRECTIONAL CARAPACE ARMOR (PRAETORIAN · CRUSHER · QUEEN)',
      },
      {
        kind: 'paragraph',
        text: 'Praetorians, Juggernaut Crushers, and the Matriarch Queen wear dense angled chitin on their heads. Firing a UA 571-C Pulse Sentry straight into their face triggers metallic RICOCHET deflection — slashing damage by 70%!',
      },
      {
        kind: 'table',
        headers: ['ATTACK ANGLE / WEAPON', 'MULTIPLIER', 'MECHANIC DETAILS'],
        colFracs: [0.30, 0.18, 0.52],
        rows: [
          {
            cols: ['Sentry -> Frontal Cone', '0.30x (-70%!)', 'Triggers sparks + RICOCHET! Unless using AP Sabot / DU Rounds'],
            accent: '#FF3318',
          },
          {
            cols: ['Sentry -> Side (90°)', '1.00x (Normal)', 'No deflection — clean full ballistic penetration'],
            accent: '#FFB000',
          },
          {
            cols: ['Sentry -> Flank / Rear', '1.40x (+40%!)', 'FLANK CRIT! Position crossfire Sentries behind killboxes!'],
            accent: '#44FF77',
          },
          {
            cols: ['AP Sabot MK-III + DU Proto', 'Up to 0.93x Front', 'AP Sabot pierces 65% armor + 25% per DU-10MM stack (cap 90%)'],
            accent: '#8EF5AB',
          },
          {
            cols: ['Rail / Incin / Arc / Mine', '100% BYPASS!', 'Completely ignores directional frontal carapace at all angles!'],
            accent: '#00F0FF',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'MULTIPLICATIVE DAMAGE STACKING FORMULAS',
      },
      {
        kind: 'formula',
        title: 'UA 571-C SENTRY SHOT DAMAGE',
        expr: 'DMG = Base(16.5|22) × Sabot(1.45) × DU(1+0.18n) × Relay(1.18) × LitCrit × Shatter × Armor/Flank',
        notes: [
          'LitCrit = 1.20 + (0.18 × OPTICS+ stacks) + (0.32 if linked to M314 MK-III TGT MATRIX)',
          'Shatter (vs Chilled Praetorian/Burster/Boss) = 1.35 (1.55 w/ Deep Freeze) + (0.25 × SHATTER+ stacks)',
          'Example: MK-III AP Sabot + M314 Matrix + Lit + Deep Freeze Flank Crit = 22 × 1.45 × 1.18 × 1.52 × 1.55 × 1.40 = 124 DMG PER BURST (~1,400 DPS)!',
        ],
      },
      {
        kind: 'formula',
        title: 'M99 RAIL-LANCE CORRIDOR PIERCE DAMAGE',
        expr: 'DMG = Base(112|155) × Overpen(1.40) × DU(1+0.18n) × LitCrit × Shatter × PierceFalloff',
        notes: [
          'PierceFalloff: 1.00x on 1st target, 0.78x on pierced targets #2–#5 (0.92x & infinite targets with MK-III OVERPEN!).',
          'Cryo-Shatter works on EVERY chilled enemy hit by the Rail beam (+35% + 25%/stack) — zero armor penalty!',
        ],
      },
      {
        kind: 'heading',
        text: 'HIGH-VALUE TACTICAL COMBOS (THE SECRET TO WAVE 15+)',
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 1: CRYO-SHATTER KILLBOX (CRYO VALVE + RAIL / SENTRY)',
        lines: [
          'Place a Cryo-Stasis Valve [4] on a corridor Duct Grate inside your Rail-Lance & Sentry firing lanes.',
          'Heavy targets slow by 58%–72%, take +35% to +130% SHATTER CRIT damage, Crusher charges instantly cancel, AND nearby gun barrels cool automatically!',
        ],
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 2: ACID STERILIZATION ECONOMY (M240 INCINERATOR VS. BURSTERS)',
        lines: [
          'Napalm clouds burn away green Acid Pools 4.2x faster — awarding +15 BONUS SCRAP (+20 extra per THERMITE Protocol, DOUBLED to +30/+70+ during ACIDIC SURGE!) and +75 Score per pool sterilized!',
          'Napalm also incinerates Queen Egg Sacs at 1.6x DPS (+12 Scrap each) before they hatch into Skitterer packs!',
        ],
      },
      {
        kind: 'callout',
        tone: 'combo',
        title: 'COMBO 3: AIRLOCK DECOMPRESSION FLUSH (+100% KILL SCORE)',
        lines: [
          'Triggering [V] Airlock Purge inside W-01 / E-02 / S-03 (plus 95px pad!) pushes enemies 290px backward (28% on Praetorians), stuns for 1.75s, wipes Acid Pools, deals 28–32 DMG, and pays DOUBLE score on decompression kills!',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 05: XENOMORPH BESTIARY
  // =========================================================================
  {
    id: 'bestiary',
    code: '05',
    shortTitle: 'XENO BESTIARY',
    fullTitle: '05 // USCM XENOMORPH BIOLOGICAL THREAT BESTIARY',
    subtitle: 'ALL 9 CASTES · HP SCALING · SPECIAL ABILITIES · HARD COUNTERS',
    accent: '#B8FF3B',
    blocks: [
      {
        kind: 'formula',
        title: 'WAVE HP SCALING FORMULA',
        expr: 'Waves 1–10: HP = BaseHP × (1 + (Wave-1) × 0.10)   |   Waves 11+: HP = BaseHP × (1.90 + (Wave-10) × 0.16)',
        notes: [
          'Wave 1 = 1.00x HP · Wave 5 = 1.40x HP · Wave 10 = 1.90x HP · Wave 15 = 2.70x HP · Wave 20 = 3.50x HP.',
        ],
      },
      {
        kind: 'heading',
        text: 'COMPLETE HOSTILE CLASSIFICATION TABLE',
      },
      {
        kind: 'table',
        headers: ['CASTE', 'BASE HP / SPD', 'DOOR DPS / SCRAP', 'ABILITY & THREAT', 'BEST COUNTER'],
        colFracs: [0.16, 0.15, 0.15, 0.29, 0.25],
        rows: [
          {
            cols: ['SKITTERER (SKT)', '26 HP · 120 px/s', '12 DPS · 3S', 'Weaves erratically; erupts from Floor Grates (5s rattle warning)', 'Arc Coil · Incinerator · Twin-Link'],
            accent: '#8EF5AB',
          },
          {
            cols: ['XENO DRONE', '90 HP · 88 px/s', '24 DPS · 8S', 'Standard corridor pack hunter; drains Sentry ammo fast', 'UA 571-C Sentry · M99 Rail line'],
            accent: '#44FF77',
          },
          {
            cols: ['ACID BURSTER', '118 HP · 68 px/s', '28 DPS · 13S', 'Explodes on death -> 88px Acid Pool (9s) melts doors/wires!', 'Incinerator (Sterilize!) · Claymore'],
            accent: '#B8FF3B',
          },
          {
            cols: ['SIGNAL STALKER', '98 HP · 96 px/s', '26 DPS · 15S', '100% INVISIBLE to turret IR cones in darkness! Walks past guns!', 'M314 Tripwire/Sweep · Flare · Arc'],
            accent: '#00F0FF',
          },
          {
            cols: ['ACID SPITTER', '128 HP · 64 px/s', '36 DPS · 18S', 'Spits acid (265px LOS): -35% turret ROF & +24 Heat; 55 door DMG', '[C] Coolant Flush · Rail Sniper'],
            accent: '#B8FF3B',
          },
          {
            cols: ['BIO-SCREAMER', '142 HP · 74 px/s', '24 DPS · 22S', 'Jams M314 radar sweeps (300px / 3.4s) + spawns 3 phantom blips', 'Arc Coil (+3.5s CD!) · Flare · Rail'],
            accent: '#CC66FF',
          },
          {
            cols: ['PRAETORIAN', '460 HP · 48 px/s', '68 DPS · 32S', '70% Frontal Armor deflection! Crushes welded doors rapidly', 'Rail-Lance · Cryo+Flank · Napalm'],
            accent: '#FFB000',
          },
          {
            cols: ['★ CRUSHER (W5)', '1120 HP · 44 px/s', '135 DPS · 95S', 'BOSS: 70% armor; telegraphs 1s -> 2.55x Charge (2.4x door DMG!)', 'Cryo/Arc/Cap-Rail cancels charge!'],
            accent: '#FF5522',
          },
          {
            cols: ['★ QUEEN (W10)', '2650 HP · 34 px/s', '210 DPS · 240S', 'BOSS: 70% armor; lays double Egg Clutches at 75% & 40% HP (hatch 3 SKT!)', 'Napalm/Claymore eggs + Rail/Sabot'],
            accent: '#FF3318',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: 'SUB-FLOOR GRATE 5-SECOND BREACH TELEGRAPH',
        lines: [
          'Auxiliary Floor Grates (GRATE-01..04) ALWAYS rattle with amber sparks, intercom warning, and a 5.0-second countdown BEFORE Skitterers erupt inside your perimeter.',
          'Hit [SPACE] immediately when you hear the metallic rattle! Drop an M18 Claymore (35S, 0 kW) on the grate or rotate a nearby Sentry/Incinerator to wipe the entire swarm on emergence.',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 06: REACTOR, BATTERY & COMMAND ABILITIES
  // =========================================================================
  {
    id: 'reactor',
    code: '06',
    shortTitle: 'REACTOR & SKILLS',
    fullTitle: '06 // REACTOR BUS, RESERVE BATTERY & ACTIVE SYSTEMS',
    subtitle: 'kW BUDGET · BATTERY BUFFERING · BLACKOUTS · ALL 6 COMMAND SKILLS',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'REACTOR kW CAPACITY, OVERLOADS & RESERVE BATTERY',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'REACTOR SCALING (115 kW -> 360 kW):',
            body: 'You start at 115 kW. Clearing every EVEN wave (W2, W4, W6...) automatically unlocks +15 kW up to 205 kW. You can also buy +15 kW Capacitor Expansions on the left panel (220S, +120S each step) or draft +20 kW AUX BUS Protocols all the way to the 360 kW hard cap!',
            accent: '#00F0FF',
          },
          {
            lead: 'RESERVE BATTERY CHARGING:',
            body: 'During active waves, unused Free kW charges your cyan Reserve Battery (1.15% to 3.75%/sec, boosted +50% per CAP-DRIVE Protocol). Keep ~15–25 kW free if you want fast Floodlight cycling!',
            accent: '#44FF77',
          },
          {
            lead: 'OVERLOAD BUFFERING & 3.5S BLACKOUT:',
            body: 'Ability power surges (Overclock +22 kW, Coolant Flush +10 kW) can push load over max kW. Reserve Battery automatically drains at -26%/sec to absorb overloads safely! Only if Battery hits 0% AND overload persists for 4.0 seconds does the Main Breaker trip — causing a 3.5-second TOTAL SECTOR BLACKOUT (all guns, lights & radar offline!).',
            accent: '#FF3318',
          },
        ],
      },
      {
        kind: 'heading',
        text: 'ALL 6 ACTIVE COMMAND & ENGINEERING SYSTEMS',
      },
      {
        kind: 'table',
        headers: ['KEY / SYSTEM', 'COST / COOLDOWN', 'DURATION / SURGE', 'EFFECT & BEST TIMING'],
        colFracs: [0.19, 0.19, 0.19, 0.43],
        rows: [
          {
            cols: ['[F] M40 FLARE', '0 kW · 15s CD', '12.0s (+4s Optics)', 'Lights 255px radius (100% range, +20% crit, decloaks Stalkers)'],
            accent: '#FFF0B8',
          },
          {
            cols: ['[O] OVERCLOCK', '+22 kW · 22s CD', '8.0s (+2.5s Cap)', '265px zone: 2x fire rate & 2x servo turn! Double-tap [O] on selected gun'],
            accent: '#FFB000',
          },
          {
            cols: ['[V] AIRLOCK PURGE', '0 kW · 1x / Wave', 'Instant Blast', 'Click W-01 / E-02 / S-03: 290px push, 1.75s stun, acid clear, 2x kill score'],
            accent: '#44FF77',
          },
          {
            cols: ['[L] FLOODLIGHT', '60% Bat · 20s CD', '7.5s (+4s Optics)', 'Instant MAP-WIDE full illumination! Shreds Stalker waves & bosses'],
            accent: '#00F0FF',
          },
          {
            cols: ['[C] COOL FLUSH', '+10 kW · 20s CD', '1.6s Surge', 'Instantly vents -78 Heat, clears Thermal Lock, washes off Spitter Acid!'],
            accent: '#9BF8FF',
          },
          {
            cols: ['[X] SHED AUX', '0 kW · Instant', 'Toggle On/Off', 'Cuts power to all Relays/Cryo/Coils immediately to stop an Overload trip!'],
            accent: '#FFB000',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'PRO BATTERY TRICK: SAFE OVERCLOCKING',
        lines: [
          'As long as you have ~25%+ Reserve Battery, you can safely fire [O] Overclock even with 0 Free kW — the Battery absorbs the +22 kW surge without tripping the breaker!',
          'If Battery runs dry mid-surge, tap [X] Shed Aux for 2 seconds to instantly drop overload back to zero and avoid a deadly 3.5s Blackout.',
        ],
      },
    ],
  },

  // =========================================================================
  // CHAPTER 07: PROTOCOLS, MUTATORS & WAVE ROADMAP
  // =========================================================================
  {
    id: 'progression',
    code: '07',
    shortTitle: 'PROTOCOLS & WAVES',
    fullTitle: '07 // MU-TH-UR PROTOCOLS, STATION MUTATORS & WAVE ROADMAP',
    subtitle: 'EVERY 3 WAVES DRAFT · +50% MUTATORS · BOSS SCHEDULE (W5 / W10+)',
    accent: '#00F0FF',
    blocks: [
      {
        kind: 'heading',
        text: 'ALL 10 MU-TH-UR TACTICAL PROTOCOLS (DRAFTED EVERY 3 WAVES)',
      },
      {
        kind: 'table',
        headers: ['CODE', 'PROTOCOL NAME', 'PERMANENT EFFECT PER STACK', 'MAX'],
        colFracs: [0.16, 0.28, 0.48, 0.08],
        rows: [
          { cols: ['DU-10MM', 'Depleted Uranium Rounds', '+18% Sentry & Rail DMG · +25% Frontal Armor Pierce', '4'], accent: '#FFB000' },
          { cols: ['AUTO-BELT', 'Autoloader Belt Feeds', '-45% Rearm Time (down to 0.85s) · -35% Rearm Cost', '2'], accent: '#44FF77' },
          { cols: ['+20kW BUS', 'Auxiliary Reactor Capacitor', '+20 kW Max Power Capacity immediately (to 360 kW)', '5'], accent: '#00F0FF' },
          { cols: ['SHATTER+', 'Cryo-Shatter Resonance', '+25% Shatter Crit DMG · +20% Cryo & Arc Coil radius', '3'], accent: '#9BF8FF' },
          { cols: ['THERMITE', 'Thermite Napalm Catalyst', '+30% Burn DPS · +20 extra Scrap per Acid Sterilize', '3'], accent: '#FF7733' },
          { cols: ['OPTICS+', 'High-Gain Thermal Optics', '+18% Illuminated Crit · +4s Flare & Floodlight dur', '3'], accent: '#FFF6CC' },
          { cols: ['CAP-DRIVE', 'Reserve Battery Overdrive', '+50% Battery Charge Rate · +2.5s Overclock dur', '3'], accent: '#44FFDD' },
          { cols: ['SALVAGE+', 'Weyland Salvage Requisition', '+22% Scrap from all kills and wave bonuses', '3'], accent: '#FFB000' },
          { cols: ['DOOR-ARMOR', 'Reinforced Bulkhead Plating', '+45% Door Seal HP · +1 Max simultaneous welded door', '2'], accent: '#8EF5AB' },
          { cols: ['+1 SEAL', 'Emergency Core Seal Fab', 'Immediately restores +1 blown Reactor Core Seal', '∞'], accent: '#44FF77' },
        ],
      },
      {
        kind: 'heading',
        text: 'STATION MUTATORS (EVERY 4TH WAVE · +50% WAVE SCORE!)',
      },
      {
        kind: 'table',
        headers: ['MUTATOR', 'EFFECT ON SECTOR 01', 'COUNTER-STRATEGY'],
        colFracs: [0.22, 0.39, 0.39],
        rows: [
          { cols: ['GRID BROWNOUT', 'Core sterile light radius halved (67px)', 'Deploy M314 Relays, Flares [F] & Floodlight [L]'], accent: '#FFB000' },
          { cols: ['ACIDIC SURGE', 'Bigger/longer Acid Pools (Spitters drop pools too!)', 'Incinerators farm 2X Sterilize Scrap goldmine!'], accent: '#B8FF3B' },
          { cols: ['SUB-FLOOR BREACH', 'ALL 4 Floor Grates erupt with Skitterers', 'Mine grates [8] or cover with Arc Coils / Incin'], accent: '#FF5522' },
          { cols: ['THERMAL SPIKE', '+28% Barrel Heat buildup; -35% Flush CD', 'Pair Cryo Cooler MK-III & spam [C] Coolant Flush'], accent: '#FF8833' },
        ],
      },
      {
        kind: 'heading',
        text: 'ENDLESS HIVE SIEGE MILESTONE TIMELINE',
      },
      {
        kind: 'bullets',
        items: [
          { lead: 'WAVES 01–03:', body: 'Drones, Skitterers, Floor Grates, first Stalkers (W2) & Acid Bursters (W3). First Protocol Draft after Wave 03!', accent: '#44FF77' },
          { lead: 'WAVE 04 (GRID BROWNOUT):', body: '6 Signal Stalkers attack under halved core light. Have an M314 Relay or [F] Flares ready!', accent: '#FFB000' },
          { lead: 'WAVE 05 (MINI-BOSS):', body: 'JUGGERNAUT CRUSHER Vanguard + Praetorian! Bring Cryo Valve + Rail-Lance or Arc Coil to cancel its charge.', accent: '#FF5522' },
          { lead: 'WAVES 06–09:', body: 'Acid Spitters (W6), Bio-Screamer radar jammers (W7), Acidic Surge Phalanx (W8), Stalker+Screamer packs (W9).', accent: '#B8FF3B' },
          { lead: 'WAVE 10 (MATRIARCH QUEEN):', body: '2,650 × 1.9 = 5,035 HP Boss + Egg Clutches at 75% & 40% HP! Surviving awards +1,500 PTS × intact seals. Deep Endless Siege escalates indefinitely (Crusher W15, 2x Queens W20, etc.)!', accent: '#FF3318' },
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
    subtitle: 'OPENING BUILD ORDER · FUNNELING · WAVE 5/10 PREP · HIGH-SCORE RUNS',
    accent: '#44FF77',
    blocks: [
      {
        kind: 'heading',
        text: 'THE GOLDEN RULE: FUNNEL FOUR CORRIDORS INTO TWO KILLBOXES',
      },
      {
        kind: 'paragraph',
        text: 'Never spread turrets thinly around the outer perimeter! Aliens always follow the shortest open flow path (shown by the dashed green/amber lines). Sealing just 2 Blast Doors collapses 4 separate approaches into 2 concentrated meat-grinder corridors right beside the Core!',
      },
      {
        kind: 'bullets',
        items: [
          {
            lead: 'STEP 1 (WAVE 01 OPENING — 280 SCRAP / 115 kW):',
            body: 'Deploy 1× UA 571-C Sentry on the West Core bastion aimed West, 1× UA 571-C on the East/South bastion, and weld D-03 (North Med) or D-06 (South Duct) with [7] Arc-Welder (55S) to force North/South lanes sideways into your horizontal approaches!',
            accent: '#44FF77',
          },
          {
            lead: 'STEP 2 (WAVE 02–03 — LIGHT & SHATTER):',
            body: 'Add an M314 Motion Relay [6] (65S / 10kW) within 255px of your main Sentries (+24% Range, +18% DMG, radar sweeps, AND aim its red Laser Tripwire directly across the choke!). Add a Cryo Valve [4] on a central Duct Grate.',
            accent: '#00F0FF',
          },
          {
            lead: 'STEP 3 (WAVE 04–05 — CRUSHER KILLER):',
            body: 'Deploy an M99 Rail-Lance [3] aiming straight down your longest straightaway (West or East Junction) — it pierces 4 lined-up hostiles and ignores the Crusher’s 70% armor! Place an M240 Incinerator [2] near your killbox to farm Acid Pool sterilization Scrap.',
            accent: '#FFB000',
          },
          {
            lead: 'STEP 4 (WAVE 06–10 — MK-III SYNERGY FOR THE QUEEN):',
            body: 'Upgrade your core killbox to MK-III before Wave 10: Rail-Lance (CAPACITOR staggers Bosses OR OVERPEN deletes entire hallways), Sentry (AP SABOT vs bosses + TWIN-LINK vs Skitterers), M314 (TGT MATRIX +32% Crit!), Cryo (DEEP FREEZE +55% Shatter), Incinerator (THERMITE melts the Queen & burns her Egg Clutches!).',
            accent: '#FF6633',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'HIGH-SCORE LEADERBOARD SECRETS',
        lines: [
          '1. NEVER LOSE A SEAL EARLY — keeping a 6-wave flawless streak locks in 2.50x Score on EVERY kill & wave clear (3.75x on Mutator waves!).',
          '2. USE [SPACE] TACTICAL PAUSE RELIGIOUSLY — pause when Grates rattle, when a Sentry hits 25% ammo, or when a Queen lays Egg Clutches so you react with zero wasted frames.',
          '3. STERILIZE ACID POOLS & FLUSH AIRLOCKS — Incinerator sterilization funds your MK-III economy, and Airlock Decompression Kills pay 2x score!',
        ],
      },
    ],
  },
];
