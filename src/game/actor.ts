// A 먹동이 in the field: the local player (input + prediction, exactly like the prototype) or another
// player (interpolated from their reported pose, attacks/skills replayed from counter changes with the
// same VFX). Damage is never decided here: the local actor asks the server through hooks.

import * as THREE from "three";
import { ITEM } from "../shared/items";
import type { Look, Pose } from "../shared/types";
import { BASIC, SKILLS } from "../shared/combat";
import { angDiff } from "./util";
import { scene, addLight, feel } from "./render/gfx";
import { G, M_shadow, dyeCloth } from "./render/materials";
import { POSE, KEYS, Rig, blend, runPose, sampleKeys } from "./render/rig";
import {
  BLOT_DELAY, GOLD_TRAIL, INK_TRAIL, Ribbon, SILVER_TRAIL, SKILL_COL, Trail, earthSlam, fireCrescent, inkBurst, ring,
  sparks, spawnBlot, spawnGhost,
} from "./render/fx";
import type { RGB } from "./util";

export type ActState =
  | "move" | "atk1" | "atk2" | "atk3" | "airspin" | "dash"
  | "sk0" | "sk1" | "sk2" | "sk3" | "sk4" | "land" | "hurt" | "dead";

const ATK = {
  atk1: { dur: BASIC[1].dur, act: [0.06, 0.16], next: "atk2" as ActState | null },
  atk2: { dur: BASIC[2].dur, act: [0.07, 0.18], next: "atk3" as ActState | null },
  atk3: { dur: BASIC[3].dur, act: [0.05, 0.5], next: null as ActState | null },
};
const AIRSPIN_DUR = BASIC[4].dur;
const DASH_DUR = BASIC[5].dur;
/** The server accepts a basic attack at most every BASIC_MIN_GAP (0.2 s); keep a little margin. */
const ATK_GAP = 0.22;
const KIND_STATE: ActState[] = ["move", "atk1", "atk2", "atk3", "airspin", "dash"];
const STATE_KIND: Partial<Record<ActState, number>> = { atk1: 1, atk2: 2, atk3: 3, airspin: 4, dash: 5 };
const SKILL_CD = SKILLS.map((s) => s.cd);
const WHITE: RGB = [1, 1, 1];
const EMBER: RGB = [1, 0.62, 0.15];
const WIND_EDGE: RGB = [0.35, 0.37, 0.42];

export interface Collider { x: number; z: number; r: number }
export interface Field { radius: number; colliders: Collider[] }
export interface ActorHooks {
  /** a basic attack started (1..5) */
  attack(kind: number, a: Actor): void;
  /** a skill should be resolved now at (x, z, head); show its hits after `delay` seconds */
  skill(i: number, a: Actor, delay: number): void;
  /** returns a heading toward the best target, or null */
  aim(x: number, z: number, hasIn: boolean, inHead: number): number | null;
}

const tmpPose = new Float32Array(12);
const vA = new THREE.Vector3(), vB = new THREE.Vector3();
let actorCount = 0;

export class Actor {
  readonly rig = new Rig();
  readonly scarf = new Ribbon();
  readonly tails = [new Ribbon(6, 0.14, 0.06), new Ribbon(5, 0.14, 0.05)];
  readonly trail = new Trail();
  readonly shadow = new THREE.Mesh(G.shadow, M_shadow);
  readonly idx = actorCount++;
  readonly input = { mx: 0, mz: 0, atk: 0, dash: 0, jump: 0, sk: -1, skT: 0 };
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  head = Math.PI / 2;
  onGround = true;
  jumps = 0;
  state: ActState = "move";
  st = 0;
  private dashCd = 0;
  private atkGap = 0;
  inv = 0;
  blink = 0;
  private spin = 0;
  private spinY = 0;
  private flipT = -1;
  private runPhase = 0;
  private ghostT = 0;
  private fired = false;
  readonly cd = new Float32Array(5);
  atkSeq = 0; atkKind = 0; skillSeq = 0; skill = 0;
  private weaponTrail: RGB = INK_TRAIL;
  private lookKey = "";
  /** remote: last reported pose */
  private readonly net = { x: 0, y: 0, z: 0, yaw: 0, seen: false };
  private sk2Air = false;

