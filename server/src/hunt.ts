import type { Hit, RoomEffect } from "../../src/net/api";
import {
  ARMOR_FACTOR, MONSTERS, RESPAWN_MS, armorHolds, monsterAtk, monsterHp, type HitDef, type HitShape, type MonsterDef,
} from "../../src/shared/combat";
import { REACH_SLACK, inShape } from "../../src/shared/hit";
import type { MonsterMode, MonsterState } from "../../src/shared/types";
import { ZONES, type ZoneDef } from "../../src/shared/world";

// Hunting, all decided here: a zone room's monsters live in its room state and move on every room
// tick; players' health lives in their room user state. Everything below the I/O helpers is pure, so
// the tests (and the local mode) run the same rules.

/** A monster as kept in room state: what clients draw (MonsterState) plus the AI's own few fields. */
export interface MonsterRow extends MonsterState {
  /** home spot it wanders around */
  hx: number;
  hz: number;
  /** wander goal */
  wx: number;
  wz: number;
  /** server ms its next attack is allowed */
  rd: number;
  /** account it is after ("" none) */
  tg: string;
  /** where a wound-up attack aims */
  tx: number;
  tz: number;
  /** boss only: everyone who hit it (shares the kill) */
  by?: string[];
}

/** A RoomEffect as stored: the damage it does when it lands rides along. */
export interface StoredEffect extends RoomEffect {
  dmg: number;
}

export interface Prey {
  account: string;
  x: number;
  z: number;
}

export interface Bite {
  account: string;
  dmg: number;
}

// Monsters that only walked are written (and so sent to everyone in the room) at most this often;
// anything else (a blow, a wind-up, a death, a respawn) is written at once. Between writes the walk is
// not lost: the next tick steps them on from where they were last written, by the whole time since.
export const MONSTER_SYNC_MS = 300;
// A room tick after a long pause moves monsters at most this far in time.
const MAX_STEP_MS = 1000;
// How long the strike pose shows before a monster goes back to chasing.
const ATTACK_SHOW_MS = 350;
const SHOT_SPEED = 12; // m/s
const SHOT_RADIUS = 0.9;
const SLAM_RADIUS = 3.2;
const HIT_SLACK = 0.3;
const WANDER_RANGE = 5;
const WANDER_PAUSE_MS = 2500;
const LEASH = 1.6; // a chase is given up past aggro × this
const KEEP_FROM_PORTAL = 12; // spawns stay this far from gates and arrival points, so entering is safe
const KNOCKBACK = 0.08; // metres per point of kb
const BOSS_HITTERS = 20;

const round = (n: number) => Math.round(n * 100) / 100;

export function hasMonsters(zone: string): boolean {
  const z = ZONES[zone];
  return !!z && !z.safe && (z.spawns.length > 0 || !!z.boss);
}

function facing(dx: number, dz: number, fallback: number): number {
  return dx === 0 && dz === 0 ? fallback : Math.atan2(-dz, dx);
}

/** A leashed monster stays within its leash of home. */
function leashed(def: MonsterDef, m: MonsterRow): void {
  if (!def.leash) return;
  const dx = m.x - m.hx;
  const dz = m.z - m.hz;
  const d = Math.hypot(dx, dz);
  if (d > def.leash) {
    m.x = m.hx + (dx * def.leash) / d;
    m.z = m.hz + (dz * def.leash) / d;
  }
}

function keepInside(zone: ZoneDef, m: { x: number; z: number }): void {
  const limit = zone.radius - 1;
  const d = Math.hypot(m.x, m.z);
  if (d > limit) {
    m.x = (m.x * limit) / d;
    m.z = (m.z * limit) / d;
  }
}

/** Where portals of other zones drop players into `zoneId`. */
function arrivalsInto(zoneId: string): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const z of Object.values(ZONES)) for (const p of z.portals) if (p.to === zoneId) out.push({ x: p.arriveX, z: p.arriveZ });
  return out;
}

/** A random spot inside the zone disc, away from its portals and where they let you out. */
// Random spawns (and wander goals) keep this far from the fixed ones (the vine ring, the lair), past their bodies.
export const KEEP_FROM_FIXED = 3;

