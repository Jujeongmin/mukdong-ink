// A player's saved profile: reading it back tolerantly, the numbers derived from it, and the pure rules
// that change it (experience and levels, quest progress, the daily reset). Shared by the server, which
// owns the profile, and the client, which shows the copy the server pushes.

import type { ProfileView } from "../net/api";
import { MAX_LEVEL, MONSTERS, SKILLS, attackFor, expToNext, isObstacle, maxHpFor } from "./combat";
import { ENHANCE_MAX, SKILL_MAX, enhancedAtk, pointsEarned, pointsSpent } from "./growth";
import { BOOK, bookAfter, bookBonus } from "./book";
import { ITEM, STARTER_DYE, STARTER_EQUIP, STARTER_OWNED, hatHpBonus, sashCdCut } from "./items";
import { type Look, type Profile, type SlotId, today } from "./types";
import { AD_DAILY, DAILY_QUESTS, MAIN_QUESTS, START_ZONE, SUB_QUESTS, ZONES, type QuestDef } from "./world";

export const STARTER_POTIONS = 3;
/**
 * Version of MAIN_QUESTS that `Profile.main` indexes. 2 (2026-11-17): the two 단이 intro quests (c1q1, c1q2)
 * were removed, so older saves move their index down by two (0 and 1 become 0, the new first quest).
 */
export const QUEST_VERSION = 2;
const REMOVED_INTRO_QUESTS = 2;
export const MAX_POTIONS = 99;
const SLOTS: SlotId[] = ["weapon", "hat", "sash"];

export function starterProfile(name: string, now: number): Profile {
  return {
    name, level: 1, exp: 0, hp: maxHpFor(1), potions: STARTER_POTIONS, pigment: 0, jade: 0,
    owned: [...STARTER_OWNED], equip: { ...STARTER_EQUIP }, dye: { ...STARTER_DYE }, pity: 0,
    created: false, skills: SKILLS.map(() => 1), bonusPoints: 0, stones: 0, shards: 0, protects: 0, enh: {},
    main: 0, qv: QUEST_VERSION, mainAccepted: false, mainProgress: 0, daily: emptyDaily(now), sub: { id: "", prog: 0 }, book: {}, adsDay: today(now), adsLeft: AD_DAILY,
    zone: START_ZONE, channel: 1, createdAt: now,
  };
}

function emptyDaily(now: number): Profile["daily"] {
  return { day: today(now), progress: DAILY_QUESTS.map(() => 0), claimed: DAILY_QUESTS.map(() => false) };
}

const int = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;

function dyeOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : null;
}

function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  // A store may hand an array back as an object keyed by index.
  if (raw && typeof raw === "object") return Object.values(raw as Record<string, unknown>);
  return [];
}

