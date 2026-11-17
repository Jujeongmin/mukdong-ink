import { CHANNEL_CAPACITY, DASH_BURST_GAP_MS, MAX_SPEED, MOVE_SLACK, START_POS, ZONES, roomIdFor } from "../../src/shared/world";
import { NO_ROOM, ago, errorOf, goTo, inVillage, join, newPlayer, walkTo } from "./helpers";

const portal = (from: string, to: string) => ZONES[from].portals.find((p) => p.to === to)!;

describe("entering zones", () => {
  test("a fresh start always comes into the village, whatever zone is asked for", async (server) => {
    await newPlayer(server, "test-a");
    const entry = await server.enterZone("peak");
    expect(entry).toEqual({ roomId: roomIdFor("village", 1), zone: "village", channel: 1, x: START_POS.x, z: START_POS.z });
    await join(server, "test-a", entry);
    const mine = await $room.getMyState();
    expect([mine.pose.x, mine.pose.z, mine.dead, mine.level]).toEqual([START_POS.x, START_POS.z, false, 1]);
    expect(typeof mine.name).toBe("string");
    expect(mine.look.weapon).toBe("w_brush");
  });

  test("rejects unknown zones", async (server) => {
    await newPlayer(server, "test-a");
    expect(await errorOf(server.enterZone("moon"))).toContain("bad_args");
    expect(await errorOf(server.enterZone(7))).toContain("bad_args");
  });

  test("arriving in a room the server did not send you to is refused", async (server) => {
    await newPlayer(server, "test-a");
    await server.enterZone("village");
    await server.simulateJoin(roomIdFor("peak", 3), "test-a");
    server.connect({ account: "test-a", roomId: roomIdFor("peak", 3) });
    expect(await errorOf(server.arrive())).toContain("wrong_room");
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect(await errorOf(server.arrive())).toContain("not_ready");
  });

  test("a portal takes you on only while you stand at it, and only where it leads", async (server) => {
    const village = await inVillage(server, "test-a");
    expect(await errorOf(server.enterZone("bamboo"))).toContain("too_far");
    expect(await errorOf(server.enterZone("pond"))).toContain("bad_args");
    const gate = portal("village", "bamboo");
    await walkTo(server, gate.x + 1, gate.z + 1);
    expect(await errorOf(server.enterZone("bamboo", "pond"))).toContain("wrong_room");
    const entry = await server.enterZone("bamboo", "village");
    expect(entry).toEqual({ roomId: roomIdFor("bamboo", 1), zone: "bamboo", channel: 1, x: gate.arriveX, z: gate.arriveZ });
    // The village stops drawing you at once.
    expect((await $room.getMyState()).gone).toBe(true);
    await join(server, "test-a", entry, village.roomId);
    const mine = await $room.getMyState();
    expect([mine.pose.x, mine.pose.z, mine.gone]).toEqual([gate.arriveX, gate.arriveZ, false]);
    expect((await server.loadProfile()).zone).toBe("bamboo");
  });

  test("asking for the zone you are in gives your own room back where you stand", async (server) => {
    const entry = await goTo(server, "test-a", "bamboo");
    await walkTo(server, 3, 4);
    expect(await server.enterZone("bamboo")).toEqual({ ...entry, x: 3, z: 4 });
    // Arriving again keeps you as the room has you.
    await server.arrive();
    expect((await $room.getMyState()).pose.x).toBe(3);
  });

  test("a full channel sends you to the next one", async (server) => {
    for (let i = 0; i < CHANNEL_CAPACITY; i++) await server.simulateJoin(roomIdFor("village", 1), `filler-${i}`);
    await newPlayer(server, "test-a");
    expect((await server.enterZone("village")).channel).toBe(2);
  });

  test("you keep your channel through a portal", async (server) => {
    for (let i = 0; i < CHANNEL_CAPACITY; i++) await server.simulateJoin(roomIdFor("village", 1), `filler-${i}`);
    const entry = await goTo(server, "test-a", "bamboo");
    expect(entry.channel).toBe(2);
  });

  test("the fallen cannot walk through a portal", async (server) => {
    await goTo(server, "test-a", "bamboo");
    const gate = portal("bamboo", "pond");
    await walkTo(server, gate.x, gate.z);
    await $room.updateMyState({ dead: true, hp: 0 });
    expect(await errorOf(server.enterZone("pond"))).toContain("dead");
  });
});

