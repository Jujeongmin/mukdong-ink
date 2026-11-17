import { ZONES } from "../../src/shared/world";
import { spawnZone } from "../src/hunt";

export const NO_ROOM = "__no_room__";

export async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error: any) {
    return String(error?.message ?? error);
  }
}

/** A player's first call, from outside any room (as the client does it on start). */
export async function newPlayer(server: any, account: string): Promise<any> {
  server.connect({ account, roomId: NO_ROOM });
  return server.loadProfile();
}

/** What the client does after enterZone / respawn: joins the room it was given and arrives in it. */
export async function join(server: any, account: string, entry: { roomId: string }, from?: string): Promise<any> {
  if (from) await server.simulateLeave(from, account);
  await server.simulateJoin(entry.roomId, account);
  server.connect({ account, roomId: entry.roomId });
  await server.arrive();
  return entry;
}

/** A new player standing in the village. */
export async function inVillage(server: any, account: string): Promise<any> {
  await newPlayer(server, account);
  const entry = await server.enterZone("village");
  return join(server, account, entry);
}

/** Moves the caller straight to (x, z), as a long walk would (the last pose is made old enough). */
export async function walkTo(server: any, x: number, z: number, yaw = 0): Promise<void> {
  await $room.updateMyState({ at: 0 });
  await server.reportPose({ x, z, y: 0, yaw, atkSeq: 0, atkKind: 0, skillSeq: 0, skill: 0 });
}

/** Through portals from the village to `zone`, joining each room on the way. Answers the last entry. */
export async function goTo(server: any, account: string, zone: string): Promise<any> {
  const path: Record<string, string[]> = { village: [], bamboo: ["bamboo"], pond: ["bamboo", "pond"], peak: ["bamboo", "pond", "peak"] };
  let entry = await inVillage(server, account);
  let from = "village";
  for (const next of path[zone]) {
    const portal = ZONES[from].portals.find((p) => p.to === next)!;
    await walkTo(server, portal.x, portal.z);
    entry = await join(server, account, await server.enterZone(next), entry.roomId);
    from = next;
  }
  return entry;
}

/**
 * Leaves exactly one living monster in the caller's room: `id` (one of the zone's spawn ids) at (x, z);
 * every other one lies felled, never to rise (its death is in the future).
 */
export async function only(zone: string, id: string, x: number, z: number, extra: Record<string, unknown> = {}): Promise<any> {
  const all = spawnZone(zone, 0, () => 0.5);
  const monsters: Record<string, any> = {};
  for (const [key, m] of Object.entries(all)) monsters[key] = { ...m, mode: "dead", hp: 0, deadAt: Number.MAX_SAFE_INTEGER };
  monsters[id] = { ...all[id], x, z, hx: x, hz: z, wx: x, wz: z, mode: "idle", since: Date.now(), rd: 0, ...extra };
  await $room.updateRoomState({ monsters, effects: [], monstersAt: Date.now() });
  return monsters[id];
}

/** Changes the stored profile of `account` (outside the game's rules, for setting a test up). */
export async function editProfile(account: string, change: (p: any) => any): Promise<void> {
  const state = await $global.getUserState(account);
  await $global.updateUserState(account, { profile: change({ ...state.profile }) });
}

export async function profileOf(account: string): Promise<any> {
  return (await $global.getUserState(account)).profile;
}

/** Holds Math.random at `value` (or a sequence) while `run` runs. */
export async function rolling(values: number | number[], run: () => Promise<any>): Promise<any> {
  const real = Math.random;
  const list = Array.isArray(values) ? values : [values];
  let i = 0;
  Math.random = () => list[Math.min(i++, list.length - 1)];
  try {
    return await run();
  } finally {
    Math.random = real;
  }
}

export function ago(ms: number): number {
  return Date.now() - ms;
}
