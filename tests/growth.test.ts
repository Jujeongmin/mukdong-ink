import { describe, expect, test } from "vitest";
import { attackFor } from "../src/shared/combat";
import {
  AWAKEN_SHARDS, DESTROY_FROM, ENHANCE_TABLE, SKILL_MAX, awakeningAt, enhancedAtk, pointsEarned, pointsSpent, rollEnhance, trainCost,
} from "../src/shared/growth";
import { giveReward, lookOf, pointsLeft, profileView, readProfile, starterProfile } from "../src/shared/profile";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seq = (values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe("rollEnhance", () => {
  test("success, plain failure, destruction and a protected failure", () => {
    expect(rollEnhance(0, false, seq([0]))).toBe("success");
    // +5 → +6 cannot destroy.
    expect(rollEnhance(5, false, seq([0.99, 0]))).toBe("fail");
    const tier = DESTROY_FROM - 1;
    expect(rollEnhance(tier, false, seq([0.99, 0]))).toBe("destroyed");
    expect(rollEnhance(tier, true, seq([0.99, 0]))).toBe("protected");
    expect(rollEnhance(tier, false, seq([0.99, 0.99]))).toBe("fail");
    // Past the table: nothing to roll.
    expect(rollEnhance(ENHANCE_TABLE.length, false, seq([0]))).toBe("fail");
  });

  test("destruction starts at DESTROY_FROM (+12)", () => {
    expect(DESTROY_FROM).toBe(12);
    for (const step of ENHANCE_TABLE) expect(step.destroyOnFail > 0).toBe(step.to >= DESTROY_FROM);
  });

  test("outcomes follow the table over many seeded attempts", () => {
    const rand = seeded(7);
    const n = 100_000;
    for (const plus of [3, 8, 13]) {
      const step = ENHANCE_TABLE[plus];
      const counts = { success: 0, fail: 0, destroyed: 0, protected: 0 };
      for (let i = 0; i < n; i++) counts[rollEnhance(plus, false, rand)]++;
      const pDestroy = (1 - step.success) * step.destroyOnFail;
      const tol = (p: number) => 5 * Math.sqrt((p * (1 - p)) / n) + 1e-9;
      expect(Math.abs(counts.success / n - step.success)).toBeLessThan(tol(step.success));
      expect(Math.abs(counts.destroyed / n - pDestroy)).toBeLessThan(tol(pDestroy));
      expect(counts.protected).toBe(0);
    }
  });

  test("an enhanced brush hits harder", () => {
    expect(enhancedAtk(10, 0)).toBe(10);
    expect(enhancedAtk(24, 15)).toBe(Math.round(24 * 2.2));
  });
});

describe("training points", () => {
  test("one per level gained plus bonuses; every skill starts at 1", () => {
    expect(pointsEarned(1, 0)).toBe(0);
    expect(pointsEarned(20, 3)).toBe(22);
    expect(pointsSpent([1, 1, 1, 1, 1])).toBe(0);
    expect(pointsSpent([3, 1, 10, 1, 1])).toBe(11);
    const p = { ...starterProfile("먹동이0001", 0), level: 5, bonusPoints: 1, skills: [3, 1, 1, 1, 1] };
    expect(pointsLeft(p)).toBe(3);
    expect(profileView("a", p).points).toBe(3);
  });

  test("awakening levels cost 색 조각; pigment grows with the level", () => {
    expect(trainCost(1)).toEqual({ points: 1, pigment: 30, shards: 0 });
    expect(trainCost(4).shards).toBe(AWAKEN_SHARDS[5]);
    expect(trainCost(9).shards).toBe(AWAKEN_SHARDS[10]);
    expect(awakeningAt(0, 4)).toBeNull();
    expect(awakeningAt(0, 5)?.extraWaves).toBe(2);
    expect(awakeningAt(1, SKILL_MAX)?.echo).toBeGreaterThan(0);
  });
});

describe("the profile", () => {
  test("old saves read back with the new fields' defaults; enhancement only on owned weapons", () => {
    const old = { name: "옛사람", level: 3, owned: ["w_brush", "w_brush"], enh: { w_brush: 4, w_gold: 9, h_none: 2 }, skills: [2, 99] };
    const p = readProfile(old)!;
    expect([p.created, p.skills, p.bonusPoints, p.stones, p.shards, p.protects, p.enh]).toEqual([
      false, [2, SKILL_MAX, 1, 1, 1], 0, 0, 0, 0, { w_brush: 4 },
    ]);
    expect(profileView("a", p).atk).toBe(attackFor(3, enhancedAtk(10, 4)));
    expect(lookOf(p).plus).toBe(4);
  });

  test("quest rewards pay materials, tickets and training points", () => {
    const p = giveReward(starterProfile("먹동이0001", 0), { exp: 0, pigment: 1, stones: 5, shards: 2, protects: 1, points: 2 }).profile;
    expect([p.pigment, p.stones, p.shards, p.protects, p.bonusPoints, pointsLeft(p)]).toEqual([1, 5, 2, 1, 2, 2]);
  });
});
