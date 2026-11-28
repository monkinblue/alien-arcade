import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const APPROACH_AUDIO_OUT_DIR = path.join(ROOT_DIR, 'public', 'audio', 'approach');
const APPROACH_MANIFEST_PATH = path.join(APPROACH_AUDIO_OUT_DIR, 'manifest.json');

const API_BASE = 'https://api.elevenlabs.io/v1';

type RadioVoiceRole =
  | 'pilot_viper'
  | 'pilot_heavy'
  | 'pilot_female'
  | 'atc_controller'
  | 'pilot_aus_scott'
  | 'pilot_aus_bushfire'
  | 'pilot_aus_baxter'
  | 'pilot_aus_lisa'
  | 'pilot_aus_campbell';

type CompassSectorLower = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface VoiceRoleMeta {
  voiceId: string;
  label: string;
  accent: string;
  gender: 'male' | 'female';
}

/**
 * Curated 9-voice tactical RAPCON cast:
 * - Preserves the 4 original voices (Charlie [AU], Brian [US], Sarah [US], Daniel [UK ATC]).
 * - Expands with 5 verified Australian / Aussie-Kiwi pilot voices (3 gritty/tactical males + 2 confident females)
 *   so 6 of 8 pilot roles deliver authentic Australian frontier-colony ATC radio chatter.
 */
const CURATED_VOICE_CAST: Readonly<Record<RadioVoiceRole, VoiceRoleMeta>> = {
  pilot_viper: {
    voiceId: 'IKne3meq5aSn9XLyUdCD',
    label: 'Charlie (Australian — Deep, Confident, Energetic)',
    accent: 'australian',
    gender: 'male',
  },
  pilot_heavy: {
    voiceId: 'nPczCjzI2devNBz1zQrb',
    label: 'Brian (American — Deep, Resonant)',
    accent: 'american',
    gender: 'male',
  },
  pilot_female: {
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    label: 'Sarah (American — Mature, Confident)',
    accent: 'american',
    gender: 'female',
  },
  atc_controller: {
    voiceId: 'onwK4e9ZLuTAKqWW03F9',
    label: 'Daniel (British — Steady RAPCON Broadcaster)',
    accent: 'british',
    gender: 'male',
  },
  pilot_aus_scott: {
    voiceId: 'nrJUVBFMXWTXwnrZS469',
    label: 'Aussie Scott (Australian — Husky Frontier Pilot)',
    accent: 'australian',
    gender: 'male',
  },
  pilot_aus_bushfire: {
    voiceId: 'N7NFVAFf0wbs2119L2Ai',
    label: 'The Bushfire (Australian — Gravely Baritone)',
    accent: 'australian',
    gender: 'male',
  },
  pilot_aus_baxter: {
    voiceId: 'jSuBIjxMKhqIfb0wCK1F',
    label: 'Baxter (Australian/NZ — Dry Calm Tactical)',
    accent: 'australian',
    gender: 'male',
  },
  pilot_aus_lisa: {
    voiceId: 'bG3bxTbEPR7EZE4M0kcC',
    label: 'Lisa (Australian — Assertive, Calm Female)',
    accent: 'australian',
    gender: 'female',
  },
  pilot_aus_campbell: {
    voiceId: 'hDDVQ367GcLJqyWXSicj',
    label: 'Campbell (Australian-Kiwi — Confident Female)',
    accent: 'australian',
    gender: 'female',
  },
};

interface ApproachVoiceAsset {
  filename: string;
  text: string;
  role: RadioVoiceRole;
  urgent?: boolean;
}

interface ApproachSfxAsset {
  filename: string;
  prompt: string;
  durationSeconds: number;
  promptInfluence: number;
}

type ApproachManifestAsset =
  | {
      path: string;
      category: 'voice';
      role: RadioVoiceRole;
      voiceId: string;
      text: string;
      bytes: number;
    }
  | {
      path: string;
      category: 'sfx';
      prompt: string;
      bytes: number;
    };

interface ApproachAudioManifest {
  version: number;
  generatedAt: string | null;
  voiceId: string | null;
  voiceCast: Partial<Record<RadioVoiceRole, string>>;
  assets: Record<string, ApproachManifestAsset>;
}

