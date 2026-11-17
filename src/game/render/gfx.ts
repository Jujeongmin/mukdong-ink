// Renderer, scenes, camera and the ink post pass (from proto/ink-swordsman.html), retuned for a moonlit /
// dusk mood. The world scene is rendered to a color+depth target and a normal target; the ink shader turns
// it into paper and ink (edges from depth+normals, quantized washes); dyed materials (alpha 0.5) keep their
// color and glow a little against the dark; water (alpha ~0.05) mirrors the painted sky; skill "lights"
// reveal the world's color. Atmosphere lives here too: a painted sky with a haloed moon and cloud bands,
// four layers of distant silhouettes (karst, ridges or bamboo) sinking into mist, distance + height haze
// that fades into that sky, drifting ground mist, a dark foreground wash, a lightning flash. The overlay scene (skill VFX, rain, fireflies) is drawn on top
// in full color.

import * as THREE from "three";

export const scene = new THREE.Scene();
export const overlay = new THREE.Scene();
const BG = new THREE.Color(0xe9eee7);
const BLACK = new THREE.Color(0x000000);
scene.background = BG;
// A cool sky/ground fill and a moon key light from behind-left: faces turned to the camera sink into ink,
// tops and backs catch a cold rim.
const hemi = new THREE.HemisphereLight(0xb8c6e0, 0x3c3a46, 1.25);
scene.add(hemi);
const moonLight = new THREE.DirectionalLight(0xc6d6ff, 2.2);
moonLight.position.set(-24, 30, -26);
scene.add(moonLight);

export const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
/** Camera forward, kept current every frame (ribbons face the camera with it). */
export const camFwd = new THREE.Vector3(0, 0, -1);
/** The ground point the camera follows (the player, give or take the look-ahead); set with the camera. */
export const camFocus = new THREE.Vector3();
/**
 * Objects that are fading out (a gate between the camera and the player): left out of the normal pass,
 * so the ink pass draws no outline for them. world.ts adds/removes its own meshes.
 */
export const noNormalPass = new Set<THREE.Object3D>();

/** Screen feel shared by gameplay and effects. */
export const feel = { shake: 0, hitstop: 0, time: 0 };

/* ---------- zone mood (sky, haze, palette, lights); colors are display-space rgb 0..1 ---------- */
export interface Mood {
  paper: readonly number[];
  ink: readonly number[];
  skyTop: readonly number[];
  skyLow: readonly number[];
  mist: readonly number[];
  /** screen uv x, uv y, radius (0 = hidden), strength */
  moon: readonly number[];
  fogLow: number;
  hazeNear: number;
  hazeFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  moonCol: number;
  moonI: number;
  /** painted backdrop: 0 = soft ridges, 1 = tall karst pillars */
  pillars: number;
  /** backdrop height scale */
  pillarH: number;
  /** 1 = the two near backdrop layers are distant bamboo instead of ridges */
  stalks: number;
  /** warm/pale glow along the horizon behind the silhouettes (0..1) */
  glow: number;
  /** brushed cloud bands in the sky (0..1.5); storm clouds are darker */
  clouds: number;
  /** dark wash along the bottom of the screen (painted foreground, 0..1) */
  fgDark: number;
  /** where the key light (and the shadows it casts) comes from: [azimuth deg, elevation deg], +x east, -z north */
  sun: readonly number[];
  /** baked scenery shadow: [strength 0..1 (a linear-space multiply), softness, contact fade length in world units] */
  shade: readonly number[];
  /**
   * The disc in the sky as a lightless paper-white sun instead of a moon: 0 = moon (halo, maria);
   * > 0 = flat paper disc with ink bleeding in from its rim, this thick (0.05 thin .. 0.4 heavy)
   */
  sunRing?: number;
  /** how fast the sky darkens above the horizon (0.7 default; small = a thin paper band under dark ink) */
  skyPow?: number;
  /** 0..1: fewer mid tones in the ink pass (the boss yard: only deep ink and sharp paper) */
  contrast?: number;
}
const moodU = {
  uPaper: { value: new THREE.Vector3(0.66, 0.7, 0.76) },
  uInk: { value: new THREE.Vector3(0.04, 0.05, 0.09) },
  uSkyTop: { value: new THREE.Vector3(0.16, 0.2, 0.32) },
  uSkyLow: { value: new THREE.Vector3(0.66, 0.72, 0.8) },
  uMist: { value: new THREE.Vector3(0.72, 0.77, 0.84) },
  uMoon: { value: new THREE.Vector4(0.78, 0.86, 0.05, 1) },
  uFogLow: { value: 0.5 },
  uHazeNear: { value: 24 },
  uHazeFar: { value: 62 },
  uFlash: { value: 0 },
  uHorizon: { value: 0.8 },
  uCamX: { value: 0 },
  uEdgeR: { value: 30 },
  uPillars: { value: 1 },
  uPillarH: { value: 1 },
  uStalks: { value: 0 },
  uGlow: { value: 0.3 },
  uClouds: { value: 0.6 },
  uFgDark: { value: 0 },
  /** quality: backdrop silhouette layers (2..4), distance haze bands (1..3), fine paper/stroke noise (0/1) */
  uLayers: { value: 4 },
  uBands: { value: 3 },
  uFine: { value: 1 },
  uSunRing: { value: 0 },
  uSkyPow: { value: 0.7 },
  uContrast: { value: 0 },
};
export function setMood(m: Mood): void {
  moodU.uPaper.value.fromArray(m.paper as number[]);
  moodU.uInk.value.fromArray(m.ink as number[]);
  moodU.uSkyTop.value.fromArray(m.skyTop as number[]);
  moodU.uSkyLow.value.fromArray(m.skyLow as number[]);
  moodU.uMist.value.fromArray(m.mist as number[]);
  moodU.uMoon.value.fromArray(m.moon as number[]);
  moodU.uFogLow.value = m.fogLow;
  moodU.uHazeNear.value = m.hazeNear;
  moodU.uHazeFar.value = m.hazeFar;
  hemi.color.setHex(m.hemiSky);
  hemi.groundColor.setHex(m.hemiGround);
  hemi.intensity = m.hemiI;
  moonLight.color.setHex(m.moonCol);
  moonLight.intensity = m.moonI;
  sunDir(m.sun, moonLight.position).multiplyScalar(40);
  moodU.uPillars.value = m.pillars;
  moodU.uPillarH.value = m.pillarH;
  moodU.uStalks.value = m.stalks;
  moodU.uGlow.value = m.glow;
  moodU.uClouds.value = m.clouds;
  moodU.uFgDark.value = m.fgDark;
  moodU.uSunRing.value = m.sunRing ?? 0;
  moodU.uSkyPow.value = m.skyPow ?? 0.7;
  moodU.uContrast.value = m.contrast ?? 0;
}
/** Where the painted backdrop sits: screen uv y of the field's far edge, and the camera x for parallax. */
export function setHorizon(uvY: number, camX: number): void {
  moodU.uHorizon.value = uvY;
  moodU.uCamX.value = camX;
}
/** Ground beyond this radius fades into the backdrop (the field's edge becomes the horizon). */
export function setEdge(r: number): void {
  moodU.uEdgeR.value = r;
}
/** Lightning: 0..1 brightens the sky and lifts the scene for a moment. */
export function setFlash(v: number): void {
  moodU.uFlash.value = v;
}

