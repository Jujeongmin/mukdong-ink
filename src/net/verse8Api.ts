// GameApi on Verse8: calls and room subscriptions through @agent8/gameserver (its zustand store, which
// holds the reconnect logic the React hook would), VXShop through @verse8/platform/vanilla and rewarded
// ads through @verse8/ads. The SDKs are loaded on connect, so the offline build never evaluates them.

import type { GameServerStore } from "@agent8/gameserver/dist/src/store/useGameServerStore";
import { PROTOCOL_VERSION } from "../shared/types";
import { AD_PLACEMENT } from "../shared/world";
import type { ProfileView } from "./api";
import { BaseGameApi, type Json, type Link } from "./baseApi";
import { errorCode, sleep, withTimeout } from "./errors";

type Server = GameServerStore["server"];
interface Store {
  getState(): GameServerStore;
  subscribe(listener: (state: GameServerStore, prev: GameServerStore) => void): () => void;
}

// A call the server never answers gives up after this long (the slowest take a lock or two).
const CALL_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 40_000;
// The verifier may still say "pending" right after the ad; asked again this often (the docs' numbers).
const AD_CLAIM_ATTEMPTS = 4;
const AD_CLAIM_RETRY_MS = 1500;

// The Agent8 v2 editor preview runs on its own host, which the platform SDK does not recognise as a
// preview, so there the shop dialog is opened with the PREVIEW stage spelled out (as Grove Hunters does).
const V2_EDITOR_PREVIEW_HOST = /^agent8-container-v2-[a-z0-9-]+\.agent8\.verse8\.net$/;

function inEditorPreview(): boolean {
  try {
    return V2_EDITOR_PREVIEW_HOST.test(window.location.hostname.toLowerCase()) && window.parent !== window;
  } catch {
    return false;
  }
}

// The SDK counts each room subscription so it asks the room only once, and wipes the counts whenever the
// room connection is remade. Letting go of one made before the wipe then leaves its count below zero,
// and the next subscription to it is never asked for: those are put back to none (Grove Hunters).
function mendCounts(server: Server): void {
  const counts = (server as unknown as { rsSubscribeCount?: Record<string, number> }).rsSubscribeCount;
  if (!counts) return;
  for (const key of Object.keys(counts)) if (counts[key] < 0) delete counts[key];
}

function waitFor(store: Store, test: (s: GameServerStore) => boolean, ms: number): Promise<void> {
  if (test(store.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("not_ready"));
    }, ms);
    const off = store.subscribe((s) => {
      if (!test(s)) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

export class Verse8GameApi extends BaseGameApi {
  readonly mode = "verse8" as const;
  account = "";
  private readonly verseId: string = String(import.meta.env.VITE_AGENT8_VERSE ?? "");

  async connect(): Promise<void> {
    if (this.link) return;
    const { useGameServerStore } = await import("@agent8/gameserver/dist/src/store/useGameServerStore");
    const store: Store = useGameServerStore;
    void store.getState().connect();
    await waitFor(store, (s) => s.connected, CONNECT_TIMEOUT_MS);
    const server = () => store.getState().server;
    this.account = server().account;
    const link: Link = {
      call: <T>(name: string, args: unknown[] = []) => withTimeout(server().remoteFunction(name, args) as Promise<T>, CALL_TIMEOUT_MS),
      send: (name, args = []) => {
        Promise.resolve(server().remoteFunction(name, args, { needResponse: false })).catch(() => undefined);
      },
      joinRoom: (roomId) => store.getState().joinRoom(roomId),
      watchRoom: (roomId, onState, onUsers, onChat) => {
        const offState = server().subscribeRoomState(roomId, (state: Json) => onState(state ?? {}));
        const offUsers = server().subscribeRoomAllUserStates(roomId, (users: unknown) => onUsers(Array.isArray(users) ? (users as Json[]) : []));
        const offChat = server().onRoomMessage(roomId, "chat", (line: unknown) => onChat?.(line));
        return () => {
          offState();
          offUsers();
          offChat();
          mendCounts(server());
        };
      },
      watchProfile: (onState) => server().subscribeGlobalMyState((state: Json) => onState(state ?? {})),
    };
    this.link = link;
    store.subscribe((s, prev) => this.onLinkChange(s, prev));
    this.watchProfile();
    try {
      const { VXShop } = await import("@verse8/platform/vanilla");
      VXShop.init({ verseId: this.verseId, account: this.account, autoRefresh: true });
    } catch {
      // No shop here (outside the Verse8 frame): buying fails when tried.
    }
    const version = await this.call<{ protocol: number }>("getServerVersion");
    if (version?.protocol !== PROTOCOL_VERSION) console.warn("[net] server protocol", version?.protocol, "client", PROTOCOL_VERSION);
  }

  // The SDK remakes connections by itself; what we do on top: a remade room connection has forgotten
  // its subscriptions (made again); a room the platform gave up on is joined again.
  private onLinkChange(s: GameServerStore, prev: GameServerStore): void {
    if (s.connected && !prev.connected) void this.loadProfile().catch(() => undefined);
    const roomId = this.entry?.roomId;
    if (!roomId) return;
    if (s.rsConnected && !prev.rsConnected && s.currentRoomId === roomId) {
      mendCounts(s.server);
      this.relisten();
    } else if (!s.rsConnected && s.currentRoomId === null && prev.currentRoomId === roomId && s.connected) {
      void this.rejoin();
    }
  }

  async watchAdForJade(): Promise<ProfileView | null> {
    const { Verse8Ads } = await import("@verse8/ads");
    const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT });
    if (result.status !== "rewarded") return null;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.claimAd(result.requestId);
      } catch (error) {
        if (errorCode(error) !== "not_ready" || attempt >= AD_CLAIM_ATTEMPTS) throw error;
        await sleep(AD_CLAIM_RETRY_MS);
      }
    }
  }

  /** Opens Verse8's purchase dialog; resolves when it closes. The jade arrives through $onItemPurchased. */
  async buyJade(productId: string): Promise<void> {
    const { VXShop } = await import("@verse8/platform/vanilla");
    await new Promise<void>((resolve, reject) => {
      const off = VXShop.onClose((payload) => {
        if (payload.productId !== productId) return;
        off();
        void VXShop.refresh().catch(() => undefined);
        resolve();
      });
      try {
        if (inEditorPreview()) {
          window.parent.postMessage({ type: "OPEN_VX_SHOP_DIALOG", payload: { verseId: this.verseId, productId, stage: "PREVIEW" } }, "*");
        } else {
          VXShop.buyItem(productId);
        }
      } catch (error) {
        off();
        reject(error);
      }
    });
  }

  /** The VX price VXShop lists for a product (null when it does not know it). */
  async priceOf(productId: string): Promise<number | null> {
    try {
      const { VXShop } = await import("@verse8/platform/vanilla");
      return VXShop.getItem(productId)?.price ?? null;
    } catch {
      return null;
    }
  }
}