const COMPASS_SECTORS: ReadonlyArray<{ key: CompassSectorLower; spoken: string }> = [
  { key: 'n', spoken: 'north' },
  { key: 'ne', spoken: 'northeast' },
  { key: 'e', spoken: 'east' },
  { key: 'se', spoken: 'southeast' },
  { key: 's', spoken: 'south' },
  { key: 'sw', spoken: 'southwest' },
  { key: 'w', spoken: 'west' },
  { key: 'nw', spoken: 'northwest' },
];

const PAD_SECTOR_ROLES: Readonly<Record<CompassSectorLower, RadioVoiceRole>> = {
  n: 'pilot_viper',
  ne: 'pilot_aus_scott',
  e: 'pilot_aus_baxter',
  se: 'pilot_aus_campbell',
  s: 'pilot_female',
  sw: 'pilot_aus_lisa',
  w: 'pilot_aus_scott',
  nw: 'pilot_viper',
};

const CRADLE_SECTOR_ROLES: Readonly<Record<CompassSectorLower, RadioVoiceRole>> = {
  n: 'pilot_aus_bushfire',
  ne: 'pilot_aus_scott',
  e: 'pilot_heavy',
  se: 'pilot_aus_baxter',
  s: 'pilot_aus_lisa',
  sw: 'pilot_aus_bushfire',
  w: 'pilot_aus_scott',
  nw: 'pilot_aus_campbell',
};

const MEDEVAC_SECTOR_ROLES: Readonly<Record<CompassSectorLower, RadioVoiceRole>> = {
  n: 'pilot_aus_campbell',
  ne: 'pilot_aus_lisa',
  e: 'pilot_female',
  se: 'pilot_aus_campbell',
  s: 'pilot_aus_baxter',
  sw: 'pilot_aus_lisa',
  w: 'pilot_viper',
  nw: 'pilot_aus_campbell',
};

const TWOSHIP_SECTOR_ROLES: Readonly<Record<CompassSectorLower, RadioVoiceRole>> = {
  n: 'pilot_aus_baxter',
  ne: 'pilot_viper',
  e: 'pilot_aus_scott',
  se: 'pilot_aus_lisa',
  s: 'pilot_female',
  sw: 'pilot_aus_campbell',
  w: 'pilot_aus_baxter',
  nw: 'pilot_viper',
};

const RUNWAY_CHECKIN_DEFS: ReadonlyArray<{
  rwy: '27' | '09' | '36' | '18';
  spoken: string;
  roles: Readonly<Record<CompassSectorLower, RadioVoiceRole>>;
}> = [
  {
    rwy: '27',
    spoken: 'Two-Seven',
    roles: {
      n: 'pilot_aus_bushfire',
      ne: 'pilot_aus_lisa',
      e: 'pilot_heavy',
      se: 'pilot_aus_scott',
      s: 'pilot_aus_baxter',
      sw: 'pilot_aus_campbell',
      w: 'pilot_aus_bushfire',
      nw: 'pilot_female',
    },
  },
  {
    rwy: '09',
    spoken: 'Zero-Niner',
    roles: {
      n: 'pilot_aus_lisa',
      ne: 'pilot_aus_scott',
      e: 'pilot_aus_baxter',
      se: 'pilot_aus_campbell',
      s: 'pilot_heavy',
      sw: 'pilot_aus_bushfire',
      w: 'pilot_aus_lisa',
      nw: 'pilot_aus_bushfire',
    },
  },
  {
    rwy: '36',
    spoken: 'Three-Six',
    roles: {
      n: 'pilot_aus_baxter',
      ne: 'pilot_aus_campbell',
      e: 'pilot_aus_scott',
      se: 'pilot_aus_bushfire',
      s: 'pilot_aus_lisa',
      sw: 'pilot_heavy',
      w: 'pilot_female',
      nw: 'pilot_viper',
    },
  },
  {
    rwy: '18',
    spoken: 'One-Eight',
    roles: {
      n: 'pilot_aus_scott',
      ne: 'pilot_aus_lisa',
      e: 'pilot_aus_campbell',
      se: 'pilot_heavy',
      s: 'pilot_aus_bushfire',
      sw: 'pilot_aus_baxter',
      w: 'pilot_female',
      nw: 'pilot_aus_bushfire',
    },
  },
];