/** A profile as saved, with every field checked; null when there is none. */
export function readProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string") return null;
  const owned = [...new Set(listOf(r.owned).filter((id): id is string => typeof id === "string" && !!ITEM[id]))];
  for (const id of STARTER_OWNED) if (!owned.includes(id)) owned.push(id);
  const rawEquip = (r.equip && typeof r.equip === "object" ? r.equip : {}) as Record<string, unknown>;
  const equip = { ...STARTER_EQUIP };
  for (const slot of SLOTS) {
    const id = rawEquip[slot];
    if (typeof id === "string" && ITEM[id]?.slot === slot && owned.includes(id)) equip[slot] = id;
  }
  const rawDye = (r.dye && typeof r.dye === "object" ? r.dye : {}) as Record<string, unknown>;
  const rawDaily = (r.daily && typeof r.daily === "object" ? r.daily : {}) as Record<string, unknown>;
  const progress = listOf(rawDaily.progress);
  const claimed = listOf(rawDaily.claimed);
  const level = int(r.level, 1, 1, MAX_LEVEL);
  // A save from before QUEST_VERSION 2 points into the old list, which began with the two intro quests.
  const oldMain = int(r.main, 0, 0);
  const migrate = r.qv !== QUEST_VERSION;
  const wasIntro = migrate && oldMain < REMOVED_INTRO_QUESTS;
  const main = Math.min(MAIN_QUESTS.length, migrate ? Math.max(0, oldMain - REMOVED_INTRO_QUESTS) : oldMain);
  const rawSkills = listOf(r.skills);
  const rawEnh = (r.enh && typeof r.enh === "object" && !Array.isArray(r.enh) ? r.enh : {}) as Record<string, unknown>;
  const enh: Record<string, number> = {};
  for (const id of owned) {
    const plus = int(rawEnh[id], 0, 0, ENHANCE_MAX);
    if (ITEM[id].slot === "weapon" && plus > 0) enh[id] = plus;
  }
  return {
    name: r.name,
    level,
    exp: int(r.exp, 0),
    hp: int(r.hp, maxHpFor(level), 0, maxHpOf({ level, equip, book: readBook(r.book) })),
    potions: int(r.potions, 0, 0, MAX_POTIONS),
    pigment: int(r.pigment, 0),
    jade: int(r.jade, 0),
    owned,
    equip,
    dye: { sash: dyeOf(rawDye.sash), scarf: dyeOf(rawDye.scarf) },
    pity: int(r.pity, 0),
    created: r.created === true,
    skills: SKILLS.map((_, i) => int(rawSkills[i], 1, 1, SKILL_MAX)),
    bonusPoints: int(r.bonusPoints, 0),
    stones: int(r.stones, 0),
    shards: int(r.shards, 0),
    protects: int(r.protects, 0),
    enh,
    main,
    qv: QUEST_VERSION,
    // On an intro quest that no longer exists, the new first quest starts fresh.
    mainAccepted: !wasIntro && r.mainAccepted === true,
    mainProgress: wasIntro ? 0 : int(r.mainProgress, 0),
    daily: {
      day: typeof rawDaily.day === "string" ? rawDaily.day : "",
      progress: DAILY_QUESTS.map((_, i) => int(progress[i], 0)),
      claimed: DAILY_QUESTS.map((_, i) => claimed[i] === true),
    },
    sub: readSub(r.sub),
    book: readBook(r.book),
    adsDay: typeof r.adsDay === "string" ? r.adsDay : "",
    adsLeft: int(r.adsLeft, AD_DAILY, 0, AD_DAILY),
    zone: typeof r.zone === "string" && ZONES[r.zone] ? r.zone : START_ZONE,
    channel: int(r.channel, 1, 1),
    createdAt: int(r.createdAt, 0),
  };
}

/** A new KST day: the daily quests and the rewarded-ad count start over. */
export function freshDay(p: Profile, now: number): Profile {
  const day = today(now);
  let next = p;
  if (p.daily.day !== day) next = { ...next, daily: emptyDaily(now) };
  if (p.adsDay !== day) next = { ...next, adsDay: day, adsLeft: AD_DAILY };
  return next;
}

/** Max health: the level's, raised by the hat worn and the 먹그림 도감. */
export function maxHpOf(p: Pick<Profile, "level" | "equip"> & { book?: Readonly<Record<string, number>> }): number {
  return Math.round(maxHpFor(p.level) * (1 + hatHpBonus(p.equip.hat) + bookBonus(p.book ?? {}).hp));
}

/** Attack: level and brush, raised by the 먹그림 도감. */
export function atkOf(p: Profile): number {
  return Math.round(attackFor(p.level, weaponAtk(p)) * (1 + bookBonus(p.book).atk));
}

function readBook(raw: unknown): Record<string, number> {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const book: Record<string, number> = {};
  for (const page of BOOK) {
    const n = int(r[page.kind], 0, 0, page.need[1]);
    if (n > 0) book[page.kind] = n;
  }
  return book;
}

/** Every 검법 cooldown is multiplied by this (the sash worn cuts it). */
export function cdMulOf(p: Pick<Profile, "equip">): number {
  return 1 - sashCdCut(p.equip.sash);
}

