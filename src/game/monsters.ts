// Monsters as the server reports them (api.onRoom): interpolated ink spirits in the prototype's style,
// hit flash on hitAt changes, death splash, drop-in on respawn. Server effects: ink shots fly to their
// target and splat, boss slams show an ink ring warning on the ground until they go off.
// Views are pooled per kind and only reference SHARED geometry/materials, so a zone change just hides them.

import * as THREE from "three";
import { MONSTERS, isObstacle, type MonsterDef } from "../shared/combat";
import type { MonsterMode, MonsterState } from "../shared/types";
import type { RoomEffect, RoomView } from "../net/api";
import { angDiff, clamp, type RGB } from "./util";
import { G, M_enemy, M_eye, M_flash, M_shadow } from "./render/materials";
import { feel, overlay, scene, screenSplash } from "./render/gfx";
import { QUAD_VERT, addDecal, inkBurst, inkDrop, ring, sparkBurst } from "./render/fx";

interface Look {
  group: THREE.Group;
  /** meshes that flash white when hit */
  flash: THREE.Mesh[];
  body: THREE.Object3D;
  armL: THREE.Object3D | null;
  armR: THREE.Object3D | null;
  sac: THREE.Object3D | null;
}

export interface MView {
  id: string;
  kind: string;
  def: MonsterDef;
  look: Look;
  shadow: THREE.Mesh;
  x: number; z: number; y: number;
  tx: number; tz: number;
  head: number;
  mode: MonsterMode;
  since: number;
  hitAt: number;
  hp: number; maxHp: number; level: number;
  flash: number;
  flashOn: boolean;
  drop: number;
  shown: boolean;
  phase: number;
  /** red ring on the ground while this monster winds up a melee blow */
  windTele: Tele | null;
  /** live obstacle circle (vines), reused */
  readonly obst: { x: number; z: number; r: number };
  /** 0..1 while a vine grows back */
  grow: number;
  speed: number;
  stamp: number;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function arm(parent: THREE.Object3D, x: number, y: number, z: number, len: number, r: number, fist: number, out: THREE.Mesh[]): THREE.Object3D {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const a = mesh(G.seg, M_enemy, 0, -len / 2, 0, r, len, r);
  pivot.add(a);
  out.push(a);
  if (fist > 0) {
    const f = mesh(G.head, M_enemy, 0, -len, 0, fist, fist, fist);
    pivot.add(f);
    out.push(f);
  }
  parent.add(pivot);
  return pivot;
}

/** a dark haze around the elite (SHARED) */
const M_aura = new THREE.MeshBasicMaterial({ color: 0x0b0a10, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.BackSide });
const FIRE: RGB = [0.95, 0.42, 0.12];
const EMBER: RGB = [1, 0.75, 0.3];

function buildLook(kind: string): Look {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const flash: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh, f = true) => { body.add(m); if (f) flash.push(m); return m; };
  let armL: THREE.Object3D | null = null, armR: THREE.Object3D | null = null, sac: THREE.Object3D | null = null;
  if (kind === "shade") {
    const cone = add(mesh(G.cone, M_enemy, 0, 0.75, 0, 0.42, 1.3, 0.42));
    cone.rotation.x = 0;
    add(mesh(G.head, M_enemy, 0.05, 1.58, 0, 0.3, 0.32, 0.3));
    add(mesh(G.head, M_enemy, -0.12, 1.75, 0, 0.18, 0.22, 0.2)); // hood point
    for (const z of [0.11, -0.11]) add(mesh(G.eye, M_eye, 0.28, 1.62, z, 0.055, 0.04, 0.055), false);
    armL = arm(body, 0.05, 1.28, -0.3, 0.75, 0.06, 0.09, flash);
    armR = arm(body, 0.05, 1.28, 0.3, 0.75, 0.06, 0.09, flash);
  } else if (kind === "spitter") {
    add(mesh(G.head, M_enemy, 0, 0.48, 0, 0.75, 0.48, 0.7));
    add(mesh(G.head, M_enemy, 0.42, 0.62, 0, 0.42, 0.32, 0.46));
    for (const z of [0.22, -0.22]) {
      add(mesh(G.head, M_enemy, 0.4, 0.92, z, 0.15, 0.15, 0.15));
      add(mesh(G.eye, M_eye, 0.5, 0.96, z, 0.07, 0.07, 0.07), false);
      add(mesh(G.head, M_enemy, -0.35, 0.18, z * 2.4, 0.28, 0.16, 0.18));
    }
    sac = add(mesh(G.head, M_enemy, 0.62, 0.36, 0, 0.22, 0.2, 0.26));
  } else if (kind === "boss") {
    add(mesh(G.head, M_enemy, 0, 1.45, 0, 1.45, 1.35, 1.25));
    add(mesh(G.head, M_enemy, 0.45, 2.65, 0, 0.78, 0.7, 0.75));
    for (const z of [0.42, -0.42]) {
      const h = add(mesh(G.cone, M_enemy, 0.3, 3.35, z, 0.17, 0.9, 0.17));
      h.rotation.x = z > 0 ? 0.45 : -0.45;
      add(mesh(G.eye, M_eye, 1.1, 2.8, z * 0.7, 0.14, 0.1, 0.14), false);
      add(mesh(G.seg, M_enemy, 0, 0.3, z * 1.5, 0.3, 0.6, 0.3));
    }
    add(mesh(G.box, M_eye, 1.12, 2.45, 0, 0.05, 0.08, 0.6), false); // teeth line
    armL = arm(body, 0.2, 2.25, -1.35, 1.7, 0.24, 0.42, flash);
    armR = arm(body, 0.2, 2.25, 1.35, 1.7, 0.24, 0.42, flash);
  } else if (kind === "vine") {
    // 먹덩굴: a thorny bramble of ink stalks around a low clump
    add(mesh(G.head, M_enemy, 0, 0.25, 0, 1.3, 0.38, 1.3));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, r = 0.55 + (k % 3) * 0.22, h = 1.3 + (k % 4) * 0.35;
      const st = add(mesh(G.cone, M_enemy, Math.cos(a) * r, h * 0.5, Math.sin(a) * r, 0.13, h, 0.13));
      st.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
      const th = add(mesh(G.cone, M_enemy, Math.cos(a) * (r + 0.18), h * 0.55, Math.sin(a) * (r + 0.18), 0.05, 0.28, 0.05));
      th.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
    }
  } else if (kind === "shadelord") {
    // 그림자 무사: a bigger shade in a dark aura
    const cone = add(mesh(G.cone, M_enemy, 0, 0.75, 0, 0.42, 1.3, 0.42));
    cone.rotation.x = 0;
    add(mesh(G.head, M_enemy, 0.05, 1.58, 0, 0.3, 0.32, 0.3));
    add(mesh(G.head, M_enemy, -0.12, 1.75, 0, 0.18, 0.22, 0.2));
    for (const z of [0.11, -0.11]) add(mesh(G.eye, M_eye, 0.28, 1.62, z, 0.055, 0.04, 0.055), false);
    armL = arm(body, 0.05, 1.28, -0.3, 0.75, 0.06, 0.09, flash);
    armR = arm(body, 0.05, 1.28, 0.3, 0.75, 0.06, 0.09, flash);
    body.scale.setScalar(1.35);
    const aura = mesh(G.head, M_aura, 0, 1.1, 0, 0.95, 1.45, 0.95);
    group.add(aura);
  } else if (kind === "bigblob") {
    add(mesh(G.head, M_enemy, 0, 0.85, 0, 1.0, 0.85, 1.0));
    for (const z of [0.32, -0.32]) add(mesh(G.eye, M_eye, 0.82, 1.05, z, 0.14, 0.14, 0.14), false);
    for (let k = 0; k < 4; k++) add(mesh(G.head, M_enemy, Math.cos(k * 1.7) * 0.8, 0.12, Math.sin(k * 1.7) * 0.8, 0.22, 0.12, 0.22));
  } else {
    // blob (default for unknown kinds too)
    add(mesh(G.head, M_enemy, 0, 0.52, 0, 0.6, 0.52, 0.6));
    for (const z of [0.2, -0.2]) add(mesh(G.eye, M_eye, 0.48, 0.66, z, 0.1, 0.1, 0.1), false);
  }
  group.visible = false;
  scene.add(group);
  return { group, flash, body, armL, armR, sac };
}

