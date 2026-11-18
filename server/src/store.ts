import { isBannedName } from "../../src/shared/filter";
import { freshDay, readProfile, starterProfile } from "../../src/shared/profile";
import { RuleViolation, type Profile } from "../../src/shared/types";
import { CHANNELS, CHANNEL_CAPACITY, parseRoomId, roomIdFor } from "../../src/shared/world";

// Where things are kept:
// - global user state `profile`: the whole Profile (one small object, rewritten as a whole);
// - global user state `assigned`: the room the server last sent you to (arrive checks it);
// - collection `nicknames`: one row per taken name; `purchases`: one row per VXShop receipt;
//   `adGrants`: one row per rewarded-ad requestId paid out.

export const NICKNAMES = "nicknames";
export const PURCHASES = "purchases";
export const AD_GRANTS = "adGrants";

/** Where the server sent an account last (enterZone / respawn), for arrive to check against. */
export interface Assigned {
  roomId: string;
  zone: string;
  channel: number;
  x: number;
  z: number;
  at: number;
}

export function withProfileLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  return $lock(`profile:${account}`, fn);
}

export function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  return $lock(`room:${roomId}`, fn);
}

export function withNameLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // A lock key may not hold every character a name can; encoded it can.
  return $lock(`nickname:${encodeURIComponent(key)}`, fn);
}

/** The caller's room, when the call came from inside one of ours. */
export function currentRoom(): { roomId: string; zone: string; channel: number } | null {
  const roomId = $sender.roomId;
  if (typeof roomId !== "string") return null;
  const parsed = parseRoomId(roomId);
  return parsed ? { roomId, ...parsed } : null;
}

export async function loadStored(account: string): Promise<Profile | null> {
  const state = await $global.getUserState(account);
  const p = readProfile(state.profile);
  return p ? freshDay(p, Date.now()) : null;
}

export async function saveProfile(account: string, p: Profile): Promise<void> {
  await $global.updateUserState(account, { profile: p });
}

/** Reads the profile, applies `change` (which may throw a RuleViolation) and saves, under the account's lock. */
export async function updateProfile(account: string, change: (p: Profile) => Profile | Promise<Profile>): Promise<Profile> {
  return withProfileLock(account, async () => {
    const before = await loadStored(account);
    if (!before) throw new RuleViolation("no_profile");
    const after = await change(before);
    await saveProfile(account, after);
    return after;
  });
}

// ---------- names ----------

export const NAME_PATTERN = /^[가-힣a-zA-Z0-9]{2,8}$/;

/** A requested name tidied and checked: 2–8 hangul syllables, latin letters or digits. */
export function parseName(raw: unknown): { name: string; key: string } | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").trim();
  if (!NAME_PATTERN.test(name) || isBannedName(name)) return null;
  return { name, key: name.toLowerCase() };
}

interface NameRow {
  __id: string;
  key: string;
  name: string;
  account: string;
}

export async function findName(key: string): Promise<NameRow | null> {
  const [row] = await $global.getCollectionItems(NICKNAMES, { filters: [{ field: "key", operator: "==", value: key }], limit: 1 });
  return (row as NameRow | undefined) ?? null;
}

/** Takes `name` for `account` (inside withNameLock); false when someone else has it. */
export async function claimName(account: string, key: string, name: string): Promise<boolean> {
  const row = await findName(key);
  if (row && row.account !== account) return false;
  if (!row) await $global.addCollectionItem(NICKNAMES, { key, name, account });
  return true;
}

export async function releaseName(account: string, key: string): Promise<void> {
  const row = await findName(key);
  if (row && row.account === account) await $global.deleteCollectionItem(NICKNAMES, row.__id);
}

/** A first profile: a free "나그네" + 4 digits name, the starter kit. */
export async function createProfile(account: string, rand: () => number): Promise<Profile> {
  let picked: { name: string; key: string } | null = null;
  for (let tries = 0; tries < 6 && !picked; tries++) {
    const name = `나그네${String(Math.floor(rand() * 10000)).padStart(4, "0")}`;
    const key = name.toLowerCase();
    const free = await withNameLock(key, () => claimName(account, key, name));
    if (free) picked = { name, key };
  }
  // Six taken in a row: a name nobody else can have (the account's own tail).
  if (!picked) {
    const name = `나그네${account.replace(/[^a-zA-Z0-9]/g, "").slice(-4)}`;
    picked = { name, key: name.toLowerCase() };
  }
  return starterProfile(picked.name, Date.now());
}

// ---------- receipts ----------

/**
 * Keeps a receipt row once; false when one with this `field` value was kept before. `grant` pays; should
 * it fail before calling `credited`, the row is taken back so the platform's retry pays then.
 */
export async function oncePer(
  collection: string, field: string, value: string | number, row: Record<string, unknown>,
  grant: (credited: () => void) => Promise<void>,
): Promise<boolean> {
  const seen = await $global.getCollectionItems(collection, { filters: [{ field, operator: "==", value }], limit: 1 });
  if (seen.length > 0) return false;
  const kept = await $global.addCollectionItem(collection, { ...row, [field]: value, at: Date.now() });
  let paid = false;
  try {
    await grant(() => {
      paid = true;
    });
  } catch (error) {
    const id = (kept as { __id?: string } | undefined)?.__id;
    if (id && !paid) await $global.deleteCollectionItem(collection, id);
    throw error;
  }
  return true;
}

// ---------- channels ----------

/** A channel of `zone` with room for `account`: the one it last played on first, then from 1. */
export async function pickChannel(zone: string, account: string, prefer: number): Promise<number> {
  const order = [prefer, ...Array.from({ length: CHANNELS }, (_, i) => i + 1).filter((c) => c !== prefer)];
  for (const channel of order) {
    if (!(channel >= 1 && channel <= CHANNELS)) continue;
    const players = await $global.getRoomUserAccounts(roomIdFor(zone, channel));
    if (players.includes(account) || players.length < CHANNEL_CAPACITY) return channel;
  }
  throw new RuleViolation("room_full");
}

export function readAssigned(raw: unknown): Assigned | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.roomId !== "string" || !parseRoomId(a.roomId)) return null;
  if (typeof a.x !== "number" || typeof a.z !== "number" || typeof a.at !== "number") return null;
  const parsed = parseRoomId(a.roomId)!;
  return { roomId: a.roomId, zone: parsed.zone, channel: parsed.channel, x: a.x, z: a.z, at: a.at };
}

export async function loadAssigned(account: string): Promise<Assigned | null> {
  return readAssigned((await $global.getUserState(account)).assigned);
}
