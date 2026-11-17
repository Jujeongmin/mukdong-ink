import { attackFor } from "../../src/shared/combat";
import { enhancedAtk } from "../../src/shared/growth";
import { COST1, GACHA_ENTRIES, ITEM } from "../../src/shared/items";
import { editProfile, errorOf, inVillage, newPlayer, profileOf, rolling } from "./helpers";

/** The roll that picks `id` within its rarity's list of the pool. */
function pick(id: string): number {
  const list = GACHA_ENTRIES.filter((e) => e.r === ITEM[id].r);
  return (list.findIndex((e) => e.id === id) + 0.5) / list.length;
}

describe("swords", () => {
  test("come from the altar like any item", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, jade: COST1 * 2 }));
    // 0.9 → 일반, then the 먹칼 within the commons.
    const common = await rolling([0.9, pick("w_inkblade")], () => server.pullGacha(1));
    expect([common.ids, common.dupes]).toEqual([["w_inkblade"], [false]]);
    // 0 → 전설, then the 칠흑검.
    const legend = await rolling([0, pick("w_voidblade")], () => server.pullGacha(1));
    expect(legend.ids).toEqual(["w_voidblade"]);
    expect(legend.profile.owned.includes("w_inkblade") && legend.profile.owned.includes("w_voidblade")).toBe(true);
  });

  test("are equipped like a brush, and the room sees the sword", async (server) => {
    await inVillage(server, "test-a");
    expect(await errorOf(server.equip("w_reedblade"))).toContain("not_owned");
    await editProfile("test-a", (q) => ({ ...q, owned: [...q.owned, "w_reedblade"] }));
    const p = await server.equip("w_reedblade");
    expect([p.equip.weapon, p.atk]).toEqual(["w_reedblade", attackFor(1, ITEM.w_reedblade.atk!)]);
    expect((await $room.getMyState()).look.weapon).toBe("w_reedblade");
  });

  test("are enhanced like a brush, keyed by their own id", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({
      ...q, owned: [...q.owned, "w_inkblade"], equip: { ...q.equip, weapon: "w_inkblade" }, stones: 10, pigment: 100, enh: { w_brush: 2 },
    }));
    const r = await rolling(0, () => server.enhance("w_inkblade", false));
    expect([r.outcome, r.plus, r.profile.enh]).toEqual(["success", 1, { w_brush: 2, w_inkblade: 1 }]);
    expect(r.profile.atk).toBe(attackFor(1, enhancedAtk(11, 1)));
    expect((await $room.getMyState()).look.plus).toBe(1);
  });

  test("a sword broken at +12 is gone and the starter brush is back in hand, with its own level", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({
      ...q, owned: [...q.owned, "w_voidblade"], equip: { ...q.equip, weapon: "w_voidblade" }, stones: 100, pigment: 1000,
      enh: { w_voidblade: 12, w_brush: 3 },
    }));
    const r = await rolling([0.99, 0], () => server.enhance("w_voidblade", false));
    expect([r.outcome, r.plus, r.profile.owned.includes("w_voidblade"), r.profile.equip.weapon, r.profile.enh]).toEqual([
      "destroyed", 0, false, "w_brush", { w_brush: 3 },
    ]);
    expect((await $room.getMyState()).look).toMatchObject({ weapon: "w_brush", plus: 3 });
    expect((await profileOf("test-a")).owned.includes("w_voidblade")).toBe(false);
  });
});