/* ---------- color lights (skill light reveals the world's color) ---------- */
export const LN = 8;
const lightU = Array.from({ length: LN }, () => new THREE.Vector4(0, 0, 0, 0));
const lightC = Array.from({ length: LN }, () => new THREE.Vector3(1, 1, 1));
interface Light {
  x: number;
  z: number;
  r: number;
  life: number;
  max: number;
  col: readonly number[];
  follow: { x: number; z: number } | null;
}
const lights: Light[] = Array.from({ length: LN }, () => ({ x: 0, z: 0, r: 0, life: 0, max: 1, col: [1, 1, 1], follow: null }));
let lightNext = 0;
export function addLight(x: number, z: number, r: number, life: number, col: readonly number[], follow: { x: number; z: number } | null = null): void {
  const L = lights[lightNext];
  lightNext = (lightNext + 1) % LN;
  L.x = x; L.z = z; L.r = r; L.life = life; L.max = life; L.col = col; L.follow = follow;
}
export function clearLights(): void {
  for (const L of lights) { L.life = 0; L.follow = null; }
}
function updateLights(dt: number): void {
  for (let i = 0; i < LN; i++) {
    const L = lights[i];
    if (L.life > 0) {
      L.life -= dt;
      if (L.follow) { L.x = L.follow.x; L.z = L.follow.z; }
      if (L.life <= 0) L.follow = null;
    }
    const k = L.life > 0 ? Math.min(1, (L.life / L.max) * 2.2) * Math.min(1, (L.max - L.life) * 8 + 0.3) : 0;
    lightU[i].set(L.x, L.z, L.r, k);
    lightC[i].set(L.col[0], L.col[1], L.col[2]);
  }
}

/* ---------- boss bloom: for a few seconds the world shows its own color, then the ink takes it back ---------- */
// A ring spreads from the fallen boss over the whole field (the same color reveal as skill light, tinted by
// the chapter's color), holds, and fades back to ink. Transient and the same for everyone in the room.
const bloomU = { uBloom: { value: new THREE.Vector4(0, 0, 0, 0) }, uBloomCol: { value: new THREE.Vector3(1, 1, 1) } };
const BLOOM_GROW = 1.4, BLOOM_HOLD = 1.6, BLOOM_FADE = 2.2, BLOOM_R = 70;
let bloomT = -1;
/** one-shot: called with the game canvas right after the frame where the bloom is at its fullest (화첩) */
let bloomPeak: ((canvas: HTMLCanvasElement) => void) | null = null;
let peakDue = false;
export function colorBloom(x: number, z: number, col: readonly number[], onPeak: ((canvas: HTMLCanvasElement) => void) | null = null): void {
  bloomU.uBloom.value.set(x, z, 0, 0);
  bloomU.uBloomCol.value.set(col[0], col[1], col[2]);
  bloomT = 0;
  bloomPeak = onPeak;
  peakDue = false;
}
export function clearBloom(): void {
  bloomT = -1;
  bloomU.uBloom.value.w = 0;
  bloomPeak = null;
  peakDue = false;
}
function updateBloom(dt: number): void {
  if (bloomT < 0) return;
  const before = bloomT;
  bloomT += dt;
  const peakAt = BLOOM_GROW + BLOOM_HOLD - 0.2; // late in the hold: the kill's ink debris has settled
  if (bloomPeak && before < peakAt && bloomT >= peakAt) peakDue = true;
  const g = Math.min(1, bloomT / BLOOM_GROW);
  const fade = (bloomT - BLOOM_GROW - BLOOM_HOLD) / BLOOM_FADE;
  const b = bloomU.uBloom.value;
  b.z = 2 + BLOOM_R * (1 - (1 - g) * (1 - g) * (1 - g)); // ease-out spread
  b.w = fade <= 0 ? 1 : Math.max(0, 1 - fade * fade * (3 - 2 * fade));
  if (fade >= 1) clearBloom();
}

/* ---------- ground marks in the overlay pass: hidden behind figures and props ---------- */
// The overlay pass draws after the ink post-process into a framebuffer with no scene depth, so marks lying on
// the ground (route, target ring) test themselves against the scene's depth texture here instead.
export const groundDepthU = {
  tSceneDepth: { value: null as THREE.Texture | null },
  uDepthRes: { value: new THREE.Vector2(4, 4) },
  uDNear: { value: camera.near },
  uDFar: { value: camera.far },
};
/** GLSL: `behindScene()` is true where something in the scene stands in front of this fragment. */
export const GROUND_DEPTH_GLSL = `
uniform sampler2D tSceneDepth;
uniform vec2 uDepthRes;
uniform float uDNear, uDFar;
float gdLin(float r) { float z = r * 2.0 - 1.0; return 2.0 * uDNear * uDFar / (uDFar + uDNear - z * (uDFar - uDNear)); }
bool behindScene() {
  float s = texture2D(tSceneDepth, gl_FragCoord.xy / uDepthRes).x;
  return gdLin(gl_FragCoord.z) > gdLin(s) + 0.3;
}`;

/* ---------- screen ink splashes ---------- */
const splashes = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1000, 0));
let splashIdx = 0;
const vProj = new THREE.Vector3();
export function screenSplash(x: number, y: number, z: number, size: number): void {
  vProj.set(x, y, z).project(camera);
  splashes[splashIdx].set(vProj.x * 0.5 + 0.5, vProj.y * 0.5 + 0.5, feel.time, size);
  splashIdx = (splashIdx + 1) % splashes.length;
}

/* ---------- renderer + post ---------- */
let renderer: THREE.WebGLRenderer | null = null;
let colorRT: THREE.WebGLRenderTarget;
let normalRT: THREE.WebGLRenderTarget;
let postMat: THREE.ShaderMaterial;
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