/** The equipped brush's attack, with its enhancement. */
export function weaponAtk(p: Profile): number {
  const base = ITEM[p.equip.weapon]?.atk ?? ITEM[STARTER_EQUIP.weapon].atk ?? 10;
  return enhancedAtk(base, p.enh[p.equip.weapon] ?? 0);
}

/** Training points not yet spent: one per level gained plus quest bonuses, less what skills used. */
export function pointsLeft(p: Profile): number {
  return Math.max(0, pointsEarned(p.level, p.bonusPoints) - pointsSpent(p.skills));
}

export function profileView(account: string, p: Profile): ProfileView {
  return {
    ...p, sub: settleSub(p).sub, account, maxHp: maxHpOf(p), atk: atkOf(p), expToNext: expToNext(p.level), points: pointsLeft(p),
  };
}

/** What others in the room see of you. */
export function lookOf(p: Profile): Look {
  return {
    weapon: p.equip.weapon, hat: p.equip.hat, sash: p.equip.sash, sashDye: p.dye.sash, scarfDye: p.dye.scarf,
    plus: p.enh[p.equip.weapon] ?? 0, skills: [...p.skills],
  };
}

/** Experience gained, with every level it brings: each new level raises max HP and heals to full. */
export function gainExp(p: Profile, exp: number): { profile: Profile; levelUp: boolean } {
  let level = p.level;
  let total = p.exp + Math.max(0, Math.floor(exp));
  let levelUp = false;
  while (level < MAX_LEVEL && total >= expToNext(level)) {
    total -= expToNext(level);
    level++;
    levelUp = true;
  }
  if (level >= MAX_LEVEL) total = 0;
  return { profile: { ...p, level, exp: total, hp: levelUp ? maxHpOf({ ...p, level }) : p.hp }, levelUp };
}

/** A quest's reward added to the profile. */
export function giveReward(p: Profile, reward: QuestDef["reward"]): { profile: Profile; levelUp: boolean } {
  const paid: Profile = {
    ...p,
    pigment: p.pigment + reward.pigment,
    jade: p.jade + (reward.jade ?? 0),
    potions: Math.min(MAX_POTIONS, p.potions + (reward.potions ?? 0)),
    stones: p.stones + (reward.stones ?? 0),
    shards: p.shards + (reward.shards ?? 0),
    protects: p.protects + (reward.protects ?? 0),
    bonusPoints: p.bonusPoints + (reward.points ?? 0),
  };
  return gainExp(paid, reward.exp);
}

export interface Felled {
  kind: string;
  zone: string;
}

/** Kills counted toward the current main quest and the daily ones. */
export function countKills(p: Profile, felled: Felled[]): Profile {
  if (felled.length === 0) return p;
  // "Any" kills are monsters, not the vines burnt out of the way.
  const counts = (kind: string, want: string) => (want === "any" ? !isObstacle(MONSTERS[kind]) : kind === want);
  let mainProgress = p.mainProgress;
  const goal = p.mainAccepted ? MAIN_QUESTS[p.main]?.goal : undefined;
  if (goal && goal.type === "kill") {
    const n = felled.filter((f) => counts(f.kind, goal.kind) && (!goal.zone || f.zone === goal.zone)).length;
    mainProgress = Math.min(goal.count, mainProgress + n);
  }
  const progress = p.daily.progress.map((value, i) => {
    const g = DAILY_QUESTS[i].goal;
    if (g.type !== "kill" || g.kind === "skill") return value;
    const n = felled.filter((f) => counts(f.kind, g.kind) && (!g.zone || f.zone === g.zone)).length;
    return Math.min(g.count, value + n);
  });
  // the open 서브 퀘스트 (settled to one that suits your 경지 if it hasn't been started)
  const sp = settleSub(p);
  const sq = subDef(sp.sub.id);
  let sub = sp.sub;
  if (sq && sq.goal.type === "kill") {
    const g = sq.goal;
    const n = felled.filter((f) => counts(f.kind, g.kind) && (!g.zone || f.zone === g.zone)).length;
    if (n > 0) sub = { id: sub.id, prog: Math.min(g.count, sub.prog + n) };
  }
  return { ...p, mainProgress, daily: { ...p.daily, progress }, sub, book: bookAfter(p.book, felled.map((f) => f.kind)) };
}

