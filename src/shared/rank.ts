// 랭킹: two boards, kept on the server in one collection (a row per account, id = account).
// 경지: by level; 도감: by 먹그림 도감 steps (밑그림 1, 완성 2 per page). Ties go to whoever got there first,
// folded into one number so a single-field order works: value × 1e13 + (1e13 − the moment it was reached).
// Pure math only.

import { BOOK, bookStage } from "./book";

export type RankBoard = "level" | "book";
export const RANK_BOARDS: readonly RankBoard[] = ["level", "book"];
export const RANK_TOP = 50;

const SPAN = 1e13; // ms timestamps stay well under this until the year 2286

/** The board's sort key for a value reached at `at` (ms). Higher is better. */
export function rankKey(value: number, at: number): number {
  return value * SPAN + (SPAN - Math.min(SPAN - 1, Math.max(0, at)));
}

/** 먹그림 도감 steps: 밑그림 counts 1, 완성 2. */
export function bookSteps(book: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const page of BOOK) n += bookStage(page, book[page.kind] ?? 0);
  return n;
}

/** One line of a board as the client shows it. */
export interface RankRow {
  rank: number;
  name: string;
  value: number;
  me: boolean;
}

export interface RankView {
  board: RankBoard;
  top: RankRow[];
  /** your own line (also when you are outside the top), null before you are on the board */
  mine: RankRow | null;
}
