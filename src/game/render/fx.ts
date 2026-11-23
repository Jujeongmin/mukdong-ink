// Effects from the prototype, all pooled: brush rings, crescent waves, colored sparks (overlay), ink
// droplets and ground decals (ink scene), afterimage ghosts, ink-prison blots, ribbons and weapon trails.
// Nothing here allocates per frame; every pool is created once and lives for the session.

import * as THREE from "three";
import { SKILLS } from "../../shared/combat";
import { clamp, type RGB, type Spot } from "../util";
import { G, dyeCloth } from "./materials";
import { GROUND_DEPTH_GLSL, addLight, camFwd, colorStain, feel, groundDepthU, onQuality, overlay, scene, screenSplash } from "./gfx";
import { Rig } from "./rig";

export const INK_TRAIL: RGB = [0.08, 0.075, 0.07];
export const SILVER_TRAIL: RGB = [0.78, 0.83, 0.93];
export const SKILL_COL: RGB[] = SKILLS.map((s) => s.color);

/* ---------- ribbons (scarf, sash tails) ----------
   A verlet chain in Float32Arrays (no allocation): the anchor is pinned to the body, the rest lags behind
   motion, is blown back against the facing (harder the faster the body moves), flutters in a little wind
   and is kept behind the body's front so it never hangs down the chest like a necktie. */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly x: Float32Array; private readonly y: Float32Array; private readonly z: Float32Array;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  constructor(private readonly N = 10, private readonly segLen = 0.17, private readonly width = 0.1) {
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.z = new Float32Array(N);
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 6).fill(1), 3));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, dyeCloth(null));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  reset(x: number, y: number, z: number): void {
    for (let i = 0; i < this.N; i++) {
      this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y - i * 0.05; this.z[i] = this.pz[i] = z + i * 0.1;
    }
  }
  update(dt: number, ax: number, ay: number, az: number, head: number, t: number, speed = 0, spread = 0): void {
    const { x, y, z, px, py, pz, N } = this;
    x[0] = px[0] = ax; y[0] = py[0] = ay; z[0] = pz[0] = az;
    const fx = Math.cos(head), fz = -Math.sin(head), d2 = dt * dt;
    // still: a slow breathing sway; running or rolling: blown straight back and snapping
    const wind = 6 + speed * 2.6, flut = 2.2 + speed * 1.8, sx = -fz, sz = fx;
    for (let i = 1; i < N; i++) {
      const vx = (x[i] - px[i]) * 0.93, vy = (y[i] - py[i]) * 0.93, vz = (z[i] - pz[i]) * 0.93;
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      const wave = Math.sin(t * (5.5 + speed * 0.9) + i * 0.75), side = Math.sin(t * 2.3 + i * 0.4) * 0.8;
      x[i] += vx + (-fx * wind + sx * (side * flut + spread * 1.1) + fx * wave * flut * 0.3) * d2;
      y[i] += vy + (-7 + speed * 0.9 + wave * flut) * d2;
      z[i] += vz + (-fz * wind + sz * (side * flut + spread * 1.1) + fz * wave * flut * 0.3) * d2;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < N; i++) {
        const dx = x[i] - x[i - 1], dy = y[i] - y[i - 1], dz = z[i] - z[i - 1];
        const dist = Math.hypot(dx, dy, dz) || 1e-4, diff = (dist - this.segLen) / dist;
        if (i === 1) { x[i] -= dx * diff; y[i] -= dy * diff; z[i] -= dz * diff; }
        else {
          x[i] -= dx * diff * 0.5; y[i] -= dy * diff * 0.5; z[i] -= dz * diff * 0.5;
          x[i - 1] += dx * diff * 0.5; y[i - 1] += dy * diff * 0.5; z[i - 1] += dz * diff * 0.5;
        }
      }
    }
    // never in front of the body: anything ahead of the anchor's plane is pushed back behind it
    for (let i = 1; i < N; i++) {
      const ahead = (x[i] - ax) * fx + (z[i] - az) * fz + 0.05;
      if (ahead > 0) { x[i] -= fx * ahead; z[i] -= fz * ahead; }
      if (y[i] < 0.04) y[i] = 0.04;
    }
    // a teleport (zone change, far snap) would stretch the ribbon: start over
    if (Math.abs(x[N - 1] - ax) > 6 || Math.abs(z[N - 1] - az) > 6) this.reset(ax, ay, az);
    const pos = this.geo.attributes.position.array as Float32Array, col = this.geo.attributes.color.array as Float32Array;
    const amp = Math.min(0.16, 0.07 + speed * 0.012);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1), u = i / (N - 1);
      const tx = x[b] - x[a], ty = y[b] - y[a], tz = z[b] - z[a];
      let wx = ty * camFwd.z - tz * camFwd.y, wy = tz * camFwd.x - tx * camFwd.z, wz = tx * camFwd.y - ty * camFwd.x;
      const wl = Math.hypot(wx, wy, wz) || 1;
      wx /= wl; wy /= wl; wz /= wl;
      // an S-curve travelling down the tail (drawn, not simulated), growing toward the end
      const off = Math.sin(t * 5.2 - i * 0.95) * amp * u;
      const cx = x[i] + wx * off, cy = y[i] + wy * off, cz = z[i] + wz * off;
      // soft cloth: the width folds and opens, tapers, and the last pieces fray
      let w = this.width * (1 - u * 0.72) * (0.74 + 0.3 * Math.sin(t * 3.1 + i * 1.15));
      if (i >= N - 2) w *= 0.55 + 0.45 * Math.abs(Math.sin(i * 7.7 + t * 9));
      pos[i * 6] = cx - wx * w; pos[i * 6 + 1] = cy - wy * w; pos[i * 6 + 2] = cz - wz * w;
      pos[i * 6 + 3] = cx + wx * w; pos[i * 6 + 4] = cy + wy * w; pos[i * 6 + 5] = cz + wz * w;
      // fold shading along the length: one edge catches a little light, the other sinks into the fold
      const f = 0.86 + 0.14 * Math.sin(t * 2.4 + i * 1.3);
      col[i * 6] = col[i * 6 + 1] = col[i * 6 + 2] = f;
      col[i * 6 + 3] = col[i * 6 + 4] = col[i * 6 + 5] = f * 0.86;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  /** The free end of the tail, into `out`. */
  tailEnd(out: THREE.Vector3): THREE.Vector3 {
    const k = this.N - 1;
    return out.set(this.x[k], this.y[k], this.z[k]);
  }
  /** OWNED geometry: dispose when the actor goes away. Material is shared. */
  dispose(): void {
    scene.remove(this.mesh);
    this.geo.dispose();
  }
}

