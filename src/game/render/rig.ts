// 먹동이 rig (from proto/characters.html): ~5 heads tall, round head r .24, connected joints, sloped
// collarbones, splayed limbs, sash belt with knot, calligraphy brush with bristles that flex with swings.
// pose = [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR, weapon, rootY]
// The rig is drawn in its local x/y plane facing +x; group.rotation.y turns it toward its heading.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ItemDef } from "../../shared/items";
import { clamp } from "../util";
import { G, M_ink, dyeMat, lam } from "./materials";

export const LEN = { thigh: 0.5, shin: 0.5, torso: 0.72, neck: 0.1, head: 0.24, ua: 0.38, fa: 0.36 };
const LIMB = 1.15;

const HGEO = {
  satgat: new THREE.ConeGeometry(0.42, 0.24, 18),
  gat: mergeGeometries([
    new THREE.CylinderGeometry(0.42, 0.42, 0.025, 22),
    new THREE.CylinderGeometry(0.15, 0.18, 0.3, 14).translate(0, 0.16, 0),
  ]),
  mask: new THREE.SphereGeometry(1, 12, 10).scale(0.07, 0.28, 0.23),
};
const M_hat = lam(0x6b6255);
const M_gat = lam(0x1f1d1b);
const M_robeInk = new THREE.MeshLambertMaterial({ color: 0x3d3a36, side: THREE.DoubleSide });
const M_hemp = new THREE.MeshLambertMaterial({ color: 0x9a8e72, side: THREE.DoubleSide });
const M_mask = lam(0xe2d3b4);
const G_belt = new THREE.TorusGeometry(0.15, 0.045, 8, 22).rotateX(Math.PI / 2);
const G_knot = new THREE.SphereGeometry(0.06, 10, 8);

