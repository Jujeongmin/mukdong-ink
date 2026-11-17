// Ink strokes: every basic swing paints a bold calligraphy stroke in the air along the brush's (or blade's)
// arc: a heavy wet start, a swelling and thinning body, a dry-brush split tail. It hangs ~0.55 s, then dries,
// cracks along the dry-brush grain and fades. The third hit paints a larger, heavier circle and flings ink
// spatter outward at its end. Always warm black ink (colour belongs to skills only).
// One mesh for the whole pool (K strokes x M samples, preallocated buffers, one draw call): a stroke's samples
// are written while it is painted; unused samples collapse onto the last one. Drawn in the overlay (after the
// ink pass, so the haze never greys it out) with its own ink treatment: three quantized tones and paper grain.
// Under the telegraphs (overlay renderOrder -1). OWNED here, alive all session.

import * as THREE from "three";
import { GROUND_DEPTH_GLSL, camFocus, feel, groundDepthU, onQuality, overlay } from "./gfx";
import { inkDrop } from "./fx";

const K = 10;
const M = 56;
const VPS = M * 2; // vertices per stroke
/** a remote player's strokes show only this close to the local player */
const REMOTE_NEAR = 20;

const pos = new Float32Array(K * VPS * 3);
const uvs = new Float32Array(K * VPS * 2);
/** per vertex: birth (-1 while still being painted), alpha scale, weight (1 normal, >1 heavy), seed */
const info = new Float32Array(K * VPS * 4).fill(-100);
const geo = new THREE.BufferGeometry();
const aPos = new THREE.BufferAttribute(pos, 3);
const aUv = new THREE.BufferAttribute(uvs, 2);
const aInfo = new THREE.BufferAttribute(info, 4);
aPos.setUsage(THREE.DynamicDrawUsage);
aUv.setUsage(THREE.DynamicDrawUsage);
aInfo.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute("position", aPos);
geo.setAttribute("aUv", aUv);
geo.setAttribute("aInfo", aInfo);
{
  const idx: number[] = [];
  for (let s = 0; s < K; s++) {
    for (let i = 0; i < M - 1; i++) {
      const a = s * VPS + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setIndex(idx);
}
const mat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uHold: { value: 0.55 }, uDry: { value: 0.4 }, ...groundDepthU },
  vertexShader: /* glsl */ `
    attribute vec2 aUv; attribute vec4 aInfo;
    varying vec2 vUv; varying vec4 vInfo;
    void main(){
      vUv = aUv; vInfo = aInfo;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uHold, uDry;
    varying vec2 vUv; varying vec4 vInfo;
    ${GROUND_DEPTH_GLSL}
    float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      float birth = vInfo.x;
      if (birth < -50.0) discard;
      // figures and walls in front of the stroke hide it (it no longer paints over the hero's own body)
      if (behindScene()) discard;
      float age = birth < 0.0 ? 0.0 : uTime - birth;
      float u = vUv.x, v = vUv.y, seed = vInfo.w, heavy = vInfo.z;
      // the stroke's body: a band across the ribbon (toward the tip side), heavy and round at the start,
      // swelling, then thinning toward the tail; its centre wanders a little like a real brush
      float w = (0.27 + 0.08 * heavy) * smoothstep(0.0, 0.07, u) * (1.0 - 0.6 * smoothstep(0.3, 1.0, u)) + 0.1 * exp(-u * 16.0);
      float c = 0.56 + 0.04 * sin(u * 6.0 + seed * 9.0);
      float edge = 0.05 * (n(vec2(u * 18.0, seed * 7.0)) - 0.5);
      float d = abs(v - c) + edge;
      float m = 1.0 - smoothstep(w - 0.05, w, d);
      // dry-brush split tail: past the middle the hairs part into streaks, fewer and fewer toward the end
      float streak = n(vec2(v * 26.0 + seed * 31.0, u * 1.8));
      float split = smoothstep(0.5, 1.0, u);
      m *= mix(1.0, smoothstep(0.25, 0.55, streak - split * 0.45 + 0.25), split);
      // ink load: wet and dark at the start, lighter toward the tail, with paper grain
      float ink = mix(0.95, 0.62, smoothstep(0.1, 0.9, u)) * (0.85 + 0.25 * n(vec2(u * 40.0, v * 30.0) + seed));
      // after the hold it dries: cracks open along the dry-brush grain, then it fades
      float k = clamp((age - uHold) / uDry, 0.0, 1.0);
      float crack = n(vec2(u * 11.0 + seed * 5.0, v * 15.0));
      m *= step(k * 1.15, crack + 0.05);
      float a = m * ink * vInfo.y * (1.0 - smoothstep(0.55, 1.0, k));
      // the ink pass's look: a few flat washes, not a smooth gradient
      a = a < 0.06 ? 0.0 : a < 0.4 ? 0.34 : a < 0.72 ? 0.66 : 0.93;
      a *= 0.9 + 0.12 * n(gl_FragCoord.xy / 3.0);
      if (a < 0.02) discard;
      gl_FragColor = vec4(0.055, 0.047, 0.042, min(1.0, a));
    }`,
});
const mesh = new THREE.Mesh(geo, mat);
mesh.frustumCulled = false;
mesh.renderOrder = -2; // under the telegraphs (-1)
mesh.onBeforeRender = () => { mat.uniforms.uTime.value = feel.time; };
overlay.add(mesh);