/** Every fixed spawn spot of a zone, with the body radius of what stands there. */
export function fixedSpots(zone: ZoneDef): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const rule of zone.spawns) for (const at of rule.at ?? []) out.push({ x: at.x, z: at.z, r: MONSTERS[rule.kind]?.radius ?? 0 });
  return out;
}

/** Whether (x, z) keeps clear of a zone's fixed spawns. */
export function clearOfFixed(zone: ZoneDef, x: number, z: number): boolean {
  return fixedSpots(zone).every((f) => Math.hypot(x - f.x, z - f.z) >= f.r + KEEP_FROM_FIXED);
}

/** The fixed spot of monster `id` (kind + index of a rule with `at`), or null. */
export function fixedSpotOf(zone: ZoneDef, id: string): { x: number; z: number } | null {
  for (const rule of zone.spawns) {
    if (!rule.at || !id.startsWith(rule.kind)) continue;
    const i = Number(id.slice(rule.kind.length));
    if (Number.isInteger(i) && rule.at[i]) return rule.at[i];
  }
  return null;
}

export function spawnSpot(zone: ZoneDef, rand: () => number): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  for (let tries = 0; tries < 24; tries++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * zone.radius * 0.85;
    const spot = { x: round(Math.cos(a) * r), z: round(Math.sin(a) * r) };
    best = spot;
    const clear =
      zone.portals.every((p) => Math.hypot(spot.x - p.x, spot.z - p.z) >= KEEP_FROM_PORTAL) &&
      arrivalsInto(zone.id).every((p) => Math.hypot(spot.x - p.x, spot.z - p.z) >= KEEP_FROM_PORTAL) &&
      clearOfFixed(zone, spot.x, spot.z);
    if (clear) return spot;
  }
  return best;
}

function newRow(id: string, def: MonsterDef, level: number, x: number, z: number, now: number): MonsterRow {
  const hp = monsterHp(def, level);
  return {
    id, kind: def.kind, x, z, yaw: 0, hp, maxHp: hp, level, mode: "idle", since: now, hitAt: 0, deadAt: 0,
    hx: x, hz: z, wx: x, wz: z, rd: 0, tg: "", tx: x, tz: z,
  };
}

/** Every monster of a zone, freshly placed. */
export function spawnZone(zoneId: string, now: number, rand: () => number): Record<string, MonsterRow> {
  const zone = ZONES[zoneId];
  const out: Record<string, MonsterRow> = {};
  if (!zone || zone.safe) return out;
  for (const rule of zone.spawns) {
    const def = MONSTERS[rule.kind];
    if (!def) continue;
    const count = rule.at ? rule.at.length : rule.count;
    for (let i = 0; i < count; i++) {
      const level = rule.level[0] + Math.floor(rand() * (rule.level[1] - rule.level[0] + 1));
      const at = rule.at ? rule.at[i] : spawnSpot(zone, rand);
      const id = `${rule.kind}${i}`;
      out[id] = newRow(id, def, level, at.x, at.z, now);
    }
  }
  if (zone.boss && MONSTERS[zone.boss.kind]) {
    out.boss = { ...newRow("boss", MONSTERS[zone.boss.kind], zone.boss.level, zone.boss.x, zone.boss.z, now), by: [] };
  }
  return out;
}

const MODES: MonsterMode[] = ["idle", "chase", "wind", "attack", "dead"];
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The monsters as stored, each checked; a zone's missing ones (none stored yet) are spawned. */
export function readMonsters(zoneId: string, raw: unknown, now: number, rand: () => number): Record<string, MonsterRow> {
  const fresh = spawnZone(zoneId, now, rand);
  if (!raw || typeof raw !== "object") return fresh;
  const out: Record<string, MonsterRow> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = value as Record<string, unknown> | null;
    if (!m || typeof m.kind !== "string" || !MONSTERS[m.kind] || !fresh[id]) continue;
    const mode = MODES.includes(m.mode as MonsterMode) ? (m.mode as MonsterMode) : "idle";
    const row: MonsterRow = {
      id, kind: m.kind, x: num(m.x), z: num(m.z), yaw: num(m.yaw), hp: num(m.hp), maxHp: num(m.maxHp, 1), level: num(m.level, 1),
      mode, since: num(m.since), hitAt: num(m.hitAt), deadAt: num(m.deadAt), hx: num(m.hx), hz: num(m.hz), wx: num(m.wx), wz: num(m.wz),
      rd: num(m.rd), tg: typeof m.tg === "string" ? m.tg : "", tx: num(m.tx), tz: num(m.tz),
    };
    if (Array.isArray(m.by)) row.by = m.by.filter((a): a is string => typeof a === "string").slice(0, BOSS_HITTERS);
    out[id] = row;
  }
  for (const [id, m] of Object.entries(fresh)) if (!out[id]) out[id] = m;
  return out;
}

