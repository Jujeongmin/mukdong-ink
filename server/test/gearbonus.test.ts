import { cdMulOf, maxHpOf, starterProfile } from "../../src/shared/profile";
import { maxHpFor } from "../../src/shared/combat";
import { gearBonusText, hatHpBonus, sashCdCut } from "../../src/shared/items";
import { editProfile, inVillage } from "./helpers";

describe("머리·띠 능력치", () => {
  test("hats add health by grade; the bare head adds nothing", () => {
    const p = { ...starterProfile("붓잡이", 0), level: 10 };
    expect(maxHpOf(p)).toBe(maxHpFor(10));
    expect(maxHpOf({ ...p, equip: { ...p.equip, hat: "h_goldgat" } })).toBe(Math.round(maxHpFor(10) * 1.16));
    expect(hatHpBonus("h_satgat")).toBe(0.02);
    expect(hatHpBonus("s_gold")).toBe(0);
  });

  test("sashes cut 검법 cooldowns by grade; the starting sash cuts nothing", () => {
    const p = starterProfile("붓잡이", 0);
    expect(cdMulOf(p)).toBe(1);
    expect(cdMulOf({ ...p, equip: { ...p.equip, sash: "s_red" } })).toBeCloseTo(0.92);
    expect(sashCdCut("h_gat")).toBe(0);
    expect(gearBonusText("s_indigo")).toBe("재사용 -4%");
    expect(gearBonusText("h_mask")).toBe("생명 +10%");
    expect(gearBonusText("w_brush")).toBe("");
  });

  test("the server's view carries the hat's health", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, owned: [...q.owned, "h_goldgat"] }));
    const before = (await server.loadProfile()).maxHp;
    const after = await server.equip("h_goldgat");
    expect(after.maxHp).toBe(Math.round(before * 1.16));
  });
});
