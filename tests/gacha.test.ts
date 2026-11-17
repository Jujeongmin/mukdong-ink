import { describe, expect, test } from "vitest";
import { GACHA_POOL, ITEM, PITY, RARITY_RATES, itemOdds, rollGacha } from "../src/shared/items";
import type { Rarity } from "../src/shared/types";

// mulberry32: the same rolls every run.
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

const rarity = (id: string): Rarity => ITEM[id].r;

describe("rollGacha", () => {
  test("single pulls follow the published rates", () => {
    const rand = seeded(1234);
    const n = 200_000;
    const counts: Record<string, number> = {};
    const perItem: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      // Pity held at 0, so only the rates decide.
      const { ids } = rollGacha(1, 0, rand);
      counts[rarity(ids[0])] = (counts[rarity(ids[0])] ?? 0) + 1;
      perItem[ids[0]] = (perItem[ids[0]] ?? 0) + 1;
    }
    for (const { r, p } of RARITY_RATES) {
      const seen = (counts[r] ?? 0) / n;
      // Five standard deviations.
      const tolerance = 5 * Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs(seen - p)).toBeLessThan(tolerance);
    }
    for (const { id, p } of itemOdds()) {
      const seen = (perItem[id] ?? 0) / n;
      expect(Math.abs(seen - p)).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / n));
    }
    // Every item of the pool can come, and nothing else.
    expect(Object.keys(perItem).sort()).toEqual(GACHA_POOL.map((i) => i.id).sort());
  });

  test("the published odds add up to one", () => {
    const total = itemOdds().reduce((sum, o) => sum + o.p, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test("pity: the PITY-th pull without a legendary is one, and pity starts over", () => {
    // Rolls that never come up legendary on their own.
    const unlucky = () => 0.99;
    let pity = 0;
    for (let i = 1; i < PITY; i++) {
      const r = rollGacha(1, pity, unlucky);
      expect(rarity(r.ids[0])).not.toBe("전설");
      pity = r.pity;
      expect(pity).toBe(i);
    }
    const last = rollGacha(1, pity, unlucky);
    expect(rarity(last.ids[0])).toBe("전설");
    expect(last.pity).toBe(0);
  });

  test("a natural legendary resets pity", () => {
    const r = rollGacha(1, 30, () => 0);
    expect(rarity(r.ids[0])).toBe("전설");
    expect(r.pity).toBe(0);
  });

  test("pity reached inside a ten-pull lands on the right pull", () => {
    const r = rollGacha(10, PITY - 4, () => 0.99);
    expect(r.ids.map(rarity).indexOf("전설")).toBe(3);
    expect(r.pity).toBe(6);
  });

  test("a ten-pull always holds at least one 희귀 or better", () => {
    const unlucky = rollGacha(10, 0, () => 0.99);
    expect(unlucky.ids.slice(0, 9).every((id) => rarity(id) === "일반")).toBe(true);
    expect(rarity(unlucky.ids[9])).toBe("희귀");
    const rand = seeded(99);
    for (let i = 0; i < 5000; i++) {
      const { ids } = rollGacha(10, 0, rand);
      expect(ids.length).toBe(10);
      expect(ids.some((id) => rarity(id) !== "일반")).toBe(true);
    }
  });
});
