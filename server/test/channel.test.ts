import { CHANNELS, CHANNEL_CAPACITY, roomIdFor } from "../../src/shared/world";
import { errorOf, inVillage, join, walkTo } from "./helpers";

/** Lets the caller pick a channel again at once (the hop pace cleared). */
async function rested(account: string): Promise<void> {
  await $global.updateUserState(account, { chHopAt: 0 });
}

describe("channels picked by hand", () => {
  test("the list shows how many are in each channel of this zone, and which one is yours", async (server) => {
    const entry = await inVillage(server, "test-a");
    const list = await server.channelList();
    expect(list.current).toBe(entry.channel);
    expect(list.players).toHaveLength(CHANNELS);
    expect(list.players[entry.channel - 1]).toBe(1);
  });

  test("moves you to another channel of the same zone, where you stood", async (server) => {
    const entry = await inVillage(server, "test-a");
    await walkTo(server, 3, -2);
    const to = entry.channel === 2 ? 3 : 2;
    const next = await server.changeChannel(to);
    expect([next.zone, next.channel, next.roomId, next.x, next.z]).toEqual(["village", to, roomIdFor("village", to), 3, -2]);
    const arrived = await join(server, "test-a", next, entry.roomId);
    expect(arrived.channel).toBe(to);
    expect((await server.channelList()).current).toBe(to);
  });

  test("once per ten seconds", async (server) => {
    const entry = await inVillage(server, "test-a");
    const a = entry.channel === 2 ? 3 : 2;
    await join(server, "test-a", await server.changeChannel(a), entry.roomId);
    expect(await errorOf(server.changeChannel(entry.channel))).toContain("on_cooldown");
    await rested("test-a");
    expect((await server.changeChannel(entry.channel)).channel).toBe(entry.channel);
  });

  test("not into a full channel, not to the one you are in, not to one that doesn't exist", async (server) => {
    const entry = await inVillage(server, "test-a");
    const to = entry.channel === 2 ? 3 : 2;
    for (let i = 0; i < CHANNEL_CAPACITY; i++) await server.simulateJoin(roomIdFor("village", to), `crowd-${i}`);
    server.connect({ account: "test-a", roomId: entry.roomId });
    expect(await errorOf(server.changeChannel(to))).toContain("room_full");
    for (const bad of [entry.channel, 0, CHANNELS + 1, 1.5, "2", null]) {
      expect(await errorOf(server.changeChannel(bad))).toContain("bad_args");
    }
  });
});