/* ---------- camera occlusion ----------
   Scenery between the camera and the player (bamboo stalks, trunks, pillars at the near rim) is cut away:
   a soft, dithered-edged hole along the camera->player line, in the colour pass and the normal pass alike
   (so no outline is left behind). Done in view space in every lit (Lambert) material and the normal pass;
   materials with their own onBeforeCompile (the ground, the figures' bodies) are untouched, and the last
   2.5 m before the player stay solid, so what is next to the player never vanishes. */
const occU = { uOccP: { value: new THREE.Vector3() }, uOccOn: { value: 0 } };
const OCC_FRAG = `
  if (uOccOn > 0.5) {
    float L2 = dot(uOccP, uOccP);
    float t = dot(vOccV, uOccP) / L2;
    float tMax = 1.0 - 2.5 / sqrt(L2);
    if (t > 0.0 && t < tMax) {
      float r = mix(2.6, 1.0, t);
      float k = (1.0 - smoothstep(r * 0.7, r, length(vOccV - uOccP * t))) * (1.0 - smoothstep(tMax - 0.1, tMax, t));
      if (k > fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453)) discard;
    }
  }
`;
function addOcclusion(sh: THREE.WebGLProgramParametersWithUniforms): void {
  sh.uniforms.uOccP = occU.uOccP;
  sh.uniforms.uOccOn = occU.uOccOn;
  // declared just before main (the normal pass's fragment shader has no <common> include)
  sh.vertexShader = sh.vertexShader
    .replace("void main() {", "varying vec3 vOccV;\nvoid main() {")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvOccV = mvPosition.xyz;");
  sh.fragmentShader = sh.fragmentShader
    .replace("void main() {", "varying vec3 vOccV;\nuniform vec3 uOccP;\nuniform float uOccOn;\nvoid main() {" + OCC_FRAG);
}
THREE.MeshLambertMaterial.prototype.onBeforeCompile = addOcclusion;
normalMat.onBeforeCompile = addOcclusion;
const _occ = new THREE.Vector3();
/** In the field the camera cuts scenery away between itself and the player (off on the title screen). */
export function setOcclusion(on: boolean): void {
  occU.uOccOn.value = on ? 1 : 0;
}
let DPR = 1;
let lastW = 0, lastH = 0;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor, tDepth, tNormal;
uniform vec2 uRes;
uniform float uAspect, uTime, uNear, uFar, uEdge, uBleed, uTones;
uniform mat4 uInvProj, uCamWorld;
uniform vec4 uLight[${LN}];
uniform vec3 uLightCol[${LN}];
uniform vec4 uSplash[6];
uniform vec3 uPaper, uInk, uSkyTop, uSkyLow, uMist;
uniform vec4 uMoon;
uniform float uFogLow, uHazeNear, uHazeFar, uFlash, uHorizon, uCamX, uEdgeR, uPillars, uPillarH;
uniform vec4 uBloom;
uniform vec3 uBloomCol;
uniform float uStalks, uGlow, uClouds, uFgDark, uLayers, uBands, uFine, uSunRing, uSkyPow, uContrast;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v / 0.97; }
float fbm3(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v / 0.875; }
float linFromRaw(float d){ return -(uNear * uFar) / ((uFar - uNear) * d - uFar); }
float linDepth(vec2 uv){ return linFromRaw(texture2D(tDepth, uv).x); }
vec3 nrm(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// Height of one layer of distant shapes at x: tall round-topped karst pillars or soft wooded ridges.
float layerH(float x, float seed){
  float c = floor(x), h = 0.0;
  for (int j = -1; j <= 1; j++) {
    float cc = c + float(j);
    float center = cc + 0.2 + 0.6 * hash(vec2(seed, cc));
    float w = 0.12 + 0.16 * hash(vec2(cc, seed + 1.0));
    float dx = abs(x - center) / w;
    float top = 0.3 + 0.7 * pow(hash(vec2(cc * 1.7, seed + 3.0)), 1.3);
    // a steep column, its crown broken into knuckles and tufts of pine, leaning a touch
    float prof = pow(max(1.0 - dx * dx, 0.0), 0.3);
    float crown = 0.86 + 0.18 * noise(vec2(x * 22.0, seed + 9.0)) + 0.06 * noise(vec2(x * 75.0, seed));
    float pillar = dx < 1.0 ? top * prof * crown * (1.0 - 0.08 * (x - center) / w) : 0.0;
    h = max(h, pillar);
  }
  float ridge = 0.25 + 0.55 * fbm3(vec2(x * 0.6, seed));
  // treeline fuzz on the ridges
  ridge += (noise(vec2(x * 26.0, seed)) - 0.5) * 0.05 * (1.0 - uPillars);
  h = mix(ridge, max(h, ridge * 0.35), uPillars);
  return h + (noise(vec2(x * 9.0, seed)) - 0.5) * 0.025;
}

// Distant bamboo in screen units: thin stalks with leaf clouds near the top. X in screen-height units,
// Y above the layer's base. Returns coverage.
float stalks(float X, float Y, float sp, float Hm, float seed){
  float c = floor(X / sp), m = 0.0;
  for (int j = -1; j <= 1; j++) {
    float cc = c + float(j);
    float top = Hm * (0.45 + 0.55 * hash(vec2(seed, cc * 1.3)));
    float lean = (hash(vec2(cc * 2.1, seed)) - 0.5) * sp * 0.9;
    float cx = (cc + 0.2 + 0.6 * hash(vec2(cc, seed))) * sp + lean * clamp(Y / max(top, 0.001), 0.0, 1.0);
    float w = sp * (0.05 + 0.03 * hash(vec2(cc, seed + 4.0)));
    float dx = X - cx;
    float stem = (1.0 - smoothstep(w * 0.5, w, abs(dx))) * step(Y, top);
    // leaf sprays: two lumpy clouds hanging off the upper stalk
    vec2 q1 = vec2(dx - sp * 0.35, (Y - top * 0.92) * 1.8);
    vec2 q2 = vec2(dx + sp * 0.4, (Y - top * 0.7) * 1.8);
    float n = noise(vec2(X * 90.0, Y * 60.0) + seed) - 0.5;
    float lv = max(1.0 - smoothstep(0.7, 1.0, length(q1) / (sp * 0.75) + n * 0.7),
                   1.0 - smoothstep(0.7, 1.0, length(q2) / (sp * 0.6) + n * 0.7));
    m = max(m, max(stem, lv * step(0.1, top)));
  }
  return m;
}

// Painted sky in screen space: night toward the top, a glow at the horizon, brushed cloud bands, a haloed
// moon with clouds drifting across it, then four layers of distant silhouettes (far = pale, near = inky)
// each sinking into its own bank of mist.
vec3 skyAt(vec2 uv){
  vec3 grain = vec3(0.94 + 0.08 * fbm3(uv * uRes / 7.0));
  // well below the backdrop everything is the mist bank (most of the ground's haze lands here)
  if (uv.y < uHorizon - 0.035) return uMist * grain;
  float t = smoothstep(uHorizon - 0.04, 1.0, uv.y);
  vec3 s = mix(uSkyLow, uSkyTop, pow(t, uSkyPow));
  // pale glow hugging the horizon
  s = mix(s, uSkyLow * 1.08 + 0.03, exp(-pow((uv.y - uHorizon - 0.06) / 0.11, 2.0)) * uGlow);
  if (uMoon.z > 0.0 && uSunRing > 0.0) {
    // a lightless sun: paper left empty, no glow, ink bleeding in from its rim
    vec2 p = uv - uMoon.xy; p.x *= uAspect;
    float r = length(p) / uMoon.z, a = atan(p.y, p.x);
    float bleed = uSunRing * (0.55 + 0.9 * fbm3(vec2(a * 3.0, uTime * 0.03) + 2.0)) * (0.7 + 0.6 * noise(vec2(a * 14.0, 1.0)));
    float disc = 1.0 - smoothstep(0.97, 1.0, r);
    vec3 paperSun = mix(uPaper * 1.12, vec3(0.97, 0.96, 0.93), 0.6);
    s = mix(s, paperSun, disc * uMoon.w);
    float ring = smoothstep(1.0 - bleed, 1.0, r) * disc;
    s = mix(s, mix(uSkyTop, uInk, 0.5), ring * 0.85 * uMoon.w);
  } else if (uMoon.z > 0.0) {
    vec2 p = uv - uMoon.xy; p.x *= uAspect;
    float r = length(p);
    vec3 mc = vec3(0.97, 0.95, 0.87);
    float halo = exp(-r / (uMoon.z * 1.6)) * 0.55 + exp(-r / (uMoon.z * 5.0)) * 0.22;
    s = mix(s, mc, clamp(halo * uMoon.w, 0.0, 1.0) * 0.8);
    float wob = (noise(vec2(atan(p.y, p.x) * 4.0, 3.0)) - 0.5) * 0.05 * uMoon.z;
    float disc = 1.0 - smoothstep(uMoon.z * 0.93, uMoon.z, r + wob);
    float mare = fbm3(p / uMoon.z * 1.7 + 4.0);
    s = mix(s, mc * (0.82 + 0.18 * mare), disc * uMoon.w);
  }
  // long brushed cloud bands, darker and heavier in a storm (uClouds > 1)
  float cy = uv.y - uHorizon;
  float cl = fbm3(vec2(uv.x * uAspect * 1.1 + uTime * 0.007, uv.y * 8.0 + 3.0));
  float band = smoothstep(0.5, 0.78, cl) * smoothstep(0.03, 0.14, cy) * min(uClouds, 1.0);
  vec3 cloudCol = mix(uSkyLow, uSkyTop, 0.55 + 0.35 * max(uClouds - 1.0, 0.0));
  // under-lit rims where the clouds pass the moon
  float rim = smoothstep(0.5, 0.6, cl) * (1.0 - smoothstep(0.6, 0.72, cl));
  if (uMoon.z > 0.0 && uSunRing <= 0.0) {
    vec2 p = uv - uMoon.xy; p.x *= uAspect;
    s = mix(s, vec3(0.95, 0.93, 0.86), rim * exp(-length(p) / (uMoon.z * 2.5)) * 0.5 * uMoon.w);
  }
  s = mix(s, cloudCol, band * 0.6);
  float storm = max(uClouds - 1.0, 0.0) * smoothstep(0.08, 0.3, cy) * (0.4 + 0.6 * fbm3(vec2(uv.x * uAspect * 0.8 - uTime * 0.02, uv.y * 3.0)));
  s = mix(s, uSkyTop * 0.7, clamp(storm, 0.0, 0.85));
  s += vec3(0.5, 0.58, 0.78) * uFlash * (0.45 + 0.55 * t);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    if (fk < 4.0 - uLayers) continue; // lower quality drops the farthest layers (and their mist banks)
    float scale = 1.8 + fk * 1.25;
    float par = 0.003 + fk * 0.005;
    float x = uv.x * uAspect * scale + uCamX * par * scale + fk * 13.7;
    float base = uHorizon + (3.0 - fk) * 0.02;
    float H = (0.13 + fk * 0.025) * uPillarH;
    float y = uv.y - base;
    float inside;
    float h;
    if (uStalks > 0.5 && k >= 1) {
      float X = uv.x * uAspect + uCamX * par;
      float sp = 0.035 + fk * 0.025;
      inside = stalks(X + fk * 3.1, y, sp, 0.1 + fk * 0.1, 7.0 + fk * 11.0);
      h = 0.1 + fk * 0.1;
    } else {
      h = layerH(x, 7.0 + fk * 11.0) * H;
      inside = 1.0 - smoothstep(h - 0.003, h + 0.003, y);
    }
    float dark = 0.12 + fk * 0.15;
    // distant shapes sit cooler than the glow behind them
    vec3 shade = mix(mix(uSkyLow, uSkyTop, 0.3), uInk, dark);
    // vertical texture strokes, darker crowns
    shade *= 0.88 + 0.2 * noise(vec2(x * 16.0, y * 4.0 + fk * 7.0));
    shade = mix(shade, shade * 0.78, smoothstep(h - 0.06, h, y) * 0.7);
    shade = mix(shade, shade * 0.6, uFlash * (0.5 + fk * 0.15));
    float feet = smoothstep(-0.005, 0.05 + 0.025 * fk, y);
    s = mix(s, mix(uMist, shade, feet), inside);
    // a bank of mist drifting in front of this layer's feet
    float mb = exp(-pow((y + 0.004) / (0.024 + 0.008 * fk), 2.0));
    mb *= 0.5 + 0.5 * smoothstep(0.3, 0.7, fbm3(vec2(x * 0.45 + uTime * (0.012 + 0.006 * fk), fk * 3.1)));
    s = mix(s, uMist, mb * 0.75);
  }
  float below = 1.0 - smoothstep(uHorizon - 0.03, uHorizon + 0.012, uv.y);
  s = mix(s, uMist, below * 0.85);
  return s * grain;
}