const APPROACH_VOICE_ASSETS: ApproachVoiceAsset[] = [
  // 1. Iconic shift-start check-ins (exact starter callsigns & sectors)
  {
    filename: 'checkin_viper_21_n.mp3',
    text: 'Viper Two-One, north, inbound, Pad Alpha.',
    role: 'pilot_viper',
  },
  {
    filename: 'checkin_atlas_7_e.mp3',
    text: 'Atlas Seven, east, inbound, ILS Two-Seven.',
    role: 'pilot_heavy',
  },

  // 2. Dropship check-ins -> Pad Alpha (all 8 compass sectors)
  ...COMPASS_SECTORS.map(
    (s): ApproachVoiceAsset => ({
      filename: `checkin_pad_${s.key}.mp3`,
      text: `Dropship, ${s.spoken}, inbound, Pad Alpha.`,
      role: PAD_SECTOR_ROLES[s.key],
    })
  ),

  // 3. Heavy ore hauler check-ins -> ALL 4 runways (27, 09, 36, 18) x ALL 8 compass sectors
  ...RUNWAY_CHECKIN_DEFS.flatMap((r) =>
    COMPASS_SECTORS.map(
      (s): ApproachVoiceAsset => ({
        filename: `checkin_rwy${r.rwy}_${s.key}.mp3`,
        text: `Heavy, ${s.spoken}, inbound, ILS ${r.spoken}.`,
        role: r.roles[s.key],
      })
    )
  ),

  // 4. Salvage tug check-ins -> Salvage Cradle (all 8 compass sectors)
  ...COMPASS_SECTORS.map(
    (s): ApproachVoiceAsset => ({
      filename: `checkin_cradle_${s.key}.mp3`,
      text: `Salvage tug, ${s.spoken}, inbound, Salvage Cradle.`,
      role: CRADLE_SECTOR_ROLES[s.key],
    })
  ),

  // 5. MEDEVAC priority check-ins (all 8 compass sectors)
  ...COMPASS_SECTORS.map(
    (s): ApproachVoiceAsset => ({
      filename: `checkin_medevac_${s.key}.mp3`,
      text: `Medevac, ${s.spoken}, priority inbound.`,
      role: MEDEVAC_SECTOR_ROLES[s.key],
      urgent: true,
    })
  ),

  // 6. Two-ship dropship element check-ins (all 8 compass sectors)
  ...COMPASS_SECTORS.map(
    (s): ApproachVoiceAsset => ({
      filename: `checkin_twoship_${s.key}.mp3`,
      text: `Two-ship, ${s.spoken}, inbound, Pad Alpha.`,
      role: TWOSHIP_SECTOR_ROLES[s.key],
    })
  ),

  // 7. Crisp vector acknowledgments (voice-matched across Aussie cast)
  {
    filename: 'vector_ack_viper.mp3',
    text: 'Roger, turning.',
    role: 'pilot_viper',
  },
  {
    filename: 'vector_ack_scott.mp3',
    text: 'Wilco, new heading.',
    role: 'pilot_aus_scott',
  },
  {
    filename: 'vector_ack_bushfire.mp3',
    text: 'Copy, on the vector.',
    role: 'pilot_aus_bushfire',
  },
  {
    filename: 'vector_ack_baxter.mp3',
    text: 'Roger, tracking vector.',
    role: 'pilot_aus_baxter',
  },
  {
    filename: 'vector_ack_lisa.mp3',
    text: 'Copy, turning inbound.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'vector_ack_campbell.mp3',
    text: 'Wilco, coming around.',
    role: 'pilot_aus_campbell',
  },

  // 8. Localizer / approach locks (exact runway numbers + Pad Alpha + Salvage Cradle)
  {
    filename: 'loc_rwy_27.mp3',
    text: 'Established, Two-Seven.',
    role: 'pilot_heavy',
  },
  {
    filename: 'loc_rwy_27_aus.mp3',
    text: 'Established, Two-Seven.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'loc_rwy_09.mp3',
    text: 'Established, Zero-Niner.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'loc_rwy_09_aus.mp3',
    text: 'Established, Zero-Niner.',
    role: 'pilot_aus_bushfire',
  },
  {
    filename: 'loc_rwy_36.mp3',
    text: 'Established, Three-Six.',
    role: 'pilot_aus_bushfire',
  },
  {
    filename: 'loc_rwy_18.mp3',
    text: 'Established, One-Eight.',
    role: 'pilot_heavy',
  },
  {
    filename: 'loc_pad_alpha.mp3',
    text: 'Inbound final, Pad Alpha.',
    role: 'pilot_viper',
  },
  {
    filename: 'loc_pad_alpha_aus.mp3',
    text: 'Locked on, Pad Alpha.',
    role: 'pilot_aus_campbell',
  },
  {
    filename: 'loc_cradle.mp3',
    text: 'Locked on, Salvage Cradle.',
    role: 'pilot_aus_scott',
  },

  // 9. RNAV holding fix entries (exact fix names: KRATO, BOREA, VEXIS)
  {
    filename: 'hold_krato.mp3',
    text: 'Holding Krato, right turns.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'hold_borea.mp3',
    text: 'Holding Borea, right turns.',
    role: 'pilot_aus_baxter',
  },
  {
    filename: 'hold_vexis.mp3',
    text: 'Holding Vexis, right turns.',
    role: 'pilot_aus_scott',
  },

  // 10. Outbound departures / launches (all 4 runways + airborne handoff)
  {
    filename: 'dep_rolling_27.mp3',
    text: 'Cleared takeoff, Two-Seven, rolling.',
    role: 'pilot_aus_baxter',
  },
  {
    filename: 'dep_rolling_09.mp3',
    text: 'Cleared takeoff, Zero-Niner, rolling.',
    role: 'pilot_aus_scott',
  },
  {
    filename: 'dep_rolling_36.mp3',
    text: 'Cleared takeoff, Three-Six, rolling.',
    role: 'pilot_viper',
  },
  {
    filename: 'dep_rolling_18.mp3',
    text: 'Cleared takeoff, One-Eight, rolling.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'dep_airborne.mp3',
    text: 'Airborne, switching departure.',
    role: 'pilot_aus_campbell',
  },

  // 11. Go-arounds (unstable approach, missed approach, manual wave-off)
  {
    filename: 'go_around_unstable.mp3',
    text: 'Going around, unstable!',
    role: 'pilot_viper',
    urgent: true,
  },
  {
    filename: 'go_around_missed.mp3',
    text: 'Missed approach, going around!',
    role: 'pilot_aus_bushfire',
    urgent: true,
  },
  {
    filename: 'go_around_waveoff.mp3',
    text: 'Copy wave-off, climbing out.',
    role: 'pilot_aus_lisa',
    urgent: true,
  },

  // 12. ATC weather, MOA restricted-zone, and bogey warnings
  {
    filename: 'wx_ion_storm.mp3',
    text: 'All aircraft, ion static on scope, expect comms jam.',
    role: 'atc_controller',
  },
  {
    filename: 'warn_moa_r118.mp3',
    text: 'Warning! Restricted zone Romeo One-Eighteen, turn out immediately!',
    role: 'atc_controller',
    urgent: true,
  },
  {
    filename: 'warn_bogey.mp3',
    text: 'All aircraft, primary target, no transponder, watch separation.',
    role: 'atc_controller',
  },

  // 13. ATIS runway flips & crosswind openings (all single + dual active runway combinations)
  {
    filename: 'atis_flip_27.mp3',
    text: 'Borealis ATIS, wind two-seven-zero, Runway Two-Seven active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_09.mp3',
    text: 'Borealis ATIS, wind zero-niner-zero, Runway Zero-Niner active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_36.mp3',
    text: 'Borealis ATIS, crosswind ops, Runway Three-Six now active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_18.mp3',
    text: 'Borealis ATIS, crosswind ops, Runway One-Eight now active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_27_36.mp3',
    text: 'Borealis ATIS, wind three-zero-five, Runways Two-Seven and Three-Six active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_09_18.mp3',
    text: 'Borealis ATIS, wind one-two-five, Runways Zero-Niner and One-Eight active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_27_18.mp3',
    text: 'Borealis ATIS, wind two-three-five, Runways Two-Seven and One-Eight active.',
    role: 'atc_controller',
  },
  {
    filename: 'atis_flip_09_36.mp3',
    text: 'Borealis ATIS, wind zero-five-five, Runways Zero-Niner and Three-Six active.',
    role: 'atc_controller',
  },

  // 14. JOKER fuel & BINGO / MAYDAY emergencies
  {
    filename: 'joker_fuel_1.mp3',
    text: 'Borealis, Joker fuel, need vectors.',
    role: 'pilot_aus_bushfire',
    urgent: true,
  },
  {
    filename: 'joker_fuel_2.mp3',
    text: 'Advise Joker fuel, requesting priority.',
    role: 'pilot_aus_lisa',
    urgent: true,
  },
  {
    filename: 'mayday_bingo_1.mp3',
    text: 'Mayday, Mayday! Bingo fuel, priority landing!',
    role: 'pilot_viper',
    urgent: true,
  },
  {
    filename: 'mayday_bingo_2.mp3',
    text: 'Mayday! Bingo fuel, need nearest open pad!',
    role: 'pilot_aus_campbell',
    urgent: true,
  },

  // 15. Brief landings — strictly "[Callsign], clear of the active." for every callsign family
  {
    filename: 'clear_viper.mp3',
    text: 'Viper, clear of the active.',
    role: 'pilot_viper',
  },
  {
    filename: 'clear_hawk.mp3',
    text: 'Hawk, clear of the active.',
    role: 'pilot_aus_scott',
  },
  {
    filename: 'clear_atlas.mp3',
    text: 'Atlas, clear of the active.',
    role: 'pilot_heavy',
  },
  {
    filename: 'clear_mule.mp3',
    text: 'Mule, clear of the active.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'clear_tug.mp3',
    text: 'Tug, clear of the active.',
    role: 'pilot_aus_bushfire',
  },
  {
    filename: 'clear_rig.mp3',
    text: 'Rig, clear of the active.',
    role: 'pilot_aus_scott',
  },
  {
    filename: 'clear_dustoff.mp3',
    text: 'Dustoff, clear of the active.',
    role: 'pilot_aus_campbell',
  },
  {
    filename: 'clear_medevac.mp3',
    text: 'Medevac, clear of the active.',
    role: 'pilot_aus_campbell',
  },
  {
    filename: 'clear_lifeguard.mp3',
    text: 'Lifeguard, clear of the active.',
    role: 'pilot_female',
  },
  {
    filename: 'clear_casevac.mp3',
    text: 'Casevac, clear of the active.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'clear_talon.mp3',
    text: 'Talon, clear of the active.',
    role: 'pilot_aus_baxter',
  },
  {
    filename: 'clear_saber.mp3',
    text: 'Saber, clear of the active.',
    role: 'pilot_female',
  },
  {
    filename: 'clear_raven.mp3',
    text: 'Raven, clear of the active.',
    role: 'pilot_aus_lisa',
  },
  {
    filename: 'clear_falcon.mp3',
    text: 'Falcon, clear of the active.',
    role: 'pilot_viper',
  },
  {
    filename: 'clear_mayday.mp3',
    text: 'Mayday, clear of the active.',
    role: 'pilot_aus_baxter',
  },
];

