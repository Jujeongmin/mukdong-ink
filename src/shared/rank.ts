// 랭킹: one board by 전투력 (shared/profile powerOf), kept on the server in one collection (a row per account,
// id = account). Ties go to whoever got there first, folded into one number so a single-field order works:
// power × 1e10 + (1e10 − seconds since 2026 when it was reached); exact below 2^53 for power under ~900,000.
// Pure math only.

export type RankBoard = "power";
export const RANK_BOARDS: readonly RankBoard[] = ["power"];
export const RANK_TOP = 50;

const SPAN = 1e10;
const EPOCH = 1767225600000; // 2026-01-01T00:00:00Z

/** The board's sort key for a value reached at `at` (ms). Higher is better. */
export function rankKey(value: number, at: number): number {
  const sec = Math.floor((at - EPOCH) / 1000);
  return value * SPAN + (SPAN - Math.min(SPAN - 1, Math.max(0, sec)));
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
