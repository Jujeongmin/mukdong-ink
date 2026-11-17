// A 먹동이 in the field: the local player (input + prediction, exactly like the prototype) or another
// player (interpolated from their reported pose, attacks/skills replayed from counter changes with the
// same VFX). Damage is never decided here: the local actor asks the server through hooks.

import * as THREE from "three";
import { ITEM } from "../shared/items";
import type { Look, Pose } from "../shared/types";
import { BASIC, SKILLS } from "../shared/combat";
import { ROLL_IFRAME_MS } from "../shared/world";
import { awakeningAt, skillCdMul, type Awakening } from "../shared/growth";
import { angDiff } from "./util";
import { scene, addLight, feel } from "./render/gfx";
import { footPrint, rollPrint } from "./render/prints";
import { G, M_body, M_shadow, dyeCloth } from "./render/materials";
import { POSE, KEYS, Rig, blend, runPose, sampleKeys, sampleMotion } from "./render/rig";
import { HIT1, HIT2, HIT3, type MotionClip } from "./render/motion/sword";
import {
  BLOT_DELAY, GOLD_TRAIL, INK_TRAIL, Ribbon, SILVER_TRAIL, SKILL_COL, Trail, earthSlam, fireCrescent, inkBurst, inkDrop, inkSweep, later, ring,
  sparks, spawnBlot, spawnGhost,
} from "./render/fx";
import type { RGB } from "./util";

export type ActState =
  | "move" | "atk1" | "atk2" | "atk3" | "airspin" | "dash" | "roll"
  | "sk0" | "sk1" | "sk2" | "sk3" | "sk4" | "land" | "hurt" | "dead";

/*
 * The ground combo plays motion-captured sword strikes retargeted onto the rig (render/motion/sword.ts,
 * baked by tools/bake-motion.mjs). Each hit runs its clip's length; the next hit may start once the clip
 * passes its chain point (after the impact), and never sooner than the server's BASIC_MIN_GAP (atkGap).
 */
const ATK = {
  atk1: { dur: HIT1.dur, act: [HIT1.impact - 0.05, HIT1.chain], next: "atk2" as ActState | null, clip: HIT1 },
  atk2: { dur: HIT2.dur, act: [HIT2.impact - 0.05, HIT2.chain], next: "atk3" as ActState | null, clip: HIT2 },
  atk3: { dur: HIT3.dur, act: [HIT3.impact - 0.05, HIT3.chain], next: null as ActState | null, clip: HIT3 },
};
/** seconds into each basic hit (by atkKind) when the blow lands: game.ts shows hits and hit-stop there */
export const IMPACT: number[] = [0, HIT1.impact, HIT2.impact, HIT3.impact, 0.12, 0.05];
/** cross-fade into a mocap strike so nothing pops */
const MOCAP_BLEND = 0.08;
const AIRSPIN_DUR = BASIC[4].dur;
/** Per airtime: one air combo (up to three swings), one air dash; each swing may hang for a moment only. */
const AIR_SWINGS = 3;
const AIR_HANG = 0.15;
const DASH_DUR = BASIC[5].dur;
/** The server accepts a basic attack at most every BASIC_MIN_GAP (0.2 s); keep a little margin. */
const ATK_GAP = 0.22;
const KIND_STATE: ActState[] = ["move", "atk1", "atk2", "atk3", "airspin", "roll"];
const STATE_KIND: Partial<Record<ActState, number>> = { atk1: 1, atk2: 2, atk3: 3, airspin: 4, dash: 5, roll: 5 };
/* 구르기 (the dodge): ~4 m in 0.35 s (inside DASH_BURST), i-frames as long as the server's ROLL_IFRAME_MS */
const ROLL_DUR = 0.35;
const ROLL_SPEED = 4 / ROLL_DUR;
const ROLL_CD = 0.8;
const ROLL_IFRAME = ROLL_IFRAME_MS / 1000;
/** the body while the roll can't be hit: a translucent ink ghost (SHARED) */
const M_rollGhost = new THREE.MeshBasicMaterial({ color: 0x2b2622, transparent: true, opacity: 0.42, depthWrite: false });
const ROLL_POSE = Float32Array.from([1.1, 0.5, 1.9, 1.6, 2.0, 1.5, 1.9, -2.4, 1.7, -2.3, 2.6, -0.62]);
const SKILL_CD = SKILLS.map((s) => s.cd);
const WHITE: RGB = [1, 1, 1];
const EMBER: RGB = [1, 0.62, 0.15];
const GOLD_MOTE: RGB = [0.95, 0.78, 0.32];
const FAN = 0.26; // ±15° for the awakened 물결베기
const WIND_EDGE: RGB = [0.35, 0.37, 0.42];

