// Conversation box (visual-novel style): speaker name + title, text typed out, click / Space / E / Enter
// to advance (a click while typing finishes the line), optional choice buttons on the last line.
// Narration (who "") is shown centered; "me" lines speak as the player. Styling lives in style.css (.dlg*).

import { NPC_INFO, type Line } from "../../shared/story";
import { el, esc } from "./dom";
import { audio } from "../audio";

export interface Choice {
  label: string;
  value: string;
}

const TYPE_MS = 26;

export class Dialogue {
  private readonly box: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly choiceEl: HTMLElement;
  private open = false;
  private typing = 0;
  private full = "";
  private shown = 0;
  private advance: (() => void) | null = null;
  /** put away while the player lies dead; the conversation resumes after getting up */
  private held = false;

  constructor(private readonly root: HTMLElement, private readonly myName: () => string) {
    root.insertAdjacentHTML("beforeend", `
      <div class="dlg" data-dlg hidden>
        <div class="dlg-veil"></div>
        <div class="dlg-box" role="dialog" aria-live="polite">
          <div class="dlg-who"><b class="dlg-name"></b><span class="dlg-title"></span></div>
          <p class="dlg-text"></p>
          <div class="dlg-choices"></div>
          <span class="dlg-next" aria-hidden="true"></span>
        </div>
      </div>`);
    this.box = el("[data-dlg]", root);
    this.nameEl = el(".dlg-name", this.box);
    this.titleEl = el(".dlg-title", this.box);
    this.textEl = el(".dlg-text", this.box);
    this.choiceEl = el(".dlg-choices", this.box);
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
    this.root.classList.add("talking");
    this.box.hidden = this.held;
    this.box.classList.toggle("dark", !!opts.dark);
    let result = "";
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      result = await this.say(lines[i], last ? opts.choices : undefined);
    }
    this.close();
    return result;
  }

  private say(line: Line, choices?: Choice[]): Promise<string> {
    const narration = line.who === "";
    const me = line.who === "me";
    const info = NPC_INFO[line.who];
    this.box.classList.toggle("narration", narration);
    this.box.classList.toggle("me", me);
    this.nameEl.textContent = narration ? "" : me ? this.myName() : info?.name ?? line.who;
    this.titleEl.textContent = narration || me || !info ? "" : info.title;
    this.choiceEl.innerHTML = "";
    this.full = line.text;
    this.shown = 0;
    this.textEl.textContent = "";
    this.box.classList.add("typing");
    window.clearInterval(this.typing);
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
        showChoices();
      };
      this.typing = window.setInterval(() => {
        this.shown++;
        this.textEl.textContent = this.full.slice(0, this.shown);
        if (this.shown >= this.full.length) finish();
      }, TYPE_MS);
      this.advance = () => {
        if (this.shown < this.full.length) { finish(); return; }
        if (choices) return; // must pick
        audio.play("dialogue-next");
        resolve("");
      };
    });
  }

  private next(): void {
    this.advance?.();
  }

  private close(): void {
    window.clearInterval(this.typing);
    this.open = false;
    this.advance = null;
    this.box.hidden = true;
    this.box.classList.remove("dark", "narration", "me", "typing");
    this.root.classList.remove("talking");
  }
}
