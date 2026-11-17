// Renderer, scenes, camera and the ink post pass (from proto/ink-swordsman.html), retuned for a moonlit /
// dusk mood. The world scene is rendered to a color+depth target and a normal target; the ink shader turns
// it into paper and ink (edges from depth+normals, quantized washes); dyed materials (alpha 0.5) keep their
// color and glow a little against the dark; skill "lights" reveal the world's color. Atmosphere lives here
// too: a painted sky with a moon on far/empty pixels, distance + height haze that fades into that sky,
// drifting ground mist, three parallax haze bands, a lightning flash. The overlay scene (skill VFX, rain,
// fireflies) is drawn on top in full color.

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
  moodU.uPillars.value = m.pillars;
  moodU.uPillarH.value = m.pillarH;
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

// Height of one layer of distant shapes at screen x: tall round-topped karst pillars or soft ridges.
float layerH(float x, float seed){
  float c = floor(x), h = 0.0;
  for (int j = -1; j <= 1; j++) {
    float cc = c + float(j);
    float center = cc + 0.2 + 0.6 * hash(vec2(seed, cc));
    float w = 0.12 + 0.16 * hash(vec2(cc, seed + 1.0));
    float dx = abs(x - center) / w;
    float top = 0.3 + 0.7 * pow(hash(vec2(cc * 1.7, seed + 3.0)), 1.3);
    // a tall column with a domed crown, leaning a touch
    float pillar = dx < 1.0 ? top * (0.6 + 0.4 * sqrt(1.0 - dx * dx)) * (1.0 - 0.08 * (x - center) / w) : 0.0;
    h = max(h, pillar);
  }
  float ridge = 0.25 + 0.5 * fbm3(vec2(x * 0.6, seed));
  h = mix(ridge, max(h, ridge * 0.35), uPillars);
  return h + (noise(vec2(x * 9.0, seed)) - 0.5) * 0.025;
}

// Painted sky in screen space: night toward the top, a glow at the horizon, brushed cloud bands, the moon,
// then three layers of distant silhouettes (far = pale, near = inky) sinking into mist at their feet.
vec3 skyAt(vec2 uv){
  float t = smoothstep(uHorizon - 0.04, 1.0, uv.y);
  vec3 s = mix(uSkyLow, uSkyTop, pow(t, 0.8));
  float c = fbm3(vec2(uv.x * 2.2 + uTime * 0.006, uv.y * 10.0 - uTime * 0.002));
  s = mix(s, mix(uSkyLow, uSkyTop, 0.35), smoothstep(0.5, 0.85, c) * 0.35 * t);
  if (uMoon.z > 0.0) {
    vec2 p = uv - uMoon.xy; p.x *= uAspect;
    float r = length(p);
    vec3 mc = vec3(0.97, 0.95, 0.86);
    float halo = exp(-r / (uMoon.z * 1.8));
    s = mix(s, mc, clamp(halo * 0.55 * uMoon.w, 0.0, 1.0));
    float disc = 1.0 - smoothstep(uMoon.z * 0.9, uMoon.z, r);
    float mare = fbm3(p / uMoon.z * 1.6 + 4.0);
    s = mix(s, mc * (0.86 + 0.14 * mare), disc * uMoon.w);
  }
  s += vec3(0.5, 0.58, 0.78) * uFlash * (0.45 + 0.55 * t);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float scale = 2.6 + fk * 1.7;
    float x = uv.x * uAspect * scale + uCamX * (0.006 + fk * 0.006) * scale + fk * 13.7;
    float H = (0.11 + fk * 0.06) * uPillarH;
    float y = uv.y - uHorizon + 0.015 * fk;
    float h = layerH(x, 7.0 + fk * 11.0) * H;
    float inside = 1.0 - smoothstep(h - 0.004, h + 0.004, y);
    vec3 shade = mix(uSkyLow, uInk, 0.18 + fk * 0.2);
    shade = mix(shade, shade * 0.85, smoothstep(0.0, h + 0.001, y) * 0.5);
    shade *= 0.92 + 0.12 * fbm3(vec2(x * 5.0, y * 30.0));
    shade = mix(shade, shade * 0.6, uFlash * (0.5 + fk * 0.2));
    float feet = smoothstep(-0.01, 0.08 + fk * 0.02, y);
    s = mix(s, mix(uMist, shade, feet), inside);
    // a drifting veil of mist between layers
    float veil = exp(-pow((y - 0.02) / 0.035, 2.0)) * smoothstep(0.35, 0.75, fbm3(vec2(x * 0.5 + uTime * 0.02, fk)));
    s = mix(s, uMist, veil * 0.55);
  }
  float below = 1.0 - smoothstep(uHorizon - 0.06, uHorizon + 0.01, uv.y);
  s = mix(s, uMist, below * 0.85);
  s *= 0.94 + 0.08 * fbm3(uv * uRes / 7.0);
  return s;
}