void main(){
  vec2 uv = vUv, px = 1.0 / uRes;
  vec2 wob = uFine > 0.5
    ? vec2(fbm(uv * vec2(6.0, 9.0) + uTime * 0.02), fbm(uv * vec2(7.0, 5.0) - uTime * 0.015)) - 0.5
    : vec2(fbm3(uv * vec2(6.0, 9.0) + uTime * 0.02), fbm3(uv * vec2(7.0, 5.0) - uTime * 0.015)) - 0.5;
  vec2 suv = uv + wob * px * 16.0 * uBleed;
  vec4 s4 = texture2D(tColor, suv);
  vec3 src = toSRGB(s4.rgb);
  // alpha codes: 1 = ink world, ~0.5 = dyed (keeps its color), ~0.05 = water (mirrors the sky)
  float water = 1.0 - step(0.3, s4.a);
  float dyed = (1.0 - step(0.75, s4.a)) * (1.0 - water);
  float raw = texture2D(tDepth, suv).x;
  bool isSky = raw > 0.99995;
  float d = linFromRaw(raw);
  vec3 wp = vec3(0.0, 1000.0, 0.0);
  if (!isSky) {
    vec4 vp = uInvProj * vec4(suv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0); vp /= vp.w;
    wp = (uCamWorld * vp).xyz;
  }
  vec3 paper = uPaper;
  paper *= 0.95 + 0.07 * fbm(uv * uRes / 90.0);
  paper -= 0.03 * smoothstep(0.62, 0.92, noise(uv * uRes * vec2(0.35, 0.04)));
  vec3 sky = skyAt(uv);
  // the sky takes a wash of the bloom's color once the front is well out
  sky = mix(sky, clamp(sky * (0.55 + 0.75 * uBloomCol), 0.0, 1.0), 0.45 * uBloom.w * smoothstep(8.0, 40.0, uBloom.z));
  vec3 col = sky;
  if (!isSky) {
    float strokeVar = uFine > 0.5 ? 0.5 + 1.0 * fbm(uv * vec2(3.0, 14.0) + 3.1) : 1.0;
    vec2 o = px * uEdge * strokeVar;
    float izC = 1.0 / d;
    float izL = 1.0 / linDepth(suv - vec2(o.x, 0.0)), izR = 1.0 / linDepth(suv + vec2(o.x, 0.0));
    float izD = 1.0 / linDepth(suv - vec2(0.0, o.y)), izU = 1.0 / linDepth(suv + vec2(0.0, o.y));
    float dEdge = smoothstep(0.015, 0.06, (abs(izL + izR - 2.0 * izC) + abs(izU + izD - 2.0 * izC)) / izC);
    float nEdge = (1.0 - dot(nrm(suv - vec2(o.x, 0.0)), nrm(suv + vec2(o.x, 0.0))))
                + (1.0 - dot(nrm(suv - vec2(0.0, o.y)), nrm(suv + vec2(0.0, o.y))));
    nEdge = smoothstep(0.3, 0.8, nEdge);
    float edge = max(dEdge, nEdge * 0.8);
    edge *= mix(1.0, 0.35, smoothstep(30.0, 120.0, d));
    edge *= 0.6 + 0.4 * smoothstep(0.25, 0.7, noise(uv * uRes / 3.0));

    float L = luma(src);
    float q = (1.0 - L) * uTones + (fbm(uv * 8.0 + 2.0) - 0.5) * 0.7 * uBleed;
    float qf = fract(q), ws = 0.06 + 0.3 * uBleed;
    float soft = smoothstep(0.5 - ws, 0.5 + ws, qf);
    float tone = (floor(q) + soft) / uTones;
    tone = pow(clamp(tone, 0.0, 1.0), 1.3) * 0.98;
    tone += 0.07 * soft * (1.0 - soft) * 4.0 * step(0.08, tone);
    tone *= 0.82 + 0.3 * fbm(uv * uRes / 6.0);
    // value by distance: near ink stays rich, far ink thins toward the paper
    tone *= mix(1.08, 0.62, smoothstep(16.0, 64.0, d));
    if (uContrast > 0.0) tone = mix(tone, smoothstep(0.18, 0.72, tone), uContrast);

    vec3 inkImg = mix(paper, uInk, clamp(tone, 0.0, 1.0) * 0.92);
    inkImg = mix(inkImg, uInk * 0.8, clamp(edge, 0.0, 1.0) * 0.92);

    // skill light: reveal the world's own color, tinted by the skill
    float reveal = 0.0; vec3 tint = vec3(1.0);
    float nn = fbm3(wp.xz * 0.35 + uTime * 0.2);
    for (int i = 0; i < ${LN}; i++) {
      vec4 Lt = uLight[i];
      if (Lt.w <= 0.0) continue;
      float dd = length(wp.xz - Lt.xy) + (nn - 0.5) * 2.0;
      float m = (1.0 - smoothstep(Lt.z * 0.5, Lt.z, dd)) * Lt.w;
      if (m > reveal) { reveal = m; tint = uLightCol[i]; }
    }
    // boss bloom: a ragged front spreading from the fallen boss, the world's color behind it
    float bloomM = 0.0;
    if (uBloom.w > 0.0) {
      float bd = length(wp.xz - uBloom.xy) + (nn - 0.5) * 5.0;
      bloomM = (1.0 - smoothstep(uBloom.z - 6.0, uBloom.z, bd)) * uBloom.w;
      if (bloomM > reveal) { reveal = bloomM; tint = uBloomCol; }
    }
    float Lc = luma(src);
    vec3 chroma = src / max(Lc, 0.02);
    float Lq = mix(Lc, floor(Lc * 5.0 + 0.5) / 5.0, 0.45);
    vec3 wc = clamp(chroma * Lq, 0.0, 1.0);
    wc = mix(wc, wc * paper * 1.15, 0.25);
    wc *= 0.9 + 0.16 * fbm(uv * uRes / 6.0);
    // in the dark world, color (dyes, lanterns, skill light) glows a little brighter
    vec3 lit = mix(wc * (1.0 + 0.25 * dyed), clamp(wc * (0.7 + tint), 0.0, 1.0), 0.5 * reveal * (1.0 - dyed));
    vec3 colImg = mix(lit, uInk * 0.85, clamp(edge, 0.0, 1.0) * 0.8);
    col = mix(inkImg, colImg, max(reveal, dyed));
    // the bloom also lays a wash of the chapter's color over everything it reaches (muted zones still glow)
    col = mix(col, clamp(col * (0.55 + 0.9 * uBloomCol), 0.0, 1.0), 0.4 * bloomM);

    if (water > 0.5) {
      // still water: the painted sky turned upside down (horizon glow, silhouettes, the moon's light),
      // broken by horizontal ripples, darkening toward the near bank
      float rip = noise(vec2(wp.x * 0.6, wp.z * 7.0 + uTime * 0.6)) - 0.5;
      float below = clamp(uHorizon - uv.y, 0.0, 1.0);
      vec2 ruv = vec2(uv.x + rip * 0.012, uHorizon + 0.015 + below * 0.32 + rip * 0.006);
      vec3 refl = skyAt(ruv);
      refl = mix(refl, uInk, 0.18 + 0.25 * smoothstep(0.0, 0.5, below));
      refl *= 0.9 + 0.18 * smoothstep(0.2, 0.5, abs(rip));
      col = mix(refl, colImg, reveal * 0.6);
    }

    // distance haze fades into the sky; tall things keep their silhouette above the mist
    float fd = smoothstep(uHazeNear, uHazeFar, d);
    fd *= mix(1.0, 0.42, smoothstep(2.0, 40.0, wp.y));
    float edgeFade = smoothstep(uEdgeR, uEdgeR + 12.0, length(wp.xz)) * (1.0 - smoothstep(2.0, 9.0, wp.y));
    fd = max(fd, edgeFade);
    // three drifting haze bands in the distance layer the silhouettes
    for (int k = 0; k < 3; k++) {
      if (float(k) >= uBands) break;
      float D = 40.0 + float(k) * 22.0;
      float band = exp(-pow((d - D) / 8.0, 2.0));
      float drift = fbm3(vec2(wp.x * 0.025 + uTime * (0.01 + 0.006 * float(k)), wp.y * 0.05 + float(k) * 5.0));
      band *= smoothstep(0.3, 0.75, drift) * (1.0 - smoothstep(4.0, 30.0, wp.y) * 0.6);
      fd = max(fd, band * 0.75);
    }
    fd *= 1.0 - dyed * 0.55;
    // low ground mist drifting through the field
    float gm = fbm3(wp.xz * 0.07 + vec2(uTime * 0.03, -uTime * 0.014));
    gm = smoothstep(0.45, 0.85, gm) * exp(-max(wp.y, 0.0) * 0.7) * uFogLow * smoothstep(7.0, 20.0, d) * (1.0 - dyed * 0.6);
    col = mix(col, uMist, clamp(gm, 0.0, 0.55));
    col = mix(col, sky, clamp(fd, 0.0, 1.0));
    col += uFlash * 0.16 * vec3(0.7, 0.78, 1.0) * (1.0 - fd);
  }

  // painted foreground: a dark, uneven wash along the bottom of the frame
  float fg = (1.0 - smoothstep(0.0, 0.2, uv.y + (fbm3(vec2(uv.x * 3.0, 1.3)) - 0.5) * 0.12)) * uFgDark;
  fg *= 0.55 + 0.6 * fbm3(uv * vec2(5.0, 11.0) + 1.7);
  col = mix(col, col * 0.55 + uInk * 0.12, clamp(fg, 0.0, 0.85));

  float spl = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 s = uSplash[i];
    float age = uTime - s.z;
    if (age < 0.0 || age > 4.0) continue;
    float seed = fract(s.z * 7.13) + 0.1;
    vec2 p = uv - s.xy; p.x *= uAspect;
    float dist = length(p);
    float R = s.w * (1.0 - exp(-age * 9.0));
    float rr = R * (1.0 + 0.6 * (noise(vec2(atan(p.y, p.x) * 2.5 + seed * 20.0, seed * 7.0)) - 0.5));
    float core = 1.0 - smoothstep(rr * 0.85, rr, dist);
    float drops = 0.0;
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      float a = hash(vec2(seed * 13.0 + fk, fk * 1.7)) * 6.2831;
      float rd = R * (1.35 + hash(vec2(fk, seed * 3.0)) * 1.4);
      float sz = R * (0.05 + 0.12 * hash(vec2(fk * 3.0, seed * 5.0)));
      drops = max(drops, 1.0 - smoothstep(sz * 0.7, sz, length(p - vec2(cos(a), sin(a)) * rd)));
    }
    spl = max(spl, max(core * 0.85, drops * 0.8) * (1.0 - smoothstep(1.2, 4.0, age)));
  }
  col = mix(col, uInk, spl);

  vec2 vc = (uv - 0.5) * vec2(1.0, 1.15);
  col *= 1.0 - 0.36 * smoothstep(0.3, 0.8, length(vc));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Creates the WebGL renderer on the canvas. Throws if WebGL is unavailable. */
