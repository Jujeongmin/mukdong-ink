import { ARMOR_FACTOR, MAX_LEVEL, MONSTERS, SKILLS, armorHolds, attackFor, expToNext, monsterAtk } from "../../src/shared/combat";
import { MAIN_QUESTS, ZONES, parseRoomId, roomIdFor } from "../../src/shared/world";
import { QUEST_VERSION } from "../../src/shared/profile";
import { KEEP_FROM_FIXED, spawnZone } from "../src/hunt";

const questIndex = (id: string) => MAIN_QUESTS.findIndex((q) => q.id === id);
import { NO_ROOM, editProfile, errorOf, goTo, newPlayer, profileOf, walkTo } from "./helpers";

/** Exactly these monsters alive in the caller's room, at these spots (all others felled for good). */
async function placed(zone: string, alive: Record<string, Record<string, unknown> & { x: number; z: number }>): Promise<void> {
  const all = spawnZone(zone, 0, () => 0.5);
  const monsters: Record<string, any> = {};
  for (const [id, m] of Object.entries(all)) {
    const at = alive[id];
    monsters[id] = at
      ? { ...m, hx: at.x, hz: at.z, wx: at.x, wz: at.z, mode: "idle", since: Date.now(), rd: 0, ...at }
      : { ...m, mode: "dead", hp: 0, deadAt: Number.MAX_SAFE_INTEGER };
  }
  await $room.updateRoomState({ monsters, effects: [], monstersAt: Date.now() });
}

async function ready(server: any, x = 0, z = 0): Promise<void> {
  await walkTo(server, x, z);
  await $room.updateMyState({ atkAt: 0, cds: [], dashAt: 0 });
}

const NEW_ZONES = ["kiln", "temple", "censer"];

describe("chapter 2 zones", () => {
  test("room ids of the new zones pass parseRoomId", () => {
    for (const zone of NEW_ZONES) {
      expect(parseRoomId(roomIdFor(zone, 1))).toEqual({ zone, channel: 1 });
      expect(parseRoomId(roomIdFor(zone, 10))).toEqual({ zone, channel: 10 });
    }
    expect(parseRoomId("ink-kiln-0")).toBe(null);
  });

  test("the way runs peak (east door) → kiln → temple → censer and back, arriving out of the bosses' reach", async (server) => {
    const kiln = await goTo(server, "test-a", "kiln");
    expect(kiln.roomId).toBe("ink-kiln-1");
    const censer = await goTo(server, "test-b", "censer");
    expect([censer.roomId, censer.x, censer.z]).toEqual(["ink-censer-1", 0, 17]);
    const east = ZONES.peak.portals.find((p) => p.to === "kiln")!;
    expect([east.x, east.z]).toEqual([27, 3]);
    // Each arrival point stands outside the aggro of the gate monsters and bosses nearby.
    const peakBoss = ZONES.peak.boss!;
    expect(Math.hypot(23 - peakBoss.x, 3 - peakBoss.z)).toBeGreaterThan(MONSTERS.boss.aggro);
    const ash = ZONES.censer.boss!;
    expect(Math.hypot(0 - ash.x, 17 - ash.z)).toBeGreaterThan(MONSTERS.ashboss.aggro);
    const lord = ZONES.kiln.spawns.find((s) => s.kind === "kilnlord")!.at![0];
    expect(Math.hypot(0 - lord.x, -25 - lord.z)).toBeGreaterThan(MONSTERS.kilnlord.aggro);
    for (const l of ZONES.temple.spawns.find((s) => s.at && s.kind === "lantern")!.at!) {
      expect(Math.hypot(0 - l.x, -25 - l.z)).toBeGreaterThan(MONSTERS.lantern.aggro);
    }
  });

  test("monsters spawn inside the discs, away from portals, arrivals and NPCs", () => {
    for (const zoneId of [...NEW_ZONES, "peak"]) {
      const zone = ZONES[zoneId];
      const arrivals = Object.values(ZONES).flatMap((z) => z.portals.filter((p) => p.to === zoneId).map((p) => ({ x: p.arriveX, z: p.arriveZ })));
      const fixed = new Set(zone.spawns.filter((s) => s.at).map((s) => s.kind));
      for (let run = 0; run < 30; run++) {
        const all = spawnZone(zoneId, 0, Math.random);
        for (const m of Object.values(all)) {
          expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(zone.radius);
          if (m.id === "boss" || (fixed.has(m.kind) && zone.spawns.some((s) => s.at && s.kind === m.kind && s.at.some((a) => a.x === m.x && a.z === m.z)))) continue;
          for (const p of [...zone.portals, ...arrivals]) expect(Math.hypot(m.x - p.x, m.z - p.z)).toBeGreaterThanOrEqual(8);
          for (const n of zone.npcs) expect(Math.hypot(m.x - n.x, m.z - n.z)).toBeGreaterThanOrEqual(8);
          for (const s of zone.spawns) for (const a of s.at ?? []) {
            expect(Math.hypot(m.x - a.x, m.z - a.z)).toBeGreaterThanOrEqual(MONSTERS[s.kind].radius + KEEP_FROM_FIXED);
          }
        }
      }
    }
  });

  test("fixed spawns stand where the doc puts them", () => {
    const kiln = spawnZone("kiln", 0, Math.random);
    expect([kiln.kilnlord0.x, kiln.kilnlord0.z, kiln.kilnlord0.level]).toEqual([-12, -12, 24]);
    const temple = spawnZone("temple", 0, Math.random);
    expect([temple.lantern0.x, temple.lantern0.z, temple.lantern3.x, temple.lantern3.z]).toEqual([-4.5, -8, 4.5, -15]);
    // The roaming lanterns count on after the fixed four, so no id is shared.
    expect(Object.keys(temple).filter((id) => id.startsWith("lantern")).sort()).toEqual(["lantern0", "lantern1", "lantern2", "lantern3", "lantern4", "lantern5"]);
    const censer = spawnZone("censer", 0, Math.random);
    expect([Object.keys(censer), censer.boss.kind, censer.boss.level, censer.boss.z]).toEqual([["boss"], "ashboss", 35, -7]);
  });
});

