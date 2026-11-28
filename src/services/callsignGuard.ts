export type ArcadeGameId = 'lander' | 'perimeter' | 'flak' | 'trench' | 'approach';

export const CALLSIGN_MAX_LEN = 12;
export const CALLSIGN_REGEX = /^[A-Z0-9_-]{1,12}$/;
export const CALLSIGN_CHAR_REGEX = /^[A-Za-z0-9_-]$/;

export const SUBMIT_COOLDOWN_MS = 15_000;
export const APPROACH_SUBMIT_COOLDOWN_MS = 30_000;
export const MIN_RUN_PLAYTIME_SEC = 5;

/**
 * Canonical plausible upper ceilings mirrored 1:1 in `firestore.rules`.
 */
export const SCORE_CAPS = {
  lander: { score: 10_000_000, sector: 99, accuracy: 100 },
  perimeter: { score: 50_000_000, waves: 200, kills: 100_000 },
  flak: { score: 25_000_000, wave: 99, maxChain: 32, accuracy: 100 },
  trench: { score: 5_000_000, distance: 500_000, maxMach: 5, grazes: 10_000 },
  approach: { score: 10_000_000, landed: 999, maxMult: 5 },
} as const;

const COOLDOWN_KEY_PREFIX = 'alienarcade_submit_cd_v1_';
const memoryCooldowns = new Map<ArcadeGameId, number>();

// Unambiguous severe slurs, hate terms, and explicit profanity checked as substrings
// on leetspeak-normalized, separator-stripped callsigns.
const BLOCKED_SUBSTRINGS: readonly string[] = [
  'NIGGER',
  'NIGGA',
  'NIGGR',
  'NIGLET',
  'FAGGOT',
  'FAGOT',
  'FAGET',
  'CHINK',
  'CHINGCHONG',
  'SPICK',
  'WETBACK',
  'BEANER',
  'GOOK',
  'KIKE',
  'TRANNY',
  'SHEMALE',
  'RETARD',
  'NAZI',
  'HITLER',
  'SWASTIKA',
  '1488',
  'KKK',
  'WHITEPWR',
  'WHITEPOWER',
  'RAGHEAD',
  'TOWELHEAD',
  'DARKIE',
  'LYNCH',
  'FUCK',
  'FUKK',
  'PHUCK',
  'SHIT',
  'CUNT',
  'BITCH',
  'WHORE',
  'SLUT',
  'PUSSY',
  'PENIS',
  'VAGINA',
  'DILDO',
  'RAPIST',
  'PAEDO',
  'ASSHOLE',
  'AHOLE',
  'BASTARD',
  'WANKER',
  'TWAT',
  'JIZZ',
  'CUMSHOT',
  'SEMEN',
  'PORN',
  'HENTAI',
  'TITTIES',
  'TITTY',
  'BOOBS',
  'BLOWJOB',
  'HANDJOB',
  'MOTHERF',
  'MTHERFKR',
  'CUCK',
  'DYKE',
  'INCEL',
  'SUICIDE',
];

// Shorter/ambiguous terms checked ONLY against whole normalized string or separator-split tokens
// so innocent callsigns (e.g., CASSANDRA, TITAN-01, SPUNKMEYER, ASH-120A2, TORPEDO, COCKPIT, SCRAPER) never false-positive.
const BLOCKED_EXACT_TOKENS: ReadonlySet<string> = new Set([
  'ASS',
  'FAG',
  'FAGS',
  'NIG',
  'NIGS',
  'SPIC',
  'COON',
  'JAP',
  'CUM',
  'FUK',
  'FCK',
  'SHT',
  'CNT',
  'COCK',
  'COCKS',
  'DICK',
  'DICKS',
  'PEDO',
  'PEDOS',
  'RAPE',
  'RAPES',
  'TIT',
  'TITS',
  'HOE',
  'HOES',
  'PISS',
  'ANAL',
  'ANUS',
  'SEX',
  'KYS',
  'STFU',
  'GTFO',
  'MILF',
  'FAP',
  'JEW',
  'JEWS',
]);

function normalizeLeetspeak(input: string): string {
  return input
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/3/g, 'E')
    .replace(/4/g, 'A')
    .replace(/5/g, 'S')
    .replace(/7/g, 'T')
    .replace(/8/g, 'B')
    .replace(/9/g, 'G')
    .replace(/6/g, 'G');
}

function collapseRepeats(input: string): string {
  return input.replace(/(.)\1+/g, '$1');
}

/**
 * Strips any character outside `[A-Z0-9_-]`, uppercases, and clamps to 12 characters.
 */
export function sanitizeCallsignDraft(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, CALLSIGN_MAX_LEN);
}

/**
 * Lightweight profanity and slur check with leetspeak + repeat-character normalization.
 */
