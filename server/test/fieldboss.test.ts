import { MONSTERS, monsterHp } from "../../src/shared/combat";
import {
  FB_DAILY, FB_EVERY_MS, FB_LINGER_MS, FB_MIN_HITS, FB_ROTATION, FB_SPOTS, FB_UP_MS, FIELD_BOSS, FIELD_BOSS_ID, fieldBossEarners, fieldBossHp,
  fieldBossLevel, fieldBossReward, fieldBossUp, fieldBossWindow, nextFieldBoss, readFb,
} from "../../src/shared/fieldboss";
import { today } from "../../src/shared/types";
import { ZONES, NPC_SAFE_R, roomIdFor } from "../../src/shared/world";
import { fieldBossStep, fixedSpots } from "../src/hunt";
import { editProfile, goTo, join, only, profileOf, walkTo } from "./helpers";

// 2026-11-24 00:00 KST (15:00 UTC the day before): the day's first window, in 죽림.
const MIDNIGHT_KST = Date.UTC(2026, 10, 23, 15, 0, 0);
const IN_WINDOW = MIDNIGHT_KST + 60_000;

/** Holds Date.now at `at` (moving with the real clock from there) while `run` runs. */
async function at<T>(time: number, run: () => Promise<T>): Promise<T> {
  const real = Date.now;
  const from = real();
  Date.now = () => time + (real() - from);
  try {
    return await run();
  } finally {
    Date.now = real;
  }
}

/** Keeps the zone's own monsters out of the way (all felled for good), with the caller at (0, 0). */
async function quietField(server: any, zone: string): Promise<void> {
  await walkTo(server, 0, 0);
  // `only` leaves one living (far away); then that one is felled for good too
  await only(zone, zone === "bamboo" ? "blob0" : "shade0", 25, 0);
  const { monsters } = await $room.getRoomState();
  for (const m of Object.values(monsters) as any[]) Object.assign(m, { mode: "dead", hp: 0, deadAt: Number.MAX_SAFE_INTEGER });
  await $room.updateRoomState({ monsters });
}

/** The field boss moved right in front of the caller (facing +x), with `hp` life. */
async function bossAhead(hp: number): Promise<void> {
  const { monsters } = await $room.getRoomState();
  Object.assign(monsters[FIELD_BOSS_ID], { x: 3, z: 0, hx: 3, hz: 0, wx: 3, wz: 0, hp, mode: "idle", rd: Number.MAX_SAFE_INTEGER });
  await $room.updateRoomState({ monsters, effects: [] });
}

const swing = (kind = 1) => ({ kind, x: 0, z: 0, yaw: 0 });

async function swingNow(server: any): Promise<any> {
  await $room.updateMyState({ atkAt: 0 });
  return server.attack(swing(1));
}

