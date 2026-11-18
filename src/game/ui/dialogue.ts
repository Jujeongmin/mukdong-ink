// Conversation box (visual-novel style): speaker name + title, text typed out, click / Space / E / Enter
// to advance (a click while typing finishes the line), optional choice buttons on the last line.
// Narration (who "") is shown centered; "me" lines speak as the player. Styling lives in style.css (.dlg*).

import { NPC_INFO, fillName, type Line } from "../../shared/story";
import { el, esc } from "./dom";
import { audio } from "../audio";

export interface Choice {
  label: string;
  value: string;
}

const TYPE_MS = 20;
/** 자동 진행: each line (and a choice, taking the first) moves on by itself after this long */
const AUTO_MS = 3000;
/** where each prologue picture's subject sits, so a narrow (phone) screen crops around it */
const ART_FOCUS: Record<string, string> = { "intro-1": "62% 30%", "intro-2": "62% 50%", "intro-3": "24% 60%", "intro-4": "30% 60%" };

/** A speaker's portrait (neutral + speaking frames), or null for none. Supplied by the game. */
export type PortraitFor = (who: string) => { neutral: string; speak: string } | null;

/** A short, stable id for a line (seen-line memory for 건너뛰기). */
function lineId(l: Line): string {
  let h = 5381;
  const t = l.who + "|" + l.text;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export class Dialogue {
  private readonly box: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly choiceEl: HTMLElement;
  private open = false;
  private typing = 0;
  /** set by the game while 자동 진행 is on: lines move on by themselves (a click still moves on at once) */
  autoNext: () => boolean = () => false;
  /** true while something sits over the conversation (a sheet): the countdown waits */
  autoHold: () => boolean = () => false;
  private autoTimer = 0;
  private timerEl!: SVGSVGElement;
  private full = "";
  private shown = 0;
  private advance: (() => void) | null = null;
  /** put away while the player lies dead; the conversation resumes after getting up */
  private held = false;
  /** 해담's lantern has flared for 홍매 in this conversation */
  private flared = false;
  /** portraits from the game (in-engine renders) */
  portraitFor: PortraitFor | null = null;
  private lastWho = "";
  /** lines this account has already read (건너뛰기 is offered only when a whole sequence is known) */
  private seen = new Set<string>();
  private seenKey = "";
  private skipping = false;
  private face!: HTMLElement;
  private faceA!: HTMLImageElement;
  private faceB!: HTMLImageElement;
  private faceName!: HTMLElement;
  private skipBtn!: HTMLButtonElement;
  /** two stacked pictures for dark narration: the new one fades in over the old */
  private artImgs!: HTMLImageElement[];
  private artTop = 0;
  private artName = "";

  constructor(private readonly root: HTMLElement, private readonly myName: () => string) {
    root.insertAdjacentHTML("beforeend", `
      <div class="dlg" data-dlg hidden>
        <div class="dlg-veil"></div>
        <div class="dlg-art" aria-hidden="true"><img alt=""><img alt=""></div>
        <div class="dlg-stage">
        <div class="dlg-face" aria-hidden="true"><img class="f0" alt=""><img class="f1" alt=""><b class="dlg-face-name"></b></div>
        <div class="dlg-box" role="dialog" aria-live="polite">
          <button type="button" class="dlg-skip btn btn-secondary btn-sm" hidden>건너뛰기</button>
          <div class="dlg-who"><b class="dlg-name"></b><span class="dlg-title"></span></div>
          <p class="dlg-text"></p>
          <div class="dlg-choices"></div>
          <span class="dlg-next" aria-hidden="true"></span>
          <svg class="dlg-timer" viewBox="0 0 40 40" aria-hidden="true"><filter id="dlg-enso-rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter><circle class="enso-bed" cx="20" cy="20" r="14" pathLength="100"/><circle class="enso" cx="20" cy="20" r="14" pathLength="100" filter="url(#dlg-enso-rough)"/></svg>
        </div>
        </div>
      </div>`);
    this.box = el("[data-dlg]", root);
    this.nameEl = el(".dlg-name", this.box);
    this.titleEl = el(".dlg-title", this.box);
    this.textEl = el(".dlg-text", this.box);
    this.choiceEl = el(".dlg-choices", this.box);
    this.face = el(".dlg-face", this.box);
    this.timerEl = this.box.querySelector<SVGSVGElement>(".dlg-timer") as SVGSVGElement;
    this.artImgs = Array.from(this.box.querySelectorAll<HTMLImageElement>(".dlg-art img"));
    this.faceA = el<HTMLImageElement>(".dlg-face .f0", this.box);
    this.faceB = el<HTMLImageElement>(".dlg-face .f1", this.box);
    this.faceName = el(".dlg-face-name", this.box);
    this.skipBtn = el<HTMLButtonElement>(".dlg-skip", this.box);
    this.skipBtn.addEventListener("click", (e) => { e.stopPropagation(); this.skipping = true; this.next(); this.next(); });
    this.box.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".dlg-choices")) return;
      this.next();
    });
    // capture so the field never sees the keys while a conversation is up
    window.addEventListener("keydown", (e) => {
      if (!this.open || this.held) return;
      if (e.code === "Space" || e.code === "KeyE" || e.code === "Enter") {
        if (this.choiceEl.childElementCount > 0 && this.shown >= this.full.length) {
          (this.choiceEl.firstElementChild as HTMLButtonElement | null)?.focus();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.next();
      }
    }, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Per-account memory of lines already read. */
  bindAccount(account: string): void {
    this.seenKey = `ink.seenlines.${account}`;
    try {
      const raw = window.localStorage.getItem(this.seenKey);
      this.seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      this.seen = new Set();
    }
  }

  private remember(lines: readonly Line[]): void {
    let added = false;
    for (const l of lines) { const id = lineId(l); if (!this.seen.has(id)) { this.seen.add(id); added = true; } }
    if (!added || !this.seenKey) return;
    try { window.localStorage.setItem(this.seenKey, JSON.stringify([...this.seen])); } catch { /* not kept */ }
  }

  /** Hide an open conversation without ending it (death screen on top), or bring it back. */
  hold(on: boolean): void {
    this.held = on;
    if (this.open) this.box.hidden = on;
  }

  /**
   * Plays the lines in order. With choices, the last line waits for a pick and the promise resolves to
   * its value (Escape or tapping outside never picks one). Without, it resolves to "" at the end.
   * `dark` dims the whole screen (prologue, chapter end).
   */
  async play(lines: readonly Line[], opts: { choices?: Choice[]; dark?: boolean } = {}): Promise<string> {
    if (lines.length === 0 && !opts.choices) return "";
    this.open = true;
    this.flared = false;
    this.root.classList.add("talking");
    this.box.hidden = this.held;
    this.box.classList.toggle("dark", !!opts.dark);
    this.lastWho = "";
    // 건너뛰기 only when every line here was read before (first-time story can't be skipped)
    this.skipping = false;
    this.skipBtn.hidden = !(lines.length >= 3 && lines.every((l) => this.seen.has(lineId(l))));
    let result = "";
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      if (this.skipping && !(last && opts.choices)) continue;
      if (last) this.skipBtn.hidden = true;
      result = await this.say(lines[i], last ? opts.choices : undefined);
    }
    this.remember(lines);
    this.skipBtn.hidden = true;
    this.close();
    return result;
  }

  private say(line: Line, choices?: Choice[]): Promise<string> {
    const narration = line.who === "";
    const me = line.who === "me";
    const info = NPC_INFO[line.who];
    this.box.classList.toggle("narration", narration);
    this.box.classList.toggle("me", me);
    // 번지는 목소리: no name plate, the words bleed like wet ink, and a low smear of sound under them
    this.box.classList.toggle("voice", line.who === "voice");
    if (line.who === "voice") audio.play("voice-bleed");
    // 홍매 speaks through 해담's lantern: it flares the first time she does
    if (line.who === "hongmae" && !this.flared) { this.flared = true; audio.play("lantern-ignite"); }
    this.nameEl.textContent = narration ? "" : me ? this.myName() : info?.name ?? line.who;
    this.showFace(line.who, this.nameEl.textContent ?? "");
    this.showArt(line.art ?? "");
    this.titleEl.textContent = narration || me || !info ? "" : info.title;
    this.choiceEl.innerHTML = "";
    this.full = fillName(line.text, this.myName());
    this.shown = 0;
    this.textEl.textContent = "";
    this.box.classList.add("typing");
    this.face.classList.add("talk");
    window.clearInterval(this.typing);
    this.disarmAuto();
    return new Promise((resolve) => {
      const showChoices = () => {
        if (!choices) return;
        this.choiceEl.innerHTML = choices.map((c, k) => `<button type="button" class="dlg-choice btn${k === 0 ? " main" : " btn-secondary"}" data-v="${esc(c.value)}">${esc(c.label)}</button>`).join("");
        this.choiceEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", (e) => {
          e.stopPropagation();
          resolve(b.dataset.v ?? "");
        }));
        (this.choiceEl.firstElementChild as HTMLButtonElement | null)?.focus();
      };
      const finish = () => {
        window.clearInterval(this.typing);
        this.shown = this.full.length;
        this.textEl.textContent = this.full;
        this.box.classList.remove("typing");
        this.face.classList.remove("talk");
        showChoices();
        this.armAuto(() => {
          if (choices) resolve(choices[0]?.value ?? "");
          else { audio.play("dialogue-next"); resolve(""); }
        });
      };
      this.typing = window.setInterval(() => {
        this.shown++;
        this.textEl.textContent = this.full.slice(0, this.shown);
        if (this.shown >= this.full.length) finish();
      }, TYPE_MS);
      this.advance = () => {
        if (this.shown < this.full.length) { finish(); return; }
        if (choices) return; // must pick
        this.disarmAuto();
        audio.play("dialogue-next");
        resolve("");
      };
    });
  }

  /** 자동 진행: start the countdown bar; `go` runs when it runs out. Cleared by any advance or close. */
  private armAuto(go: () => void): void {
    this.disarmAuto();
    if (!this.autoNext()) return;
    this.box.classList.add("auto-next");
    this.timerEl.style.setProperty("--dur", `${AUTO_MS}ms`);
    void this.timerEl.getBoundingClientRect(); // restart the stroke
    this.timerEl.classList.add("run");
    // if the line can't move on by itself when the time is up (a sheet opened over it), wait and look again
    const tick = (): void => {
      if (!this.autoNext()) { this.disarmAuto(); return; }
      if (this.autoHold()) { this.autoTimer = window.setTimeout(tick, 500); return; }
      this.disarmAuto();
      go();
    };
    this.autoTimer = window.setTimeout(tick, AUTO_MS);
  }
  private disarmAuto(): void {
    window.clearTimeout(this.autoTimer);
    this.timerEl?.classList.remove("run");
    this.box.classList.remove("auto-next");
  }

  /** A picture behind the narration; the next one bleeds in over it, "" takes it away. */
  private showArt(name: string): void {
    this.box.classList.toggle("has-art", !!name);
    if (!name || name === this.artName) return;
    this.artName = name;
    const next = this.artImgs[this.artTop ^ 1], prev = this.artImgs[this.artTop];
    this.artTop ^= 1;
    next.classList.remove("on");
    next.onload = () => { next.classList.add("on"); prev.classList.remove("on"); };
    next.style.objectPosition = ART_FOCUS[name] ?? "50% 50%";
    next.src = `./assets/art/${name}.webp`;
  }

  /** The speaker's portrait (left; the player's own on the right). Narration and the voice have none. */
  private showFace(who: string, name: string): void {
    const pair = who === "" || who === "voice" ? null : this.portraitFor?.(who) ?? null;
    this.box.classList.toggle("has-face", !!pair);
    if (!pair) { this.lastWho = who; return; }
    if (this.faceA.src !== pair.neutral) this.faceA.src = pair.neutral;
    if (this.faceB.src !== pair.speak) this.faceB.src = pair.speak;
    this.faceName.textContent = name;
    if (who !== this.lastWho) {
      // a new speaker bleeds in
      this.face.classList.remove("swap");
      void this.face.offsetWidth;
      this.face.classList.add("swap");
    }
    this.lastWho = who;
  }

  private next(): void {
    this.advance?.();
  }

  private close(): void {
    this.disarmAuto();
    window.clearInterval(this.typing);
    this.open = false;
    this.advance = null;
    this.box.hidden = true;
    this.box.classList.remove("dark", "narration", "me", "typing", "voice", "has-face", "has-art");
    for (const im of this.artImgs) { im.classList.remove("on"); im.onload = null; im.removeAttribute("src"); }
    this.artName = "";
    this.root.classList.remove("talking");
  }
}
