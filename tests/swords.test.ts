import { describe, expect, test } from "vitest";
import { UNBREAKABLE } from "../src/shared/growth";
import { GACHA_ENTRIES, ITEM, ITEMS, RARITY_RATES, STARTER_EQUIP, itemOdds, rollGacha } from "../src/shared/items";

const SWORDS = ["w_inkblade", "w_reedblade", "w_rainblade", "w_nightblade", "w_voidblade"];

describe("the sword family", () => {
  test("five swords, in the weapons2 sheet in order, every weapon marked brush or sword", () => {
    expect(SWORDS.map((id) => [ITEM[id].name, ITEM[id].r, ITEM[id].atk, ITEM[id].atlas, ITEM[id].icon, ITEM[id].kind])).toEqual([
      ["먹칼", "일반", 11, "weapons2", 0, "sword"],
      ["갈대검", "희귀", 14, "weapons2", 1, "sword"],
      ["빗줄기검", "영웅", 18, "weapons2", 2, "sword"],
      ["달밤검", "영웅", 18, "weapons2", 3, "sword"],
      ["칠흑검", "전설", 24, "weapons2", 4, "sword"],
    ]);
    for (const item of ITEMS.filter((i) => i.slot === "weapon")) expect(["brush", "sword"]).toContain(item.kind);
    expect(ITEMS.filter((i) => i.kind === "brush").every((i) => i.atlas === undefined)).toBe(true);
    // The hero's default and the one that never breaks stay the brush.
    expect([STARTER_EQUIP.weapon, ITEM[UNBREAKABLE].kind]).toEqual(["w_brush", "brush"]);
    // Color accents only on 영웅/전설.
    for (const id of SWORDS) if (ITEM[id].r === "일반" || ITEM[id].r === "희귀") expect(ITEM[id].tint).toBeUndefined();
  });

  test("the published odds include the swords, spread within their rarity, and add up to one", () => {
    const odds = itemOdds();
    expect(odds.reduce((sum, o) => sum + o.p, 0)).toBeCloseTo(1, 10);
    for (const id of SWORDS) {
      const o = odds.find((x) => x.id === id)!;
      const rate = RARITY_RATES.find((r) => r.r === ITEM[id].r)!.p;
      expect(o.p).toBeCloseTo(rate / GACHA_ENTRIES.filter((e) => e.r === ITEM[id].r).length, 12);
    }
    expect(odds.length).toBe(GACHA_ENTRIES.length);
  });

  test("every sword comes out of the altar", () => {
    let a = 42;
    const rand = () => {
      a = (a * 1103515245 + 12345) % 2147483648;
      return a / 2147483648;
    };
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) for (const id of rollGacha(1, 0, rand).ids) seen.add(id);
    for (const id of SWORDS) expect(seen.has(id)).toBe(true);
  });
});