export function readEffects(raw: unknown): StoredEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredEffect[] = [];
  for (const value of raw) {
    const e = value as Record<string, unknown> | null;
    if (!e || typeof e.id !== "string" || (e.kind !== "shot" && e.kind !== "slam")) continue;
    out.push({ id: e.id, kind: e.kind, x: num(e.x), z: num(e.z), tx: num(e.tx), tz: num(e.tz), r: num(e.r), at: num(e.at), dmg: num(e.dmg) });
  }
  return out;
}

function nearest(m: MonsterRow, prey: Prey[], within: number): { p: Prey; d: number } | null {
  let best: { p: Prey; d: number } | null = null;
  for (const p of prey) {
    const d = Math.hypot(p.x - m.x, p.z - m.z);
    if (d <= within && (!best || d < best.d)) best = { p, d };
  }
  return best;
}

export interface TickOutcome {
  bites: Bite[];
  /** something other than walking changed (write at once) */
  urgent: boolean;
  /** anyone moved */
  walked: boolean;
}

/**
 * One AI step for every monster and every pending effect (changed in place). `stepMs` is the time since
 * the monsters as given were where they are.
 */
export function stepMonsters(
  zoneId: string, monsters: Record<string, MonsterRow>, effects: StoredEffect[], prey: Prey[], stepMs: number, now: number,
  rand: () => number,
): TickOutcome {
  const zone = ZONES[zoneId];
  const bites: Bite[] = [];
  let urgent = false;
  let walked = false;
  const dt = Math.min(MAX_STEP_MS, Math.max(0, stepMs)) / 1000;
  const set = (m: MonsterRow, mode: MonsterMode) => {
    m.mode = mode;
    m.since = now;
    urgent = true;
  };
  for (const m of Object.values(monsters)) {
    const def = MONSTERS[m.kind];
    if (m.mode === "dead") {
      const delay = def.boss && zone.boss ? zone.boss.respawnMs : def.respawnMs ?? RESPAWN_MS;
      if (now - m.deadAt >= delay) {
        // A fixed one stands again on its own spot.
        const at = def.boss && zone.boss ? { x: zone.boss.x, z: zone.boss.z } : fixedSpotOf(zone, m.id) ?? spawnSpot(zone, rand);
        Object.assign(m, newRow(m.id, def, m.level, at.x, at.z, now));
        if (def.boss) m.by = [];
        urgent = true;
      }
      continue;
    }
    // An obstacle only stands there.
    if (def.attack === "none") continue;
    const dmg = monsterAtk(def, m.level);
    const kept = m.tg ? prey.find((p) => p.account === m.tg) : undefined;
    const keptD = kept ? Math.hypot(kept.x - m.x, kept.z - m.z) : Infinity;
    const target = kept && keptD <= def.aggro * LEASH ? { p: kept, d: keptD } : nearest(m, prey, def.aggro);
    if (m.mode === "wind") {
      if (now - m.since < def.windMs) continue;
      if (def.attack === "melee") {
        for (const p of prey) if (Math.hypot(p.x - m.x, p.z - m.z) <= def.range + HIT_SLACK + 0.2) bites.push({ account: p.account, dmg });
      } else if (def.attack === "ranged") {
        const d = Math.hypot(m.tx - m.x, m.tz - m.z);
        effects.push({
          id: `${m.id}:${now}`, kind: "shot", x: round(m.x), z: round(m.z), tx: round(m.tx), tz: round(m.tz), r: SHOT_RADIUS,
          at: now + Math.round((d / SHOT_SPEED) * 1000), dmg,
        });
      }
      m.rd = now + def.cooldownMs;
      set(m, "attack");
      continue;
    }
    if (m.mode === "attack") {
      if (now - m.since >= ATTACK_SHOW_MS) set(m, target ? "chase" : "idle");
      continue;
    }
    if (target) {
      if (m.mode !== "chase" || m.tg !== target.p.account) {
        m.tg = target.p.account;
        set(m, "chase");
      }
      const dx = target.p.x - m.x;
      const dz = target.p.z - m.z;
      const reach = def.attack === "contact" ? def.range + def.radius * 0.5 : def.range;
      if (target.d <= reach && now >= m.rd) {
        m.yaw = round(facing(dx, dz, m.yaw));
        m.tx = round(target.p.x);
        m.tz = round(target.p.z);
        if (def.attack === "contact") {
          bites.push({ account: target.p.account, dmg });
          m.rd = now + def.cooldownMs;
          set(m, "attack");
        } else {
          if (def.attack === "slam") {
            effects.push({ id: `${m.id}:${now}`, kind: "slam", x: round(m.x), z: round(m.z), tx: m.tx, tz: m.tz, r: def.slamR ?? SLAM_RADIUS, at: now + def.windMs, dmg });
          }
          set(m, "wind");
        }
        continue;
      }
      // Close in to a little inside reach (a ranged one keeps its distance).
      const stopAt = def.attack === "ranged" ? reach * 0.75 : Math.min(reach * 0.7, def.radius + 0.4);
      const step = Math.min(def.speed * dt, target.d - stopAt);
      if (step > 0.001) {
        m.x += (dx / target.d) * step;
        m.z += (dz / target.d) * step;
        m.yaw = facing(dx, dz, m.yaw);
        keepInside(zone, m);
        leashed(def, m);
        walked = true;
      }
      continue;
    }
    if (m.mode === "chase") {
      m.tg = "";
      set(m, "idle");
    }
    // Wandering: walk to the goal, rest a while, pick another near home.
    const gx = m.wx - m.x;
    const gz = m.wz - m.z;
    const gd = Math.hypot(gx, gz);
    if (gd > 0.2) {
      const step = Math.min(def.speed * 0.35 * dt, gd);
      m.x += (gx / gd) * step;
      m.z += (gz / gd) * step;
      m.yaw = facing(gx, gz, m.yaw);
      keepInside(zone, m);
      walked = true;
    } else if (now - m.since >= WANDER_PAUSE_MS && !def.boss) {
      const a = rand() * Math.PI * 2;
      const r = rand() * Math.min(WANDER_RANGE, def.leash ?? WANDER_RANGE);
      let goal = { x: m.hx + Math.cos(a) * r, z: m.hz + Math.sin(a) * r };
      keepInside(zone, goal);
      // A roaming one does not wander into the vine ring or the lair.
      if (!fixedSpotOf(zone, m.id) && !clearOfFixed(zone, goal.x, goal.z)) goal = { x: m.hx, z: m.hz };
      m.wx = round(goal.x);
      m.wz = round(goal.z);
      m.since = now;
      urgent = true;
    }
  }
  // Shots and slams that land now hit whoever stands inside them.
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e.at > now) continue;
    for (const p of prey) if (Math.hypot(p.x - e.tx, p.z - e.tz) <= e.r + HIT_SLACK) bites.push({ account: p.account, dmg: e.dmg });
    effects.splice(i, 1);
    urgent = true;
  }
  return { bites, urgent, walked };
}