void main(){
  vec2 uv = vUv, px = 1.0 / uRes;
  vec2 wob = vec2(fbm(uv * vec2(6.0, 9.0) + uTime * 0.02), fbm(uv * vec2(7.0, 5.0) - uTime * 0.015)) - 0.5;
  vec2 suv = uv + wob * px * 16.0 * uBleed;
  vec4 s4 = texture2D(tColor, suv);
  vec3 src = toSRGB(s4.rgb);
  float dyed = 1.0 - step(0.75, s4.a);
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
  vec3 col = sky;
  if (!isSky) {
    float strokeVar = 0.5 + 1.0 * fbm(uv * vec2(3.0, 14.0) + 3.1);
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
    tone = pow(clamp(tone, 0.0, 1.0), 1.45) * 0.95;
    tone += 0.07 * soft * (1.0 - soft) * 4.0 * step(0.08, tone);
    tone *= 0.82 + 0.3 * fbm(uv * uRes / 6.0);

    vec3 inkImg = mix(paper, uInk, clamp(tone, 0.0, 1.0) * 0.9);
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

    // distance haze fades into the sky; tall things keep their silhouette above the mist
    float fd = smoothstep(uHazeNear, uHazeFar, d);
    fd *= mix(1.0, 0.42, smoothstep(2.0, 40.0, wp.y));
    float edgeFade = smoothstep(uEdgeR, uEdgeR + 12.0, length(wp.xz)) * (1.0 - smoothstep(2.0, 9.0, wp.y));
    fd = max(fd, edgeFade);
    // three drifting haze bands in the distance layer the silhouettes
    for (int k = 0; k < 3; k++) {
      float D = 46.0 + float(k) * 26.0;
      float band = exp(-pow((d - D) / 9.0, 2.0));
      float drift = fbm3(vec2(wp.x * 0.025 + uTime * (0.01 + 0.006 * float(k)), wp.y * 0.05 + float(k) * 5.0));
      band *= smoothstep(0.3, 0.75, drift) * (1.0 - smoothstep(4.0, 30.0, wp.y) * 0.6);
      fd = max(fd, band * 0.7);
    }
    fd *= 1.0 - dyed * 0.55;
    // low ground mist drifting through the field
    float gm = fbm3(wp.xz * 0.07 + vec2(uTime * 0.03, -uTime * 0.014));
    gm = smoothstep(0.45, 0.85, gm) * exp(-max(wp.y, 0.0) * 0.7) * uFogLow * smoothstep(7.0, 20.0, d) * (1.0 - dyed * 0.6);
    col = mix(col, uMist, clamp(gm, 0.0, 0.55));
    col = mix(col, sky, clamp(fd, 0.0, 1.0));
    col += uFlash * 0.16 * vec3(0.7, 0.78, 1.0) * (1.0 - fd);
  }

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
  col *= 1.0 - 0.42 * smoothstep(0.25, 0.75, length(vc));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Creates the WebGL renderer on the canvas. Throws if WebGL is unavailable. */
export function initRenderer(canvas: HTMLCanvasElement): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  DPR = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the post shader writes display values itself
  colorRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  colorRT.depthTexture = new THREE.DepthTexture(4, 4);
  normalRT = new THREE.WebGLRenderTarget(4, 4);
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
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: POST_FRAG,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false;
  postScene.add(quad);
  resize();
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
}

export function renderFrame(dt: number): void {
  if (!renderer) return;
  updateLights(dt);
  postMat.uniforms.uTime.value = feel.time;
  renderer.setRenderTarget(colorRT);
  renderer.render(scene, camera);
  scene.overrideMaterial = normalMat;
  scene.background = BLACK;
  renderer.setRenderTarget(normalRT);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.background = BG;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
  renderer.autoClear = false;
  renderer.render(overlay, camera);
  renderer.autoClear = true;
}

export function setLoop(fn: (() => void) | null): void {
  renderer?.setAnimationLoop(fn);
}

/** For debugging leaks from the console: window.__ink.info(). */
export function memoryInfo(): { geometries: number; textures: number; programs: number; calls: number } | null {
  if (!renderer) return null;
  const i = renderer.info;
  return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, calls: i.render.calls };
}
