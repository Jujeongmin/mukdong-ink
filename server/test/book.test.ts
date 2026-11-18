import { BOOK, BOOK_PAGE, bookAfter, bookBonus, bookStage } from "../../src/shared/book";
import { atkOf, countKills, maxHpOf, readProfile, starterProfile } from "../../src/shared/profile";
import { MONSTERS } from "../../src/shared/combat";
import { editProfile, inVillage, profileOf } from "./helpers";

describe("먹그림 도감", () => {
  test("every page is a real monster, vines left out", () => {
    for (const b of BOOK) expect(MONSTERS[b.kind]).toBeDefined();
    expect(BOOK_PAGE.vine).toBeUndefined();
  });

  test("steps: 밑그림 at the first count, 완성 at the second; counts stop there", () => {
    const blob = BOOK_PAGE.blob;
    expect(bookStage(blob, blob.need[0] - 1)).toBe(0);
    expect(bookStage(blob, blob.need[0])).toBe(1);
    expect(bookStage(blob, blob.need[1])).toBe(2);
    const full = bookAfter({ blob: blob.need[1] }, ["blob", "blob", "vine"]);
    expect(full).toEqual({ blob: blob.need[1] });
  });

  test("finished pages raise attack and max health", () => {
    const p = { ...starterProfile("붓잡이", 0), level: 10 };
    const book = { shade: BOOK_PAGE.shade.need[1], blob: BOOK_PAGE.blob.need[0] };
    expect(bookBonus(book)).toEqual({ atk: 0.02, hp: 0.01 });
    expect(atkOf({ ...p, book })).toBeCloseTo(atkOf(p) * 1.02);
    expect(maxHpOf({ ...p, book })).toBe(Math.round(maxHpOf(p) * 1.01));
  });

  test("kills count into the book, and a save keeps it (junk dropped, capped)", () => {
    const p = countKills(starterProfile("붓잡이", 0), [{ kind: "blob", zone: "bamboo" }, { kind: "blob", zone: "bamboo" }]);
    expect(p.book).toEqual({ blob: 2 });
    const back = readProfile({ ...p, book: { blob: 99999, nope: 5, shade: "x" } })!;
    expect(back.book).toEqual({ blob: BOOK_PAGE.blob.need[1] });
  });

  test("the server's view carries the book's attack", async (server) => {
    await inVillage(server, "test-a");
    const before = (await server.loadProfile()).atk;
    await editProfile("test-a", (q) => ({ ...q, book: { shade: BOOK_PAGE.shade.need[1], crow: BOOK_PAGE.crow.need[1] } }));
    expect((await server.loadProfile()).atk).toBeCloseTo(before * 1.04);
    expect((await profileOf("test-a")).book.shade).toBe(BOOK_PAGE.shade.need[1]);
  });
});
