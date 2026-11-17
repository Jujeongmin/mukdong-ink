/// <reference path="../src/net/local/agent8-globals.d.ts" />
import { afterEach, describe, expect, test } from "vitest";
import { Server } from "../server/src/server";
import { LocalGameApi } from "../src/net/localApi";
import { LocalWorld } from "../src/net/local/localWorld";
import { CHAT_GAP_MS } from "../src/shared/chat";
import { CHANNEL_CAPACITY, roomIdFor } from "../src/shared/world";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const apis: LocalGameApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});

async function player(world: LocalWorld, account: string): Promise<{ api: LocalGameApi; heard: string[] }> {
  const api = new LocalGameApi({ persist: false, account, world });
  apis.push(api);
  await api.connect();
  await api.loadProfile();
  const heard: string[] = [];
  api.onChat((line) => heard.push(line.text));
  return { api, heard };
}

describe("chat is live only", () => {
  test("a newcomer hears nothing said before joining, the room hears what comes after, other channels nothing", async () => {
    const world = new LocalWorld(new Server());
    const a = await player(world, "local-a");
    const entry = await a.api.enterZone("village");
    await a.api.chatSay("먼저 한 말");
    const b = await player(world, "local-b");
    expect((await b.api.enterZone("village")).roomId).toBe(entry.roomId);
    await world.idle();
    expect(b.heard).toEqual([]);
    // Channel 1 fills up; the third player lands on channel 2.
    for (let i = 0; i < CHANNEL_CAPACITY; i++) await world.join(`filler-${i}`, roomIdFor("village", 1));
    const c = await player(world, "local-c");
    expect((await c.api.enterZone("village")).channel).toBe(2);
    await wait(CHAT_GAP_MS + 50);
    await a.api.chatSay("나중 한 말");
    await world.idle();
    expect(b.heard).toEqual(["나중 한 말"]);
    expect(a.heard).toEqual(["먼저 한 말", "나중 한 말"]);
    expect(c.heard).toEqual([]);
    // Nothing kept in the room.
    expect(world.roomState(entry.roomId).chat).toBeUndefined();
  }, 10_000);
});
