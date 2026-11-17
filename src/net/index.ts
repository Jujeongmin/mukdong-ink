// The game's one entry into the network: createGameApi picks Verse8 (the real server) or Local (the
// same server code in the page, for offline play).

import type { GameApi } from "./api";
import { LocalGameApi } from "./localApi";
import { Verse8GameApi } from "./verse8Api";

export type * from "./api";
export { errorCode } from "./errors";
export { LocalGameApi } from "./localApi";
export { Verse8GameApi } from "./verse8Api";

export interface GameApiOptions {
  /** "auto" (default): Verse8 when the build has a verse (VITE_AGENT8_VERSE), otherwise local. */
  mode?: "auto" | "local" | "verse8";
  /** Local only: shows the mock rewarded ad; resolves true when it was watched. */
  adPresenter?: () => Promise<boolean>;
}

export function createGameApi(opts: GameApiOptions = {}): GameApi {
  const mode = opts.mode ?? "auto";
  const verse = String(import.meta.env.VITE_AGENT8_VERSE ?? "").trim();
  const online = mode === "verse8" || (mode === "auto" && verse.length > 0);
  return online ? new Verse8GameApi() : new LocalGameApi({ adPresenter: opts.adPresenter });
}