export function initRenderer(canvas: HTMLCanvasElement): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  DPR = dprFor(level);
  renderer.setPixelRatio(DPR);
  renderer.info.autoReset = false; // counts cover the whole frame (scene, normals, post, overlay)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the post shader writes display values itself
  colorRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  colorRT.depthTexture = new THREE.DepthTexture(4, 4);
  normalRT = new THREE.WebGLRenderTarget(4, 4);
  groundDepthU.tSceneDepth.value = colorRT.depthTexture;
  postMat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: colorRT.texture },
      tDepth: { value: colorRT.depthTexture },
      tNormal: { value: normalRT.texture },
      uRes: { value: new THREE.Vector2(4, 4) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uEdge: { value: 1.6 },
      uBleed: { value: 0.45 },
      uTones: { value: 4 },
      uInvProj: { value: camera.projectionMatrixInverse },
      uCamWorld: { value: camera.matrixWorld },
      uLight: { value: lightU },
      uLightCol: { value: lightC },
      uSplash: { value: splashes },
      ...moodU,
      ...bloomU,
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: POST_FRAG,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false;
  postScene.add(quad);
  resize();
  setQuality(setting);
}

export function resize(): void {
  if (!renderer) return;
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pw = Math.floor(w * DPR), ph = Math.floor(h * DPR);
  colorRT.setSize(pw, ph);
  normalRT.setSize(pw, ph);
  postMat.uniforms.uRes.value.set(pw, ph);
  postMat.uniforms.uAspect.value = w / h;
  groundDepthU.uDepthRes.value.set(pw, ph);
}

