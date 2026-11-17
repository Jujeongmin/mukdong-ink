import { AD_DAILY, AD_REWARD_JADE, JADE_PRODUCTS } from "../../src/shared/world";
import { NO_ROOM, editProfile, errorOf, newPlayer, profileOf } from "./helpers";

const BUYER = "0x1111111111111111111111111111111111111111";
const purchase = (purchaseId: number, productId = "jade-300", quantity = 1, account = BUYER) => ({ account, purchaseId, productId, quantity });

describe("VXShop purchases", () => {
  test("the same receipt twice pays once and still reports success", async (server) => {
    expect(await server.$onItemPurchased(purchase(1))).toEqual({ success: true, code: "granted" });
    expect(await server.$onItemPurchased(purchase(1))).toEqual({ success: true, code: "already_granted" });
    expect(await $global.countCollectionItems("purchases")).toBe(1);
    // Bought before ever playing: the profile is made for it.
    expect((await profileOf(BUYER)).jade).toBe(300);
    await server.$onItemPurchased(purchase(2, "jade-1100", 2));
    expect((await profileOf(BUYER)).jade).toBe(300 + 2 * 1100);
  });

  test("every listed product pays its jade", async (server) => {
    let id = 10;
    let total = 0;
    for (const product of JADE_PRODUCTS) {
      await server.$onItemPurchased(purchase(id++, product.productId));
      total += product.jade;
    }
    expect((await profileOf(BUYER)).jade).toBe(total);
  });

  test("a grant that fails before any jade is paid gives the receipt back for the retry", async (server) => {
    const real = $global.updateUserState;
    $global.updateUserState = async (account: string, state: Record<string, any>) => {
      if (state.profile && state.profile.jade > 0) throw new Error("write failed");
      return real.call($global, account, state);
    };
    try {
      expect(await errorOf(server.$onItemPurchased(purchase(8)))).toContain("write failed");
    } finally {
      $global.updateUserState = real;
    }
    expect(await $global.countCollectionItems("purchases")).toBe(0);
    expect(await server.$onItemPurchased(purchase(8))).toEqual({ success: true, code: "granted" });
    expect((await profileOf(BUYER)).jade).toBe(300);
  });

  test("turns away products it does not sell and broken events", async (server) => {
    expect((await server.$onItemPurchased(purchase(3, "gold-pack"))).success).toBe(false);
    expect((await server.$onItemPurchased({ account: BUYER })).success).toBe(false);
    expect((await server.$onItemPurchased({ ...purchase(4), quantity: 0 })).success).toBe(false);
    expect(await $global.countCollectionItems("purchases")).toBe(0);
  });

  test("pays the account on the event, never the caller", async (server) => {
    await newPlayer(server, "test-a");
    await server.$onItemPurchased(purchase(5, "jade-300", 1, "test-b"));
    expect((await profileOf("test-a")).jade).toBe(0);
    expect((await profileOf("test-b")).jade).toBe(300);
  });
});

describe("rewarded ads", () => {
  test("pay AD_REWARD_JADE once per requestId, AD_DAILY times a day", async (server) => {
    await newPlayer(server, "test-a");
    const first = await server.claimAdReward("request-0001");
    expect([first.jade, first.adsLeft]).toEqual([AD_REWARD_JADE, AD_DAILY - 1]);
    expect(await errorOf(server.claimAdReward("request-0001"))).toContain("already_claimed");
    for (let i = 2; i <= AD_DAILY; i++) await server.claimAdReward(`request-000${i}`);
    expect((await profileOf("test-a")).jade).toBe(AD_REWARD_JADE * AD_DAILY);
    expect(await errorOf(server.claimAdReward("request-0009"))).toContain("no_ads_left");
    expect(await errorOf(server.claimAdReward(""))).toContain("bad_args");
    expect(await errorOf(server.claimAdReward(12345678))).toContain("bad_args");
  });

  test("start over on a new KST day", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, adsLeft: 0 }));
    expect(await errorOf(server.claimAdReward("request-a"))).toContain("no_ads_left");
    await editProfile("test-a", (q) => ({ ...q, adsDay: "2000-01-01" }));
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect((await server.claimAdReward("request-a")).adsLeft).toBe(AD_DAILY - 1);
  });

  test("a requestId paid to one account is not paid to another", async (server) => {
    await newPlayer(server, "test-a");
    await server.claimAdReward("request-shared");
    await newPlayer(server, "test-b");
    expect(await errorOf(server.claimAdReward("request-shared"))).toContain("already_claimed");
  });
});
