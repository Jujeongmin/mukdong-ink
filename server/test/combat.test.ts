import { BASIC, MONSTERS, SKILLS, attackFor, expToNext, killExp, maxHpFor } from "../../src/shared/combat";
import { DAILY_QUESTS, MAIN_QUESTS } from "../../src/shared/world";
import { editProfile, errorOf, goTo, inVillage, only, profileOf, walkTo } from "./helpers";

// Facing +x (yaw 0), a blob 1.5 m ahead.
const AHEAD = { x: 1.5, z: 0 };
const swing = (kind = 1, x = 0, z = 0) => ({ kind, x, z, yaw: 0 });
const cast = (skill: number, x = 0, z = 0) => ({ skill, x, z, yaw: 0 });

async function readyAt(server: any, x = 0, z = 0): Promise<void> {
  await walkTo(server, x, z);
  await $room.updateMyState({ atkAt: 0, cds: [] });
}

describe("attacks", () => {
  test("a swing hits what is in its arc and pays for a kill: exp, pigment, quest progress", async (server) => {
    await goTo(server, "test-a", "bamboo");
    // On the (accepted) blob quest.
    await editProfile("test-a", (p) => ({ ...p, main: MAIN_QUESTS.findIndex((q) => q.id === "c1q3"), mainAccepted: true, mainProgress: 0 }));
    const blob = await only("bamboo", "blob0", AHEAD.x, AHEAD.z, { hp: 5, level: 2 });
    await readyAt(server);
    const result = await server.attack(swing(1));
    expect(result.hits).toEqual([{ id: "blob0", dmg: attackFor(1, 10) * BASIC[1].dmg, kill: true }]);
    expect([result.exp, result.pigment, result.jade, result.levelUp]).toEqual([killExp(MONSTERS.blob, 2), MONSTERS.blob.pigment, 0, false]);
    const p = await profileOf("test-a");
    expect([p.exp, p.pigment, p.mainProgress]).toEqual([killExp(MONSTERS.blob, 2), MONSTERS.blob.pigment, 1]);
    expect(p.daily.progress[0]).toBe(1);
    const { monsters } = await $room.getRoomState();
    expect([monsters.blob0.mode, monsters.blob0.hp]).toEqual(["dead", 0]);
    void blob;
  });

  test("a wounded monster turns on whoever struck it", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await only("bamboo", "blob0", AHEAD.x, AHEAD.z, { hp: 40 });
    await readyAt(server);
    const result = await server.attack(swing(1));
    expect(result.hits[0].kill).toBe(false);
    const { monsters } = await $room.getRoomState();
    expect([monsters.blob0.hp, monsters.blob0.mode, monsters.blob0.tg]).toEqual([40 - result.hits[0].dmg, "chase", "test-a"]);
  });

  test("misses what is out of reach or behind you", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await only("bamboo", "blob0", 8, 0);
    await readyAt(server);
    expect((await server.attack(swing(1))).hits).toEqual([]);
    await only("bamboo", "blob0", -2.5, 0);
    await readyAt(server);
    expect((await server.attack(swing(1))).hits).toEqual([]);
    // The spin reaches all round.
    await readyAt(server);
    expect((await server.attack(swing(3))).hits.length).toBe(1);
  });

  test("the reported spot is held to walking pace from the last pose", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await only("bamboo", "blob0", 21.5, 0);
    await readyAt(server);
    // 20 m away a moment after the last pose: struck from where you can be, it misses.
    expect((await server.attack(swing(1, 20, 0))).hits).toEqual([]);
  });

  test("two swings closer than BASIC_MIN_GAP: the second is refused", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await readyAt(server);
    await server.attack(swing(1));
    expect(await errorOf(server.attack(swing(2)))).toContain("on_cooldown");
    expect(await errorOf(server.attack({ kind: 9, x: 0, z: 0, yaw: 0 }))).toContain("bad_args");
    expect(await errorOf(server.attack({ kind: 1, x: 0, z: 0 }))).toContain("bad_args");
  });

  test("the fallen cannot attack", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await $room.updateMyState({ dead: true, hp: 0 });
    expect(await errorOf(server.attack(swing(1)))).toContain("dead");
    expect(await errorOf(server.castSkill(cast(0)))).toContain("dead");
  });

  test("attacks need a room you arrived in; the village has nothing to hit", async (server) => {
    await inVillage(server, "test-a");
    await readyAt(server);
    expect(await server.attack(swing(1))).toEqual({ hits: [], exp: 0, pigment: 0, jade: 0, stones: 0, shards: 0, levelUp: false, ult: 0 });
  });

  test("a kill past the level's exp levels you up: more health, healed to full, shown in the room", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, exp: expToNext(1) - 1, hp: 10 }));
    await $room.updateMyState({ hp: 10 });
    await only("bamboo", "blob0", AHEAD.x, AHEAD.z, { hp: 1 });
    await readyAt(server);
    const result = await server.attack(swing(1));
    expect(result.levelUp).toBe(true);
    const p = await profileOf("test-a");
    expect([p.level, p.hp]).toEqual([2, maxHpFor(2)]);
    const mine = await $room.getMyState();
    expect([mine.level, mine.maxHp, mine.hp]).toEqual([2, maxHpFor(2), maxHpFor(2)]);
  });
});

