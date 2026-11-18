// 먹그림 도감: a page of the 화첩 per monster. Felling enough of one sketches it (밑그림), more finishes it
// (완성); each step is a small lasting gain, 공격 or 생명 depending on the monster. Pure data and math.

export type BookStat = "atk" | "hp";

export interface BookPage {
  kind: string;
  stat: BookStat;
  /** kills for 밑그림, then for 완성 */
  need: readonly [number, number];
}

const COMMON = [30, 200] as const;
const NAMED = [3, 20] as const;
const BOSS = [1, 10] as const;

/** In the order you meet them. Vines are burnt out of the way, not drawn. */
export const BOOK: readonly BookPage[] = [
  { kind: "blob", stat: "hp", need: COMMON },
  { kind: "shade", stat: "atk", need: COMMON },
  { kind: "bigblob", stat: "atk", need: NAMED },
  { kind: "spitter", stat: "hp", need: COMMON },
  { kind: "shadelord", stat: "atk", need: NAMED },
  { kind: "boss", stat: "atk", need: BOSS },
  { kind: "jar", stat: "hp", need: COMMON },
  { kind: "crow", stat: "atk", need: COMMON },
  { kind: "shademonk", stat: "atk", need: COMMON },
  { kind: "lantern", stat: "hp", need: COMMON },
  { kind: "kilnlord", stat: "hp", need: NAMED },
  { kind: "ashboss", stat: "hp", need: BOSS },
];

export const BOOK_PAGE: Readonly<Record<string, BookPage>> = Object.fromEntries(BOOK.map((b) => [b.kind, b]));

/** What each step of a page adds (a fraction of attack or max health). */
export const BOOK_STEP = 0.01;

/** 0 = not yet, 1 = 밑그림, 2 = 완성. */
export function bookStage(page: BookPage, kills: number): 0 | 1 | 2 {
  return kills >= page.need[1] ? 2 : kills >= page.need[0] ? 1 : 0;
}

/** The whole book's gain: fractions added to attack and to max health. */
export function bookBonus(book: Readonly<Record<string, number>>): { atk: number; hp: number } {
  let atk = 0, hp = 0;
  for (const page of BOOK) {
    const g = bookStage(page, book[page.kind] ?? 0) * BOOK_STEP;
    if (page.stat === "atk") atk += g;
    else hp += g;
  }
  return { atk, hp };
}

/** The book after these kills (each page stops counting once it is finished). */
export function bookAfter(book: Readonly<Record<string, number>>, kinds: readonly string[]): Record<string, number> {
  const next: Record<string, number> = { ...book };
  for (const kind of kinds) {
    const page = BOOK_PAGE[kind];
    if (!page) continue;
    next[kind] = Math.min(page.need[1], (next[kind] ?? 0) + 1);
  }
  return next;
}
