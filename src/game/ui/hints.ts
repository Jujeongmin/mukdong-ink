// Discovery hints (docs/TUTORIAL.md): 먹동이's one-line inner thoughts at the moment they matter, once per
// account, never more than one per ~20 s, held back while a fight is busy. Also remembers which HUD parts
// have been revealed. No modal, no pause. Styling: style.css (.thought, .hint-glow).

import { el, esc } from "./dom";
import { KEYS } from "./input";

const GAP_MS = 20000;
const SHOW_MS = 4200;
const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/** Key glyph → the on-screen control that does it (glows on touch screens instead of a key label). */
const TARGET: Record<string, string> = {
  [KEYS.attack]: '[data-act="atk"]',
  "클릭 클릭 클릭": '[data-act="atk"]',
  [KEYS.roll]: '[data-act="dash"]',
  [KEYS.potion]: "[data-potion]",
  [KEYS.growth]: "[data-growth]",
  [KEYS.talk]: "[data-prompt]",
  [KEYS.move]: ".stick",
  Z: "[data-auto]",
};

export interface HintOpts {
  /** key glyph shown after the thought (keyboard) / control to glow (touch) */
  key?: string;
  /** fires now even inside the 20 s gap or a fight (the hint for this very moment) */
  urgent?: boolean;
  /** do not remember it (e.g. a teaser on every tap) */
  repeat?: boolean;
}

export class Hints {
  private readonly bubble: HTMLElement;
  private seen = new Set<string>();
  private key = "";
  private last = -1e9;
  private hideT = 0;
  private glowEl: HTMLElement | null = null;
  /** set by the game: true while a fight is busy */
  busy: () => boolean = () => false;

  constructor(private readonly root: HTMLElement) {
    root.insertAdjacentHTML("beforeend", `<div class="thought passive" data-thought hidden aria-live="polite"><p data-thought-text></p></div>`);
    this.bubble = el("[data-thought]", root);
  }

  /** Load what this account has already seen. */
  bind(account: string): void {
    this.key = `ink.hints.${account}`;
    try {
      const raw = window.localStorage.getItem(this.key);
      this.seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      this.seen = new Set();
    }
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** 힌트 다시 보기: forget every thought and gate shown (the HUD parts already revealed stay). */
  reset(): void {
    for (const id of [...this.seen]) if (!id.startsWith("ui:")) this.seen.delete(id);
    try { window.localStorage.setItem(this.key, JSON.stringify([...this.seen])); } catch { /* not persisted */ }
  }

  mark(id: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    try {
      window.localStorage.setItem(this.key, JSON.stringify([...this.seen]));
    } catch {
      // storage blocked: hints may repeat next visit, which is harmless
    }
  }

  /** Can a (non-urgent) hint go out right now? */
  ready(): boolean {
    return performance.now() - this.last > GAP_MS && !this.busy();
  }

  /** Show a thought once per account. Returns true if it was shown. */
  think(id: string, text: string, opts: HintOpts = {}): boolean {
    if (!opts.repeat && this.seen.has(id)) return false;
    if (!opts.urgent && !this.ready()) return false;
    if (!opts.repeat) this.mark(id);
    this.last = performance.now();
    const glyph = opts.key && !coarse ? ` <kbd>${esc(opts.key)}</kbd>` : "";
    el("[data-thought-text]", this.bubble).innerHTML = `${esc(text)}${glyph}`;
    this.bubble.hidden = false;
    this.bubble.classList.remove("go");
    void this.bubble.offsetWidth;
    this.bubble.classList.add("go");
    window.clearTimeout(this.hideT);
    this.hideT = window.setTimeout(() => { this.bubble.hidden = true; this.unglow(); }, SHOW_MS);
    this.unglow();
    if (opts.key && coarse) this.glow(TARGET[opts.key]);
    else if (opts.key === KEYS.growth) this.glow(TARGET[KEYS.growth]); // the training button pulses everywhere
    return true;
  }

  private glow(sel: string | undefined): void {
    if (!sel) return;
    const t = this.root.querySelector<HTMLElement>(sel);
    if (!t) return;
    t.classList.add("hint-glow");
    this.glowEl = t;
  }

  private unglow(): void {
    this.glowEl?.classList.remove("hint-glow");
    this.glowEl = null;
  }
}