const APPROACH_SFX_ASSETS: ApproachSfxAsset[] = [
  {
    filename: 'mishap_explosion.mp3',
    prompt:
      'Deep heavy distant concussive explosion heard from inside a concrete military radar bunker, low sub-bass shockwave thud, muffled structural rumble, brief metallic bulkhead rattle, realistic 1979 military audio, no music',
    durationSeconds: 2.2,
    promptInfluence: 0.45,
  },
];

async function readExistingManifest(): Promise<Partial<ApproachAudioManifest> | null> {
  try {
    const raw = await fs.readFile(APPROACH_MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw) as Partial<ApproachAudioManifest>;
  } catch {
    return null;
  }
}

async function fileSizeBytes(filepath: string): Promise<number> {
  try {
    const stat = await fs.stat(filepath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function buildVoiceCast(): Record<RadioVoiceRole, string> {
  const envOverride =
    process.env.ELEVENLABS_APPROACH_VOICE_ID?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim();
  const cast = {} as Record<RadioVoiceRole, string>;
  for (const role of Object.keys(CURATED_VOICE_CAST) as RadioVoiceRole[]) {
    cast[role] = envOverride || CURATED_VOICE_CAST[role].voiceId;
  }
  return cast;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateRadioClip(
  apiKey: string,
  voiceId: string,
  asset: ApproachVoiceAsset,
  destPath: string
): Promise<void> {
  const sendTts = async (modelId: string): Promise<Response> => {
    const url = `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: asset.text,
        model_id: modelId,
        voice_settings: {
          stability: asset.urgent ? 0.56 : 0.72,
          similarity_boost: 0.82,
          style: asset.urgent ? 0.3 : 0.12,
          use_speaker_boost: true,
        },
      }),
    });
  };

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res = await sendTts('eleven_turbo_v2_5');
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await sendTts('eleven_multilingual_v2');
    }
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength < 1024) {
        throw new Error(`TTS returned unexpectedly small audio (${arrayBuffer.byteLength} bytes)`);
      }
      await fs.writeFile(destPath, Buffer.from(arrayBuffer));
      return;
    }
    lastErr = `(${res.status}) ${await res.text()}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    break;
  }

  throw new Error(`TTS Generation failed ${lastErr}`);
}

async function generateSfxClip(
  apiKey: string,
  asset: ApproachSfxAsset,
  destPath: string
): Promise<void> {
  const postSfx = async (url: string, body: Record<string, unknown>): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

  const basePayload = {
    text: asset.prompt,
    duration_seconds: asset.durationSeconds,
    prompt_influence: asset.promptInfluence,
  };

  let res = await postSfx(`${API_BASE}/sound-effects/generations`, basePayload);
  if (!res.ok && (res.status === 404 || res.status === 405)) {
    res = await postSfx(`${API_BASE}/sound-generation?output_format=mp3_44100_128`, {
      ...basePayload,
      model_id: 'eleven_text_to_sound_v2',
    });
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await postSfx(`${API_BASE}/sound-generation`, basePayload);
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SFX Generation failed (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

async function cleanupOrphanedMp3s(): Promise<string[]> {
  const validFiles = new Set<string>([
    ...APPROACH_VOICE_ASSETS.map((a) => a.filename),
    ...APPROACH_SFX_ASSETS.map((a) => a.filename),
  ]);
  const removed: string[] = [];
  const entries = await fs.readdir(APPROACH_AUDIO_OUT_DIR);
  for (const name of entries) {
    if (name.toLowerCase().endsWith('.mp3') && !validFiles.has(name)) {
      await fs.unlink(path.join(APPROACH_AUDIO_OUT_DIR, name));
      removed.push(name);
    }
  }
  return removed;
}

async function writeApproachManifestFromDisk(
  voiceCast: Record<RadioVoiceRole, string>
): Promise<ApproachAudioManifest> {
  const assets: ApproachAudioManifest['assets'] = {};

  for (const asset of APPROACH_VOICE_ASSETS) {
    const fullPath = path.join(APPROACH_AUDIO_OUT_DIR, asset.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = asset.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/approach/${asset.filename}`,
        category: 'voice',
        role: asset.role,
        voiceId: voiceCast[asset.role],
        text: asset.text,
        bytes,
      };
    }
  }

  for (const asset of APPROACH_SFX_ASSETS) {
    const fullPath = path.join(APPROACH_AUDIO_OUT_DIR, asset.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = asset.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/approach/${asset.filename}`,
        category: 'sfx',
        prompt: asset.prompt,
        bytes,
      };
    }
  }

  const manifest: ApproachAudioManifest = {
    version: 2,
    generatedAt: Object.keys(assets).length > 0 ? new Date().toISOString() : null,
    voiceId: voiceCast.atc_controller ?? voiceCast.pilot_viper ?? null,
    voiceCast,
    assets,
  };

  await fs.mkdir(APPROACH_AUDIO_OUT_DIR, { recursive: true });
  await fs.writeFile(APPROACH_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const forceAll = process.argv.includes('--force');
  const forceVoices = forceAll || process.argv.includes('--force-voices');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg
    ? new Set(
        onlyArg
          .slice('--only='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;

  await fs.mkdir(APPROACH_AUDIO_OUT_DIR, { recursive: true });
  const totalExpected = APPROACH_VOICE_ASSETS.length + APPROACH_SFX_ASSETS.length;
  const voiceCast = buildVoiceCast();
  const existingManifest = await readExistingManifest();

  console.log('====================================================================');
  console.log(' INTERFACE 2037 // BOREALIS APPROACH (PROGRAM 05) RADIO & SFX PACK');
  console.log(` CATALOG: ${APPROACH_VOICE_ASSETS.length} voice + ${APPROACH_SFX_ASSETS.length} SFX = ${totalExpected} clips`);
  console.log('====================================================================');
  for (const [role, meta] of Object.entries(CURATED_VOICE_CAST)) {
    console.log(`  [CAST] ${role.padEnd(20)} -> ${voiceCast[role as RadioVoiceRole]} | ${meta.label}`);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_api_key_here') {
    const manifest = await writeApproachManifestFromDisk(voiceCast);
    console.error('\n[ERROR] Missing valid ELEVENLABS_API_KEY in .env.');
    console.log(
      `[INFO] Synced manifest: ${Object.keys(manifest.assets).length}/${totalExpected} clips in public/audio/approach/manifest.json.`
    );
    process.exitCode = 1;
    return;
  }

  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const pendingVoices: ApproachVoiceAsset[] = [];
  for (const asset of APPROACH_VOICE_ASSETS) {
    const id = asset.filename.replace(/\.mp3$/i, '');
    if (onlySet && !onlySet.has(id) && !onlySet.has(asset.filename)) {
      skippedCount++;
      continue;
    }

    const destPath = path.join(APPROACH_AUDIO_OUT_DIR, asset.filename);
    const existingBytes = await fileSizeBytes(destPath);
    const prevEntry = existingManifest?.assets?.[id];
    const unchanged =
      prevEntry &&
      prevEntry.category === 'voice' &&
      prevEntry.text === asset.text &&
      prevEntry.role === asset.role &&
      (prevEntry.voiceId ?? existingManifest?.voiceCast?.[asset.role]) === voiceCast[asset.role];

    if (existingBytes > 2048 && unchanged && !forceVoices) {
      skippedCount++;
      continue;
    }
    pendingVoices.push(asset);
  }

  console.log(`\n[PLAN] Generating ${pendingVoices.length} voice clips (skipping ${skippedCount} unchanged)...`);

  await runWithConcurrency(pendingVoices, 3, async (asset) => {
    const destPath = path.join(APPROACH_AUDIO_OUT_DIR, asset.filename);
    const voiceId = voiceCast[asset.role];
    try {
      await generateRadioClip(apiKey, voiceId, asset, destPath);
      const bytes = await fileSizeBytes(destPath);
      console.log(
        `[TTS]  OK (${(bytes / 1024).toFixed(1).padStart(5)} KB) ${asset.filename.padEnd(28)} [${asset.role}] "${asset.text}"`
      );
      generatedCount++;
    } catch (err) {
      console.error(`[FAIL] ${asset.filename} [${asset.role}]: ${String(err)}`);
      failedCount++;
    }
  });

  for (const asset of APPROACH_SFX_ASSETS) {
    const id = asset.filename.replace(/\.mp3$/i, '');
    if (onlySet && !onlySet.has(id) && !onlySet.has(asset.filename)) {
      skippedCount++;
      continue;
    }

    const destPath = path.join(APPROACH_AUDIO_OUT_DIR, asset.filename);
    const existingBytes = await fileSizeBytes(destPath);
    if (existingBytes > 4096 && !forceAll) {
      console.log(`[SKIP] approach/${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB preserved).`);
      skippedCount++;
      continue;
    }

    process.stdout.write(`[SFX]  approach/${asset.filename} (${asset.durationSeconds}s)... `);
    try {
      await generateSfxClip(apiKey, asset, destPath);
      const bytes = await fileSizeBytes(destPath);
      console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
      generatedCount++;
    } catch (err) {
      console.log('FAILED');
      console.error(`       ${String(err)}`);
      failedCount++;
    }
  }

  const removedOrphans = await cleanupOrphanedMp3s();
  if (removedOrphans.length > 0) {
    console.log(`[CLEAN] Removed ${removedOrphans.length} obsolete MP3 files: ${removedOrphans.join(', ')}`);
  }

  const manifest = await writeApproachManifestFromDisk(voiceCast);
  console.log('\n====================================================================');
  console.log(` COMPLETE: ${generatedCount} generated, ${skippedCount} skipped, ${failedCount} failed.`);
  console.log(
    ` MANIFEST: ${Object.keys(manifest.assets).length}/${totalExpected} clips in public/audio/approach/manifest.json`
  );
  console.log('====================================================================');

  if (failedCount > 0 || Object.keys(manifest.assets).length < totalExpected) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
