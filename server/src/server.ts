import type { AttackReq, GachaResult, HitResult, ProfileView, SkillReq, ZoneEntry } from "../../src/net/api";
import {
  BASIC, BASIC_MIN_GAP, MONSTERS, POTION_COST, POTION_GAP_MS, POTION_HEAL, SKILLS, attackFor, killExp, maxHpFor, type HitDef,
} from "../../src/shared/combat";
import { forwardX, forwardZ } from "../../src/shared/hit";
import { COST1, COST10, DUPE_PIGMENT, DYES, DYE_COST, ITEM, rollGacha } from "../../src/shared/items";
import {
  MAX_POTIONS, countKills, countSkillUse, dailyDone, gainExp, giveReward, mainDone, markMain, profileView, weaponAtk, type Felled,
} from "../../src/shared/profile";
import { PROTOCOL_VERSION, RuleViolation, type Look, type Pose, type Profile } from "../../src/shared/types";
import {
  AD_REWARD_JADE, DAILY_QUESTS, DASH_BURST, JADE_PRODUCTS, MAIN_QUESTS, MAX_SPEED, MOVE_SLACK, WIND_BURST, NPC_REACH, PORTAL_REACH, START_POS, START_ZONE, ZONES,
  parseRoomId, roomIdFor,
} from "../../src/shared/world";
import { verifyAd } from "./ads";
import {
  MONSTER_SYNC_MS, hasMonsters, readEffects, readMonsters, stepMonsters, strikeMonsters, tidy, type Bite, type Felling, type Prey,
} from "./hunt";
import {
  AD_GRANTS, PURCHASES, claimName, createProfile, currentRoom, loadAssigned, loadStored, oncePer, parseName, pickChannel, releaseName,
  saveProfile, updateProfile, withNameLock, withProfileLock, withRoomLock, type Assigned,
} from "./store";

// Clients send an attack as soon as their own clock allows; this much of a cooldown is enough (jitter).
const COOLDOWN_GRACE = 0.8;
// A little reach on top of PORTAL_REACH / NPC_REACH for the pose lagging the client.
const PROXIMITY_SLACK = 0.5;
const MAX_JUMP = 8;
const MAX_POTION_BUY = 99;
const POTION_DIRECT_GAP = POTION_GAP_MS * COOLDOWN_GRACE;

// ---------- argument parsing (every argument is untrusted) ----------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

function readPose(raw: unknown): Pose | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!finite(p.x) || !finite(p.z) || !finite(p.yaw)) return null;
  const counter = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0);
  return {
    x: p.x, z: p.z, y: finite(p.y) ? Math.min(MAX_JUMP, Math.max(0, p.y)) : 0, yaw: p.yaw,
    atkSeq: counter(p.atkSeq), atkKind: intIn(p.atkKind, 0, 5) ?? 0, skillSeq: counter(p.skillSeq), skill: intIn(p.skill, 0, 4) ?? 0,
  };
}

function readSwing(raw: unknown, maxKind: number, kindKey: "kind" | "skill"): { kind: number; x: number; z: number; yaw: number } {
  if (!raw || typeof raw !== "object") throw new RuleViolation("bad_args");
  const r = raw as Record<string, unknown>;
  const kind = intIn(r[kindKey], kindKey === "kind" ? 1 : 0, maxKind);
  if (kind === null || !finite(r.x) || !finite(r.z) || !finite(r.yaw)) throw new RuleViolation("bad_args");
  return { kind, x: r.x, z: r.z, yaw: r.yaw };
}

// ---------- the caller's room user state ----------

interface Mine {
  pose: Pose | null;
  at: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  gone: boolean;
  entry: number;
  atkAt: number;
  cds: number[];
  potAt: number;
}

function readMine(state: Record<string, unknown> | null | undefined): Mine {
  const s = state ?? {};
  const cds = Array.isArray(s.cds) ? s.cds.map((v) => (finite(v) ? v : 0)) : [];
  return {
    pose: readPose(s.pose),
    at: finite(s.at) ? s.at : 0,
    hp: finite(s.hp) ? s.hp : 0,
    maxHp: finite(s.maxHp) ? s.maxHp : 1,
    dead: s.dead === true,
    gone: s.gone === true,
    entry: finite(s.entry) ? s.entry : -1,
    atkAt: finite(s.atkAt) ? s.atkAt : 0,
    cds,
    potAt: finite(s.potAt) ? s.potAt : 0,
  };
}

