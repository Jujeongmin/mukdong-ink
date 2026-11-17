import { POTION_COST, POTION_HEAL, maxHpFor } from "../../src/shared/combat";
import { COST1, COST10, DUPE_PIGMENT, DYES, DYE_COST, ITEM, PITY } from "../../src/shared/items";
import { MAIN_QUESTS, ZONES } from "../../src/shared/world";
import { NO_ROOM, editProfile, errorOf, goTo, inVillage, newPlayer, profileOf, rolling, walkTo } from "./helpers";

const questIndex = (id: string) => MAIN_QUESTS.findIndex((q) => q.id === id);

const dyer = ZONES.village.npcs.find((n) => n.id === "dyer")!;

describe("potions", () => {
  test("heal part of your health, one at a time, while you have any", async (server) => {
    await goTo(server, "test-a", "bamboo");
    const max = maxHpFor(1);
    await $room.updateMyState({ hp: 10 });
    const p = await server.usePotion();
    expect(p.potions).toBe(2);
    expect(p.hp).toBe(Math.min(max, Math.round(10 + max * POTION_HEAL)));
    expect((await $room.getMyState()).hp).toBe(p.hp);
    expect(await errorOf(server.usePotion())).toContain("on_cooldown");
    await editProfile("test-a", (q) => ({ ...q, potions: 0 }));
    await $room.updateMyState({ potAt: 0 });
    expect(await errorOf(server.usePotion())).toContain("no_currency");
    await $room.updateMyState({ dead: true });
    expect(await errorOf(server.usePotion())).toContain("dead");
  });

  test("never past full health", async (server) => {
    await inVillage(server, "test-a");
    expect((await server.usePotion()).hp).toBe(maxHpFor(1));
  });

  test("are bought from the dyer, standing near, for pigment", async (server) => {
    await inVillage(server, "test-a");
    expect(await errorOf(server.buyPotions(2))).toContain("too_far");
    await walkTo(server, dyer.x + 1, dyer.z);
    expect(await errorOf(server.buyPotions(2))).toContain("no_currency");
    expect(await errorOf(server.buyPotions(0))).toContain("bad_args");
    expect(await errorOf(server.buyPotions(1.5))).toContain("bad_args");
    await editProfile("test-a", (q) => ({ ...q, pigment: 100 }));
    const p = await server.buyPotions(2);
    expect([p.potions, p.pigment]).toEqual([5, 100 - 2 * POTION_COST]);
  });

  test("are not sold outside the village", async (server) => {
    await goTo(server, "test-a", "bamboo");
    expect(await errorOf(server.buyPotions(1))).toContain("too_far");
  });
});

describe("gear", () => {
  test("equips only what you own, and the room sees it", async (server) => {
    await inVillage(server, "test-a");
    expect(await errorOf(server.equip("w_gold"))).toContain("not_owned");
    expect(await errorOf(server.equip("nothing"))).toContain("bad_args");
    const p = await server.equip("h_satgat");
    expect(p.equip.hat).toBe("h_satgat");
    expect((await $room.getMyState()).look.hat).toBe("h_satgat");
    await editProfile("test-a", (q) => ({ ...q, owned: [...q.owned, "w_gold"] }));
    const armed = await server.equip("w_gold");
    expect(armed.atk).toBe(ITEM.w_gold.atk);
  });

  test("dyes with a listed color for pigment; washing back to ink is free", async (server) => {
    await inVillage(server, "test-a");
    const red = DYES.find((d) => d.name === "다홍")!.hex;
    expect(await errorOf(server.dye("sash", 0x123456))).toContain("bad_args");
    expect(await errorOf(server.dye("hat", red))).toContain("bad_args");
    expect(await errorOf(server.dye("sash", red))).toContain("no_currency");
    await editProfile("test-a", (q) => ({ ...q, pigment: DYE_COST + 5 }));
    const p = await server.dye("sash", red);
    expect([p.dye.sash, p.pigment]).toEqual([red, 5]);
    expect((await $room.getMyState()).look.sashDye).toBe(red);
    const washed = await server.dye("scarf", null);
    expect([washed.dye.scarf, washed.pigment]).toEqual([null, 5]);
  });
});

describe("the brush altar", () => {
  test("costs jade, keeps new items, turns repeats into pigment", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.pullGacha(1))).toContain("no_currency");
    expect(await errorOf(server.pullGacha(5))).toContain("bad_args");
    await editProfile("test-a", (q) => ({ ...q, jade: COST1 * 2 }));
    // 0.9 → 일반; the second roll picks the item: the first common (w_brush, already owned).
    const first = await rolling([0.9, 0], () => server.pullGacha(1));
    expect([first.ids, first.dupes, first.pity]).toEqual([["w_brush"], [true], 1]);
    expect([first.profile.jade, first.profile.pigment]).toEqual([COST1, DUPE_PIGMENT]);
    // 0.0 → 전설, the gold brush: new.
    const second = await rolling([0, 0], () => server.pullGacha(1));
    expect([second.ids, second.dupes, second.pity]).toEqual([["w_gold"], [false], 0]);
    expect(second.profile.owned).toContain("w_gold");
    expect((await profileOf("test-a")).pity).toBe(0);
  });

  test("pity: the PITY-th pull without a legendary is one", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, jade: COST1, pity: PITY - 1 }));
    const r = await rolling(0.99, () => server.pullGacha(1));
    expect(ITEM[r.ids[0]].r).toBe("전설");
    expect(r.pity).toBe(0);
  });

  test("a ten-pull costs COST10 and holds at least one 희귀 or better", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, jade: COST10 }));
    const r = await rolling(0.99, () => server.pullGacha(10));
    expect(r.ids.length).toBe(10);
    expect(r.ids.slice(0, 9).every((id: string) => ITEM[id].r === "일반")).toBe(true);
    expect(ITEM[r.ids[9]].r).toBe("희귀");
    expect(r.profile.jade).toBe(0);
    expect(r.pity).toBe(10);
  });
});