interface Stroke {
  n: number; raw: number; live: boolean; heavy: boolean; alpha: number; seed: number;
  ex: number; ey: number; ez: number; dx: number; dy: number; dz: number;
  /** the last two raw samples (a then b, xyz each): [older, newer] */
  hist: Float32Array;
}
const strokes: Stroke[] = Array.from({ length: K }, () => ({ n: 0, raw: 0, live: false, heavy: false, alpha: 1, seed: 0, ex: 0, ey: 0, ez: 0, dx: 0, dy: 0, dz: 0, hist: new Float32Array(12) }));
/** scratch for the in-between samples (no allocation) */
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
let next = 0;
let spatterN = 14;
onQuality((l) => {
  mat.uniforms.uHold.value = l === "low" ? 0.3 : 0.55;
  mat.uniforms.uDry.value = l === "low" ? 0.25 : 0.4;
  spatterN = l === "low" ? 5 : l === "mid" ? 9 : 14;
});

/**
 * Starts painting a stroke for an actor at (x, z). `remote`: lighter, and none beyond REMOTE_NEAR of the
 * local player or when other players' effects are reduced (`skip`). Returns the stroke's slot or -1.
 */
export function strokeBegin(x: number, z: number, heavy: boolean, remote: boolean, skip: boolean): number {
  if (remote && (skip || Math.abs(x - camFocus.x) > REMOTE_NEAR || Math.abs(z - camFocus.z) > REMOTE_NEAR)) return -1;
  const id = next;
  next = (next + 1) % K;
  const s = strokes[id];
  s.n = 0; s.raw = 0; s.live = true; s.heavy = heavy; s.alpha = remote ? 0.55 : 1; s.seed = Math.random();
  const o = id * VPS;
  for (let i = 0; i < VPS; i++) info[(o + i) * 4] = -100; // hidden until its first samples land
  aInfo.needsUpdate = true;
  return id;
}

/**
 * Adds the brush's segment (a = nearer the hand, b = past the tip) to a stroke being painted. A fast swing
 * moves far between frames, so two in-between samples are laid on a Catmull-Rom curve through the last raw
 * samples: the stroke bends smoothly instead of in straight chords.
 */
