// The contract between the game client and the server. The client only ever talks to `GameApi`.
// Two implementations: Verse8 (real server over @agent8/gameserver) and Local (the same server code
// running in the page, for offline play and the demo build). See docs/API.md.

import type { ChatMessage } from "../shared/chat";
import type { RankBoard, RankView } from "../shared/rank";
import type { MonsterState, Pose, Profile, RoomPlayer } from "../shared/types";

export type { ChatMessage } from "../shared/chat";

export interface ProfileView extends Profile {
  account: string;
  maxHp: number;
  atk: number;
  /** 전투력 (shared/profile powerOf) */
  power: number;
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
  /** 궁극기 gauge on arriving (arrive answers it) */
  ult?: number;
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
  /** 궁극기 gauge after this blow */
  ult?: number;
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
  /** the room's 필드 보스, while it is up or just felled (shared/fieldboss.ts); null when there is none */
  fb: FieldBossView | null;
}

/** A room's field boss as the game shows it: when it leaves, when it fell, who was paid what. */
export interface FieldBossView {
  win: string;
  end: number;
  /** server ms it fell (0: up, or gone) */
  dead: number;
  done: boolean;
  /** after the fall: each earner's reward (null: their FB_DAILY for the day was already taken) */
  paid: Record<string, import("../shared/fieldboss").FbReward | null> | null;
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

/** The rewarded ads: 묵옥, 이 자리에서 일어나기, 오늘의 의뢰 보상 한 번 더, 무료 1회 뽑기. */
export type AdKind = "jade" | "revive" | "double" | "pull";

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
  /** 궁극기 「무지개 붓질」 from where you stand (full gauge, opened). Errors: locked, on_cooldown (not full), dead. */
  ultimate(req: { x: number; z: number; yaw: number }): Promise<HitResult>;
  buyPotions(count: number): Promise<ProfileView>;
  respawn(): Promise<ZoneEntry>;
  /** Players in each channel of the zone you are in, and yours. */
  channelList(): Promise<{ current: number; players: number[] }>;
  /** 랭킹: the top of a board and your own line */
  rankings(board: RankBoard): Promise<RankView>;
  /** To another channel of this zone, where you stand. Errors: room_full, on_cooldown (10 s between), dead. */
  changeChannel(channel: number): Promise<ZoneEntry>;
  /** 순간이동 from a village to another one the story has opened. Errors: locked, dead, bad_args. */
  travel(village: string): Promise<ZoneEntry>;
  equip(itemId: string): Promise<ProfileView>;
  dye(target: "sash" | "scarf", hex: number | null): Promise<ProfileView>;
  pullGacha(n: 1 | 10): Promise<GachaResult & { profile: ProfileView }>;
  /** Shows a rewarded ad (or the local mock) and claims the reward if it was watched. */
  watchAdForJade(): Promise<ProfileView | null>;
  /** Whether rewarded ads can be shown here (false offline without the mock, or once Verse8 said unsupported_env). */
  adsAvailable(): boolean;
  /** Shows the rewarded ad of `kind` (only from a press); its requestId when it was watched to the end, else null. */
  watchAd(kind: AdKind): Promise<string | null>;
  /** Fallen: an ad, then up where you fell with full health. null when the ad was not watched. Errors: not_dead, no_ads_left. */
  reviveWithAd(): Promise<ProfileView | null>;
  /** All daily quests handed in: an ad, then their rewards once more. Errors: quest_not_done, no_ads_left. */
  dailyDoubleWithAd(): Promise<ProfileView | null>;
  /** An ad, then one altar pull without jade (counts toward pity). Errors: no_ads_left. */
  freePullWithAd(): Promise<(GachaResult & { profile: ProfileView }) | null>;
  /** Opens the VXShop purchase (local: grants immediately, marked as a mock). */
  buyJade(productId: string): Promise<void>;
  /** VX prices of the shop's products as VXShop lists them (only on Verse8); called again whenever they change */
  onPrices?(cb: (prices: Record<string, number>) => void): () => void;
  talk(npcId: string): Promise<ProfileView>;
  /** Accept the current main quest from its giver NPC (stand within NPC_REACH). */
  acceptMain(npcId: string): Promise<ProfileView>;
  /** Hand the current main quest in to its turn-in NPC (stand within NPC_REACH). */
  claimMain(npcId?: string): Promise<ProfileView>;
  claimDaily(index: number): Promise<ProfileView>;
  /** Hand in the open 서브 퀘스트 (anywhere); the next one opens. Errors: quest_not_done. */
  claimSub(): Promise<ProfileView>;
  /** Every finished daily quest at once. Errors: quest_not_done (none ready). */
  claimDailyAll(): Promise<ProfileView>;
  /** Say a line in your room (zone + channel). Errors: bad_args (empty/too long), on_cooldown (pace), rate_limited (same line again), not_ready. */
  chatSay(text: string): Promise<ChatMessage>;
  /** Each line said in your room while you are in it, once. Nothing from before you joined is replayed. */
  onChat(cb: (line: ChatMessage) => void): () => void;
  onRoom(cb: (room: RoomView) => void): () => void;
  onPlayers(cb: (players: Record<string, RoomPlayer>) => void): () => void;
  onProfile(cb: (p: ProfileView) => void): () => void;
}