describe("techniques", () => {
  test("open with your level", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await readyAt(server);
    expect(await errorOf(server.castSkill(cast(1)))).toContain("locked");
    expect(await errorOf(server.castSkill(cast(7)))).toContain("bad_args");
    await editProfile("test-a", (p) => ({ ...p, level: SKILLS[4].unlock }));
    expect(await errorOf(server.castSkill(cast(4)))).toBe("");
  });

  test("wait out their cooldown, each its own, and count toward the daily technique quest", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, level: 5 }));
    await readyAt(server);
    await server.castSkill(cast(0));
    expect(await errorOf(server.castSkill(cast(0)))).toContain("on_cooldown");
    expect(await errorOf(server.castSkill(cast(1)))).toBe("");
    const index = DAILY_QUESTS.findIndex((q) => q.goal.type === "kill" && q.goal.kind === "skill");
    expect((await profileOf("test-a")).daily.progress[index]).toBe(2);
    const { cds } = await $room.getMyState();
    expect(cds[0]).toBeGreaterThan(Date.now() + SKILLS[0].cd * 1000 * 0.8 - 2000);
  });

  test("the wave reaches far down its line", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await only("bamboo", "blob0", 11, 0.5);
    await readyAt(server);
    const result = await server.castSkill(cast(0));
    expect(result.hits.length).toBe(1);
    expect(result.hits[0].dmg).toBe(Math.round(attackFor(1, 10) * SKILLS[0].hits.dmg));
  });

  test("the ink prison lands ahead of you", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (p) => ({ ...p, level: 16 }));
    await only("bamboo", "blob0", SKILLS[4].offset + 3, 0);
    await readyAt(server);
    expect((await server.castSkill(cast(4))).hits.length).toBe(1);
  });
});

describe("the boss", () => {
  test("its kill pays jade, to everyone who hit it", async (server) => {
    await goTo(server, "test-b", "peak");
    await goTo(server, "test-a", "peak");
    await only("peak", "boss", AHEAD.x, AHEAD.z, { hp: 1, by: ["test-b"] });
    await readyAt(server);
    const result = await server.attack(swing(3));
    expect(result.hits[0].kill).toBe(true);
    expect(result.jade).toBe(MONSTERS.boss.jade);
    expect((await profileOf("test-a")).jade).toBe(MONSTERS.boss.jade);
    expect((await profileOf("test-b")).jade).toBe(MONSTERS.boss.jade);
    expect((await profileOf("test-b")).exp).toBeGreaterThan(0);
  });
});
