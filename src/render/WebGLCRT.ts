import type { CrtPreset, CrtShockwaveUniform } from '../shell/Cartridge';
import type { ViewportRect } from '../types';

export type { CrtPreset };

export interface CrtPresetProfile {
  label: string;
  shortLabel: string;
  enabled1979: boolean;
  curve: number;
  scanline: number;
  grille: number;
  defaultChroma: number;
  rasterQuant: number;
  bloomGain: number;
  trailGain: number;
  decayBase: number;
}

export const CRT_PRESET_CONFIG: Record<CrtPreset, CrtPresetProfile> = {
  CLASSIC_1979: {
    label: '1979 MODE (ON)',
    shortLabel: 'ON',
    enabled1979: true,
    curve: 0.30,
    scanline: 0.34,
    grille: 0.46,
    defaultChroma: 0.58,
    rasterQuant: 0.24,
    bloomGain: 0.44,
    trailGain: 0.96,
    decayBase: 0.932,
  },
  CRISP: {
    label: 'MODERN CLEAN (OFF)',
    shortLabel: 'OFF',
    enabled1979: false,
    curve: 0.0,
    scanline: 0.0,
    grille: 0.0,
    defaultChroma: 0.0,
    rasterQuant: 0.0,
    bloomGain: 0.0,
    trailGain: 0.0,
    decayBase: 0.0,
  },
};

const VERTEX_SHADER_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Pass 0 (1979 CRT: OFF): Zero-Overhead Modern/Clean Direct Blit
 * - Zero FBO passes, zero curvature, zero scanlines/grille/misconvergence/bloom.
 * - Preserves global Phosphor Theme (P39 Green / P3 Amber / Medbay Cyan) and boot ignition flash.
 */
const CLEAN_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform float uTime;
uniform float uTubeTurnOn;
uniform float uDegauss;
uniform float uPhosphorMode;

void main() {
  vec2 uv = vUv;
  float turnOn = clamp(uTubeTurnOn, 0.0, 1.0);
  float degauss = clamp(uDegauss, 0.0, 1.0);

  if (degauss > 0.001) {
    vec2 dc = uv * 2.0 - 1.0;
    float r = length(dc);
    uv += dc * sin(r * 16.0 - (1.0 - degauss) * 18.0) * degauss * 0.006;
  }

  vec3 col = texture2D(uSourceTex, clamp(uv, 0.0, 1.0)).rgb;

  if (turnOn > 0.001) {
    vec2 tc = vUv * 2.0 - 1.0;
    float openProg = 1.0 - turnOn;
    float arcLine = exp(-abs(tc.y) * (18.0 - 13.0 * turnOn));
    float screenSurge = sin(clamp(openProg / 0.55, 0.0, 1.0) * 3.14159265) * turnOn;
    col += vec3(0.95, 0.92, 0.85) * (arcLine * turnOn * 0.9 + screenSurge * 0.45);
  }

  if (uPhosphorMode > 0.5 && uPhosphorMode < 1.5) {
    float lum = dot(col, vec3(0.32, 0.58, 0.10));
    float alertness = clamp((col.r - col.g) * 1.45, 0.0, 1.0);
    vec3 amberTone = vec3(1.14, 0.66, 0.10) * lum * 1.14;
    vec3 alertTone = vec3(1.24, 0.22, 0.06) * max(col.r, lum);
    col = mix(amberTone, alertTone, alertness * 0.72);
  } else if (uPhosphorMode >= 1.5) {
    float greenSig = max(0.0, col.g - col.r * 0.65);
    float warmSig = clamp((col.r - col.g * 0.58) * 1.45, 0.0, 1.0);
    float lum = dot(col, vec3(0.28, 0.60, 0.12));
    vec3 cyanBase = vec3(0.18, 0.94, 1.08) * max(lum, greenSig) * 1.06;
    vec3 hazardWarm = vec3(col.r * 1.08, col.g * 0.90, col.b * 0.65);
    col = mix(cyanBase, hazardWarm, warmSig * 0.85);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Pass 1 (1979 MODE): Ping-Pong P39 Green & P3 Amber Phosphor Persistence / Afterglow Buffer
 * - Softened horizontal electron-beam footprint for warm 1979 CRT character glow.
 * - Long-persistence P39 green / amber trail decay with subtle spatial diffusion.
 */
const ACCUM_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uPrevTex;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uDecayBase;
uniform float uDtFrames;

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  float spreadX = 1.15 * max(1.0, uDpr * 0.85);

  // Softened 1979 CRT electron beam footprint (replaces razor-sharp LCD pixels)
  vec3 c0 = texture2D(uSourceTex, vUv).rgb;
  vec3 cL = texture2D(uSourceTex, clamp(vUv - vec2(texel.x * spreadX, 0.0), 0.001, 0.999)).rgb;
  vec3 cR = texture2D(uSourceTex, clamp(vUv + vec2(texel.x * spreadX, 0.0), 0.001, 0.999)).rgb;
  vec3 cU = texture2D(uSourceTex, clamp(vUv + vec2(0.0, texel.y * 0.70), 0.001, 0.999)).rgb;
  vec3 cD = texture2D(uSourceTex, clamp(vUv - vec2(0.0, texel.y * 0.70), 0.001, 0.999)).rgb;
  vec3 beam = c0 * 0.58 + (cL + cR) * 0.15 + (cU + cD) * 0.06;

  // Slightly diffused phosphor persistence feedback
  vec3 prev0 = texture2D(uPrevTex, clamp(vUv - vec2(texel.x * 0.22, 0.0), 0.001, 0.999)).rgb;
  vec3 prevSmear = (
    prev0 * 0.80 +
    texture2D(uPrevTex, clamp(vUv + vec2(texel.x * 1.05, 0.0), 0.001, 0.999)).rgb * 0.08 +
    texture2D(uPrevTex, clamp(vUv - vec2(texel.x * 1.05, 0.0), 0.001, 0.999)).rgb * 0.06 +
    texture2D(uPrevTex, clamp(vUv - vec2(0.0, texel.y * 0.90), 0.001, 0.999)).rgb * 0.06
  );

  // Authentic P39 green slow phosphor afterglow (green decays slowest, blue fastest)
  vec3 channelDecay = pow(
    clamp(vec3(uDecayBase - 0.012, uDecayBase + 0.012, uDecayBase - 0.042), 0.0, 0.975),
    vec3(uDtFrames)
  );
  vec3 decayed = prevSmear * channelDecay;
  decayed *= smoothstep(0.012, 0.048, max(decayed.r, max(decayed.g, decayed.b)));

  gl_FragColor = vec4(max(beam, decayed), 1.0);
}
`;

/**
 * Pass 2 & Pass 3 (1979 MODE): Half-Resolution Separable 9-Tap Gaussian Bloom
 * - Pass 2 (uHorizontal = 1.0): soft luminance prefilter + horizontal Gaussian blur
 * - Pass 3 (uHorizontal = 0.0): vertical Gaussian blur for silky 1979 CRT glass halation
 */
const BLOOM_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform vec2 uDirection;
uniform float uPrefilter;

vec3 sampleColor(vec2 uv) {
  vec3 c = texture2D(uTex, clamp(uv, 0.001, 0.999)).rgb;
  if (uPrefilter > 0.5) {
    float lum = max(c.r, max(c.g, c.b));
    float soft = smoothstep(0.11, 0.42, lum);
    return c * soft;
  }
  return c;
}

void main() {
  vec2 stepUv = uDirection * uTexelSize;
  vec3 sum = sampleColor(vUv) * 0.227027;
  sum += (sampleColor(vUv + stepUv * 1.384615) + sampleColor(vUv - stepUv * 1.384615)) * 0.316216;
  sum += (sampleColor(vUv + stepUv * 3.230769) + sampleColor(vUv - stepUv * 3.230769)) * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}
`;

/**
 * Pass 4 (1979 MODE): Heavy Authentic 1979 MU-TH-UR 6000 Trinitron CRT Composite Shader
 * - Gentle CRT barrel curvature, rounded tube bezel mask, glass glare & corner vignetting
 * - Prominent 1970s Sony Trinitron vertical aperture grille (integer DPI-locked, 0 moiré)
 * - High-density DPI-scaled horizontal scanlines (integer DPI-locked, 0 moiré)
 * - Multi-pass separable Gaussian bloom + soft electron-focus phosphor bleed
 * - Edge-weighted RGB beam misconvergence
 * - Subtle 60Hz power-line micro-jitter & rare micro-second horizontal signal tear/drift
 */
const COMPOSITE_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uAccumTex;
uniform sampler2D uBloomTex;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uCrtIntensity;     // 0.0 .. 1.0 (curve & tube geometry strength)
uniform float uScanlineStrength; // DPI-scaled horizontal scanlines
uniform float uGrilleStrength;   // Prominent vertical Trinitron aperture grille
uniform float uRasterQuant;      // Subtle 1979 cathode raster stepping
uniform float uBloomGain;        // Multi-pass Gaussian glass halation intensity
uniform float uTrailGain;        // P39/P3 phosphor afterglow intensity
uniform float uDegauss;          // 0.0 .. 1.0 decaying electromagnetic degauss coil pulse
uniform float uInterference;     // 0.0 .. 1.0
uniform float uGlitch;           // 0.0 .. 1.0
uniform float uOverdrive;        // 0.0 .. 1.0
uniform float uTubeTurnOn;       // 1.0 at cold ignition -> 0.0 when warmed up
uniform float uPhosphorMode;     // 0 = P39 GREEN, 1 = P3 AMBER, 2 = MEDBAY CYAN
uniform float uChromaScale;      // 0.0 .. 1.0 (edge-weighted RGB beam misconvergence)
uniform vec4 uShockwaves[4];     // xy = uv center (WebGL bottom-up), z = radius (norm H), w = intensity

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 warpUV(vec2 uv, float amount) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  float k1 = 0.105 * amount;
  float k2 = 0.032 * amount;
  centered *= 1.0 + k1 * r2 + k2 * r2 * r2;
  centered *= 1.0 - 0.022 * amount;
  return centered * 0.5 + 0.5;
}