export interface Collider { x: number; z: number; r: number }
export interface Field {
  radius: number;
  colliders: Collider[];
  /** live obstacles that come and go (먹덩굴), shared array refreshed by the monster view */
  dynamic?: Collider[];
}
export interface ActorHooks {
  /** a basic attack started (1..5) */
  attack(kind: number, a: Actor): void;
  /** a skill should be resolved now at (x, z, head); show its hits after `delay` seconds */
  skill(i: number, a: Actor, delay: number): void;
  /** returns a heading toward the best target, or null */
  aim(x: number, z: number, hasIn: boolean, inHead: number): number | null;
  /** heading toward the mouse cursor on the ground, or null for keyboard/touch players */
  cursor?(x: number, z: number): number | null;
  /** heading away from the nearest monster that is attacking, or null */
  evade?(x: number, z: number): number | null;
}

const tmpPose = new Float32Array(12);
/* Out of combat: contrapposto, weight on the left leg, the right knee soft (the arms and the brush are held
   by the rig's IK stance: carried on the shoulder). Ready for a fight: a low guard, knees bent, the left
   foot forward, leaning in (both hands on the brush, bristle forward and down). */
const STAND = Float32Array.from([0.05, 0, -0.2, 0.3, 0.3, 1.2, 0.07, -0.05, -0.14, -0.34, 1.5, -0.05]);
const LOW_GUARD = Float32Array.from([0.3, -0.18, -0.2, 0.6, 0.6, 0.6, 0.5, -0.82, -0.32, -0.5, 0.5, -0.2]);
/** seconds a fight keeps the low guard after the last attack, skill or roll */
const GUARD_HOLD = 4;
const vA = new THREE.Vector3(), vB = new THREE.Vector3();
let actorCount = 0;

/**
 * Sound hook for every actor, local and remote (the game points it at the audio module):
 * 1..3 combo swings, 4 air spin, 5 roll, 10 + i skill i.
 */
export const actorSound: { fn: ((code: number, a: Actor) => void) | null } = { fn: null };
/** "다른 유저 효과 줄이기": remote actors skip their roll/skill flourishes (rings, lights, bursts). */
export const actorFx = { remoteLow: false };

export class Actor {
  readonly rig = new Rig();
  /** the scarf: a knot at the neck (rig collar) and two long tails trailing behind */
  readonly scarf = new Ribbon(11, 0.15, 0.085);
  readonly scarf2 = new Ribbon(8, 0.14, 0.07);
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
  private rollCd = 0;
  private ghosted = false;
  /** air budget, reset on landing */
  private airSwings = 0;
  /** 바람질주 started in the air keeps gravity */
  private skAir = false;
  private atkGap = 0;
  inv = 0;
  blink = 0;
  private spin = 0;
  private spinY = 0;
  /** the third hit's ink sweep has fired */
  private swept = false;
  private flipT = -1;
  private runPhase = 0;
  /** footprints: in the air since the last print (the next one is darker); a roll's smear already laid */
  private printAir = false;
  private printRoll = false;
  private ghostT = 0;
  private fired = false;
  readonly cd = new Float32Array(5);
  atkSeq = 0; atkKind = 0; skillSeq = 0; skill = 0;
  private weaponTrail: RGB = INK_TRAIL;
  /** skill levels (1..10) and brush enhancement from the look: awakened skills and glows show for everyone */
  readonly skillLv = [1, 1, 1, 1, 1];
  private plus = 0;
  private windX = 0;
  private windZ = 0;
  private lookKey = "";
  /** remote: last reported pose */
  private readonly net = { x: 0, y: 0, z: 0, yaw: 0, seen: false };
  private sk2Air = false;

