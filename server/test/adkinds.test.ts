import { maxHpFor } from "../../src/shared/combat";
import { ITEM, PITY } from "../../src/shared/items";
import { AD_DAILY, AD_DOUBLE_DAILY, AD_PULL_DAILY, AD_REVIVE_DAILY, DAILY_QUESTS, START_POS } from "../../src/shared/world";
import { NO_ROOM, editProfile, errorOf, inVillage, newPlayer, profileOf, rolling, walkTo } from "./helpers";

/** The verifier answers `answer` while `run` runs (the in-page server's hook, see server/src/ads.ts). */
async function verifier(answer: string, run: () => Promise<any>): Promise<any> {
  const g = globalThis as any;
  const before = g.$verifyAd;
  g.$verifyAd = async () => answer;
  try {
    return await run();
  } finally {
    g.$verifyAd = before;
  }
}

async function fall(): Promise<void> {
  await $room.updateMyState({ dead: true, hp: 0 });
}

const allClaimed = (q: any) => ({ ...q, daily: { ...q.daily, progress: DAILY_QUESTS.map(() => 999), claimed: DAILY_QUESTS.map(() => true) } });

describe("ad: revive in place", () => {
  test("stands the fallen up where they fell, whole, AD_REVIVE_DAILY times a day", async (server) => {
    await inVillage(server, "test-a");
    await walkTo(server, START_POS.x + 3, START_POS.z + 2);
    for (let i = 1; i <= AD_REVIVE_DAILY; i++) {
      await fall();
      const p = await server.adRevive(`revive-request-${i}`);
      const mine = await $room.getMyState();
      expect([mine.dead, mine.hp, mine.pose.x, mine.pose.z]).toEqual([false, maxHpFor(1), START_POS.x + 3, START_POS.z + 2]);
      expect([p.hp, p.adUse.revive]).toEqual([maxHpFor(1), i]);
    }
    await fall();
    expect(await errorOf(server.adRevive("revive-request-9"))).toContain("no_ads_left");
    expect((await $room.getMyState()).dead).toBe(true);
  });

  test("only for the fallen, in a room; once per requestId; bad ids refused", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.adRevive("revive-request-1"))).toContain("not_dead");
    await inVillage(server, "test-b");
    expect(await errorOf(server.adRevive("revive-request-1"))).toContain("not_dead");
    await fall();
    expect(await errorOf(server.adRevive("short"))).toContain("bad_args");
    expect(await errorOf(server.adRevive(12345678))).toContain("bad_args");
    await server.adRevive("revive-request-1");
    await fall();
    expect(await errorOf(server.adRevive("revive-request-1"))).toContain("already_claimed");
    expect((await profileOf("test-b")).adUse.revive).toBe(1);
  });

  test("an ad the verifier has not seen yet (pending) or refuses pays nothing", async (server) => {
    await inVillage(server, "test-a");
    await fall();
    expect(await verifier("pending", () => errorOf(server.adRevive("revive-request-1")))).toContain("not_ready");
    expect(await verifier("rejected", () => errorOf(server.adRevive("revive-request-1")))).toContain("bad_args");
    expect((await $room.getMyState()).dead).toBe(true);
    expect(await $global.countCollectionItems("adGrants")).toBe(0);
    // the same requestId once the verifier has it
    await verifier("verified", () => server.adRevive("revive-request-1"));
    expect((await $room.getMyState()).dead).toBe(false);
  });
});

describe("ad: daily double", () => {
  test("pays every daily reward again, once a day, only after all were handed in", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.adDailyDouble("double-request-1"))).toContain("quest_not_done");
    await editProfile("test-a", (q) => ({ ...q, daily: { ...q.daily, progress: [30, 15, 0] } }));
    await server.claimDailyAll();
    expect(await errorOf(server.adDailyDouble("double-request-1"))).toContain("quest_not_done");
    await editProfile("test-a", (q) => ({ ...allClaimed(q), pigment: 0, jade: 0, stones: 0, shards: 0 }));
    const p = await server.adDailyDouble("double-request-1");
    const sum = (k: "pigment" | "jade" | "stones" | "shards") => DAILY_QUESTS.reduce((n, q) => n + (q.reward[k] ?? 0), 0);
    expect([p.pigment, p.jade, p.stones, p.shards, p.adUse.double]).toEqual([sum("pigment"), sum("jade"), sum("stones"), sum("shards"), AD_DOUBLE_DAILY]);
    expect(await errorOf(server.adDailyDouble("double-request-2"))).toContain("no_ads_left");
    expect(await errorOf(server.adDailyDouble("double-request-1"))).toContain("no_ads_left");
  });

  test("a requestId already paid (any kind of ad) is not paid again", async (server) => {
    await newPlayer(server, "test-a");
    await server.claimAdReward("shared-request-1");
    await editProfile("test-a", allClaimed);
    expect(await errorOf(server.adDailyDouble("shared-request-1"))).toContain("already_claimed");
    expect((await profileOf("test-a")).adUse.double).toBe(0);
    expect(await verifier("pending", () => errorOf(server.adDailyDouble("double-request-1")))).toContain("not_ready");
  });

  test("starts over on a new KST day", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...allClaimed(q), adUse: { day: "2000-01-01", revive: AD_REVIVE_DAILY, double: AD_DOUBLE_DAILY, pull: AD_PULL_DAILY } }));
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect((await server.loadProfile()).adUse).toMatchObject({ revive: 0, double: 0, pull: 0 });
    expect((await server.adDailyDouble("double-request-1")).adUse.double).toBe(1);
  });
});

describe("ad: free pull", () => {
  test("one pull without jade, once a day, counted toward pity", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, jade: 0, pity: 3 }));
    const r = await rolling(0.99, () => server.adFreePull("pull-request-1"));
    expect([r.ids.length, r.pulls.length, r.pity, r.profile.jade, r.profile.adUse.pull]).toEqual([1, 1, 4, 0, 1]);
    expect(await errorOf(server.adFreePull("pull-request-2"))).toContain("no_ads_left");
    expect((await profileOf("test-a")).pity).toBe(4);
  });

  test("the pity pull: a legendary on the PITY-th", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, jade: 0, pity: PITY - 1 }));
    const r = await rolling(0.99, () => server.adFreePull("pull-request-1"));
    expect([ITEM[r.ids[0]].r, r.pity]).toEqual(["전설", 0]);
    expect((await profileOf("test-a")).owned).toContain(r.ids[0]);
  });

  test("refused without a verified ad, and the jade ad keeps its own count", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.adFreePull(""))).toContain("bad_args");
    expect(await verifier("rejected", () => errorOf(server.adFreePull("pull-request-1")))).toContain("bad_args");
    expect((await profileOf("test-a")).adUse.pull).toBe(0);
    await server.adFreePull("pull-request-1");
    expect(await errorOf(server.adFreePull("pull-request-1"))).toContain("no_ads_left");
    const p = await server.claimAdReward("jade-request-1");
    expect([p.adsLeft, p.adUse.pull]).toEqual([AD_DAILY - 1, 1]);
    expect(await errorOf(server.claimAdReward("pull-request-1"))).toContain("already_claimed");
  });
});
