// Shared between the client and the Verse8 server (server/tsconfig.json includes src/shared).
// Rules for this folder: pure TypeScript, no DOM, no three.js, no module-level side effects,
// no inline IIFEs (the server sandbox mis-parses them), randomness always passed in.

export const PROTOCOL_VERSION = 1;

export type SlotId = "weapon" | "hat" | "sash";
export type Rarity = "일반" | "희귀" | "영웅" | "전설";

/** What other players need to draw you. Counters go up by one per action so remote clients can replay it. */
export interface Pose {
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** basic attack counter and which swing (1..3 ground combo, 4 air spin, 5 dash) */
  atkSeq: number;
  atkKind: number;
  /** skill counter and which skill (0..4) */
  skillSeq: number;
  skill: number;
}

export interface Look {
  weapon: string;
  hat: string;
  sash: string;
  sashDye: number | null;
  scarfDye: number | null;
  /** enhancement of the equipped brush (+0..+15), drawn as a glow others can see */
  plus: number;
  /** skill levels 1..10 (awakened skills look different to everyone) */
  skills: number[];
}

export interface DailyState {
  day: string; // YYYY-MM-DD (server time)
  progress: number[];
  claimed: boolean[];
}

export interface Profile {
  name: string;
  level: number;
  exp: number;
  hp: number;
  /** 궁극기 gauge (0..ULT_MAX) as of the last zone change or kill; the room keeps the live one */
  ult: number;
  potions: number;
  pigment: number; // free currency (안료)
  jade: number; // paid currency (묵옥)
  owned: string[];
  equip: Record<SlotId, string>;
  dye: { sash: number | null; scarf: number | null };
  pity: number;
  /** character creation (name, scarf and sash colors) is done */
  created: boolean;
  /** skill levels 1..10, index = SkillDef.id */
  skills: number[];
  /** extra training points from quests (on top of one per level) */
  bonusPoints: number;
  /** materials */
  stones: number;
  shards: number;
  protects: number;
  /** brush enhancement level per owned weapon id */
  enh: Record<string, number>;
  main: number; // index into MAIN_QUESTS
  /** quest-list version the `main` index belongs to (see QUEST_VERSION in profile.ts) */
  qv: number;
  /** the current main quest was accepted from its giver; progress only counts once accepted */
  mainAccepted: boolean;
  mainProgress: number;
  daily: DailyState;
  /** the open 서브 퀘스트 (SUB_QUESTS id; "" = pick by 경지) and its count */
  sub: { id: string; prog: number };
  /** 먹그림 도감: monsters felled per kind (shared/book.ts), each capped where its page is finished */
  book: Record<string, number>;
  adsDay: string;
  adsLeft: number;
  zone: string;
  channel: number;
  createdAt: number;
}

/** Room user state written by the server for every player in a room. */
export interface RoomPlayer {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  pose: Pose;
  look: Look;
  at: number; // last pose time (ms)
}

export type MonsterMode = "idle" | "chase" | "wind" | "attack" | "dead";

/** One monster as kept in room state (the server owns monsters). */
export interface MonsterState {
  id: string;
  kind: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  level: number;
  mode: MonsterMode;
  /** server time (ms) when the current mode started */
  since: number;
  /** server time (ms) of the last hit taken, for the client flash */
  hitAt: number;
  /** for the death splash and respawn */
  deadAt: number;
}

export const RULE_ERRORS = [
  "bad_args",
  "not_ready",
  "no_profile",
  "too_far",
  "on_cooldown",
  "locked",
  "dead",
  "not_owned",
  "no_currency",
  "no_ads_left",
  "room_full",
  "wrong_room",
  "quest_not_done",
  "already_claimed",
  "name_taken",
  "bad_name",
  "rate_limited",
] as const;
export type RuleCode = (typeof RULE_ERRORS)[number];

export class RuleViolation extends Error {
  readonly code: RuleCode;
  constructor(code: RuleCode) {
    super(code);
    this.code = code;
  }
}

export function today(nowMs: number): string {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST day boundary
}
