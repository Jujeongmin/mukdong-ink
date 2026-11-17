import { ARMOR_FACTOR, MONSTERS, RESPAWN_MS, SKILLS, attackFor, maxHpFor, monsterAtk, VINE_RADIUS } from "../../src/shared/combat";
import { BAMBOO_BIGBLOB, BAMBOO_LAIR, BAMBOO_VINES, DAILY_QUESTS, MAIN_QUESTS, ROLL_IFRAME_MS, ZONES } from "../../src/shared/world";
import { KEEP_FROM_FIXED, spawnZone } from "../src/hunt";
import { ago, editProfile, goTo, profileOf, walkTo } from "./helpers";

const basic = (kind = 1) => ({ kind, x: 0, z: 0, yaw: 0 });
const cast = (skill: number) => ({ skill, x: 0, z: 0, yaw: 0 });

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

async function monster(id: string): Promise<any> {
  return (await $room.getRoomState()).monsters[id];
}

describe("부푼 먹방울 (roll away from its slam)", () => {
  test("a level-2 one takes 35–40% of a level-2 player's health, never all of it", () => {
    const hit = monsterAtk(MONSTERS.bigblob, 2);
    expect(hit / maxHpFor(2)).toBeGreaterThanOrEqual(0.35);
    expect(hit / maxHpFor(2)).toBeLessThanOrEqual(0.4);
    expect(hit).toBeLessThan(maxHpFor(1));
  });

  test("marks its slam a second ahead, then it lands on whoever stayed", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await ready(server);
    await placed("bamboo", { bigblob0: { x: 2, z: 0 } });
    await server.simulateTick(entry.roomId, 200);
    const { effects } = await $room.getRoomState();
    expect((await monster("bigblob0")).mode).toBe("wind");
    expect([effects.length, effects[0].kind, effects[0].r]).toEqual([1, "slam", MONSTERS.bigblob.slamR]);
    expect(effects[0].at - Date.now()).toBeGreaterThan(MONSTERS.bigblob.windMs - 200);
    const full = (await $room.getMyState()).hp;
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full);
    await $room.updateRoomState({ effects: [{ ...effects[0], at: ago(1) }] });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full - monsterAtk(MONSTERS.bigblob, 2));
  });

  test("a roll's i-frames let the slam pass", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await ready(server);
    await placed("bamboo", { bigblob0: { x: 2, z: 0 } });
    await server.simulateTick(entry.roomId, 200);
    const { effects } = await $room.getRoomState();
    const full = (await $room.getMyState()).hp;
    await $room.updateMyState({ dashAt: Date.now() });
    await $room.updateRoomState({ effects: [{ ...effects[0], at: ago(1) }] });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full);
    // Rolled too early: it hits.
    await $room.updateMyState({ dashAt: ago(ROLL_IFRAME_MS + 50) });
    await $room.updateRoomState({ effects: [{ ...effects[0], id: "again", at: ago(1) }] });
    await server.simulateTick(entry.roomId, 200);
    expect((await $room.getMyState()).hp).toBe(full - monsterAtk(MONSTERS.bigblob, 2));
  });
});

