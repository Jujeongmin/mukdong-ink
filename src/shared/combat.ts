// Skills, basic attacks, levels and monsters. Damage is decided by the server from these numbers.

export type HitShape =
  | { shape: "arc"; reach: number; half: number }
  | { shape: "ring"; r: number }
  | { shape: "line"; length: number; half: number }; // from the player forward (wave, dash)

export interface HitDef {
  hit: HitShape;
  /** multiplier on the player's attack power */
  dmg: number;
  kb: number;
  up: number;
}

/** Basic attacks by atkKind (1..3 ground combo, 4 air spin, 5 dash). */
export const BASIC: Record<number, HitDef & { dur: number }> = {
  1: { dur: 0.3, hit: { shape: "arc", reach: 2.5, half: 1.5 }, dmg: 1.0, kb: 6, up: 2.5 },
  2: { dur: 0.32, hit: { shape: "arc", reach: 2.4, half: 1.4 }, dmg: 1.0, kb: 2.5, up: 9 },
  3: { dur: 0.55, hit: { shape: "ring", r: 2.8 }, dmg: 1.6, kb: 8, up: 4 },
  4: { dur: 0.44, hit: { shape: "ring", r: 2.6 }, dmg: 0.9, kb: 3, up: 5 },
  5: { dur: 0.17, hit: { shape: "line", length: 4, half: 1.0 }, dmg: 0.7, kb: 6, up: 3 },
};
/** Minimum time between two basic attacks the server accepts (seconds), with grace. */
export const BASIC_MIN_GAP = 0.2;

export interface SkillDef {
  id: number;
  label: string; // short Korean label on the skill button
  name: string;
  unlock: number; // level
  cd: number; // seconds
  color: [number, number, number];
  hits: HitDef;
  /** where the hit is centred, forward from the player (0 = on the player) */
  offset: number;
}

export const SKILLS: SkillDef[] = [
  { id: 0, label: "물결", name: "물결베기", unlock: 1, cd: 4, color: [0.16, 0.42, 0.8], offset: 0, hits: { hit: { shape: "line", length: 12, half: 1.6 }, dmg: 2.2, kb: 8, up: 3 } },
  { id: 1, label: "화염", name: "화염선풍", unlock: 4, cd: 6, color: [0.88, 0.22, 0.1], offset: 0, hits: { hit: { shape: "ring", r: 3.4 }, dmg: 3.0, kb: 5, up: 3 } },
  { id: 2, label: "대지", name: "대지낙하", unlock: 8, cd: 7, color: [0.95, 0.7, 0.1], offset: 0, hits: { hit: { shape: "ring", r: 4.8 }, dmg: 3.5, kb: 9, up: 10 } },
  { id: 3, label: "바람", name: "바람질주", unlock: 12, cd: 5, color: [0.96, 0.96, 1.0], offset: 0, hits: { hit: { shape: "line", length: 11, half: 1.6 }, dmg: 2.6, kb: 7, up: 4 } },
  { id: 4, label: "먹", name: "먹감옥", unlock: 16, cd: 9, color: [0.04, 0.04, 0.05], offset: 5, hits: { hit: { shape: "ring", r: 4.4 }, dmg: 4.5, kb: 2, up: 8 } },
];

/* ---------- levels ---------- */
export const MAX_LEVEL = 20;
export function expToNext(level: number): number {
  return Math.round(30 * Math.pow(level, 1.55));
}
export function maxHpFor(level: number): number {
  return 80 + level * 14;
}
/** Attack power from level and weapon. */
export function attackFor(level: number, weaponAtk: number): number {
  return Math.round(weaponAtk * (1 + (level - 1) * 0.09));
}
export const POTION_HEAL = 0.45; // fraction of max HP
export const POTION_COST = 15; // 안료
export const POTION_GAP_MS = 1500;
export const RESPAWN_MS = 4000;
/** Radius of a 먹덩굴; the client blocks walking into a living one. */
export const VINE_RADIUS = 1.6;

