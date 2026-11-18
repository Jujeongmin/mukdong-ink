import { rankKey } from "../../src/shared/rank";
import { powerOf, starterProfile } from "../../src/shared/profile";
import { syncRank } from "../src/store";
import { editProfile, errorOf, newPlayer, profileOf } from "./helpers";

describe("전투력과 랭킹", () => {
  test("전투력 rises with level, enhancement, training, a better hat and 염색 조화", () => {
    const base = { ...starterProfile("붓잡이", 0), level: 8 };
    const p = powerOf(base);
    expect(powerOf({ ...base, level: 9 })).toBeGreaterThan(p);
    expect(powerOf({ ...base, enh: { w_brush: 3 } })).toBeGreaterThan(p);
    expect(powerOf({ ...base, skills: [3, 1, 1, 1, 1] })).toBeGreaterThan(p);
    expect(powerOf({ ...base, equip: { ...base.equip, hat: "h_goldgat" } })).toBeGreaterThan(p);
    expect(powerOf({ ...base, dye: { scarf: 0xc0281c, sash: 0xc0281c } })).toBeGreaterThan(powerOf({ ...base, dye: { scarf: 0xc0281c, sash: 0x2a4f8a } }));
  });

  test("every enhancement step raises 전투력 (even where 공격 rounds to the same number)", () => {
    const base = { ...starterProfile("붓잡이", 0), level: 8 };
    let last = -1;
    for (let plus = 0; plus <= 15; plus++) {
      const v = powerOf({ ...base, enh: { w_brush: plus } });
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });

  test("keys: more power wins; the same power goes to whoever got there first", () => {
    const t = Date.UTC(2026, 10, 18);
    expect(rankKey(5000, t + 1000)).toBeGreaterThan(rankKey(4999, t));
    expect(rankKey(5000, t)).toBeGreaterThan(rankKey(5000, t + 1000));
    expect(Number.isSafeInteger(rankKey(800000, t))).toBe(true);
  });

  test("the board: by 전투력, names only, and your own line", async (server) => {
    const at = async (account: string, lv: number) => {
      await newPlayer(server, account);
      const p = await profileOf(account);
      await syncRank(account, null, { ...p, level: lv });
    };
    await at("test-a", 5);
    await at("test-b", 9);
    await at("test-c", 7);
    server.connect({ account: "test-a", roomId: "__no_room__" });
    const v = await server.rankings("power");
    const values = v.top.map((r: any) => r.value);
    expect(values).toEqual([...values].sort((a: number, b: number) => b - a));
    expect(v.top).toHaveLength(3);
    expect(v.top[2].me).toBe(true);
    for (const r of v.top) expect(Object.keys(r).sort()).toEqual(["me", "name", "rank", "value"]);
    expect(await errorOf(server.rankings("level"))).toContain("bad_args");
  });

  test("a level-1 player isn't put on the board", async (server) => {
    await newPlayer(server, "test-d");
    await syncRank("test-d", null, await profileOf("test-d"));
    expect((await server.rankings("power")).mine).toBeNull();
  });

  test("on entry an older player is put on the board, at their current 전투력", async (server) => {
    await newPlayer(server, "test-e");
    await editProfile("test-e", (q) => ({ ...q, level: 6 }));
    const view = await server.loadProfile();
    const v = await server.rankings("power");
    expect(v.mine?.value).toBe(view.power);
  });
});
