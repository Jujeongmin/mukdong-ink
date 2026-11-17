// Room chat (one zone × channel room hears it): what a line may be and how often one may be said. The
// server holds everyone to it; the client may use the same numbers to keep the box from sending what
// would be turned away. Chat is never stored anywhere: a line goes to whoever is in the room right then
// (a room broadcast) and nobody joining later sees it.

import { maskChat } from "./filter";

export const CHAT_MAX = 60; // characters, after tidying
export const CHAT_GAP_MS = 1200; // no two lines from one player closer than this…
export const CHAT_BURST = 5; // …and no more than this many…
export const CHAT_WINDOW_MS = 10_000; // …in this long
export const CHAT_REPEAT_MS = 10_000; // the same line again within this long is refused

/** A line in a room. `sys` lines are the server's own (a boss felled), with no account. */
export interface ChatMessage {
  id: string;
  account: string;
  name: string;
  text: string;
  at: number;
  sys?: boolean;
}

// Control characters, zero-width and direction marks, the BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;

/** A line tidied: invisible characters out, runs of whitespace made one space, trimmed. */
export function tidyChat(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** A line fit to say, masked; null when nothing is left or it is too long. `plain` is the unmasked tidy text. */
export function readChat(raw: unknown): { text: string; plain: string } | null {
  if (typeof raw !== "string" || raw.length > CHAT_MAX * 8) return null;
  const plain = tidyChat(raw);
  const length = [...plain].length;
  if (length === 0 || length > CHAT_MAX) return null;
  return { text: maskChat(plain), plain };
}

/** Whether a line said at `now` keeps to the pace, given the times of the ones said before. */
export function chatPaceOk(said: readonly number[], now: number): boolean {
  const recent = said.filter((t) => now - t < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_BURST) return false;
  return recent.every((t) => now - t >= CHAT_GAP_MS);
}

/** One line as it arrives from the room (a broadcast), checked; null when it is not one. */
export function readChatLine(raw: unknown): ChatMessage | null {
  const l = raw as Record<string, unknown> | null;
  if (!l || typeof l !== "object" || typeof l.id !== "string" || typeof l.text !== "string" || typeof l.at !== "number") return null;
  return {
    id: l.id, account: typeof l.account === "string" ? l.account : "", name: typeof l.name === "string" ? l.name : "", text: l.text, at: l.at,
    ...(l.sys === true ? { sys: true } : {}),
  };
}