describe("talking and quests", () => {
  test("a quest is accepted from its giver and handed in to its turn-in NPC, close by, once", async (server) => {
    // The first quest: 먹노인 sends you to the bamboo grove; 바람이 takes it in.
    expect([MAIN_QUESTS[0].id, MAIN_QUESTS[0].giver, MAIN_QUESTS[0].turnIn]).toEqual(["c1q3", "elder", "baram"]);
    await inVillage(server, "test-a");
    const elder = ZONES.village.npcs.find((n) => n.id === "elder")!;
    expect(await errorOf(server.acceptMain("elder"))).toContain("too_far");
    expect(await errorOf(server.talk("ghost"))).toContain("bad_args");
    await walkTo(server, elder.x + 1, elder.z);
    expect(await errorOf(server.claimMain("elder"))).toContain("bad_args"); // not the turn-in NPC
    expect((await server.acceptMain("elder")).mainAccepted).toBe(true);
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (q) => ({ ...q, mainProgress: 8 }));
    const baram = ZONES.bamboo.npcs.find((n) => n.id === "baram")!;
    await walkTo(server, baram.x + 1, baram.z);
    expect(await errorOf(server.acceptMain("baram"))).toContain("bad_args"); // not the giver of quest 1
    const p = await server.claimMain("baram");
    // It carries the removed intro quests' potions and pigment.
    expect([p.main, p.mainAccepted, p.mainProgress, p.pigment, p.potions, p.level > 1]).toEqual([1, false, 0, 130, 6, true]);
    expect(await errorOf(server.claimMain("baram"))).toContain("quest_not_done"); // quest 2 not accepted yet
  });

  test("progress only counts after accepting; levels and reaching a zone count as done", async (server) => {
    await newPlayer(server, "test-a");
    // c1q4: reach level 4, from and to 바람이 in the bamboo grove — not accepted yet
    await editProfile("test-a", (q) => ({ ...q, main: questIndex("c1q4"), level: 4 }));
    await goTo(server, "test-a", "bamboo");
    const baram = ZONES.bamboo.npcs.find((n) => n.id === "baram")!;
    await walkTo(server, baram.x + 1, baram.z);
    expect(await errorOf(server.claimMain("baram"))).toContain("quest_not_done");
    await server.acceptMain("baram");
    expect((await server.claimMain("baram")).main).toBe(questIndex("c1q5"));
    // c1q6: reach the pond, hand in to 노을 there
    await editProfile("test-a", (q) => ({ ...q, main: questIndex("c1q6"), mainAccepted: true, mainProgress: 0 }));
    await goTo(server, "test-a", "pond");
    expect((await profileOf("test-a")).mainProgress).toBe(1);
    const noeul = ZONES.pond.npcs.find((n) => n.id === "noeul")!;
    await walkTo(server, noeul.x + 1, noeul.z);
    expect((await server.claimMain("noeul")).main).toBe(questIndex("c1q7"));
  });

  test("past the last main quest there is nothing to claim", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, main: MAIN_QUESTS.length }));
    const elder = ZONES.village.npcs.find((n) => n.id === "elder")!;
    await walkTo(server, elder.x + 1, elder.z);
    expect(await errorOf(server.claimMain("elder"))).toContain("already_claimed");
  });
});

describe("daily quests", () => {
  test("pay once when done, and start over on a new KST day", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.claimDaily(0))).toContain("quest_not_done");
    expect(await errorOf(server.claimDaily(3))).toContain("bad_args");
    const p0 = await profileOf("test-a");
    await editProfile("test-a", (q) => ({ ...q, daily: { ...q.daily, progress: [30, 0, 0] } }));
    const p = await server.claimDaily(0);
    expect([p.pigment, p.daily.claimed[0]]).toEqual([80, true]);
    expect(await errorOf(server.claimDaily(0))).toContain("already_claimed");
    // Yesterday's day: everything starts over.
    await editProfile("test-a", (q) => ({ ...q, daily: { ...q.daily, day: "2000-01-01" } }));
    server.connect({ account: "test-a", roomId: NO_ROOM });
    const next = await server.loadProfile();
    expect([next.daily.day, next.daily.progress, next.daily.claimed]).toEqual([p0.daily.day, [0, 0, 0], [false, false, false]]);
  });
});
