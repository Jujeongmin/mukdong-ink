// 먹동이 rig (from proto/characters.html): ~5 heads tall, round head r .24, connected joints, sloped
// collarbones, splayed limbs, sash belt with knot, calligraphy brush with bristles that flex with swings.
// Drawn as brush strokes: every limb is a tapered, slightly flat stroke (thick where it starts), joints are
// sized to the strokes they join so no balls show, and the shared M_body shader paints ink density and a
// dry-brush edge. A dyed collar wraps the neck under the scarf tails (actor.ts).
// pose = [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR, weapon, rootY]
// The rig is drawn in its local x/y plane facing +x; group.rotation.y turns it toward its heading.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ItemDef } from "../../shared/items";
import { clamp } from "../util";
import { M_body, dyeMat, lam } from "./materials";
import type { MotionClip } from "./motion/sword";

export const LEN = { thigh: 0.5, shin: 0.5, torso: 0.72, neck: 0.1, head: 0.24, ua: 0.38, fa: 0.36 };
const LIMB = 1.16;
/** every figure is drawn this much larger than its gameplay footprint, to read from the quarter camera */
export const FIGURE_SCALE = 1.12;

/**
 * A brush stroke (SHARED): swelling just after it starts, thinning toward its end, a little flattened.
 * Unit length along +y from -0.5 to 0.5, radius ~1 (seg3 scales it).
 */
function strokeGeometry(): THREE.BufferGeometry {
  const prof = [[0, -0.5], [0.7, -0.49], [0.95, -0.42], [1.0, -0.3], [0.88, -0.05], [0.72, 0.2], [0.58, 0.4], [0.44, 0.488], [0, 0.5]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 12);
  g.scale(1, 1, 0.82);
  g.computeVertexNormals();
  return g;
}
const G_stroke = strokeGeometry();
const G_dab = new THREE.SphereGeometry(1, 14, 10);
/** the scarf's soft wrap round the neck: an open band, wider at the bottom (SHARED) */
const G_collar = collarGeometry();
/** a loop of soft cloth round the neck with a small knot at the back; folds are shaded in its vertex colors */
function collarGeometry(): THREE.BufferGeometry {
  const loop = new THREE.TorusGeometry(0.118, 0.04, 8, 24).rotateX(Math.PI / 2).scale(1, 1.7, 1);
  const knot = new THREE.SphereGeometry(0.055, 8, 6).scale(1, 0.8, 1.2).translate(-0.13, -0.02, 0);
  const g = mergeGeometries([loop, knot])!;
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i)), f = 0.8 + 0.2 * Math.sin(a * 5 + p.getY(i) * 30);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/*
 * Holding the brush (IK stance). Out of combat it rests on the right shoulder, gripped a third of the way
 * up; ready for a fight it is held low in both hands, the bristle forward and down near the ground.
 * grip/left are offsets from the right/left shoulder in the figure's frame (x forward, y up, z right);
 * d is the shaft's direction from the grip toward the bristle; poles hint where the elbows point.
 */
// The shaft RESTS ON TOP of the right shoulder: the grip sits 0.3 along the shaft in front of/below the
// shoulder-top contact point (0, +0.1, -0.02), so the line clears the shoulder and neck. d leans a little across
// the back (z < 0) so from behind the bristle sits behind the head instead of standing upright like a torch.
const CARRY = { grip: [0.24, -0.07, 0.04], d: [-0.79, 0.58, -0.21], left: [0.08, -0.6, -0.06], poleR: [0.2, -1, 0.6], poleL: [-0.6, -0.1, -0.5] };
const GUARD = { grip: [0.32, -0.5, 0.0], d: [0.72, -0.62, -0.12], left: [0, 0, 0], poleR: [0, -0.6, 0.8], poleL: [0, -0.8, -0.6] };
/** in the guard the left hand holds the shaft this far below the right */
const GUARD_LEFT = 0.42;
const IK = new Float32Array(6);
/** Two-bone IK: shoulder s, target t, upper/lower lengths, elbow pole. Writes elbow, hand into IK. */
function solveArm(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, a: number, b: number, pole: number[]): void {
  let dx = tx - sx, dy = ty - sy, dz = tz - sz;
  const d = Math.hypot(dx, dy, dz) || 1e-4;
  const dc = Math.min((a + b) * 0.999, Math.max(Math.abs(a - b) + 1e-3, d));
  dx /= d; dy /= d; dz /= d;
  let px = pole[0], py = pole[1], pz = pole[2];
  const pd = px * dx + py * dy + pz * dz;
  px -= dx * pd; py -= dy * pd; pz -= dz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const ca = (a * a + dc * dc - b * b) / (2 * a * dc), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  IK[0] = sx + (dx * ca + px * sa) * a; IK[1] = sy + (dy * ca + py * sa) * a; IK[2] = sz + (dz * ca + pz * sa) * a;
  IK[3] = sx + dx * dc; IK[4] = sy + dy * dc; IK[5] = sz + dz * dc;
}

