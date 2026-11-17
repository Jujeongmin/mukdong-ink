// Keyboard (WASD/arrows, Space, J, K, 1–5, Q, E, G, H, Esc) and touch (joystick + buttons).

export type Act = "atk" | "dash" | "jump";
export interface InputHandlers {
  /** true while a sheet or overlay owns the input */
  blocked(): boolean;
  act(a: Act): void;
  skill(i: number): void;
  potion(): void;
  interact(): void;
  gear(): void;
  help(): void;
  escape(): void;
}

const KEYMAP: Record<string, "up" | "down" | "left" | "right" | Act> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "jump", KeyJ: "atk", KeyZ: "atk", KeyK: "dash", KeyX: "dash", ShiftLeft: "dash", ShiftRight: "dash",
};

export class Input {
  private readonly held = new Set<string>();
  private readonly joy = { x: 0, y: 0, id: -1 };
  mx = 0;
  mz = 0;

  constructor(private readonly h: InputHandlers, root: HTMLElement) {
    window.addEventListener("keydown", (e) => this.down(e));
    window.addEventListener("keyup", (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener("blur", () => this.clear());
    root.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      const a = b.dataset.act as string;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (a === "potion") this.h.potion();
        else if (a === "interact") this.h.interact();
        else if (!this.h.blocked()) this.h.act(a as Act);
      });
    });
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

  private down(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
    if (e.code === "Escape") { this.h.escape(); return; }
    if (e.repeat && !KEYMAP[e.code]) return;
    if (e.code === "KeyG") { this.h.gear(); return; }
    if (e.code === "KeyH") { this.h.help(); return; }
    if (this.h.blocked()) return;
    if (/^Digit[1-5]$/.test(e.code)) { e.preventDefault(); this.h.skill(+e.code.slice(5) - 1); return; }
    if (e.code === "KeyQ") { this.h.potion(); return; }
    if (e.code === "KeyE" || e.code === "Enter") { this.h.interact(); return; }
    const a = KEYMAP[e.code];
    if (!a) return;
    e.preventDefault();
    if (!this.held.has(a) && (a === "atk" || a === "dash" || a === "jump")) this.h.act(a);
    this.held.add(a);
  }

  clear(): void {
    this.held.clear();
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