/** Standing in the room (arrived, not moved on). */
function present(mine: Mine): mine is Mine & { pose: Pose } {
  return !!mine.pose && !mine.gone;
}

function lookOf(p: Profile): Look {
  return { weapon: p.equip.weapon, hat: p.equip.hat, sash: p.equip.sash, sashDye: p.dye.sash, scarfDye: p.dye.scarf };
}

function standingPose(x: number, z: number): Pose {
  return { x, z, y: 0, yaw: 0, atkSeq: 0, atkKind: 0, skillSeq: 0, skill: 0 };
}

/** Extra distance a movement action earns once: a dash (atkKind 5) or the wind dash skill (3). */
function burstAllowance(prev: Pose, next: Pose | null): number {
  if (!next) return 0;
  let extra = 0;
  if (next.atkSeq !== prev.atkSeq && next.atkKind === 5) extra += DASH_BURST;
  if (next.skillSeq !== prev.skillSeq && next.skill === 3) extra += WIND_BURST;
  return extra;
}

/**
 * Where the caller may be now: the reported (x, z) held to walking pace from the last stored pose.
 * Slack is small (network jitter); dashes add their distance only on the report where the dash counter moved.
 */
function heldTo(mine: Mine & { pose: Pose }, x: number, z: number, now: number, radius: number, next: Pose | null = null): { x: number; z: number } {
  const elapsed = Math.max(0, now - mine.at);
  const most = (MAX_SPEED * elapsed) / 1000 + MOVE_SLACK + burstAllowance(mine.pose, next);
  let nx = x;
  let nz = z;
  const d = Math.hypot(nx - mine.pose.x, nz - mine.pose.z);
  if (d > most) {
    nx = mine.pose.x + ((nx - mine.pose.x) * most) / d;
    nz = mine.pose.z + ((nz - mine.pose.z) * most) / d;
  }
  const r = Math.hypot(nx, nz);
  if (r > radius) {
    nx = (nx * radius) / r;
    nz = (nz * radius) / r;
  }
  return { x: Math.round(nx * 100) / 100, z: Math.round(nz * 100) / 100 };
}

async function myProfile(account: string): Promise<Profile> {
  const p = await loadStored(account);
  if (!p) throw new RuleViolation("no_profile");
  return p;
}

async function myRoomState(): Promise<{ here: NonNullable<ReturnType<typeof currentRoom>>; mine: Mine }> {
  const here = currentRoom();
  if (!here) throw new RuleViolation("not_ready");
  return { here, mine: readMine(await $room.getMyState()) };
}

/** Changes shown to the room (look, name, level) for the caller, when it stands in one of ours. */
async function showInRoom(patch: Record<string, unknown>): Promise<void> {
  const here = currentRoom();
  if (!here) return;
  const mine = readMine(await $room.getMyState());
  if (present(mine)) await $room.updateMyState(patch, { returnState: false });
}

/** Leaves the room the caller stands in for another: the room stops drawing it at once. */
async function stepOff(): Promise<void> {
  if (!currentRoom()) return;
  await $room.updateMyState({ gone: true }, { returnState: false });
}

async function assign(account: string, zone: string, channel: number, x: number, z: number, now: number, hp?: number): Promise<ZoneEntry> {
  const roomId = roomIdFor(zone, channel);
  const assigned: Assigned = { roomId, zone, channel, x, z, at: now };
  await withProfileLock(account, async () => {
    const p = await myProfile(account);
    await saveProfile(account, { ...p, zone, channel, hp: hp ?? p.hp });
    await $global.updateUserState(account, { assigned });
  });
  return { roomId, zone, channel, x, z };
}

// ---------- rewards ----------

interface Pay {
  exp: number;
  pigment: number;
  jade: number;
  felled: Felled[];
}

/** Pays an account's share of what fell (and counts a technique use); answers whether it levelled. */
async function payOut(account: string, roomId: string, pay: Pay, skillUse: boolean): Promise<boolean> {
  const done = await withProfileLock(account, async () => {
    const p = await loadStored(account);
    if (!p) return null;
    let next = countKills({ ...p, pigment: p.pigment + pay.pigment, jade: p.jade + pay.jade }, pay.felled);
    if (skillUse) next = countSkillUse(next);
    const gained = gainExp(next, pay.exp);
    await saveProfile(account, gained.profile);
    return gained;
  });
  const levelUp = done?.levelUp ?? false;
  if (done && levelUp) {
    const level = done.profile.level;
    // A new level heals to the new, larger health, for everyone in the room to see.
    await withRoomLock(roomId, async () => {
      const [state] = await $room.getUserStates([account], ["pose", "gone"]);
      if (!state || state.gone === true || !state.pose) return;
      await $room.updateUserState(account, { level, maxHp: maxHpFor(level), hp: maxHpFor(level), dead: false }, { returnState: false });
    });
  }
  return levelUp;
}