// Calligraphy brush: bamboo shaft + nodes, loop, ferrule, bristles (pale root, inked point)
const M_shaft = lam(0xa88f5c), M_node = lam(0x6e5a36), M_ferrule = lam(0x2a2421);
const M_bristle = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
function bristleGeometry(): THREE.BufferGeometry {
  const prof = [[0, 0], [0.075, 0], [0.095, 0.06], [0.105, 0.14], [0.098, 0.24], [0.08, 0.34], [0.055, 0.44], [0.028, 0.53], [0.008, 0.6], [0, 0.63]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const root = new THREE.Color(0xe8dcc0), tip = new THREE.Color(0x121110), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(root).lerp(tip, THREE.MathUtils.smoothstep(p.getY(i) / 0.63, 0.18, 0.5));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const G_bristle = bristleGeometry();
const G_shaft = new THREE.CylinderGeometry(0.034, 0.042, 1.15, 10).translate(0, 0.475, 0);
const G_node = new THREE.CylinderGeometry(0.047, 0.047, 0.035, 10);
const G_ferrule = new THREE.CylinderGeometry(0.078, 0.06, 0.13, 12).translate(0, 1.115, 0);
const G_loop = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
const G_tassel = new THREE.ConeGeometry(0.05, 0.26, 8).rotateX(Math.PI);
/** one-piece silhouette for afterimages */
const G_brushGhost = mergeGeometries([G_shaft.clone(), G_ferrule.clone(), new THREE.ConeGeometry(0.1, 0.63, 10).translate(0, 1.5, 0)]);
export const BRUSH_LEN = 1.81;
const GOLD = 0xd9a640;

/** Brush groups only reference shared geometries and cached materials: nothing to dispose. */
function buildBrush(it: Partial<ItemDef>): { group: THREE.Group; bristle: THREE.Mesh } {
  const g = new THREE.Group();
  const shaftMat = it.shaftTint ? dyeMat(it.shaftTint) : it.shaft ? lam(it.shaft) : M_shaft;
  g.add(new THREE.Mesh(G_shaft, shaftMat));
  const nodeMat = it.gold ? dyeMat(GOLD) : M_node;
  for (const y of [0.22, 0.58, 0.9]) {
    const n = new THREE.Mesh(G_node, nodeMat);
    n.position.y = y;
    g.add(n);
  }
  g.add(new THREE.Mesh(G_ferrule, it.gold ? dyeMat(GOLD) : M_ferrule));
  const loop = new THREE.Mesh(G_loop, M_ferrule);
  loop.position.y = -0.16;
  g.add(loop);
  if (it.tassel) {
    const t = new THREE.Mesh(G_tassel, dyeMat(it.tassel));
    t.position.y = -0.33;
    g.add(t);
  }
  const bristle = new THREE.Mesh(G_bristle, M_bristle);
  bristle.position.y = 1.18;
  g.add(bristle);
  if (it.heavy) g.scale.set(1.25, 1, 1.25);
  return { group: g, bristle };
}

const _sd = new THREE.Vector3(), _sup = new THREE.Vector3(0, 1, 0);
/** segment between two 3D points (cylinder along +y, oriented with a quaternion) */
function seg3(m: THREE.Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
  _sd.set(bx - ax, by - ay, bz - az);
  const len = _sd.length() || 1e-4;
  m.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  m.scale.set(r, len, r);
  m.quaternion.setFromUnitVectors(_sup, _sd.divideScalar(len));
}
function seg(m: THREE.Object3D, ax: number, ay: number, bx: number, by: number, r: number, z: number): void {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-4;
  m.position.set((ax + bx) * 0.5, (ay + by) * 0.5, z);
  m.scale.set(r, len, r);
  m.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
}

export class Rig {
  readonly group = new THREE.Group();
  readonly inner = new THREE.Group();
  private readonly segs: THREE.Mesh[] = [];
  private readonly head: THREE.Mesh;
  private readonly joints: THREE.Mesh[] = [];
  private readonly clavL: THREE.Mesh;
  private readonly clavR: THREE.Mesh;
  private readonly hipBar: THREE.Mesh;
  private weapon: THREE.Object3D;
  private bristle: THREE.Mesh | null = null;
  private readonly hat: THREE.Mesh | null = null;
  private readonly mask: THREE.Mesh | null = null;
  private readonly belt: THREE.Group | null = null;
  private readonly beltRing: THREE.Mesh | null = null;
  private readonly knot: THREE.Mesh | null = null;
  private readonly meshes: THREE.Object3D[];
  readonly pose = new Float32Array(12);
  spin = 0;
  private flex = 0;
  private prevA: number | null = null;
  readonly hand = new THREE.Vector2();
  readonly dir = new THREE.Vector2();
  readonly neck = new THREE.Vector2();
  readonly waistBack = new THREE.Vector2();
  handZ = 0.37;
  readonly weaponLen = BRUSH_LEN;
  /** extra props (headband, things on the back) placed every apply() */
  private readonly props: { obj: THREE.Object3D; at: "head" | "back" }[] = [];

  constructor(bodyMat: THREE.Material = M_ink, ghost = false) {
    this.group.add(this.inner);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(G.seg, bodyMat);
      this.inner.add(m);
      this.segs.push(m);
    }
    this.head = new THREE.Mesh(G.head, bodyMat);
    this.head.scale.setScalar(LEN.head);
    this.inner.add(this.head);
    for (let i = 0; i < 13; i++) {
      const j = new THREE.Mesh(G.head, bodyMat);
      this.inner.add(j);
      this.joints.push(j);
    }
    this.clavL = new THREE.Mesh(G.seg, bodyMat);
    this.clavR = new THREE.Mesh(G.seg, bodyMat);
    this.hipBar = new THREE.Mesh(G.seg, bodyMat);
    this.inner.add(this.clavL, this.clavR, this.hipBar);
    if (ghost) this.weapon = new THREE.Mesh(G_brushGhost, bodyMat);
    else {
      const b = buildBrush({});
      this.weapon = b.group;
      this.bristle = b.bristle;
    }
    this.inner.add(this.weapon);
    this.meshes = [...this.segs, this.head, ...this.joints, this.clavL, this.clavR, this.hipBar, this.weapon];
    if (!ghost) {
      this.hat = new THREE.Mesh(HGEO.satgat, M_hat);
      this.hat.visible = false;
      this.inner.add(this.hat);
      this.mask = new THREE.Mesh(HGEO.mask, M_mask);
      this.mask.visible = false;
      this.inner.add(this.mask);
      this.belt = new THREE.Group();
      this.beltRing = new THREE.Mesh(G_belt, M_robeInk);
      this.beltRing.scale.set(1.15, 1, 1);
      this.knot = new THREE.Mesh(G_knot, M_robeInk);
      this.knot.position.set(-0.17, 0, 0);
      this.belt.add(this.beltRing, this.knot);
      this.inner.add(this.belt);
    }
  }

  setWeapon(it: ItemDef | undefined): void {
    this.inner.remove(this.weapon);
    const b = buildBrush(it ?? {});
    this.weapon = b.group;
    this.bristle = b.bristle;
    this.inner.add(this.weapon);
    this.meshes[this.meshes.length - 1] = this.weapon;
  }

  setHat(it: ItemDef | undefined): void {
    if (!this.hat || !this.mask) return;
    const shape = it?.shape ?? null;
    this.hat.visible = shape === "satgat" || shape === "gat";
    this.mask.visible = shape === "mask";
    if (shape === "satgat" || shape === "gat") {
      this.hat.geometry = HGEO[shape];
      this.hat.material = it?.tint ? dyeMat(it.tint) : shape === "gat" ? M_gat : M_hat;
    }
  }

  /** hex = dye or item tint; hemp = undyed hemp sash. */
  setSash(hex: number | null, hemp = false): void {
    if (!this.beltRing || !this.knot) return;
    const m = hex != null ? dyeMat(hex) : hemp ? M_hemp : M_robeInk;
    this.beltRing.material = m;
    this.knot.material = m;
  }

  /** Replace the brush with another held object (an oar); it must reference shared geometry/materials. */
  setHeld(obj: THREE.Object3D): void {
    this.inner.remove(this.weapon);
    this.weapon = obj;
    this.bristle = null;
    this.inner.add(obj);
    this.meshes[this.meshes.length - 1] = obj;
  }

  /** Attach a prop that follows the head or sits across the back. */
  addProp(obj: THREE.Object3D, at: "head" | "back"): void {
    this.inner.add(obj);
    this.props.push({ obj, at });
  }

  /** Draw the far half of the body (arm, leg, shoulder, hip joints) with another material. */
  shadeSide(mat: THREE.Material): void {
    for (const i of [4, 5, 8, 9]) this.segs[i].material = mat;
    for (let j = 6; j < 12; j++) this.joints[j].material = mat;
    this.clavR.material = mat;
  }

  place(x: number, y: number, z: number, head: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, head, 0);
  }

  apply(): void {
    const p = this.pose, w = LIMB;
    this.inner.position.y = LEN.thigh + LEN.shin + p[11];
    this.inner.rotation.z = this.spin;
    const tx = Math.sin(p[0]) * LEN.torso, ty = Math.cos(p[0]) * LEN.torso;
    const ha = p[0] + p[1];
    const nx = tx + Math.sin(ha) * LEN.neck, ny = ty + Math.cos(ha) * LEN.neck;
    this.neck.set(nx, ny);
    seg(this.segs[0], 0, 0, tx, ty, 0.08 * w, 0);
    seg(this.segs[1], tx, ty, nx, ny, 0.07 * w, 0);
    const hx = tx + Math.sin(ha) * (LEN.neck + LEN.head), hy = ty + Math.cos(ha) * (LEN.neck + LEN.head);
    this.head.position.set(hx, hy, 0);
    seg3(this.hipBar, 0, 0, -0.1, 0, 0, 0.1, 0.085 * w);
    const wx = Math.sin(p[0]) * 0.14, wy = Math.cos(p[0]) * 0.14;
    this.waistBack.set(wx - Math.cos(p[0]) * 0.19, wy + Math.sin(p[0]) * 0.19);
    if (this.hat && this.mask && this.belt) {
      this.hat.position.set(hx + Math.sin(ha) * 0.19, hy + Math.cos(ha) * 0.19, 0);
      this.hat.rotation.set(0, 0, -ha);
      this.mask.position.set(hx + Math.cos(ha) * 0.2, hy - Math.sin(ha) * 0.2, 0);
      this.mask.rotation.set(0, 0, -ha);
      this.belt.position.set(wx, wy, 0);
      this.belt.rotation.set(0, 0, -p[0]);
    }
    const J = this.joints;
    const jt = (i: number, x: number, y: number, z: number, r: number) => {
      J[i].position.set(x, y, z);
      J[i].scale.setScalar(r);
    };
    jt(12, tx, ty, 0, 0.088 * w);
    const sdx = -Math.sin(p[0]) * 0.07, sdy = -Math.cos(p[0]) * 0.07;
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1, zs = 0.18 * sgn;
      const sx0 = tx + sdx, sy0 = ty + sdy;
      seg3(side ? this.clavR : this.clavL, tx, ty, 0, sx0, sy0, zs, 0.066 * w);
      const sh = p[2 + side * 2], el = p[3 + side * 2];
      const ex = sx0 + Math.sin(sh) * LEN.ua, ey = sy0 - Math.cos(sh) * LEN.ua, ez = zs * 1.6;
      const fa = sh + el;
      const hx2 = ex + Math.sin(fa) * LEN.fa, hy2 = ey - Math.cos(fa) * LEN.fa, hz = zs * 2.05;
      seg3(this.segs[2 + side * 2], sx0, sy0, zs, ex, ey, ez, 0.066 * w);
      seg3(this.segs[3 + side * 2], ex, ey, ez, hx2, hy2, hz, 0.062 * w);
      jt(side * 6, sx0, sy0, zs, 0.072 * w);
      jt(side * 6 + 1, ex, ey, ez, 0.066 * w);
      jt(side * 6 + 2, hx2, hy2, hz, 0.068 * w);
      if (side === 1) {
        const sa = fa + p[10];
        this.hand.set(hx2, hy2);
        this.handZ = hz;
        this.dir.set(Math.sin(sa), -Math.cos(sa));
      }
    }
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1, z0 = 0.1 * sgn, z1 = 0.15 * sgn, z2 = 0.2 * sgn;
      const hip = p[6 + side * 2], kn = p[7 + side * 2];
      const kx = Math.sin(hip) * LEN.thigh, ky = -Math.cos(hip) * LEN.thigh, a = hip + kn;
      const fx = kx + Math.sin(a) * LEN.shin, fy = ky - Math.cos(a) * LEN.shin;
      seg3(this.segs[6 + side * 2], 0, 0, z0, kx, ky, z1, 0.08 * w);
      seg3(this.segs[7 + side * 2], kx, ky, z1, fx, fy, z2, 0.075 * w);
      jt(side * 6 + 3, 0, 0, z0, 0.085 * w);
      jt(side * 6 + 4, kx, ky, z1, 0.079 * w);
      jt(side * 6 + 5, fx, fy, z2, 0.076 * w);
    }
    const sx = this.hand.x, sy = this.hand.y, dx = this.dir.x, dy = this.dir.y;
    this.weapon.position.set(sx - dx * 0.1, sy - dy * 0.1, this.handZ + 0.03);
    this.weapon.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
    for (const pr of this.props) {
      if (pr.at === "head") {
        pr.obj.position.copy(this.head.position);
        pr.obj.rotation.set(0, 0, -ha);
      } else {
        pr.obj.position.set(tx * 0.55 - Math.cos(p[0]) * 0.13, ty * 0.55 + Math.sin(p[0]) * 0.13, 0);
        pr.obj.rotation.set(0, 0, -p[0] + 0.75);
      }
    }
    if (this.bristle) {
      // bristles lag behind the swing and spring back
      const ang = Math.atan2(dy, dx) + this.group.rotation.y;
      if (this.prevA !== null) {
        let d = ang - this.prevA;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.flex += (clamp(-d * 9, -0.75, 0.75) - this.flex) * 0.3;
      }
      this.prevA = ang;
      this.bristle.rotation.z = this.flex;
    }
  }

  /** Copy the posed transforms (for afterimages). */
  copyFrom(src: Rig): void {
    this.group.position.copy(src.group.position);
    this.group.rotation.copy(src.group.rotation);
    this.inner.position.copy(src.inner.position);
    this.inner.rotation.copy(src.inner.rotation);
    for (let i = 0; i < this.meshes.length; i++) {
      const a = this.meshes[i], b = src.meshes[i];
      a.position.copy(b.position);
      a.scale.copy(b.scale);
      a.quaternion.copy(b.quaternion);
    }
  }
}

