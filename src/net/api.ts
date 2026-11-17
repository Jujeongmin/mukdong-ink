// The contract between the game client and the server. The client only ever talks to `GameApi`.
// Two implementations: Verse8 (real server over @agent8/gameserver) and Local (the same server code
// running in the page, for offline play and the demo build). See docs/API.md.

import type { MonsterState, Pose, Profile, RoomPlayer } from "../shared/types";

export interface ProfileView extends Profile {
  account: string;
  maxHp: number;
  atk: number;
  expToNext: number;
}

export interface ZoneEntry {
  roomId: string;
  zone: string;
  channel: number;
  x: number;
  z: number;
}

export interface AttackReq {
  kind: number; // 1..5, see BASIC in shared/combat.ts
  x: number;
  z: number;
  yaw: number;
}
export interface SkillReq {
  skill: number; // 0..4
  x: number;
  z: number;
  yaw: number;
}
export interface Hit {
  id: string; // monster id
  dmg: number;
  kill: boolean;
}
export interface HitResult {
  hits: Hit[];
  exp: number;
  pigment: number;
  jade: number;
  levelUp: boolean;
}

/** A projectile or telegraph the server spawned (ranged ink shot, boss slam warning). */
export interface RoomEffect {
  id: string;
  kind: "shot" | "slam";
  x: number;
  z: number;
  tx: number;
  tz: number;
  r: number;
  at: number; // server ms when it lands / goes off
}

export interface RoomView {
  monsters: Record<string, MonsterState>;
  effects: RoomEffect[];
  now: number; // server ms when this state was written
}

export interface GachaResult {
  ids: string[];
  dupes: boolean[];
  pity: number;
}

export interface GameApi {
  readonly mode: "verse8" | "local";
  readonly account: string;
  connect(): Promise<void>;
  loadProfile(): Promise<ProfileView>;
  setName(name: string): Promise<ProfileView>;
  /** Enter a zone (first entry, through a portal, or after respawn) and join its room. */
  enterZone(zone: string, viaPortal?: string): Promise<ZoneEntry>;
  /** Fire-and-forget; throttled by the implementation to the platform limit. */
  reportPose(pose: Pose): void;
  attack(req: AttackReq): Promise<HitResult>;
  castSkill(req: SkillReq): Promise<HitResult>;
  usePotion(): Promise<ProfileView>;
  buyPotions(count: number): Promise<ProfileView>;
  respawn(): Promise<ZoneEntry>;
  equip(itemId: string): Promise<ProfileView>;
  dye(target: "sash" | "scarf", hex: number | null): Promise<ProfileView>;
  pullGacha(n: 1 | 10): Promise<GachaResult & { profile: ProfileView }>;
  /** Shows a rewarded ad (or the local mock) and claims the reward if it was watched. */
  watchAdForJade(): Promise<ProfileView | null>;
  /** Opens the VXShop purchase (local: grants immediately, marked as a mock). */
  buyJade(productId: string): Promise<void>;
  talk(npcId: string): Promise<ProfileView>;
  /** Accept the current main quest from its giver NPC (stand within NPC_REACH). */
  acceptMain(npcId: string): Promise<ProfileView>;
  /** Hand the current main quest in to its turn-in NPC (stand within NPC_REACH). */
  claimMain(npcId?: string): Promise<ProfileView>;
  claimDaily(index: number): Promise<ProfileView>;
  onRoom(cb: (room: RoomView) => void): () => void;
  onPlayers(cb: (players: Record<string, RoomPlayer>) => void): () => void;
  onProfile(cb: (p: ProfileView) => void): () => void;
}