  constructor(readonly local: boolean, private readonly hooks: ActorHooks | null, public field: Field) {
    scene.add(this.rig.group);
    scene.add(this.shadow);
    this.rig.pose.set(STAND);
    this.rig.grip = 0.55; // a third of the way up the shaft
  }

  /** a monster close enough to fight (set by game.ts): the guard comes up */
  threat = false;
  /** seconds left in the guard after the last attack/skill/roll */
  private combatT = 0;
  /** the low guard is up (attacked, cast or rolled in the last few seconds) */
  get inCombat(): boolean {
    return this.combatT > 0;
  }

  get fx(): number { return Math.cos(this.head); }
  get fz(): number { return -Math.sin(this.head); }

  applyLook(look: Look): void {
    const sk = look.skills ?? [];
    for (let i = 0; i < 5; i++) this.skillLv[i] = Math.max(1, sk[i] ?? 1);
    const key = `${look.weapon}|${look.hat}|${look.sash}|${look.sashDye}|${look.scarfDye}|${look.plus ?? 0}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    const w = ITEM[look.weapon], h = ITEM[look.hat], s = ITEM[look.sash];
    this.rig.setWeapon(w);
    this.rig.setHat(h);
    const sashHex = look.sashDye ?? s?.tint ?? null;
    this.rig.setSash(sashHex, s?.id === "s_hemp");
    for (const t of this.tails) t.mesh.material = dyeCloth(sashHex);
    this.scarf.mesh.material = dyeCloth(look.scarfDye);
    this.scarf2.mesh.material = dyeCloth(look.scarfDye);
    this.rig.setCollar(dyeCloth(look.scarfDye));
    this.weaponTrail = w?.trail === "gold" ? GOLD_TRAIL : INK_TRAIL;
    this.plus = look.plus ?? 0;
    this.rig.setGlow(this.plus);
  }

  teleport(x: number, z: number): void {
    this.x = x; this.z = z; this.y = 0; this.vx = this.vy = this.vz = 0;
    this.net.x = x; this.net.z = z; this.net.y = 0;
    this.onGround = true;
    this.state = this.state === "dead" ? "dead" : "move";
    this.scarf.reset(x, 1.8, z);
    this.scarf2.reset(x, 1.8, z);
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

  /** Roll along the move keys if held, else away from whoever is attacking, else toward the cursor. */
  private rollFacing(hasIn: boolean): void {
    const inp = this.input;
    if (hasIn) { this.head = Math.atan2(-inp.mz, inp.mx); return; }
    const away = this.hooks?.evade?.(this.x, this.z);
    if (away != null) { this.head = away; return; }
    const c = this.hooks?.cursor?.(this.x, this.z);
    if (c != null) this.head = c;
  }

  /** Start a roll if it's ready; returns true when it rolled. */
  private tryRoll(hasIn: boolean): boolean {
    const inp = this.input;
    if (inp.dash <= 0 || this.rollCd > 0 || !this.onGround) return false;
    inp.dash = 0;
    inp.atk = 0;
    this.rollFacing(hasIn);
    this.start("roll");
    return true;
  }

  private start(s: ActState): void {
    this.state = s;
    this.st = 0;
    this.swept = false;
    if (s !== "move" && s !== "land" && s !== "hurt" && s !== "dead") this.combatT = GUARD_HOLD;
    this.fired = false;
    this.trail.col = this.weaponTrail;
    const kind = STATE_KIND[s];
    if (kind && s !== "dash") actorSound.fn?.(kind, this);
    if (kind) {
      this.atkSeq++;
      this.atkKind = kind;
      if (s !== "roll") this.atkGap = ATK_GAP;
    }
    if (s === "roll") {
      // i-frames for everyone who sees it (the server ignores blows for ROLL_IFRAME_MS after it sees the bump)
      this.inv = Math.max(this.inv, ROLL_IFRAME);
      this.ghostT = 0;
      this.setGhost(true);
      if (this.local || !actorFx.remoteLow) inkBurst(this.x, 0.2, this.z, 6, -this.fx, -this.fz, 0.5);
    }
    if (!this.local) return;
    const fx = this.fx, fz = this.fz;
    if (s === "atk1") { this.vx = fx * 5; this.vz = fz * 5; }
    if (s === "atk2") { this.vx = fx * 3.5; this.vz = fz * 3.5; }
    if (s === "atk3") { this.vx = fx * 3; this.vz = fz * 3; }
    if (s === "airspin") this.airSwings++;
    if (s === "dash") {
      this.vx = fx * 24; this.vz = fz * 24; this.inv = Math.max(this.inv, 0.25); this.dashCd = 0.42; this.ghostT = 0;
      this.vy = 0;
    }
    if (s === "roll") { this.vx = fx * ROLL_SPEED; this.vz = fz * ROLL_SPEED; this.vy = 0; this.rollCd = ROLL_CD; }
    // a roll is movement, not a swing: only the pose counter tells the server (distance + i-frames)
    if (kind && s !== "roll") this.hooks?.attack(kind, this);
  }

  private startSkill(i: number): void {
    if (this.local) this.aim();
    this.start(("sk" + i) as ActState);
    actorSound.fn?.(10 + i, this);
    this.skillSeq++;
    this.skill = i;
    const col = SKILL_COL[i], fx = this.fx, fz = this.fz;
    const flourish = this.local || !actorFx.remoteLow;
    if (i === 0) this.trail.col = col;
    if (i === 1) {
      this.trail.col = col;
      if (flourish) {
        ring(this.x, this.z, 3.6 + (this.aw(1)?.area ?? 0), col, 0.8, 0, null, this);
        addLight(this.x, this.z, 8, 1.0, col, this);
      }
    }
    if (i === 2) { this.trail.col = col; this.sk2Air = false; }
    if (i === 3) { this.trail.col = SILVER_TRAIL; if (flourish) addLight(this.x, this.z, 7, 0.8, WHITE, this); this.windX = this.x; this.windZ = this.z; }
    if (!this.local) return;
    this.cd[i] = this.skillCd(i);
    if (i === 0) { this.vx = fx * 3; this.vz = fz * 3; }
    if (i === 1) this.hooks?.skill(1, this, 0.15);
    if (i === 2) { this.vy = 14; this.onGround = false; this.vx = fx * 4; this.vz = fz * 4; }
    if (i === 3) {
      this.hooks?.skill(3, this, 0.08); this.vx = fx * 50; this.vz = fz * 50; this.inv = Math.max(this.inv, 0.35);
      this.skAir = !this.onGround;
      if (!this.skAir) this.vy = 0;
    }
    if (i === 4) { this.vx = 0; this.vz = 0; }
    feel.shake = Math.max(feel.shake, 0.12);
  }

  private landSlam(): void {
    this.start("land");
    const a = this.aw(2);
    earthSlam(this.x, this.z, this.local, 5 + (a?.area ?? 0), !!a && a.echo > 0);
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
    this.rollCd = Math.max(0, this.rollCd - dt);
    if (this.ghosted && this.inv <= 0) this.setGhost(false);
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
    // the third hit's spin comes from its mocap twist now
    if (this.state === "sk1") this.spinY = -Math.PI * 6 * Math.min(1, this.st / 0.75);
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
        if (inp.atk > 0 && this.atkGap <= 0 && (this.onGround || this.airSwings < AIR_SWINGS)) { inp.atk = 0; this.aim(); this.start(this.onGround ? "atk1" : "airspin"); }
        else this.tryRoll(hasIn);
        break;
      }
      case "atk1": case "atk2": case "atk3": {
        const A = ATK[this.state];
        damp(8);
        if (this.st > A.act[1] && this.atkGap <= 0) {
          if (inp.atk > 0 && A.next) { inp.atk = 0; this.aim(); this.start(A.next); break; }
        }
        if (this.tryRoll(hasIn)) break;
        if (this.st > A.act[1] && this.canSkill()) { const s = inp.sk; inp.sk = -1; this.startSkill(s); break; }
        if (this.st >= A.dur) this.state = "move";
        break;
      }
      case "airspin":
        // a brief hang at the start of the swing, never a lift; then it falls like anything else
        grav = this.st < AIR_HANG ? 14 : 36;
        if (this.vy > 0 && this.st < AIR_HANG) this.vy *= 1 - Math.min(1, dt * 6);
        if (this.st >= AIRSPIN_DUR || this.onGround) this.state = "move";
        break;
      case "dash":
        if (this.onGround) { grav = 0; this.vy = 0; } else if (this.vy > 0) this.vy = 0; // an air dash never lifts
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
        if (this.st >= 0.75) { this.fireEnd(); this.state = "move"; }
        break;
      }
      case "sk2":
        if (this.st > 2) this.state = "move";
        break;
      case "sk3":
        if (this.skAir) { if (this.vy > 0) this.vy = 0; } else { grav = 0; this.vy = 0; } // cast in the air: it still falls
        this.windStep(dt);
        if (this.st >= this.windDur()) { this.vx = fx * 6; this.vz = fz * 6; this.windEnd(); }
        break;
      case "sk4":
        damp(10);
        if (!this.fired && this.st >= 0.15) { this.fired = true; this.castBlot(); }
        if (this.st >= 0.45) this.state = "move";
        break;
      case "land": damp(12); if (this.st > 0.3) this.state = "move"; break;
      case "hurt": damp(3); if (this.tryRoll(hasIn)) break; if (this.st > 0.25) this.state = "move"; break;
      case "roll":
        grav = 0; this.vy = 0;
        this.rollSmear(dt);
        if (this.st >= ROLL_DUR) { this.vx = fx * 2; this.vz = fz * 2; this.state = "move"; }
        break;
      case "dead": damp(4); break;
    }
    this.vy -= grav * dt;
    this.moveBody(this.vx * dt, this.vz * dt, 0.45);
    this.y += this.vy * dt;
    const was = this.onGround;
    this.onGround = false;
    if (this.y <= 0 && this.vy <= 0) { this.y = 0; this.vy = 0; this.onGround = true; this.jumps = 0; this.airSwings = 0; }
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
      case "roll":
        this.rollSmear(dt);
        if (this.st >= ROLL_DUR) this.state = "move";
        break;
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
        if (this.st >= 0.75) { this.fireEnd(); this.state = "move"; }
        break;
      case "sk2":
        if (!this.onGround) this.sk2Air = true;
        if ((this.sk2Air && this.onGround && this.st > 0.3) || this.st > 1.4) this.landSlam();
        break;
      case "sk3":
        this.windStep(dt);
        if (this.st >= this.windDur()) this.windEnd();
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
  /** The awakening in force for skill i at this actor's level (same numbers the server uses). */
  private aw(i: number): Awakening | null {
    return awakeningAt(i, this.skillLv[i]);
  }
  /** Effective cooldown at the trained level. */
  skillCd(i: number): number {
    return SKILL_CD[i] * skillCdMul(this.skillLv[i]);
  }
  private windDur(): number {
    return 0.22 + (this.aw(3)?.reach ?? 0) / 50;
  }
  private fireEnd(): void {
    const a = this.aw(1), r = 3.8 + (a?.area ?? 0);
    ring(this.x, this.z, r, SKILL_COL[1], 0.6);
    if (a && a.echo > 0) later(0.35, this.x, this.z, r, this.local, "fire");
  }
  private fireWave(): void {
    const a = this.aw(0);
    const width = 1 + (a?.area ?? 0) / 1.6, life = 0.65 + (a?.reach ?? 0) / 19;
    fireCrescent(this.x, this.z, this.head, this.field.radius, this.local, width, life);
    if (a && a.extraWaves > 0) {
      fireCrescent(this.x, this.z, this.head + FAN, this.field.radius, false, width, life);
      fireCrescent(this.x, this.z, this.head - FAN, this.field.radius, false, width, life);
    }
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
    const a = this.aw(3);
    if (a && a.echo > 0) {
      // wind blades rise along the path just run
      for (let k = 1; k <= 3; k++) {
        const u = k / 4;
        later(0.12 + k * 0.07, this.windX + (this.x - this.windX) * u, this.windZ + (this.z - this.windZ) * u, 1.6 + a.area, this.local, "wind");
      }
    }
    this.state = "move";
  }
  private castBlot(): void {
    const R = this.field.radius - 2;
    let x = this.x + this.fx * 5, z = this.z + this.fz * 5;
    const d = Math.hypot(x, z);
    if (d > R) { x *= R / d; z *= R / d; }
    const a = this.aw(4);
    spawnBlot(x, z, this.local, 4.4 + (a?.area ?? 0), !!a && a.echo > 0);
    if (this.local) this.hooks?.skill(4, this, BLOT_DELAY);
  }
  /** Ink smear and afterimages along the roll. */
  private rollSmear(dt: number): void {
    this.ghostT -= dt;
    if (this.ghostT <= 0) {
      spawnGhost(this.rig, 0x2b2622);
      this.ghostT = 0.05;
      inkBurst(this.x, 0.15, this.z, 2, -this.fx, -this.fz, 0.4);
    }
  }

  /** Body meshes switch to the translucent ink ghost while the roll can't be hit (materials are SHARED). */
  private setGhost(on: boolean): void {
    if (on === this.ghosted) return;
    this.ghosted = on;
    const from = on ? M_body : M_rollGhost, to = on ? M_rollGhost : M_body;
    this.rig.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === from) m.material = to;
    });
  }

  /** How long until the roll is ready (0 = ready); for the HUD. */
  rollWait(): number {
    return this.rollCd;
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
    const dyn = this.field.dynamic;
    if (dyn) {
      for (let i = 0; i < dyn.length; i++) {
        const c = dyn[i];
        const ex = this.x - c.x, ez = this.z - c.z, dd = Math.hypot(ex, ez), m = c.r + r;
        if (dd < m && dd > 1e-4) { this.x = c.x + (ex / dd) * m; this.z = c.z + (ez / dd) * m; }
      }
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
          if (sp > 0.8) {
            const k0 = Math.floor((this.runPhase - Math.PI / 2) / Math.PI);
            this.runPhase += dt * sp * 1.5;
            runPose(tmpPose, this.runPhase);
            // a foot plants at each extreme of the stride: an ink dab, alternating feet
            const k = Math.floor((this.runPhase - Math.PI / 2) / Math.PI);
            if (k !== k0) { footPrint(this.x, this.z, this.vx / sp, this.vz / sp, k, !this.local, this.printAir); this.printAir = false; }
          }
          else {
            const it = feel.time + this.idx * 2.7;
            tmpPose.set(STAND);
            tmpPose[11] += Math.sin(it * 2.2) * 0.022; // breathing
            tmpPose[0] += Math.sin(it * 2.2) * 0.02;
            const w = Math.sin(it * 0.35) * 0.5; // the weight settles from leg to leg, slowly
            tmpPose[6] += w * 0.06; tmpPose[8] -= w * 0.06;
            // now and then a look to the side
            const c = it % 9;
            if (c > 7.2) tmpPose[1] += Math.sin(((c - 7.2) / 1.8) * Math.PI) * 0.22;
            // the guard: crouch into it
            const g = this.rig.guard;
            if (g > 0) for (let k = 0; k < 12; k++) tmpPose[k] += (LOW_GUARD[k] - tmpPose[k]) * g;
          }
          blend(pose, tmpPose, ease(18));
        } else blend(pose, this.vy > 0 ? POSE.airUp : POSE.airDown, ease(12));
        break;
      case "atk1": case "atk2": case "atk3": {
        const clip: MotionClip = ATK[this.state].clip;
        const tw = sampleMotion(tmpPose, clip, this.st, this.rig.dirs3);
        if (this.st < MOCAP_BLEND) {
          const k = this.st / MOCAP_BLEND;
          blend(pose, tmpPose, k);
          this.rig.twist += (tw - this.rig.twist) * k;
          this.rig.arm3 = k;
        } else { pose.set(tmpPose); this.rig.twist = tw; this.rig.arm3 = 1; }
        // the third hit closes its circle at the impact: a sweep of ink round the body
        if (this.state === "atk3" && !this.swept && this.st >= clip.impact) { this.swept = true; inkSweep(this.x, this.z, BASIC[3].hit.shape === "ring" ? BASIC[3].hit.r : 2.6); }
        break;
      }
      case "sk0": sampleKeys(pose, KEYS.atk1, this.st / 0.42); break;
      case "airspin": case "sk1": blend(pose, POSE.spin, ease(30)); break;
      case "sk2": blend(pose, POSE.plunge, ease(25)); break;
      case "land": blend(pose, POSE.land, ease(30)); break;
      case "dash": case "sk3": blend(pose, POSE.dash, ease(35)); break;
      case "roll": blend(pose, ROLL_POSE, ease(40)); break;
      case "sk4": blend(pose, POSE.cast, ease(30)); break;
      case "hurt": blend(pose, POSE.hurt, ease(25)); break;
      case "dead": blend(pose, POSE.dead, ease(10)); break;
    }
    if (!this.onGround) this.printAir = true;
    if (this.state === "roll" && !this.printRoll) {
      // one long smear along the roll, drawn out as it goes
      this.printRoll = true;
      const sp = Math.hypot(this.vx, this.vz), dx = sp > 1 ? this.vx / sp : this.fx, dz = sp > 1 ? this.vz / sp : this.fz;
      rollPrint(this.x, this.z, dx, dz, ROLL_SPEED * ROLL_DUR * 0.85, !this.local);
    } else if (this.state !== "roll") this.printRoll = false;
    const rig = this.rig;
    // the brush is held by IK while moving, rolling, landing or hurt; strikes use mocap, skills their poses
    this.combatT = Math.max(0, this.combatT - dt);
    const s0 = this.state;
    const held = s0 === "move" || s0 === "roll" || s0 === "land" || s0 === "hurt";
    rig.stance += ((held ? 1 : 0) - rig.stance) * ease(held ? 10 : 30);
    const guardOn = this.threat || this.combatT > 0;
    rig.guard = Math.max(0, Math.min(1, rig.guard + (guardOn ? dt : -dt) / 0.25));
    if (this.state !== "atk1" && this.state !== "atk2" && this.state !== "atk3") {
      rig.twist += (0 - rig.twist) * ease(16);
      rig.arm3 = Math.max(0, rig.arm3 - dt / MOCAP_BLEND);
    }
    rig.spin = this.spin + (this.state === "dead" ? Math.min(1, this.st * 2) * 1.45 : 0)
      + (this.state === "roll" ? -Math.PI * 2 * Math.min(1, this.st / ROLL_DUR) : 0);
    rig.place(this.x, this.y, this.z, this.head + this.spinY);
    rig.apply();
    rig.group.updateMatrixWorld(true);
    rig.group.visible = !(this.blink > 0 && !this.ghosted && this.state === "move" && Math.floor(feel.time * 20) % 2 === 0);
    this.shadow.position.set(this.x, 0.04, this.z);
    this.shadow.scale.setScalar(0.65 * (1 - Math.min(0.5, this.y * 0.08)));

    const s = this.state;
    const attacking = s !== "move" && s !== "hurt" && s !== "dead" && s !== "land" && s !== "sk4" && s !== "roll";
    this.trail.strength = attacking ? 1 : Math.max(0, this.trail.strength - dt * 7);
    const hz = rig.handZ, L0 = rig.tipLen * 0.4, L1 = rig.tipLen + 0.03; // a wide calligraphy ribbon
    const d3 = rig.dir3;
    vA.set(rig.hand.x + d3.x * L0, rig.hand.y + d3.y * L0, hz + d3.z * L0);
    vB.set(rig.hand.x + d3.x * L1, rig.hand.y + d3.y * L1, hz + d3.z * L1);
    rig.inner.localToWorld(vA);
    rig.inner.localToWorld(vB);
    this.trail.push(vA, vB);
    // +15: gold motes drift off the brush tip
    if (this.plus >= 15 && Math.random() < 0.35) sparks.emit(vB.x, vB.y, vB.z, (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8, 0.03 + Math.random() * 0.04, 0.8, GOLD_MOTE, 1.5);
    const t = feel.time + this.idx * 3;
    // cloth speed: how hard the scarf and sash are blown back (running, rolling, dashing)
    const s2 = this.state;
    const cloth = Math.hypot(this.vx, this.vz) + (s2 === "roll" || s2 === "dash" ? 6 : 0) + (this.onGround ? 0 : 2);
    // two scarf tails from the back of the knot, a hand apart
    for (let i = 0; i < 2; i++) {
      vA.set(rig.neck.x - 0.1, rig.neck.y - 0.06, i ? 0.06 : -0.05);
      rig.inner.localToWorld(vA);
      (i ? this.scarf2 : this.scarf).update(dt, vA.x, vA.y, vA.z, this.head, t + i * 0.9, cloth, i ? 1 : -1);
    }
    for (let i = 0; i < 2; i++) {
      vA.set(rig.waistBack.x, rig.waistBack.y, i ? 0.05 : -0.05);
      rig.inner.localToWorld(vA);
      this.tails[i].update(dt, vA.x, vA.y, vA.z, this.head, t + i * 1.7, cloth * 0.7);
    }
    // now and then a drop of ink gathers on the bristle point and falls
    if (s2 === "move" && Math.random() < dt * 0.35) {
      vB.set(rig.hand.x + rig.dir3.x * rig.tipLen, rig.hand.y + rig.dir3.y * rig.tipLen, rig.handZ + rig.dir3.z * rig.tipLen);
      rig.inner.localToWorld(vB);
      inkDrop(vB.x, vB.y, vB.z, 0, -0.5, 0, 0.035, 1.2);
    }
  }

  setVisible(v: boolean): void {
    this.rig.group.visible = v;
    this.shadow.visible = v;
    this.scarf.mesh.visible = v;
    this.scarf2.mesh.visible = v;
    for (const t of this.tails) t.mesh.visible = v;
    this.trail.mesh.visible = v;
  }

  /** Ribbons and trail own their geometry; rig parts are shared. */
  dispose(): void {
    scene.remove(this.rig.group);
    scene.remove(this.shadow);
    this.scarf.dispose();
    this.scarf2.dispose();
    for (const t of this.tails) t.dispose();
    this.trail.dispose();
  }
}