describe("field boss schedule", () => {
  test("windows come every 20 minutes on the KST clock, rotating fields, the same for every caller", async () => {
    const w = fieldBossWindow(IN_WINDOW);
    expect([w.zone, w.start, w.end]).toEqual(["bamboo", MIDNIGHT_KST, MIDNIGHT_KST + FB_UP_MS]);
    expect(fieldBossWindow(IN_WINDOW + 5 * 60_000).id).toBe(w.id);
    expect(fieldBossUp(w, MIDNIGHT_KST + FB_UP_MS - 1)).toBe(true);
    expect(fieldBossUp(w, MIDNIGHT_KST + FB_UP_MS)).toBe(false);
    const zones = Array.from({ length: FB_ROTATION.length }, (_, i) => fieldBossWindow(MIDNIGHT_KST + i * FB_EVERY_MS + 1).zone);
    expect(zones).toEqual([...FB_ROTATION]);
    // the same field at the same hour the next day
    expect(fieldBossWindow(IN_WINDOW + 86_400_000).zone).toBe("bamboo");
    // between windows the next one is named
    const next = nextFieldBoss(MIDNIGHT_KST + FB_UP_MS + 1);
    expect([next.zone, next.start]).toEqual(["kiln", MIDNIGHT_KST + FB_EVERY_MS]);
    expect(fieldBossLevel("bamboo")).toBe(ZONES.bamboo.levels[1]);
  });

  test("every field it comes to has an open spot: off gates, arrivals, NPC circles, fixed spawns, a chapter boss's reach", () => {
    for (const zone of new Set(FB_ROTATION)) {
      const z = ZONES[zone];
      const s = FB_SPOTS[zone];
      expect(z && !z.safe).toBe(true);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(z.radius - MONSTERS[FIELD_BOSS].radius - 2);
      for (const p of z.portals) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(18);
      for (const other of Object.values(ZONES)) for (const p of other.portals) if (p.to === zone) expect(Math.hypot(s.x - p.arriveX, s.z - p.arriveZ)).toBeGreaterThan(16);
      for (const n of z.npcs) expect(Math.hypot(s.x - n.x, s.z - n.z)).toBeGreaterThan(NPC_SAFE_R + MONSTERS[FIELD_BOSS].leash! + 1);
      for (const f of fixedSpots(z)) expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeGreaterThan(f.r + MONSTERS[FIELD_BOSS].radius + 3);
      if (z.boss) expect(Math.hypot(s.x - z.boss.x, s.z - z.boss.z)).toBeGreaterThan(MONSTERS[z.boss.kind].aggro + 4);
    }
  });

  test("its life grows with the players in the room when it comes; no armor", () => {
    const base = monsterHp(MONSTERS[FIELD_BOSS], 8);
    expect(fieldBossHp(8, 1)).toBe(base);
    expect(fieldBossHp(8, 3)).toBe(Math.round(base * 2.4));
    expect(fieldBossHp(8, 0)).toBe(base);
    expect(fieldBossHp(8, 99)).toBe(fieldBossHp(8, 15));
    expect(MONSTERS[FIELD_BOSS].armor).toBeUndefined();
    expect(MONSTERS[FIELD_BOSS].boss).toBeUndefined();
  });

  test("a share of its life or enough blows earns a reward", () => {
    const maxHp = 10_000;
    const hits = { big: { d: 300, n: 2 }, busy: { d: 40, n: FB_MIN_HITS }, idle: { d: 299, n: FB_MIN_HITS - 1 } };
    expect(fieldBossEarners(hits, maxHp)).toEqual(["big", "busy"]);
    const r = fieldBossReward(8, () => 0);
    expect(r.shards).toBe(1);
    expect(fieldBossReward(8, () => 0.99).shards).toBe(0);
    expect(r.exp).toBeGreaterThan(0);
  });

  test("pure step: once per window per room, gone at its end, the record dropped once the window is over", () => {
    const a: Record<string, any> = {};
    const b: Record<string, any> = {};
    const first = fieldBossStep("bamboo", a, null, 2, IN_WINDOW);
    expect(first.event).toBe("spawn");
    expect(a[FIELD_BOSS_ID].maxHp).toBe(fieldBossHp(8, 2));
    // another channel's room gets its own
    expect(fieldBossStep("bamboo", b, null, 1, IN_WINDOW).event).toBe("spawn");
    // not in a field the window isn't for, and not with nobody there
    expect(fieldBossStep("pond", {}, null, 3, IN_WINDOW).event).toBe(null);
    expect(fieldBossStep("bamboo", {}, null, 0, IN_WINDOW).event).toBe(null);
    // its time up: it leaves, and the room does not call it again in that window
    const gone = fieldBossStep("bamboo", a, first.fb, 2, first.fb!.end);
    expect([gone.event, a[FIELD_BOSS_ID], gone.fb!.done]).toEqual(["gone", undefined, true]);
    expect(fieldBossStep("bamboo", a, gone.fb, 2, first.fb!.end - 1).event).toBe(null);
    expect(a[FIELD_BOSS_ID]).toBeUndefined();
    // the window over: the record goes
    const later = fieldBossStep("bamboo", a, gone.fb, 2, first.fb!.end + 1);
    expect([later.changed, later.fb]).toEqual([true, null]);
  });
});