async function reward(account: string, roomId: string, zone: string, felled: Felling[], skillUse: boolean): Promise<Omit<HitResult, "hits">> {
  const pays = new Map<string, Pay>();
  const payOf = (who: string) => {
    let pay = pays.get(who);
    if (!pay) pays.set(who, (pay = { exp: 0, pigment: 0, jade: 0, felled: [] }));
    return pay;
  };
  payOf(account);
  for (const f of felled) {
    const def = MONSTERS[f.kind];
    for (const who of f.credit) {
      const pay = payOf(who);
      pay.exp += killExp(def, f.level);
      pay.pigment += def.pigment;
      pay.jade += def.jade ?? 0;
      pay.felled.push({ kind: f.kind, zone });
    }
  }
  let mine = { exp: 0, pigment: 0, jade: 0, levelUp: false };
  for (const [who, pay] of pays) {
    const isMe = who === account;
    if (!isMe && pay.felled.length === 0) continue;
    if (isMe && pay.felled.length === 0 && !skillUse) continue;
    const levelUp = await payOut(who, roomId, pay, isMe && skillUse);
    if (isMe) mine = { exp: pay.exp, pigment: pay.pigment, jade: pay.jade, levelUp };
  }
  return mine;
}

/** A blow or technique from the caller, checked by `ready` (cooldowns, unlocks) under the room's lock. */
async function swing(
  x: number, z: number, yaw: number, hitOf: (p: Profile) => { hit: HitDef; offset: number },
  ready: (mine: Mine, p: Profile, now: number) => Record<string, unknown>, skillUse: boolean,
): Promise<HitResult> {
  const account = $sender.account;
  const here = currentRoom();
  if (!here) throw new RuleViolation("not_ready");
  const now = Date.now();
  const p = await myProfile(account);
  const struck = await withRoomLock(here.roomId, async () => {
    const mine = readMine(await $room.getMyState());
    if (!present(mine)) throw new RuleViolation("not_ready");
    if (mine.dead) throw new RuleViolation("dead");
    const patch = ready(mine, p, now);
    await $room.updateMyState(patch, { returnState: false });
    if (!hasMonsters(here.zone)) return { hits: [], felled: [] };
    const { hit, offset } = hitOf(p);
    const at = heldTo(mine, x, z, now, ZONES[here.zone].radius);
    const cx = at.x + forwardX(yaw) * offset;
    const cz = at.z + forwardZ(yaw) * offset;
    const state = await $room.getRoomState(["monsters"]);
    const monsters = readMonsters(here.zone, state.monsters, now, Math.random);
    const damage = attackFor(p.level, weaponAtk(p)) * hit.dmg;
    const result = strikeMonsters(monsters, hit, cx, cz, yaw, damage, now, account);
    if (result.hits.length > 0) {
      await $room.updateRoomState({ monsters: tidy(monsters), now, monstersAt: now }, { returnState: false });
    }
    return result;
  });
  const paid = await reward(account, here.roomId, here.zone, struck.felled, skillUse);
  return { hits: struck.hits, ...paid };
}

// ---------- the room tick ----------

async function tickRoom(zone: string, delta: number, now: number): Promise<void> {
  const state = await $room.getRoomState(["monsters", "effects", "monstersAt"]);
  const accounts: string[] = Array.isArray(state.$users) ? state.$users : [];
  if (accounts.length === 0) return;
  const monsters = readMonsters(zone, state.monsters, now, Math.random);
  const effects = readEffects(state.effects);
  const writtenAt = finite(state.monstersAt) ? state.monstersAt : null;
  const stepMs = writtenAt === null ? delta : Math.max(delta, now - writtenAt);
  const users = await $room.getUserStates(accounts, ["pose", "hp", "maxHp", "dead", "gone"]);
  const fighters = new Map<string, Mine>();
  const prey: Prey[] = [];
  for (const u of users) {
    const m = readMine(u);
    fighters.set(u.account, m);
    if (present(m) && !m.dead && m.hp > 0) prey.push({ account: u.account, x: m.pose.x, z: m.pose.z });
  }
  const out = stepMonsters(zone, monsters, effects, prey, stepMs, now, Math.random);
  await landBites(out.bites, fighters, now);
  const walkDue = out.walked && (writtenAt === null || now - writtenAt >= MONSTER_SYNC_MS);
  if (state.monsters === undefined || out.urgent || out.bites.length > 0 || walkDue) {
    await $room.updateRoomState({ monsters: tidy(monsters), effects, now, monstersAt: now }, { returnState: false });
  }
}