/* ---------- slam telegraph (overlay) ---------- */
const TELE_FRAG = `
  uniform float uProg, uFade, uSeed; uniform vec3 uCol; varying vec2 vUv;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p), a = atan(p.y, p.x);
    float n = (noise(vec2(a * 4.0 + uSeed, uSeed)) - 0.5) * 0.06;
    float rr = r + n;
    float rim = smoothstep(0.86, 0.93, rr) * (1.0 - smoothstep(0.97, 1.0, rr));
    float fill = (1.0 - smoothstep(uProg - 0.04, uProg, rr)) * 0.38;
    float m = max(rim * 0.85, fill) * mix(1.0, smoothstep(0.15, 0.6, noise(vec2(a * 18.0, r * 30.0 + uSeed))), 0.35);
    float alpha = m * uFade;
    if (alpha < 0.01 || r > 1.0) discard;
    gl_FragColor = vec4(uCol, alpha);
  }`;
interface Tele { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }
const teles: Tele[] = [];
// Red ink: wind-ups, slam marks and shot landings all read as "get out of here" (dodge with a roll).
const TELE_RED = new THREE.Vector3(0.68, 0.12, 0.08);
for (let i = 0; i < 16; i++) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uProg: { value: 0 }, uFade: { value: 1 }, uSeed: { value: i * 5.3 }, uCol: { value: TELE_RED } },
    vertexShader: QUAD_VERT, fragmentShader: TELE_FRAG,
  });
  const m = new THREE.Mesh(G.flat, mat);
  m.visible = false;
  m.frustumCulled = false;
  m.renderOrder = -1;
  overlay.add(m);
  teles.push({ mesh: m, mat });
}

