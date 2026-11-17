// Effects from the prototype, all pooled: brush rings, crescent waves, colored sparks (overlay), ink
// droplets and ground decals (ink scene), afterimage ghosts, ink-prison blots, ribbons and weapon trails.
// Nothing here allocates per frame; every pool is created once and lives for the session.

import * as THREE from "three";
import { SKILLS } from "../../shared/combat";
import { clamp, type RGB, type Spot } from "../util";
import { G, dyeCloth } from "./materials";
import { addLight, camFwd, feel, overlay, scene, screenSplash } from "./gfx";
import { Rig } from "./rig";

export const INK_TRAIL: RGB = [0.08, 0.075, 0.07];
export const SILVER_TRAIL: RGB = [0.78, 0.83, 0.93];
export const GOLD_TRAIL: RGB = [0.86, 0.64, 0.18];
export const SKILL_COL: RGB[] = SKILLS.map((s) => s.color);

/* ---------- ribbons (scarf, sash tails) ---------- */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly x: Float32Array; private readonly y: Float32Array; private readonly z: Float32Array;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  constructor(private readonly N = 10, private readonly segLen = 0.17, private readonly width = 0.1) {
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.z = new Float32Array(N);
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
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
  update(dt: number, ax: number, ay: number, az: number, head: number, t: number): void {
    const { x, y, z, px, py, pz, N } = this;
    x[0] = px[0] = ax; y[0] = py[0] = ay; z[0] = pz[0] = az;
    const fx = Math.cos(head), fz = -Math.sin(head), d2 = dt * dt;
    for (let i = 1; i < N; i++) {
      const vx = (x[i] - px[i]) * 0.94, vy = (y[i] - py[i]) * 0.94, vz = (z[i] - pz[i]) * 0.94;
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      x[i] += vx + (-fx * 8 + Math.sin(t * 6 + i * 0.8) * 3) * d2;
      y[i] += vy + (-6 + Math.sin(t * 7.3 + i) * 4) * d2;
      z[i] += vz + (-fz * 8 + Math.cos(t * 5 + i) * 3) * d2;
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
    // a teleport (zone change, far snap) would stretch the ribbon: start over
    if (Math.abs(x[N - 1] - ax) > 6 || Math.abs(z[N - 1] - az) > 6) this.reset(ax, ay, az);
    const pos = this.geo.attributes.position.array as Float32Array;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      const tx = x[b] - x[a], ty = y[b] - y[a], tz = z[b] - z[a];
      let wx = ty * camFwd.z - tz * camFwd.y, wy = tz * camFwd.x - tx * camFwd.z, wz = tx * camFwd.y - ty * camFwd.x;
      const wl = Math.hypot(wx, wy, wz) || 1, w = (this.width * (1 - (i / (N - 1)) * 0.65)) / wl;
      wx *= w; wy *= w; wz *= w;
      pos[i * 6] = x[i] - wx; pos[i * 6 + 1] = y[i] - wy; pos[i * 6 + 2] = z[i] - wz;
      pos[i * 6 + 3] = x[i] + wx; pos[i * 6 + 4] = y[i] + wy; pos[i * 6 + 5] = z[i] + wz;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  /** OWNED geometry: dispose when the actor goes away. Material is shared. */
  dispose(): void {
    scene.remove(this.mesh);
    this.geo.dispose();
  }
}

/* ---------- weapon trails (overlay) ---------- */
const M_trail = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
export class Trail {
  private readonly N = 18;
  private readonly base = new Float32Array(this.N * 3);
  private readonly tip = new Float32Array(this.N * 3);
  private readonly geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  strength = 0;
  col: RGB = INK_TRAIL;
  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 6), 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.N * 8), 4));
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
    const pos = this.geo.attributes.position.array as Float32Array, col = this.geo.attributes.color.array as Float32Array, c = this.col;
    for (let i = 0; i < N; i++) {
      const a = this.strength * Math.pow(1 - i / (N - 1), 1.6) * 0.92;
      for (let k = 0; k < 3; k++) { pos[i * 6 + k] = this.base[i * 3 + k]; pos[i * 6 + 3 + k] = this.tip[i * 3 + k]; }
      const j = i * 8;
      col[j] = c[0]; col[j + 1] = c[1]; col[j + 2] = c[2]; col[j + 3] = a * 0.35;
      col[j + 4] = c[0]; col[j + 5] = c[1]; col[j + 6] = c[2]; col[j + 7] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
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
const BRUSH_FRAG = `
  uniform vec3 uCol, uEdge; uniform float uProg, uFade, uSeed, uMode; varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
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
    uniforms: { uCol: { value: new THREE.Vector3() }, uEdge: { value: new THREE.Vector3() }, uProg: { value: 0 }, uFade: { value: 0 }, uSeed: { value: 0 }, uMode: { value: 0 } },
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
interface Crescent { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; x: number; z: number; fx: number; fz: number; head: number; t: number; limit: number }
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
  mesh.scale.set(3.4, 1, 4.4);
  overlay.add(mesh);
  crescents.push({ mesh, mat, x: 0, z: 0, fx: 1, fz: 0, head: 0, t: 0, limit: 30 });
}
let crescNext = 0;
export function fireCrescent(x: number, z: number, head: number, limit: number, local: boolean): void {
  const c = crescents[crescNext];
  crescNext = (crescNext + 1) % crescents.length;
  c.fx = Math.cos(head); c.fz = -Math.sin(head);
  c.x = x + c.fx * 1.2; c.z = z + c.fz * 1.2; c.head = head; c.t = 0; c.limit = limit;
  c.mesh.visible = true;
  addLight(c.x, c.z, 6, 0.75, SKILL_COL[0], c);
  if (local) feel.shake = Math.max(feel.shake, 0.15);
}
const LIGHT_BLUE: RGB = [0.75, 0.88, 1];
function updateCrescents(dt: number): void {
  for (const c of crescents) {
    if (!c.mesh.visible) continue;
    c.t += dt;
    c.x += c.fx * 19 * dt; c.z += c.fz * 19 * dt;
    c.mesh.position.set(c.x, 0.9, c.z);
    c.mesh.rotation.set(0, c.head, 0);
    c.mat.uniforms.uFade.value = 1 - clamp((c.t - 0.45) / 0.2, 0, 1);
    if (Math.random() < 0.7) sparks.emit(c.x + (Math.random() - 0.5) * 2, 0.6 + Math.random(), c.z + (Math.random() - 0.5) * 2, -c.fx * 3, 1, -c.fz * 3, 0.05 + Math.random() * 0.07, 0.5, Math.random() < 0.5 ? SKILL_COL[0] : LIGHT_BLUE, 2);
    if (c.t > 0.65 || Math.hypot(c.x, c.z) > c.limit + 2) c.mesh.visible = false;
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
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, col: RGB | null = null, drag = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.size[i] = size; this.life[i] = life; this.drag[i] = drag;
    this.live = 2;
    if (this.colored && col && this.mesh.instanceColor) {
      this.mesh.setColorAt(i, cTmp.setRGB(col[0], col[1], col[2]));
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
  update(dt: number, grav: number, onGround: ((x: number, z: number, s: number) => void) | null): void {
    if (this.live <= 0) return; // nothing alive and matrices already cleared
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] > 0) { this.size[i] = 0; this.mesh.setMatrixAt(i, ZERO); }
        continue;
      }
      any = true;
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
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    for (let i = 0; i < this.n; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
  }
}
export const sparks = new Particles(420, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }), overlay, true);
const inkDrops = new Particles(300, new THREE.MeshBasicMaterial({ color: 0x141312 }), scene, false);

/* ---------- ground decals (ink stains) ---------- */
const DN = 180;
const decals = new THREE.InstancedMesh(G.disc, new THREE.MeshBasicMaterial({ color: 0x161514, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), DN);
decals.frustumCulled = false;
scene.add(decals);
for (let i = 0; i < DN; i++) decals.setMatrixAt(i, ZERO);
let dNext = 0;
export function addDecal(x: number, z: number, s: number): void {
  dummy.position.set(x, 0.03, z);
  dummy.rotation.set(0, Math.random() * Math.PI, 0);
  dummy.scale.set(s * (1 + Math.random()), 1, s);
  dummy.updateMatrix();
  decals.setMatrixAt(dNext, dummy.matrix);
  dNext = (dNext + 1) % DN;
  decals.instanceMatrix.needsUpdate = true;
}
const decalOnLand = (x: number, z: number, s: number): void => {
  if (Math.random() < 0.45) addDecal(x, z, s * 3);
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
/** Ink droplet that falls with gravity (blot suction, shot trails). */
export function inkDrop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
  inkDrops.emit(x, y, z, vx, vy, vz, size, life);
}

/* ---------- afterimage ghosts ---------- */
interface Ghost { rig: Rig; mat: THREE.MeshBasicMaterial; life: number }
const ghosts: Ghost[] = [];
for (let k = 0; k < 12; k++) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0, depthWrite: false });
  const rig = new Rig(mat, true);
  rig.group.visible = false;
  scene.add(rig.group);
  ghosts.push({ rig, mat, life: 0 });
}
let ghostNext = 0;
export function spawnGhost(src: Rig, hex: number): void {
  const g = ghosts[ghostNext];
  ghostNext = (ghostNext + 1) % ghosts.length;
  g.rig.copyFrom(src);
  g.mat.color.setHex(hex);
  g.life = 0.3;
  g.rig.group.visible = true;
}
function updateGhosts(dt: number): void {
  for (const g of ghosts) {
    if (g.life <= 0) continue;
    g.life -= dt;
    g.mat.opacity = Math.max(0, g.life / 0.3) * 0.5;
    g.rig.group.visible = g.life > 0;
  }
}

/* ---------- 먹감옥 blots ---------- */
interface Blot { on: boolean; x: number; z: number; t: number; done: boolean; local: boolean }
const blots: Blot[] = Array.from({ length: 4 }, () => ({ on: false, x: 0, z: 0, t: 0, done: false, local: false }));
const BLOT_EDGE: RGB = [0.02, 0.02, 0.02];
/** Visual only; the server resolves the hit. Lands 1.2 s after it is cast. */
export function spawnBlot(x: number, z: number, local: boolean): void {
  let b = blots[0];
  for (const o of blots) if (!o.on) { b = o; break; }
  b.on = true; b.x = x; b.z = z; b.t = 0; b.done = false; b.local = local;
  ring(x, z, 4.4, SKILL_COL[4], 1.6, 1, BLOT_EDGE);
  inkBurst(x, 0.3, z, 18, 0, 0, 1.2);
}
export const BLOT_DELAY = 1.2;
function updateBlots(dt: number): void {
  for (const b of blots) {
    if (!b.on) continue;
    b.t += dt;
    if (b.t < BLOT_DELAY) {
      if (Math.random() < 0.6) {
        const a = Math.random() * 6.28, r = 3 + Math.random() * 1.5;
        inkDrops.emit(b.x + Math.cos(a) * r, 0.1, b.z + Math.sin(a) * r, -Math.cos(a) * 5, 2 + Math.random() * 2, -Math.sin(a) * 5, 0.06 + Math.random() * 0.08, 0.6);
      }
    } else if (!b.done) {
      b.done = true;
      inkBurst(b.x, 0.5, b.z, 40, 0, 0, 1.8);
      for (let k = 0; k < 8; k++) addDecal(b.x + (Math.random() - 0.5) * 5, b.z + (Math.random() - 0.5) * 5, 0.3 + Math.random() * 0.5);
      if (b.local) {
        screenSplash(b.x, 0.5, b.z, 0.09);
        feel.shake = Math.max(feel.shake, 0.5);
        feel.hitstop = Math.max(feel.hitstop, 0.08);
      }
    }
    if (b.t > 1.7) b.on = false;
  }
}

/* ---------- 대지낙하 landing ---------- */
const EARTH_INNER: RGB = [1, 0.88, 0.45];
export function earthSlam(x: number, z: number, local: boolean): void {
  const col = SKILL_COL[2];
  ring(x, z, 5.0, col, 0.7);
  ring(x, z, 3.2, EARTH_INNER, 0.5);
  sparkBurst(x, 0.2, z, 40, col, 1.4, 1.6);
  inkBurst(x, 0.2, z, 16, 0, 0, 1.2);
  addLight(x, z, 10, 1.1, col);
  if (local) {
    feel.shake = Math.max(feel.shake, 0.6);
    feel.hitstop = Math.max(feel.hitstop, 0.07);
  }
}

export function updateFx(dt: number): void {
  updateCrescents(dt);
  updateBlots(dt);
  updateRings(dt);
  sparks.update(dt, 6, null);
  inkDrops.update(dt, 22, decalOnLand);
  updateGhosts(dt);
}

/** Zone change: drop every in-flight effect and stain. */
export function clearFx(): void {
  for (const r of rings) { r.mesh.visible = false; r.follow = null; }
  for (const c of crescents) c.mesh.visible = false;
  for (const b of blots) b.on = false;
  for (const g of ghosts) { g.life = 0; g.rig.group.visible = false; }
  sparks.clear();
  inkDrops.clear();
  for (let i = 0; i < DN; i++) decals.setMatrixAt(i, ZERO);
  decals.instanceMatrix.needsUpdate = true;
}