async function landBites(bites: Bite[], fighters: Map<string, Mine>, now: number): Promise<void> {
  const total = new Map<string, number>();
  for (const b of bites) total.set(b.account, (total.get(b.account) ?? 0) + b.dmg);
  for (const [account, dmg] of total) {
    const f = fighters.get(account);
    if (!f || f.dead) continue;
    const hp = Math.max(0, Math.round(f.hp - dmg));
    const dead = hp <= 0;
    await $room.updateUserState(account, { hp, dead, hurtAt: now }, { returnState: false });
    // The profile keeps the same health, so a reload or a portal finds it as it was.
    await withProfileLock(account, async () => {
      const p = await loadStored(account);
      if (p && p.hp !== hp) await saveProfile(account, { ...p, hp });
    });
  }
}

// ---------- receipts ----------

interface PurchaseEvent {
  account: string;
  purchaseId: number | string;
  productId: string;
  quantity: number;
}

function readPurchase(raw: unknown): PurchaseEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.account !== "string" || e.account.length === 0) return null;
  if (!(typeof e.purchaseId === "number" && Number.isFinite(e.purchaseId)) && !(typeof e.purchaseId === "string" && e.purchaseId.length > 0)) return null;
  if (typeof e.productId !== "string") return null;
  const quantity = intIn(e.quantity ?? 1, 1, 1000);
  if (quantity === null) return null;
  return { account: e.account, purchaseId: e.purchaseId, productId: e.productId, quantity };
}

/** The account's profile, made on the spot if it has none yet (bought before ever playing). */
async function ensureProfile(account: string): Promise<Profile> {
  const p = await loadStored(account);
  if (p) return p;
  const made = await createProfile(account, Math.random);
  await saveProfile(account, made);
  return made;
}

export class Server {
  // An empty-looking room (nobody calling in) still ticks once a second, so monsters keep moving.
  static $roomTickIdleMs = 1_000;

  async getServerVersion(): Promise<{ protocol: number; now: number }> {
    return { protocol: PROTOCOL_VERSION, now: Date.now() };
  }

  /** Your profile, made the first time: a "먹동이" name, the starter kit, three potions, the village. */
  async loadProfile(): Promise<ProfileView> {
    const account = $sender.account;
    const p = await withProfileLock(account, async () => {
      const stored = await loadStored(account);
      if (stored) {
        await saveProfile(account, stored);
        return stored;
      }
      const made = await createProfile(account, Math.random);
      await saveProfile(account, made);
      return made;
    });
    return profileView(account, p);
  }

  async setName(raw: unknown): Promise<ProfileView> {
    const parsed = parseName(raw);
    if (!parsed) throw new RuleViolation("bad_name");
    const account = $sender.account;
    const before = await myProfile(account);
    const oldKey = before.name.toLowerCase();
    if (oldKey === parsed.key && before.name === parsed.name) return profileView(account, before);
    if (oldKey !== parsed.key) {
      const free = await withNameLock(parsed.key, () => claimName(account, parsed.key, parsed.name));
      if (!free) throw new RuleViolation("name_taken");
    }
    const p = await updateProfile(account, (q) => ({ ...q, name: parsed.name }));
    if (oldKey !== parsed.key) await withNameLock(oldKey, () => releaseName(account, oldKey));
    await showInRoom({ name: p.name });
    return profileView(account, p);
  }

