// Auto-battle and auto-quest travel, like the usual Korean RPG helpers. A client-side driver: it only writes
// the same inputs a player would (move stick, attack, skill, potion, talk, gates), so every server check
// (speed clamp, cooldowns, BASIC_MIN_GAP) still applies. Decisions at ~5 Hz; steering per frame with no
// allocations. Manual input pauses auto-battle for 2 s and cancels auto-travel.

import * as THREE from "three";
import { DAILY_QUESTS, MAIN_QUESTS, NPC_REACH, PORTAL_REACH, ZONES, type Npc, type ZoneDef } from "../shared/world";
import { SKILLS, ULT_RADIUS, isObstacle } from "../shared/combat";
import type { ProfileView } from "../net/api";
import type { Actor } from "./actor";
import type { MView } from "./monsters";
import { dailyStatus, mainStatus, mainWall, nextDaily, readyByTalk, subStatus } from "./quests";
import { overlay } from "./render/gfx";
import { gameSettings } from "./ui/settings";
import { attackingMe, targetable } from "./targeting";
import { t } from "./i18n";

export interface AutoSettings {
  skills: boolean[];
  potion: boolean;
  /** 0.2..0.6 */
  threshold: number;
  questFirst: boolean;
  /** 궁극기 as soon as it is full (with something in reach) */
  ult: boolean;
}

export interface AutoCtx {
  player(): Actor;
  monsters(): Map<string, MView>;
  zone(): ZoneDef;
  profile(): ProfileView;
  /** false while dead, loading, in dialogue */
  canAct(): boolean;
  /** true while a sheet/menu is open (auto pauses, resumes on close) */
  paused(): boolean;
  /** ms since the last manual input */
  sinceManual(): number;
  skillReady(i: number): boolean;
  /** the 궁극기 is full and can go now; `ult` sets it off */
  ultReady?(): boolean;
  ult?(): void;
  drinkPotion(): void;
  /** true on arrival; false (quietly, on too_far) means keep walking and try again */
  travel(to: string, from: string): Promise<boolean>;
  talk(npc: Npc): Promise<void>;
  think(id: string, text: string): void;
  changed(): void;
  /** pay every finished daily quest */
  claimDailies(): Promise<void>;
  /** hand in the open 서브 퀘스트 */
  claimSub(): Promise<void>;
}

const RANGE = 16; // hunt radius around the anchor
const MELEE = 2.1;
const RESUME_MS = 2000;
const BUF = 0.15;

/** A faint ink arrow at the feet pointing to the next waypoint while auto-travelling (one mesh for the session). */
function makeArrow(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.55); shape.lineTo(0.32, -0.1); shape.lineTo(0.1, -0.02); shape.lineTo(0.12, -0.5);
  shape.lineTo(-0.12, -0.5); shape.lineTo(-0.1, -0.02); shape.lineTo(-0.32, -0.1); shape.closePath();
  const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2b2622, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
  m.visible = false;
  m.frustumCulled = false;
  overlay.add(m);
  return m;
}

type Goal =
  | { kind: "npc"; zone: string; npc: Npc }
  | { kind: "zone"; zone: string }
  | { kind: "hunt"; zone: string; monster: string; daily?: number; sub?: boolean };

export class AutoPlay {
  /* ---------- auto-battle ---------- */
  on = false;
  settings: AutoSettings = { skills: [true, true, true, true, true], potion: true, threshold: 0.4, questFirst: true, ult: true };
  private anchorX = 0;
  private anchorZ = 0;
  private target: MView | null = null;
  private tick = 0;
  /* ---------- auto-travel ---------- */
  traveling = false;
  /**
   * 자동 진행 (Z): keeps going goal after goal - to the giver to take the main quest, out to hunt, back to hand it
   * in - until switched off, moved by hand, or there is nowhere to go. Plain travel (the quest card) stops at one.
   */
  progress = false;
  /** the daily quest 자동 진행 is working on (-1: the main quest, or the 서브 퀘스트 when `sub`) */
  daily = -1;
  /** 자동 진행 is on the 서브 퀘스트 */
  sub = false;
  private goal: Goal | null = null;
  private wpX = 0;
  private wpZ = 0;
  private hasWp = false;
  private gateTo = "";
  /** after a too_far at a gate: when to ask again */
  private gateRetryAt = 0;
  private stuckT = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private fails = 0;
  private sideT = 0;
  private sideSign = 1;
  private busy = false;
  private readonly arrow = makeArrow();
  private settingsKey = "";