describe("먹덩굴 (only fire burns it)", () => {
  test("shrugs off the brush and the wave, burns to 화염선풍, and never attacks", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (q) => ({ ...q, level: 4 }));
    await placed("bamboo", { vine0: { x: 1.5, z: 0 } });
    await ready(server);
    const hp = (await monster("vine0")).hp;
    expect((await server.attack(basic())).hits).toEqual([{ id: "vine0", dmg: 0, kill: false, resisted: true }]);
    await ready(server);
    expect((await server.castSkill(cast(0))).hits).toEqual([{ id: "vine0", dmg: 0, kill: false, resisted: true }]);
    expect((await monster("vine0")).hp).toBe(hp);
    // It stands still and leaves you be.
    const full = (await $room.getMyState()).hp;
    await server.simulateTick(entry.roomId, 1000);
    expect([(await $room.getMyState()).hp, (await monster("vine0")).x, (await monster("vine0")).mode]).toEqual([full, 1.5, "idle"]);
    const fire = Math.round(attackFor(4, 10) * SKILLS[1].hits.dmg);
    await ready(server);
    const first = await server.castSkill(cast(1));
    expect(first.hits).toEqual([{ id: "vine0", dmg: fire, kill: false }]);
    await ready(server);
    expect((await server.castSkill(cast(1))).hits[0].kill).toBe(fire * 2 >= hp);
  });

  test("grows back on its own spot after about 45 s, not sooner", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, 10);
    await placed("bamboo", {});
    const all = (await $room.getRoomState()).monsters;
    await $room.updateRoomState({
      monsters: { ...all, vine0: { ...all.vine0, deadAt: ago(RESPAWN_MS + 100) }, vine1: { ...all.vine1, x: 3, z: 3, deadAt: ago(MONSTERS.vine.respawnMs! + 10) } },
    });
    await server.simulateTick(entry.roomId, 200);
    expect((await monster("vine0")).mode).toBe("dead");
    const back = await monster("vine1");
    expect([back.mode, back.x, back.z]).toEqual(["idle", BAMBOO_VINES[1].x, BAMBOO_VINES[1].z]);
  });

  test("burning vines does not count as an 'any' kill; the gate monsters do", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (q) => ({ ...q, level: 4 }));
    const any = DAILY_QUESTS.findIndex((q) => q.goal.type === "kill" && q.goal.kind === "any");
    await placed("bamboo", { vine0: { x: 1, z: 0, hp: 1 }, bigblob0: { x: -1, z: 0, hp: 1 } });
    await ready(server);
    const r = await server.castSkill(cast(1));
    expect(r.hits.filter((h: any) => h.kill).length).toBe(2);
    expect((await profileOf("test-a")).daily.progress[any]).toBe(1);
  });
});

describe("먹 갑옷", () => {
  test("그림자 무사 takes a tenth from an attacker who never trained a technique", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, -16);
    await placed("bamboo", { shadelord0: { x: 1.5, z: -16, hp: 500, maxHp: 500 } });
    await ready(server, 0, -16);
    const full = attackFor(1, 10) * 1.0;
    const weak = await server.attack({ kind: 1, x: 0, z: -16, yaw: 0 });
    expect(weak.hits).toEqual([{ id: "shadelord0", dmg: Math.max(1, Math.round(full * ARMOR_FACTOR)), kill: false, resisted: true }]);
    await editProfile("test-a", (q) => ({ ...q, skills: [2, 1, 1, 1, 1] }));
    await ready(server, 0, -16);
    const strong = await server.attack({ kind: 1, x: 0, z: -16, yaw: 0 });
    expect(strong.hits).toEqual([{ id: "shadelord0", dmg: Math.round(full), kill: false }]);
  });

  test("대먹귀 takes a tenth from a brush below +3", async (server) => {
    await goTo(server, "test-a", "peak");
    await editProfile("test-a", (q) => ({ ...q, level: 15, enh: { w_brush: 2 } }));
    await placed("peak", { boss: { x: 1.5, z: 0, hp: 5000, maxHp: 5000 } });
    await ready(server);
    const p = await profileOf("test-a");
    void p;
    const weak = await server.attack(basic());
    expect(weak.hits[0].resisted).toBe(true);
    await editProfile("test-a", (q) => ({ ...q, enh: { w_brush: 3 } }));
    await ready(server);
    const strong = await server.attack(basic());
    expect(strong.hits[0].resisted).toBe(undefined);
    expect(Math.round(strong.hits[0].dmg * ARMOR_FACTOR)).toBe(weak.hits[0].dmg);
  });
});

