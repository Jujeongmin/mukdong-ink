// Growth systems: automatic stats per level (in combat.ts), skill training with points (수련 포인트),
// brush enhancement +1..+15 with failure and, in the high tiers, destruction (파괴), the paid
// destruction-protection ticket (파괴방지권), and the materials that feed them.
// Pure data + pure functions; the server rolls, the client shows the same numbers.
// Decided by the user (2026-11-17): stats automatic, points only for skills; destruction above a tier like
// common Korean RPGs; 묵옥 buys only the protection ticket for growth.

/* ---------- materials ---------- */
export const MATERIALS = {
  stone: { name: "먹돌", text: "먹귀신 안에서 굳은 먹. 붓을 강화할 때 쓴다." },
  shard: { name: "색 조각", text: "번짐이 미처 삼키지 못한 색의 부스러기. 검법을 각성시킨다." },
  protect: { name: "파괴방지권", text: "강화가 실패해도 붓이 부서지지 않게 지켜 준다. 시도할 때 한 장 쓴다." },
} as const;

/** Chance per kill (rolled on the server) and amount. */
export const DROPS: Record<string, { stone: [number, number]; shard: [number, number] }> = {
  blob: { stone: [0.15, 1], shard: [0, 0] },
  shade: { stone: [0.3, 1], shard: [0.03, 1] },
  spitter: { stone: [0.25, 1], shard: [0.02, 1] },
  boss: { stone: [1, 10], shard: [1, 3] },
  bigblob: { stone: [0.5, 1], shard: [0, 0] },
  shadelord: { stone: [1, 2], shard: [0.3, 1] },
  vine: { stone: [0, 0], shard: [0, 0] },
  // 2장 「불빛 조각」
  jar: { stone: [0.3, 1], shard: [0.02, 1] },
  crow: { stone: [0.25, 1], shard: [0.03, 1] },
  shademonk: { stone: [0.35, 1], shard: [0.05, 1] },
  lantern: { stone: [0.6, 2], shard: [0.06, 1] },
  kilnlord: { stone: [1, 3], shard: [0.5, 1] },
  ashboss: { stone: [1, 14], shard: [1, 4] },
};

/* ---------- skill training (오방 검법 단련) ---------- */
export const SKILL_MAX = 10;
/** Levels where a skill awakens (needs 색 조각 as well). */
export const AWAKEN_AT = [5, 10] as const;
export const AWAKEN_SHARDS: Record<number, number> = { 5: 1, 10: 3 };

/** Points earned: one per level gained (level 1 = 0 points), plus quest bonuses stored in the profile. */
export function pointsEarned(level: number, bonus: number): number {
  return Math.max(0, level - 1) + bonus;
}
/** Points spent: every skill starts at 1. */
export function pointsSpent(skills: number[]): number {
  return skills.reduce((n, lv) => n + Math.max(0, lv - 1), 0);
}
/** Cost to go from `lv` to `lv + 1`. */
export function trainCost(lv: number): { points: number; pigment: number; shards: number } {
  const next = lv + 1;
  return { points: 1, pigment: 30 * lv, shards: AWAKEN_SHARDS[next] ?? 0 };
}
export function skillDmgMul(lv: number): number {
  return 1 + 0.08 * (lv - 1);
}
export function skillCdMul(lv: number): number {
  return 1 - 0.03 * (lv - 1); // lv 10 → 0.73
}