/** One brush technique used, for the daily quest that counts them. */
export function countSkillUse(p: Profile): Profile {
  const progress = p.daily.progress.map((value, i) => {
    const g = DAILY_QUESTS[i].goal;
    return g.type === "kill" && g.kind === "skill" ? Math.min(g.count, value + 1) : value;
  });
  return { ...p, daily: { ...p.daily, progress } };
}

/** Progress for goals that happen once (talk, reach, dye) on the current main quest. */
export function markMain(p: Profile, happened: { type: "talk"; npc: string } | { type: "reach"; zone: string } | { type: "dye" }): Profile {
  const goal = p.mainAccepted ? MAIN_QUESTS[p.main]?.goal : undefined;
  if (!goal || goal.type !== happened.type) return p;
  if (goal.type === "talk" && happened.type === "talk" && goal.npc !== happened.npc) return p;
  if (goal.type === "reach" && happened.type === "reach" && goal.zone !== happened.zone) return p;
  return { ...p, mainProgress: 1 };
}

/** Whether the current main quest's goal is met (some goals are read off the profile itself). */
export function mainDone(p: Profile): boolean {
  const q = MAIN_QUESTS[p.main];
  if (!q || !p.mainAccepted) return false;
  const g = q.goal;
  switch (g.type) {
    case "kill":
      return p.mainProgress >= g.count;
    case "level":
      return p.level >= g.level;
    case "equip":
      return p.equip[g.slot] !== g.notId;
    case "reach":
      return p.mainProgress >= 1 || p.zone === g.zone;
    default:
      return p.mainProgress >= 1;
  }
}

export function dailyDone(p: Profile, index: number): boolean {
  const q = DAILY_QUESTS[index];
  if (!q || q.goal.type !== "kill") return false;
  return p.daily.progress[index] >= q.goal.count;
}

/* ---------- 서브 퀘스트 (지역 의뢰) ---------- */
function readSub(raw: unknown): Profile["sub"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" && SUB_QUESTS.some((q) => q.id === r.id) ? r.id : "";
  return { id, prog: id ? int(r.prog, 0) : 0 };
}

export function subDef(id: string): (QuestDef & { zone: string }) | undefined {
  return SUB_QUESTS.find((q) => q.id === id);
}

/** The field whose 서브 퀘스트 suits this 경지: the highest one you have reached the floor of. */
export function subZoneFor(level: number): string {
  let best = SUB_QUESTS[0].zone;
  for (const q of SUB_QUESTS) if (level >= ZONES[q.zone].levels[0] && ZONES[q.zone].levels[0] >= ZONES[best].levels[0]) best = q.zone;
  return best;
}

/**
 * The open 서브 퀘스트, settled: one already under way stays; one not yet started moves to the field that now
 * suits your 경지 (its first quest). Pure: answers the same profile when nothing changes.
 */
export function settleSub(p: Profile): Profile {
  const cur = subDef(p.sub.id);
  const zone = subZoneFor(p.level);
  if (cur && (p.sub.prog > 0 || cur.zone === zone)) return p;
  const first = SUB_QUESTS.find((q) => q.zone === zone)!;
  return { ...p, sub: { id: first.id, prog: 0 } };
}

export function subDone(p: Profile): boolean {
  const q = subDef(p.sub.id);
  return !!q && q.goal.type === "kill" && p.sub.prog >= q.goal.count;
}

/** After one is handed in: the next of that field (round and round), or the first of a field that now suits better. */
export function nextSub(p: Profile): Profile {
  const cur = subDef(p.sub.id);
  const zone = subZoneFor(p.level);
  if (!cur || cur.zone !== zone) return settleSub({ ...p, sub: { id: "", prog: 0 } });
  const list = SUB_QUESTS.filter((q) => q.zone === zone);
  const next = list[(list.indexOf(cur) + 1) % list.length];
  return { ...p, sub: { id: next.id, prog: 0 } };
}
