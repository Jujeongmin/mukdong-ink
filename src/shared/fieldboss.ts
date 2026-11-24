// 필드 보스 「떠도는 먹구름」: the multiplayer moment of the field. On the KST clock, every FB_EVERY_MS, it comes
// down in one hunting field (the same field in every channel, rotating through 1장 and 2장 by turns), at that
// field's fixed open spot, and stays FB_UP_MS or until it is felled. Everyone in the channel fights it together;
// whoever did a share of it is paid when it falls, FB_DAILY times a KST day. Pure: the server decides with it,
// the client reads the same clock to tell you where it is.

import { MONSTERS, expToNext, monsterHp } from "./combat";
import { CHANNEL_CAPACITY, ZONES } from "./world";

export const FIELD_BOSS = "inkcloud";
/** its id in a room's monsters (one at a time per room) */
export const FIELD_BOSS_ID = "fboss";
export const FB_EVERY_MS = 20 * 60_000;
export const FB_UP_MS = 8 * 60_000;
const KST_MS = 9 * 3600_000;
/**
 * The fields it comes to, window by window: 1장 and 2장 by turns, so each chapter's players have one every 40
 * minutes. 72 windows a day is a multiple of 6: the same field at the same KST hour every day (00:00 죽림).
 */
export const FB_ROTATION: readonly string[] = ["bamboo", "kiln", "pond", "temple", "peak", "kiln"];
/**
 * Where it comes down in each field: open ground, clear of the gates (and where they let you out), the quest
 * NPCs' safe circles, the fixed spawns and the chapter boss's reach (tests/fieldboss checks).
 */
export const FB_SPOTS: Readonly<Record<string, { x: number; z: number }>> = {
  bamboo: { x: 12, z: -6 },
  pond: { x: -9, z: -7 },
  peak: { x: -17, z: 9 },
  kiln: { x: 6, z: 4 },
  temple: { x: 9, z: 5 },
};
/** field boss rewards a player can take a KST day */
export const FB_DAILY = 3;
/** a share of its life (or this many blows) earns a reward */
export const FB_SHARE = 0.03;
export const FB_MIN_HITS = 8;
/** each player in the room when it comes adds this much of its base life */
export const FB_HP_PER_PLAYER = 0.7;
/** felled, it lies (and the room keeps who was paid what) this long before it is cleared away */
export const FB_LINGER_MS = 15_000;
/** contributions kept per room (the room holds CHANNEL_CAPACITY; a few more for those who came and went) */
export const FB_HITTERS = 30;
/** a shard of color drops for each one paid with this chance */
export const FB_SHARD_CHANCE = 0.25;

export interface FieldBossWindow {
  /** the same in every channel: a room spawns it once per id */
  id: string;
  zone: string;
  start: number;
  end: number;
  level: number;
  x: number;
  z: number;
}

/** Its level in a field: the top of the field's band. */
export function fieldBossLevel(zone: string): number {
  return ZONES[zone]?.levels[1] ?? 1;
}

/** The window `now` falls in (it may be over already: up only between start and end). */
export function fieldBossWindow(now: number): FieldBossWindow {
  const k = Math.floor((now + KST_MS) / FB_EVERY_MS);
  const n = FB_ROTATION.length;
  const zone = FB_ROTATION[((k % n) + n) % n];
  const start = k * FB_EVERY_MS - KST_MS;
  const at = FB_SPOTS[zone];
  return { id: `fb${k}`, zone, start, end: start + FB_UP_MS, level: fieldBossLevel(zone), x: at.x, z: at.z };
}

export function fieldBossUp(w: FieldBossWindow, now: number): boolean {
  return now >= w.start && now < w.end;
}

/** The one up now, else the next to come. */
export function nextFieldBoss(now: number): FieldBossWindow {
  const w = fieldBossWindow(now);
  return now < w.end ? w : fieldBossWindow(w.start + FB_EVERY_MS);
}