interface FxView {
  e: RoomEffect;
  t0: number;
  done: boolean;
  stamp: number;
  shot: THREE.Mesh | null;
  tele: Tele | null;
  /** where a shot will land */
  mark: Tele | null;
}
const shots: THREE.Mesh[] = [];
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(G.head, M_enemy);
  m.scale.setScalar(0.26);
  m.visible = false;
  scene.add(m);
  shots.push(m);
}
const SPLAT_EDGE: RGB = [0.02, 0.02, 0.02];
const INK: RGB = [0.06, 0.06, 0.06];

export class Monsters {
  readonly views = new Map<string, MView>();
  private readonly pool = new Map<string, MView[]>();
  private readonly fx = new Map<string, FxView>();
  private offset = 0;
  private hasClock = false;
  private stamp = 0;
  /** players for facing: (x, z) of everyone alive, updated by the game each frame */
  readonly targets: { x: number; z: number }[] = [];
  /** live obstacles (vines) the player collides with; refreshed on each room update, objects reused */
  readonly obstacles: { x: number; z: number; r: number }[] = [];
  /** elites shown with a name plate */
  readonly elites: MView[] = [];
  /** a server effect just appeared (gate hints) */
  onEffect: ((kind: RoomEffect["kind"]) => void) | null = null;
  /** a spit leaves the mouth / a slam lands (sound) */
  onSound: ((name: "monster-spit" | "monster-slam", x: number, z: number) => void) | null = null;

  serverNow(): number {
    return Date.now() + this.offset;
  }

  onRoom(room: RoomView, px: number, pz: number): void {
    const sample = room.now - Date.now();
    if (!this.hasClock) { this.offset = sample; this.hasClock = true; }
    else this.offset += (sample - this.offset) * 0.1;
    const stamp = ++this.stamp;
    for (const id in room.monsters) {
      const s = room.monsters[id];
      let v = this.views.get(id);
      if (!v) { v = this.acquire(s); this.views.set(id, v); }
      this.sync(v, s, px, pz);
      v.stamp = stamp;
    }
    for (const [id, v] of this.views) {
      if (v.stamp !== stamp) { this.release(v); this.views.delete(id); }
    }
    this.obstacles.length = 0;
    this.elites.length = 0;
    for (const v of this.views.values()) {
      if (v.mode === "dead") continue;
      if (isObstacle(v.def)) { v.obst.x = v.x; v.obst.z = v.z; v.obst.r = v.def.radius; this.obstacles.push(v.obst); }
      if (v.def.armor === "training") this.elites.push(v);
    }
    const now = this.serverNow();
    for (const e of room.effects) {
      let f = this.fx.get(e.id);
      if (!f) {
        if (e.at < now - 150) continue; // already over
        f = { e, t0: now, done: false, stamp, shot: null, tele: null, mark: null };
        if (e.kind === "shot") { f.shot = this.freeShot(); f.mark = this.freeTele(e.tx, e.tz, Math.max(1, e.r)); }
        else f.tele = this.freeTele(e.tx, e.tz, e.r);
        this.onEffect?.(e.kind);
        if (e.kind === "shot") this.onSound?.("monster-spit", e.x, e.z);
        this.fx.set(e.id, f);
      }
      f.e = e;
      f.stamp = stamp;
    }
    for (const [id, f] of this.fx) if (f.done && f.stamp !== stamp) this.fx.delete(id);
  }