export interface Felling {
  id: string;
  kind: string;
  level: number;
  /** who shares it: the striker, or for a boss everyone who hit it */
  credit: string[];
}

/** One area a blow or technique covers: a shape swung from (x, z) facing `yaw`. */
export interface Swept {
  shape: HitShape;
  x: number;
  z: number;
  yaw: number;
}

/** Who strikes, as far as monster defenses care: a basic blow or which technique, skill levels, brush level. */
export interface Striker {
  account: string;
  /** null for a basic attack, else the SkillDef.id */
  skill: number | null;
  skills: number[];
  plus: number;
}

/** The damage factor `def` takes from `who` (1 = full; 0 = immune; ARMOR_FACTOR = armor holds). */
export function defenseFactor(def: MonsterDef, who: Striker): number {
  if (def.skillOnly && (who.skill === null || (def.weakTo && !def.weakTo.includes(who.skill)))) return 0;
  return armorHolds(def, who.skills, who.plus) ? ARMOR_FACTOR : 1;
}

/** A blow landing: every living monster inside the shape takes `damage` (by default a trained, +99 basic blow). */
export function strikeMonsters(
  monsters: Record<string, MonsterRow>, hit: HitDef, x: number, z: number, yaw: number, damage: number, now: number,
  account: string, who?: Striker,
): { hits: Hit[]; felled: Felling[] } {
  const striker = who ?? { account, skill: null, skills: [2], plus: 99 };
  return strikeAreas(monsters, [{ shape: hit.hit, x, z, yaw }], hit.kb, damage, 0, now, striker);
}

