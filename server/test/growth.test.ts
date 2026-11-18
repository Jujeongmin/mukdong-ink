import { SKILLS, attackFor } from "../../src/shared/combat";
import { DROPS, ENHANCE_MAX, ENHANCE_TABLE, PROTECT_PRICE, SKILL_MAX, enhancedAtk, skillCdMul, skillDmgMul } from "../../src/shared/growth";
import { DYES } from "../../src/shared/items";
import { spawnZone } from "../src/hunt";
import { NO_ROOM, editProfile, errorOf, goTo, inVillage, newPlayer, profileOf, rolling, walkTo } from "./helpers";

const red = DYES.find((d) => d.name === "빨강")!.hex;
const pink = DYES.find((d) => d.name === "보라")!.hex;
const cast = (skill: number) => ({ skill, x: 0, z: 0, yaw: 0 });

/** Exactly these monsters alive in the caller's room, at these spots (all others felled for good). */
async function placed(zone: string, alive: Record<string, { x: number; z: number; hp?: number }>): Promise<void> {
  const all = spawnZone(zone, 0, () => 0.5);
  const monsters: Record<string, any> = {};
  for (const [id, m] of Object.entries(all)) {
    const at = alive[id];
    monsters[id] = at
      ? { ...m, x: at.x, z: at.z, hx: at.x, hz: at.z, wx: at.x, wz: at.z, hp: at.hp ?? 500, maxHp: 500, mode: "idle", since: Date.now() }
      : { ...m, mode: "dead", hp: 0, deadAt: Number.MAX_SAFE_INTEGER };
  }
  await $room.updateRoomState({ monsters, effects: [], monstersAt: Date.now() });
}

async function ready(server: any): Promise<void> {
  await walkTo(server, 0, 0);
  await $room.updateMyState({ atkAt: 0, cds: [] });
}

describe("character creation", () => {
  test("happens once: a free name and scarf and sash colors from the dyes", async (server) => {
    const fresh = await newPlayer(server, "test-a");
    expect([fresh.created, fresh.skills, fresh.points, fresh.stones, fresh.protects, fresh.enh]).toEqual([false, [1, 1, 1, 1, 1], 0, 0, 0, {}]);
    expect(await errorOf(server.createCharacter("붓잡이", 0x123456, null))).toContain("bad_args");
    expect(await errorOf(server.createCharacter("붓잡이", red, 7))).toContain("bad_args");
    expect(await errorOf(server.createCharacter("가", red, null))).toContain("bad_name");
    const p = await server.createCharacter("붓잡이", red, null);
    expect([p.created, p.name, p.dye, p.pigment]).toEqual([true, "붓잡이", { scarf: red, sash: null }, 0]);
    expect(await errorOf(server.createCharacter("다른이름", pink, pink))).toContain("already_claimed");
    await newPlayer(server, "test-b");
    expect(await errorOf(server.createCharacter("붓잡이", pink, pink))).toContain("name_taken");
  });

  test("keeping the given name is fine, and the room sees the colors", async (server) => {
    await inVillage(server, "test-a");
    const name = (await profileOf("test-a")).name;
    await server.createCharacter(name, pink, red);
    const { look } = await $room.getMyState();
    expect([look.scarfDye, look.sashDye, look.plus, look.skills]).toEqual([pink, red, 0, [1, 1, 1, 1, 1]]);
  });
});

describe("training techniques", () => {
  test("costs a training point (one per level gained, plus quest bonuses) and pigment", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.trainSkill(0))).toContain("no_currency");
    expect(await errorOf(server.trainSkill(5))).toContain("bad_args");
    await editProfile("test-a", (q) => ({ ...q, level: 3, pigment: 1000 }));
    const p = await server.trainSkill(0);
    expect([p.skills[0], p.pigment, p.points]).toEqual([2, 1000 - 30, 1]);
    expect(await errorOf(server.trainSkill(1))).toContain("locked");
    expect((await server.trainSkill(0)).points).toBe(0);
    expect(await errorOf(server.trainSkill(0))).toContain("no_currency");
    await editProfile("test-a", (q) => ({ ...q, bonusPoints: 1 }));
    expect((await server.trainSkill(0)).skills[0]).toBe(4);
  });

  test("awakening levels take 색 조각; no level past SKILL_MAX", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, level: 20, pigment: 10000, skills: [4, 1, 1, 1, 1] }));
    expect(await errorOf(server.trainSkill(0))).toContain("no_currency");
    await editProfile("test-a", (q) => ({ ...q, shards: 1 }));
    const p = await server.trainSkill(0);
    expect([p.skills[0], p.shards]).toEqual([5, 0]);
    await editProfile("test-a", (q) => ({ ...q, skills: [SKILL_MAX, 1, 1, 1, 1] }));
    expect(await errorOf(server.trainSkill(0))).toContain("bad_args");
  });

  test("the room sees the new level", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, level: 2, pigment: 100 }));
    await server.trainSkill(0);
    expect((await $room.getMyState()).look.skills).toEqual([2, 1, 1, 1, 1]);
  });
});