/* ---------- monsters ---------- */
export interface MonsterDef {
  kind: string;
  name: string;
  hp: number; // at level 1; scaled by level
  atk: number; // contact/attack damage at level 1
  speed: number;
  radius: number;
  height: number;
  exp: number;
  pigment: number;
  jade?: number;
  /** contact bite, melee lunge, ranged ink shot, telegraphed slam; "none" = an obstacle that never attacks */
  attack: "contact" | "melee" | "ranged" | "slam" | "none";
  range: number;
  windMs: number;
  cooldownMs: number;
  aggro: number;
  boss?: boolean;
  /** time before it stands again after being felled (default RESPAWN_MS; a boss uses its zone's timer) */
  respawnMs?: number;
  /** radius of its slam mark (default 3.2) */
  slamR?: number;
  /** basic attacks do nothing to it (reported as resisted) */
  skillOnly?: boolean;
  /** with skillOnly: only these techniques (SkillDef.id) harm it; others are resisted too */
  weakTo?: number[];
  /** 먹 갑옷: damage ×ARMOR_FACTOR unless the attacker meets the condition (see armorHolds) */
  armor?: "training" | "plus3";
  /** never strays further than this from its spawn spot (metres) */
  leash?: number;
}

/** Damage factor while a monster's armor holds. */
export const ARMOR_FACTOR = 0.1;
/** Brush enhancement that breaks the "plus3" armor. */
export const ARMOR_PLUS = 3;

/** Whether `def`'s armor holds against an attacker with these skill levels and this brush enhancement. */
export function armorHolds(def: MonsterDef, skills: number[], plus: number): boolean {
  if (def.armor === "training") return skills.every((lv) => lv <= 1);
  if (def.armor === "plus3") return plus < ARMOR_PLUS;
  return false;
}

/** An obstacle (먹덩굴): never attacks, never counts as a kill for "any" quests. */
export function isObstacle(def: MonsterDef | undefined): boolean {
  return !!def && def.attack === "none";
}

export const MONSTERS: Record<string, MonsterDef> = {
  blob: { kind: "blob", name: "먹방울", hp: 30, atk: 5, speed: 3.0, radius: 0.6, height: 1.04, exp: 8, pigment: 3, attack: "contact", range: 1.1, windMs: 0, cooldownMs: 1300, aggro: 7 },
  shade: { kind: "shade", name: "먹그림자", hp: 55, atk: 9, speed: 2.6, radius: 0.5, height: 1.9, exp: 16, pigment: 5, attack: "melee", range: 2.2, windMs: 500, cooldownMs: 1600, aggro: 14 },
  spitter: { kind: "spitter", name: "먹두꺼비", hp: 45, atk: 8, speed: 1.6, radius: 0.7, height: 1.0, exp: 14, pigment: 4, attack: "ranged", range: 9, windMs: 700, cooldownMs: 2400, aggro: 15 },
  boss: { kind: "boss", name: "대먹귀", hp: 900, atk: 22, speed: 2.4, radius: 1.6, height: 2.9, exp: 400, pigment: 120, jade: 30, attack: "slam", range: 5.5, windMs: 1100, cooldownMs: 2600, aggro: 22, boss: true, armor: "plus3" },
  // Tutorial gates (docs/TUTORIAL-GATES.md): a slam to roll away from, vines only fire burns, an armored elite.
  bigblob: { kind: "bigblob", name: "부푼 먹방울", hp: 90, atk: 33, speed: 2.0, radius: 1.0, height: 1.6, exp: 30, pigment: 8, attack: "slam", range: 3, windMs: 1000, cooldownMs: 2800, aggro: 8, slamR: 2.8 },
  vine: { kind: "vine", name: "먹덩굴", hp: 60, atk: 0, speed: 0, radius: 1.6, height: 2.2, exp: 4, pigment: 1, attack: "none", range: 0, windMs: 0, cooldownMs: 0, aggro: 0, respawnMs: 45_000, skillOnly: true, weakTo: [1] },
  shadelord: { kind: "shadelord", name: "그림자 무사", hp: 220, atk: 12, speed: 2.6, radius: 0.6, height: 2.1, exp: 90, pigment: 25, attack: "melee", range: 2.4, windMs: 600, cooldownMs: 1500, aggro: 8, armor: "training", leash: 1.5, respawnMs: 30_000 },
};

export function monsterHp(def: MonsterDef, level: number): number {
  return Math.round(def.hp * (1 + (level - 1) * 0.35));
}
export function monsterAtk(def: MonsterDef, level: number): number {
  return Math.round(def.atk * (1 + (level - 1) * 0.22));
}
export function killExp(def: MonsterDef, level: number): number {
  return Math.round(def.exp * (1 + (level - 1) * 0.3));
}