export function containsBlockedCallsignTerm(raw: string): boolean {
  const clean = sanitizeCallsignDraft(raw);
  if (!clean) return false;

  const upperNoSep = clean.replace(/[_-]/g, '');
  const leetNoSep = normalizeLeetspeak(upperNoSep);
  const collapsed = collapseRepeats(leetNoSep);

  for (const term of BLOCKED_SUBSTRINGS) {
    if (upperNoSep.includes(term) || leetNoSep.includes(term)) {
      return true;
    }
    const termCollapsed = collapseRepeats(term);
    if (termCollapsed.length >= 4 && collapsed.includes(termCollapsed)) {
      return true;
    }
  }

  const tokens = clean.split(/[_-]+/).filter(Boolean);
  tokens.push(upperNoSep);
  for (const tok of tokens) {
    const leetTok = normalizeLeetspeak(tok);
    const colTok = collapseRepeats(leetTok);
    const alphaOnly = leetTok.replace(/[^A-Z]/g, '');
    if (
      BLOCKED_EXACT_TOKENS.has(tok) ||
      BLOCKED_EXACT_TOKENS.has(leetTok) ||
      (colTok.length >= 3 && BLOCKED_EXACT_TOKENS.has(colTok)) ||
      BLOCKED_EXACT_TOKENS.has(alphaOnly)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a callsign before leaderboard submission against strict `^[A-Z0-9_-]{1,12}$`
 * and the MU-TH-UR profanity/slur blocklist.
 */
export function validateCallsignForSubmit(raw: string): {
  ok: boolean;
  callsign: string;
  error?: string;
} {
  const callsign = sanitizeCallsignDraft(raw);
  if (!callsign || !CALLSIGN_REGEX.test(callsign)) {
    return {
      ok: false,
      callsign,
      error: 'CALLSIGN REQUIRED (A-Z, 0-9, _, -, MAX 12)',
    };
  }
  if (containsBlockedCallsignTerm(callsign)) {
    return {
      ok: false,
      callsign,
      error: 'CALLSIGN REJECTED BY MU-TH-UR COMMS FILTER',
    };
  }
  return { ok: true, callsign };
}

/**
 * Sanitizes and masks any remotely fetched or persisted callsign before display.
 */
export function maskCallsignForDisplay(raw: string, fallback = 'PILOT-01'): string {
  const safeFallback = sanitizeCallsignDraft(fallback) || 'PILOT-01';
  const clean = sanitizeCallsignDraft(raw);
  if (!clean || !CALLSIGN_REGEX.test(clean)) return safeFallback;
  if (containsBlockedCallsignTerm(clean)) return 'REDACTED';
  return clean;
}

/**
 * Enforces minimum run playtime (>=5s) and per-game submission cooldown via localStorage.
 * Defaults to 15s (`SUBMIT_COOLDOWN_MS`), or 30s (`APPROACH_SUBMIT_COOLDOWN_MS`) for `'approach'`.
 */
export function checkSubmissionGate(
  gameId: ArcadeGameId,
  playtimeSec: number,
  cooldownMs: number = gameId === 'approach' ? APPROACH_SUBMIT_COOLDOWN_MS : SUBMIT_COOLDOWN_MS
): { allowed: boolean; reason?: string } {
  if (!Number.isFinite(playtimeSec) || playtimeSec < MIN_RUN_PLAYTIME_SEC) {
    return {
      allowed: false,
      reason: `RUN TOO SHORT (<${MIN_RUN_PLAYTIME_SEC}S) — SCORE NOT ELIGIBLE`,
    };
  }

  const effectiveCooldownMs =
    Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : SUBMIT_COOLDOWN_MS;
  const now = Date.now();
  let lastMs = memoryCooldowns.get(gameId) ?? 0;
  try {
    const stored = window.localStorage.getItem(`${COOLDOWN_KEY_PREFIX}${gameId}`);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > lastMs) {
        lastMs = parsed;
      }
    }
  } catch {
    // Ignore restricted storage
  }

  const elapsed = now - lastMs;
  if (lastMs > 0 && elapsed >= 0 && elapsed < effectiveCooldownMs) {
    const waitSec = Math.max(1, Math.ceil((effectiveCooldownMs - elapsed) / 1000));
    return {
      allowed: false,
      reason: `UPLINK COOLDOWN ACTIVE — WAIT ${waitSec}S`,
    };
  }

  return { allowed: true };
}

/**
 * Records a completed score submission timestamp for the given game's 15-second cooldown.
 */
export function recordSubmissionTimestamp(gameId: ArcadeGameId): void {
  const now = Date.now();
  memoryCooldowns.set(gameId, now);
  try {
    window.localStorage.setItem(`${COOLDOWN_KEY_PREFIX}${gameId}`, String(now));
  } catch {
    // Ignore storage quota / private browsing errors
  }
}