/* ---------- weapon trails (overlay): a calligraphy ribbon behind the brush tip ----------
   One SHARED shader: the stroke is darkest and widest just behind the tip and thins out with age, its
   edge breaks into dry-brush streaks (noise along the stroke), the hilt side is a pale wash. */
const M_trail = new THREE.ShaderMaterial({
  transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, // its own vec4 tcol (three reserves `color`)
  vertexShader: /* glsl */ `
    attribute vec4 tcol; attribute vec2 uv2s; varying vec4 vC; varying vec2 vS;
    void main(){ vC = tcol; vS = uv2s; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    varying vec4 vC; varying vec2 vS;
    float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      float age = vS.x, across = vS.y;
      // the stroke narrows toward its tail: its tip-side edge retreats with age
      float edge = 1.0 - age * 0.55 + (n(vec2(age * 9.0, 3.0)) - 0.5) * 0.12;
      float body = smoothstep(0.0, 0.25, across) * (1.0 - smoothstep(edge - 0.08, edge, across));
      // dry brush: streaks along the stroke, more broken toward the tail
      float streak = n(vec2(age * 3.0, across * 26.0));
      body *= mix(1.0, smoothstep(0.25 + age * 0.4, 0.6 + age * 0.3, streak), 0.35 + age * 0.55);
      float a = min(1.0, vC.a * body * 1.4);
      if (a < 0.01) discard;
      gl_FragColor = vec4(vC.rgb * (0.85 + 0.3 * across), a);
    }`,
});
export class Trail {
  private readonly N = 22;
  private readonly base = new Float32Array(this.N * 3);
  private readonly tip = new Float32Array(this.N * 3);
  private readonly geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  strength = 0;
  col: RGB = INK_TRAIL;
  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 6), 3));
    this.geo.setAttribute("tcol", new THREE.BufferAttribute(new Float32Array(this.N * 8), 4));
    const st = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) { st[i * 4] = i / (this.N - 1); st[i * 4 + 1] = 0; st[i * 4 + 2] = i / (this.N - 1); st[i * 4 + 3] = 1; }
    this.geo.setAttribute("uv2s", new THREE.BufferAttribute(st, 2));
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, M_trail);
    this.mesh.frustumCulled = false;
    overlay.add(this.mesh);
  }
  push(b: THREE.Vector3, t: THREE.Vector3): void {
    const N = this.N;
    this.base.copyWithin(3, 0, (N - 1) * 3);
    this.tip.copyWithin(3, 0, (N - 1) * 3);
    this.base[0] = b.x; this.base[1] = b.y; this.base[2] = b.z;
    this.tip[0] = t.x; this.tip[1] = t.y; this.tip[2] = t.z;
    // after a teleport, collapse the history so no streak crosses the map
    if (Math.abs(this.base[3] - b.x) > 5 || Math.abs(this.base[5] - b.z) > 5) {
      for (let i = 1; i < N; i++) {
        this.base[i * 3] = b.x; this.base[i * 3 + 1] = b.y; this.base[i * 3 + 2] = b.z;
        this.tip[i * 3] = t.x; this.tip[i * 3 + 1] = t.y; this.tip[i * 3 + 2] = t.z;
      }
    }
    const pos = this.geo.attributes.position.array as Float32Array, col = this.geo.attributes.tcol.array as Float32Array, c = this.col;
    for (let i = 0; i < N; i++) {
      const a = this.strength * Math.pow(1 - i / (N - 1), 1.25) * 0.95;
      for (let k = 0; k < 3; k++) { pos[i * 6 + k] = this.base[i * 3 + k]; pos[i * 6 + 3 + k] = this.tip[i * 3 + k]; }
      const j = i * 8;
      col[j] = c[0]; col[j + 1] = c[1]; col[j + 2] = c[2]; col[j + 3] = a * 0.55;
      col[j + 4] = c[0]; col[j + 5] = c[1]; col[j + 6] = c[2]; col[j + 7] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.tcol.needsUpdate = true;
  }
  dispose(): void {
    overlay.remove(this.mesh);
    this.geo.dispose();
  }
}

