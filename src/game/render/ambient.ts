// Atmosphere per zone theme: the post-pass mood (palette, sky, moon, haze), painted framing silhouettes
// at the screen corners, drifting fireflies in the bamboo grove, rain and lightning on the peak, warm
// lantern light pools and the moon's streak on water. Every pool is created once (SHARED) and only
// shown/hidden; the framing texture is per theme (OWNED, disposed on the next theme); nothing allocates
// per frame.

import * as THREE from "three";
import type { ZoneDef } from "../../shared/world";
import { G, setActorShadow } from "./materials";
import { camera, onQuality, overlay, setFlash, setFraming, setFramingOffset, setMood, type Mood } from "./gfx";

type Theme = ZoneDef["theme"];
interface ThemeMood extends Mood {
  fireflies: number;
  rain: boolean;
  lightning: boolean;
}

const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export const MOODS: Record<Theme, ThemeMood> = {
  // night village: violet-blue sky, a high moon in cloud, soft wooded ridges; lantern glows carry the warmth
  village: {
    paper: [0.62, 0.64, 0.72], ink: [0.035, 0.04, 0.085], skyTop: [0.1, 0.11, 0.22], skyLow: [0.52, 0.54, 0.68], mist: [0.6, 0.62, 0.74],
    moon: [0.8, 0.9, 0.05, 1], fogLow: 0.35, hazeNear: 26, hazeFar: 72,
    hemiSky: 0xa8b4d8, hemiGround: 0x34303e, hemiI: 1.15, moonCol: 0xbfd0ff, moonI: 2.0, fireflies: 0, rain: false, lightning: false,
    pillars: 0.15, pillarH: 1.0, stalks: 0, glow: 0.35, clouds: 0.8, fgDark: 0.55,
    sun: [-62, 38], shade: [0.8, 1.0, 7],
  },
  // bamboo: blue moonlight in heavy mist, a grove of distant stalks, fireflies
  bamboo: {
    paper: [0.6, 0.67, 0.74], ink: [0.025, 0.05, 0.08], skyTop: [0.08, 0.14, 0.25], skyLow: [0.58, 0.68, 0.78], mist: [0.66, 0.75, 0.83],
    moon: [0.62, 0.9, 0.055, 0.95], fogLow: 0.55, hazeNear: 22, hazeFar: 66,
    hemiSky: 0xa6c4dc, hemiGround: 0x2e3a3c, hemiI: 1.2, moonCol: 0xb8d4ff, moonI: 2.2, fireflies: coarse ? 26 : 44, rain: false, lightning: false,
    pillars: 1, pillarH: 1.2, stalks: 1, glow: 0.45, clouds: 0.6, fgDark: 0.6,
    sun: [-80, 48], shade: [0.8, 1.1, 7],
  },
  // pond: dusk, violet overhead burning down to peach and rose over the water, a low moon and its streak
  pond: {
    paper: [0.79, 0.7, 0.69], ink: [0.09, 0.05, 0.1], skyTop: [0.27, 0.2, 0.44], skyLow: [0.98, 0.7, 0.55], mist: [0.92, 0.75, 0.7],
    moon: [0.74, 0.86, 0.06, 0.9], fogLow: 0.6, hazeNear: 24, hazeFar: 70,
    hemiSky: 0xf0c4b8, hemiGround: 0x3e3444, hemiI: 1.3, moonCol: 0xffc8a8, moonI: 2.0, fireflies: coarse ? 10 : 16, rain: false, lightning: false,
    pillars: 0.1, pillarH: 1.0, stalks: 0, glow: 0.8, clouds: 0.9, fgDark: 0.5,
    // the low dusk light lays long, soft shadows across the banks
    sun: [-68, 22], shade: [0.74, 1.9, 12],
  },
  // peak: storm, no moon, heavy cloud, rain and lightning over tall karst pillars
  peak: {
    paper: [0.5, 0.53, 0.58], ink: [0.025, 0.03, 0.045], skyTop: [0.07, 0.08, 0.11], skyLow: [0.42, 0.45, 0.52], mist: [0.48, 0.51, 0.58],
    moon: [0.5, 0.9, 0, 0], fogLow: 0.45, hazeNear: 22, hazeFar: 62,
    hemiSky: 0x8e9ab0, hemiGround: 0x26262c, hemiI: 1.1, moonCol: 0xaab8d8, moonI: 1.6, fireflies: 0, rain: true, lightning: true,
    pillars: 1, pillarH: 1.7, stalks: 0, glow: 0.25, clouds: 1.6, fgDark: 0.7,
    // no moon in the storm: light from high above, shadows pool softly at the feet of things
    sun: [-100, 74], shade: [0.66, 3.2, 4],
  },
};

