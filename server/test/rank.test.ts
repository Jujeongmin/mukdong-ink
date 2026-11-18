import { rankKey } from "../../src/shared/rank";
import { syncRank } from "../src/store";
import { editProfile, errorOf, newPlayer, profileOf } from "./helpers";

describe("랭킹", () => {
  test("keys: a higher level wins; the same level goes to whoever got there first", () => {
    expect(rankKey(5, 2000)).toBeGreaterThan(rankKey(4, 1000));
    expect(rankKey(5, 1000)).toBeGreaterThan(rankKey(5, 2000));
  });

  test("the 경지 board: ordered, names only, and your own line", async (server) => {
    const level = async (account: string, lv: number) => {
      await newPlayer(server, account);
      const p = await profileOf(account);
      await syncRank(account, null, { ...p, level: lv });
    };
    await level("test-a", 5);
    await level("test-b", 9);
    await level("test-c", 7);
    server.connect({ account: "test-a", roomId: "__no_room__" });
    const lv = await server.rankings("level");
    expect(lv.top.map((r: any) => r.value)).toEqual([9, 7, 5]);
    expect(lv.top[2].me).toBe(true);
    // names only: no account ids anywhere in a row
    for (const r of lv.top) expect(Object.keys(r).sort()).toEqual(["me", "name", "rank", "value"]);
    expect(await errorOf(server.rankings("book"))).toContain("bad_args");
  });

  test("a level-1 player isn't put on the board", async (server) => {
    await newPlayer(server, "test-d");
    const p = await profileOf("test-d");
    await syncRank("test-d", null, p);
    const v = await server.rankings("level");
    expect(v.mine).toBeNull();
  });

  test("an older player is put on the board when they come in", async (server) => {
    await newPlayer(server, "test-e");
    await editProfile("test-e", (q) => ({ ...q, level: 6 }));
    await server.loadProfile();
    const v = await server.rankings("level");
    expect(v.mine?.value).toBe(6);
  });
});