  private acquire(s: MonsterState): MView {
    const list = this.pool.get(s.kind);
    const v = list?.pop();
    if (v) { v.id = s.id; v.shown = false; v.hitAt = s.hitAt; v.mode = s.mode; return v; }
    const def = MONSTERS[s.kind] ?? MONSTERS.blob;
    const look = buildLook(s.kind);
    const shadow = new THREE.Mesh(G.shadow, M_shadow);
    shadow.visible = false;
    scene.add(shadow);
    return {
      id: s.id, kind: s.kind, def, look, shadow, x: s.x, z: s.z, y: 0, tx: s.x, tz: s.z, head: 0, mode: s.mode, since: s.since,
      hitAt: s.hitAt, hp: s.hp, maxHp: s.maxHp, level: s.level, flash: 0, flashOn: false, drop: 0, shown: false,
      phase: Math.random() * 6, speed: 0, stamp: 0, windTele: null, obst: { x: s.x, z: s.z, r: def.radius }, grow: 1,
    };
  }

  private release(v: MView): void {
    if (v.windTele) { v.windTele.mesh.visible = false; v.windTele = null; }
    v.look.group.visible = false;
    v.shadow.visible = false;
    let list = this.pool.get(v.kind);
    if (!list) { list = []; this.pool.set(v.kind, list); }
    list.push(v);
  }

  private sync(v: MView, s: MonsterState, px: number, pz: number): void {
    const wasDead = v.mode === "dead";
    v.tx = s.x; v.tz = s.z; v.since = s.since; v.hp = s.hp; v.maxHp = s.maxHp; v.level = s.level;
    if (!v.shown) {
      // first sight (or from the pool)
      v.mode = s.mode;
      v.hitAt = s.hitAt;
      v.x = s.x; v.z = s.z;
      v.shown = s.mode !== "dead";
      v.look.group.visible = v.shown;
      v.shadow.visible = v.shown;
      v.drop = 0;
      if (v.shown) { v.head = s.yaw; this.place(v); }
      return;
    }
    if (s.hitAt !== v.hitAt) {
      v.hitAt = s.hitAt;
      if (s.mode !== "dead") {
        v.flash = 0.12;
        inkBurst(v.x, v.def.height * 0.5, v.z, 7, 0, 0);
      }
    }
    if (s.mode === "dead" && !wasDead && isObstacle(v.def)) {
      // burns away: embers up, ash down
      sparkBurst(v.x, 0.6, v.z, 36, FIRE, 1.1, 1.6);
      sparkBurst(v.x, 1.2, v.z, 16, EMBER, 0.6, 2.2);
      inkBurst(v.x, 0.8, v.z, 18, 0, 0, 0.9);
      addDecal(v.x, v.z, 0.9);
      v.look.group.visible = false;
      v.shadow.visible = false;
    } else if (s.mode === "dead" && !wasDead) {
      const h = v.def.height * 0.5;
      inkBurst(v.x, h, v.z, v.def.boss ? 60 : 24, 0, 0, v.def.boss ? 2 : 1.2);
      for (let k = 0; k < (v.def.boss ? 5 : 2); k++) addDecal(v.x + (Math.random() - 0.5) * 2 * v.def.radius * 2, v.z + (Math.random() - 0.5) * 2 * v.def.radius * 2, 0.2 + Math.random() * 0.35);
      if (Math.hypot(v.x - px, v.z - pz) < 9) {
        screenSplash(v.x, h, v.z, v.def.boss ? 0.14 : 0.06);
        feel.hitstop = Math.max(feel.hitstop, 0.06);
        feel.shake = Math.max(feel.shake, v.def.boss ? 0.8 : 0.25);
      }
      v.look.group.visible = false;
      v.shadow.visible = false;
    } else if (s.mode !== "dead" && wasDead) {
      v.x = s.x; v.z = s.z;
      if (isObstacle(v.def)) { v.grow = 0.05; v.drop = 0; } else v.drop = 7;
      v.look.group.visible = true;
      v.shadow.visible = true;
    }
    v.mode = s.mode;
  }