describe("brush enhancement", () => {
  test("costs stones and pigment; a success raises the brush and its attack", async (server) => {
    await inVillage(server, "test-a");
    expect(await errorOf(server.enhance("w_gold", false))).toContain("not_owned");
    expect(await errorOf(server.enhance("h_satgat", false))).toContain("bad_args");
    expect(await errorOf(server.enhance("w_brush", "yes"))).toContain("bad_args");
    expect(await errorOf(server.enhance("w_brush", false))).toContain("no_currency");
    await editProfile("test-a", (q) => ({ ...q, stones: 10, pigment: 100 }));
    const r = await rolling(0, () => server.enhance("w_brush", false));
    expect([r.outcome, r.plus, r.profile.enh.w_brush, r.profile.stones, r.profile.pigment]).toEqual([
      "success", 1, 1, 10 - ENHANCE_TABLE[0].stones, 100 - ENHANCE_TABLE[0].pigment,
    ]);
    expect(r.profile.atk).toBe(attackFor(1, enhancedAtk(10, 1)));
    expect((await $room.getMyState()).look.plus).toBe(1);
  });

  test("a failure below the destroying tiers only spends the materials", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, stones: 100, pigment: 1000, enh: { w_brush: 5 } }));
    const r = await rolling(0.99, () => server.enhance("w_brush", false));
    expect([r.outcome, r.plus, r.profile.stones]).toEqual(["fail", 5, 100 - ENHANCE_TABLE[5].stones]);
  });

  test("from the destroying tiers a failure can break the brush: gone, and the starter brush is back in hand", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({
      ...q, stones: 100, pigment: 1000, owned: [...q.owned, "w_gold"], equip: { ...q.equip, weapon: "w_gold" }, enh: { w_gold: 12 },
    }));
    const r = await rolling([0.99, 0], () => server.enhance("w_gold", false));
    expect([r.outcome, r.plus]).toEqual(["destroyed", 0]);
    expect(r.profile.owned.includes("w_gold")).toBe(false);
    expect([r.profile.equip.weapon, r.profile.enh]).toEqual(["w_brush", {}]);
    expect((await $room.getMyState()).look.weapon).toBe("w_brush");
  });

  test("a protection ticket saves the brush, and is spent on every attempt it is used for", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, stones: 100, pigment: 1000, owned: [...q.owned, "w_gold"], enh: { w_gold: 12 } }));
    expect(await errorOf(server.enhance("w_gold", true))).toContain("no_currency");
    await editProfile("test-a", (q) => ({ ...q, protects: 2 }));
    const saved = await rolling([0.99, 0], () => server.enhance("w_gold", true));
    expect([saved.outcome, saved.plus, saved.profile.protects, saved.profile.owned.includes("w_gold")]).toEqual(["protected", 12, 1, true]);
    const won = await rolling(0, () => server.enhance("w_gold", true));
    expect([won.outcome, won.plus, won.profile.protects]).toEqual(["success", 13, 0]);
  });

  test("the starter brush never breaks: it drops back to +0", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, stones: 100, pigment: 1000, enh: { w_brush: 12 } }));
    const r = await rolling([0.99, 0], () => server.enhance("w_brush", false));
    expect([r.outcome, r.plus, r.profile.owned.includes("w_brush"), r.profile.equip.weapon, r.profile.enh]).toEqual(["destroyed", 0, true, "w_brush", {}]);
  });

  test("stops at ENHANCE_MAX", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, stones: 100, pigment: 1000, enh: { w_brush: ENHANCE_MAX } }));
    expect(await errorOf(server.enhance("w_brush", false))).toContain("bad_args");
  });
});

describe("protection tickets", () => {
  test("are bought with jade, up to ten at a time", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.buyProtect(1))).toContain("no_currency");
    expect(await errorOf(server.buyProtect(11))).toContain("bad_args");
    expect(await errorOf(server.buyProtect(0))).toContain("bad_args");
    await editProfile("test-a", (q) => ({ ...q, jade: PROTECT_PRICE * 2 + 50 }));
    const p = await server.buyProtect(2);
    expect([p.protects, p.jade]).toEqual([2, 50]);
  });
});