export function renderFrame(dt: number): void {
  if (!renderer) return;
  watchdog(dt);
  updateLights(dt);
  updateBloom(dt);
  renderer.info.reset();
  postMat.uniforms.uTime.value = feel.time;
  if (occU.uOccOn.value > 0) {
    // the player's chest (the camera's focus) in view space
    camera.updateMatrixWorld();
    occU.uOccP.value.copy(_occ.set(camFocus.x, 1.1, camFocus.z).applyMatrix4(camera.matrixWorldInverse));
  }
  renderer.setRenderTarget(colorRT);
  renderer.render(scene, camera);
  scene.overrideMaterial = normalMat;
  scene.background = BLACK;
  for (const o of noNormalPass) o.visible = false;
  renderer.setRenderTarget(normalRT);
  renderer.render(scene, camera);
  for (const o of noNormalPass) o.visible = true;
  scene.overrideMaterial = null;
  scene.background = BG;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
  renderer.autoClear = false;
  renderer.render(overlay, camera);
  renderer.autoClear = true;
  if (peakDue && bloomPeak) {
    // read the drawing buffer now, before the browser presents (and clears) it
    const fn = bloomPeak;
    bloomPeak = null;
    peakDue = false;
    fn(renderer.domElement);
  }
}

export function setLoop(fn: (() => void) | null): void {
  renderer?.setAnimationLoop(fn);
}