/* ---------- brush rings / discs on the ground (overlay) ---------- */
const NOISE_GLSL = `
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }`;
// rings lie on the ground: a figure or prop standing on one is drawn in front of it (scene depth test, as the route)
const BRUSH_FRAG = `
  uniform vec3 uCol, uEdge; uniform float uProg, uFade, uSeed, uMode; varying vec2 vUv;
  ${NOISE_GLSL}
  ${GROUND_DEPTH_GLSL}
  void main(){
    if (behindScene()) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p), a = atan(p.y, p.x);
    float n = (noise(vec2(a * 3.0 + uSeed, uSeed)) - 0.5) * 0.16 + (noise(vec2(a * 12.0 + uSeed * 2.0, r * 6.0)) - 0.5) * 0.06;
    float rr = r + n, R = uProg, m;
    if (uMode < 0.5) { float w = 0.1 + 0.12 * (1.0 - uProg); m = smoothstep(R - w, R - w * 0.35, rr) * (1.0 - smoothstep(R, R + 0.03, rr)); }
    else { m = 1.0 - smoothstep(R - 0.05, R, rr); }
    m *= mix(1.0, smoothstep(0.2, 0.6, noise(vec2(a * 20.0 + uSeed, r * 40.0))), 0.4);
    float alpha = m * uFade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uEdge, uCol, smoothstep(0.35, 0.9, m)), alpha);
  }`;
export const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  dur: number;
  follow: Spot | null;
}
const rings: RingFx[] = [];
for (let i = 0; i < 16; i++) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Vector3() }, uEdge: { value: new THREE.Vector3() }, uProg: { value: 0 }, uFade: { value: 0 }, uSeed: { value: 0 }, uMode: { value: 0 }, ...groundDepthU },
    vertexShader: QUAD_VERT, fragmentShader: BRUSH_FRAG,
  });
  const mesh = new THREE.Mesh(G.flat, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  overlay.add(mesh);
  rings.push({ mesh, mat, t: 0, dur: 1, follow: null });
}
let ringNext = 0;
export function ring(x: number, z: number, radius: number, col: RGB, dur: number, mode = 0, edge: RGB | null = null, follow: Spot | null = null): void {
  const r = rings[ringNext];
  ringNext = (ringNext + 1) % rings.length;
  r.mesh.position.set(x, 0.08, z);
  r.mesh.scale.set(radius * 2, 1, radius * 2);
  r.mat.uniforms.uCol.value.set(col[0], col[1], col[2]);
  if (edge) r.mat.uniforms.uEdge.value.set(edge[0], edge[1], edge[2]);
  else r.mat.uniforms.uEdge.value.set(col[0] * 0.45, col[1] * 0.45, col[2] * 0.45);
  r.mat.uniforms.uSeed.value = Math.random() * 40;
  r.mat.uniforms.uMode.value = mode;
  r.t = 0; r.dur = dur; r.follow = follow;
  r.mesh.visible = true;
}
function updateRings(dt: number): void {
  for (const r of rings) {
    if (!r.mesh.visible) continue;
    r.t += dt;
    const u = r.t / r.dur;
    if (r.follow) r.mesh.position.set(r.follow.x, 0.08, r.follow.z);
    r.mat.uniforms.uProg.value = Math.min(0.98, 1 - Math.pow(1 - Math.min(1, u * 1.6), 3));
    r.mat.uniforms.uFade.value = 1 - clamp((u - 0.55) / 0.45, 0, 1);
    if (u >= 1) { r.mesh.visible = false; r.follow = null; }
  }
}

/* ---------- crescent waves (물결베기) ---------- */
const CRESC_FRAG = `
  uniform vec3 uCol; uniform float uFade, uSeed; varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(vec2(p.x + 0.7, p.y * 0.95));
    float n = (noise(vec2(p.y * 6.0 + uSeed, uSeed)) - 0.5) * 0.12;
    float band = smoothstep(0.95, 1.12, d + n) * (1.0 - smoothstep(1.45, 1.6, d + n * 2.0));
    float tip = 1.0 - smoothstep(0.55, 0.98, abs(p.y));
    float streak = mix(1.0, smoothstep(0.2, 0.6, noise(vec2(d * 30.0, p.y * 4.0 + uSeed))), 0.45);
    float a = band * tip * streak * uFade;
    if (a < 0.01) discard;
    vec3 c = mix(uCol * 0.45, mix(uCol, vec3(1.0), 0.25), smoothstep(1.05, 1.35, d));
    gl_FragColor = vec4(c, a);
  }`;