float roundedTubeMask(vec2 uv, float cornerRadius) {
  vec2 p = abs(uv * 2.0 - 1.0) - (1.0 - cornerRadius);
  float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - cornerRadius;
  return 1.0 - smoothstep(-0.007, 0.009, d);
}

void main() {
  float dial = clamp(uCrtIntensity, 0.0, 1.0);
  float turnOn = clamp(uTubeTurnOn, 0.0, 1.0);
  float degauss = clamp(uDegauss, 0.0, 1.0);

  // Gentle 1979 CRT barrel curvature (locked 1:1 with WebGLCRT.mapClientToCrtUv!)
  float curveAmt = clamp(dial * 0.95 + turnOn * turnOn * 0.85, 0.0, 1.45);
  vec2 uv = warpUV(vUv, curveAmt);

  // Electromagnetic degauss coil ripple when toggling 1979 CRT mode
  if (degauss > 0.001) {
    vec2 dc = uv * 2.0 - 1.0;
    float r = length(dc);
    float ring = sin(r * 16.0 - (1.0 - degauss) * 18.0) * degauss * 0.016;
    uv += dc * ring;
  }

  // Cold-cathode 1979 magnetic deflection yoke distortion on power-on
  if (turnOn > 0.001) {
    vec2 tc = uv * 2.0 - 1.0;
    float sCurveX = sin(tc.y * 7.5 + uTime * 46.0) * 0.19 * turnOn * turnOn
                  + cos(tc.y * 19.0 - uTime * 68.0) * 0.055 * turnOn;
    float yokeBowY = sin(tc.x * 4.2 + uTime * 34.0) * 0.09 * turnOn * turnOn;
    float openProg = 1.0 - turnOn;
    float vStretch = mix(0.05, 1.0, smoothstep(0.0, 0.34, openProg))
                   + sin(openProg * 22.0) * exp(-openProg * 4.5) * 0.14;
    tc.x = (tc.x + sCurveX) / max(0.32, 1.0 - 0.35 * turnOn * turnOn);
    tc.y = (tc.y + yokeBowY) / max(0.045, vStretch);
    uv = tc * 0.5 + 0.5;
  }

  // Dark recessed CRT glass bezel corners
  float cornerR = dial * 0.052;
  float mask = cornerR > 0.001 ? roundedTubeMask(uv, cornerR) : 1.0;
  if (mask <= 0.001 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    vec2 edgeDist = abs(vUv * 2.0 - 1.0);
    float rim = smoothstep(0.995, 0.90, max(edgeDist.x, edgeDist.y));
    float grain = (hash12(gl_FragCoord.xy * 0.5) - 0.5) * 0.016;
    vec3 bezelCol = mix(vec3(0.014, 0.019, 0.016), vec3(0.042, 0.056, 0.046), rim * 0.55) + grain;
    bezelCol = mix(bezelCol, vec3(0.004, 0.001, 0.001), clamp(turnOn * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(bezelCol, 1.0);
    return;
  }

  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 tubeCentered = uv * 2.0 - 1.0;
  float cornerR2 = dot(tubeCentered, tubeCentered);

  // =========================================================================
  // ANALOG IMPERFECTIONS: 60Hz MICRO-JITTER + RARE MICRO-SECOND SIGNAL TEAR
  // =========================================================================
  float hvJitterX = (
    sin(uTime * 376.991 + uv.y * 38.0) * 0.36 +
    sin(uTime * 188.495 - uv.y * 14.0) * 0.14
  ) * max(0.45, dial) * uDpr * texel.x;

  // Rare deterministic micro-second horizontal sync tear/drift (~every 7-9s for ~0.13s)
  float driftSlot = floor(uTime * 0.135);
  float driftFrac = fract(uTime * 0.135);
  float slotActive = step(0.32, hash12(vec2(driftSlot, 19.7)));
  float pulseWindow = slotActive * (1.0 - smoothstep(0.0, 0.018, abs(driftFrac - 0.52)));
  float bandCenter = hash12(vec2(driftSlot, 43.1)) * 0.72 + 0.14;
  float bandEnv = exp(-pow((uv.y - bandCenter) / 0.024, 2.0));
  float microTearShift = pulseWindow * bandEnv
    * (hash12(vec2(floor(uv.y * 140.0), floor(uTime * 60.0))) - 0.5)
    * 6.2 * uDpr * texel.x;
  float microTearChroma = pulseWindow * bandEnv * 0.45;

  // Event-driven interference / glitch tearing
  float totalDisturb = clamp(uInterference * 0.62 + uGlitch * 1.25 + uOverdrive * 0.35, 0.0, 1.6);
  float tearWave = sin(uv.y * 29.0 + uTime * 21.0) * sin(uv.y * 8.5 - uTime * 13.0);
  float tearGate = step(0.74 - min(0.58, uGlitch * 0.52 + uOverdrive * 0.18 + uInterference * 0.24), abs(tearWave));
  float tearShift = tearGate * (hash12(vec2(floor(uv.y * 95.0), floor(uTime * 38.0))) - 0.5) * 0.038 * totalDisturb;

  // Localized Physical CRT Shockwave Distortion (EMP blasts & Dome impacts)
  vec2 shockUvOffset = vec2(0.0);
  float shockRingGlow = 0.0;
  float shockChromaBoost = 0.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  for (int i = 0; i < 4; i++) {
    vec4 sw = uShockwaves[i];
    if (sw.w > 0.001) {
      vec2 delta = (uv - sw.xy) * vec2(aspect, 1.0);
      float dist = length(delta);
      float ringW = 0.026 + sw.z * 0.13;
      float diff = dist - sw.z;
      float env = exp(-(diff * diff) / max(0.00018, ringW * ringW));
      if (env > 0.002 && dist > 0.0005) {
        vec2 dir = (delta / dist) / vec2(aspect, 1.0);
        float wave = cos(clamp(diff / max(0.012, ringW), -1.5, 1.5) * 3.14159) * env;
        float disp = (0.019 * wave + 0.008 * env * sin(diff * 78.0)) * sw.w;
        shockUvOffset -= dir * disp;
        shockRingGlow += env * sw.w;
        shockChromaBoost += env * sw.w;
      }
    }
  }

  vec2 uvMin = texel * 0.5;
  vec2 uvMax = 1.0 - uvMin;
  vec2 rawSampleUv = clamp(
    uv + shockUvOffset + vec2(hvJitterX + microTearShift + tearShift, 0.0),
    uvMin,
    uvMax
  );

  // Vintage 1979 raster beam stepping
  float rasterPitch = max(1.0, (1.06 + 0.44 * dial) * uDpr);
  vec2 gridDims = max(vec2(320.0), floor(uResolution / rasterPitch));
  vec2 quantUv = (floor(rawSampleUv * gridDims) + 0.5) / gridDims;
  vec2 sampleUv = mix(rawSampleUv, quantUv, clamp(uRasterQuant, 0.0, 0.50));

  // =========================================================================
  // SOFT ELECTRON-BEAM FOCUS + EDGE-WEIGHTED RGB MISCONVERGENCE
  // =========================================================================
  vec2 focusOff = texel * (0.58 * uDpr);
  vec3 sampCore = texture2D(uSourceTex, sampleUv).rgb;
  vec3 sampSoft = (
    sampCore * 0.56 +
    texture2D(uSourceTex, clamp(sampleUv + vec2( focusOff.x, 0.0), uvMin, uvMax)).rgb * 0.13 +
    texture2D(uSourceTex, clamp(sampleUv + vec2(-focusOff.x, 0.0), uvMin, uvMax)).rgb * 0.13 +
    texture2D(uSourceTex, clamp(sampleUv + vec2(0.0,  focusOff.y), uvMin, uvMax)).rgb * 0.09 +
    texture2D(uSourceTex, clamp(sampleUv + vec2(0.0, -focusOff.y), uvMin, uvMax)).rgb * 0.09
  );
  // Subtle electron defocus softens modern crisp pixel edges into warm phosphor dots while keeping HUD text crisp
  vec3 sampMid = mix(sampCore, sampSoft, 0.28);

  float chroma = clamp(uChromaScale, 0.0, 1.0);
  float eventDisturb = clamp(
    totalDisturb * 0.90 + shockChromaBoost * 0.95 + turnOn + degauss * 0.70 + microTearChroma,
    0.0,
    1.0
  );
  float misconvPx = (0.85 + cornerR2 * 2.25) * (0.58 + 0.55 * dial) * uDpr * chroma
                  + totalDisturb * 2.8 * uDpr
                  + microTearChroma * 3.5 * uDpr
                  + shockChromaBoost * 5.2 * uDpr
                  + degauss * 4.5 * uDpr
                  + turnOn * turnOn * 20.0 * uDpr;
  vec2 misconvVec = vec2(misconvPx * texel.x, tubeCentered.y * 0.34 * misconvPx * texel.y);

  vec3 sampLeft  = texture2D(uSourceTex, clamp(sampleUv - misconvVec, uvMin, uvMax)).rgb;
  vec3 sampRight = texture2D(uSourceTex, clamp(sampleUv + misconvVec, uvMin, uvMax)).rgb;

  // Authentic RGB beam separation + warm-amber / cool-violet edge fringe
  vec3 splitRgb = vec3(
    mix(sampMid.r, sampLeft.r, 0.52 * chroma),
    sampMid.g,
    mix(sampMid.b, sampRight.b, 0.52 * chroma)
  );
  float lumLeft  = max(sampLeft.r, max(sampLeft.g, sampLeft.b));
  float lumMid   = max(sampMid.r, max(sampMid.g, sampMid.b));
  float lumRight = max(sampRight.r, max(sampRight.g, sampRight.b));

  float warmFringeMask = max(0.0, lumLeft - lumMid * 0.66);
  float coolFringeMask = max(0.0, lumRight - lumMid * 0.66);
  float fringeAmt = clamp(max(mix(0.22, 0.96, chroma), eventDisturb), 0.0, 1.0);
  float warmStrength = mix(0.36 + 0.34 * cornerR2, 0.48 + 0.40 * cornerR2, max(dial, eventDisturb));
  float coolStrength = mix(0.38 + 0.38 * cornerR2, 0.50 + 0.44 * cornerR2, max(dial, eventDisturb));

  vec3 liveC = splitRgb
             + vec3(1.00, 0.60, 0.12) * warmFringeMask * warmStrength * fringeAmt
             + vec3(0.42, 0.32, 1.00) * coolFringeMask * coolStrength * fringeAmt;

  // =========================================================================
  // PHOSPHOR PERSISTENCE TRAILS (P39 Green & Golden-Amber Afterglow)
  // =========================================================================
  vec2 accumUv = mix(sampleUv, quantUv, 0.36);
  vec3 accumC = texture2D(uAccumTex, accumUv).rgb * 0.78 +
                texture2D(uAccumTex, clamp(accumUv - vec2(texel.x * 1.10, 0.0), uvMin, uvMax)).rgb * 0.22;
  vec3 ghostTail = max(accumC - sampMid * 0.90, vec3(0.0));
  float tailWarmth = smoothstep(0.04, 0.28, ghostTail.r - ghostTail.g * 0.65);
  vec3 trailTint = mix(vec3(0.80, 1.06, 0.74), vec3(1.12, 0.76, 0.24), tailWarmth);
  vec3 beamWithPersistence = liveC + ghostTail * trailTint * uTrailGain;

  // =========================================================================
  // MULTI-PASS GAUSSIAN BLOOM (WIDE GLASS HALATION + TIGHT PHOSPHOR BLEED)
  // =========================================================================
  vec3 wideBloom = texture2D(uBloomTex, sampleUv).rgb;
  // Tight local phosphor bleed right around bright strokes
  float rTight = 1.35 * uDpr;
  vec3 tightHalo = (
    texture2D(uAccumTex, clamp(sampleUv + vec2( rTight, 0.0) * texel, uvMin, uvMax)).rgb +
    texture2D(uAccumTex, clamp(sampleUv + vec2(-rTight, 0.0) * texel, uvMin, uvMax)).rgb +
    texture2D(uAccumTex, clamp(sampleUv + vec2(0.0,  rTight) * texel, uvMin, uvMax)).rgb +
    texture2D(uAccumTex, clamp(sampleUv + vec2(0.0, -rTight) * texel, uvMin, uvMax)).rgb
  ) * 0.25;
  vec3 combinedBloom = wideBloom * (uBloomGain * 0.92) + max(tightHalo - vec3(0.07), vec3(0.0)) * (uBloomGain * 0.42);
  float bloomWarmth = smoothstep(0.03, 0.24, combinedBloom.r - combinedBloom.g * 0.65);
  vec3 bloomTint = mix(vec3(0.78, 1.05, 0.84), vec3(1.14, 0.78, 0.30), bloomWarmth);

  // Deep Nostromo CRT Cathode Floor + Halation + Shockwave & Degauss Glow
  vec3 cathodeFloor = vec3(0.011, 0.026, 0.016) * (1.0 - cornerR2 * 0.40);
  vec3 col = cathodeFloor + beamWithPersistence * 1.04 + combinedBloom * bloomTint;
  if (shockRingGlow > 0.001) {
    col += vec3(0.36, 0.95, 0.56) * shockRingGlow * 0.16;
  }
  if (degauss > 0.001) {
    float degRing = exp(-abs(length(tubeCentered) - (1.0 - degauss) * 1.35) * 6.0);
    col += vec3(0.30, 0.76, 0.46) * degRing * degauss * 0.20;
  }

  // High-voltage CRT tube ignition flash
  if (turnOn > 0.001) {
    float openProg = 1.0 - turnOn;
    float arcLine = exp(-abs(tubeCentered.y + sin(tubeCentered.x * 6.5 + uTime * 42.0) * 0.12) * (18.0 - 13.0 * turnOn));
    float screenSurge = sin(clamp(openProg / 0.55, 0.0, 1.0) * 3.14159265) * turnOn;
    float centerHot = exp(-dot(tubeCentered * vec2(0.65, 1.35), tubeCentered * vec2(0.65, 1.35)) * 2.4);
    vec3 flashTint = mix(vec3(1.00, 0.26, 0.16), vec3(1.15, 0.94, 0.86), clamp(arcLine * 0.7 + centerHot * 0.5, 0.0, 1.0));
    col += flashTint * (arcLine * turnOn * 1.35 + screenSurge * (0.55 + 0.65 * centerHot));
  }

  // =========================================================================
  // PROMINENT 1970s TRINITRON VERTICAL APERTURE GRILLE + DPI-SCALED SCANLINES
  // Integer device-pixel periods guarantee ZERO moiré aliasing at every DPR!
  // =========================================================================
  float colPeriod = max(3.0, floor(3.0 * uDpr + 0.5));
  float rowPeriod = max(2.0, floor(2.0 * uDpr + 0.5));

  vec2 grilleCoord = gl_FragCoord.xy + shockUvOffset * uResolution * 0.9;
  float colNorm = mod(floor(grilleCoord.x), colPeriod) / colPeriod;
  float rowNorm = mod(floor(grilleCoord.y), rowPeriod) / rowPeriod;

  // Prominent vertical phosphor slot mask
  float distColCenter = abs(colNorm - 0.5) * 2.0;
  float verticalGrille = 1.0 - clamp(uGrilleStrength, 0.0, 0.68) * smoothstep(0.36, 0.94, distColCenter);

  // Subtle Trinitron RGB phosphor slot triad tint
  float subTriad = colNorm - 0.5;
  vec3 apertureTint = vec3(
    1.0 + subTriad * 0.17,
    1.0 - abs(subTriad) * 0.06,
    1.0 - subTriad * 0.18
  );

  // High-density DPI-scaled horizontal scanlines
  float distRowCenter = abs(rowNorm - 0.5) * 2.0;
  float horizScan = 1.0 - clamp(uScanlineStrength, 0.0, 0.55) * smoothstep(0.38, 0.96, distRowCenter);

  // Bright electron beam naturally blooms slightly across scanlines & grille bars
  float peakLum = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  float brightSpot = smoothstep(0.24, 0.92, peakLum);
  float rawMask = verticalGrille * horizScan;
  float combinedMask = mix(rawMask, mix(rawMask, 1.0, 0.24), brightSpot);
  // Slight luminance compensation so heavy grille + scanlines stay punchy & legible
  col *= combinedMask * apertureTint * 1.18;

  // Soft analog highlight roll-off + subtle 60Hz cathode brightness hum
  col = col / (1.0 + col * 0.13);
  col *= 1.0 - (0.008 + 0.011 * dial) * sin(uTime * 376.991);

  // Subtle analog cathode phosphor grain / static
  float snowAmt = uInterference * 0.14 + uGlitch * 0.26 + uOverdrive * 0.04 + 0.018;
  float snow = hash12(floor(gl_FragCoord.xy / max(1.0, uDpr)) + vec2(floor(uTime * 30.0) * 17.3, 9.1)) - 0.5;
  col += vec3(0.26, 0.74, 0.40) * snow * snowAmt;

  // Curved CRT Glass Reflection Glare & Dark Glass Corner Vignetting
  vec2 glarePos1 = tubeCentered - vec2(-0.34, 0.42);
  float warmLampGlare = exp(-dot(glarePos1, glarePos1) * 5.2) * (0.055 * dial);
  col += vec3(0.86, 0.78, 0.62) * warmLampGlare;

  float vignette = clamp(1.0 - cornerR2 * (0.08 + 0.26 * dial), 0.36, 1.0);
  float edgeShadow = smoothstep(0.0, 0.065, 1.0 - max(abs(tubeCentered.x), abs(tubeCentered.y)));
  col *= vignette * mix(1.0, mix(0.22, 1.0, edgeShadow), clamp(dial * 1.35, 0.0, 1.0));

  // Dynamic MU-TH-UR 6000 Phosphor Palette Shift (P39 GREEN | P3 AMBER | MEDBAY CYAN)
  if (uPhosphorMode > 0.5 && uPhosphorMode < 1.5) {
    float lum = dot(col, vec3(0.32, 0.58, 0.10));
    float alertness = clamp((col.r - col.g) * 1.45, 0.0, 1.0);
    vec3 amberTone = vec3(1.15, 0.66, 0.10) * lum * 1.18;
    vec3 alertTone = vec3(1.24, 0.22, 0.06) * max(col.r, lum);
    col = mix(amberTone, alertTone, alertness * 0.72);
  } else if (uPhosphorMode >= 1.5) {
    float greenSig = max(0.0, col.g - col.r * 0.65);
    float warmSig = clamp((col.r - col.g * 0.58) * 1.45, 0.0, 1.0);
    float lum = dot(col, vec3(0.28, 0.60, 0.12));
    vec3 cyanBase = vec3(0.18, 0.94, 1.08) * max(lum, greenSig) * 1.08;
    vec3 hazardWarm = vec3(col.r * 1.08, col.g * 0.90, col.b * 0.65);
    col = mix(cyanBase, hazardWarm, warmSig * 0.85);
  }

  gl_FragColor = vec4(col * mask, 1.0);
}
`;

interface FboTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class WebGLCRT {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private fallback2d: CanvasRenderingContext2D | null = null;

  private cleanProgram: WebGLProgram | null = null;
  private accumProgram: WebGLProgram | null = null;
  private bloomProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private pingPong: [FboTarget, FboTarget] | null = null;
  private bloomTargets: [FboTarget, FboTarget] | null = null;
  private readIdx = 0;
  private fboWidth = 0;
  private fboHeight = 0;
  private bloomWidth = 0;
  private bloomHeight = 0;
  private texWidth = 0;
  private texHeight = 0;
  private lastRenderTime = -1;
  private lastWas1979 = false;

  private degaussTimer = 0;
  private readonly degaussDuration = 0.15;

  // Clean blit uniforms
  private aCleanPos = -1;
  private uCleanSource: WebGLUniformLocation | null = null;
  private uCleanTime: WebGLUniformLocation | null = null;
  private uCleanTubeTurnOn: WebGLUniformLocation | null = null;
  private uCleanDegauss: WebGLUniformLocation | null = null;
  private uCleanPhosphorMode: WebGLUniformLocation | null = null;

  // Persistence accumulation uniforms
  private aAccumPos = -1;
  private uAccumSource: WebGLUniformLocation | null = null;
  private uAccumPrev: WebGLUniformLocation | null = null;
  private uAccumRes: WebGLUniformLocation | null = null;
  private uAccumDpr: WebGLUniformLocation | null = null;
  private uAccumDecay: WebGLUniformLocation | null = null;
  private uAccumDtFrames: WebGLUniformLocation | null = null;

  // Separable Gaussian bloom uniforms
  private aBloomPos = -1;
  private uBloomTex: WebGLUniformLocation | null = null;
  private uBloomTexelSize: WebGLUniformLocation | null = null;
  private uBloomDirection: WebGLUniformLocation | null = null;
  private uBloomPrefilter: WebGLUniformLocation | null = null;

  // 1979 CRT composite uniforms
  private aCompPos = -1;
  private uCompSource: WebGLUniformLocation | null = null;
  private uCompAccum: WebGLUniformLocation | null = null;
  private uCompBloom: WebGLUniformLocation | null = null;
  private uCompRes: WebGLUniformLocation | null = null;
  private uCompDpr: WebGLUniformLocation | null = null;
  private uCompTime: WebGLUniformLocation | null = null;
  private uCompCrtIntensity: WebGLUniformLocation | null = null;
  private uCompScanlineStrength: WebGLUniformLocation | null = null;
  private uCompGrilleStrength: WebGLUniformLocation | null = null;
  private uCompRasterQuant: WebGLUniformLocation | null = null;
  private uCompBloomGain: WebGLUniformLocation | null = null;
  private uCompTrailGain: WebGLUniformLocation | null = null;
  private uCompDegauss: WebGLUniformLocation | null = null;
  private uCompInterference: WebGLUniformLocation | null = null;
  private uCompGlitch: WebGLUniformLocation | null = null;
  private uCompOverdrive: WebGLUniformLocation | null = null;
  private uCompTubeTurnOn: WebGLUniformLocation | null = null;
  private uCompPhosphorMode: WebGLUniformLocation | null = null;
  private uCompChromaScale: WebGLUniformLocation | null = null;
  private uCompShockwaves: WebGLUniformLocation | null = null;
  private shockwaveUploadBuf = new Float32Array(16);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initWebGL();
  }

  public triggerDegauss(): void {
    this.degaussTimer = this.degaussDuration;
  }

  private initWebGL(): void {
    const gl =
      (this.canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null) ||
      (this.canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      this.fallback2d = this.canvas.getContext('2d');
      return;
    }

    const cleanProg = this.buildProgram(gl, VERTEX_SHADER_SRC, CLEAN_FRAGMENT_SRC);
    const accumProg = this.buildProgram(gl, VERTEX_SHADER_SRC, ACCUM_FRAGMENT_SRC);
    const bloomProg = this.buildProgram(gl, VERTEX_SHADER_SRC, BLOOM_FRAGMENT_SRC);
    const compProg = this.buildProgram(gl, VERTEX_SHADER_SRC, COMPOSITE_FRAGMENT_SRC);
    if (!cleanProg || !accumProg || !bloomProg || !compProg) {
      this.fallback2d = this.canvas.getContext('2d');
      return;
    }

    this.gl = gl;
    this.cleanProgram = cleanProg;
    this.accumProgram = accumProg;
    this.bloomProgram = bloomProg;
    this.compositeProgram = compProg;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.sourceTexture = this.createLinearTexture(gl);

    this.aCleanPos = gl.getAttribLocation(cleanProg, 'aPosition');
    this.uCleanSource = gl.getUniformLocation(cleanProg, 'uSourceTex');
    this.uCleanTime = gl.getUniformLocation(cleanProg, 'uTime');
    this.uCleanTubeTurnOn = gl.getUniformLocation(cleanProg, 'uTubeTurnOn');
    this.uCleanDegauss = gl.getUniformLocation(cleanProg, 'uDegauss');
    this.uCleanPhosphorMode = gl.getUniformLocation(cleanProg, 'uPhosphorMode');

    this.aAccumPos = gl.getAttribLocation(accumProg, 'aPosition');
    this.uAccumSource = gl.getUniformLocation(accumProg, 'uSourceTex');
    this.uAccumPrev = gl.getUniformLocation(accumProg, 'uPrevTex');
    this.uAccumRes = gl.getUniformLocation(accumProg, 'uResolution');
    this.uAccumDpr = gl.getUniformLocation(accumProg, 'uDpr');
    this.uAccumDecay = gl.getUniformLocation(accumProg, 'uDecayBase');
    this.uAccumDtFrames = gl.getUniformLocation(accumProg, 'uDtFrames');

    this.aBloomPos = gl.getAttribLocation(bloomProg, 'aPosition');
    this.uBloomTex = gl.getUniformLocation(bloomProg, 'uTex');
    this.uBloomTexelSize = gl.getUniformLocation(bloomProg, 'uTexelSize');
    this.uBloomDirection = gl.getUniformLocation(bloomProg, 'uDirection');
    this.uBloomPrefilter = gl.getUniformLocation(bloomProg, 'uPrefilter');

    this.aCompPos = gl.getAttribLocation(compProg, 'aPosition');
    this.uCompSource = gl.getUniformLocation(compProg, 'uSourceTex');
    this.uCompAccum = gl.getUniformLocation(compProg, 'uAccumTex');
    this.uCompBloom = gl.getUniformLocation(compProg, 'uBloomTex');
    this.uCompRes = gl.getUniformLocation(compProg, 'uResolution');
    this.uCompDpr = gl.getUniformLocation(compProg, 'uDpr');
    this.uCompTime = gl.getUniformLocation(compProg, 'uTime');
    this.uCompCrtIntensity = gl.getUniformLocation(compProg, 'uCrtIntensity');
    this.uCompScanlineStrength = gl.getUniformLocation(compProg, 'uScanlineStrength');
    this.uCompGrilleStrength = gl.getUniformLocation(compProg, 'uGrilleStrength');
    this.uCompRasterQuant = gl.getUniformLocation(compProg, 'uRasterQuant');
    this.uCompBloomGain = gl.getUniformLocation(compProg, 'uBloomGain');
    this.uCompTrailGain = gl.getUniformLocation(compProg, 'uTrailGain');
    this.uCompDegauss = gl.getUniformLocation(compProg, 'uDegauss');
    this.uCompInterference = gl.getUniformLocation(compProg, 'uInterference');
    this.uCompGlitch = gl.getUniformLocation(compProg, 'uGlitch');
    this.uCompOverdrive = gl.getUniformLocation(compProg, 'uOverdrive');
    this.uCompTubeTurnOn = gl.getUniformLocation(compProg, 'uTubeTurnOn');
    this.uCompPhosphorMode = gl.getUniformLocation(compProg, 'uPhosphorMode');
    this.uCompChromaScale = gl.getUniformLocation(compProg, 'uChromaScale');
    this.uCompShockwaves = gl.getUniformLocation(compProg, 'uShockwaves[0]');
  }

  private createLinearTexture(gl: WebGLRenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private buildFboTarget(gl: WebGLRenderingContext, width: number, height: number): FboTarget | null {
    const tex = this.createLinearTexture(gl);
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, tex };
  }

  private ensurePingPongFbos(gl: WebGLRenderingContext, width: number, height: number): void {
    if (this.pingPong && this.fboWidth === width && this.fboHeight === height) {
      return;
    }

    if (this.pingPong) {
      for (const target of this.pingPong) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.tex);
      }
      this.pingPong = null;
    }

    const t0 = this.buildFboTarget(gl, width, height);
    const t1 = this.buildFboTarget(gl, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (t0 && t1) {
      this.pingPong = [t0, t1];
      this.fboWidth = width;
      this.fboHeight = height;
      this.readIdx = 0;
    }
  }

  private clearPingPongFbos(gl: WebGLRenderingContext): void {
    if (!this.pingPong) return;
    gl.clearColor(0, 0, 0, 1);
    for (const target of this.pingPong) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, this.fboWidth, this.fboHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private ensureBloomFbos(gl: WebGLRenderingContext, width: number, height: number): void {
    const bw = Math.max(1, width >> 1);
    const bh = Math.max(1, height >> 1);
    if (this.bloomTargets && this.bloomWidth === bw && this.bloomHeight === bh) {
      return;
    }

    if (this.bloomTargets) {
      for (const target of this.bloomTargets) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.tex);
      }
      this.bloomTargets = null;
    }

    const b0 = this.buildFboTarget(gl, bw, bh);
    const b1 = this.buildFboTarget(gl, bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (b0 && b1) {
      this.bloomTargets = [b0, b1];
      this.bloomWidth = bw;
      this.bloomHeight = bh;
    }
  }

  private buildProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('WebGL link warning:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('WebGL Shader compile warning:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public mapClientToCrtUv(
    clientX: number,
    clientY: number,
    crtRect: ViewportRect,
    crtIntensity: number
  ): { u: number; v: number; inside: boolean } {
    const rawU = (clientX - crtRect.x) / Math.max(1, crtRect.width);
    const rawV = (clientY - crtRect.y) / Math.max(1, crtRect.height);
    if (rawU < 0 || rawU > 1 || rawV < 0 || rawV > 1) {
      return { u: Math.max(0, Math.min(1, rawU)), v: Math.max(0, Math.min(1, rawV)), inside: false };
    }

    const dial = Math.max(0, Math.min(1, crtIntensity));
    if (dial <= 0.0001) {
      return { u: rawU, v: rawV, inside: true };
    }

    const amount = dial * 0.95;
    let cx = rawU * 2.0 - 1.0;
    let cy = rawV * 2.0 - 1.0;
    const r2 = cx * cx + cy * cy;
    const k1 = 0.105 * amount;
    const k2 = 0.032 * amount;
    const scale = (1.0 + k1 * r2 + k2 * r2 * r2) * (1.0 - 0.022 * amount);
    cx *= scale;
    cy *= scale;

    const u = cx * 0.5 + 0.5;
    const v = cy * 0.5 + 0.5;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    return {
      u: Math.max(0, Math.min(1, u)),
      v: Math.max(0, Math.min(1, v)),
      inside,
    };
  }

  public render(
    sourceCanvas: HTMLCanvasElement,
    crtRectCss: ViewportRect,
    dpr: number,
    timeSec: number,
    crtIntensity: number,
    interference: number,
    glitch: number,
    overdrive: number,
    tubeTurnOn = 0,
    shockwaves?: readonly CrtShockwaveUniform[],
    phosphorMode = 0,
    chromaScale = 0.0,
    preset: CrtPreset = 'CRISP'
  ): void {
    const gl = this.gl;
    if (
      !gl ||
      !this.cleanProgram ||
      !this.accumProgram ||
      !this.bloomProgram ||
      !this.compositeProgram ||
      !this.sourceTexture
    ) {
      if (this.fallback2d) {
        this.fallback2d.fillStyle = '#0A0D0B';
        this.fallback2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.fallback2d.drawImage(
          sourceCanvas,
          crtRectCss.x * dpr,
          crtRectCss.y * dpr,
          crtRectCss.width * dpr,
          crtRectCss.height * dpr
        );
      }
      return;
    }

    const dtSec =
      this.lastRenderTime < 0
        ? 1 / 60
        : Math.max(0.004, Math.min(0.1, timeSec - this.lastRenderTime));
    this.lastRenderTime = timeSec;
    const dtFrames = dtSec * 60.0;

    if (this.degaussTimer > 0) {
      this.degaussTimer = Math.max(0, this.degaussTimer - dtSec);
    }
    const degaussNorm = this.degaussTimer / this.degaussDuration;
    const profile = CRT_PRESET_CONFIG[preset] ?? CRT_PRESET_CONFIG.CRISP;

    const srcW = Math.max(1, sourceCanvas.width);
    const srcH = Math.max(1, sourceCanvas.height);

    // Upload 2D offscreen framebuffer to source texture
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    if (this.texWidth !== srcW || this.texHeight !== srcH) {
      this.texWidth = srcW;
      this.texHeight = srcH;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    const vpX = Math.round(crtRectCss.x * dpr);
    const vpW = Math.round(crtRectCss.width * dpr);
    const vpH = Math.round(crtRectCss.height * dpr);
    const vpY = Math.round(this.canvas.height - (crtRectCss.y + crtRectCss.height) * dpr);

    // =========================================================================
    // ZERO-OVERHEAD CLEAN PATH (1979 CRT: OFF) — 1 direct pass, 0 FBO binds
    // =========================================================================
    if (!profile.enabled1979) {
      this.lastWas1979 = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(vpX, vpY, vpW, vpH);
      gl.useProgram(this.cleanProgram);

      gl.enableVertexAttribArray(this.aCleanPos);
      gl.vertexAttribPointer(this.aCleanPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.uniform1i(this.uCleanSource, 0);
      gl.uniform1f(this.uCleanTime, timeSec);
      gl.uniform1f(this.uCleanTubeTurnOn, tubeTurnOn);
      gl.uniform1f(this.uCleanDegauss, degaussNorm);
      if (this.uCleanPhosphorMode) {
        gl.uniform1f(this.uCleanPhosphorMode, phosphorMode);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return;
    }

    // =========================================================================
    // HEAVY 1979 MU-TH-UR 6000 CRT MULTI-PASS PIPELINE (1979 CRT: ON)
    // Pass 1: Ping-pong phosphor persistence
    // Pass 2 & 3: Half-res separable Gaussian bloom (H -> V)
    // Pass 4: Trinitron aperture grille, scanlines, misconvergence, curvature
    // =========================================================================
    this.ensurePingPongFbos(gl, srcW, srcH);
    this.ensureBloomFbos(gl, srcW, srcH);
    if (!this.lastWas1979) {
      this.clearPingPongFbos(gl);
      this.lastWas1979 = true;
    }

    // Pass 1: Phosphor Persistence / Afterglow Buffer
    let accumTexToSample: WebGLTexture = this.sourceTexture;
    if (this.pingPong) {
      const readTarget = this.pingPong[this.readIdx];
      const writeIdx = 1 - this.readIdx;
      const writeTarget = this.pingPong[writeIdx];

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, srcW, srcH);
      gl.useProgram(this.accumProgram);

      gl.enableVertexAttribArray(this.aAccumPos);
      gl.vertexAttribPointer(this.aAccumPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.uniform1i(this.uAccumSource, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
      gl.uniform1i(this.uAccumPrev, 1);

      gl.uniform2f(this.uAccumRes, srcW, srcH);
      if (this.uAccumDpr) {
        gl.uniform1f(this.uAccumDpr, dpr);
      }
      gl.uniform1f(this.uAccumDecay, profile.decayBase);
      gl.uniform1f(this.uAccumDtFrames, dtFrames);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      this.readIdx = writeIdx;
      accumTexToSample = writeTarget.tex;
    }

    // Pass 2 & Pass 3: Half-Res Separable 9-Tap Gaussian Bloom (Electron Focus & Glass Halation)
    let bloomTexToSample: WebGLTexture = accumTexToSample;
    if (this.bloomTargets) {
      const [bloomH, bloomV] = this.bloomTargets;
      const blurScale = 1.65 * Math.max(1.0, dpr * 0.85);
      const texelX = blurScale / Math.max(1, this.bloomWidth);
      const texelY = blurScale / Math.max(1, this.bloomHeight);

      gl.useProgram(this.bloomProgram);
      gl.enableVertexAttribArray(this.aBloomPos);
      gl.vertexAttribPointer(this.aBloomPos, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, this.bloomWidth, this.bloomHeight);

      // Pass 2: Prefilter + Horizontal Gaussian
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomH.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accumTexToSample);
      gl.uniform1i(this.uBloomTex, 0);
      gl.uniform2f(this.uBloomTexelSize, texelX, texelY);
      gl.uniform2f(this.uBloomDirection, 1.0, 0.0);
      gl.uniform1f(this.uBloomPrefilter, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Pass 3: Vertical Gaussian
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomV.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bloomH.tex);
      gl.uniform1i(this.uBloomTex, 0);
      gl.uniform2f(this.uBloomTexelSize, texelX, texelY);
      gl.uniform2f(this.uBloomDirection, 0.0, 1.0);
      gl.uniform1f(this.uBloomPrefilter, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      bloomTexToSample = bloomV.tex;
    }

    // Pass 4: Final Trinitron CRT Composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.015, 0.022, 0.018, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.viewport(vpX, vpY, vpW, vpH);
    gl.useProgram(this.compositeProgram);

    gl.enableVertexAttribArray(this.aCompPos);
    gl.vertexAttribPointer(this.aCompPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.uCompSource, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, accumTexToSample);
    gl.uniform1i(this.uCompAccum, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bloomTexToSample);
    if (this.uCompBloom) {
      gl.uniform1i(this.uCompBloom, 2);
    }

    gl.uniform2f(this.uCompRes, vpW, vpH);
    gl.uniform1f(this.uCompDpr, dpr);
    gl.uniform1f(this.uCompTime, timeSec);
    gl.uniform1f(this.uCompCrtIntensity, crtIntensity);
    if (this.uCompScanlineStrength) {
      gl.uniform1f(this.uCompScanlineStrength, profile.scanline);
    }
    if (this.uCompGrilleStrength) {
      gl.uniform1f(this.uCompGrilleStrength, profile.grille);
    }
    if (this.uCompRasterQuant) {
      gl.uniform1f(this.uCompRasterQuant, profile.rasterQuant);
    }
    if (this.uCompBloomGain) {
      gl.uniform1f(this.uCompBloomGain, profile.bloomGain);
    }
    if (this.uCompTrailGain) {
      gl.uniform1f(this.uCompTrailGain, profile.trailGain);
    }
    if (this.uCompDegauss) {
      gl.uniform1f(this.uCompDegauss, degaussNorm);
    }
    gl.uniform1f(this.uCompInterference, interference);
    gl.uniform1f(this.uCompGlitch, glitch);
    gl.uniform1f(this.uCompOverdrive, overdrive);
    gl.uniform1f(this.uCompTubeTurnOn, tubeTurnOn);
    if (this.uCompPhosphorMode) {
      gl.uniform1f(this.uCompPhosphorMode, phosphorMode);
    }
    if (this.uCompChromaScale) {
      gl.uniform1f(this.uCompChromaScale, chromaScale);
    }

    if (this.uCompShockwaves) {
      this.shockwaveUploadBuf.fill(0);
      if (shockwaves && shockwaves.length > 0) {
        const count = Math.min(4, shockwaves.length);
        for (let i = 0; i < count; i++) {
          const sw = shockwaves[i];
          const base = i * 4;
          this.shockwaveUploadBuf[base] = sw.uvX;
          this.shockwaveUploadBuf[base + 1] = 1.0 - sw.uvY;
          this.shockwaveUploadBuf[base + 2] = sw.radius;
          this.shockwaveUploadBuf[base + 3] = sw.intensity;
        }
      }
      gl.uniform4fv(this.uCompShockwaves, this.shockwaveUploadBuf);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