/* ---------- baked scenery shadows ----------
   Once per zone: the static scenery is drawn into a depth map from the zone's light (ortho, fitted to the
   field), then a mask pass paints the shadow it casts onto the ground plane into a small world-space R8
   texture: soft, wider the further it falls from its caster (darker contact at the base, thinning toward
   the tip), with a dry-brush wobble at the edges. The depth target is freed right after; only the mask
   lives on (OWNED here, disposed by clearShadows on zone change). groundMat samples it once per pixel. */
const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uLightVP;
uniform vec3 uBox;      // min x, min z, size (world units)
uniform float uRange;   // light camera far - near (world units)
uniform float uTexel;   // one depth texel in uv
uniform float uSpan;    // world units across the light camera's width
uniform vec3 uShade;    // strength (unused here), softness, cast fade length (world units)
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v / 0.9375; }
void main(){
  vec2 w = uBox.xy + vUv * uBox.z;
  // the brush wobbles: the receiver point drifts a little, more at fine scale (dry edges)
  w += (vec2(fbm(w * 0.5), fbm(w * 0.5 + 7.3)) - 0.5) * 0.5 + (vec2(noise(w * 4.0), noise(w * 4.0 + 3.1)) - 0.5) * 0.12;
  vec4 lp = uLightVP * vec4(w.x, 0.0, w.y, 1.0);
  vec3 sc = lp.xyz / lp.w * 0.5 + 0.5;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0) { gl_FragColor = vec4(0.0); return; }
  float bias = 0.04 / uRange;
  float rot = hash(vUv * 977.0) * 6.2831;
  // blocker search: how far above the ground (along the light) the shadowing scenery is
  float sum = 0.0, cnt = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + rot, r = sqrt((fi + 0.5) / 12.0) * 1.3 / uSpan;
    float d = texture2D(tDepth, sc.xy + vec2(cos(a), sin(a)) * r).x;
    if (d < sc.z - bias) { sum += d; cnt += 1.0; }
  }
  if (cnt < 0.5) { gl_FragColor = vec4(0.0); return; }
  float gap = (sc.z - sum / cnt) * uRange;               // world units from caster to ground
  // penumbra grows with the gap: crisp at the foot, a soft wash toward the tip
  float penUv = max(clamp(0.06 + gap * 0.1 * uShade.y, 0.06, 1.4) / uSpan, uTexel);
  float hit = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + rot, r = sqrt((fi + 0.5) / 16.0) * penUv;
    float d = texture2D(tDepth, sc.xy + vec2(cos(a), sin(a)) * r).x;
    hit += step(d, sc.z - bias);
  }
  float s = hit / 16.0;
  // contact: darkest right at the base, thinning along the cast
  s *= mix(0.55, 1.0, 1.0 - smoothstep(0.0, uShade.z, gap));
  s *= 0.85 + 0.3 * fbm(w * 1.3 + 5.0);
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
let shadeRT: THREE.WebGLRenderTarget | null = null;
const coarseShadows = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
const shadowScene = new THREE.Scene();
shadowScene.overrideMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const shadeQuadMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    tDepth: { value: null as THREE.Texture | null },
    uLightVP: { value: new THREE.Matrix4() },
    uBox: { value: new THREE.Vector3() },
    uRange: { value: 399 },
    uTexel: { value: 1 / 2048 },
    uSpan: { value: 100 },
    uShade: { value: new THREE.Vector3(0.5, 1, 6) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: SHADOW_FRAG,
});
const shadeScene = new THREE.Scene();
{
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadeQuadMat);
  q.frustumCulled = false;
  shadeScene.add(q);
}
const vSun = new THREE.Vector3();
/** Unit vector toward the light for a mood's sun [azimuth deg, elevation deg] (+x east, -z north). */
export function sunDir(sun: readonly number[], out: THREE.Vector3): THREE.Vector3 {
  const az = (sun[0] * Math.PI) / 180, el = (sun[1] * Math.PI) / 180;
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

/**
 * Bakes the shadow the given roots cast onto the ground into a world-space mask covering the square
 * [-half, half]^2. Meshes with userData.noCast (ground, water, path, grass) are left out. Returns the mask
 * and its box, or null without a renderer (tests). The previous mask is disposed.
 */
export function bakeShadows(roots: THREE.Object3D[], half: number, sun: readonly number[], shade: readonly number[]): ShadowBake | null {
  clearShadows();
  lastBake = { roots, half, sun, shade };
  return doBake();
}
export type ShadowBake = { tex: THREE.Texture; box: THREE.Vector3 };
let lastBake: { roots: THREE.Object3D[]; half: number; sun: readonly number[]; shade: readonly number[] } | null = null;
let shadowSink: ((b: ShadowBake | null) => void) | null = null;
/** world.ts hands the ground its mask through this when a quality change re-bakes the current zone. */
export function setShadowSink(fn: ((b: ShadowBake | null) => void) | null): void {
  shadowSink = fn;
}
function doBake(): ShadowBake | null {
  shadeRT?.dispose();
  shadeRT = null;
  const bake = lastBake;
  // low quality: actor contact shadows only, no baked cast shadows
  if (!renderer || !bake || level === "low") return null;
  const { roots, half, sun, shade } = bake;
  const caps = renderer.capabilities;
  const N = Math.min(caps.maxTextureSize, level === "high" && !coarseShadows ? 2048 : 1024);
  const depthRT = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true });
  depthRT.depthTexture = new THREE.DepthTexture(N, N);
  // fit an ortho camera, looking down the light, around the field
  sunDir(sun, vSun);
  shadowCam.position.copy(vSun).multiplyScalar(200);
  shadowCam.up.set(0, 1, 0);
  shadowCam.lookAt(0, 0, 0);
  // the ground square, seen down the light: its width, foreshortened depth, plus the tallest casters
  const ext = half * 1.42, cosEl = Math.sqrt(1 - vSun.y * vSun.y);
  shadowCam.left = -ext; shadowCam.right = ext;
  const vy = ext * vSun.y + 26 * cosEl + 4;
  shadowCam.top = vy; shadowCam.bottom = -vy;
  shadowCam.near = 1; shadowCam.far = 400;
  shadowCam.updateProjectionMatrix();
  shadowCam.updateMatrixWorld(true);
  // borrow the casters into the bake scene, leaving flat things out
  const parents: (THREE.Object3D | null)[] = [];
  const hidden: THREE.Object3D[] = [];
  for (const r of roots) {
    parents.push(r.parent);
    r.traverse((o) => { if (o.userData.noCast && o.visible) { o.visible = false; hidden.push(o); } });
    shadowScene.add(r);
  }
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(depthRT);
  renderer.render(shadowScene, shadowCam);
  for (let i = 0; i < roots.length; i++) {
    const p = parents[i];
    if (p) p.add(roots[i]); else shadowScene.remove(roots[i]);
  }
  for (const o of hidden) o.visible = true;
  // paint the mask in world space
  const M = level === "high" ? 1024 : 512;
  shadeRT = new THREE.WebGLRenderTarget(M, M, { format: THREE.RedFormat, depthBuffer: false });
  const u = shadeQuadMat.uniforms;
  u.tDepth.value = depthRT.depthTexture;
  u.uLightVP.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  u.uBox.value.set(-half, -half, half * 2);
  u.uRange.value = shadowCam.far - shadowCam.near;
  u.uTexel.value = 1 / N;
  u.uSpan.value = ext * 2;
  (u.uShade.value as THREE.Vector3).fromArray(shade as number[]);
  renderer.setRenderTarget(shadeRT);
  renderer.render(shadeScene, postCam);
  renderer.setRenderTarget(prevTarget);
  u.tDepth.value = null;
  depthRT.depthTexture.dispose();
  depthRT.dispose(); // the depth map was only needed for the bake
  return { tex: shadeRT.texture, box: new THREE.Vector3(-half, -half, half * 2) };
}
/** Frees the current zone's shadow mask. */
export function clearShadows(): void {
  shadeRT?.dispose();
  shadeRT = null;
  lastBake = null;
}