  constructor(readonly local: boolean, private readonly hooks: ActorHooks | null, public field: Field) {
    scene.add(this.rig.group);
    scene.add(this.shadow);
    this.rig.pose.set(POSE.idle);
  }

  get fx(): number { return Math.cos(this.head); }
  get fz(): number { return -Math.sin(this.head); }

  applyLook(look: Look): void {
    const key = `${look.weapon}|${look.hat}|${look.sash}|${look.sashDye}|${look.scarfDye}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    const w = ITEM[look.weapon], h = ITEM[look.hat], s = ITEM[look.sash];
    this.rig.setWeapon(w);
    this.rig.setHat(h);
    const sashHex = look.sashDye ?? s?.tint ?? null;
    this.rig.setSash(sashHex, s?.id === "s_hemp");
    for (const t of this.tails) t.mesh.material = dyeCloth(sashHex);
    this.scarf.mesh.material = dyeCloth(look.scarfDye);
    this.weaponTrail = w?.trail === "gold" ? GOLD_TRAIL : INK_TRAIL;
  }

  teleport(x: number, z: number): void {
    this.x = x; this.z = z; this.y = 0; this.vx = this.vy = this.vz = 0;
    this.net.x = x; this.net.z = z; this.net.y = 0;
    this.onGround = true;
    this.state = this.state === "dead" ? "dead" : "move";
    this.scarf.reset(x, 1.8, z);
    for (const t of this.tails) t.reset(x, 0.9, z);
  }

  /* ---------- actions ---------- */
  private aim(): void {
    if (!this.hooks) return;
    const inp = this.input, hasIn = Math.hypot(inp.mx, inp.mz) > 0.15, ih = Math.atan2(-inp.mz, inp.mx);
    const h = this.hooks.aim(this.x, this.z, hasIn, ih);
    if (h !== null) this.head = h;
    else if (hasIn) this.head = ih;
  }

  private start(s: ActState): void {
    this.state = s;
    this.st = 0;
    this.fired = false;
    this.trail.col = this.weaponTrail;
    const kind = STATE_KIND[s];
    if (kind) {
      this.atkSeq++;
      this.atkKind = kind;
      this.atkGap = ATK_GAP;
    }
    if (!this.local) return;
    const fx = this.fx, fz = this.fz;
    if (s === "atk1") { this.vx = fx * 5; this.vz = fz * 5; }
    if (s === "atk2") { this.vx = fx * 3.5; this.vz = fz * 3.5; }
    if (s === "atk3") { this.vx = fx * 3; this.vz = fz * 3; }
    if (s === "airspin") this.vy = Math.max(this.vy, 5);
    if (s === "dash") { this.vx = fx * 24; this.vz = fz * 24; this.vy = 0; this.inv = Math.max(this.inv, 0.25); this.dashCd = 0.42; this.ghostT = 0; }
    if (kind) this.hooks?.attack(kind, this);
  }

  private startSkill(i: number): void {
    if (this.local) this.aim();
    this.start(("sk" + i) as ActState);
    this.skillSeq++;
    this.skill = i;
    const col = SKILL_COL[i], fx = this.fx, fz = this.fz;
    if (i === 0) this.trail.col = col;
    if (i === 1) {
      this.trail.col = col;
      ring(this.x, this.z, 3.6, col, 0.8, 0, null, this);
      addLight(this.x, this.z, 8, 1.0, col, this);
    }
    if (i === 2) { this.trail.col = col; this.sk2Air = false; }
    if (i === 3) { this.trail.col = SILVER_TRAIL; addLight(this.x, this.z, 7, 0.8, WHITE, this); }
    if (!this.local) return;
    this.cd[i] = SKILL_CD[i];
    if (i === 0) { this.vx = fx * 3; this.vz = fz * 3; }
    if (i === 1) this.hooks?.skill(1, this, 0.15);
    if (i === 2) { this.vy = 14; this.onGround = false; this.vx = fx * 4; this.vz = fz * 4; }
    if (i === 3) { this.hooks?.skill(3, this, 0.08); this.vx = fx * 50; this.vz = fz * 50; this.vy = 0; this.inv = Math.max(this.inv, 0.35); }
    if (i === 4) { this.vx = 0; this.vz = 0; }
    feel.shake = Math.max(feel.shake, 0.12);
  }

  private landSlam(): void {
    this.start("land");
    earthSlam(this.x, this.z, this.local);
    if (this.local) this.hooks?.skill(2, this, 0);
  }

  /** Server said we took damage: knockback + blink (local), or just the flinch (remote). */
  hurt(nx: number, nz: number): void {
    if (this.state === "dead") return;
    inkBurst(this.x, 1, this.z, 8, nx, nz);
    // the server decides damage; the flinch is cosmetic, so don't stun-lock under many hits
    if (this.inv > 0) return;
    this.inv = 0.7;
    this.blink = 0.5;
    if (this.local) {
      this.vx = nx * 6; this.vz = nz * 6; this.vy = 4; this.onGround = false;
      feel.shake = 0.35;
      feel.hitstop = 0.08;
    }
    if (this.state === "move" || this.state === "land") this.start("hurt");
  }

  die(): void {
    if (this.state === "dead") return;
    this.start("dead");
    inkBurst(this.x, 1, this.z, 20, 0, 0, 1.2);
  }

  revive(): void {
    this.state = "move";
    this.st = 0;
    this.inv = 2;
    this.blink = 2;
  }

  /* ---------- remote: pose + replay ---------- */
  setNet(p: Pose, look: Look, dead: boolean): void {
    this.applyLook(look);
    if (!this.net.seen) {
      this.net.seen = true;
      this.atkSeq = p.atkSeq;
      this.skillSeq = p.skillSeq;
      this.head = p.yaw;
      this.teleport(p.x, p.z);
    } else {
      if (p.skillSeq !== this.skillSeq && this.state !== "dead") {
        this.skillSeq = p.skillSeq - 1;
        this.startSkill(p.skill);
        this.skillSeq = p.skillSeq;
      } else if (p.atkSeq !== this.atkSeq && this.state !== "dead") {
        const s = KIND_STATE[p.atkKind] ?? "atk1";
        this.start(s);
      }
      this.atkSeq = p.atkSeq;
      this.skillSeq = p.skillSeq;
    }
    this.net.x = p.x; this.net.y = p.y; this.net.z = p.z; this.net.yaw = p.yaw;
    if (dead && this.state !== "dead") this.die();
    else if (!dead && this.state === "dead") this.revive();
  }

  /* ---------- per frame ---------- */
  update(dt: number): void {
    this.st += dt;
    this.inv = Math.max(0, this.inv - dt);
    this.blink = Math.max(0, this.blink - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.atkGap = Math.max(0, this.atkGap - dt);
    for (let i = 0; i < 5; i++) this.cd[i] = Math.max(0, this.cd[i] - dt);
    if (this.local) this.updateLocal(dt);
    else this.updateRemote(dt);
    if (this.flipT >= 0) {
      this.flipT += dt;
      const u = Math.min(1, this.flipT / 0.42);
      this.spin = -Math.PI * 2 * (1 - (1 - u) * (1 - u));
      if (u >= 1 || this.state !== "move") { this.flipT = -1; this.spin = 0; }
    } else if (this.state === "airspin") this.spin = -Math.PI * 4 * Math.min(1, this.st / AIRSPIN_DUR);
    else this.spin = 0;
    if (this.state === "atk3") this.spinY = -Math.PI * 4 * Math.min(1, this.st / ATK.atk3.dur);
    else if (this.state === "sk1") this.spinY = -Math.PI * 6 * Math.min(1, this.st / 0.75);
    else this.spinY = 0;
  }

  private canSkill(): boolean {
    const inp = this.input;
    return inp.sk >= 0 && this.cd[inp.sk] <= 0 && (this.onGround || inp.sk !== 2);
  }

  private updateLocal(dt: number): void {
    const inp = this.input;
    const hasIn = Math.hypot(inp.mx, inp.mz) > 0.15;
    const fx = this.fx, fz = this.fz;
    let grav = 36;
    const damp = (r: number) => { const k = 1 - Math.min(1, dt * r); this.vx *= k; this.vz *= k; };
    switch (this.state) {
      case "move": {
        const k = Math.min(1, dt * (this.onGround ? 16 : 7));
        this.vx += (inp.mx * 7.5 - this.vx) * k;
        this.vz += (inp.mz * 7.5 - this.vz) * k;
        if (hasIn) this.head += angDiff(this.head, Math.atan2(-inp.mz, inp.mx)) * Math.min(1, dt * 16);
        if (inp.jump > 0 && (this.onGround || this.jumps < 2)) {
          inp.jump = 0;
          if (this.onGround) { this.vy = 12.5; this.jumps = 1; }
          else { this.vy = 12; this.jumps = 2; this.flipT = 0; }
          this.onGround = false;
        }
        if (this.canSkill()) { const s = inp.sk; inp.sk = -1; this.startSkill(s); break; }
        if (inp.atk > 0 && this.atkGap <= 0) { inp.atk = 0; this.aim(); this.start(this.onGround ? "atk1" : "airspin"); }
        else if (inp.dash > 0 && this.dashCd <= 0 && this.atkGap <= 0) {
          inp.dash = 0;
          if (hasIn) this.head = Math.atan2(-inp.mz, inp.mx);
          this.start("dash");
        }
        break;
      }
      case "atk1": case "atk2": case "atk3": {
        const A = ATK[this.state];
        damp(8);
        if (this.st > A.act[1] && this.atkGap <= 0) {
          if (inp.atk > 0 && A.next) { inp.atk = 0; this.aim(); this.start(A.next); break; }
          if (inp.dash > 0 && this.dashCd <= 0) { inp.dash = 0; if (hasIn) this.head = Math.atan2(-inp.mz, inp.mx); this.start("dash"); break; }
        }
        if (this.st > A.act[1] && this.canSkill()) { const s = inp.sk; inp.sk = -1; this.startSkill(s); break; }
        if (this.st >= A.dur) this.state = "move";
        break;
      }
      case "airspin":
        grav = 14;
        if (this.st >= AIRSPIN_DUR) this.state = "move";
        break;
      case "dash":
        grav = 0; this.vy = 0;
        this.dashGhosts(dt, 0x2a2826, 0.03);
        if (this.st >= DASH_DUR) { this.vx = fx * 7; this.vz = fz * 7; this.state = "move"; }
        break;
      case "sk0":
        damp(6);
        if (!this.fired && this.st >= 0.1) { this.fired = true; this.fireWave(); }
        if (this.st >= 0.42) this.state = "move";
        break;
      case "sk1": {
        const k = Math.min(1, dt * 5);
        this.vx += (inp.mx * 3.5 - this.vx) * k;
        this.vz += (inp.mz * 3.5 - this.vz) * k;
        this.fireSpinSparks();
        if (this.st >= 0.75) { ring(this.x, this.z, 3.8, SKILL_COL[1], 0.6); this.state = "move"; }
        break;
      }
      case "sk2":
        if (this.st > 2) this.state = "move";
        break;
      case "sk3":
        grav = 0; this.vy = 0;
        this.windStep(dt);
        if (this.st >= 0.22) { this.vx = fx * 6; this.vz = fz * 6; this.windEnd(); }
        break;
      case "sk4":
        damp(10);
        if (!this.fired && this.st >= 0.15) { this.fired = true; this.castBlot(); }
        if (this.st >= 0.45) this.state = "move";
        break;
      case "land": damp(12); if (this.st > 0.3) this.state = "move"; break;
      case "hurt": damp(3); if (this.st > 0.25) this.state = "move"; break;
      case "dead": damp(4); break;
    }
    this.vy -= grav * dt;
    this.moveBody(this.vx * dt, this.vz * dt, 0.45);
    this.y += this.vy * dt;
    const was = this.onGround;
    this.onGround = false;
    if (this.y <= 0 && this.vy <= 0) { this.y = 0; this.vy = 0; this.onGround = true; this.jumps = 0; }
    if (this.onGround && !was && this.state === "sk2" && this.st > 0.15) this.landSlam();
  }

  private updateRemote(dt: number): void {
    const n = this.net;
    const ox = this.x, oz = this.z, oy = this.y;
    const k = 1 - Math.exp(-dt * 12);
    if (Math.abs(n.x - this.x) > 12 || Math.abs(n.z - this.z) > 12) this.teleport(n.x, n.z);
    this.x += (n.x - this.x) * k;
    this.z += (n.z - this.z) * k;
    this.y += (n.y - this.y) * Math.min(1, dt * 18);
    if (this.state !== "atk3" && this.state !== "sk1") this.head += angDiff(this.head, n.yaw) * Math.min(1, dt * 14);
    const inv = dt > 0 ? 1 / dt : 0;
    this.vx += ((this.x - ox) * inv - this.vx) * 0.3;
    this.vz += ((this.z - oz) * inv - this.vz) * 0.3;
    this.vy = (this.y - oy) * inv;
    this.onGround = this.y <= 0.05;
    switch (this.state) {
      case "atk1": case "atk2": case "atk3":
        if (this.st >= ATK[this.state].dur) this.state = "move";
        break;
      case "airspin": if (this.st >= AIRSPIN_DUR) this.state = "move"; break;
      case "dash":
        this.dashGhosts(dt, 0x2a2826, 0.03);
        if (this.st >= DASH_DUR) this.state = "move";
        break;
      case "sk0":
        if (!this.fired && this.st >= 0.1) { this.fired = true; this.fireWave(); }
        if (this.st >= 0.42) this.state = "move";
        break;
      case "sk1":
        this.fireSpinSparks();
        if (this.st >= 0.75) { ring(this.x, this.z, 3.8, SKILL_COL[1], 0.6); this.state = "move"; }
        break;
      case "sk2":
        if (!this.onGround) this.sk2Air = true;
        if ((this.sk2Air && this.onGround && this.st > 0.3) || this.st > 1.4) this.landSlam();
        break;
      case "sk3":
        this.windStep(dt);
        if (this.st >= 0.22) this.windEnd();
        break;
      case "sk4":
        if (!this.fired && this.st >= 0.15) { this.fired = true; this.castBlot(); }
        if (this.st >= 0.45) this.state = "move";
        break;
      case "land": if (this.st > 0.3) this.state = "move"; break;
      case "hurt": if (this.st > 0.4) this.state = "move"; break;
      default: break;
    }
  }

  /* ---------- shared skill visuals ---------- */
  private fireWave(): void {
    fireCrescent(this.x, this.z, this.head, this.field.radius, this.local);
    if (this.local) this.hooks?.skill(0, this, 0.12);
  }
  private fireSpinSparks(): void {
    const col = SKILL_COL[1];
    for (let n = 0; n < 3; n++) {
      const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 2.2;
      sparks.emit(this.x + Math.cos(a) * r, 0.4 + Math.random() * 1.6, this.z + Math.sin(a) * r, -Math.sin(a) * 6, 2 + Math.random() * 3, Math.cos(a) * 6, 0.06 + Math.random() * 0.1, 0.45, Math.random() < 0.4 ? EMBER : col, 1);
    }
  }
  private windStep(dt: number): void {
    this.dashGhosts(dt, 0xf4f2ec, 0.022);
    const fx = this.fx, fz = this.fz;
    for (let n = 0; n < 4; n++) sparks.emit(this.x + (Math.random() - 0.5), 0.3 + Math.random() * 1.7, this.z + (Math.random() - 0.5), -fx * 6, 0.5, -fz * 6, 0.05 + Math.random() * 0.06, 0.35, Math.random() < 0.5 ? WHITE : SILVER_TRAIL, 3);
  }
  private windEnd(): void {
    ring(this.x, this.z, 2.4, WHITE, 0.5, 0, WIND_EDGE);
    this.state = "move";
  }
  private castBlot(): void {
    const R = this.field.radius - 2;
    let x = this.x + this.fx * 5, z = this.z + this.fz * 5;
    const d = Math.hypot(x, z);
    if (d > R) { x *= R / d; z *= R / d; }
    spawnBlot(x, z, this.local);
    if (this.local) this.hooks?.skill(4, this, BLOT_DELAY);
  }
  private dashGhosts(dt: number, hex: number, every: number): void {
    this.ghostT -= dt;
    if (this.ghostT <= 0) { spawnGhost(this.rig, hex); this.ghostT = every; }
  }

  private moveBody(dx: number, dz: number, r: number): void {
    this.x += dx;
    this.z += dz;
    const R = this.field.radius;
    const d = Math.hypot(this.x, this.z);
    if (d > R - r) { const k = (R - r) / d; this.x *= k; this.z *= k; }
    for (const c of this.field.colliders) {
      const ex = this.x - c.x, ez = this.z - c.z, dd = Math.hypot(ex, ez), m = c.r + r;
      if (dd < m && dd > 1e-4) { this.x = c.x + (ex / dd) * m; this.z = c.z + (ez / dd) * m; }
    }
  }

  /* ---------- drawing ---------- */
  render(dt: number): void {
    const pose = this.rig.pose;
    const ease = (r: number) => 1 - Math.exp(-dt * r);
    switch (this.state) {
      case "move":
        if (this.onGround) {
          const sp = Math.hypot(this.vx, this.vz);
          if (sp > 0.8) { this.runPhase += dt * sp * 1.5; runPose(tmpPose, this.runPhase); }
          else { tmpPose.set(POSE.idle); tmpPose[11] += Math.sin(feel.time * 2.2 + this.idx) * 0.02; }
          blend(pose, tmpPose, ease(18));
        } else blend(pose, this.vy > 0 ? POSE.airUp : POSE.airDown, ease(12));
        break;
      case "atk1": case "atk2": sampleKeys(pose, KEYS[this.state], this.st / ATK[this.state].dur); break;
      case "sk0": sampleKeys(pose, KEYS.atk1, this.st / 0.42); break;
      case "atk3": case "airspin": case "sk1": blend(pose, POSE.spin, ease(30)); break;
      case "sk2": blend(pose, POSE.plunge, ease(25)); break;
      case "land": blend(pose, POSE.land, ease(30)); break;
      case "dash": case "sk3": blend(pose, POSE.dash, ease(35)); break;
      case "sk4": blend(pose, POSE.cast, ease(30)); break;
      case "hurt": blend(pose, POSE.hurt, ease(25)); break;
      case "dead": blend(pose, POSE.dead, ease(10)); break;
    }
    const rig = this.rig;
    rig.spin = this.spin + (this.state === "dead" ? Math.min(1, this.st * 2) * 1.45 : 0);
    rig.place(this.x, this.y, this.z, this.head + this.spinY);
    rig.apply();
    rig.group.updateMatrixWorld(true);
    rig.group.visible = !(this.blink > 0 && this.state === "move" && Math.floor(feel.time * 20) % 2 === 0);
    this.shadow.position.set(this.x, 0.04, this.z);
    this.shadow.scale.setScalar(0.65 * (1 - Math.min(0.5, this.y * 0.08)));

    const s = this.state;
    const attacking = s !== "move" && s !== "hurt" && s !== "dead" && s !== "land" && s !== "sk4";
    this.trail.strength = attacking ? 1 : Math.max(0, this.trail.strength - dt * 7);
    const hz = rig.handZ + 0.03, L0 = rig.weaponLen * 0.7, L1 = rig.weaponLen;
    vA.set(rig.hand.x + rig.dir.x * L0, rig.hand.y + rig.dir.y * L0, hz);
    vB.set(rig.hand.x + rig.dir.x * L1, rig.hand.y + rig.dir.y * L1, hz);
    rig.inner.localToWorld(vA);
    rig.inner.localToWorld(vB);
    this.trail.push(vA, vB);
    vA.set(rig.neck.x, rig.neck.y, 0);
    rig.inner.localToWorld(vA);
    const t = feel.time + this.idx * 3;
    this.scarf.update(dt, vA.x, vA.y, vA.z, this.head, t);
    for (let i = 0; i < 2; i++) {
      vA.set(rig.waistBack.x, rig.waistBack.y, i ? 0.05 : -0.05);
      rig.inner.localToWorld(vA);
      this.tails[i].update(dt, vA.x, vA.y, vA.z, this.head, t + i * 1.7);
    }
  }

  setVisible(v: boolean): void {
    this.rig.group.visible = v;
    this.shadow.visible = v;
    this.scarf.mesh.visible = v;
    for (const t of this.tails) t.mesh.visible = v;
    this.trail.mesh.visible = v;
  }

  /** Ribbons and trail own their geometry; rig parts are shared. */
  dispose(): void {
    scene.remove(this.rig.group);
    scene.remove(this.shadow);
    this.scarf.dispose();
    for (const t of this.tails) t.dispose();
    this.trail.dispose();
  }
}

