import { CHAT_GAP_MS, CHAT_KEEP, CHAT_MAX, CHAT_REPEAT_MS } from "../../src/shared/chat";
import { isBannedName, maskChat } from "../../src/shared/filter";
import { CHANNEL_CAPACITY, roomIdFor } from "../../src/shared/world";
import { NO_ROOM, ago, editProfile, errorOf, inVillage, newPlayer } from "./helpers";

/** Lets the caller speak again at once (pace and repeat cleared). */
async function rested(): Promise<void> {
  await $room.updateMyState({ chatAt: [], chatHash: 0, chatHashAt: 0 });
}

describe("chat", () => {
  test("a line goes to the room with the profile's name, tidied", async (server) => {
    await inVillage(server, "test-a");
    await editProfile("test-a", (q) => ({ ...q, name: "붓잡이" }));
    const line = await server.chatSay("  안녕​   하세요\t!  ");
    expect([line.name, line.text, line.account, line.sys]).toEqual(["붓잡이", "안녕 하세요 !", "test-a", undefined]);
    const { chat } = await $room.getRoomState();
    expect(chat.map((l: any) => l.text)).toEqual(["안녕 하세요 !"]);
    // Extra arguments do not choose the name or the speaker.
    await rested();
    const forged = await server.chatSay("또 안녕", "운영자", "test-b");
    expect([forged.name, forged.account]).toEqual(["붓잡이", "test-a"]);
  });

  test("empty, invisible-only, too long or not text is refused", async (server) => {
    await inVillage(server, "test-a");
    for (const bad of ["", "   ", "​‍", "가".repeat(CHAT_MAX + 1), 42, null, { text: "hi" }]) {
      expect(await errorOf(server.chatSay(bad))).toContain("bad_args");
    }
    expect((await server.chatSay("가".repeat(CHAT_MAX))).text.length).toBe(CHAT_MAX);
  });

  test("needs a room you stand in", async (server) => {
    await newPlayer(server, "test-a");
    server.connect({ account: "test-a", roomId: NO_ROOM });
    expect(await errorOf(server.chatSay("hi"))).toContain("not_ready");
  });

  test("is held to one line per gap and five per ten seconds", async (server) => {
    await inVillage(server, "test-a");
    await server.chatSay("하나");
    expect(await errorOf(server.chatSay("둘"))).toContain("on_cooldown");
    // Five lines spaced out over the last ten seconds: the sixth waits.
    const spaced = [9000, 7000, 5000, 3000, CHAT_GAP_MS + 100].map((ms) => ago(ms));
    await $room.updateMyState({ chatAt: spaced, chatHash: 0 });
    expect(await errorOf(server.chatSay("여섯"))).toContain("on_cooldown");
    await $room.updateMyState({ chatAt: spaced.slice(1), chatHash: 0 });
    expect(await errorOf(server.chatSay("다섯"))).toBe("");
  });

  test("the same line again within ten seconds is refused, a new one is not", async (server) => {
    await inVillage(server, "test-a");
    await server.chatSay("같은 말");
    await $room.updateMyState({ chatAt: [] });
    expect(await errorOf(server.chatSay("같은  말 "))).toContain("rate_limited");
    expect(await errorOf(server.chatSay("다른 말"))).toBe("");
    await $room.updateMyState({ chatAt: [], chatHashAt: ago(CHAT_REPEAT_MS + 10) });
    expect(await errorOf(server.chatSay("다른 말"))).toBe("");
    // The repeat check keeps no chat text in the room user state.
    expect(JSON.stringify(await $room.getMyState()).includes("다른")).toBe(false);
  });

  test("swearing is masked, evasions too, everyday words are not", async (server) => {
    await inVillage(server, "test-a");
    expect((await server.chatSay("아 씨발 진짜")).text).toBe("아 ** 진짜");
    expect(maskChat("시.발")).toBe("***");
    expect(maskChat("시1발놈")).toBe("***놈");
    expect(maskChat("시 발")).toBe("* *");
    expect(maskChat("ㅅㅂ 뭐야")).toBe("** 뭐야");
    expect(maskChat("씨8")).toBe("**");
    expect(maskChat("FUCK you")).toBe("**** you");
    expect(maskChat("f.u.c.k")).toBe("*******");
    expect(maskChat("sh1t")).toBe("****");
    expect(maskChat("ｆｕｃｋ")).toBe("****");
    expect(maskChat("f u c k off")).toBe("* * * * off");
    // Not across words, and not inside everyday words.
    expect(maskChat("다시 발견했다")).toBe("다시 발견했다");
    expect(maskChat("시발점에서 껌을 씹다")).toBe("시발점에서 껌을 씹다");
    expect(maskChat("안녕하세요")).toBe("안녕하세요");
  });

  test("names may not pose as staff or hold swearing; chat shows such an old name as 먹동이", async (server) => {
    for (const bad of ["운영자", "GM먹동", "admin7", "씨발이", "시1발"]) expect(isBannedName(bad)).toBe(true);
    for (const ok of ["Pigment", "먹선이", "Admiral", "검객"]) expect(isBannedName(ok)).toBe(false);
    await inVillage(server, "test-a");
    expect(await errorOf(server.setName("운영자"))).toContain("bad_name");
    expect(await errorOf(server.setName("GM먹동"))).toContain("bad_name");
    await editProfile("test-a", (q) => ({ ...q, name: "관리자" }));
    expect((await server.chatSay("안녕")).name).toBe("먹동이");
  });

  test("only the room hears it: another channel of the zone does not", async (server) => {
    for (let i = 0; i < CHANNEL_CAPACITY; i++) await server.simulateJoin(roomIdFor("village", 1), `filler-${i}`);
    const b = await inVillage(server, "test-b");
    expect(b.channel).toBe(2);
    await server.chatSay("이 채널만");
    server.connect({ account: "filler-0", roomId: roomIdFor("village", 1) });
    expect((await $room.getRoomState()).chat).toBeUndefined();
    server.connect({ account: "test-b", roomId: b.roomId });
    expect((await $room.getRoomState()).chat.length).toBe(1);
  });

  test("the room keeps only its last lines, and none older than two minutes", async (server) => {
    await inVillage(server, "test-a");
    const old = { id: "old", account: "x", name: "x", text: "옛말", at: ago(130_000) };
    const lines = Array.from({ length: CHAT_KEEP }, (_, i) => ({ id: `l${i}`, account: "x", name: "x", text: `${i}`, at: ago(1000) }));
    await $room.updateRoomState({ chat: [old, ...lines] });
    await server.chatSay("새 말");
    const { chat } = await $room.getRoomState();
    expect(chat.length).toBe(CHAT_KEEP);
    expect(chat[0].id).toBe("l1");
    expect(chat[CHAT_KEEP - 1].text).toBe("새 말");
  });
});