/** What awakening does, per skill (index = SkillDef.id). Server applies the numbers; client the looks. */
export interface Awakening {
  /** added to ring radius / line half-width, metres */
  area: number;
  /** added to line length (wave, wind dash), metres */
  reach: number;
  /** a second hit ("여운") right after the first, as a fraction of the damage; 0 = none */
  echo: number;
  /** extra waves fanned out (물결베기) */
  extraWaves: number;
  text: string;
}
export const AWAKENINGS: Record<number, Record<5 | 10, Awakening>> = {
  0: {
    5: { area: 0, reach: 0, echo: 0, extraWaves: 2, text: "물결이 세 갈래로 퍼진다." },
    10: { area: 0.6, reach: 4, echo: 0, extraWaves: 2, text: "물결이 더 넓고 멀리 간다." },
  },
  1: {
    5: { area: 1, reach: 0, echo: 0, extraWaves: 0, text: "불길이 더 넓게 돈다." },
    10: { area: 1, reach: 0, echo: 0.6, extraWaves: 0, text: "지나간 자리에 불씨가 남아 한 번 더 태운다." },
  },
  2: {
    5: { area: 1.2, reach: 0, echo: 0, extraWaves: 0, text: "내려찍는 범위가 넓어진다." },
    10: { area: 1.2, reach: 0, echo: 0.6, extraWaves: 0, text: "땅이 한 번 더 갈라진다." },
  },
  3: {
    5: { area: 0.4, reach: 3, echo: 0, extraWaves: 0, text: "더 멀리 내달린다." },
    10: { area: 0.4, reach: 3, echo: 0.6, extraWaves: 0, text: "지나간 길에 바람 칼날이 한 번 더 인다." },
  },
  4: {
    5: { area: 1, reach: 0, echo: 0, extraWaves: 0, text: "먹감옥이 더 넓게 끌어당긴다." },
    10: { area: 1, reach: 0, echo: 0.6, extraWaves: 0, text: "감옥이 두 번 터진다." },
  },
};
/** The awakening in force at skill level `lv` (the highest reached), or null. */
export function awakeningAt(skill: number, lv: number): Awakening | null {
  if (lv >= 10) return AWAKENINGS[skill][10];
  if (lv >= 5) return AWAKENINGS[skill][5];
  return null;
}

/* ---------- brush enhancement (붓 강화) ---------- */
export const ENHANCE_MAX = 15;

export interface EnhanceStep {
  /** target level (after success) */
  to: number;
  success: number; // 0..1
  /** chance that a failure destroys the brush (0 = a failure only spends materials) */
  destroyOnFail: number;
  stones: number;
  pigment: number;
}
const RATES = [1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15];
const DESTROY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.4, 0.5, 0.6]; // from +12
const STONES = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16];
export const ENHANCE_TABLE: EnhanceStep[] = RATES.map((success, i) => ({
  to: i + 1,
  success,
  destroyOnFail: DESTROY[i],
  stones: STONES[i],
  pigment: 20 * (i + 1),
}));
/** First level where destruction is possible (shown in the UI). */
export const DESTROY_FROM = ENHANCE_TABLE.find((s) => s.destroyOnFail > 0)!.to;

/** Weapon attack with its enhancement: +8% of the base per level. */
export function enhancedAtk(baseAtk: number, plus: number): number {
  return Math.round(baseAtk * (1 + 0.08 * plus));
}

export type EnhanceOutcome = "success" | "fail" | "destroyed" | "protected";

/**
 * Pure roll for one attempt from `plus` to `plus + 1`. `rand` returns [0,1).
 * "protected": it failed in a destroying tier but a protection ticket saved the brush.
 */
export function rollEnhance(plus: number, useProtect: boolean, rand: () => number): EnhanceOutcome {
  const step = ENHANCE_TABLE[plus];
  if (!step) return "fail";
  if (rand() < step.success) return "success";
  if (step.destroyOnFail <= 0) return "fail";
  if (rand() >= step.destroyOnFail) return "fail";
  return useProtect ? "protected" : "destroyed";
}

/** The starter brush is never destroyed (a player must always have a weapon): it drops to +0 instead. */
export const UNBREAKABLE = "w_brush";

/** 묵옥 price of one 파괴방지권 (VXShop sells 묵옥; the ticket is bought with 묵옥 in game). */
export const PROTECT_PRICE = 200;
