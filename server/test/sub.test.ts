import { countKills, nextSub, settleSub, starterProfile, subZoneFor } from "../../src/shared/profile";
import { SUB_QUESTS } from "../../src/shared/world";
import { editProfile, errorOf, inVillage, profileOf } from "./helpers";

const at = (level: number, sub = { id: "", prog: 0 }) => ({ ...starterProfile("붓잡이", 0), level, sub });

describe("서브 퀘스트 (지역 의뢰)", () => {
  test("the open one comes from the field that suits your 경지", () => {
    expect(settleSub(at(1)).sub).toEqual({ id: "s_bam1", prog: 0 });
    expect(settleSub(at(9)).sub.id).toBe("s_pond1");
    expect(settleSub(at(17)).sub.id).toBe("s_peak1");
    expect(subZoneFor(30)).toBe("temple");
  });

  test("one under way stays where it is when you outgrow its field; one not started moves on", () => {
    expect(settleSub(at(12, { id: "s_bam2", prog: 3 })).sub).toEqual({ id: "s_bam2", prog: 3 });
    expect(settleSub(at(12, { id: "s_bam2", prog: 0 })).sub).toEqual({ id: "s_pond1", prog: 0 });
  });

  test("its kills count only in its field, and only its kind (any: monsters, not vines)", () => {
    const p = at(2, { id: "s_bam1", prog: 0 });
    const q = countKills(p, [{ kind: "blob", zone: "bamboo" }, { kind: "blob", zone: "pond" }, { kind: "shade", zone: "bamboo" }]);
    expect(q.sub).toEqual({ id: "s_bam1", prog: 1 });
    const any = countKills(at(2, { id: "s_bam3", prog: 0 }), [{ kind: "shade", zone: "bamboo" }, { kind: "vine", zone: "bamboo" }]);
    expect(any.sub.prog).toBe(1);
    // it never runs past its count
    expect(countKills(at(2, { id: "s_bam2", prog: 4 }), [{ kind: "shade", zone: "bamboo" }]).sub.prog).toBe(4);
  });

  test("after one, the next of the same field, round and round", () => {
    const bamboo = SUB_QUESTS.filter((q) => q.zone === "bamboo").map((q) => q.id);
    let p = at(3, { id: bamboo[0], prog: 0 });
    const seen: string[] = [];
    for (let i = 0; i < bamboo.length + 1; i++) { p = nextSub(p); seen.push(p.sub.id); }
    expect(seen).toEqual([bamboo[1], bamboo[2], bamboo[0], bamboo[1]]);
    expect(nextSub(at(10, { id: "s_bam3", prog: 15 })).sub).toEqual({ id: "s_pond1", prog: 0 });
  });

  test("handed in from anywhere when done: paid, and the next one opens", async (server) => {
    await inVillage(server, "test-a");
    const view = await server.loadProfile();
    expect(view.sub).toEqual({ id: "s_bam1", prog: 0 });
    expect(await errorOf(server.claimSub())).toContain("quest_not_done");
    await editProfile("test-a", (q) => ({ ...q, sub: { id: "s_bam1", prog: 12 }, pigment: 0, exp: 0 }));
    const after = await server.claimSub();
    expect(after.sub).toEqual({ id: "s_bam2", prog: 0 });
    expect(after.pigment).toBe(SUB_QUESTS[0].reward.pigment);
    expect((await profileOf("test-a")).sub).toEqual({ id: "s_bam2", prog: 0 });
    // the same one can't be paid twice
    expect(await errorOf(server.claimSub())).toContain("quest_not_done");
  });
});