interface Crescent { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; x: number; z: number; fx: number; fz: number; head: number; t: number; limit: number; life: number }
const crescents: Crescent[] = [];
for (let i = 0; i < 8; i++) {
  const c = SKILL_COL[0];
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Vector3(c[0], c[1], c[2]) }, uFade: { value: 1 }, uSeed: { value: i * 7.1 } },
    vertexShader: QUAD_VERT, fragmentShader: CRESC_FRAG,
  });
  const mesh = new THREE.Mesh(G.flat, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.scale.set(4, 1, 5);
  overlay.add(mesh);
  crescents.push({ mesh, mat, x: 0, z: 0, fx: 1, fz: 0, head: 0, t: 0, limit: 30, life: 0.65 });
}
let crescNext = 0;
/** `width` scales the wave sideways; `life` is how long it flies (19 m/s). */
export function fireCrescent(x: number, z: number, head: number, limit: number, local: boolean, width = 1, life = 0.65): void {
  const c = crescents[crescNext];
  crescNext = (crescNext + 1) % crescents.length;
  c.fx = Math.cos(head); c.fz = -Math.sin(head);
  c.x = x + c.fx * 1.2; c.z = z + c.fz * 1.2; c.head = head; c.t = 0; c.limit = limit; c.life = life;
  c.mesh.scale.set(4, 1, 5 * width);
  c.mesh.visible = true;
  addLight(c.x, c.z, 8, 0.9, SKILL_COL[0], c);
  if (local) feel.shake = Math.max(feel.shake, 0.22);
}
function updateCrescents(dt: number): void {
  for (const c of crescents) {
    if (!c.mesh.visible) continue;
    c.t += dt;
    c.x += c.fx * 19 * dt; c.z += c.fz * 19 * dt;
    c.mesh.position.set(c.x, 0.9, c.z);
    c.mesh.rotation.set(0, c.head, 0);
    c.mat.uniforms.uFade.value = 1 - clamp((c.t - (c.life - 0.2)) / 0.2, 0, 1);
    if (c.t > c.life || Math.hypot(c.x, c.z) > c.limit + 2) c.mesh.visible = false;
  }
}

/* ---------- particles ---------- */
const dummy = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const cTmp = new THREE.Color();
class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly x: Float32Array; private readonly y: Float32Array; private readonly z: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly life: Float32Array; private readonly size: Float32Array; private readonly drag: Float32Array;
  private next = 0;
  private live = 0;
  /** the slots whose color changed since the last upload (only that span is sent) */
  private cLo = Infinity;
  private cHi = -1;
  constructor(private readonly n: number, mat: THREE.Material, parent: THREE.Object3D, private readonly colored: boolean) {
    this.mesh = new THREE.InstancedMesh(G.ico, mat, n);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.size = new Float32Array(n); this.drag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      if (colored) this.mesh.setColorAt(i, cTmp.setRGB(1, 1, 1));
    }
  }
  /** 0..1: the share of emits kept (graphics quality thins the ink droplets) */
  density = 1;
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, col: RGB | null = null, drag = 0): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.size[i] = size; this.life[i] = life; this.drag[i] = drag;
    this.live = 2;
    if (this.colored && col && this.mesh.instanceColor) {
      this.mesh.setColorAt(i, cTmp.setRGB(col[0], col[1], col[2]));
      if (i < this.cLo) this.cLo = i;
      if (i > this.cHi) this.cHi = i;
    }
  }
  update(dt: number, grav: number, onGround: ((x: number, z: number, s: number) => void) | null): void {
    if (this.live <= 0) return; // nothing alive and matrices already cleared
    let any = false;
    let lo = this.n, hi = -1; // the span of matrices written this frame: only it is uploaded
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] > 0) { this.size[i] = 0; this.mesh.setMatrixAt(i, ZERO); if (i < lo) lo = i; if (i > hi) hi = i; }
        continue;
      }
      any = true;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
      this.life[i] -= dt;
      const k = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= k; this.vz[i] *= k;
      this.vy[i] -= grav * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      if (this.y[i] <= 0.02 && this.vy[i] < 0) {
        if (onGround) onGround(this.x[i], this.z[i], this.size[i]);
        this.life[i] = 0;
      }
      const s = this.life[i] > 0 ? this.size[i] * (0.4 + 0.6 * Math.min(1, this.life[i] * 3)) : 0;
      dummy.position.set(this.x[i], this.y[i], this.z[i]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    if (!any) this.live--;
    if (hi >= 0) {
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      im.needsUpdate = true;
    }
    const ic = this.mesh.instanceColor;
    if (ic && this.cHi >= 0) {
      ic.clearUpdateRanges();
      ic.addUpdateRange(this.cLo * 3, (this.cHi - this.cLo + 1) * 3);
      ic.needsUpdate = true;
      this.cLo = Infinity;
      this.cHi = -1;
    }
  }
  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    for (let i = 0; i < this.n; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.clearUpdateRanges(); // the whole buffer this time
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
  }
}
export const sparks = new Particles(420, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }), overlay, true);
const inkDrops = new Particles(300, new THREE.MeshBasicMaterial({ color: 0x141312 }), scene, false);