/**
 * Body proportions, as multipliers on the standard 먹동이 (all 1 = the player). NPCs use them to read
 * as different people at a glance: height scales the whole figure, the rest reshape it.
 */
export interface Build {
  height?: number;
  head?: number;
  limb?: number;
  legs?: number;
  torso?: number;
  arms?: number;
  /** hat brim width */
  hatW?: number;
}

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
/** the sash: a thin band wrapped at the waist and a flat knot (its tails are ribbons in actor.ts) */
const G_belt = new THREE.CylinderGeometry(0.152, 0.158, 0.075, 24, 1, true);
const G_knot = new THREE.SphereGeometry(0.055, 10, 8).scale(0.7, 1, 1.1);

// Calligraphy brush: bamboo shaft + nodes, loop, ferrule, bristles (pale root, inked point)
const M_shaft = lam(0xb9ad8a), M_node = lam(0x5e4f36), M_ferrule = lam(0x2a2421);
const M_bristle = new THREE.MeshBasicMaterial({
  color: 0xffffff, vertexColors: true, opacity: 0.5, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
});
const BRISTLE_LEN = 0.46;
/**
 * The brush head: a slim teardrop of cream hair (#e9e3d6) with fine darker strands along it, ragged at the
 * edge, soaking into an ink-black point over its last ~40%. Unlit and drawn through the dyed path, so the
 * ink pass keeps it as hair and ink instead of washing it grey.
 */
