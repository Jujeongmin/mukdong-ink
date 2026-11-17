// GameApi offline: the real server code (server/src) runs in the page on LocalWorld's emulated
// globals, with a $roomTick timer, so the whole game plays without Verse8. The account's saved state
// (profile, names, receipts) is kept in localStorage between visits.

import { Server } from "../../server/src/server";
import type { ProfileView } from "./api";
import { BaseGameApi, type Json, type Link } from "./baseApi";
import { LocalWorld, type WorldSnapshot } from "./local/localWorld";

const ACCOUNT_KEY = "mukdong-ink:local-account";
const WORLD_KEY = "mukdong-ink:local-world";
const SAVE_DELAY_MS = 1000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function localAccount(): string {
  const store = storage();
  try {
    const kept = store?.getItem(ACCOUNT_KEY);
    if (kept) return kept;
  } catch {
    // Storage refused: a fresh account for this visit.
  }
  const made = `local-${Math.random().toString(36).slice(2, 10)}`;
  try {
    store?.setItem(ACCOUNT_KEY, made);
  } catch {
    // As above.
  }
  return made;
}

export interface LocalOptions {
  /** Shows the mock rewarded ad; resolves true when it was watched to the end. */
  adPresenter?: () => Promise<boolean>;
  /** Keep the world in localStorage between visits (default true). */
  persist?: boolean;
  account?: string;
}

export class LocalGameApi extends BaseGameApi {
  readonly mode = "local" as const;
  readonly account: string;
  readonly world = new LocalWorld(new Server());
  private roomId: string | null = null;
  private stopTicking: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persist: boolean;

  constructor(private readonly opts: LocalOptions = {}) {
    super();
    this.persist = opts.persist ?? true;
    this.account = opts.account ?? localAccount();
  }

  async connect(): Promise<void> {
    if (this.link) return;
    if (this.persist) this.restore();
    const world = this.world;
    const account = this.account;
    const link: Link = {
      call: <T>(name: string, args: unknown[] = []) => world.call(account, this.roomId, name, args) as Promise<T>,
      send: (name, args = []) => {
        world.call(account, this.roomId, name, args).catch(() => undefined);
      },
      joinRoom: async (roomId) => {
        const from = this.roomId;
        if (from && from !== roomId) await world.leave(account, from);
        this.roomId = roomId;
        await world.join(account, roomId);
      },
      watchRoom: (roomId, onState, onUsers, onChat) => {
        const off = world.subscribe((e) => {
          if (e.kind === "roomState" && e.roomId === roomId) onState(e.state);
          else if (e.kind === "roomUsers" && e.roomId === roomId) onUsers(e.users);
          else if (e.kind === "message" && e.roomId === roomId && e.type === "chat" && (e.to === null || e.to === account)) onChat?.(e.message);
        });
        onState(world.roomState(roomId));
        onUsers(world.roomUsers(roomId));
        return off;
      },
      watchProfile: (onState) => {
        const off = world.subscribe((e) => {
          if (e.kind === "userState" && e.account === account) onState(e.state as Json);
        });
        onState(world.userState(account));
        return off;
      },
    };
    this.link = link;
    if (this.persist) {
      world.subscribe((e) => {
        if (e.kind === "userState") this.scheduleSave();
      });
    }
    this.stopTicking = world.startTicking(200);
    this.watchProfile();
  }

  /** Stops the room timer and saves (for tests and page teardown). */
  dispose(): void {
    this.stopTicking?.();
    this.stopTicking = null;
    this.poses.stop();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.save();
    }
  }

  /** Local: the game's mock ad, then the same claim the server makes for a real one. */
  async watchAdForJade(): Promise<ProfileView | null> {
    if (!this.opts.adPresenter) return null;
    const watched = await this.opts.adPresenter();
    if (!watched) return null;
    return this.claimAd(`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  /** Local: a mock purchase, delivered to the server as the platform would ($onItemPurchased). */
  async buyJade(productId: string): Promise<void> {
    const purchaseId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const result = (await this.world.system("$onItemPurchased", [{ account: this.account, purchaseId, productId, quantity: 1 }])) as {
      success?: boolean;
      code?: string;
    } | null;
    if (!result?.success) throw new Error(result?.code ?? "bad_args");
  }

  private restore(): void {
    try {
      const raw = storage()?.getItem(WORLD_KEY);
      if (raw) this.world.restore(JSON.parse(raw) as WorldSnapshot);
    } catch {
      // A broken save starts a fresh world.
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY_MS);
  }

  private save(): void {
    try {
      storage()?.setItem(WORLD_KEY, JSON.stringify(this.world.snapshot()));
    } catch {
      // Storage full or refused: the session still plays.
    }
  }
}