  private freeShot(): THREE.Mesh | null {
    for (const m of shots) if (!m.visible) { m.visible = true; return m; }
    return null;
  }
  private freeTele(x: number, z: number, r: number): Tele | null {
    for (const t of teles) {
      if (t.mesh.visible) continue;
      t.mesh.visible = true;
      t.mesh.position.set(x, 0.06, z);
      t.mesh.scale.set(r * 2, 1, r * 2);
      t.mat.uniforms.uProg.value = 0;
      t.mat.uniforms.uFade.value = 1;
      return t;
    }
    return null;
  }

  update(dt: number, time: number, px: number, pz: number): void {
    const now = this.serverNow();
    for (const v of this.views.values()) {
      if (v.mode === "dead" || !v.look.group.visible) continue;
      const ox = v.x, oz = v.z;
      if (Math.abs(v.tx - v.x) > 8 || Math.abs(v.tz - v.z) > 8) { v.x = v.tx; v.z = v.tz; }
      const k = 1 - Math.exp(-dt * 9);
      v.x += (v.tx - v.x) * k;
      v.z += (v.tz - v.z) * k;
      const dx = v.x - ox, dz = v.z - oz;
      const sp = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      v.speed += (sp - v.speed) * 0.2;
      let want = v.head;
      if (v.speed > 0.6) want = Math.atan2(-dz, dx);
      else {
        let best = 1e9;
        for (const t of this.targets) {
          const d = Math.hypot(t.x - v.x, t.z - v.z);
          if (d < best && d < v.def.aggro + 4) { best = d; want = Math.atan2(-(t.z - v.z), t.x - v.x); }
        }
      }
      v.head += angDiff(v.head, want) * Math.min(1, dt * 8);
      if (v.drop > 0) {
        v.drop = Math.max(0, v.drop - dt * 14);
        if (v.drop === 0) { inkBurst(v.x, 0.2, v.z, 10, 0, 0, 0.8); addDecal(v.x, v.z, 0.5 * v.def.radius); }
      }
      v.flash = Math.max(0, v.flash - dt);
      const on = v.flash > 0;
      if (on !== v.flashOn) {
        v.flashOn = on;
        for (const m of v.look.flash) m.material = on ? M_flash : M_enemy;
      }
      this.animate(v, time, now);
      // melee wind-up: a red ring that fills until the blow lands
      if (v.mode === "wind" && v.def.attack === "melee") {
        const r = v.def.range + v.def.radius * 0.5;
        if (!v.windTele) v.windTele = this.freeTele(v.x, v.z, r);
        if (v.windTele) {
          v.windTele.mesh.position.set(v.x, 0.06, v.z);
          v.windTele.mat.uniforms.uProg.value = clamp((now - v.since) / Math.max(1, v.def.windMs), 0, 1);
          v.windTele.mat.uniforms.uFade.value = 1;
        }
      } else if (v.windTele) { v.windTele.mesh.visible = false; v.windTele = null; }
      this.place(v);
    }
    // server effects
    for (const f of this.fx.values()) {
      if (f.done) continue;
      const e = f.e;
      const span = Math.max(120, e.at - f.t0);
      const u = clamp((now - f.t0) / span, 0, 1);
      if (f.shot) {
        const x = e.x + (e.tx - e.x) * u, z = e.z + (e.tz - e.z) * u, y = 0.7 + Math.sin(u * Math.PI) * 2.2 * (1 - u * 0.3);
        f.shot.position.set(x, y, z);
        if (Math.random() < 0.5) inkDrop(x, y, z, (Math.random() - 0.5) * 1.5, 0.5, (Math.random() - 0.5) * 1.5, 0.04 + Math.random() * 0.05, 0.5);
      }
      if (f.tele) {
        f.tele.mat.uniforms.uProg.value = u;
        f.tele.mat.uniforms.uFade.value = 0.5 + 0.5 * Math.min(1, u * 4);
      }
      if (f.mark) {
        f.mark.mat.uniforms.uProg.value = u;
        f.mark.mat.uniforms.uFade.value = 0.6 + 0.4 * u;
      }
      if (u >= 1) {
        f.done = true;
        if (f.mark) { f.mark.mesh.visible = false; f.mark = null; }
        if (f.shot) {
          f.shot.visible = false;
          f.shot = null;
          inkBurst(e.tx, 0.3, e.tz, 14, 0, 0, 0.9);
          addDecal(e.tx, e.tz, 0.5);
          ring(e.tx, e.tz, Math.max(0.8, e.r), INK, 0.45, 1, SPLAT_EDGE);
        }
        if (f.tele) {
          f.tele.mesh.visible = false;
          f.tele = null;
          this.onSound?.("monster-slam", e.tx, e.tz);
          ring(e.tx, e.tz, e.r, INK, 0.6, 0, SPLAT_EDGE);
          inkBurst(e.tx, 0.3, e.tz, 30, 0, 0, 1.5);
          for (let k = 0; k < 3; k++) addDecal(e.tx + (Math.random() - 0.5) * e.r * 1.4, e.tz + (Math.random() - 0.5) * e.r * 1.4, 0.3 + Math.random() * 0.4);
          const d = Math.hypot(px - e.tx, pz - e.tz);
          if (d < e.r + 6) feel.shake = Math.max(feel.shake, d < e.r ? 0.7 : 0.35);
        }
      }
    }
  }

