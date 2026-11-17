// 화첩: the album of recovered colors. When a chapter boss falls near you, the moment its color floods back
// over the field is painted into your album (the game frame at the bloom's peak, no HUD). The world stays
// ink; the picture stays yours.
//
// Pages come from the story (one per 오방붓 shard). A page counts as earned once its boss quest is done, so
// it still shows (as an empty frame waiting for a picture) on a new device. The pictures themselves live in
// this browser's IndexedDB per account: a keepsake, not progress, so losing one costs nothing but the image.
// Blobs are read once into object URLs held here; a replaced or cleared picture's URL is revoked.

import { MAIN_QUESTS } from "../shared/world";

export interface AlbumPage {
  id: string;
  chapter: string;
  title: string;
  place: string;
  /** the boss whose fall paints this page; none yet for chapters not written */
  boss?: string;
  /** the main quest that earns the page */
  quest?: string;
  /** the color this page restores, for its frame */
  hue: string;
}

export const ALBUM_PAGES: AlbumPage[] = [
  { id: "c1", chapter: "1장", title: "물빛을 되찾은 날", place: "먹봉우리", boss: "boss", quest: "c1q10", hue: "#4f86c6" },
  { id: "c2", chapter: "2장", title: "불빛을 되찾은 날", place: "향로 마당", boss: "ashboss", quest: "c2q10", hue: "#c8503a" },
  { id: "c3", chapter: "3장", title: "흙빛", place: "아직 찾지 못한 조각", hue: "#c9a13e" },
  { id: "c4", chapter: "4장", title: "바람빛", place: "아직 찾지 못한 조각", hue: "#d9d6cc" },
  { id: "c5", chapter: "5장", title: "먹빛", place: "아직 찾지 못한 조각", hue: "#2a2622" },
];
export const PAGE_FOR_BOSS: Record<string, AlbumPage> = Object.fromEntries(ALBUM_PAGES.filter((p) => p.boss).map((p) => [p.boss!, p]));

/** Earned: the boss quest was handed in. */
export function pageEarned(page: AlbumPage, main: number): boolean {
  if (!page.quest) return false;
  const i = MAIN_QUESTS.findIndex((q) => q.id === page.quest);
  return i >= 0 && main > i;
}

interface Stored { blob: Blob; at: number }

const DB = "ink-album";
const STORE = "pages";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode or storage blocked: the album just has no pictures
    }
  });
}

class Album {
  private account = "";
  private db: Promise<IDBDatabase | null> | null = null;
  private readonly pics = new Map<string, { url: string; at: number }>();
  /** called when a picture arrives or the set is (re)loaded */
  onChange: (() => void) | null = null;

  /** Loads this account's pictures (once per account). */
  async bind(account: string): Promise<void> {
    if (account === this.account) return;
    this.clear();
    this.account = account;
    this.db ??= openDb();
    const db = await this.db;
    if (!db || account !== this.account) return;
    for (const page of ALBUM_PAGES) {
      const got = await this.get(db, `${account}:${page.id}`);
      if (got && account === this.account) this.pics.set(page.id, { url: URL.createObjectURL(got.blob), at: got.at });
    }
    this.onChange?.();
  }

  picture(pageId: string): { url: string; at: number } | null {
    return this.pics.get(pageId) ?? null;
  }

  has(pageId: string): boolean {
    return this.pics.has(pageId);
  }

  count(): number {
    return this.pics.size;
  }

  /** Keeps the first picture of a page (the day it was won); later falls don't overwrite it. */
  async keep(pageId: string, blob: Blob): Promise<boolean> {
    if (!this.account || this.pics.has(pageId)) return false;
    const at = Date.now();
    this.pics.set(pageId, { url: URL.createObjectURL(blob), at });
    const db = await (this.db ??= openDb());
    if (db) {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ blob, at } satisfies Stored, `${this.account}:${pageId}`);
      } catch { /* kept for this session only */ }
    }
    this.onChange?.();
    return true;
  }

  private get(db: IDBDatabase, key: string): Promise<Stored | null> {
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as Stored | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private clear(): void {
    for (const p of this.pics.values()) URL.revokeObjectURL(p.url);
    this.pics.clear();
  }
}

export const album = new Album();

/** The game frame (WebGL canvas, no HUD) cropped to 16:9 and scaled down to a JPEG. Call right after a render. */
export function paintFrame(src: HTMLCanvasElement, out = 960): Promise<Blob | null> {
  const w = out, h = Math.round(out * 9 / 16);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) return Promise.resolve(null);
  const sw = src.width, sh = src.height;
  const k = Math.max(w / sw, h / sh);
  const cw = w / k, ch = h / k;
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.86));
}