/* ---------- fireflies: camera-facing glow quads, instanced ---------- */
const FLY_N = 48;
const flyMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform float uTime; varying vec2 vUv; varying float vA;
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float s = length(instanceMatrix[0].xyz);
      mv.xy += position.xy * s;
      vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.3 + float(gl_InstanceID) * 1.7), 3.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; varying float vA;
    void main(){
      float r = length(vUv - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.0, 0.18, r);
      float glow = exp(-r * 3.2) * 0.55;
      float a = (core + glow) * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vec3(0.85, 0.95, 0.5) * a, a);
    }`,
});
const flies = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), flyMat, FLY_N);
flies.frustumCulled = false;
flies.count = 0;
overlay.add(flies);
const fx = new Float32Array(FLY_N), fy = new Float32Array(FLY_N), fz = new Float32Array(FLY_N), fph = new Float32Array(FLY_N);

/* ---------- rain: line segments around the camera target ---------- */
const RAIN_N = coarse ? 170 : 320;
const rainPos = new Float32Array(RAIN_N * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb4c4dc, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }));
rain.frustumCulled = false;
rain.visible = false;
overlay.add(rain);
const rx = new Float32Array(RAIN_N), ry = new Float32Array(RAIN_N), rz = new Float32Array(RAIN_N), rv = new Float32Array(RAIN_N);
/** graphics quality: share of fireflies and rain streaks drawn (low halves them) */
let ambDensity = 1;
let rainActive = RAIN_N;
let curFlies = 0;
onQuality((l) => {
  ambDensity = l === "low" ? 0.5 : 1;
  rainActive = Math.round(RAIN_N * ambDensity);
  rainGeo.setDrawRange(0, rainActive * 2);
  flies.count = Math.round(curFlies * ambDensity);
});

/* ---------- lightning: a jagged bolt far to the north + the post-pass flash ---------- */
const BOLT_N = 12;
const boltGeo = new THREE.BufferGeometry();
boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_N * 3), 3));
const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
bolt.frustumCulled = false;
bolt.visible = false;
overlay.add(bolt);

/* ---------- warm light pools (lanterns, windows) and the moon streak on water ---------- */
/** SHARED: soft additive pool, flickering by its world position. Owned meshes live in world.ts. */
export const glowMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; varying float vSeed;
    void main(){ vUv = uv; vSeed = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.71;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv; varying float vSeed;
    void main(){
      float r = length(vUv - 0.5) * 2.0;
      float f = 0.85 + 0.15 * sin(uTime * 7.0 + vSeed) * sin(uTime * 3.1 + vSeed * 2.0);
      float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r)) * 0.32 * f;
      gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a, a);
    }`,
});
export const moonStreakMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 p = vUv - 0.5;
      float w = exp(-pow(p.x * 5.0, 2.0)) * (1.0 - smoothstep(0.3, 0.5, abs(p.y)));
      float row = floor(vUv.y * 46.0);
      float rip = step(0.45, fract(vUv.x * 3.0 + hash(row) * 7.0 + sin(uTime * 1.3 + row) * 0.3));
      float a = w * (0.35 + 0.65 * rip) * 0.42;
      gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a);
    }`,
});
export const flatGeo = G.flat;

const dummy = new THREE.Object3D();

/* ---------- framing: painted foreground silhouettes at the screen corners ----------
   One 1024x512 canvas per theme, drawn once when the zone loads (OWNED by Ambient, disposed on the next
   theme). Left half = the left corners, right half = the right corners; the top 256 rows hang from the
   top of the screen, the bottom 256 stand on its bottom (gfx.ts frameA maps them so they never squash).
   Only alpha is used: the ink pass paints it in the zone's ink with a dry-brush grain. */
const FW = 1024, FH = 512;

function painter(ctx: CanvasRenderingContext2D, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  /** a brush stroke along a cubic curve: overlapping dabs, swelling from w0 to w1, ragged at the edge */
  const stroke = (x0: number, y0: number, cx1: number, cy1: number, cx2: number, cy2: number, x1: number, y1: number, w0: number, w1: number, a = 0.5) => {
    const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(cx1 - x0, cy1 - y0);
    const n = Math.max(8, Math.round(len / 2));
    ctx.globalAlpha = a;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x1;
      const y = u * u * u * y0 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y1;
      const w = (w0 + (w1 - w0) * t) * (0.85 + 0.3 * r());
      ctx.beginPath();
      ctx.arc(x + (r() - 0.5) * w * 0.3, y + (r() - 0.5) * w * 0.3, Math.max(0.6, w / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  /** a pine needle cluster: a flat cloud of ink, scrubbed streaks, a fringe of fine needles below */
  const needles = (x: number, y: number, w: number, h: number) => {
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = i === 0 ? 0.9 : 0.6;
      ctx.beginPath();
      ctx.ellipse(x + (r() - 0.5) * w * 0.4, y + (r() - 0.5) * h * 0.2, w * (0.3 + r() * 0.2), h * (0.28 + r() * 0.14), (r() - 0.5) * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const yy = y + (r() - 0.5) * h * 0.5, xx = x + (r() - 0.5) * w * 0.6;
      ctx.beginPath(); ctx.moveTo(xx - w * 0.2, yy); ctx.lineTo(xx + w * 0.2, yy + (r() - 0.5) * 3); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 22; i++) {
      const xx = x + (r() - 0.5) * w * 0.85, yy = y + h * (0.1 + r() * 0.2);
      const l = h * (0.25 + r() * 0.35), a = Math.PI / 2 + (r() - 0.5) * 1.4;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + Math.cos(a) * l, yy + Math.sin(a) * l); ctx.stroke();
    }
  };
  /** a tapered leaf (bamboo, willow, reed) from (x, y) at angle a */
  const leaf = (x: number, y: number, len: number, a: number, w: number, alpha = 0.92) => {
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
    const tx = x + ca * len, ty = y + sa * len;
    const bend = (r() - 0.5) * len * 0.25;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + ca * len * 0.35 + nx * (w + bend), y + sa * len * 0.35 + ny * (w + bend), tx + nx * bend * 0.3, ty + ny * bend * 0.3);
    ctx.quadraticCurveTo(x + ca * len * 0.35 - nx * (w - bend) * 0.6, y + sa * len * 0.35 - ny * (w - bend) * 0.6, x, y);
    ctx.fill();
  };
  /** a rock mound standing on the bottom edge: lumpy outline, dry-brush highlights scrubbed out */
  const rock = (x0: number, x1: number, h: number, base = FH) => {
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(x0, base);
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const hh = h * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7) * (0.85 + 0.25 * r());
      ctx.lineTo(x0 + (x1 - x0) * t, base - Math.max(0, hh));
    }
    ctx.lineTo(x1, base);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 14; i++) {
      const sx = x0 + (x1 - x0) * (0.15 + r() * 0.7), sy = base - h * (0.3 + r() * 0.5);
      stroke(sx, sy, sx + 10, sy - 6, sx + 30, sy - 4, sx + 40 + r() * 30, sy + 4, 3, 1, 0.12);
    }
    ctx.globalCompositeOperation = "source-over";
  };
  /** grass blades springing from the bottom edge */
  const grass = (x: number, n: number, h: number, base = FH) => {
    for (let i = 0; i < n; i++) {
      const bx = x + (r() - 0.5) * h * 0.8, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      leaf(bx, base + 4, h * (0.5 + r() * 0.6), a, 3 + r() * 2, 0.85);
    }
  };
  /** a bamboo stalk from y0 to y1 at x, nodes as pale gaps */
  const stalk = (x: number, y0: number, y1: number, w: number) => {
    ctx.globalAlpha = 0.95;
    ctx.fillRect(x - w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0));
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 0.8;
    for (let y = Math.min(y0, y1) + 30 + r() * 40; y < Math.max(y0, y1) - 10; y += 70 + r() * 30) ctx.fillRect(x - w / 2 - 1, y, w + 2, 2.2);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x - w * 0.15, Math.min(y0, y1), w * 0.12, Math.abs(y1 - y0)); // moonlit side
    ctx.globalCompositeOperation = "source-over";
  };
  /** a spray of bamboo leaves fanning from (x, y) toward angle a */
  const spray = (x: number, y: number, a: number, n: number, len: number) => {
    for (let i = 0; i < n; i++) leaf(x, y, len * (0.6 + r() * 0.5), a + (r() - 0.5) * 1.1, len * 0.09, 0.9);
  };
  return { r, stroke, needles, leaf, rock, grass, stalk, spray };
}

function paintFraming(theme: Theme): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = FW;
  cv.height = FH;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  const P = painter(ctx, theme.length * 7919 + 13);
  const { r } = P;
  if (theme === "village") {
    // an old pine leaning in from the top left, its branch reaching along the top
    P.stroke(-20, 236, 20, 170, 40, 80, 110, 34, 44, 20, 0.55);
    P.stroke(90, 44, 150, 18, 230, 24, 330, 16, 16, 5, 0.55);
    P.stroke(110, 44, 130, 80, 160, 96, 200, 104, 10, 3, 0.55);
    for (const [x, y, w, h] of [[46, 70, 100, 44], [120, 26, 120, 46], [215, 16, 110, 40], [305, 18, 80, 30], [180, 98, 80, 30], [16, 130, 70, 36]] as const) P.needles(x, y, w, h);
    // rocks and grass at the bottom corners
    P.rock(-20, 230, 96);
    P.grass(150, 12, 70);
    P.grass(40, 8, 60, FH - 80);
    P.rock(1024 - 210, 1044, 80);
    P.grass(1024 - 200, 10, 64);
    // a few needles hanging in from the top right
    P.stroke(1044, 30, 1020, 24, 990, 16, 960, 20, 12, 4, 0.55);
    for (const [x, y, w, h] of [[990, 18, 80, 30], [1015, 52, 60, 28]] as const) P.needles(x, y, w, h);
  } else if (theme === "bamboo") {
    // stalks rising at both edges, sprays of leaves leaning into the frame from above
    for (const [x, w] of [[14, 26], [70, 18], [120, 11]] as const) { P.stalk(x, 0, 256, w); P.stalk(x + (r() - 0.5) * 4, 256, 512, w); }
    for (const [x, w] of [[1010, 24], [962, 14]] as const) { P.stalk(x, 0, 256, w); P.stalk(x, 256, 512, w); }
    for (const [x, y, a, n, l] of [[70, 40, 0.2, 9, 150], [120, 120, 0.5, 7, 120], [20, 180, 0.35, 6, 110], [180, 10, 0.1, 6, 110], [962, 60, Math.PI - 0.25, 9, 150], [1010, 150, Math.PI - 0.5, 6, 120], [880, 10, Math.PI - 0.1, 5, 100]] as const) P.spray(x, y, a, n, l);
    P.grass(200, 14, 80);
    P.grass(1024 - 150, 12, 76);
    P.rock(150, 330, 60);
  } else if (theme === "pond") {
    // willow strands hanging from the top corners
    P.stroke(-20, 30, 60, 10, 160, 6, 300, 24, 22, 6, 0.55);
    for (let i = 0; i < 26; i++) {
      const x = 10 + r() * 300, len = 90 + r() * 140;
      P.stroke(x, 10 + r() * 20, x + 8, 60, x - 6, len * 0.6, x + (r() - 0.5) * 20, len, 3, 1.2, 0.5);
      for (let k = 0; k < 6; k++) P.leaf(x + (r() - 0.5) * 6, 30 + r() * (len - 30), 16 + r() * 10, Math.PI / 2 + (r() - 0.5) * 1.6, 3, 0.85);
    }
    for (let i = 0; i < 12; i++) {
      const x = 1024 - 10 - r() * 160, len = 70 + r() * 110;
      P.stroke(x, 0, x - 6, 50, x + 6, len * 0.6, x + (r() - 0.5) * 16, len, 3, 1.2, 0.5);
      for (let k = 0; k < 5; k++) P.leaf(x + (r() - 0.5) * 6, 20 + r() * (len - 20), 16 + r() * 8, Math.PI / 2 + (r() - 0.5) * 1.6, 3, 0.85);
    }
    // reeds and a stone at the bottom corners
    P.rock(-30, 150, 48);
    for (const [x0, n] of [[60, 18], [1024 - 110, 16]] as const) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (r() - 0.5) * 140;
        P.leaf(x, FH + 4, 70 + r() * 80, -Math.PI / 2 + (r() - 0.5) * 0.6, 4, 0.9);
      }
      for (let i = 0; i < 3; i++) {
        const x = x0 + (r() - 0.5) * 80, y = FH - 90 - r() * 50;
        P.stroke(x, FH, x, FH - 40, x + 2, y + 40, x + 3, y, 3, 2, 0.8);
        P.stroke(x + 3, y + 6, x + 3, y - 4, x + 3, y - 14, x + 3, y - 26, 9, 8, 0.8);
      }
    }
    P.rock(1024 - 160, 1044, 52);
  } else {
    // peak: a cliff rising at the bottom left with grass on its lip, a boulder at the right, storm wash above
    ctx.globalAlpha = 0.97;
    ctx.beginPath();
    ctx.moveTo(-10, FH);
    ctx.lineTo(-10, FH - 180);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      ctx.lineTo(10 + t * 240, FH - 180 + Math.pow(t, 1.6) * 180 + (r() - 0.5) * 18 + (t < 0.4 ? -8 : 0));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 18; i++) {
      const sx = 10 + r() * 180, sy = FH - 200 + r() * 180;
      P.stroke(sx, sy, sx + 4, sy + 20, sx - 2, sy + 40, sx + 3, sy + 60 + r() * 40, 3, 1, 0.14);
    }
    ctx.globalCompositeOperation = "source-over";
    P.grass(40, 10, 46, FH - 176);
    P.rock(1024 - 200, 1044, 90);
    P.grass(1024 - 170, 8, 50, FH - 100);
    // storm wash hanging in the top corners
    for (let i = 0; i < 40; i++) {
      const x = r() < 0.5 ? r() * 330 : 1024 - r() * 330, y = r() * 90;
      P.stroke(x - 60, y, x - 20, y - 6, x + 20, y + 4, x + 70, y, 24 + r() * 24, 14, 0.018);
    }
  }
  // paper grain scrubbed out of the ink, so it reads as dry brush
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 2200; i++) ctx.fillRect(r() * FW, r() * FH, 1 + r() * 2, 1);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}


export class Ambient {
  private mood: ThemeMood = MOODS.village;
  private flashT = 0;
  private flashNext = 6;
  private boltLife = 0;
  private seeded = false;
  private frameTex: THREE.CanvasTexture | null = null;
  private frameTheme: Theme | null = null;
  private lagX = 0;
  private lagZ = 0;

  setTheme(theme: Theme): void {
    if (theme !== this.frameTheme) {
      this.frameTex?.dispose(); // OWNED: one theme's framing at a time
      this.frameTex = paintFraming(theme);
      this.frameTheme = theme;
    }
    this.mood = MOODS[theme] ?? MOODS.village;
    setMood(this.mood);
    setFraming(this.frameTex); // after setMood, which clears it (title and creation scenes have none)
    setActorShadow(this.mood.sun, this.mood.shade);
    setFlash(0);
    curFlies = this.mood.fireflies;
    flies.count = Math.round(curFlies * ambDensity);
    rain.visible = this.mood.rain;
    bolt.visible = false;
    this.flashT = 0;
    this.flashNext = 4 + Math.random() * 4;
    this.seeded = false;
  }

  /** Leaving the field (back to the title): no framing, texture freed. */
  dispose(): void {
    setFraming(null);
    this.frameTex?.dispose();
    this.frameTex = null;
    this.frameTheme = null;
  }

  update(dt: number, time: number, cx: number, cz: number): void {
    glowMat.uniforms.uTime.value = time;
    moonStreakMat.uniforms.uTime.value = time;
    flyMat.uniforms.uTime.value = time;
    const m = this.mood;
    if (!this.seeded) { this.seed(cx, cz); this.seeded = true; this.lagX = cx; this.lagZ = cz; }
    // the framing trails the walk a little, like a foreground nearer than the field
    const lk = Math.min(1, dt * 1.4);
    this.lagX += (cx - this.lagX) * lk;
    this.lagZ += (cz - this.lagZ) * lk;
    setFramingOffset(Math.max(-0.03, Math.min(0.03, (cx - this.lagX) * 0.012)), Math.max(-0.02, Math.min(0.02, (this.lagZ - cz) * 0.008)));
    // fireflies wander around the player and wrap back when left behind
    if (m.fireflies > 0) {
      for (let i = 0; i < flies.count; i++) {
        fph[i] += dt * (0.4 + (i % 5) * 0.08);
        fx[i] += Math.sin(fph[i] * 1.3 + i) * dt * 0.8;
        fz[i] += Math.cos(fph[i] * 0.9 + i * 2.1) * dt * 0.8;
        if (fx[i] - cx > 16) fx[i] -= 32; else if (cx - fx[i] > 16) fx[i] += 32;
        if (fz[i] - cz > 14) fz[i] -= 28; else if (cz - fz[i] > 14) fz[i] += 28;
        dummy.position.set(fx[i], fy[i] + Math.sin(fph[i] * 2 + i) * 0.4, fz[i]);
        dummy.scale.setScalar(0.62);
        dummy.updateMatrix();
        flies.setMatrixAt(i, dummy.matrix);
      }
      flies.instanceMatrix.needsUpdate = true;
    }
    if (m.rain) {
      for (let i = 0; i < rainActive; i++) {
        ry[i] -= rv[i] * dt;
        rx[i] += 3 * dt;
        if (ry[i] < 0) this.dropRain(i, cx, cz, false);
        if (rx[i] - cx > 18) rx[i] -= 36;
        if (rz[i] - cz > 16) rz[i] -= 30; else if (cz - rz[i] > 16) rz[i] += 30;
        const j = i * 6;
        rainPos[j] = rx[i]; rainPos[j + 1] = ry[i]; rainPos[j + 2] = rz[i];
        rainPos[j + 3] = rx[i] - 0.18; rainPos[j + 4] = ry[i] + 1.1; rainPos[j + 5] = rz[i];
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (m.lightning) {
      this.flashNext -= dt;
      if (this.flashNext <= 0) {
        this.flashT = 0.0001;
        this.flashNext = 5 + Math.random() * 7;
        this.strike(cx, cz);
      }
      if (this.flashT > 0) {
        this.flashT += dt;
        const t = this.flashT;
        // a bright crack, a dip, a second softer flicker
        const v = t < 0.08 ? t / 0.08 : t < 0.16 ? 1 - (t - 0.08) / 0.08 * 0.8 : t < 0.24 ? 0.2 + (t - 0.16) / 0.08 * 0.5 : Math.max(0, 0.7 - (t - 0.24) * 1.6);
        setFlash(v);
        if (t > 0.7) { this.flashT = 0; setFlash(0); }
      }
      if (this.boltLife > 0) {
        this.boltLife -= dt;
        if (this.boltLife <= 0) bolt.visible = false;
      }
    }
  }

  private seed(cx: number, cz: number): void {
    for (let i = 0; i < FLY_N; i++) {
      fx[i] = cx + (Math.random() - 0.5) * 32;
      fz[i] = cz + (Math.random() - 0.5) * 28;
      fy[i] = 0.6 + Math.random() * 2.6;
      fph[i] = Math.random() * 10;
    }
    for (let i = 0; i < RAIN_N; i++) this.dropRain(i, cx, cz, true);
  }

  private dropRain(i: number, cx: number, cz: number, anyHeight: boolean): void {
    rx[i] = cx + (Math.random() - 0.5) * 36;
    rz[i] = cz + (Math.random() - 0.5) * 30 - 4;
    ry[i] = anyHeight ? Math.random() * 16 : 14 + Math.random() * 4;
    rv[i] = 24 + Math.random() * 10;
  }

  private strike(cx: number, cz: number): void {
    // somewhere in the distant north, from the clouds down onto a pillar
    const pos = boltGeo.attributes.position.array as Float32Array;
    let x = cx + (Math.random() - 0.5) * 70, y = 70;
    const z = camera.position.z - 75 - Math.random() * 30;
    for (let k = 0; k < BOLT_N; k++) {
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      x += (Math.random() - 0.5) * 7;
      y -= 4 + Math.random() * 3;
    }
    boltGeo.attributes.position.needsUpdate = true;
    bolt.visible = true;
    this.boltLife = 0.16;
    void cz;
  }
}