/**
 * A blow over several areas (an awakened wave fans out): each living monster inside any of them is hit
 * once for `damage`; with `echo` > 0 the ones still standing are hit a second time for echo × damage
 * (the awakened "여운", drawn by the client as a delayed pulse).
 */
export function strikeAreas(
  monsters: Record<string, MonsterRow>, areas: Swept[], kb: number, damage: number, echo: number, now: number, who: Striker,
): { hits: Hit[]; felled: Felling[] } {
  const account = who.account;
  const hits: Hit[] = [];
  const felled: Felling[] = [];
  const struck: MonsterRow[] = [];
  for (const m of Object.values(monsters)) {
    if (m.mode === "dead") continue;
    const def = MONSTERS[m.kind];
    const area = areas.find((a) => inShape(a.shape, a.x, a.z, a.yaw, m.x, m.z, def.radius, REACH_SLACK));
    if (!area) continue;
    const factor = defenseFactor(def, who);
    if (factor <= 0) {
      // Nothing to it (a vine against the brush): shown, not felt.
      hits.push({ id: m.id, dmg: 0, kill: false, resisted: true });
      continue;
    }
    land(m, damage * factor, now, account, hits, felled, factor < 1);
    if (!def.boss && def.speed > 0 && !def.leash) {
      // Knocked back along the blow.
      const dx = m.x - area.x;
      const dz = m.z - area.z;
      const d = Math.hypot(dx, dz);
      const push = kb * KNOCKBACK;
      const fx = area.shape.shape === "ring" && d > 0.01 ? dx / d : Math.cos(area.yaw);
      const fz = area.shape.shape === "ring" && d > 0.01 ? dz / d : -Math.sin(area.yaw);
      m.x = round(m.x + fx * push);
      m.z = round(m.z + fz * push);
    }
    struck.push(m);
  }
  if (echo > 0) {
    for (const m of struck) {
      if (m.mode === "dead") continue;
      const factor = defenseFactor(MONSTERS[m.kind], who);
      land(m, damage * echo * factor, now, account, hits, felled, factor < 1);
    }
  }
  return { hits, felled };
}

function land(m: MonsterRow, damage: number, now: number, account: string, hits: Hit[], felled: Felling[], resisted = false): void {
  const def = MONSTERS[m.kind];
  const dealt = Math.max(1, Math.round(damage));
  m.hp = Math.max(0, m.hp - dealt);
  m.hitAt = now;
  if (def.boss) m.by = [...new Set([...(m.by ?? []), account])].slice(0, BOSS_HITTERS);
  const kill = m.hp <= 0;
  hits.push(resisted ? { id: m.id, dmg: dealt, kill, resisted: true } : { id: m.id, dmg: dealt, kill });
  if (kill) {
    felled.push({ id: m.id, kind: m.kind, level: m.level, credit: def.boss ? [...(m.by ?? [account])] : [account] });
    m.mode = "dead";
    m.since = now;
    m.deadAt = now;
    m.tg = "";
  } else if (m.mode === "idle" || (m.mode === "chase" && !m.tg)) {
    // Struck, it turns on whoever struck it.
    m.tg = account;
    m.mode = "chase";
    m.since = now;
  }
}

export function tidy(monsters: Record<string, MonsterRow>): Record<string, MonsterRow> {
  for (const m of Object.values(monsters)) {
    m.x = round(m.x);
    m.z = round(m.z);
    m.yaw = round(m.yaw);
  }
  return monsters;
}