function bristleGeometry(): THREE.BufferGeometry {
  const prof = [[0, 0], [0.05, 0], [0.084, 0.05], [0.097, 0.11], [0.092, 0.18], [0.075, 0.25], [0.053, 0.32], [0.031, 0.38], [0.013, 0.425], [0, BRISTLE_LEN]];
  const SEG = 36;
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), SEG);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const rnd = (k: number) => { const v = Math.sin(k * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const root = new THREE.Color(0xe9e3d6), ink = new THREE.Color(0x0b0a0a), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), t = y / BRISTLE_LEN;
    const a = Math.atan2(z, x), strand = Math.round(((a + Math.PI) / (Math.PI * 2)) * SEG) % SEG;
    // ragged: each strand sits a little in or out, more so toward the point
    const k = 1 + (rnd(strand) - 0.5) * (0.08 + 0.22 * t);
    p.setX(i, x * k); p.setZ(i, z * k);
    const streak = rnd(strand + 7) < 0.25 ? 0.72 : 0.9 + 0.1 * rnd(strand + 3);
    c.copy(root).multiplyScalar(streak).lerp(ink, THREE.MathUtils.smoothstep(t, 0.42, 0.72));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.computeVertexNormals();
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const G_bristle = bristleGeometry();
const G_shaft = new THREE.CylinderGeometry(0.034, 0.042, 1.15, 10).translate(0, 0.475, 0);
const G_node = new THREE.CylinderGeometry(0.047, 0.047, 0.035, 10);
const G_ferrule = new THREE.CylinderGeometry(0.078, 0.06, 0.13, 12).translate(0, 1.115, 0);
const G_loop = mergeGeometries([
  new THREE.CylinderGeometry(0.046, 0.042, 0.07, 10).translate(0, -0.13, 0),
  new THREE.TorusGeometry(0.04, 0.007, 4, 12, Math.PI * 1.2).rotateZ(Math.PI * 1.4).scale(1, 1.5, 1).translate(0, -0.2, 0),
])!;
const G_tassel = new THREE.ConeGeometry(0.05, 0.26, 8).rotateX(Math.PI);
/** one-piece silhouette for afterimages */
const G_brushGhost = mergeGeometries([G_shaft.clone(), G_ferrule.clone(), new THREE.SphereGeometry(0.12, 10, 8).scale(1, 1.6, 1).translate(0, 1.36, 0)]);
export const BRUSH_LEN = 1.18 + BRISTLE_LEN;

/* Enhancement glow on the bristles, seen by everyone: +5 an ink halo, +10 a colored edge, +15 a gold edge
   (the drifting gold motes are emitted by actor.ts). Back-face shells around the bristle, SHARED. */
const SHELL_DYE: THREE.MeshBasicMaterialParameters = {
  side: THREE.BackSide, opacity: 0.5, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
};
const M_haloInk = new THREE.MeshBasicMaterial({ color: 0x07070c, side: THREE.BackSide, transparent: true, opacity: 0.45, depthWrite: false });
const M_edgeBlue = new THREE.MeshBasicMaterial({ color: 0x58a6ec, ...SHELL_DYE });
const M_edgeGold = new THREE.MeshBasicMaterial({ color: 0xf0c050, ...SHELL_DYE });
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
  g.add(new THREE.Mesh(G_loop, M_ferrule));
  if (it.tassel) {
    const t = new THREE.Mesh(G_tassel, dyeMat(it.tassel));
    t.position.y = -0.33;
    g.add(t);
  }
  const bristle = new THREE.Mesh(G_bristle, M_bristle);
  bristle.position.y = 1.18;
  bristle.scale.set(1.05, 1.0, 1.05);
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
  private readonly collar: THREE.Mesh | null = null;
  private readonly meshes: THREE.Object3D[];
  readonly pose = new Float32Array(12);
  spin = 0;
  /** the whole figure turned about its own vertical axis (mocap body twist; 0 outside attacks) */
  twist = 0;
  /**
   * Mocap arms and blade in 3D (unit directions in the figure's frame: forward, up, right): left upper
   * arm, left forearm, right upper arm, right forearm, blade. `arm3` 0..1 blends them over the planar pose.
   */
  readonly dirs3 = new Float32Array(15);
  arm3 = 0;
  /** the brush's direction in the figure's frame (3D; dir is its x/y part) */
  readonly dir3 = new THREE.Vector3(0, -1, 0);
  /** 0..1: hold the brush by IK (see CARRY/GUARD) over the planar arms */
  stance = 0;
  /** 0 = carried on the shoulder, 1 = low guard in both hands */
  guard = 0;
  /** how far up the held object the hand grips (0.1: near its end, like the NPCs' props) */
  grip = 0.1;
  private readonly ikD = new THREE.Vector3();
  private readonly ikR = new THREE.Vector3();
  private readonly ikL = new THREE.Vector3();
  private flex = 0;
  private prevA: number | null = null;
  readonly hand = new THREE.Vector2();
  readonly dir = new THREE.Vector2();
  readonly neck = new THREE.Vector2();
  readonly waistBack = new THREE.Vector2();
  handZ = 0.37;
  readonly weaponLen = BRUSH_LEN;
  /** the brush tip's distance from the gripping hand */
  get tipLen(): number { return this.weaponLen - this.grip; }
  private glow = 0;
  /** extra props (headband, things on the back) placed every apply() */
  private readonly props: { obj: THREE.Object3D; at: "head" | "back" }[] = [];
  /** this figure's proportions (see Build) */
  private readonly len = { ...LEN };
  private limbW = LIMB;
  private hatW = 1;

  constructor(bodyMat: THREE.Material = M_body, ghost = false) {
    this.group.add(this.inner);
    this.group.scale.setScalar(FIGURE_SCALE);
    for (let i = 0; i < 12; i++) { // 10 body strokes + 2 feet
      const m = new THREE.Mesh(G_stroke, bodyMat);
      this.inner.add(m);
      this.segs.push(m);
    }
    this.head = new THREE.Mesh(G_dab, bodyMat);
    this.head.scale.setScalar(LEN.head);
    this.inner.add(this.head);
    for (let i = 0; i < 13; i++) {
      const j = new THREE.Mesh(G_dab, bodyMat);
      this.inner.add(j);
      this.joints.push(j);
    }
    this.clavL = new THREE.Mesh(G_stroke, bodyMat);
    this.clavR = new THREE.Mesh(G_stroke, bodyMat);
    this.hipBar = new THREE.Mesh(G_stroke, bodyMat);
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
      this.collar = new THREE.Mesh(G_collar, M_robeInk);
      this.inner.add(this.collar);
    }
  }

  /** The scarf's knot round the neck (its tails are ribbons in actor.ts); null hides it. */
  setCollar(mat: THREE.Material | null): void {
    if (!this.collar) return;
    this.collar.visible = !!mat;
    if (mat) this.collar.material = mat;
  }

  setWeapon(it: ItemDef | undefined): void {
    this.inner.remove(this.weapon);
    const b = buildBrush(it ?? {});
    this.weapon = b.group;
    this.bristle = b.bristle;
    this.inner.add(this.weapon);
    this.meshes[this.meshes.length - 1] = this.weapon;
    this.dressBristle();
  }

  /** Brush enhancement level drives the glow shells. */
  setGlow(plus: number): void {
    if (plus === this.glow) return;
    this.glow = plus;
    this.dressBristle();
  }

  private dressBristle(): void {
    const br = this.bristle;
    if (!br) return;
    for (let i = br.children.length - 1; i >= 0; i--) br.remove(br.children[i]);
    const shell = (mat: THREE.Material, k: number) => {
      const m = new THREE.Mesh(G_bristle, mat);
      m.scale.set(k, 1 + (k - 1) * 0.5, k);
      m.position.y = -0.02;
      br.add(m);
    };
    if (this.glow >= 5) shell(M_haloInk, 1.32);
    if (this.glow >= 10) shell(this.glow >= 15 ? M_edgeGold : M_edgeBlue, 1.14);
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

  /** Reshape the figure (NPCs). Multipliers on the standard proportions; omitted = 1. */
  setBuild(b: Build): void {
    this.len.thigh = LEN.thigh * (b.legs ?? 1);
    this.len.shin = LEN.shin * (b.legs ?? 1);
    this.len.torso = LEN.torso * (b.torso ?? 1);
    this.len.ua = LEN.ua * (b.arms ?? 1);
    this.len.fa = LEN.fa * (b.arms ?? 1);
    this.len.head = LEN.head * (b.head ?? 1);
    this.limbW = LIMB * (b.limb ?? 1);
    this.hatW = b.hatW ?? 1;
    this.head.scale.setScalar(this.len.head);
    this.group.scale.setScalar((b.height ?? 1) * FIGURE_SCALE);
  }

  /** Paint the forearms and hands (dye stains): left, right; null keeps the body ink. */
  paintForearms(left: THREE.Material | null, right: THREE.Material | null): void {
    if (left) { this.segs[3].material = left; this.joints[2].material = left; }
    if (right) { this.segs[5].material = right; this.joints[8].material = right; }
  }

  /** Height of the top of the head above the feet in world units (for name plates and quest marks). */
  topY(): number {
    const L = this.len;
    return (L.thigh + L.shin + L.torso + L.neck + L.head * 2 + (this.hat?.visible ? 0.2 : 0)) * this.group.scale.y;
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
    const p = this.pose, w = this.limbW, LEN = this.len;
    this.inner.position.y = LEN.thigh + LEN.shin + p[11];
    this.inner.rotation.set(0, this.twist, this.spin);
    const tx = Math.sin(p[0]) * LEN.torso, ty = Math.cos(p[0]) * LEN.torso;
    const ha = p[0] + p[1];
    const nx = tx + Math.sin(ha) * LEN.neck, ny = ty + Math.cos(ha) * LEN.neck;
    this.neck.set(nx, ny);
    seg(this.segs[0], tx, ty, 0, 0, 0.088 * w, 0);
    seg(this.segs[1], tx, ty, nx, ny, 0.042 * w, 0);
    const hx = tx + Math.sin(ha) * (LEN.neck + LEN.head), hy = ty + Math.cos(ha) * (LEN.neck + LEN.head);
    this.head.position.set(hx, hy, 0);
    seg3(this.hipBar, 0, 0, -0.1, 0, 0, 0.1, 0.085 * w);
    const wx = Math.sin(p[0]) * 0.14, wy = Math.cos(p[0]) * 0.14;
    this.waistBack.set(wx - Math.cos(p[0]) * 0.19, wy + Math.sin(p[0]) * 0.19);
    if (this.hat && this.mask && this.belt) {
      const hk = LEN.head / 0.24;
      this.hat.position.set(hx + Math.sin(ha) * 0.19 * hk, hy + Math.cos(ha) * 0.19 * hk, 0);
      this.hat.rotation.set(0, 0, -ha);
      this.hat.scale.set(hk * this.hatW, hk, hk * this.hatW);
      this.mask.position.set(hx + Math.cos(ha) * 0.2 * hk, hy - Math.sin(ha) * 0.2 * hk, 0);
      this.mask.scale.setScalar(hk);
      this.mask.rotation.set(0, 0, -ha);
      this.belt.position.set(wx, wy, 0);
      this.belt.rotation.set(0, 0, -p[0]);
    }
    if (this.collar) {
      this.collar.position.set(tx + Math.sin(ha) * 0.05, ty + Math.cos(ha) * 0.05, 0);
      this.collar.rotation.set(0, 0, -p[0] - 0.12);
    }
    const J = this.joints;
    const jt = (i: number, x: number, y: number, z: number, r: number) => {
      J[i].position.set(x, y, z);
      J[i].scale.setScalar(r);
    };
    jt(12, tx, ty, 0, 0.082 * w);
    const sdx = -Math.sin(p[0]) * 0.07, sdy = -Math.cos(p[0]) * 0.07;
    const sx0 = tx + sdx, sy0 = ty + sdy;
    // stance (IK): where the brush sits and where each hand goes, carried on the shoulder (guard 0) or held
    // low in both hands (guard 1); targets are relative to the shoulders, so they follow the torso's lean
    const st = this.stance;
    if (st > 0) {
      const g = this.guard;
      const D = this.ikD;
      D.set(CARRY.d[0] + (GUARD.d[0] - CARRY.d[0]) * g, CARRY.d[1] + (GUARD.d[1] - CARRY.d[1]) * g, CARRY.d[2] + (GUARD.d[2] - CARRY.d[2]) * g).normalize();
      const gx = sx0 + CARRY.grip[0] + (GUARD.grip[0] - CARRY.grip[0]) * g;
      const gy = sy0 + CARRY.grip[1] + (GUARD.grip[1] - CARRY.grip[1]) * g;
      const gz = 0.18 + CARRY.grip[2] + (GUARD.grip[2] - CARRY.grip[2]) * g;
      this.ikR.set(gx, gy, gz);
      // left hand: hanging loose (carry) or on the shaft below the right hand (guard)
      const lx = sx0 + CARRY.left[0], ly = sy0 + CARRY.left[1], lz = -0.18 + CARRY.left[2];
      const ox = gx - D.x * GUARD_LEFT, oy = gy - D.y * GUARD_LEFT, oz = gz - D.z * GUARD_LEFT;
      this.ikL.set(lx + (ox - lx) * g, ly + (oy - ly) * g, lz + (oz - lz) * g);
    }
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1, zs = 0.18 * sgn;
      seg3(side ? this.clavR : this.clavL, tx, ty, 0, sx0, sy0, zs, 0.066 * w);
      const sh = p[2 + side * 2], el = p[3 + side * 2];
      const ex = sx0 + Math.sin(sh) * LEN.ua, ey = sy0 - Math.cos(sh) * LEN.ua, ez = zs * 1.6;
      const fa = sh + el;
      let hx2 = ex + Math.sin(fa) * LEN.fa, hy2 = ey - Math.cos(fa) * LEN.fa, hz = zs * 2.05;
      let exx = ex, eyy = ey, ezz = ez;
      if (st > 0) {
        const T = side ? this.ikR : this.ikL, pole = side ? (this.guard > 0.5 ? GUARD.poleR : CARRY.poleR) : (this.guard > 0.5 ? GUARD.poleL : CARRY.poleL);
        solveArm(sx0, sy0, zs, T.x, T.y, T.z, LEN.ua, LEN.fa, pole);
        exx += (IK[0] - exx) * st; eyy += (IK[1] - eyy) * st; ezz += (IK[2] - ezz) * st;
        hx2 += (IK[3] - hx2) * st; hy2 += (IK[4] - hy2) * st; hz += (IK[5] - hz) * st;
      }
      if (this.arm3 > 0) {
        // mocap: the arm's own 3D directions, so sweeps across the body keep their sideways reach
        const d = this.dirs3, o = side * 6, k = this.arm3;
        const e3x = sx0 + d[o] * LEN.ua, e3y = sy0 + d[o + 1] * LEN.ua, e3z = zs + d[o + 2] * LEN.ua;
        const h3x = e3x + d[o + 3] * LEN.fa, h3y = e3y + d[o + 4] * LEN.fa, h3z = e3z + d[o + 5] * LEN.fa;
        exx += (e3x - exx) * k; eyy += (e3y - eyy) * k; ezz += (e3z - ezz) * k;
        hx2 += (h3x - hx2) * k; hy2 += (h3y - hy2) * k; hz += (h3z - hz) * k;
      }
      seg3(this.segs[2 + side * 2], sx0, sy0, zs, exx, eyy, ezz, 0.066 * w);
      seg3(this.segs[3 + side * 2], exx, eyy, ezz, hx2, hy2, hz, 0.062 * w);
      jt(side * 6, sx0, sy0, zs, 0.064 * w);
      jt(side * 6 + 1, exx, eyy, ezz, 0.05 * w);
      // the hands close round the shaft: a slightly larger fist dab the shaft runs through
      jt(side * 6 + 2, hx2, hy2, hz, (st > 0.5 && (side === 1 || this.guard > 0.5) ? 0.068 : 0.056) * w);
      if (side === 1) {
        const sa = fa + p[10];
        this.hand.set(hx2, hy2);
        this.handZ = hz;
        this.dir3.set(Math.sin(sa), -Math.cos(sa), 0);
        if (st > 0) {
          const D = this.ikD;
          this.dir3.x += (D.x - this.dir3.x) * st; this.dir3.y += (D.y - this.dir3.y) * st; this.dir3.z += (D.z - this.dir3.z) * st;
          this.dir3.normalize();
        }
        if (this.arm3 > 0) {
          const d = this.dirs3, k = this.arm3;
          this.dir3.x += (d[12] - this.dir3.x) * k; this.dir3.y += (d[13] - this.dir3.y) * k; this.dir3.z += (d[14] - this.dir3.z) * k;
          this.dir3.normalize();
        }
        this.dir.set(this.dir3.x, this.dir3.y);
      }
    }
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1, z0 = 0.1 * sgn, z1 = 0.15 * sgn, z2 = 0.2 * sgn;
      const hip = p[6 + side * 2], kn = p[7 + side * 2];
      const kx = Math.sin(hip) * LEN.thigh, ky = -Math.cos(hip) * LEN.thigh, a = hip + kn;
      const fx = kx + Math.sin(a) * LEN.shin, fy = ky - Math.cos(a) * LEN.shin;
      seg3(this.segs[6 + side * 2], 0, 0, z0, kx, ky, z1, 0.08 * w);
      seg3(this.segs[7 + side * 2], kx, ky, z1, fx, fy, z2, 0.075 * w);
      // the foot: a short stroke off the ankle, forward and a touch down
      seg3(this.segs[10 + side], fx, fy, z2, fx + Math.sin(a + 1.5) * 0.2, fy - Math.cos(a + 1.5) * 0.2 - 0.02, z2, 0.058 * w);
      jt(side * 6 + 3, 0, 0, z0, 0.078 * w);
      jt(side * 6 + 4, kx, ky, z1, 0.062 * w);
      jt(side * 6 + 5, fx, fy, z2, 0.058 * w);
    }
    // the weapon is gripped `grip` up from its end (a third of the way up for the brush)
    const sx = this.hand.x, sy = this.hand.y, dx = this.dir.x, dy = this.dir.y, gr = this.grip;
    this.weapon.position.set(sx - dx * gr, sy - dy * gr, this.handZ - this.dir3.z * gr);
    if (this.arm3 > 0 || st > 0) this.weapon.quaternion.setFromUnitVectors(_sup, this.dir3);
    else this.weapon.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
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
    this.group.scale.copy(src.group.scale);
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
/**
 * Samples a baked motion clip (see motion/sword.ts) at t seconds into `out` (the 12 pose values) and
 * returns the body twist. Linear between frames; no allocation.
 */
export function sampleMotion(out: Float32Array, clip: MotionClip, t: number, dirs3: Float32Array | null = null): number {
  const W = 28;
  const f = Math.max(0, Math.min(clip.frames - 1, (t / clip.dur) * (clip.frames - 1)));
  const i = Math.min(clip.frames - 2, Math.floor(f)), u = f - i, d = clip.data, a = i * W, b = a + W;
  for (let k = 0; k < 12; k++) out[k] = d[a + k] + (d[b + k] - d[a + k]) * u;
  if (dirs3) for (let k = 0; k < 15; k++) dirs3[k] = d[a + 13 + k] + (d[b + 13 + k] - d[a + 13 + k]) * u;
  return d[a + 12] + (d[b + 12] - d[a + 12]) * u;
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
