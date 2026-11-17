// The contract between the game client and the server. The client only ever talks to `GameApi`.
// Two implementations: Verse8 (real server over @agent8/gameserver) and Local (the same server code
// running in the page, for offline play and the demo build). See docs/API.md.

import type { ChatMessage } from "../shared/chat";
import type { MonsterState, Pose, Profile, RoomPlayer } from "../shared/types";

export type { ChatMessage } from "../shared/chat";

export interface ProfileView extends Profile {
  account: string;
  maxHp: number;
  atk: number;
  expToNext: number;
  /** training points available to spend (earned − spent) */
  points: number;
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
  /** the monster shrugged it off: a vine against a basic blow (dmg 0), or 먹 갑옷 holding (dmg x0.1) */
  resisted?: boolean;
}
export interface HitResult {
  hits: Hit[];
  exp: number;
  pigment: number;
  jade: number;
  /** materials dropped by kills in this hit */
  stones?: number;
  shards?: number;
  levelUp: boolean;
}

export interface EnhanceResult {
  outcome: import("../shared/growth").EnhanceOutcome;
  /** the brush's level after the attempt (0 and not owned any more when destroyed) */
  plus: number;
  profile: ProfileView;
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

/** One drawn entry, as the altar shows it. */
export interface GachaPull {
  id: string; // ITEM id (kind "item") or GACHA_EXTRA id (kind "material")
  name: string;
  r: import("../shared/types").Rarity;
  kind: "item" | "material";
  /** gear you already had */
  dupe: boolean;
  /** what you got besides gear: the bundle's materials, or what a duplicate turned into ("중복 → 먹돌 16") */
  grant?: import("../shared/items").Grant;
}

export interface GachaResult {
  /** every drawn id, in order (gear or material) */
  ids: string[];
  /** per id: gear you already had (always false for materials) */
  dupes: boolean[];
  pity: number;
  /** the same draws, ready to show */
  pulls: GachaPull[];
}

export interface GameApi {
  readonly mode: "verse8" | "local";
  readonly account: string;
  connect(): Promise<void>;
  loadProfile(): Promise<ProfileView>;
  setName(name: string): Promise<ProfileView>;
  /** Once per account: name + scarf and sash colors (DYES hex or null), free. */
  createCharacter(name: string, scarf: number | null, sash: number | null): Promise<ProfileView>;
  /** Raise a skill one level (training point + pigment, 색 조각 at awakening levels). */
  trainSkill(skill: number): Promise<ProfileView>;
  /** Try to enhance an owned brush by one level; useProtect spends a 파괴방지권 on the attempt. */
  enhance(itemId: string, useProtect: boolean): Promise<EnhanceResult>;
  /** Buy 파괴방지권 with 묵옥 (PROTECT_PRICE each). */
  buyProtect(count: number): Promise<ProfileView>;
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
  /** Say a line in your room (zone + channel). Errors: bad_args (empty/too long), on_cooldown (pace), rate_limited (same line again), not_ready. */
  chatSay(text: string): Promise<ChatMessage>;
  /** Each line said in your room while you are in it, once. Nothing from before you joined is replayed. */
  onChat(cb: (line: ChatMessage) => void): () => void;
  onRoom(cb: (room: RoomView) => void): () => void;
  onPlayers(cb: (players: Record<string, RoomPlayer>) => void): () => void;
  onProfile(cb: (p: ProfileView) => void): () => void;
}