  private animate(v: MView, time: number, now: number): void {
    const L = v.look, def = v.def;
    const windU = def.windMs > 0 ? clamp((now - v.since) / def.windMs, 0, 1) : 0;
    const atkU = clamp((now - v.since) / 350, 0, 1);
    const moving = v.speed > 0.6;
    let y = 0, sx = 1, sy = 1;
    if (v.kind === "shade") {
      y = 0.12 + Math.sin(time * 3 + v.phase) * 0.07;
      let a = 0.25 + Math.sin(time * 4 + v.phase) * 0.1, lean = moving ? 0.25 : 0;
      if (v.mode === "wind") { a = 0.3 + windU * 2.4; lean = -0.25 * windU; }
      if (v.mode === "attack") { a = 2.7 - atkU * 2.0; lean = 0.45 * (1 - atkU); }
      if (L.armL && L.armR) { L.armL.rotation.z = a; L.armR.rotation.z = a * 0.85; }
      L.body.rotation.z = -lean;
    } else if (v.kind === "spitter") {
      sy = 1 + Math.sin(time * 5 + v.phase) * 0.03;
      let sac = 1;
      if (v.mode === "wind") sac = 1 + windU * 1.4;
      if (v.mode === "attack") { sac = 2.4 - atkU * 1.4; sx = 1 + (1 - atkU) * 0.1; }
      if (moving) y = Math.abs(Math.sin(time * 7 + v.phase)) * 0.25;
      if (L.sac) L.sac.scale.set(0.22 * sac, 0.2 * sac, 0.26 * sac);
    } else if (v.kind === "vine") {
      L.body.rotation.z = Math.sin(time * 1.3 + v.phase) * 0.04;
      if (v.grow < 1) v.grow = Math.min(1, v.grow + 0.016 * 1.2);
      sx = v.grow;
      sy = v.grow;
    } else if (v.kind === "shadelord") {
      y = 0.12 + Math.sin(time * 3 + v.phase) * 0.07;
      let a = 0.25 + Math.sin(time * 4 + v.phase) * 0.1, lean = moving ? 0.25 : 0;
      if (v.mode === "wind") { a = 0.3 + windU * 2.4; lean = -0.25 * windU; }
      if (v.mode === "attack") { a = 2.7 - atkU * 2.0; lean = 0.45 * (1 - atkU); }
      if (L.armL && L.armR) { L.armL.rotation.z = a; L.armR.rotation.z = a * 0.85; }
      L.body.rotation.z = -lean;
    } else if (v.kind === "bigblob") {
      // swells while gathering itself for the slam, then flattens
      const q = Math.sin(time * 4 + v.phase) * 0.03;
      sx = 1 - q; sy = 1 + q;
      if (v.mode === "wind") { const k = 1 + windU * 0.45 + Math.sin(time * 30) * 0.02 * windU; sx = k; sy = k * (1 + windU * 0.1); }
      if (v.mode === "attack") { sx = 1.35 - atkU * 0.35; sy = 0.6 + atkU * 0.4; }
      if (moving && v.mode === "chase") { const h = Math.abs(Math.sin(time * 5 + v.phase)); y = h * 0.4; }
    } else if (v.kind === "boss") {
      sy = 1 + Math.sin(time * 2 + v.phase) * 0.02;
      let a = 0.15 + Math.sin(time * 2.4) * 0.08;
      if (moving) a = 0.15 + Math.sin(time * 6) * 0.4;
      if (v.mode === "wind") a = 0.2 + windU * 2.85;
      if (v.mode === "attack") a = 3.05 - atkU * 3.2;
      if (L.armL && L.armR) { L.armL.rotation.z = a; L.armR.rotation.z = a; }
      L.body.rotation.z = v.mode === "wind" ? -0.18 * windU : v.mode === "attack" ? 0.25 * (1 - atkU) : 0;
    } else {
      // blob: hop while chasing, squash at rest
      if (moving) {
        const h = Math.abs(Math.sin(time * 7 + v.phase));
        y = h * 0.55;
        sy = 1 + (h - 0.5) * 0.25;
        sx = 1 - (h - 0.5) * 0.15;
      } else {
        const q = Math.sin(time * 6 + v.phase) * 0.04;
        sy = 1 + q;
        sx = 1 - q * 0.6;
      }
      if (v.mode === "attack") { sx *= 1 + (1 - atkU) * 0.25; sy *= 1 - (1 - atkU) * 0.2; }
    }
    if (v.flash > 0) { sx *= 1.12; sy *= 1.12; }
    v.y = y + v.drop;
    L.group.scale.set(sx, sy, sx);
  }