/** Whether a field's field boss is worth telling a player of this level about (around the field's band). */
export function fieldBossFits(zone: string, level: number): boolean {
  const z = ZONES[zone];
  return !!z && level >= z.levels[0] - 2 && level <= z.levels[1] + 6;
}

/** Its life, by level and by how many stand in the room when it comes. */
export function fieldBossHp(level: number, players: number): number {
  const n = Math.max(1, Math.min(CHANNEL_CAPACITY, Math.floor(players)));
  return Math.round(monsterHp(MONSTERS[FIELD_BOSS], level) * (1 + FB_HP_PER_PLAYER * (n - 1)));
}

/** One player's part in a fight: damage dealt and blows landed. */
export interface FbHit {
  d: number;
  n: number;
}

/** A field boss as a room keeps it beside the monster row: small, cleared once it is over. */
export interface FbState {
  /** the window (or a local test's id) it came for */
  win: string;
  zone: string;
  /** server ms it leaves */
  end: number;
  /** each account's part, until it falls (then cleared) */
  hits: Record<string, FbHit>;
  /** felled at (0: still up, or gone unfelled) */
  dead: number;
  /** it is over (felled and cleared, or gone): the room waits for the next window */
  done: boolean;
  /** after the fall: who was paid what (null: today's FB_DAILY already taken) */
  paid?: Record<string, FbReward | null>;
}

/** Whether `p` did enough of it to be paid. */
export function earned(p: FbHit | undefined, maxHp: number): boolean {
  return !!p && (p.d >= maxHp * FB_SHARE || p.n >= FB_MIN_HITS);
}

/** The accounts paid when it falls, in the order they joined the fight. */
export function fieldBossEarners(hits: Record<string, FbHit>, maxHp: number): string[] {
  return Object.keys(hits).filter((a) => earned(hits[a], maxHp));
}

export interface FbReward {
  exp: number;
  pigment: number;
  stones: number;
  jade: number;
  shards: number;
}

/** One player's reward for a field boss of `level`: a quarter of that level's experience, pigment, stones, a little jade. */
export function fieldBossReward(level: number, rand: () => number): FbReward {
  return {
    exp: Math.round(expToNext(level) * 0.25),
    pigment: 40 + level * 6,
    stones: 2 + Math.floor(level / 8),
    jade: 10,
    shards: rand() < FB_SHARD_CHANCE ? 1 : 0,
  };
}

/** A contribution added up (the room's table stays at FB_HITTERS accounts). */
export function addHit(hits: Record<string, FbHit>, account: string, dmg: number): void {
  const cur = hits[account];
  if (cur) { cur.d += dmg; cur.n += 1; return; }
  if (Object.keys(hits).length >= FB_HITTERS) return;
  hits[account] = { d: dmg, n: 1 };
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function readReward(raw: unknown): FbReward | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return { exp: num(r.exp), pigment: num(r.pigment), stones: num(r.stones), jade: num(r.jade), shards: num(r.shards) };
}

/** A room's field boss state as stored, each field checked; null when there is none. */
export function readFb(raw: unknown): FbState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.win !== "string" || typeof r.zone !== "string") return null;
  const hits: Record<string, FbHit> = {};
  if (r.hits && typeof r.hits === "object") {
    for (const [a, v] of Object.entries(r.hits as Record<string, unknown>).slice(0, FB_HITTERS)) {
      const h = v as Record<string, unknown> | null;
      if (h && typeof h === "object") hits[a] = { d: num(h.d), n: num(h.n) };
    }
  }
  const out: FbState = { win: r.win, zone: r.zone, end: num(r.end), hits, dead: num(r.dead), done: r.done === true };
  if (r.paid && typeof r.paid === "object") {
    const paid: Record<string, FbReward | null> = {};
    for (const [a, v] of Object.entries(r.paid as Record<string, unknown>).slice(0, FB_HITTERS)) paid[a] = readReward(v);
    out.paid = paid;
  }
  return out;
}
