import { MAIN_QUESTS, START_POS, ZONES, homeOf, spawnOf, villageOpen } from "../../src/shared/world";
import { editProfile, errorOf, goTo, inVillage, join, only, profileOf, walkTo } from "./helpers";

const c2q3 = MAIN_QUESTS.findIndex((q) => q.id === "c2q3");

describe("솔재 마을 (the second village)", () => {
  test("stands between the peak's east door and the kiln, safe, with an elder, a dyer and an altar", () => {
    const pass = ZONES.pass;
    expect(pass.safe).toBe(true);
    expect(ZONES.peak.portals.find((p) => p.to === "pass")).toBeTruthy();
    expect(ZONES.peak.portals.find((p) => p.to === "kiln")).toBeUndefined();
    expect(ZONES.kiln.portals.find((p) => p.to === "pass")).toBeTruthy();
    expect(pass.portals.map((p) => p.to).sort()).toEqual(["kiln", "peak"]);
    expect(pass.npcs.map((n) => n.role).sort()).toEqual(["altar", "dyer", "elder"]);
    // every gate leads back the way it came
    for (const p of pass.portals) expect(ZONES[p.to].portals.some((q) => q.to === "pass")).toBe(true);
  });

  test("past the peak you rise in 솔재, before it in 먹골", () => {
    for (const z of ["kiln", "temple", "censer", "pass"]) expect(homeOf(z)).toBe("pass");
    for (const z of ["village", "bamboo", "pond", "peak"]) expect(homeOf(z)).toBe("village");
  });

  test("opens to 순간이동 once the story sends you over the peak", () => {
    expect(villageOpen({ main: 0 }, "village")).toBe(true);
    expect(villageOpen({ main: c2q3 - 1 }, "pass")).toBe(false);
    expect(villageOpen({ main: c2q3 }, "pass")).toBe(true);
    expect(villageOpen({ main: c2q3 }, "kiln")).toBe(false);
  });

  test("순간이동: only from a village, only to an open one, into its spot, keeping your health", async (server) => {
    const entry = await inVillage(server, "test-a");
    expect(await errorOf(server.travel("pass"))).toContain("locked");
    expect(await errorOf(server.travel("kiln"))).toContain("bad_args");
    expect(await errorOf(server.travel("village"))).toContain("bad_args");
    expect(await errorOf(server.travel(7))).toContain("bad_args");
    await editProfile("test-a", (p) => ({ ...p, main: c2q3 }));
    await $room.updateMyState({ hp: 50 });
    const there = await server.travel("pass");
    const at = spawnOf("pass");
    expect([there.zone, there.channel, there.x, there.z]).toEqual(["pass", 1, at.x, at.z]);
    await join(server, "test-a", there, entry.roomId);
    const mine = await $room.getMyState();
    expect([mine.pose.x, mine.pose.z, mine.hp]).toEqual([at.x, at.z, 50]);
    // and back
    const back = await server.travel("village");
    expect([back.zone, back.x, back.z]).toEqual(["village", START_POS.x, START_POS.z]);
  });

  test("not from a hunting field", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, main: c2q3 }));
    expect(await errorOf(server.travel("pass"))).toContain("bad_args");
  });

  test("the way to the kiln runs through it, and falling at the kiln you rise there, whole", async (server) => {
    const entry = await goTo(server, "test-a", "kiln");
    expect(entry.roomId).toBe("ink-kiln-1");
    await walkTo(server, 0, 0);
    await $room.updateMyState({ hp: 1 });
    await only("kiln", "jar0", 0.8, 0);
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).dead).toBe(true);
    const back = await server.respawn();
    const at = spawnOf("pass");
    expect([back.zone, back.x, back.z]).toEqual(["pass", at.x, at.z]);
    await join(server, "test-a", back, entry.roomId);
    const mine = await $room.getMyState();
    expect([mine.dead, mine.hp]).toEqual([false, mine.maxHp]);
    expect((await profileOf("test-a")).zone).toBe("pass");
  });

  test("buys potions from 여울 as from 단이", async (server) => {
    await goTo(server, "test-a", "pass");
    const yeoul = ZONES.pass.npcs.find((n) => n.role === "dyer")!;
    await editProfile("test-a", (p) => ({ ...p, pigment: 500 }));
    await walkTo(server, yeoul.x + 1, yeoul.z);
    const p = await server.buyPotions(2);
    expect(p.potions).toBeGreaterThanOrEqual(2);
  });
});