describe("chapter 2 armor", () => {
  test("armorHolds: 화염선풍 4 holds the ash shell, 5 breaks it; a brush +5 holds the fire armor, +6 breaks it", () => {
    const lord = MONSTERS.kilnlord;
    expect(armorHolds(lord, [10, 4, 10, 10, 10], 15)).toBe(true);
    expect(armorHolds(lord, [1, 5, 1, 1, 1], 0)).toBe(false);
    const ash = MONSTERS.ashboss;
    expect(armorHolds(ash, [10, 10, 10, 10, 10], 5)).toBe(true);
    expect(armorHolds(ash, [1, 1, 1, 1, 1], 6)).toBe(false);
    // Without awakenSkill, any awakened technique breaks an "awaken" armor.
    const any = { ...lord, awakenSkill: undefined };
    expect(armorHolds(any, [1, 1, 1, 4, 1], 0)).toBe(true);
    expect(armorHolds(any, [1, 1, 1, 5, 1], 0)).toBe(false);
  });

  test("가마 지킴이 shrugs off everything until 화염선풍 has awakened", async (server) => {
    await goTo(server, "test-a", "kiln");
    await editProfile("test-a", (q) => ({ ...q, level: 24, skills: [10, 4, 1, 1, 1] }));
    await placed("kiln", { kilnlord0: { x: 1.5, z: 0, hp: 50000, maxHp: 50000 } });
    await ready(server);
    const fire = Math.round(attackFor(24, 10) * SKILLS[1].hits.dmg * (1 + 0.08 * 3));
    const weak = await server.castSkill({ skill: 1, x: 0, z: 0, yaw: 0 });
    expect(weak.hits).toEqual([{ id: "kilnlord0", dmg: Math.max(1, Math.round(fire * ARMOR_FACTOR)), kill: false, resisted: true }]);
    await ready(server);
    expect((await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 })).hits[0].resisted).toBe(true);
    await editProfile("test-a", (q) => ({ ...q, skills: [10, 5, 1, 1, 1] }));
    await ready(server);
    const basic = await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 });
    expect(basic.hits).toEqual([{ id: "kilnlord0", dmg: Math.round(attackFor(24, 10)), kill: false }]);
  });

  test("잿불귀 holds off a brush below +6, and its fall is told to the room", async (server) => {
    await goTo(server, "test-a", "censer");
    await editProfile("test-a", (q) => ({ ...q, level: 33, name: "붓잡이", enh: { w_brush: 5 } }));
    await placed("censer", { boss: { x: 1.5, z: 0, hp: 50000, maxHp: 50000 } });
    await ready(server);
    const weak = await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 });
    expect(weak.hits[0].resisted).toBe(true);
    await editProfile("test-a", (q) => ({ ...q, enh: { w_brush: 6 } }));
    await ready(server);
    const strong = await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 });
    expect([strong.hits[0].resisted, strong.hits[0].dmg]).toEqual([undefined, Math.round(attackFor(33, 10 * 1.48))]);
    await placed("censer", { boss: { x: 1.5, z: 0, hp: 1 } });
    await ready(server);
    // The room hears it as a broadcast (caught here; nothing is stored).
    const told: any[] = [];
    const real = $room.broadcastToRoom;
    $room.broadcastToRoom = (type: string, message: any) => {
      if (type === "chat") told.push(message);
      return real.call($room, type, message);
    };
    try {
      expect((await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 })).hits[0].kill).toBe(true);
    } finally {
      $room.broadcastToRoom = real;
    }
    expect(told.map((m) => [m.sys, m.text])).toEqual([[true, "붓잡이 님이 잿불귀를 잠재웠다"]]);
    expect((await $room.getRoomState()).chat).toBeUndefined();
    // Its slam mark is the wide one.
    expect(MONSTERS.ashboss.slamR).toBe(4);
    void monsterAtk;
  });
});