describe("field boss in a room", () => {
  test("comes down at its spot when its window opens, with a line to the room, once per window", async (server) => {
    await at(IN_WINDOW, async () => {
      const entry = await goTo(server, "test-a", "bamboo");
      await server.simulateTick(entry.roomId, 200);
      const state = await $room.getRoomState();
      const row = state.monsters[FIELD_BOSS_ID];
      expect([row.kind, row.x, row.z, row.level, row.maxHp]).toEqual([FIELD_BOSS, FB_SPOTS.bamboo.x, FB_SPOTS.bamboo.z, 8, fieldBossHp(8, 1)]);
      const fb = readFb(state.fb)!;
      expect([fb.win, fb.done, fb.end]).toEqual([fieldBossWindow(IN_WINDOW).id, false, MIDNIGHT_KST + FB_UP_MS]);
      // cleared away by hand (as if it had gone): the same window never brings it back
      await $room.updateRoomState({ fb: { ...fb, done: true } });
      const { monsters } = await $room.getRoomState();
      delete monsters[FIELD_BOSS_ID];
      await $room.updateRoomState({ monsters });
      await server.simulateTick(entry.roomId, 200);
      expect((await $room.getRoomState()).monsters[FIELD_BOSS_ID]).toBeUndefined();
    });
  });

  test("its life is set by how many stand in the room when it comes", async (server) => {
    await at(IN_WINDOW, async () => {
      await goTo(server, "test-b", "bamboo");
      await goTo(server, "test-c", "bamboo");
      const entry = await goTo(server, "test-a", "bamboo");
      expect(entry.roomId).toBe(roomIdFor("bamboo", 1));
      await server.simulateTick(entry.roomId, 200);
      expect((await $room.getRoomState()).monsters[FIELD_BOSS_ID].maxHp).toBe(fieldBossHp(8, 3));
    });
  });

  test("felled: those who did a share are paid once, the rest nothing; contributions cleared; then cleared away", async (server) => {
    await at(IN_WINDOW, async () => {
      const b = await goTo(server, "test-b", "bamboo");
      const entry = await goTo(server, "test-a", "bamboo");
      await quietField(server, "bamboo");
      await server.simulateTick(entry.roomId, 200);
      await bossAhead(1000);
      // test-b lands one small blow (not enough)
      server.connect({ account: "test-b", roomId: b.roomId });
      await walkTo(server, 0, 0);
      expect((await swingNow(server)).hits[0].id).toBe(FIELD_BOSS_ID);
      server.connect({ account: "test-a", roomId: entry.roomId });
      const before = await profileOf("test-a");
      const beforeB = await profileOf("test-b");
      // test-a has done most of it; the felling blow
      const fb = readFb((await $room.getRoomState()).fb)!;
      expect(fb.hits["test-b"].n).toBe(1);
      await $room.updateRoomState({ fb: { ...fb, hits: { ...fb.hits, "test-a": { d: 5000, n: 30 } } } });
      await bossAhead(1);
      const kill = await swingNow(server);
      expect(kill.hits[0]).toMatchObject({ id: FIELD_BOSS_ID, kill: true });
      // the killer's own answer carries no kill pay: it comes as everyone's does, through the room
      expect([kill.exp, kill.pigment]).toEqual([0, 0]);
      const after = readFb((await $room.getRoomState()).fb)!;
      expect(after.hits).toEqual({});
      expect(after.dead).toBeGreaterThan(0);
      expect(Object.keys(after.paid!)).toEqual(["test-a"]);
      const r = after.paid!["test-a"]!;
      const p = await profileOf("test-a");
      expect(p.pigment - before.pigment).toBe(r.pigment);
      expect(p.stones - before.stones).toBe(r.stones);
      expect(p.jade - before.jade).toBe(r.jade);
      expect(p.fb.n).toBe(1);
      expect(p.daily.progress[0]).toBe(before.daily.progress[0] + 1); // an "any" kill
      expect((await profileOf("test-b")).pigment).toBe(beforeB.pigment);
      // more blows on the fallen one pay nothing again
      const again = await swingNow(server);
      expect(again.hits.length).toBe(0);
      expect((await profileOf("test-a")).fb.n).toBe(1);
      // it lies a while, then the room clears it away and remembers the window is done
      await server.simulateTick(entry.roomId, 200);
      expect((await $room.getRoomState()).monsters[FIELD_BOSS_ID]).toBeDefined();
    });
    await at(IN_WINDOW + FB_LINGER_MS + 2000, async () => {
      await server.simulateTick(roomIdFor("bamboo", 1), 200);
      const state = await $room.getRoomState();
      expect(state.monsters[FIELD_BOSS_ID]).toBeUndefined();
      expect(readFb(state.fb)!.done).toBe(true);
      expect(readFb(state.fb)!.paid).toBeUndefined();
      await server.simulateTick(roomIdFor("bamboo", 1), 200);
      expect((await $room.getRoomState()).monsters[FIELD_BOSS_ID]).toBeUndefined();
    });
    // the window over: the room keeps nothing of it
    await at(MIDNIGHT_KST + FB_UP_MS + 1000, async () => {
      await server.simulateTick(roomIdFor("bamboo", 1), 200);
      expect((await $room.getRoomState()).fb).toBeUndefined();
    });
  });

  test("past the day's FB_DAILY rewards, a share pays nothing (and says so)", async (server) => {
    await at(IN_WINDOW, async () => {
      const entry = await goTo(server, "test-a", "bamboo");
      await editProfile("test-a", (p) => ({ ...p, fb: { day: today(Date.now()), n: FB_DAILY } }));
      await quietField(server, "bamboo");
      await server.simulateTick(entry.roomId, 200);
      await bossAhead(1);
      const fb = readFb((await $room.getRoomState()).fb)!;
      await $room.updateRoomState({ fb: { ...fb, hits: { "test-a": { d: 5000, n: 30 } } } });
      const before = await profileOf("test-a");
      expect((await swingNow(server)).hits[0].kill).toBe(true);
      const after = readFb((await $room.getRoomState()).fb)!;
      expect(after.paid).toEqual({ "test-a": null });
      const p = await profileOf("test-a");
      expect([p.pigment, p.exp, p.fb.n]).toEqual([before.pigment, before.exp, FB_DAILY]);
    });
  });

  test("the daily count starts over on a new KST day", async (server) => {
    await at(IN_WINDOW, async () => {
      await goTo(server, "test-a", "bamboo");
      await editProfile("test-a", (p) => ({ ...p, fb: { day: "2026-11-23", n: FB_DAILY } }));
      expect((await server.loadProfile()).fb).toEqual({ day: today(IN_WINDOW), n: 0 });
    });
  });

  test("unfelled, it leaves when its time is up", async (server) => {
    let roomId = "";
    await at(IN_WINDOW, async () => {
      const entry = await goTo(server, "test-a", "bamboo");
      roomId = entry.roomId;
      await server.simulateTick(roomId, 200);
      expect((await $room.getRoomState()).monsters[FIELD_BOSS_ID]).toBeDefined();
    });
    await at(MIDNIGHT_KST + FB_UP_MS + 10, async () => {
      await server.simulateTick(roomId, 200);
      const state = await $room.getRoomState();
      expect(state.monsters[FIELD_BOSS_ID]).toBeUndefined();
      expect(readFb(state.fb)!.done).toBe(true);
    });
  });

  test("another channel of the field gets its own, once", async (server) => {
    await at(IN_WINDOW, async () => {
      const first = await goTo(server, "test-a", "bamboo");
      await server.simulateTick(first.roomId, 200);
      const to = first.channel === 2 ? 3 : 2;
      const second = await join(server, "test-a", await server.changeChannel(to), first.roomId);
      await server.simulateTick(second.roomId, 200);
      const state = await $room.getRoomState();
      expect(state.monsters[FIELD_BOSS_ID]).toBeDefined();
      expect(readFb(state.fb)!.win).toBe(fieldBossWindow(IN_WINDOW).id);
    });
  });

  test("the offline test hook refuses on the real server", async (server) => {
    await goTo(server, "test-a", "bamboo");
    let error = "";
    try {
      await server.debugFieldBoss(true);
    } catch (e: any) {
      error = String(e?.message ?? e);
    }
    expect(error).toContain("locked");
  });
});
