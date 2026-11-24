import { MONSTERS, ULT_MAX, ULT_MUL, ULT_PER_HIT, ULT_PER_KILL, ULT_RADIUS, attackFor, ultGain } from "../../src/shared/combat";
import { MAIN_QUESTS, ZONES, ultOpen } from "../../src/shared/world";
import { editProfile, errorOf, goTo, join, only, profileOf, walkTo } from "./helpers";

const after1 = MAIN_QUESTS.findIndex((q) => q.id === "c1q10") + 1;
const at = (x = 0, z = 0) => ({ x, z, yaw: 0 });

async function ready(server: any, x = 0, z = 0): Promise<void> {
  await walkTo(server, x, z);
  await $room.updateMyState({ atkAt: 0, cds: [] });
}

describe("궁극기 「무지개 붓질」", () => {
  test("is there from the first level", () => {
    expect(ultOpen({ main: 0 })).toBe(true);
    expect(ultGain(10, 0)).toBe(8);
    expect(ultGain(1, 1)).toBe(ULT_PER_HIT + ULT_PER_KILL);
  });

  test("a brand-new player fills the gauge and can use it", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await only("bamboo", "blob0", 1.5, 0, { hp: 5 });
    await ready(server);
    const r = await server.attack({ kind: 1, ...at() });
    expect(r.hits[0].kill).toBe(true);
    expect(r.ult).toBe(ULT_PER_HIT + ULT_PER_KILL);
    await $room.updateMyState({ ult: ULT_MAX });
    expect((await server.ultimate(at())).ult).toBe(0);
  });

  test("strikes and kills fill the gauge; a kill keeps it in the profile", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, main: after1 }));
    await only("bamboo", "blob0", 1.5, 0, { hp: 5 });
    await ready(server);
    const r = await server.attack({ kind: 1, ...at() });
    expect(r.ult).toBe(ULT_PER_HIT + ULT_PER_KILL);
    expect((await $room.getMyState()).ult).toBe(r.ult);
    expect((await profileOf("test-a")).ult).toBe(r.ult);
  });

  test("full: a ring around you strikes everything in reach for ULT_MUL × attack, empties the gauge", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, main: after1 }));
    await only("bamboo", "shade0", ULT_RADIUS - 1, 0, { hp: 99999, maxHp: 99999 });
    await ready(server);
    expect(await errorOf(server.ultimate(at()))).toContain("on_cooldown");
    await $room.updateMyState({ ult: ULT_MAX });
    const r = await server.ultimate(at());
    expect(r.hits).toEqual([{ id: "shade0", dmg: Math.round(attackFor(1, 10) * ULT_MUL), kill: false }]);
    expect(r.ult).toBe(0);
    const mine = await $room.getMyState();
    expect(mine.ult).toBe(0);
    expect(await errorOf(server.ultimate(at()))).toContain("on_cooldown");
  });

  test("while it lasts nothing touches you", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, main: after1 }));
    await ready(server);
    await $room.updateMyState({ ult: ULT_MAX });
    await server.ultimate(at());
    // a blob pressed against you right after (the ring threw the first ones back)
    await only("bamboo", "blob0", 0.8, 0);
    const before = (await $room.getMyState()).hp;
    for (let i = 0; i < 6; i++) await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(before);
    // the same blob, the 궁극기 long over: it lands
    await $room.updateMyState({ ultAt: 0 });
    await only("bamboo", "blob0", 0.8, 0);
    for (let i = 0; i < 6; i++) await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBeLessThan(before);
    void MONSTERS;
  });

  test("the gauge goes with you through a portal", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, main: after1 }));
    await $room.updateMyState({ ult: 40 });
    const gate = ZONES.bamboo.portals.find((p) => p.to === "pond")!;
    await walkTo(server, gate.x, gate.z);
    const next = await join(server, "test-a", await server.enterZone("pond"), entry.roomId);
    expect((await $room.getMyState()).ult).toBe(40);
    void next;
  });
});
