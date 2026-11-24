import { MONSTERS, RESPAWN_MS, maxHpFor, monsterAtk } from "../../src/shared/combat";
import { ROLL_IFRAME_MS, START_POS, ZONES, roomIdFor } from "../../src/shared/world";
import { MONSTER_SYNC_MS, spawnZone } from "../src/hunt";
import { ago, errorOf, fieldBossQuiet, goTo, inVillage, join, only, profileOf, walkTo } from "./helpers";

describe("monsters", () => {
  test("a hunting zone fills on its first tick, inside the disc and away from the portals", async (server) => {
    await fieldBossQuiet(async () => {
      const entry = await goTo(server, "test-a", "bamboo");
      await server.simulateTick(entry.roomId, 200);
      const { monsters, now } = await $room.getRoomState();
      const ids = Object.keys(spawnZone("bamboo", 0, () => 0.5));
      expect(Object.keys(monsters).sort()).toEqual(ids.sort());
      expect(typeof now).toBe("number");
      for (const m of Object.values(monsters) as any[]) {
        expect(m.hp).toBe(m.maxHp);
        expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(ZONES.bamboo.radius);
        // The fixed ones (the vine ring and the lair at the north gate) stand where the zone puts them.
        if (!["vine", "shadelord", "bigblob"].includes(m.kind)) for (const p of ZONES.bamboo.portals) expect(Math.hypot(m.x - p.x, m.z - p.z)).toBeGreaterThan(6);
      }
    });
  });

  test("the village stays empty", async (server) => {
    const entry = await inVillage(server, "test-a");
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getRoomState()).monsters).toBeUndefined();
  });

  test("a blob that reaches you bites, and your profile keeps the health", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await only("bamboo", "blob0", 0.8, 0, { level: 3 });
    const full = (await $room.getMyState()).hp;
    await server.simulateTick(entry.roomId, 200);
    const hp = full - monsterAtk(MONSTERS.blob, 3);
    expect((await $room.getMyState()).hp).toBe(hp);
    expect((await profileOf("test-a")).hp).toBe(hp);
    const { monsters } = await $room.getRoomState();
    expect(monsters.blob0.mode).toBe("attack");
    // Its next bite waits for its cooldown.
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(hp);
  });

  test("beside a quest NPC in a hunting zone, monsters leave you be", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    const npc = ZONES.bamboo.npcs[0];
    await walkTo(server, npc.x + 1, npc.z);
    await only("bamboo", "blob0", npc.x + 1.8, npc.z, { level: 3 });
    const full = (await $room.getMyState()).hp;
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full);
  });

  test("a blow landing mid-roll passes through; after the roll it lands", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await only("bamboo", "blob0", 0.8, 0, { level: 3 });
    const full = (await $room.getMyState()).hp;
    await $room.updateMyState({ dashAt: Date.now() });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full);
    // the roll is long over and the blob's cooldown has passed: it bites
    await $room.updateMyState({ dashAt: ago(ROLL_IFRAME_MS + 50) });
    await only("bamboo", "blob0", 0.8, 0, { level: 3 });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full - monsterAtk(MONSTERS.blob, 3));
  });

  test("a monster chases the nearest player within its aggro and lets the far ones be", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await only("bamboo", "shade0", 8, 0, { since: ago(5000) });
    await $room.updateRoomState({ monstersAt: ago(500) });
    await server.simulateTick(entry.roomId, 200);
    const near = (await $room.getRoomState()).monsters.shade0;
    expect([near.mode, near.tg]).toEqual(["chase", "test-a"]);
    expect(near.x).toBeLessThan(8);
    await only("bamboo", "shade0", 25, 0, { since: Date.now() });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getRoomState()).monsters.shade0.mode).toBe("idle");
  });

  test("a shade winds up, then strikes whoever is still in reach", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await only("bamboo", "shade0", 1.5, 0, { level: 5 });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getRoomState()).monsters.shade0.mode).toBe("wind");
    const full = (await $room.getMyState()).hp;
    // The wind-up is over.
    const m = (await $room.getRoomState()).monsters;
    await $room.updateRoomState({ monsters: { ...m, shade0: { ...m.shade0, since: ago(MONSTERS.shade.windMs + 10) } } });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full - monsterAtk(MONSTERS.shade, 5));
    expect((await $room.getRoomState()).monsters.shade0.mode).toBe("attack");
  });

  test("a toad's ink shot is a room effect that lands later where you stood", async (server) => {
    const entry = await goTo(server, "test-a", "pond");
    await walkTo(server, 0, 0);
    await only("pond", "spitter0", 6, 0, { level: 10, mode: "wind", since: ago(MONSTERS.spitter.windMs + 10), tx: 0, tz: 0 });
    const full = (await $room.getMyState()).hp;
    await server.simulateTick(entry.roomId, 200);
    const { effects } = await $room.getRoomState();
    expect(effects.length).toBe(1);
    expect([effects[0].kind, effects[0].tx, effects[0].tz]).toEqual(["shot", 0, 0]);
    expect(effects[0].at).toBeGreaterThan(Date.now());
    expect((await $room.getMyState()).hp).toBe(full);
    await $room.updateRoomState({ effects: [{ ...effects[0], at: ago(1) }] });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full - monsterAtk(MONSTERS.spitter, 10));
    expect((await $room.getRoomState()).effects).toEqual([]);
  });

  test("the boss marks its slam on the ground first, with its radius, and the mark hurts when it goes off", async (server) => {
    const entry = await goTo(server, "test-a", "peak");
    await walkTo(server, 0, 0);
    await only("peak", "boss", 4, 0);
    await server.simulateTick(entry.roomId, 200);
    const { effects, monsters } = await $room.getRoomState();
    expect(monsters.boss.mode).toBe("wind");
    expect(effects.length).toBe(1);
    expect([effects[0].kind, effects[0].tx, effects[0].tz, effects[0].r > 2]).toEqual(["slam", 0, 0, true]);
    const full = (await $room.getMyState()).hp;
    // Stepped out in time: nothing.
    await walkTo(server, -10, 0);
    await $room.updateRoomState({ effects: [{ ...effects[0], at: ago(1) }] });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full);
  });

  test("you fall at no health: no moving, no attacking, only respawning in the village, whole", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await $room.updateMyState({ hp: 1 });
    await only("bamboo", "blob0", 0.8, 0);
    await server.simulateTick(entry.roomId, 200);
    const mine = await $room.getMyState();
    expect([mine.hp, mine.dead]).toEqual([0, true]);
    expect((await profileOf("test-a")).hp).toBe(0);
    expect(await errorOf(server.attack({ kind: 1, x: 0, z: 0, yaw: 0 }))).toContain("dead");
    const back = await server.respawn();
    expect([back.zone, back.x, back.z]).toEqual(["village", START_POS.x, START_POS.z]);
    await join(server, "test-a", back, entry.roomId);
    const home = await $room.getMyState();
    expect([home.hp, home.dead, home.maxHp]).toEqual([maxHpFor(1), false, maxHpFor(1)]);
    expect(await errorOf(server.respawn())).toContain("bad_args");
  });

  test("a felled monster rises again after RESPAWN_MS", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 0);
    await only("bamboo", "blob0", 20, 0);
    const m = (await $room.getRoomState()).monsters;
    await $room.updateRoomState({ monsters: { ...m, blob1: { ...m.blob1, deadAt: ago(RESPAWN_MS + 10) } } });
    await server.simulateTick(entry.roomId, 200);
    const risen = (await $room.getRoomState()).monsters.blob1;
    expect([risen.mode, risen.hp]).toEqual(["idle", risen.maxHp]);
  });

  test("walking alone is written at most every MONSTER_SYNC_MS", async (server) => {
    await fieldBossQuiet(async () => {
      const entry = await goTo(server, "test-a", "bamboo");
      await walkTo(server, -20, 0);
      await only("bamboo", "blob0", 0, 0, { wx: 3, wz: 0 });
      await $room.updateRoomState({ monstersAt: Date.now() });
      await server.simulateTick(entry.roomId, 200);
      expect((await $room.getRoomState()).monsters.blob0.x).toBe(0);
      await $room.updateRoomState({ monstersAt: ago(MONSTER_SYNC_MS + 50) });
      await server.simulateTick(entry.roomId, 200);
      expect((await $room.getRoomState()).monsters.blob0.x).toBeGreaterThan(0);
    });
  });

  test("leaving for good keeps your health on the profile", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await $room.updateMyState({ hp: 33 });
    await server.simulateLeave(entry.roomId, "test-a");
    expect((await profileOf("test-a")).hp).toBe(33);
    void roomIdFor;
  });
});