/* ---------- ground decals (ink stains) ---------- */
/* Ink stains on the ground: a capped pool (DN, oldest overwritten) of ink-wash blots, not solid holes. Each
   is a pale wash pooling darker at a ragged edge, appears with a quick spread and fades out over its life
   (2.6 s by default). Only colour is blended (the scene target's dye/water alpha codes are kept). */
const DN = 48;
const D_LIFE = 2.6;
const decalGeo = G.disc.clone(); // OWNED by this module for its per-instance birth/life (lives all session)
const dBirth = new THREE.InstancedBufferAttribute(new Float32Array(DN).fill(-100), 1);
const dLife = new THREE.InstancedBufferAttribute(new Float32Array(DN).fill(1), 1);
decalGeo.setAttribute("aBirth", dBirth);
decalGeo.setAttribute("aLife", dLife);
const decalMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute float aBirth; attribute float aLife; uniform float uTime;
    varying vec2 vP; varying float vU; varying float vSeed;
    void main(){
      vP = position.xz; vSeed = fract(aBirth * 7.13);
      vU = (uTime - aBirth) / aLife;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vP; varying float vU; varying float vSeed;
    float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      if (vU < 0.0 || vU > 1.0) discard;
      float r = length(vP), a = atan(vP.y, vP.x);
      // ragged edge, spreading out in the first moment
      float R = (0.7 + 0.3 * n(vec2(a * 2.2 + vSeed * 20.0, vSeed * 9.0)) + 0.08 * (n(vec2(a * 9.0, vSeed * 3.0)) - 0.5)) * min(1.0, 0.55 + vU * 9.0);
      float m = 1.0 - smoothstep(R - 0.1, R, r);
      // a pale wash inside, the ink pooling darker toward the rim, with paper grain
      float wash = 0.28 + 0.32 * smoothstep(R * 0.45, R, r);
      wash *= 0.8 + 0.35 * n(vP * 9.0 + vSeed * 30.0);
      float a2 = m * wash * (1.0 - smoothstep(0.55, 1.0, vU));
      if (a2 < 0.01) discard;
      gl_FragColor = vec4(0.05, 0.047, 0.05, a2);
    }`,
});
const decals = new THREE.InstancedMesh(decalGeo, decalMat, DN);
decals.frustumCulled = false;
scene.add(decals);
for (let i = 0; i < DN; i++) decals.setMatrixAt(i, ZERO);
let dNext = 0;
/** An ink stain at (x, z), radius ~s (drawn a little smaller), fading out over `life` seconds. */
export function addDecal(x: number, z: number, s: number, life = D_LIFE): void {
  if (decalDensity < 1 && life < 4 && Math.random() > decalDensity) return; // big lingering blots always stay
  s *= 0.7;
  dummy.position.set(x, 0.03, z);
  dummy.rotation.set(0, Math.random() * Math.PI, 0);
  dummy.scale.set(s * (1 + Math.random() * 0.6), 1, s);
  dummy.updateMatrix();
  decals.setMatrixAt(dNext, dummy.matrix);
  dBirth.setX(dNext, feel.time);
  dLife.setX(dNext, life * (0.85 + Math.random() * 0.3));
  dNext = (dNext + 1) % DN;
  decals.instanceMatrix.needsUpdate = true;
  dBirth.needsUpdate = true;
  dLife.needsUpdate = true;
}
let decalDensity = 1;
onQuality((l) => {
  inkDrops.density = l === "low" ? 0.5 : 1;
  sparks.density = l === "low" ? 0.6 : 1;
  decalDensity = l === "low" ? 0.5 : 1;
});
const decalOnLand = (x: number, z: number, s: number): void => {
  if (Math.random() < 0.18) addDecal(x, z, s * 2.5);
};
export function inkBurst(x: number, y: number, z: number, n: number, dx: number, dz: number, power = 1): void {
  for (let k = 0; k < n; k++) {
    inkDrops.emit(x, y, z, (Math.random() - 0.5) * 6 * power + dx * 4 * power, Math.random() * 7 * power + 1,
      (Math.random() - 0.5) * 6 * power + dz * 4 * power, 0.05 + Math.random() * 0.11 * power, 0.6 + Math.random() * 0.6);
  }
}
export function sparkBurst(x: number, y: number, z: number, n: number, col: RGB, power = 1, up = 1): void {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 6) * power;
    sparks.emit(x, y, z, Math.cos(a) * s, (1 + Math.random() * 5) * up, Math.sin(a) * s, 0.05 + Math.random() * 0.1, 0.4 + Math.random() * 0.5, col, 2);
  }
}
/* ---------- blows landing: ink splatter, the third hit's sweep, the kill accent ----------
   All pooled (droplets, decals, rings, sparks); nothing allocates. Ink is ink; the only color is the
   skill light and dye, so the kill flecks are paper-white. */
const PAPER: RGB = [0.94, 0.91, 0.84];
const SHELL: RGB = [0.6, 0.57, 0.52];
const SHELL_EDGE: RGB = [0.35, 0.33, 0.3];
const INK_RING: RGB = [0.06, 0.055, 0.06];
/**
 * A blow lands at (x, y, z) travelling (dx, dz): splatter and droplets, `power` ~0.6 (light) .. 2 (heavy).
 * `tint` is the blow's color (a skill's, or the scarf's for a brush strike): it seeps into the ground there.
 */
export function inkHit(x: number, y: number, z: number, dx: number, dz: number, power: number, tint: RGB | null = null): void {
  inkBurst(x, y, z, Math.round(6 + power * 8), dx * 0.8, dz * 0.8, 0.7 + power * 0.35);
  for (let k = 0; k < 1 + power; k++) addDecal(x + dx * (0.4 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.6, z + dz * (0.4 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.6, 0.15 + Math.random() * 0.12 * power, 2);
  ring(x, z, 0.55 + power * 0.35, INK_RING, 0.28, 0, INK_RING);
  screenSplash(x, y, z, 0.03 + power * 0.014);
  if (tint) colorStain(x, z, 1.4 + power * 0.7, tint);
}
/** The third hit: a full circle of ink swept round the body and a bloom of ink where it closes. */
export function inkSweep(x: number, z: number, r: number): void {
  ring(x, z, r, INK_RING, 0.55, 0, INK_RING);
  ring(x, z, r * 0.7, INK_RING, 0.4, 1, INK_RING);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + Math.random() * 0.2, s = 4 + Math.random() * 3;
    inkDrops.emit(x + Math.cos(a) * r * 0.6, 0.5 + Math.random() * 0.5, z + Math.sin(a) * r * 0.6, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, 0.035 + Math.random() * 0.055, 0.7 + Math.random() * 0.4);
  }
  for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2; addDecal(x + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85, 0.2 + Math.random() * 0.2, 2.2); }
}
/** A kill: a big ink burst and a ring (no paper flecks: dots read as noise). */
export function killBurst(x: number, y: number, z: number, size: number): void {
  inkBurst(x, y, z, 26, 0, 0, 1.4 + size * 0.2);
  ring(x, z, 1.4 + size * 0.5, INK_RING, 0.45, 0, INK_RING);
  screenSplash(x, y, z, 0.06 + size * 0.02);
}
/** 가마 지킴이 while its ash shell holds: the blow only knocks flakes of shell off, which bounce. */
export function shellBounce(x: number, y: number, z: number): void {
  for (let k = 0; k < 9; k++) {
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2.5;
    sparks.emit(x, y, z, Math.cos(a) * s, 2.5 + Math.random() * 2.5, Math.sin(a) * s, 0.05 + Math.random() * 0.05, 0.5, SHELL, 0.5);
  }
  ring(x, z, 0.7, SHELL_EDGE, 0.22, 0, SHELL_EDGE);
}
/** 가마 지킴이 struck by an awakened 화염선풍: the glaze cracks and the shell falls away in white shards. */
export function glazeCrack(x: number, y: number, z: number): void {
  for (let k = 0; k < 18; k++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
    sparks.emit(x, y + (Math.random() - 0.5), z, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s, 0.04 + Math.random() * 0.07, 0.8, PAPER, 1);
  }
  inkBurst(x, y, z, 10, 0, 0, 1);
  ring(x, z, 1.6, PAPER, 0.3, 0, INK_RING);
}

/* ---------- the fragment of fire: from the ash ghost's brush tip into the player's brush (pooled, one at a time) ---------- */
const CINNABAR: RGB = [0.9, 0.27, 0.15];
const flow = { on: false, t: 0, sx: 0, sy: 0, sz: 0, to: null as Spot | null, dur: 1.8 };
/**
 * When 잿불귀 falls: the white fire at its brush tip turns cinnabar and flows into `to` (the player): a
 * stream of cinnabar along an arc, a burst at the brush, and the skill light reveals colour round the player.
 */
export function fireFlow(sx: number, sy: number, sz: number, to: Spot): void {
  flow.on = true; flow.t = 0; flow.sx = sx; flow.sy = sy; flow.sz = sz; flow.to = to;
  sparkBurst(sx, sy, sz, 24, CINNABAR, 0.8, 1.2);
  addLight(sx, sz, 6, 1.6, CINNABAR);
}
function updateFlow(dt: number): void {
  if (!flow.on || !flow.to) return;
  flow.t += dt;
  const u = Math.min(1, flow.t / flow.dur), e = u * u * (3 - 2 * u);
  const tx = flow.to.x, tz = flow.to.z, ty = 2.3;
  const x = flow.sx + (tx - flow.sx) * e, z = flow.sz + (tz - flow.sz) * e;
  const y = flow.sy + (ty - flow.sy) * e + Math.sin(u * Math.PI) * 2.2;
  for (let k = 0; k < 3; k++) sparks.emit(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.6, (Math.random() - 0.5) * 0.6, 0.05 + Math.random() * 0.06, 0.5, CINNABAR, 1);
  if (u >= 1) {
    flow.on = false;
    sparkBurst(tx, ty, tz, 30, CINNABAR, 0.9, 1.4);
    addLight(tx, tz, 7, 3.2, CINNABAR, flow.to);
    flow.to = null;
  }
}

/**
 * Hit-stop and shake for a blow (light 0..1 heavy) or a kill. Every blow holds the world still for a few frames
 * (3 for a light one, ~6 for the third strike, ~7 for a kill) while the ink and color bleed on the paper in real
 * time, then lets it creep on for a moment: the quiet painting cuts hard on the blow. The server does not stop,
 * so this stays short.
 */
export function hitFeel(weight: number, kill: boolean): void {
  feel.freeze = Math.max(feel.freeze, kill ? 0.14 : 0.055 + weight * 0.06);
  feel.hitstop = Math.max(feel.hitstop, 0.045);
  feel.shake = Math.max(feel.shake, kill ? 0.28 : 0.12 + weight * 0.13);
}

/** Ink droplet that falls with gravity (blot suction, shot trails). */
export function inkDrop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
  inkDrops.emit(x, y, z, vx, vy, vz, size, life);
}

/* ---------- afterimage ghosts ---------- */
interface Ghost { rig: Rig; mat: THREE.MeshBasicMaterial; life: number; max: number; peak: number }
const ghosts: Ghost[] = [];
for (let k = 0; k < 12; k++) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0, depthWrite: false });
  const rig = new Rig(mat, true);
  rig.group.visible = false;
  // added to the scene only while showing (an idle rig in the graph is ~35 nodes walked every frame)
  ghosts.push({ rig, mat, life: 0, max: 0.3, peak: 0.5 });
}
let ghostNext = 0;
export function spawnGhost(src: Rig, hex: number, life = 0.3, peak = 0.5): void {
  const g = ghosts[ghostNext];
  ghostNext = (ghostNext + 1) % ghosts.length;
  g.rig.copyFrom(src);
  g.mat.color.setHex(hex);
  g.life = life;
  g.max = life;
  g.peak = peak;
  g.rig.group.visible = true;
  if (!g.rig.group.parent) scene.add(g.rig.group);
}
/**
 * An ink afterimage of the figure that bleeds away (바람질주): it holds dark, thins out and runs, with a few
 * drops falling from it as it goes.
 */
export function inkAfterimage(src: Rig, drops: number): void {
  spawnGhost(src, 0x141210, 0.85, 0.92);
  const p = src.group.position;
  for (let k = 0; k < drops; k++) {
    inkDrops.emit(p.x + (Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 1.5, p.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6, -0.5 - Math.random(), (Math.random() - 0.5) * 0.6, 0.035 + Math.random() * 0.05, 1.1);
  }
}
function updateGhosts(dt: number): void {
  for (const g of ghosts) {
    if (g.life <= 0) continue;
    g.life -= dt;
    const u = Math.max(0, g.life / g.max);
    const k = Math.min(1, u / 0.55); // holds, then thins out
    g.mat.opacity = k * k * g.peak;
    g.rig.group.visible = g.life > 0;
    if (g.life <= 0) scene.remove(g.rig.group);
  }
}

/* ---------- 먹감옥 blots ---------- */
interface Blot { on: boolean; x: number; z: number; t: number; done: boolean; local: boolean; r: number; echo: boolean; echoDone: boolean }
const blots: Blot[] = Array.from({ length: 4 }, () => ({ on: false, x: 0, z: 0, t: 0, done: false, local: false, r: 4.4, echo: false, echoDone: false }));
const BLOT_EDGE: RGB = [0.02, 0.02, 0.02];
/** Visual only; the server resolves the hit. Lands 1.2 s after it is cast. */
export function spawnBlot(x: number, z: number, local: boolean, r = 4.4, echo = false): void {
  let b = blots[0];
  for (const o of blots) if (!o.on) { b = o; break; }
  b.on = true; b.x = x; b.z = z; b.t = 0; b.done = false; b.local = local; b.r = r; b.echo = echo; b.echoDone = false;
  ring(x, z, r, SKILL_COL[4], 1.6, 1, BLOT_EDGE);
  inkBurst(x, 0.3, z, 18, 0, 0, 1.2);
}
export const BLOT_DELAY = 1.2;
function updateBlots(dt: number): void {
  for (const b of blots) {
    if (!b.on) continue;
    b.t += dt;
    if (b.t < BLOT_DELAY) {
      if (Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = b.r * (0.68 + Math.random() * 0.34);
        inkDrops.emit(b.x + Math.cos(a) * r, 0.1, b.z + Math.sin(a) * r, -Math.cos(a) * 5, 2 + Math.random() * 2, -Math.sin(a) * 5, 0.06 + Math.random() * 0.08, 0.6);
      }
    } else if (!b.done) {
      b.done = true;
      inkBurst(b.x, 0.5, b.z, 52, 0, 0, 2);
      ring(b.x, b.z, b.r * 1.25, INK_RING, 0.55, 0, INK_RING);
      // the prison leaves one bigger blot that lingers a little, and a couple of splashes
      addDecal(b.x, b.z, b.r * 0.55, 4.5);
      for (let k = 0; k < 2; k++) addDecal(b.x + (Math.random() - 0.5) * 4, b.z + (Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.3);
      if (b.local) {
        screenSplash(b.x, 0.5, b.z, 0.09);
        feel.shake = Math.max(feel.shake, 0.5);
        feel.hitstop = Math.max(feel.hitstop, 0.08);
      }
    }
    if (b.echo && !b.echoDone && b.t >= BLOT_DELAY + 0.4) {
      b.echoDone = true;
      ring(b.x, b.z, b.r, SKILL_COL[4], 0.6, 1, BLOT_EDGE);
      inkBurst(b.x, 0.5, b.z, 28, 0, 0, 1.6);
      if (b.local) feel.shake = Math.max(feel.shake, 0.35);
    }
    if (b.t > (b.echo ? 2.1 : 1.7)) b.on = false;
  }
}

/* ---------- 대지낙하 landing ---------- */
const EARTH_INNER: RGB = [1, 0.88, 0.45];
export function earthSlam(x: number, z: number, local: boolean, r = 5, echo = false): void {
  const col = SKILL_COL[2];
  ring(x, z, r, col, 0.7);
  ring(x, z, r * 0.64, EARTH_INNER, 0.5);
  ring(x, z, r * 1.3, col, 0.9, 0, INK_RING);
  if (echo) later(0.4, x, z, r, local, "earth");
  colorStain(x, z, r * 1.1, col);
  inkBurst(x, 0.2, z, 22, 0, 0, 1.4);
  addDecal(x, z, r * 0.5, 3.5);
  addLight(x, z, 13, 1.3, col);
  if (local) {
    screenSplash(x, 0.3, z, 0.08);
    feel.shake = Math.max(feel.shake, 0.7);
    feel.hitstop = Math.max(feel.hitstop, 0.08);
  }
}

/* ---------- big moments: level-up, an awakening, a chapter boss falling ----------
   Three rings of the color spreading one after another, the color soaking into the ground and a light.
   Nothing allocates. */
export function bigMoment(x: number, z: number, col: readonly number[], power = 1, local = true): void {
  const c = col as RGB;
  ring(x, z, 2.4 * power, c, 0.8);
  ring(x, z, 4.4 * power, c, 1.15, 0, INK_RING);
  ring(x, z, 6.6 * power, c, 1.5);
  // no sparks (dots read as noise): the color floods the ground instead
  colorStain(x, z, 5.5 * power, c);
  addLight(x, z, 12 * power, 1.8, c);
  if (local) feel.shake = Math.max(feel.shake, 0.35);
}

/* ---------- delayed echoes (여운) ---------- */
type EchoKind = "fire" | "earth" | "wind";
interface Echo { t: number; x: number; z: number; r: number; local: boolean; kind: EchoKind; on: boolean }
const echoes: Echo[] = Array.from({ length: 12 }, () => ({ t: 0, x: 0, z: 0, r: 0, local: false, kind: "fire" as EchoKind, on: false }));
export function later(delay: number, x: number, z: number, r: number, local: boolean, kind: EchoKind): void {
  let e = echoes[0];
  for (const o of echoes) if (!o.on) { e = o; break; }
  e.t = delay; e.x = x; e.z = z; e.r = r; e.local = local; e.kind = kind; e.on = true;
}
const WIND_EDGE: RGB = [0.35, 0.37, 0.42];
const WHITE: RGB = [1, 1, 1];
function updateEchoes(dt: number): void {
  for (const e of echoes) {
    if (!e.on) continue;
    e.t -= dt;
    if (e.t > 0) continue;
    e.on = false;
    if (e.kind === "fire") {
      ring(e.x, e.z, e.r, SKILL_COL[1], 0.6);
      colorStain(e.x, e.z, e.r, SKILL_COL[1]);
    } else if (e.kind === "earth") {
      ring(e.x, e.z, e.r * 1.1, SKILL_COL[2], 0.6);
      colorStain(e.x, e.z, e.r * 1.1, SKILL_COL[2]);
      inkBurst(e.x, 0.2, e.z, 10, 0, 0, 1);
      if (e.local) feel.shake = Math.max(feel.shake, 0.4);
    } else {
      ring(e.x, e.z, e.r, WHITE, 0.45, 0, WIND_EDGE);
    }
  }
}

export function updateFx(dt: number): void {
  updateFlow(dt);
  decalMat.uniforms.uTime.value = feel.time;
  updateEchoes(dt);
  updateCrescents(dt);
  updateBlots(dt);
  updateRings(dt);
  sparks.update(dt, 6, null);
  inkDrops.update(dt, 22, decalOnLand);
  updateGhosts(dt);
}

/** Zone change: drop every in-flight effect and stain. */
export function clearFx(): void {
  flow.on = false;
  flow.to = null;
  for (const r of rings) { r.mesh.visible = false; r.follow = null; }
  for (const c of crescents) c.mesh.visible = false;
  for (const b of blots) b.on = false;
  for (const e of echoes) e.on = false;
  for (const g of ghosts) { g.life = 0; g.rig.group.visible = false; scene.remove(g.rig.group); }
  sparks.clear();
  inkDrops.clear();
  for (let i = 0; i < DN; i++) decals.setMatrixAt(i, ZERO);
  decals.instanceMatrix.needsUpdate = true;
}