describe("poses", () => {
  test("are held to walking pace from the last one", async (server) => {
    await inVillage(server, "test-a");
    await $room.updateMyState({ at: ago(1000), pose: { x: 0, z: 0, y: 0, yaw: 0, atkSeq: 0, atkKind: 0, skillSeq: 0, skill: 0 } });
    await server.reportPose({ x: 20, z: 0, y: 0, yaw: 1, atkSeq: 2, atkKind: 1, skillSeq: 0, skill: 0 });
    const { pose, at } = await $room.getMyState();
    expect(pose.x).toBeGreaterThan(MAX_SPEED + MOVE_SLACK - 0.2);
    expect(pose.x).toBeLessThan(MAX_SPEED + MOVE_SLACK + 0.2);
    expect([pose.yaw, pose.atkSeq, pose.atkKind]).toEqual([1, 2, 1]);
    expect(at).toBeGreaterThan(ago(1000));
  });

  test("a dash earns its distance once, only on the report where its counter moved", async (server) => {
    await inVillage(server, "test-a");
    await $room.updateMyState({ at: ago(1000), pose: { x: 0, z: 0, y: 0, yaw: 0, atkSeq: 3, atkKind: 1, skillSeq: 0, skill: 0 } });
    await server.reportPose({ x: 20, z: 0, y: 0, yaw: 0, atkSeq: 4, atkKind: 5, skillSeq: 0, skill: 0 });
    const first = (await $room.getMyState()).pose.x;
    expect(first).toBeGreaterThan(MAX_SPEED + MOVE_SLACK + 4.5 - 0.2);
    // same counter again a second later: walking pace only
    await $room.updateMyState({ at: ago(1000) });
    await server.reportPose({ x: first + 20, z: 0, y: 0, yaw: 0, atkSeq: 4, atkKind: 5, skillSeq: 0, skill: 0 });
    expect((await $room.getMyState()).pose.x - first).toBeLessThan(MAX_SPEED + MOVE_SLACK + 0.2);
  });

  test("bumping the dash or wind counter on every report earns the burst only once per its gap", async (server) => {
    await inVillage(server, "test-a");
    await $room.updateMyState({ at: ago(150), dashAt: 0, windAt: 0, pose: { x: -20, z: 0, y: 0, yaw: 0, atkSeq: 1, atkKind: 1, skillSeq: 1, skill: 0 } });
    // first report: both bursts are earned
    // (starting at the disc's west edge so every step stays inside the village disc)
    await server.reportPose({ x: 20, z: 0, y: 0, yaw: 0, atkSeq: 2, atkKind: 5, skillSeq: 2, skill: 3 });
    const first = (await $room.getMyState()).pose.x;
    expect(first + 20).toBeGreaterThan(MOVE_SLACK + 4.5 + 11.5 - 0.2);
    // 150 ms later, counters bumped again: walking pace only
    await $room.updateMyState({ at: ago(150) });
    await server.reportPose({ x: first + 10, z: 0, y: 0, yaw: 0, atkSeq: 3, atkKind: 5, skillSeq: 3, skill: 3 });
    const second = (await $room.getMyState()).pose.x;
    expect(second - first).toBeLessThan((MAX_SPEED * 150) / 1000 + MOVE_SLACK + 0.2);
    // once the dash gap has passed the dash pays again, the wind (longer gap) still does not
    await $room.updateMyState({ at: ago(150), dashAt: ago(DASH_BURST_GAP_MS + 10) });
    await server.reportPose({ x: second + 10, z: 0, y: 0, yaw: 0, atkSeq: 4, atkKind: 5, skillSeq: 4, skill: 3 });
    const third = (await $room.getMyState()).pose.x;
    expect(third - second).toBeGreaterThan(MOVE_SLACK + 4.5 - 0.2);
    expect(third - second).toBeLessThan((MAX_SPEED * 150) / 1000 + MOVE_SLACK + 4.5 + 0.2);
  });

  test("stay inside the zone disc", async (server) => {
    await inVillage(server, "test-a");
    await walkTo(server, 500, 0);
    const { pose } = await $room.getMyState();
    expect(Math.hypot(pose.x, pose.z)).toBeLessThanOrEqual(ZONES.village.radius + 0.01);
  });

  test("must be poses, sent from a room you arrived in; the fallen do not move", async (server) => {
    await inVillage(server, "test-a");
    expect(await errorOf(server.reportPose({ x: "1", z: 0, yaw: 0 }))).toContain("bad_args");
    await $room.updateMyState({ dead: true });
    await walkTo(server, 5, 5);
    expect((await $room.getMyState()).pose.x).toBe(START_POS.x);
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect(await errorOf(server.reportPose({ x: 1, z: 0, yaw: 0 }))).toContain("not_ready");
  });
});
