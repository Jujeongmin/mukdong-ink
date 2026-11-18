// 랭킹: one board by 경지 (level), kept on the server in one collection (a row per account, id = account).
// Ties go to whoever got there first, folded into one number so a single-field order works:
// level × 1e13 + (1e13 − the moment it was reached). Pure math only.

export type RankBoard = "level";
export const RANK_BOARDS: readonly RankBoard[] = ["level"];
export const RANK_TOP = 50;

const SPAN = 1e13; // ms timestamps stay well under this until the year 2286

/** The board's sort key for a value reached at `at` (ms). Higher is better. */
export function rankKey(value: number, at: number): number {
  return value * SPAN + (SPAN - Math.min(SPAN - 1, Math.max(0, at)));
}

/** One line of the board as the client shows it. */
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