export function strokeAdd(id: number, a: THREE.Vector3, b: THREE.Vector3): void {
  const s = strokes[id];
  if (!s.live || s.n >= M) return;
  const h = s.hist;
  if (s.raw > 0) {
    // skip samples that barely moved
    if (Math.hypot(b.x - h[9], b.y - h[10], b.z - h[11]) < 0.04) return;
    // in-betweens from the newer raw sample (h[6..11]) to this one, the older (h[0..5]) as the lead-in
    const o0 = s.raw > 1 ? 0 : 6;
    for (const t of [1 / 3, 2 / 3]) {
      tmpA.set(cr(h[o0], h[6], a.x, 2 * a.x - h[6], t), cr(h[o0 + 1], h[7], a.y, 2 * a.y - h[7], t), cr(h[o0 + 2], h[8], a.z, 2 * a.z - h[8], t));
      tmpB.set(cr(h[o0 + 3], h[9], b.x, 2 * b.x - h[9], t), cr(h[o0 + 4], h[10], b.y, 2 * b.y - h[10], t), cr(h[o0 + 5], h[11], b.z, 2 * b.z - h[11], t));
      pushSample(id, tmpA, tmpB);
    }
  }
  h.copyWithin(0, 6, 12);
  h[6] = a.x; h[7] = a.y; h[8] = a.z; h[9] = b.x; h[10] = b.y; h[11] = b.z;
  s.raw++;
  pushSample(id, a, b);
}

function pushSample(id: number, a: THREE.Vector3, b: THREE.Vector3): void {
  const s = strokes[id];
  if (s.n >= M) return;
  const o = id * VPS;
  const i = s.n++;
  const p = (o + i * 2) * 3;
  pos[p] = a.x; pos[p + 1] = a.y; pos[p + 2] = a.z;
  pos[p + 3] = b.x; pos[p + 4] = b.y; pos[p + 5] = b.z;
  s.ex = b.x; s.ey = b.y; s.ez = b.z;
  if (i > 0) { const q = p - 6; s.dx = b.x - pos[q + 3]; s.dy = b.y - pos[q + 4]; s.dz = b.z - pos[q + 5]; }
  // the unused tail collapses onto this sample (zero-area quads)
  for (let k = s.n; k < M; k++) {
    const r = (o + k * 2) * 3;
    pos[r] = a.x; pos[r + 1] = a.y; pos[r + 2] = a.z;
    pos[r + 3] = b.x; pos[r + 4] = b.y; pos[r + 5] = b.z;
  }
  // u runs over the samples painted so far (the stroke's tail is always its newest end)
  const len = Math.max(1, s.n - 1), wgt = s.heavy ? 1 : 0;
  for (let k = 0; k < M; k++) {
    const u = Math.min(1, k / len);
    const t = (o + k * 2) * 2;
    uvs[t] = u; uvs[t + 1] = 0; uvs[t + 2] = u; uvs[t + 3] = 1;
    const f = (o + k * 2) * 4;
    info[f] = -1; info[f + 1] = s.alpha; info[f + 2] = wgt; info[f + 3] = s.seed;
    info[f + 4] = -1; info[f + 5] = s.alpha; info[f + 6] = wgt; info[f + 7] = s.seed;
  }
  aPos.needsUpdate = true;
  aUv.needsUpdate = true;
  aInfo.needsUpdate = true;
}

/** The swing has passed: the stroke starts to hold, dry and fade; a heavy one flings spatter outward. */
export function strokeEnd(id: number): void {
  const s = strokes[id];
  if (!s.live) return;
  s.live = false;
  const o = id * VPS, now = feel.time;
  if (s.n < 2) { for (let i = 0; i < VPS; i++) info[(o + i) * 4] = -100; aInfo.needsUpdate = true; return; }
  for (let i = 0; i < VPS; i++) info[(o + i) * 4] = now;
  aInfo.needsUpdate = true;
  if (s.heavy && s.alpha >= 1) {
    const l = Math.hypot(s.dx, s.dz) || 1, fx = s.dx / l, fz = s.dz / l;
    for (let k = 0; k < spatterN; k++) {
      const sp = 3 + Math.random() * 5, side = (Math.random() - 0.5) * 3;
      inkDrop(s.ex, s.ey, s.ez, fx * sp - fz * side, 1 + Math.random() * 3, fz * sp + fx * side, 0.04 + Math.random() * 0.07, 0.8 + Math.random() * 0.4);
    }
  }
}

/** Zone change: every stroke goes. */
export function clearStrokes(): void {
  for (const s of strokes) s.live = false;
  info.fill(-100);
  aInfo.needsUpdate = true;
}