/* ---------- poses ---------- */
const P = (...a: number[]) => Float32Array.from(a);
export const POSE = {
  idle: P(0.06, 0, -0.35, 0.5, 0.45, 0.9, 0.2, -0.3, -0.15, -0.15, 3.7, -0.06),
  airUp: P(0.15, 0.1, -1.3, 0.4, 1.0, 0.6, 0.9, -1.5, 0.3, -1.0, 2.6, 0),
  airDown: P(0.05, 0, -1.6, 0.2, -1.4, 0.3, 0.5, -0.6, -0.1, -0.3, 0.2, 0),
  spin: P(0.1, 0, -1.57, 0, 1.57, 0, 0.6, -0.9, -0.4, -0.6, 0, -0.05),
  plunge: P(0, -0.2, 2.9, 0.2, 2.9, 0.1, 0.6, -1.4, 0.2, -1.2, 3.0, 0),
  land: P(0.6, -0.2, 0.8, 0.3, 0.9, 0.2, 1.2, -2.0, -0.6, -0.8, -0.8, -0.45),
  dash: P(0.75, -0.2, -1.6, 0.2, -1.5, 0.1, 1.0, -1.4, -0.9, -0.4, 0.1, -0.2),
  cast: P(0.35, -0.1, -1.1, 0.3, 1.55, 0, 0.9, -0.8, -0.8, -0.2, 2.3, -0.3),
  hurt: P(-0.5, -0.3, -2.2, 0.5, 1.9, 0.5, 0.4, -0.6, -0.3, -0.4, 1.0, -0.1),
  dead: P(0, 0, -1.0, 0, 1.0, 0, 0.3, -0.2, -0.2, -0.1, 1.0, -0.8),
  elder: P(0.45, 0.2, -0.2, 0.3, 0.9, 1.2, 0.15, -0.2, -0.1, -0.15, 2.4, -0.1),
  bow: P(0.2, 0.15, -0.5, 1.5, 0.4, 1.6, 0.1, -0.1, -0.1, -0.1, 3.4, -0.04),
};
type Key = [number, Float32Array];
export const KEYS: Record<"atk1" | "atk2", Key[]> = {
  atk1: [
    [0, P(-0.15, 0, -0.6, 0.6, -2.5, 0.3, 0.55, -0.5, -0.5, -0.2, 0.3, -0.15)],
    [0.3, P(0.4, -0.1, -1.4, 0.3, 1.65, 0, 0.8, -0.6, -0.6, -0.1, 0, -0.28)],
    [1, P(0.3, 0, -1.2, 0.4, 2.3, 0.1, 0.75, -0.6, -0.6, -0.1, 0.2, -0.22)],
  ],
  atk2: [
    [0, P(0.45, 0, -1.2, 0.5, 0.2, 0, 0.6, -1.0, -0.4, -0.3, 0.7, -0.35)],
    [0.35, P(-0.15, 0.1, -1.5, 0.4, 3.0, 0.1, 0.3, -0.2, -0.2, -0.6, 0, 0.05)],
    [1, P(-0.1, 0.1, -1.4, 0.4, 3.2, 0.2, 0.3, -0.3, -0.2, -0.5, 0.1, 0)],
  ],
};
export function sampleKeys(out: Float32Array, keys: Key[], t: number): void {
  if (t <= keys[0][0]) { out.set(keys[0][1]); return; }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      let u = (t - a[0]) / (b[0] - a[0]);
      u = 1 - Math.pow(1 - u, 3);
      for (let k = 0; k < 12; k++) out[k] = a[1][k] + (b[1][k] - a[1][k]) * u;
      return;
    }
  }
  out.set(keys[keys.length - 1][1]);
}
export function blend(cur: Float32Array, target: Float32Array, k: number): void {
  for (let i = 0; i < 12; i++) cur[i] += (target[i] - cur[i]) * k;
}
export function runPose(out: Float32Array, ph: number): void {
  const s = Math.sin(ph), c = Math.cos(ph);
  out[0] = 0.32; out[1] = -0.1; out[2] = -0.9 * s + 0.1; out[3] = 0.9; out[4] = -1.1 + 0.25 * s; out[5] = 0.35;
  out[6] = 0.25 + 0.85 * s; out[7] = -0.25 - (0.5 + 0.5 * c); out[8] = 0.25 - 0.85 * s; out[9] = -0.25 - (0.5 - 0.5 * c);
  out[10] = -0.35; out[11] = -0.08 - 0.06 * Math.abs(c);
}