describe("chapter 1 → 2", () => {
  test("c1q10 is followed by c2q1, given by 흑월 where c1q10 is handed in", () => {
    const last1 = questIndex("c1q10");
    expect(MAIN_QUESTS[last1 + 1].id).toBe("c2q1");
    expect(MAIN_QUESTS[last1 + 1].giver).toBe(MAIN_QUESTS[last1].turnIn);
    expect(MAIN_QUESTS.slice(last1 + 1).map((q) => q.id)).toEqual(Array.from({ length: 10 }, (_, i) => `c2q${i + 1}`));
    // Chapter 1 now opens with the 죽림 quest (the 단이 intro quests are gone).
    expect(MAIN_QUESTS.map((q) => q.id).slice(0, 2)).toEqual(["c1q3", "c1q4"]);
  });

  test("handing c1q10 in at 흑월 opens c2q1 there", async (server) => {
    await goTo(server, "test-a", "peak");
    await editProfile("test-a", (q) => ({ ...q, main: questIndex("c1q10"), mainAccepted: true, mainProgress: 1, level: 20 }));
    const heukwol = ZONES.peak.npcs.find((n) => n.id === "heukwol")!;
    await walkTo(server, heukwol.x + 1, heukwol.z);
    const after = await server.claimMain("heukwol");
    expect([after.main, after.mainAccepted]).toEqual([questIndex("c2q1"), false]);
    const accepted = await server.acceptMain("heukwol");
    expect([accepted.main, accepted.mainAccepted]).toEqual([questIndex("c2q1"), true]);
  });

  test("a save from before chapter 2 and the quest-list change (main = 10, Lv20 with exp 0) picks up c2q1 and gains exp again", async (server) => {
    await newPlayer(server, "test-a");
    // As saved by the old list (no qv): index 10 was c2q1 there.
    await editProfile("test-a", (q) => {
      const { qv, ...old } = q;
      void qv;
      return { ...old, main: 10, mainAccepted: false, level: 20, exp: 0 };
    });
    server.connect({ account: "test-a", roomId: NO_ROOM });
    const p = await server.loadProfile();
    expect([MAIN_QUESTS[p.main].id, p.qv, p.level, p.expToNext]).toEqual(["c2q1", QUEST_VERSION, 20, expToNext(20)]);
    // Migrated once: loading again keeps it.
    expect(MAIN_QUESTS[(await server.loadProfile()).main].id).toBe("c2q1");
    expect(MAX_LEVEL).toBe(35);
    await goTo(server, "test-a", "kiln");
    await placed("kiln", { jar0: { x: 1.5, z: 0, hp: 1 } });
    await ready(server);
    const r = await server.attack({ kind: 1, x: 0, z: 0, yaw: 0 });
    expect(r.exp).toBeGreaterThan(0);
    expect((await profileOf("test-a")).exp).toBe(r.exp);
    void errorOf;
  });
});