  /**
   * Into a zone: from outside our rooms (a fresh start) you always come into the village; from inside a
   * zone room only through a portal of it that leads to `zone`, standing within PORTAL_REACH of it.
   * `viaPortal`, if given, names the zone you leave from. The client then joins the room and calls arrive.
   */
  async enterZone(rawZone: unknown, viaPortal?: unknown): Promise<ZoneEntry> {
    if (typeof rawZone !== "string" || !ZONES[rawZone]) throw new RuleViolation("bad_args");
    if (viaPortal !== undefined && viaPortal !== null && typeof viaPortal !== "string") throw new RuleViolation("bad_args");
    const zone = rawZone;
    const account = $sender.account;
    const p = await myProfile(account);
    const now = Date.now();
    const here = currentRoom();
    const assigned = await loadAssigned(account);
    const mine = here ? readMine(await $room.getMyState()) : null;
    const inAssigned = !!here && !!assigned && assigned.roomId === here.roomId && !!mine && present(mine);
    if (!here || !mine || !inAssigned) {
      // A fresh start (or a room we never sent you to): the village, whole if you had fallen.
      if (here) await stepOff();
      const channel = await pickChannel(START_ZONE, account, p.channel);
      const hp = p.hp <= 0 ? maxHpFor(p.level) : p.hp;
      return assign(account, START_ZONE, channel, START_POS.x, START_POS.z, now, hp);
    }
    if (mine.dead) throw new RuleViolation("dead");
    const pose = mine.pose!;
    if (zone === here.zone) {
      // Back into the room you are in (a dropped room connection): where you stand.
      return { roomId: here.roomId, zone, channel: here.channel, x: pose.x, z: pose.z };
    }
    if (typeof viaPortal === "string" && viaPortal !== here.zone) throw new RuleViolation("wrong_room");
    const portal = ZONES[here.zone].portals.find((q) => q.to === zone);
    if (!portal) throw new RuleViolation("bad_args");
    if (Math.hypot(pose.x - portal.x, pose.z - portal.z) > PORTAL_REACH + PROXIMITY_SLACK) throw new RuleViolation("too_far");
    // You keep your channel when it has room: whoever you walked with is on the other side too.
    const channel = await pickChannel(zone, account, here.channel);
    const entry = await assign(account, zone, channel, portal.arriveX, portal.arriveZ, now, Math.round(mine.hp));
    await stepOff();
    return entry;
  }

  /** After joining the room enterZone or respawn picked: stands you there for everyone to see. */
  async arrive(): Promise<ZoneEntry> {
    const account = $sender.account;
    const here = currentRoom();
    if (!here) throw new RuleViolation("not_ready");
    const assigned = await loadAssigned(account);
    // A client can join any room; arriving in one the server did not send you to takes you nowhere.
    if (!assigned || assigned.roomId !== here.roomId) throw new RuleViolation("wrong_room");
    let p = await myProfile(account);
    const now = Date.now();
    const maxHp = maxHpFor(p.level);
    const placed = await withRoomLock(here.roomId, async () => {
      const mine = readMine(await $room.getMyState());
      // The same entry again (a reload of the room, a rejoin): as the room already has you.
      const keep = present(mine) && mine.entry === assigned.at;
      const hp = keep ? mine.hp : p.hp <= 0 ? maxHp : Math.min(maxHp, p.hp);
      const pose = keep ? mine.pose! : standingPose(assigned.x, assigned.z);
      await $room.updateMyState({
        name: p.name, level: p.level, hp, maxHp, dead: keep ? mine.dead : false, pose, look: lookOf(p), at: now,
        entry: assigned.at, gone: false, ...(keep ? {} : { atkAt: 0, cds: [], potAt: 0 }),
      });
      return { x: pose.x, z: pose.z };
    });
    const goal = MAIN_QUESTS[p.main]?.goal;
    if (goal?.type === "reach" && goal.zone === here.zone) {
      p = await updateProfile(account, (q) => markMain(q, { type: "reach", zone: here.zone }));
    }
    return { roomId: here.roomId, zone: here.zone, channel: here.channel, x: placed.x, z: placed.z };
  }

  /** Where you are: held to walking pace and the zone disc, written for everyone in the room. */
  async reportPose(raw: unknown): Promise<void> {
    const pose = readPose(raw);
    if (!pose) throw new RuleViolation("bad_args");
    const { here, mine } = await myRoomState();
    if (!present(mine)) throw new RuleViolation("not_ready");
    // The fallen stay where they fell.
    if (mine.dead) return;
    const now = Date.now();
    const at = heldTo(mine, pose.x, pose.z, now, ZONES[here.zone].radius, pose);
    await $room.updateMyState({ pose: { ...pose, x: at.x, z: at.z }, at: now }, { returnState: false });
  }

  /** A basic swing (atkKind 1..5): the server finds what it hits from where you stand. */
  async attack(raw: unknown): Promise<HitResult> {
    const parsed = readSwing(raw, 5, "kind");
    const req: AttackReq = { kind: parsed.kind, x: parsed.x, z: parsed.z, yaw: parsed.yaw };
    const def = BASIC[req.kind];
    return swing(req.x, req.z, req.yaw, () => ({ hit: def, offset: 0 }), (mine, _p, now) => {
      if (now - mine.atkAt < BASIC_MIN_GAP * 1000) throw new RuleViolation("on_cooldown");
      return { atkAt: now };
    }, false);
  }

