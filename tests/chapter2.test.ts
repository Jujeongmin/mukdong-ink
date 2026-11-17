import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ARMOR_PLUS6, MAX_LEVEL, MONSTERS, armorHolds, expToNext } from "../src/shared/combat";
import { DROPS } from "../src/shared/growth";
import { QUEST_VERSION, gainExp, readProfile, starterProfile } from "../src/shared/profile";
import { CHAPTER2_END, CHAPTER_END, CHAPTER_ENDS, IDLE_LINES, NPC_INFO, QUEST_STORY, chapterOf } from "../src/shared/story";
import { MAIN_QUESTS, ZONES, parseRoomId } from "../src/shared/world";

const NEW_KINDS = ["jar", "crow", "shademonk", "lantern", "kilnlord", "ashboss"];

describe("chapter 2 data", () => {
  test("level cap 35; a Lv20 profile capped at exp 0 gains again", () => {
    expect(MAX_LEVEL).toBe(35);
    const capped = { ...starterProfile("먹동이0001", 0), level: 20, exp: 0 };
    const r = gainExp(capped, expToNext(20) + 10);
    expect([r.profile.level, r.profile.exp, r.levelUp]).toEqual([21, 10, true]);
    const top = gainExp({ ...capped, level: 34 }, 10_000_000).profile;
    expect([top.level, top.exp]).toEqual([35, 0]);
  });

  test("saves from the old quest list (no qv) move down past the removed intro quests, once", () => {
    // Old list: c1q1, c1q2, c1q3, ... c1q10 (index 9), c2q1 (index 10).
    const at = (main: number, extra: Record<string, unknown> = {}) => readProfile({ name: "옛사람", main, level: 20, ...extra })!;
    expect(MAIN_QUESTS[at(10).main].id).toBe("c2q1");
    expect(MAIN_QUESTS[at(9).main].id).toBe("c1q10");
    expect(MAIN_QUESTS[at(2).main].id).toBe("c1q3");
    // On a removed quest: the new first quest, not accepted, no progress.
    const intro = at(1, { mainAccepted: true, mainProgress: 1 });
    expect([intro.main, intro.mainAccepted, intro.mainProgress, intro.qv]).toEqual([0, false, 0, QUEST_VERSION]);
    expect(at(0).main).toBe(0);
    // Progress on a quest that still exists is kept.
    const mid = at(4, { mainAccepted: true, mainProgress: 2 });
    expect([MAIN_QUESTS[mid.main].id, mid.mainAccepted, mid.mainProgress]).toEqual(["c1q5", true, 2]);
    // Already migrated (qv = 2): the index is taken as it is.
    expect(readProfile({ ...intro, main: 8 })!.main).toBe(8);
    expect(readProfile({ name: "끝", main: 999, qv: QUEST_VERSION })!.main).toBe(MAIN_QUESTS.length);
    expect(starterProfile("새사람", 0).qv).toBe(QUEST_VERSION);
  });

  test("armor boundaries: 화염선풍 4/5 for the 가마 지킴이, brush +5/+6 for 잿불귀", () => {
    expect(armorHolds(MONSTERS.kilnlord, [1, 4, 1, 1, 1], 0)).toBe(true);
    expect(armorHolds(MONSTERS.kilnlord, [1, 5, 1, 1, 1], 0)).toBe(false);
    expect(armorHolds(MONSTERS.ashboss, [10, 10, 10, 10, 10], ARMOR_PLUS6 - 1)).toBe(true);
    expect(armorHolds(MONSTERS.ashboss, [1, 1, 1, 1, 1], ARMOR_PLUS6)).toBe(false);
  });

  test("every new monster, zone, quest, NPC and drop is there and consistent", () => {
    for (const kind of NEW_KINDS) {
      expect(MONSTERS[kind]?.kind).toBe(kind);
      expect(DROPS[kind]).toBeDefined();
    }
    for (const zone of ["kiln", "temple", "censer"]) {
      expect(ZONES[zone].theme).toBe(zone);
      expect(parseRoomId(`ink-${zone}-3`)).toEqual({ zone, channel: 3 });
      for (const p of ZONES[zone].portals) expect(ZONES[p.to].portals.some((back) => back.to === zone)).toBe(true);
    }
    const c2 = MAIN_QUESTS.filter((q) => q.id.startsWith("c2"));
    expect(c2.length).toBe(10);
    for (const q of c2) {
      expect(QUEST_STORY[q.id]).toBeDefined();
      for (const who of [q.giver, q.turnIn]) expect(NPC_INFO[who]).toBeDefined();
      const goal = q.goal;
      if (goal.type === "kill") expect(MONSTERS[goal.kind]).toBeDefined();
      if (goal.type === "reach") expect(ZONES[goal.zone]).toBeDefined();
    }
    for (const id of ["dalrae", "haedam", "hongmae", "voice"]) expect(NPC_INFO[id]).toBeDefined();
    expect(IDLE_LINES.dalrae.length).toBe(3);
    expect(IDLE_LINES.haedam.length).toBe(3);
    // Story lines only use known speakers.
    const speakers = new Set(["", "me", ...Object.keys(NPC_INFO)]);
    for (const story of Object.values(QUEST_STORY)) {
      for (const line of [...story.offer, ...story.progress, ...story.complete]) expect(speakers.has(line.who)).toBe(true);
    }
    for (const line of CHAPTER2_END) expect(speakers.has(line.who)).toBe(true);
  });

  test("chapter of a quest, and the chapter endings by number", () => {
    const last1 = MAIN_QUESTS.findIndex((q) => q.id === "c1q10");
    expect(chapterOf(last1)).toBe(1);
    expect(chapterOf(last1 + 1)).toBe(2);
    expect(chapterOf("c2q4")).toBe(2);
    expect(chapterOf("c1q1")).toBe(1);
    expect(CHAPTER_ENDS[1]).toBe(CHAPTER_END);
    expect(CHAPTER_ENDS[2]).toBe(CHAPTER2_END);
  });

  test("no hanja anywhere in the shared data", () => {
    const hanja = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
    for (const file of readdirSync("src/shared")) {
      expect(hanja.test(readFileSync(`src/shared/${file}`, "utf8"))).toBe(false);
    }
  });
});