describe("drops", () => {
  test("a kill may drop materials to the killer, rolled on the server", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await placed("bamboo", { blob0: { x: 1.5, z: 0, hp: 1 } });
    await ready(server);
    const lucky = await rolling(0, () => server.attack({ kind: 1, x: 0, z: 0, yaw: 0 }));
    expect([lucky.stones, lucky.shards]).toEqual([DROPS.blob.stone[1], 0]);
    expect((await profileOf("test-a")).stones).toBe(DROPS.blob.stone[1]);
    await placed("bamboo", { blob1: { x: 1.5, z: 0, hp: 1 } });
    await ready(server);
    const unlucky = await rolling(0.99, () => server.attack({ kind: 1, x: 0, z: 0, yaw: 0 }));
    expect([unlucky.stones, unlucky.shards]).toEqual([0, 0]);
  });

  test("the boss drops to everyone who hit it", async (server) => {
    await goTo(server, "test-b", "peak");
    await goTo(server, "test-a", "peak");
    await placed("peak", { boss: { x: 1.5, z: 0, hp: 1 } });
    const all = (await $room.getRoomState()).monsters;
    await $room.updateRoomState({ monsters: { ...all, boss: { ...all.boss, by: ["test-b"] } } });
    await ready(server);
    const r = await rolling(0.5, () => server.attack({ kind: 3, x: 0, z: 0, yaw: 0 }));
    expect([r.stones, r.shards]).toEqual([DROPS.boss.stone[1], DROPS.boss.shard[1]]);
    const b = await profileOf("test-b");
    expect([b.stones, b.shards]).toEqual([DROPS.boss.stone[1], DROPS.boss.shard[1]]);
  });
});

describe("technique levels", () => {
  test("raise the damage and shorten the cooldown", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (q) => ({ ...q, skills: [3, 1, 1, 1, 1] }));
    await placed("bamboo", { blob0: { x: 5, z: 0 } });
    await ready(server);
    const r = await server.castSkill(cast(0));
    expect(r.hits).toEqual([{ id: "blob0", dmg: Math.round(attackFor(1, 10) * SKILLS[0].hits.dmg * skillDmgMul(3)), kill: false }]);
    await editProfile("test-a", (q) => ({ ...q, skills: [10, 1, 1, 1, 1] }));
    await ready(server);
    const before = Date.now();
    await server.castSkill(cast(0));
    const { cds } = await $room.getMyState();
    const expected = SKILLS[0].cd * skillCdMul(10) * 1000 * 0.8;
    expect(cds[0] - before).toBeGreaterThanOrEqual(expected - 5);
    expect(cds[0] - before).toBeLessThanOrEqual(expected + 200);
  });

  test("an awakened wave fans out into extra waves, each monster hit once", async (server) => {
    await goTo(server, "test-a", "bamboo");
    const side = 11.5;
    const a = (15 * Math.PI) / 180;
    // One straight ahead (inside all three waves), one down the +15° wave only.
    await placed("bamboo", { blob0: { x: 2, z: 0 }, blob1: { x: side * Math.cos(a), z: -side * Math.sin(a) } });
    await ready(server);
    expect((await server.castSkill(cast(0))).hits.map((h: any) => h.id)).toEqual(["blob0"]);
    await editProfile("test-a", (q) => ({ ...q, skills: [5, 1, 1, 1, 1] }));
    await placed("bamboo", { blob0: { x: 2, z: 0 }, blob1: { x: side * Math.cos(a), z: -side * Math.sin(a) } });
    await ready(server);
    expect((await server.castSkill(cast(0))).hits.map((h: any) => h.id).sort()).toEqual(["blob0", "blob1"]);
  });

  test("awakening widens a ring; the second awakening adds an echo hit on what still stands", async (server) => {
    await goTo(server, "test-a", "bamboo");
    await editProfile("test-a", (q) => ({ ...q, level: 4 }));
    await placed("bamboo", { blob0: { x: 5.2, z: 0 } });
    await ready(server);
    expect((await server.castSkill(cast(1))).hits).toEqual([]);
    await editProfile("test-a", (q) => ({ ...q, skills: [1, 5, 1, 1, 1] }));
    await ready(server);
    expect((await server.castSkill(cast(1))).hits.length).toBe(1);
    await editProfile("test-a", (q) => ({ ...q, skills: [1, 10, 1, 1, 1] }));
    await placed("bamboo", { blob0: { x: 1, z: 0 }, blob1: { x: -1, z: 0, hp: 1 } });
    await ready(server);
    const r = await server.castSkill(cast(1));
    const first = Math.round(attackFor(4, 10) * SKILLS[1].hits.dmg * skillDmgMul(10));
    const ids = r.hits.map((h: any) => h.id);
    // The felled one is not hit again; the standing one takes the echo.
    expect(ids.filter((id: string) => id === "blob1").length).toBe(1);
    expect(r.hits.filter((h: any) => h.id === "blob0").map((h: any) => h.dmg)).toEqual([first, Math.round(first * 0.6)]);
  });
});

describe("old saves", () => {
  test("gain the new fields with their defaults", async (server) => {
    await newPlayer(server, "test-a");
    await editProfile("test-a", (q) => {
      const { created, skills, bonusPoints, stones, shards, protects, enh, ...old } = q;
      void [created, skills, bonusPoints, stones, shards, protects, enh];
      return old;
    });
    server.connect({ account: "test-a", roomId: NO_ROOM });
    const p = await server.loadProfile();
    expect([p.created, p.skills, p.bonusPoints, p.stones, p.shards, p.protects, p.enh, p.points]).toEqual([false, [1, 1, 1, 1, 1], 0, 0, 0, 0, {}, 0]);
  });
});