  /** A brush technique (0..4), once your level has opened it and its cooldown is over. */
  async castSkill(raw: unknown): Promise<HitResult> {
    const parsed = readSwing(raw, SKILLS.length - 1, "skill");
    const req: SkillReq = { skill: parsed.kind, x: parsed.x, z: parsed.z, yaw: parsed.yaw };
    const def = SKILLS[req.skill];
    return swing(req.x, req.z, req.yaw, () => ({ hit: def.hits, offset: def.offset }), (mine, p, now) => {
      if (p.level < def.unlock) throw new RuleViolation("locked");
      const readyAt = mine.cds[req.skill] ?? 0;
      if (now < readyAt) throw new RuleViolation("on_cooldown");
      const cds = SKILLS.map((_, i) => mine.cds[i] ?? 0);
      cds[req.skill] = now + def.cd * 1000 * COOLDOWN_GRACE;
      return { cds };
    }, true);
  }

  async usePotion(): Promise<ProfileView> {
    const account = $sender.account;
    const here = currentRoom();
    if (!here) throw new RuleViolation("not_ready");
    const now = Date.now();
    const p = await withRoomLock(here.roomId, async () => {
      const mine = readMine(await $room.getMyState());
      if (!present(mine)) throw new RuleViolation("not_ready");
      if (mine.dead) throw new RuleViolation("dead");
      if (now - mine.potAt < POTION_DIRECT_GAP) throw new RuleViolation("on_cooldown");
      let hp = mine.hp;
      const next = await updateProfile(account, (q) => {
        if (q.potions <= 0) throw new RuleViolation("no_currency");
        const maxHp = maxHpFor(q.level);
        hp = Math.min(maxHp, Math.round(mine.hp + maxHp * POTION_HEAL));
        return { ...q, potions: q.potions - 1, hp };
      });
      await $room.updateMyState({ hp, potAt: now }, { returnState: false });
      return next;
    });
    return profileView(account, p);
  }

  /** Potions from the dyer in the village, POTION_COST pigment each. */
  async buyPotions(rawCount: unknown): Promise<ProfileView> {
    const count = intIn(rawCount, 1, MAX_POTION_BUY);
    if (count === null) throw new RuleViolation("bad_args");
    const account = $sender.account;
    const { here, mine } = await myRoomState();
    const dyer = ZONES[here.zone].npcs.find((n) => n.role === "dyer");
    if (!present(mine) || !dyer) throw new RuleViolation("too_far");
    if (Math.hypot(mine.pose.x - dyer.x, mine.pose.z - dyer.z) > NPC_REACH + PROXIMITY_SLACK) throw new RuleViolation("too_far");
    const p = await updateProfile(account, (q) => {
      const cost = count * POTION_COST;
      if (q.potions + count > MAX_POTIONS) throw new RuleViolation("bad_args");
      if (q.pigment < cost) throw new RuleViolation("no_currency");
      return { ...q, pigment: q.pigment - cost, potions: q.potions + count };
    });
    return profileView(account, p);
  }

  /** Fallen: back to the village, whole again. */
  async respawn(): Promise<ZoneEntry> {
    const account = $sender.account;
    const p = await myProfile(account);
    const here = currentRoom();
    const mine = here ? readMine(await $room.getMyState()) : null;
    const fallen = (mine && present(mine) && mine.dead) || p.hp <= 0;
    if (!fallen) throw new RuleViolation("bad_args");
    const channel = await pickChannel(START_ZONE, account, here?.channel ?? p.channel);
    const entry = await assign(account, START_ZONE, channel, START_POS.x, START_POS.z, Date.now(), maxHpFor(p.level));
    await stepOff();
    return entry;
  }

  async equip(rawId: unknown): Promise<ProfileView> {
    if (typeof rawId !== "string" || !ITEM[rawId]) throw new RuleViolation("bad_args");
    const item = ITEM[rawId];
    const account = $sender.account;
    const p = await updateProfile(account, (q) => {
      if (!q.owned.includes(item.id)) throw new RuleViolation("not_owned");
      return { ...q, equip: { ...q.equip, [item.slot]: item.id } };
    });
    await showInRoom({ look: lookOf(p) });
    return profileView(account, p);
  }

