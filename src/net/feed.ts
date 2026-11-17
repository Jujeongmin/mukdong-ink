// Room and profile state as the server writes it, turned into what GameApi's callbacks hand the game.
// Shared by the Verse8 and the local implementation.

import type { MonsterMode, MonsterState, Pose, RoomPlayer } from "../shared/types";
import { SKILLS } from "../shared/combat";
import { freshDay, profileView, readProfile } from "../shared/profile";
import type { ProfileView, RoomEffect, RoomView } from "./api";

type Json = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const MODES: MonsterMode[] = ["idle", "chase", "wind", "attack", "dead"];

function readMonster(id: string, raw: unknown): MonsterState | null {
  const m = raw as Json | null;
  if (!m || typeof m !== "object" || typeof m.kind !== "string") return null;
  return {
    id, kind: m.kind, x: num(m.x), z: num(m.z), yaw: num(m.yaw), hp: num(m.hp), maxHp: num(m.maxHp, 1), level: num(m.level, 1),
    mode: MODES.includes(m.mode as MonsterMode) ? (m.mode as MonsterMode) : "idle",
    since: num(m.since), hitAt: num(m.hitAt), deadAt: num(m.deadAt),
  };
}

function readEffect(raw: unknown): RoomEffect | null {
  const e = raw as Json | null;
  if (!e || typeof e !== "object" || typeof e.id !== "string" || (e.kind !== "shot" && e.kind !== "slam")) return null;
  return { id: e.id, kind: e.kind, x: num(e.x), z: num(e.z), tx: num(e.tx), tz: num(e.tz), r: num(e.r), at: num(e.at) };
}

/** The room's monsters and effects, as drawn (the AI's own fields left out). */
export function roomViewOf(state: Json): RoomView {
  const monsters: Record<string, MonsterState> = {};
  const raw = state.monsters;
  if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw as Json)) {
      const m = readMonster(id, value);
      if (m) monsters[id] = m;
    }
  }
  const effects = Array.isArray(state.effects) ? state.effects.map(readEffect).filter((e): e is RoomEffect => e !== null) : [];
  return { monsters, effects, now: num(state.now, Date.now()) };
}

export function membersOf(state: Json): string[] {
  const users = state.$users;
  return Array.isArray(users) ? users.filter((u): u is string => typeof u === "string") : [];
}

function readPose(raw: unknown): Pose | null {
  const p = raw as Json | null;
  if (!p || typeof p !== "object" || typeof p.x !== "number" || typeof p.z !== "number") return null;
  return {
    x: p.x, z: p.z, y: num(p.y), yaw: num(p.yaw), atkSeq: num(p.atkSeq), atkKind: num(p.atkKind), skillSeq: num(p.skillSeq), skill: num(p.skill),
  };
}

/**
 * Everyone standing in the room: listed in it ($users), arrived (a pose) and not moved on. Room user
 * state outlives a leave on Verse8, so the list is what decides who is here.
 */
export function playersOf(users: Json[], members: string[] | null): Record<string, RoomPlayer> {
  const out: Record<string, RoomPlayer> = {};
  for (const u of users) {
    const account = u.account;
    if (typeof account !== "string" || (members && !members.includes(account))) continue;
    if (u.gone === true) continue;
    const pose = readPose(u.pose);
    const look = u.look as RoomPlayer["look"] | undefined;
    if (!pose || !look || typeof look !== "object" || typeof u.name !== "string") continue;
    out[account] = {
      name: u.name, level: num(u.level, 1), hp: num(u.hp), maxHp: num(u.maxHp, 1), dead: u.dead === true, pose,
      look: {
        weapon: String(look.weapon ?? ""), hat: String(look.hat ?? ""), sash: String(look.sash ?? ""),
        sashDye: typeof look.sashDye === "number" ? look.sashDye : null, scarfDye: typeof look.scarfDye === "number" ? look.scarfDye : null,
        plus: num(look.plus), skills: SKILLS.map((_, i) => num((Array.isArray(look.skills) ? look.skills : [])[i], 1)),
      },
      at: num(u.at),
    };
  }
  return out;
}

/** The profile in an account's global user state, as the game shows it; null before it is made. */
export function profileOf(account: string, state: Json): ProfileView | null {
  const p = readProfile(state.profile);
  return p ? profileView(account, freshDay(p, Date.now())) : null;
}