describe("fixed spawns", () => {
  test("the gates stand where the zone puts them, and roaming ones keep away", () => {
    const zone = ZONES.bamboo;
    for (let run = 0; run < 40; run++) {
      const all = spawnZone("bamboo", 0, Math.random);
      expect([all.bigblob0.x, all.bigblob0.z, all.shadelord0.x, all.shadelord0.z]).toEqual([BAMBOO_BIGBLOB.x, BAMBOO_BIGBLOB.z, BAMBOO_LAIR.x, BAMBOO_LAIR.z]);
      BAMBOO_VINES.forEach((v, i) => expect([all[`vine${i}`].x, all[`vine${i}`].z]).toEqual([v.x, v.z]));
      for (const m of Object.values(all)) {
        if (m.kind !== "blob" && m.kind !== "shade") continue;
        for (const v of BAMBOO_VINES) expect(Math.hypot(m.x - v.x, m.z - v.z)).toBeGreaterThanOrEqual(VINE_RADIUS + KEEP_FROM_FIXED);
        expect(Math.hypot(m.x - BAMBOO_LAIR.x, m.z - BAMBOO_LAIR.z)).toBeGreaterThanOrEqual(MONSTERS.shadelord.radius + KEEP_FROM_FIXED);
      }
    }
    // The vines close the gate: neighbours overlap, both ends reach the edge of the grove.
    for (let i = 1; i < BAMBOO_VINES.length; i++) {
      const a = BAMBOO_VINES[i - 1];
      const b = BAMBOO_VINES[i];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(2 * VINE_RADIUS + 0.5);
    }
    for (const v of [BAMBOO_VINES[0], BAMBOO_VINES[BAMBOO_VINES.length - 1]]) {
      expect(Math.hypot(v.x, v.z) + VINE_RADIUS).toBeGreaterThan(zone.radius);
      expect(Math.hypot(v.x, v.z)).toBeLessThan(zone.radius);
    }
  });

  test("the 그림자 무사 rises again in its lair and keeps to it", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 0, -15);
    await placed("bamboo", {});
    const all = (await $room.getRoomState()).monsters;
    await $room.updateRoomState({ monsters: { ...all, shadelord0: { ...all.shadelord0, x: 5, z: 5, deadAt: ago(MONSTERS.shadelord.respawnMs! + 10) } } });
    await server.simulateTick(entry.roomId, 200);
    const back = await monster("shadelord0");
    expect([back.mode, back.x, back.z]).toEqual(["idle", BAMBOO_LAIR.x, BAMBOO_LAIR.z]);
    // Chasing you, it goes no further than its leash.
    await $room.updateRoomState({ monstersAt: ago(1000) });
    await server.simulateTick(entry.roomId, 200);
    await $room.updateRoomState({ monstersAt: ago(1000) });
    await server.simulateTick(entry.roomId, 200);
    const lord = await monster("shadelord0");
    expect(lord.tg).toBe("test-a");
    expect(Math.hypot(lord.x - BAMBOO_LAIR.x, lord.z - BAMBOO_LAIR.z)).toBeLessThanOrEqual(MONSTERS.shadelord.leash! + 0.01);
  });
});

describe("c1q5 그림자 무사", () => {
  test("counts the 그림자 무사's kill, not ordinary shades", async (server) => {
    await goTo(server, "test-a", "bamboo");
    const index = MAIN_QUESTS.findIndex((q) => q.id === "c1q5");
    expect(MAIN_QUESTS[index].goal).toEqual({ type: "kill", kind: "shadelord", zone: "bamboo", count: 1 });
    await editProfile("test-a", (q) => ({ ...q, main: index, mainAccepted: true, mainProgress: 0, level: 5 }));
    await walkTo(server, 0, -16);
    await placed("bamboo", { shade0: { x: 1.5, z: -16, hp: 1 } });
    await ready(server, 0, -16);
    await server.attack({ kind: 1, x: 0, z: -16, yaw: 0 });
    expect((await profileOf("test-a")).mainProgress).toBe(0);
    await placed("bamboo", { shadelord0: { x: 1.5, z: -16, hp: 1 } });
    await ready(server, 0, -16);
    expect((await server.attack({ kind: 1, x: 0, z: -16, yaw: 0 })).hits[0].kill).toBe(true);
    expect((await profileOf("test-a")).mainProgress).toBe(1);
  });
});