  /** Dyes the sash or scarf one of the DYES colors for DYE_COST pigment; null washes it back to ink, free. */
  async dye(target: unknown, hex: unknown): Promise<ProfileView> {
    if (target !== "sash" && target !== "scarf") throw new RuleViolation("bad_args");
    if (hex !== null && !DYES.some((d) => d.hex !== null && d.hex === hex)) throw new RuleViolation("bad_args");
    const color = hex as number | null;
    const account = $sender.account;
    const p = await updateProfile(account, (q) => {
      if (q.dye[target] === color) return q;
      const cost = color === null ? 0 : DYE_COST;
      if (q.pigment < cost) throw new RuleViolation("no_currency");
      const dyed = { ...q, pigment: q.pigment - cost, dye: { ...q.dye, [target]: color } };
      return color === null ? dyed : markMain(dyed, { type: "dye" });
    });
    await showInRoom({ look: lookOf(p) });
    return profileView(account, p);
  }

  /** The brush altar: 1 or 10 pulls for jade, rolled here under your lock, pity kept per player. */
  async pullGacha(rawN: unknown): Promise<GachaResult & { profile: ProfileView }> {
    if (rawN !== 1 && rawN !== 10) throw new RuleViolation("bad_args");
    const n: 1 | 10 = rawN;
    const account = $sender.account;
    let ids: string[] = [];
    let dupes: boolean[] = [];
    const p = await updateProfile(account, (q) => {
      const cost = n === 1 ? COST1 : COST10;
      if (q.jade < cost) throw new RuleViolation("no_currency");
      const rolled = rollGacha(n, q.pity, Math.random);
      const owned = [...q.owned];
      ids = rolled.ids;
      dupes = rolled.ids.map((id) => {
        if (owned.includes(id)) return true;
        owned.push(id);
        return false;
      });
      const refund = dupes.filter(Boolean).length * DUPE_PIGMENT;
      return { ...q, jade: q.jade - cost, owned, pity: rolled.pity, pigment: q.pigment + refund };
    });
    return { ids, dupes, pity: p.pity, profile: profileView(account, p) };
  }

  /** The NPC `npcId` of the zone you stand in, if you are within NPC_REACH of it. */
  private async nearNpc(npcId: unknown): Promise<{ id: string }> {
    if (typeof npcId !== "string") throw new RuleViolation("bad_args");
    const { here, mine } = await myRoomState();
    if (!present(mine)) throw new RuleViolation("not_ready");
    const npc = ZONES[here.zone].npcs.find((n) => n.id === npcId);
    if (!npc) throw new RuleViolation("bad_args");
    if (Math.hypot(mine.pose.x - npc.x, mine.pose.z - npc.z) > NPC_REACH + PROXIMITY_SLACK) throw new RuleViolation("too_far");
    return npc;
  }

  /** Talking to an NPC of the zone you stand in, within NPC_REACH. */
  async talk(npcId: unknown): Promise<ProfileView> {
    const account = $sender.account;
    const npc = await this.nearNpc(npcId);
    const p = await updateProfile(account, (q) => markMain(q, { type: "talk", npc: npc.id }));
    return profileView(account, p);
  }

  /** Accepting the current main quest from the NPC who gives it. */
  async acceptMain(npcId: unknown): Promise<ProfileView> {
    const account = $sender.account;
    const npc = await this.nearNpc(npcId);
    const p = await updateProfile(account, (q) => {
      const quest = MAIN_QUESTS[q.main];
      if (!quest) throw new RuleViolation("already_claimed");
      if (quest.giver !== npc.id) throw new RuleViolation("bad_args");
      if (q.mainAccepted) return q;
      return { ...q, mainAccepted: true, mainProgress: 0 };
    });
    return profileView(account, p);
  }

  /** Handing the current main quest in to its turn-in NPC. */
  async claimMain(npcId: unknown): Promise<ProfileView> {
    const account = $sender.account;
    const npc = await this.nearNpc(npcId);
    let levelUp = false;
    const p = await updateProfile(account, (q0) => {
      const quest = MAIN_QUESTS[q0.main];
      if (!quest) throw new RuleViolation("already_claimed");
      if (quest.turnIn !== npc.id) throw new RuleViolation("bad_args");
      // "go and talk to X" is done by talking to X, the NPC you hand it in to
      const q = markMain(q0, { type: "talk", npc: npc.id });
      if (!mainDone(q)) throw new RuleViolation("quest_not_done");
      const paid = giveReward(q, quest.reward);
      levelUp = paid.levelUp;
      return { ...paid.profile, main: q.main + 1, mainProgress: 0, mainAccepted: false };
    });
    if (levelUp) await showInRoom({ level: p.level, maxHp: maxHpFor(p.level), hp: maxHpFor(p.level) });
    return profileView(account, p);
  }

