// Controls (user layout): WASD/arrows move, left click on the field attacks (hold to keep the combo; J as a
// keyboard fallback), Space / Shift / right click rolls (구르기, the dodge), Z auto-battle, 1 potion, G talk,
// I gear, K training, P 화첩, H help, Esc closes. Skills fire on their own (their rings can be clicked to fire early).
// Mouse users aim at the cursor on the ground; touch keeps the joystick and on-screen buttons.

import { t } from "../i18n";

/** "dash" is the roll (sent to the server as the dash action) */
export type Act = "atk" | "dash";
export interface InputHandlers {
  /** true while a sheet or overlay owns the input */
  blocked(): boolean;
  act(a: Act): void;
  skill(i: number): void;
  potion(): void;
  interact(): void;
  gear(): void;
  help(): void;
  growth(): void;
  /** P: 화첩 */
  album?(): void;
  rank?(): void;
  shop?(): void;
  escape(): void;
  /** any manual input (auto-battle yields to it) */
  manual?(): void;
  /** Z: 자동 진행 on/off */
  auto?(): void;
  /** M: sound on/off */
  mute?(): void;
  /** Enter: open the chat box */
  chat?(): void;
}

/** On-screen glyphs for the controls, shared by the HUD, hints and tips. */
export const KEYS = {
  move: "WASD", attack: t("클릭"), auto: "Z", roll: "Space", potion: "Q", skills: "1–5", talk: "G", gear: "I", growth: "K", album: "P", rank: "R", shop: "B", help: "H", mute: "M", chat: "Enter",
} as const;

const MOVE: Record<string, "up" | "down" | "left" | "right"> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};

export class Input {
  private readonly held = new Set<string>();
  private readonly joy = { x: 0, y: 0, id: -1 };
  mx = 0;
  mz = 0;
  /** left button (or J) held down on the field: keep the combo going */
  holdAtk = false;
  private holdKey = false;
  private holdMouse = false;

  constructor(private readonly h: InputHandlers, root: HTMLElement, canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => this.down(e));
    window.addEventListener("keyup", (e) => {
      const m = MOVE[e.code];
      if (m) this.held.delete(m);
      if (e.code === "KeyJ") { this.holdKey = false; this.syncHold(); }
    });
    window.addEventListener("blur", () => this.clear());
    root.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      const a = b.dataset.act as string;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.h.manual?.();
        if (a === "potion") this.h.potion();
        else if (a === "interact") this.h.interact();
        else if (!this.h.blocked()) this.h.act(a as Act);
      });
    });
    // the field itself: left click attacks, right click rolls (targets are picked automatically)
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      if (this.h.blocked()) return;
      this.h.manual?.();
      if (e.button === 0) {
        this.holdMouse = true;
        this.syncHold();
        canvas.setPointerCapture(e.pointerId);
        this.h.act("atk");
      } else if (e.button === 2) {
        e.preventDefault();
        this.h.act("dash");
      }
    });
    const release = (e: PointerEvent) => {
      if (e.button === 0 || e.type === "pointercancel") { this.holdMouse = false; this.syncHold(); }
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    const stick = root.querySelector<HTMLElement>(".stick");
    const knob = stick?.querySelector<HTMLElement>("i");
    if (stick && knob) {
      const set = (e: PointerEvent) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const l = Math.hypot(dx, dy), m = 46;
        if (l > m) { dx *= m / l; dy *= m / l; }
        this.joy.x = dx / m;
        this.joy.y = dy / m;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.h.manual?.();
      };
      stick.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.joy.id = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        set(e);
      });
      stick.addEventListener("pointermove", (e) => { if (e.pointerId === this.joy.id) set(e); });
      const end = () => { this.joy.id = -1; this.joy.x = this.joy.y = 0; knob.style.transform = ""; };
      stick.addEventListener("pointerup", end);
      stick.addEventListener("pointercancel", end);
    }
  }

  private syncHold(): void {
    this.holdAtk = this.holdKey || this.holdMouse;
  }

  private down(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (e.code === "Escape") { this.h.escape(); return; }
    // text fields keep their keys; a slider (range) still lets M through
    if (tgt && tgt.tagName === "TEXTAREA") return;
    if (tgt && tgt.tagName === "INPUT" && (tgt as HTMLInputElement).type !== "range") return;
    if (e.code === "KeyM" && !e.repeat) { this.h.mute?.(); return; }
    if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat && !this.h.blocked()) { e.preventDefault(); this.h.chat?.(); return; }
    const move = MOVE[e.code];
    if (e.repeat && !move) return;
    if (e.code === "KeyI") { this.h.gear(); return; }
    if (e.code === "KeyH") { this.h.help(); return; }
    if (e.code === "KeyK") { this.h.growth(); return; }
    if (e.code === "KeyP") { this.h.album?.(); return; }
    if (e.code === "KeyR") { this.h.rank?.(); return; }
    if (e.code === "KeyB") { this.h.shop?.(); return; }
    if (this.h.blocked()) return;
    if (move) {
      e.preventDefault();
      this.held.add(move);
      this.h.manual?.();
      return;
    }
    if (e.code === "KeyQ") { this.h.potion(); return; }
    // 1–5: 물결, 화염, 대지, 바람, 먹 (aimed at the cursor like a swing)
    const d = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : e.code.startsWith("Numpad") ? Number(e.code.slice(6)) : NaN;
    if (d >= 1 && d <= 5) { this.h.manual?.(); this.h.skill(d - 1); return; }
    if (e.code === "KeyG") { this.h.interact(); return; }
    if (e.code === "KeyZ") { this.h.auto?.(); return; }
    if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") { e.preventDefault(); this.h.manual?.(); this.h.act("dash"); return; }
    if (e.code === "KeyJ") {
      this.h.manual?.();
      this.holdKey = true;
      this.syncHold();
      this.h.act("atk");
    }
  }

  clear(): void {
    this.held.clear();
    this.holdKey = false;
    this.holdMouse = false;
    this.syncHold();
  }

  /** Movement this frame (camera looks north, so screen-down is +z). */
  read(): void {
    let mx = (this.held.has("right") ? 1 : 0) - (this.held.has("left") ? 1 : 0) + this.joy.x;
    let mz = (this.held.has("down") ? 1 : 0) - (this.held.has("up") ? 1 : 0) + this.joy.y;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    if (this.h.blocked()) { mx = 0; mz = 0; }
    this.mx = mx;
    this.mz = mz;
  }
}