  constructor(private readonly ctx: AutoCtx) {}

  bind(account: string): void {
    this.settingsKey = `ink.auto.${account}`;
    try {
      const raw = window.localStorage.getItem(this.settingsKey);
      if (raw) this.settings = { ...this.settings, ...(JSON.parse(raw) as Partial<AutoSettings>) };
      // the potion choice now lives in the general settings (one source of truth): carry the old one over once
      if (raw && !gameSettings.hasPotion) { gameSettings.set({ autoPotion: this.settings.potion, potionAt: this.settings.threshold }); gameSettings.hasPotion = true; }
    } catch {
      // defaults
    }
  }

  saveSettings(): void {
    try { window.localStorage.setItem(this.settingsKey, JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  }

  /** Is the driver steering this frame (used to aim swings at its target and keep gates closed)? */
  active(): boolean {
    return (this.on || this.traveling) && this.ctx.canAct() && !this.ctx.paused() && this.ctx.sinceManual() > (this.traveling ? 0 : RESUME_MS);
  }

  /** Picks the first enabled, ready skill whose reach covers distance d; returns true if one was queued. */
  private fireSkill(pl: Actor, d: number, only?: readonly number[]): boolean {
    const inp = pl.input;
    if (inp.sk >= 0) return false;
    // full rainbow and something within its ring: it goes first (자동 설정에서 끌 수 있다)
    if (this.settings.ult !== false && !only && d < ULT_RADIUS - 1.5 && this.ctx.ultReady?.()) { this.ctx.ult?.(); return true; }
    for (let i = 0; i < SKILLS.length; i++) {
      if (!this.settings.skills[i] || !this.ctx.skillReady(i)) continue;
      if (only && !only.includes(i)) continue;
      const reach = i === 0 || i === 3 ? 9 : i === 4 ? 7 : 3.4;
      if (d > reach || (i === 4 && d < 2)) continue;
      if (i === 2 && !pl.onGround) continue;
      inp.sk = i;
      inp.skT = BUF;
      return true;
    }
    return false;
  }

  toggle(): boolean {
    if (this.on) { this.stop(); return false; }
    if (this.ctx.zone().safe) return false;
    const p = this.ctx.player();
    this.on = true;
    this.anchorX = p.x;
    this.anchorZ = p.z;
    this.target = null;
    this.ctx.changed();
    return true;
  }

  stop(): void {
    this.progress = false;
    this.daily = -1;
    this.sub = false;
    if (!this.on && !this.traveling) return;
    this.on = false;
    this.traveling = false;
    this.goal = null;
    this.target = null;
    this.hasWp = false;
    this.arrow.visible = false;
    this.ctx.changed();
  }

  /** Manual movement cancels travel (auto-battle merely waits 2 s). */
  manual(moved: boolean): void {
    if (moved && this.progress) { this.stop(); return; }
    if (moved && this.traveling) {
      this.traveling = false;
      this.goal = null;
      this.hasWp = false;
      this.arrow.visible = false;
      if (!this.on) this.ctx.changed();
    }
  }

  /** Zone changed: auto-battle ends; travel carries on toward its goal. */
  zoneChanged(): void {
    if (this.on && !(this.traveling && this.goal?.kind === "hunt")) this.on = false;
    this.target = null;
    this.hasWp = false;
    this.fails = 0;
    this.ctx.changed();
  }

  /** Z: 자동 진행 on/off. Returns a reason when it can't start. */
  toggleProgress(): string | null {
    if (this.progress || this.on || this.traveling) { this.stop(); return null; }
    // the main quest is walled (경지 too low): go strengthen first, on today's quests and then the 서브 퀘스트
    if (mainWall(this.ctx.profile())) return nextDaily(this.ctx.profile()) >= 0 ? this.startDaily(nextDaily(this.ctx.profile()), true) : this.startSub(true);
    this.daily = -1;
    const why = this.startTravel();
    if (why) {
      // nowhere to walk to (e.g. "level up first"): out in a field, hunt right here instead
      if (this.ctx.zone().safe) return why;
      this.progress = true;
      this.toggle();
      this.ctx.think("auto-why", why);
      return null;
    }
    this.progress = true;
    this.ctx.changed();
    return null;
  }

  /**
   * 자동 진행 on one daily quest: hunt where its targets are (a field that suits the player's 경지), and when it is
   * done, collect it and go on. Returns a reason when it can't.
   */
  startDaily(i: number, walled = false): string | null {
    const p = this.ctx.profile();
    const d = dailyStatus(p, i);
    if (d.claimed) return t("오늘은 이미 마친 의뢰다.");
    this.stop();
    this.progress = true;
    this.daily = i;
    if (d.done) { void this.ctx.claimDailies().then(() => this.carryOn()); this.ctx.changed(); return null; }
    const zone = huntZone(DAILY_QUESTS[i].goal.type === "kill" ? DAILY_QUESTS[i].goal.kind : "any", p.level, this.ctx.zone());
    if (!zone) { this.stop(); return t("먹귀신이 있는 곳을 모르겠다."); }
    this.goal = { kind: "hunt", zone, monster: DAILY_QUESTS[i].goal.type === "kill" ? DAILY_QUESTS[i].goal.kind : "any", daily: i };
    this.traveling = true;
    this.fails = 0;
    this.stuckT = 0;
    this.hasWp = false;
    if (walled) this.ctx.think("auto-wall", t("경지 {n}이 모자라다… 오늘의 의뢰로 먼저 강해지자.", { n: mainWall(p) }));
    this.ctx.changed();
    return null;
  }

  /**
   * 자동 진행 on the open 서브 퀘스트: hunt its targets in its field; when done, hand it in and go on (the next 서브
   * one while 본편 is walled, else back to 본편).
   */
  startSub(walled = false): string | null {
    const p = this.ctx.profile();
    const s = subStatus(p);
    if (!s) return t("지금은 맡을 서브 의뢰가 없다.");
    this.stop();
    this.progress = true;
    this.sub = true;
    if (s.done) { void this.ctx.claimSub().then(() => this.carryOn()); this.ctx.changed(); return null; }
    const g = s.q.goal;
    this.goal = { kind: "hunt", zone: g.type === "kill" && g.zone ? g.zone : this.ctx.zone().id, monster: g.type === "kill" ? g.kind : "any", sub: true };
    this.traveling = true;
    this.fails = 0;
    this.stuckT = 0;
    this.hasWp = false;
    if (walled) this.ctx.think("auto-wall", t("경지 {n}이 모자라다… 서브 의뢰로 더 강해지자.", { n: mainWall(p) }));
    this.ctx.changed();
    return null;
  }

  /** After a conversation or an arrival: on to the next goal while 자동 진행 is on. */
  private carryOn(): void {
    if (!this.progress) return;
    const p = this.ctx.profile();
    // walled main quest: today's quests while there are any, then the 서브 퀘스트 round and round
    if (mainWall(p)) {
      const next = nextDaily(p, this.daily);
      if (next >= 0) { this.startDaily(next, true); return; }
      this.startSub(true);
      return;
    }
    // a daily or 서브 one chosen by hand is done: back to 본편
    if (this.daily >= 0 || this.sub) { this.daily = -1; this.sub = false; }
    const why = this.startTravel();
    if (!why) return;
    // nothing to walk to (e.g. "level up first"): keep hunting where we are, if this is a field
    if (!this.ctx.zone().safe) {
      if (!this.on) this.toggle();
      this.ctx.think("auto-why", why);
      return;
    }
    this.stop();
    this.ctx.think("auto-why", why);
  }

  /* ---------- auto-quest travel ---------- */
  /** Walk to the current main quest's objective. Returns a reason when it can't. */
  startTravel(): string | null {
    const p = this.ctx.profile();
    const s = mainStatus(p);
    if (!s) return t("이어지는 의뢰가 없다.");
    const q = s.q;
    let goal: Goal | null = null;
    const npcGoal = (id: string): Goal | null => {
      for (const z of Object.values(ZONES)) {
        const npc = z.npcs.find((n) => n.id === id);
        if (npc) return { kind: "npc", zone: z.id, npc };
      }
      return null;
    };
    if (!s.accepted) goal = npcGoal(q.giver);
    else if (s.done || readyByTalk(s)) goal = npcGoal(q.turnIn);
    else if (q.goal.type === "kill") {
      const kind = q.goal.kind;
      const zone = q.goal.zone ?? Object.values(ZONES).find((z) => z.spawns.some((sp) => sp.kind === kind))?.id;
      if (zone) goal = { kind: "hunt", zone, monster: kind };
    } else if (q.goal.type === "reach") goal = { kind: "zone", zone: q.goal.zone };
    else if (q.goal.type === "talk") goal = npcGoal(q.goal.npc);
    else if (q.goal.type === "dye") goal = npcGoal("dyer");
    else if (q.goal.type === "level") return t("더 강해져야 한다… 사냥하며 경지를 올리자.");
    if (!goal) return t("어디로 가야 할지 모르겠다.");
    this.goal = goal;
    this.traveling = true;
    this.fails = 0;
    this.stuckT = 0;
    this.hasWp = false;
    this.ctx.changed();
    return null;
  }

  /** Shortest chain of gates from one zone to another (BFS over ZONES portals); returns the first hop. */
  private nextHop(from: string, to: string): string | null {
    if (from === to) return null;
    const prev = new Map<string, string>([[from, ""]]);
    const queue = [from];
    while (queue.length) {
      const z = queue.shift() as string;
      for (const p of ZONES[z]?.portals ?? []) {
        if (prev.has(p.to)) continue;
        prev.set(p.to, z);
        if (p.to === to) {
          let step = to;
          while (prev.get(step) !== from) step = prev.get(step) as string;
          return step;
        }
        queue.push(p.to);
      }
    }
    return null;
  }

  /* ---------- decisions (~5 Hz) ---------- */
  decide(dt: number): void {
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.2;
    if (!this.ctx.canAct() || this.ctx.paused() || this.busy) return;
    const zone = this.ctx.zone();
    const pl = this.ctx.player();
    if (this.traveling && this.goal) this.decideTravel(zone, pl);
    if (this.on) this.decideBattle(pl);
  }

  private decideTravel(zone: ZoneDef, pl: Actor): void {
    const g = this.goal as Goal;
    if (zone.id !== g.zone) {
      const hop = this.nextHop(zone.id, g.zone);
      const gate = hop ? zone.portals.find((p) => p.to === hop) : null;
      if (!gate) { this.giveUp(t("길을 모르겠다…")); return; }
      if (this.clearVines(pl, gate.x, gate.z)) return;
      this.setWp(gate.x, gate.z);
      this.gateTo = gate.to;
      // walk right up to the gate's centre (well inside the server's reach) before asking to cross;
      // if the server hasn't seen us there yet (too_far), keep walking and ask again shortly
      if (Math.hypot(gate.x - pl.x, gate.z - pl.z) < PORTAL_REACH - 0.8 && performance.now() > this.gateRetryAt) {
        this.busy = true;
        void this.ctx.travel(gate.to, zone.id).then((ok) => { if (!ok) this.gateRetryAt = performance.now() + 500; }).finally(() => { this.busy = false; });
      }
      return;
    }
    this.gateTo = "";
    if (g.kind === "npc") {
      const d = Math.hypot(g.npc.x - pl.x, g.npc.z - pl.z);
      if (d < NPC_REACH - 1.2) {
        // the field does not pause for a conversation: deal with whatever is on us first
        if (!zone.safe && this.threatNear(pl)) { this.hasWp = false; this.decideBattle(pl); return; }
        // arrived: the conversation takes over; travel ends here
        this.traveling = false;
        this.goal = null;
        this.hasWp = false;
        this.arrow.visible = false;
        this.ctx.changed();
        // 자동 진행: once the talk (and any accept / hand-in) is over, head for the next goal
        void this.ctx.talk(g.npc).then(() => { window.setTimeout(() => this.carryOn(), 400); });
        return;
      }
      this.setWp(g.npc.x, g.npc.z + 1.6);
    } else if (g.kind === "zone") {
      this.traveling = false;
      this.goal = null;
      this.hasWp = false;
      this.arrow.visible = false;
      this.ctx.changed();
      this.carryOn();
    } else {
      // a 서브 퀘스트's hunt: until its count is met, then hand it in and go on
      if (g.sub) {
        const s = subStatus(this.ctx.profile());
        if (!s || s.done) {
          this.on = false;
          this.traveling = false;
          this.goal = null;
          this.ctx.changed();
          this.busy = true;
          void this.ctx.claimSub().finally(() => { this.busy = false; this.carryOn(); });
          return;
        }
        if (!this.on) { this.on = true; this.anchorX = 0; this.anchorZ = 0; this.ctx.changed(); }
        this.hasWp = false;
        return;
      }
      // a daily quest's hunt: until its count is met, then collect it and go on
      if (g.daily !== undefined) {
        const d = dailyStatus(this.ctx.profile(), g.daily);
        if (d.done || d.claimed) {
          this.on = false;
          this.traveling = false;
          this.goal = null;
          this.ctx.changed();
          this.busy = true;
          void this.ctx.claimDailies().finally(() => { this.busy = false; this.carryOn(); });
          return;
        }
        if (!this.on) { this.on = true; this.anchorX = 0; this.anchorZ = 0; this.ctx.changed(); }
        this.hasWp = false;
        return;
      }
      // hunt: once inside, auto-battle around the middle of the field with quest targets first
      const s = mainStatus(this.ctx.profile());
      if (!s || !s.accepted || s.done) {
        this.on = false;
        this.traveling = false;
        this.goal = null;
        this.ctx.changed();
        if (s?.done) this.startTravel();
        return;
      }
      if (!this.on) {
        this.on = true;
        this.anchorX = 0;
        this.anchorZ = 0;
        this.settings.questFirst = true;
        this.ctx.changed();
      }
      this.hasWp = false;
    }
  }

  /** Something hostile is awake and close (no allocation). */
  private threatNear(pl: Actor): boolean {
    for (const v of this.ctx.monsters().values()) {
      if (v.mode === "dead" || v.mode === "idle" || v.def.skillOnly) continue;
      if (Math.hypot(v.x - pl.x, v.z - pl.z) < 8) return true;
    }
    return false;
  }

  private decideBattle(pl: Actor): void {
    const p = this.ctx.profile();
    // potions: the game drinks them (물약 자동 사용, any hunting play), not the driver
    // a daily hunt goes after its own targets (먹그림자 for 먹그림자 퇴치); else the main quest's
    const dk = this.goal?.kind === "hunt" && (this.goal.daily !== undefined || this.goal.sub) ? this.goal.monster : null;
    const questKind = dk && dk !== "skill" && dk !== "any" ? dk : this.settings.questFirst ? questKill(p) : null;
    let best: MView | null = null, bestScore = 1e9;
    for (const v of this.ctx.monsters().values()) {
      if (!targetable(v) || v.def.skillOnly) continue;
      const fromAnchor = Math.hypot(v.x - this.anchorX, v.z - this.anchorZ);
      const d = Math.hypot(v.x - pl.x, v.z - pl.z);
      const engaged = attackingMe(v, pl.x, pl.z) || (v.mode !== "idle" && d < 7);
      // the quest's own monster is sought out wherever it stands in the field (그림자 무사 keeps its camp far
      // from the middle); everything else only near the hunting spot
      const wanted = !!questKind && questKind !== "any" && v.kind === questKind;
      if (!engaged && !wanted && fromAnchor > RANGE) continue;
      let score = d;
      if (engaged) score -= 100;
      else if (wanted) score -= 60;
      else if (questKind === "any") score -= 30;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    this.target = best;
    // hunting where the quest monster is: the spot moves there, so after a kill it doesn't walk back to the middle
    if (best && questKind && best.kind === questKind && Math.hypot(best.x - this.anchorX, best.z - this.anchorZ) > RANGE) {
      this.anchorX = best.x;
      this.anchorZ = best.z;
    }
    if (!best) {
      if (Math.hypot(this.anchorX - pl.x, this.anchorZ - pl.z) > 1.5) this.setWp(this.anchorX, this.anchorZ);
      else this.hasWp = false;
      return;
    }
    const d = Math.hypot(best.x - pl.x, best.z - pl.z) - best.def.radius;
    if (d > MELEE) this.setWp(best.x, best.z);
    else this.hasWp = false;
    // skills in the player's order, one per decision
    this.fireSkill(pl, d);
  }

  /**
   * 먹덩굴 between us and (tx, tz): walk up to it and let 화염선풍 burn it. Without the technique (below Lv 4 or
   * switched off) travel stops with the gate-3 thought instead of looping. Returns true while it is handling one.
   */
  private clearVines(pl: Actor, tx: number, tz: number): boolean {
    let dx = tx - pl.x, dz = tz - pl.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let block: MView | null = null, ahead = 1e9;
    for (const v of this.ctx.monsters().values()) {
      if (v.mode === "dead" || !isObstacle(v.def)) continue;
      const rx = v.x - pl.x, rz = v.z - pl.z;
      const along = rx * dx + rz * dz;
      if (along < -1 || along > len + v.def.radius) continue;
      const side = Math.abs(rx * -dz + rz * dx);
      if (side > v.def.radius + 1.2 || along > 9) continue;
      if (along < ahead) { ahead = along; block = v; }
    }
    if (!block) return false;
    const weak = block.def.weakTo ?? [];
    const canBurn = weak.some((i) => this.settings.skills[i] && this.ctx.profile().level >= SKILLS[i].unlock);
    if (!canBurn) { this.giveUp(t("불이라도 있으면… 바람이에게 가 보자.")); return true; }
    const d = Math.hypot(block.x - pl.x, block.z - pl.z) - block.def.radius;
    this.target = block;
    if (d > 2.6) this.setWp(block.x - dx * (block.def.radius + 2), block.z - dz * (block.def.radius + 2));
    else {
      this.hasWp = false;
      this.fireSkill(pl, d, weak); // 화염선풍's targeting takes the vine when nothing else is in reach
    }
    return true;
  }

  private setWp(x: number, z: number): void {
    if (!this.hasWp || Math.abs(x - this.wpX) > 0.3 || Math.abs(z - this.wpZ) > 0.3) { this.stuckT = 0; }
    this.wpX = x;
    this.wpZ = z;
    this.hasWp = true;
  }

  private giveUp(text: string): void {
    this.stop();
    this.ctx.think("auto-stuck", text);
  }

  /* ---------- steering (per frame, no allocation) ---------- */
  /** Writes the stick for this frame; returns true if it drove. */
  steer(dt: number): boolean {
    const pl = this.ctx.player();
    const inp = pl.input;
    if (!this.active()) { this.arrow.visible = false; return false; }
    // attack the target when in reach
    if (this.on && this.target && !this.hasWp) {
      const t = this.target;
      const d = Math.hypot(t.x - pl.x, t.z - pl.z) - t.def.radius;
      if (d <= MELEE + 0.3) inp.atk = BUF;
    }
    if (!this.hasWp) { inp.mx = 0; inp.mz = 0; this.arrow.visible = false; return true; }
    let dx = this.wpX - pl.x, dz = this.wpZ - pl.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist; dz /= dist;
    // keep clear of gates unless one is the way
    const zone = this.ctx.zone();
    for (const g of zone.portals) {
      if (g.to === this.gateTo) continue;
      const ex = pl.x - g.x, ez = pl.z - g.z, ed = Math.hypot(ex, ez);
      if (ed < PORTAL_REACH + 2.5 && ed > 1e-3) { const k = (PORTAL_REACH + 2.5 - ed) / (PORTAL_REACH + 2.5) * 2; dx += (ex / ed) * k; dz += (ez / ed) * k; }
    }
    // slide around props ahead
    for (const c of pl.field.colliders) {
      const cx = c.x - pl.x, cz = c.z - pl.z;
      const ahead = cx * dx + cz * dz;
      if (ahead < 0 || ahead > 2.5) continue;
      const side = cx * -dz + cz * dx;
      if (Math.abs(side) < c.r + 0.6) {
        const s = side > 0 ? -1 : 1, px = -dz, pz = dx;
        dx += px * s * 0.9;
        dz += pz * s * 0.9;
      }
    }
    // stuck: sidestep, then give up after three tries
    this.stuckT += dt;
    if (this.sideT > 0) {
      this.sideT -= dt;
      const px = -dz, pz = dx;
      dx += px * this.sideSign * 1.5;
      dz += pz * this.sideSign * 1.5;
    }
    if (this.stuckT > 2) {
      if (Math.hypot(pl.x - this.stuckX, pl.z - this.stuckZ) < 0.5 && dist > 1) {
        this.fails++;
        if (this.fails >= 3) { this.giveUp(t("길이 막혔다…")); return false; }
        this.sideT = 0.8;
        this.sideSign = Math.random() < 0.5 ? -1 : 1;
      } else this.fails = 0;
      this.stuckT = 0;
      this.stuckX = pl.x;
      this.stuckZ = pl.z;
    }
    const l = Math.hypot(dx, dz) || 1;
    const slow = this.on && !this.traveling && dist < 1.2 ? 0.5 : 1;
    inp.mx = (dx / l) * slow;
    inp.mz = (dz / l) * slow;
    // the arrow points at the waypoint while travelling
    if (this.traveling) {
      this.arrow.visible = true;
      this.arrow.position.set(pl.x + (dx / l) * 1.3, 0.1, pl.z + (dz / l) * 1.3);
      this.arrow.rotation.set(0, Math.atan2(-dx, -dz), 0);
    } else this.arrow.visible = false;
    return true;
  }
}

/** The monster kind the current main quest wants killed, if any. */
function questKill(p: ProfileView): string | null {
  const q = MAIN_QUESTS[p.main];
  if (!q || !p.mainAccepted || q.goal.type !== "kill") return null;
  return q.goal.kind;
}

/**
 * Where to hunt `kind` ("any" / "skill": anything): the field you are in if it suits your 경지, else the field
 * whose range fits best (the highest one you have reached the floor of).
 */
function huntZone(kind: string, level: number, here: ZoneDef): string | null {
  const has = (z: ZoneDef) => kind === "any" || kind === "skill" ? z.spawns.length > 0 : z.spawns.some((sp) => sp.kind === kind);
  const fits = (z: ZoneDef) => !z.safe && has(z) && level >= z.levels[0] && level <= z.levels[1] + 2;
  if (fits(here)) return here.id;
  let best: ZoneDef | null = null;
  for (const z of Object.values(ZONES)) {
    if (z.safe || !has(z)) continue;
    if (level >= z.levels[0] && (!best || z.levels[0] > best.levels[0])) best = z;
  }
  if (!best) for (const z of Object.values(ZONES)) if (!z.safe && has(z) && (!best || z.levels[0] < best.levels[0])) best = z;
  return best?.id ?? null;
}