  async claimDaily(rawIndex: unknown): Promise<ProfileView> {
    const index = intIn(rawIndex, 0, DAILY_QUESTS.length - 1);
    if (index === null) throw new RuleViolation("bad_args");
    const account = $sender.account;
    let levelUp = false;
    const p = await updateProfile(account, (q) => {
      if (q.daily.claimed[index]) throw new RuleViolation("already_claimed");
      if (!dailyDone(q, index)) throw new RuleViolation("quest_not_done");
      const paid = giveReward(q, DAILY_QUESTS[index].reward);
      levelUp = paid.levelUp;
      const claimed = q.daily.claimed.map((c, i) => c || i === index);
      return { ...paid.profile, daily: { ...paid.profile.daily, claimed } };
    });
    if (levelUp) await showInRoom({ level: p.level, maxHp: maxHpFor(p.level), hp: maxHpFor(p.level) });
    return profileView(account, p);
  }

  /**
   * A watched rewarded ad: AD_REWARD_JADE jade, AD_DAILY times per KST day, once per requestId, after the
   * Verse8 verifier says it was watched (see ads.ts for when it cannot be asked).
   */
  async claimAdReward(rawRequestId: unknown): Promise<ProfileView> {
    if (typeof rawRequestId !== "string" || rawRequestId.length < 8 || rawRequestId.length > 100) throw new RuleViolation("bad_args");
    const requestId = rawRequestId;
    const account = $sender.account;
    const before = await myProfile(account);
    if (before.adsLeft <= 0) throw new RuleViolation("no_ads_left");
    const check = await verifyAd(requestId);
    if (check === "pending") throw new RuleViolation("not_ready");
    if (check === "rejected") throw new RuleViolation("bad_args");
    const paid: { profile: Profile | null } = { profile: null };
    const granted = await withProfileLock(account, () =>
      oncePer(AD_GRANTS, "requestId", requestId, { account }, async (credited) => {
        const q = await myProfile(account);
        if (q.adsLeft <= 0) throw new RuleViolation("no_ads_left");
        const next = { ...q, jade: q.jade + AD_REWARD_JADE, adsLeft: q.adsLeft - 1 };
        await saveProfile(account, next);
        credited();
        paid.profile = next;
      }),
    );
    if (!granted || !paid.profile) throw new RuleViolation("already_claimed");
    return profileView(account, paid.profile);
  }

  // Verse8 calls this when a VXShop purchase completes. It may call again with the same receipt, so each
  // purchaseId pays once; a replay still answers success so the platform stops retrying.
  async $onItemPurchased(raw: unknown): Promise<{ success: boolean; code: string }> {
    const event = readPurchase(raw);
    if (!event) return { success: false, code: "invalid_event" };
    const product = JADE_PRODUCTS.find((q) => q.productId === event.productId);
    if (!product) return { success: false, code: "unknown_product" };
    const granted = await $lock(
      `purchase:${event.purchaseId}`,
      () => oncePer(PURCHASES, "purchaseId", event.purchaseId, { account: event.account, productId: event.productId, quantity: event.quantity },
        (credited) => withProfileLock(event.account, async () => {
          const p = await ensureProfile(event.account);
          await saveProfile(event.account, { ...p, jade: p.jade + product.jade * event.quantity });
          credited();
        })),
      { maxWaitMs: 1500 },
    );
    return { success: true, code: granted ? "granted" : "already_granted" };
  }

  // Every room tick (about every 200 ms): the monsters of a hunting zone move and fight.
  async $roomTick(delta: number, roomId: string): Promise<void> {
    const zone = parseRoomId(roomId)?.zone;
    if (!zone || !hasMonsters(zone)) return;
    await withRoomLock(roomId, () => tickRoom(zone, delta, Date.now()));
  }

  // Someone gone from a room for good (after the platform's reconnect grace): their health stays with
  // the profile (fallen there, they come back whole in the village).
  async onRoomLeave(roomId: string, account: string): Promise<void> {
    const left = readMine(await $room.getUserState(account));
    if (!present(left)) return;
    await withProfileLock(account, async () => {
      const p = await loadStored(account);
      if (p) await saveProfile(account, { ...p, hp: left.dead ? 0 : Math.round(left.hp) });
    });
    await withRoomLock(roomId, async () => {
      await $room.updateUserState(account, { gone: true }, { returnState: false });
    });
  }
}
