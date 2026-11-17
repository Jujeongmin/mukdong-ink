import { maxHpFor } from "../../src/shared/combat";
import { STARTER_DYE, STARTER_EQUIP, STARTER_OWNED } from "../../src/shared/items";
import { PROTOCOL_VERSION } from "../../src/shared/types";
import { START_ZONE } from "../../src/shared/world";
import { NO_ROOM, errorOf, inVillage, newPlayer } from "./helpers";

describe("profile", () => {
  test("the server tells its protocol and clock", async (server) => {
    const v = await server.getServerVersion();
    expect(v.protocol).toBe(PROTOCOL_VERSION);
    expect(typeof v.now).toBe("number");
  });

  test("is made on the first load with a 먹동이 name, the starter kit and three potions", async (server) => {
    const p = await newPlayer(server, "test-a");
    expect(p.name).toMatch(/^먹동이\d{4}$/);
    expect(p.owned).toEqual(STARTER_OWNED);
    expect(p.equip).toEqual(STARTER_EQUIP);
    expect(p.dye).toEqual(STARTER_DYE);
    expect([p.potions, p.level, p.exp, p.jade, p.pigment, p.zone]).toEqual([3, 1, 0, 0, 0, START_ZONE]);
    expect([p.hp, p.maxHp, p.account]).toEqual([maxHpFor(1), maxHpFor(1), "test-a"]);
    // The same profile the next time, and its name is taken.
    expect((await server.loadProfile()).name).toBe(p.name);
    expect(await $global.countCollectionItems("nicknames")).toBe(1);
  });

  test("every other call needs a profile first", async (server) => {
    server.connect({ account: "test-z", roomId: NO_ROOM });
    expect(await errorOf(server.enterZone("village"))).toContain("no_profile");
    expect(await errorOf(server.equip("w_brush"))).toContain("no_profile");
  });

  test("a name is 2–8 hangul, latin letters or digits, never hanja, and unique", async (server) => {
    await newPlayer(server, "test-a");
    for (const bad of ["가", "가나다라마바사아자", String.fromCharCode(0x58a8) + "동이", "먹 동", "ㄱㄴ", "", 42, null]) {
      expect(await errorOf(server.setName(bad))).toContain("bad_name");
    }
    expect((await server.setName("  붓잡이  ")).name).toBe("붓잡이");
    await newPlayer(server, "test-b");
    expect(await errorOf(server.setName("붓잡이"))).toContain("name_taken");
    expect(await errorOf(server.setName("BUT1"))).toBe("");
    // Not case-sensitive: "but1" is the same name.
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect(await errorOf(server.setName("but1"))).toContain("name_taken");
    // Changing it lets the old one go.
    await server.setName("Ink7");
    server.connect({ account: "test-b", roomId: NO_ROOM });
    expect((await server.setName("붓잡이")).name).toBe("붓잡이");
  });

  test("a new name shows in the room at once", async (server) => {
    await inVillage(server, "test-a");
    await server.setName("먹선");
    expect((await $room.getMyState()).name).toBe("먹선");
  });
});
