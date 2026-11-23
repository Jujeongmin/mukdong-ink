// Room chat UI: a log in the bottom-left (last 8 lines on a fading paper strip, fades after 5 s of quiet and
// comes back on a new line; system lines in cinnabar), and an input opened with Enter (or the 채팅 button on
// touch). While typing, game keys are ignored and the layout is locked so a phone's soft keyboard (inside
// the Verse8 iframe) doesn't resize the game under it. Only nicknames are shown, never account ids.

import { CHAT_MAX } from "../../shared/chat";
import { el, esc } from "./dom";
import { t } from "../i18n";

/** The server's one system line when a boss falls (server.ts, Korean): rebuilt in the current language. */
function sysText(text: string): string {
  let m = /^(.+) 님이 대먹귀를 쓰러뜨렸다$/.exec(text);
  if (m) return t("{name} 님이 대먹귀를 쓰러뜨렸다", { name: m[1] });
  m = /^(.+) 님이 잿불귀를 잠재웠다$/.exec(text);
  if (m) return t("{name} 님이 잿불귀를 잠재웠다", { name: m[1] });
  m = /^(.+) 님이 (.+)를 쓰러뜨렸다$/.exec(text);
  if (m) return t("{name} 님이 {monster}를 쓰러뜨렸다", { name: m[1], monster: t(m[2]) });
  return t(text);
}

/** The room label built by the game ("— 죽림 1채널 —"): the zone name and the word around the number translated. */
function labelText(text: string): string {
  const m = /^— (.+) (\d+)채널 —$/.exec(text);
  return m ? t("— {zone} {n}채널 —", { zone: t(m[1]), n: m[2] }) : t(text);
}

export interface ChatLine {
  id: string;
  name: string;
  text: string;
  at: number;
  sys?: boolean;
}

export const CHAT_LIMIT = CHAT_MAX;
const KEEP = 8;
const FADE_MS = 5000;
/** the log holding only the room label ("— 죽림 1채널 —") goes sooner: it is a sign, not talk */
const LABEL_FADE_MS = 2500;

export interface ChatHooks {
  /** send a line; reject with an error carrying the server's code (on_cooldown …) */
  send(text: string): Promise<void>;
  /** the input opened / closed (game keys off while open; layout lock) */
  typing(on: boolean): void;
}

export class Chat {
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private fadeTimer = 0;
  private open = false;
  private sending = false;
  /** hide server-masked lines entirely */
  filter = true;

  constructor(root: HTMLElement, private readonly hooks: ChatHooks) {
    root.insertAdjacentHTML("beforeend", `
      <div class="chat-log passive idle" data-chatlog aria-live="polite"></div>
      <form class="chat-in" data-chatform hidden autocomplete="off">
        <input type="text" maxlength="${CHAT_LIMIT}" enterkeyhint="send" placeholder="${t("할 말 (Enter 보내기, Esc 닫기)")}" aria-label="${t("채팅 입력")}" data-chatinput>
        <small data-chatcount>0/${CHAT_LIMIT}</small>
        <button type="submit" class="btn btn-sm">${t("보내기")}</button>
      </form>`);
    this.log = el("[data-chatlog]", root);
    this.form = el<HTMLFormElement>("[data-chatform]", root);
    this.input = el<HTMLInputElement>("[data-chatinput]", root);
    this.count = el("[data-chatcount]", root);
    this.input.addEventListener("input", () => { this.count.textContent = `${[...this.input.value].length}/${CHAT_LIMIT}`; });
    // keep Enter/Esc here: the game's key handler must never see keys typed into the box
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
    this.form.addEventListener("submit", (e) => { e.preventDefault(); void this.submit(); });
    this.input.addEventListener("blur", () => { window.setTimeout(() => { if (this.open && document.activeElement !== this.input) this.close(); }, 120); });
  }

  isOpen(): boolean {
    return this.open;
  }

  openInput(): void {
    if (this.open) return;
    this.open = true;
    this.hooks.typing(true);
    this.form.hidden = false;
    this.wake();
    this.input.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.form.hidden = true;
    this.input.blur();
    this.hooks.typing(false);
    this.wake();
  }

  /** A line arrived (broadcast only: nothing is replayed on joining). */
  push(m: ChatLine): void {
    if (this.filter && !m.sys && /\*{2,}/.test(m.text)) return;
    if (this.log.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
    const p = document.createElement("p");
    p.dataset.id = m.id;
    p.className = m.sys ? "sys" : "";
    p.innerHTML = m.sys ? esc(sysText(m.text)) : `<b>${esc(m.name || t("나그네"))}</b> ${esc(m.text)}`;
    this.log.appendChild(p);
    while (this.log.childElementCount > KEEP) this.log.firstElementChild?.remove();
    this.wake();
  }

  clear(): void {
    this.log.innerHTML = "";
  }

  /** A quiet room label at the top of the log ("— 죽림 1채널 —"). */
  label(text: string): void {
    const p = document.createElement("p");
    p.className = "room";
    p.textContent = labelText(text);
    this.log.prepend(p);
    while (this.log.childElementCount > KEEP) this.log.firstElementChild?.remove();
    this.wake(this.log.querySelector("p:not(.room)") ? FADE_MS : LABEL_FADE_MS);
  }

  private wake(ms = FADE_MS): void {
    this.log.classList.remove("idle");
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => { if (!this.open) this.log.classList.add("idle"); }, ms);
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.sending) { if (!text) this.close(); return; }
    this.sending = true;
    try {
      await this.hooks.send([...text].slice(0, CHAT_LIMIT).join(""));
      this.input.value = "";
      this.count.textContent = `0/${CHAT_LIMIT}`;
      this.close();
    } catch {
      // refused (pace, filter…): the game already said why; the line stays in the box
    } finally {
      this.sending = false;
    }
  }
}
