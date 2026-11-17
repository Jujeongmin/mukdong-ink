/// <reference path="../src/net/local/agent8-globals.d.ts" />
import { afterEach, describe, expect, test } from "vitest";
import { LocalGameApi } from "../src/net/localApi";
import { PoseThrottle } from "../src/net/poseThrottle";
import type { RoomView } from "../src/net/api";
import type { Pose, RoomPlayer } from "../src/shared/types";
import { AD_REWARD_JADE, START_POS, ZONES } from "../src/shared/world";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pose = (x: number, z: number, atkSeq = 0): Pose => ({ x, z, y: 0, yaw: 0, atkSeq, atkKind: 0, skillSeq: 0, skill: 0 });

let api: LocalGameApi | null = null;
afterEach(() => {
  api?.dispose();
  api = null;
});

describe("the local GameApi (server code in the page)", () => {
  test("plays the whole flow: profile, village, ads, shop, gacha, a portal, monsters", async () => {
    api = new LocalGameApi({ persist: false, account: "local-test", adPresenter: async () => true });
    await api.connect();
    const profiles: number[] = [];
    api.onProfile((p) => profiles.push(p.jade));
    const first = await api.loadProfile();
    expect(first.name).toMatch(/^먹동이\d{4}$/);
    const made = await api.createCharacter("먹선이", 0xe58aa5, null);
    expect([made.created, made.name, made.dye.scarf, made.points]).toEqual([true, "먹선이", 0xe58aa5, 0]);

    const players: Record<string, RoomPlayer>[] = [];
    const rooms: RoomView[] = [];
    api.onPlayers((p) => players.push(p));
    api.onRoom((r) => rooms.push(r));
    const village = await api.enterZone("village");
    expect([village.zone, village.x, village.z]).toEqual(["village", START_POS.x, START_POS.z]);
    expect(players.at(-1)?.["local-test"]?.name).toBe(made.name);

    // Chat: said once, heard once (room state and the room message both carry it), masked.
    const heard: string[] = [];
    api.onChat((line) => heard.push(line.text));
    await api.chatSay("안녕 씨발");
    await api.world.idle();
    expect(heard).toEqual(["안녕 **"]);

    // A watched mock ad pays through the server's own claim; a skipped one pays nothing.
    expect((await api.watchAdForJade())?.jade).toBe(AD_REWARD_JADE);
    // A mock purchase arrives as $onItemPurchased.
    await api.buyJade("jade-300");
    await api.world.idle();
    expect(profiles.at(-1)).toBe(AD_REWARD_JADE + 300);
    const pulled = await api.pullGacha(1);
    expect(pulled.ids.length).toBe(1);
    expect(pulled.profile.jade).toBe(AD_REWARD_JADE + 300 - 160);

    // Walk to the bamboo portal (held to walking pace by the server, so in steps).
    const gate = ZONES.village.portals[0];
    let z: number = START_POS.z;
    while (z > gate.z) {
      z = Math.max(gate.z, z - 2.5);
      api.reportPose(pose(gate.x, z));
      await wait(230);
    }
    await wait(250);
    expect(players.at(-1)?.["local-test"]?.pose.z).toBe(gate.z);
    const bamboo = await api.enterZone("bamboo");
    expect(bamboo.zone).toBe("bamboo");
    await wait(450);
    expect(Object.keys(rooms.at(-1)?.monsters ?? {}).length).toBeGreaterThan(0);
    const hit = await api.attack({ kind: 1, x: bamboo.x, z: bamboo.z, yaw: 0 });
    expect(Array.isArray(hit.hits)).toBe(true);
  }, 20_000);

  test("a skipped mock ad pays nothing", async () => {
    api = new LocalGameApi({ persist: false, account: "local-skip", adPresenter: async () => false });
    await api.connect();
    await api.loadProfile();
    expect(await api.watchAdForJade()).toBeNull();
  });
});

describe("PoseThrottle", () => {
  test("holds poses to the platform's pace and never loses the last one", async () => {
    const sent: Pose[] = [];
    const t = new PoseThrottle((p) => sent.push(p));
    t.offer(pose(0, 0));
    t.offer(pose(1, 0));
    t.offer(pose(2, 0));
    expect(sent.length).toBe(1);
    await wait(260);
    expect(sent.map((p) => p.x)).toEqual([0, 2]);
    // An attack goes out after the minimum gap, sooner than a walk would.
    t.offer(pose(2, 0, 1));
    await wait(150);
    expect(sent.at(-1)?.atkSeq).toBe(1);
    // Standing still sends nothing more.
    const count = sent.length;
    t.offer(pose(2, 0, 1));
    await wait(250);
    expect(sent.length).toBe(count);
    t.stop();
  });
});
