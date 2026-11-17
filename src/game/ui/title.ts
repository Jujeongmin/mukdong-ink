// Title screen (press to start, connection status, first-time name) and the mock rewarded-ad overlay.

import { el, esc } from "./dom";
import { TitleScene } from "../titleScene";

/** Mock rewarded ad: a clearly labeled 3-second countdown that always counts as watched. */
export function mockAdPresenter(): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "adplay";
    box.setAttribute("role", "dialog");
    box.innerHTML = `<div><b data-n>3</b>광고 재생 중 (모의 광고)</div>`;
    document.body.appendChild(box);
    let n = 3;
    const iv = window.setInterval(() => {
      n--;
      el("[data-n]", box).textContent = String(Math.max(0, n));
      if (n <= 0) {
        window.clearInterval(iv);
        box.remove();
        resolve(true);
      }
    }, 1000);
  });
}

export class Title {
  private readonly box: HTMLElement;
  private scene: TitleScene | null = null;
  private live = false;

  constructor(root: HTMLElement) {
    // The backdrop is the game itself (TitleScene, live in the ink pass); the logo, drifting petals and ink
    // drops are DOM/CSS over it (their animations stop while the title is hidden).
    root.insertAdjacentHTML("beforeend", `
      <section class="title" data-title>
        <div class="title-drift" aria-hidden="true">${"<i></i>".repeat(9)}</div>
        <div class="title-inner">
          <div class="logo">
            <h1>채묵</h1>
            <i class="logo-stroke" aria-hidden="true"></i>
            <p class="subtitle">잃어버린 색</p>
          </div>
          <p class="title-lead">먹으로 그린 세상, 색은 검법과 물들인 천에만 남았다.</p>
          <div class="title-cta" data-slot><button class="start title-start" type="button" data-start><span>눌러서 시작</span></button></div>
          <div class="status" data-status aria-live="polite"></div>
        </div>
        <i class="ink-wipe" data-wipe aria-hidden="true"></i>
      </section>`);
    this.box = el("[data-title]", root);
  }

  /** Where the player tapped to start; the ink wipe spreads from there. */
  private tapAt: { x: number; y: number } | null = null;

  /** Resolves when the player taps/clicks anywhere on the title, or presses Enter/Space. */
  waitStart(label = "눌러서 시작"): Promise<void> {
    const slot = el("[data-slot]", this.box);
    slot.innerHTML = `<button class="start title-start" type="button" data-start><span>${esc(label)}</span></button>`;
    const btn = el<HTMLButtonElement>("[data-start]", slot);
    btn.focus();
    this.tapAt = null;
    this.box.classList.add("tap-start");
    return new Promise((resolve) => {
      const go = () => {
        window.removeEventListener("keydown", key);
        this.box.removeEventListener("click", tap);
        this.box.classList.remove("tap-start");
        btn.disabled = true;
        resolve();
      };
      const tap = (e: MouseEvent) => {
        this.tapAt = { x: e.clientX, y: e.clientY };
        go();
      };
      const key = (e: KeyboardEvent) => { if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); go(); } };
      this.box.addEventListener("click", tap);
      window.addEventListener("keydown", key);
    });
  }

  /** Ink washes over the screen from the start button, then the title steps aside. */
  async wipeOut(): Promise<void> {
    const wipe = el("[data-wipe]", this.box);
    const btn = this.box.querySelector<HTMLElement>("[data-start]");
    const r = btn?.getBoundingClientRect();
    const x = this.tapAt?.x ?? (r ? r.left + r.width / 2 : window.innerWidth / 2);
    const y = this.tapAt?.y ?? (r ? r.top + r.height / 2 : window.innerHeight / 2);
    wipe.style.setProperty("--wx", `${x}px`);
    wipe.style.setProperty("--wy", `${y}px`);
    wipe.classList.remove("go");
    void wipe.offsetWidth;
    wipe.classList.add("go");
    await new Promise((res) => window.setTimeout(res, 640));
    this.conceal();
    wipe.classList.remove("go");
  }

  status(text: string): void {
    el("[data-status]", this.box).textContent = text;
  }

  busy(): void {
    el("[data-slot]", this.box).innerHTML = "";
  }

  /** Run the live backdrop (call once the renderer exists). Without it the title keeps a painted gradient. */
  startScene(): void {
    this.live = true;
    this.box.classList.add("live");
    this.scene ??= new TitleScene();
    this.scene.start();
  }

  private stopScene(): void {
    this.scene?.dispose();
    this.scene = null;
  }

  /** Gone for good. */
  hide(): void {
    this.stopScene();
    this.box.remove();
  }

  /** Step aside (character creation, loading): hidden, CSS animations stop, the 3D scene is freed. */
  conceal(): void {
    this.box.hidden = true;
    this.stopScene();
  }

  reveal(): void {
    this.box.hidden = false;
    if (this.live) this.startScene();
  }
}
