import type { CrtShockwaveUniform } from '../shell/Cartridge';
import type { ViewportRect } from '../types';

const VERTEX_SHADER_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Pass 1: Ping-Pong P39 Green & Golden-Amber Phosphor Persistence Buffer
 */
const ACCUM_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uPrevTex;
uniform vec2 uResolution;
uniform float uDecayBase;
uniform float uDtFrames;

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));

  // Subtle sub-pixel beam warmth (keeps static UI text clean without multi-pixel smear)
  vec3 c0 = texture2D(uSourceTex, vUv).rgb;
  vec3 cL = texture2D(uSourceTex, clamp(vUv - vec2(texel.x * 0.75, 0.0), 0.001, 0.999)).rgb;
  vec3 cR = texture2D(uSourceTex, clamp(vUv + vec2(texel.x * 0.75, 0.0), 0.001, 0.999)).rgb;
  vec3 beam = c0 * 0.86 + cL * 0.07 + cR * 0.07;

  // Aligned persistence buffer: moving vectors leave lush P39 trails; static text stays clean
  vec3 prev = texture2D(uPrevTex, vUv).rgb;

  vec3 channelDecay = pow(
    vec3(uDecayBase - 0.008, uDecayBase + 0.008, uDecayBase - 0.025),
    vec3(uDtFrames)
  );
  vec3 decayed = prev * channelDecay;
  decayed *= smoothstep(0.015, 0.056, max(decayed.r, max(decayed.g, decayed.b)));

  gl_FragColor = vec4(max(beam, decayed), 1.0);
}
`;

/**
 * Pass 2: 1970s Sony Trinitron Vertical Aperture Grille + RGB Misconvergence CRT Shader
 * - Integer DPI-locked screen-space vertical aperture grille (zero moire at fullscreen!)
 *   interlocking with fine horizontal scanlines so strokes split into crisp vertical phosphor bars.
 * - Subtle horizontal RGB subpixel misconvergence producing warm-amber & cool-violet edge fringes,
 *   stronger toward curved glass corners (matching the 1979 Alien topographic monitor).
 */
const COMPOSITE_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uAccumTex;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uCrtIntensity;   // 0.0 .. 1.0 (starts at 0.50 = 50%)
uniform float uInterference;   // 0.0 .. 1.0
uniform float uGlitch;         // 0.0 .. 1.0
uniform float uOverdrive;      // 0.0 .. 1.0
uniform float uTubeTurnOn;     // 1.0 at cold ignition -> 0.0 when warmed up
uniform float uPhosphorMode;   // 0 = P39 GREEN, 1 = P3 AMBER, 2 = MEDBAY CYAN
uniform float uChromaScale;    // 0.0 .. 1.0 (default 1.0; lowered in text-dense CAD views)
uniform vec4 uShockwaves[4];   // xy = uv center (WebGL bottom-up), z = radius (norm H), w = intensity

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
  // At 0% intensity dial, glass curvature is 0% (flat); scales smoothly up with dial (plus transient yoke swell on ignition)
  float curveAmt = clamp(dial * 0.95 + turnOn * turnOn * 0.85, 0.0, 1.45);
  vec2 uv = warpUV(vUv, curveAmt);

  // Cold-cathode 1979 magnetic deflection yoke distortion when tube first snaps on!
  if (turnOn > 0.001) {
    vec2 tc = uv * 2.0 - 1.0;
    float sCurveX = sin(tc.y * 7.5 + uTime * 46.0) * 0.19 * turnOn * turnOn
                  + cos(tc.y * 19.0 - uTime * 68.0) * 0.055 * turnOn;
    float yokeBowY = sin(tc.x * 4.2 + uTime * 34.0) * 0.09 * turnOn * turnOn;
    // Brief vertical deflection snap-open with magnetic overshoot ring
    float openProg = 1.0 - turnOn;
    float vStretch = mix(0.05, 1.0, smoothstep(0.0, 0.34, openProg))
                   + sin(openProg * 22.0) * exp(-openProg * 4.5) * 0.14;
    tc.x = (tc.x + sCurveX) / max(0.32, 1.0 - 0.35 * turnOn * turnOn);
    tc.y = (tc.y + yokeBowY) / max(0.045, vStretch);
    uv = tc * 0.5 + 0.5;
  }

  float cornerR = dial * 0.058;
  float mask = cornerR > 0.001 ? roundedTubeMask(uv, cornerR) : 1.0;
  if (mask <= 0.001 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    vec2 edgeDist = abs(vUv * 2.0 - 1.0);
    float rim = smoothstep(0.995, 0.92, max(edgeDist.x, edgeDist.y));
    float grain = (hash12(gl_FragCoord.xy * 0.5) - 0.5) * 0.014;
    vec3 bezelCol = mix(vec3(0.018, 0.024, 0.020), vec3(0.050, 0.064, 0.054), rim * 0.55) + grain;
    bezelCol = mix(bezelCol, vec3(0.004, 0.001, 0.001), clamp(turnOn * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(bezelCol, 1.0);
    return;
  }

  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 tubeCentered = uv * 2.0 - 1.0;
  float cornerR2 = dot(tubeCentered, tubeCentered);

  // Dynamic Signal Tear & Micro 60Hz Deflection Jitter
  float hvJitterX = sin(uTime * 376.99 + uv.y * 42.0) * 0.30 * dial * texel.x;
  float totalDisturb = clamp(uInterference * 0.62 + uGlitch * 1.25 + uOverdrive * 0.35, 0.0, 1.6);
  float tearWave = sin(uv.y * 29.0 + uTime * 21.0) * sin(uv.y * 8.5 - uTime * 13.0);
  float tearGate = step(0.74 - min(0.58, uGlitch * 0.52 + uOverdrive * 0.18 + uInterference * 0.24), abs(tearWave));
  float tearShift = tearGate * (hash12(vec2(floor(uv.y * 95.0), floor(uTime * 38.0))) - 0.5) * 0.038 * totalDisturb;

  // Localized Physical CRT Shockwave Distortion (EMP blasts & Dome impacts; zero cost when w <= 0.001)
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
  vec2 rawSampleUv = clamp(uv + shockUvOffset + vec2(hvJitterX + tearShift, 0.0), uvMin, uvMax);

  // Native 1:1 texel-locked sampling at flat precision mode (dial=0) so UI glyphs stay razor-sharp;
  // vintage raster stepping only engages smoothly when CRT intensity dial is raised above 0.
  vec2 sampleUv = rawSampleUv;
  if (dial > 0.005) {
    float rasterPitch = max(1.0, (1.0 + 0.45 * dial) * uDpr);
    vec2 gridDims = max(vec2(300.0), floor(uResolution / rasterPitch));
    vec2 quantUv = (floor(rawSampleUv * gridDims) + 0.5) / gridDims;
    sampleUv = mix(rawSampleUv, quantUv, dial * 0.45);
  }

  // =========================================================================
  // BALANCED 1979 ANALOG RGB BEAM CONVERGENCE (Warm-Amber / Cool-Violet Edge)
  // Retains signature Nostromo CRT sheen without double-vision on small HUD text!
  // =========================================================================
  vec3 sampMid = texture2D(uSourceTex, sampleUv).rgb;

  float chroma = clamp(uChromaScale, 0.0, 1.0);
  float eventDisturb = clamp(totalDisturb * 0.90 + shockChromaBoost * 0.95 + turnOn, 0.0, 1.0);
  float misconvPx = (0.55 + cornerR2 * 1.15) * (0.40 + 0.60 * dial) * uDpr * chroma
                  + totalDisturb * 2.8 * uDpr
                  + shockChromaBoost * 5.2 * uDpr
                  + turnOn * turnOn * 20.0 * uDpr;
  vec2 misconvVec = vec2(misconvPx * texel.x, tubeCentered.y * 0.30 * misconvPx * texel.y);

  vec3 sampLeft  = texture2D(uSourceTex, clamp(sampleUv - misconvVec, uvMin, uvMax)).rgb;
  vec3 sampRight = texture2D(uSourceTex, clamp(sampleUv + misconvVec, uvMin, uvMax)).rgb;

  float lumLeft  = max(sampLeft.r, max(sampLeft.g, sampLeft.b));
  float lumMid   = max(sampMid.r, max(sampMid.g, sampMid.b));
  float lumRight = max(sampRight.r, max(sampRight.g, sampRight.b));

  float warmFringeMask = max(0.0, lumLeft - lumMid * 0.70);
  float coolFringeMask = max(0.0, lumRight - lumMid * 0.70);
  float idleFringe = mix(0.20, 0.78, chroma);
  float fringeAmt = clamp(max(idleFringe, eventDisturb), 0.0, 1.0);
  float warmStrength = mix(0.26 + 0.22 * cornerR2, 0.42 + 0.34 * cornerR2, max(dial, eventDisturb));
  float coolStrength = mix(0.28 + 0.24 * cornerR2, 0.44 + 0.38 * cornerR2, max(dial, eventDisturb));

  vec3 liveC = sampMid
             + vec3(1.00, 0.64, 0.14) * warmFringeMask * warmStrength * fringeAmt
             + vec3(0.48, 0.30, 1.00) * coolFringeMask * coolStrength * fringeAmt;

  // =========================================================================
  // PHOSPHOR PERSISTENCE TRAILS (Golden-Amber & P39 Green Glow)
  // =========================================================================
  vec3 accumC = texture2D(uAccumTex, sampleUv).rgb * 0.88 +
                texture2D(uAccumTex, clamp(sampleUv - vec2(texel.x * 0.45, 0.0), uvMin, uvMax)).rgb * 0.12;
  vec3 ghostTail = max(accumC - sampMid, vec3(0.0));
  float tailWarmth = smoothstep(0.04, 0.30, ghostTail.r - ghostTail.g * 0.65);
  vec3 trailTint = mix(vec3(0.86, 1.02, 0.78), vec3(1.08, 0.78, 0.28), tailWarmth);
  vec3 beamWithPersistence = liveC + ghostTail * trailTint * (0.68 + 0.30 * dial);

  // =========================================================================
  // TIGHT AUTHENTIC P39 PHOSPHOR HALATION / GLOW (Lush CRT Aura, Crisp Text)
  // =========================================================================
  vec3 localHalo = vec3(0.0);
  float rTight = (0.95 + dial * 0.80) * uDpr;
  float rMid = (1.95 + dial * 1.40) * uDpr;

  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rTight, 0.0) * texel, uvMin, uvMax)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rTight, 0.0) * texel, uvMin, uvMax)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0,  rTight) * texel, uvMin, uvMax)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0, -rTight) * texel, uvMin, uvMax)).rgb * 0.16;

  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rMid,  rMid) * 0.71 * texel, uvMin, uvMax)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rMid,  rMid) * 0.71 * texel, uvMin, uvMax)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rMid, -rMid) * 0.71 * texel, uvMin, uvMax)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rMid, -rMid) * 0.71 * texel, uvMin, uvMax)).rgb * 0.09;

  vec3 bloomCol = max(localHalo - vec3(0.11), vec3(0.0)) * (0.13 + 0.14 * dial);
  float bloomWarmth = smoothstep(0.03, 0.25, bloomCol.r - bloomCol.g * 0.65);
  vec3 bloomTint = mix(vec3(0.84, 1.02, 0.88), vec3(1.10, 0.80, 0.34), bloomWarmth);

  // Deep Nostromo CRT Contrast Floor + Subtle Shockwave Phosphor Surge
  vec3 cathodeFloor = vec3(0.012, 0.025, 0.016) * (1.0 - cornerR2 * 0.36);
  vec3 col = cathodeFloor + beamWithPersistence * 1.02 + bloomCol * bloomTint;
  if (shockRingGlow > 0.001) {
    col += vec3(0.36, 0.95, 0.56) * shockRingGlow * 0.14;
  }

  // High-voltage CRT tube ignition flash: distorted anamorphic discharge wave & phosphor surge
  if (turnOn > 0.001) {
    float openProg = 1.0 - turnOn;
    float arcLine = exp(-abs(tubeCentered.y + sin(tubeCentered.x * 6.5 + uTime * 42.0) * 0.12) * (18.0 - 13.0 * turnOn));
    float screenSurge = sin(clamp(openProg / 0.55, 0.0, 1.0) * 3.14159265) * turnOn;
    float centerHot = exp(-dot(tubeCentered * vec2(0.65, 1.35), tubeCentered * vec2(0.65, 1.35)) * 2.4);
    vec3 flashTint = mix(vec3(1.00, 0.26, 0.16), vec3(1.15, 0.94, 0.86), clamp(arcLine * 0.7 + centerHot * 0.5, 0.0, 1.0));
    col += flashTint * (arcLine * turnOn * 1.35 + screenSurge * (0.55 + 0.65 * centerHot));
  }

  // =========================================================================
  // AUTHENTIC 1970s TRINITRON VERTICAL APERTURE GRILLE + INTERLOCKED SCANLINES
  // Exact integer physical pixel pitch (zero moire at DPR 1.0, 1.5, 2.0!).
  // Single-wire column geometry + balanced spot bloom keeps crisp 1979 phosphor
  // bar texture visibly woven across text without chopping thin letter stems!
  // =========================================================================
  float colPeriod = max(3.0, floor(3.0 * uDpr + 0.5));
  float rowPeriod = max(2.0, floor(2.0 * uDpr + 0.5));

  vec2 grilleCoord = gl_FragCoord.xy + shockUvOffset * uResolution * 0.9;
  float colNorm = mod(floor(grilleCoord.x), colPeriod) / colPeriod;
  float rowNorm = mod(floor(grilleCoord.y), rowPeriod) / rowPeriod;

  // Distinct vertical phosphor segment with tungsten wire gap on 1-of-N columns
  float distColCenter = abs(colNorm - 0.5) * 2.0;
  float verticalGrille = 1.0 - (0.27 + 0.26 * dial) * smoothstep(0.50, 0.98, distColCenter);

  // Authentic Trinitron RGB phosphor triad micro-tint
  float subTriad = colNorm - 0.5;
  vec3 apertureTint = vec3(
    1.0 + subTriad * (0.09 + 0.06 * dial),
    1.0 - abs(subTriad) * (0.04 + 0.025 * dial),
    1.0 - subTriad * (0.10 + 0.07 * dial)
  );

  // True alternating horizontal scanlines across all DPR scales
  float distRowCenter = abs(rowNorm - 0.5) * 2.0;
  float horizScan = 1.0 - (0.18 + 0.20 * dial) * smoothstep(0.48, 0.98, distRowCenter);

  float peakLum = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  float brightSpot = smoothstep(0.20, 0.88, peakLum);
  float rawMask = verticalGrille * horizScan;
  float combinedMask = mix(rawMask, mix(rawMask, 1.0, 0.36), brightSpot);
  col *= combinedMask * apertureTint;

  // Soft analog highlight roll-off + subtle 60Hz cathode hum
  col = col / (1.0 + col * 0.10);
  col *= 1.0 - (0.007 + 0.011 * dial) * sin(uTime * 376.991);

  float snowAmt = uInterference * 0.13 + uGlitch * 0.26 + uOverdrive * 0.03 + 0.012;
  float snow = hash12(floor(gl_FragCoord.xy / max(1.0, uDpr)) + vec2(floor(uTime * 30.0) * 17.3, 9.1)) - 0.5;
  col += vec3(0.28, 0.72, 0.42) * snow * snowAmt;

  // Subtle Curved Glass Corner Glare & Moody Nostromo Edge Vignette
  vec2 glarePos1 = tubeCentered - vec2(-0.34, 0.42);
  float warmLampGlare = exp(-dot(glarePos1, glarePos1) * 5.8) * (0.048 * dial);
  col += vec3(0.90, 0.78, 0.60) * warmLampGlare;

  float vignette = clamp(1.0 - cornerR2 * (0.055 + 0.24 * dial), 0.42, 1.0);
  float edgeShadow = smoothstep(0.0, 0.055, 1.0 - max(abs(tubeCentered.x), abs(tubeCentered.y)));
  col *= vignette * mix(1.0, mix(0.26, 1.0, edgeShadow), dial);

  // Dynamic MU-TH-UR 6000 Phosphor Palette Shift (PHOSPHOR GREEN | AMBER | CYAN)
  if (uPhosphorMode > 0.5 && uPhosphorMode < 1.5) {
    float lum = dot(col, vec3(0.32, 0.58, 0.10));
    float alertness = clamp((col.r - col.g) * 1.45, 0.0, 1.0);
    vec3 amberTone = vec3(1.14, 0.66, 0.10) * lum * 1.16;
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

  private accumProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private pingPong: [FboTarget, FboTarget] | null = null;
  private readIdx = 0;
  private fboWidth = 0;
  private fboHeight = 0;
  private texWidth = 0;
  private texHeight = 0;
  private lastRenderTime = -1;

  private aAccumPos = -1;
  private uAccumSource: WebGLUniformLocation | null = null;
  private uAccumPrev: WebGLUniformLocation | null = null;
  private uAccumRes: WebGLUniformLocation | null = null;
  private uAccumDecay: WebGLUniformLocation | null = null;
  private uAccumDtFrames: WebGLUniformLocation | null = null;

  private aCompPos = -1;
  private uCompSource: WebGLUniformLocation | null = null;
  private uCompAccum: WebGLUniformLocation | null = null;
  private uCompRes: WebGLUniformLocation | null = null;
  private uCompDpr: WebGLUniformLocation | null = null;
  private uCompTime: WebGLUniformLocation | null = null;
  private uCompCrtIntensity: WebGLUniformLocation | null = null;
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

    const accumProg = this.buildProgram(gl, VERTEX_SHADER_SRC, ACCUM_FRAGMENT_SRC);
    const compProg = this.buildProgram(gl, VERTEX_SHADER_SRC, COMPOSITE_FRAGMENT_SRC);
    if (!accumProg || !compProg) {
      this.fallback2d = this.canvas.getContext('2d');
      return;
    }

    this.gl = gl;
    this.accumProgram = accumProg;
    this.compositeProgram = compProg;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.sourceTexture = this.createLinearTexture(gl);

    this.aAccumPos = gl.getAttribLocation(accumProg, 'aPosition');
    this.uAccumSource = gl.getUniformLocation(accumProg, 'uSourceTex');
    this.uAccumPrev = gl.getUniformLocation(accumProg, 'uPrevTex');
    this.uAccumRes = gl.getUniformLocation(accumProg, 'uResolution');
    this.uAccumDecay = gl.getUniformLocation(accumProg, 'uDecayBase');
    this.uAccumDtFrames = gl.getUniformLocation(accumProg, 'uDtFrames');

    this.aCompPos = gl.getAttribLocation(compProg, 'aPosition');
    this.uCompSource = gl.getUniformLocation(compProg, 'uSourceTex');
    this.uCompAccum = gl.getUniformLocation(compProg, 'uAccumTex');
    this.uCompRes = gl.getUniformLocation(compProg, 'uResolution');
    this.uCompDpr = gl.getUniformLocation(compProg, 'uDpr');
    this.uCompTime = gl.getUniformLocation(compProg, 'uTime');
    this.uCompCrtIntensity = gl.getUniformLocation(compProg, 'uCrtIntensity');
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

    const buildTarget = (): FboTarget | null => {
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
    };

    const t0 = buildTarget();
    const t1 = buildTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (t0 && t1) {
      this.pingPong = [t0, t1];
      this.fboWidth = width;
      this.fboHeight = height;
      this.readIdx = 0;
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
    chromaScale = 1.0
  ): void {
    const gl = this.gl;
    if (!gl || !this.accumProgram || !this.compositeProgram || !this.sourceTexture) {
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

    const srcW = Math.max(1, sourceCanvas.width);
    const srcH = Math.max(1, sourceCanvas.height);

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

    this.ensurePingPongFbos(gl, srcW, srcH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

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

      const decayBase = 0.904 + Math.max(0, Math.min(1, crtIntensity)) * 0.046;
      gl.uniform2f(this.uAccumRes, srcW, srcH);
      gl.uniform1f(this.uAccumDecay, decayBase);
      gl.uniform1f(this.uAccumDtFrames, dtFrames);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      this.readIdx = writeIdx;
      accumTexToSample = writeTarget.tex;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.039, 0.051, 0.043, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vpX = Math.round(crtRectCss.x * dpr);
    const vpW = Math.round(crtRectCss.width * dpr);
    const vpH = Math.round(crtRectCss.height * dpr);
    const vpY = Math.round(this.canvas.height - (crtRectCss.y + crtRectCss.height) * dpr);

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

    gl.uniform2f(this.uCompRes, vpW, vpH);
    gl.uniform1f(this.uCompDpr, dpr);
    gl.uniform1f(this.uCompTime, timeSec);
    gl.uniform1f(this.uCompCrtIntensity, crtIntensity);
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
          // WebGL texture coordinates are flipped vertically (UNPACK_FLIP_Y_WEBGL = 1)
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