  private place(v: MView): void {
    v.look.group.position.set(v.x, v.y, v.z);
    v.look.group.rotation.set(0, v.head, 0);
    v.shadow.position.set(v.x, 0.04, v.z);
    v.shadow.scale.setScalar(v.def.radius * 1.1 * (1 - Math.min(0.6, v.y * 0.06)));
  }

  /** Auto-aim: best living monster near (x, z), biased toward the stick direction. */
  aim(x: number, z: number, hasIn: boolean, ih: number): number | null {
    let best: MView | null = null, bs = 1e9;
    for (const e of this.views.values()) {
      if (e.mode === "dead" || !e.look.group.visible || e.drop > 0) continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz) - e.def.radius;
      if (d > 7.5) continue;
      let score = d;
      if (hasIn) {
        const a = Math.abs(angDiff(ih, Math.atan2(-dz, dx)));
        if (a > 1.1) continue;
        score += a * 2;
      }
      if (score < bs) { bs = score; best = e; }
    }
    return best ? Math.atan2(-(best.z - z), best.x - x) : null;
  }

  boss(px: number, pz: number): MView | null {
    for (const v of this.views.values()) {
      if (v.def.boss && v.mode !== "dead" && Math.hypot(v.x - px, v.z - pz) < 34) return v;
    }
    return null;
  }

  /** Zone change: hide everything (views go back to the pools). */
  clear(): void {
    for (const v of this.views.values()) this.release(v);
    this.views.clear();
    for (const f of this.fx.values()) {
      if (f.shot) f.shot.visible = false;
      if (f.tele) f.tele.mesh.visible = false;
      if (f.mark) f.mark.mesh.visible = false;
    }
    this.fx.clear();
    // the vines of the zone just left must not keep blocking (two of them sit right on the village's
    // bamboo portal once you are back in the village, which has no monster updates to refresh this)
    this.obstacles.length = 0;
    this.elites.length = 0;
    this.hasClock = false;
  }
}