/** For debugging leaks from the console: window.__ink.info(). */
export function memoryInfo(): { geometries: number; textures: number; programs: number; calls: number; triangles: number } | null {
  if (!renderer) return null;
  const i = renderer.info;
  return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, calls: i.render.calls, triangles: i.render.triangles };
}

/* ---------- graphics quality ----------
   One setting for the settings menu: "low" | "mid" | "high" | "auto". Auto picks a level from the device
   (touch, memory, cores, GPU hints) and then watches the frame rate: if it averages under 45 fps for 5 s
   it steps down one level (never up during a session). Each level sets the pixel-ratio cap, the baked
   scenery shadow (off / 512 / 1024 mask), the backdrop's silhouette layers and haze bands, the fine noise in the ink pass, and (through onQuality hooks in fx.ts / ambient.ts) the
   droplet, stain, firefly and rain counts. Switching is live: the current zone's shadow is re-baked and
   the old targets are freed. */
export type QualityLevel = "low" | "mid" | "high";
export type QualitySetting = QualityLevel | "auto";
let setting: QualitySetting = "auto";
let level: QualityLevel = "high";
/** settings toggles that live with the feel of the screen */
export const feelFlags = { shake: true };
const qualityHooks: ((l: QualityLevel) => void)[] = [];
/** Render modules subscribe to level changes (fx.ts, ambient.ts); called once right away. */
export function onQuality(fn: (l: QualityLevel) => void): void {
  qualityHooks.push(fn);
  fn(level);
}
function dprFor(l: QualityLevel): number {
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return l === "low" ? 1 : l === "mid" ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
}
/** A level for this device from what the browser tells us (used by "auto"). */
function detectLevel(): QualityLevel {
  if (typeof window === "undefined") return "mid";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
  const mem = nav.deviceMemory ?? 8, cores = nav.hardwareConcurrency ?? 8;
  let gpu = "", maxTex = 8192;
  if (renderer) {
    maxTex = renderer.capabilities.maxTextureSize;
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      // the hint is optional
    }
  }
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const weakGpu = software || /mali-[4t]|adreno \(tm\) [1-5]\d\d|powervr|intel.*(hd|uhd) graphics( \d{3})?\b/i.test(gpu);
  if (software || (coarse && (mem <= 4 || cores <= 4)) || maxTex < 4096) return "low";
  if (coarse || weakGpu || mem <= 4 || cores <= 4 || maxTex < 8192) return "mid";
  return "high";
}
function applyLevel(l: QualityLevel): void {
  level = l;
  moodU.uLayers.value = l === "low" ? 2 : l === "mid" ? 3 : 4;
  moodU.uBands.value = l === "low" ? 1 : l === "mid" ? 2 : 3;
  moodU.uFine.value = l === "low" ? 0 : 1;
  if (renderer) {
    DPR = dprFor(l);
    renderer.setPixelRatio(DPR);
    lastW = lastH = 0; // force the targets to the new size
    resize();
    // re-bake the current zone's shadow at the new resolution (or drop it) and hand it to the ground
    if (lastBake) shadowSink?.(doBake());
  }
  for (const fn of qualityHooks) fn(l);
  wdT = 0; wdFrames = 0; wdWarm = 3;
}
/** Graphics quality for the settings menu; "auto" decides from the device and the frame rate. */
export function setQuality(q: QualitySetting): void {
  setting = q;
  applyLevel(q === "auto" ? detectLevel() : q);
}
export function getQuality(): { setting: QualitySetting; level: QualityLevel } {
  return { setting, level };
}
/** Camera shake on hits, kills and slams (the camera reads feelFlags.shake). */
export function setShake(on: boolean): void {
  feelFlags.shake = on;
}
// fps watchdog for "auto": 5 s windows while the page is visible, after a short warm-up
let wdT = 0, wdFrames = 0, wdWarm = 3;
function watchdog(dt: number): void {
  if (setting !== "auto" || level === "low") return;
  if (typeof document !== "undefined" && document.hidden) { wdT = 0; wdFrames = 0; return; }
  if (wdWarm > 0) { wdWarm -= dt; return; }
  wdT += dt;
  wdFrames++;
  if (wdT >= 5) {
    const fps = wdFrames / wdT;
    wdT = 0; wdFrames = 0;
    if (fps < 45) applyLevel(level === "high" ? "mid" : "low");
  }
}

/**
 * Render a small scene into `rt` with the main renderer (never a second context) and read it back into
 * `out` (RGBA, rt.width × rt.height, bottom row first). The clear is transparent; renderer state is restored.
 * Used for dialogue portraits (ui/portraits.ts), once per speaker.
 */
export function renderOffscreen(s: THREE.Scene, cam: THREE.Camera, rt: THREE.WebGLRenderTarget, out: Uint8Array): boolean {
  if (!renderer) return false;
  const prevTarget = renderer.getRenderTarget();
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(s, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, out);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  return true;
}
