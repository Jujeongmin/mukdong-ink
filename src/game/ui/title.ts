// Title screen (press to start, connection status, first-time name) and the mock rewarded-ad overlay.

import { el, esc } from "./dom";

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

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML("beforeend", `
      <section class="title" data-title>
        <div class="title-inner">
          <div class="enso"><i class="spr-enso" aria-hidden="true"></i><h1>채묵</h1></div>
          <p class="subtitle">잃어버린 색</p>
          <i class="spr-stroke stroke" aria-hidden="true"></i>
          <p>먹으로 그린 세상, 색은 오직 검법과 물들인 장비에만.<br>큰 붓을 든 먹동이가 되어 먹귀신을 베어 보세요.</p>
          <div data-slot><button class="start" type="button" data-start>눌러서 시작</button></div>
          <div class="status" data-status aria-live="polite"></div>
        </div>
      </section>`);
    this.box = el("[data-title]", root);
  }

  /** Resolves when the player presses start (button, Enter or Space). */
  waitStart(label = "눌러서 시작"): Promise<void> {
    const slot = el("[data-slot]", this.box);
    slot.innerHTML = `<button class="start" type="button" data-start>${esc(label)}</button>`;
    const btn = el<HTMLButtonElement>("[data-start]", slot);
    btn.focus();
    return new Promise((resolve) => {
      const go = () => {
        window.removeEventListener("keydown", key);
        btn.disabled = true;
        resolve();
      };
      const key = (e: KeyboardEvent) => { if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); go(); } };
      btn.addEventListener("click", go, { once: true });
      window.addEventListener("keydown", key);
    });
  }

  status(text: string): void {
    el("[data-status]", this.box).textContent = text;
  }

  /** First visit: pick a name. Resolves with the trimmed name (validation is the server's). */
  askName(initial: string): Promise<string> {
    const slot = el("[data-slot]", this.box);
    slot.innerHTML = `<form class="name-row" data-form><input data-name maxlength="10" autocomplete="off" placeholder="이름 (2~10자)" value="${esc(initial)}" aria-label="이름"><button class="start" type="submit">이 이름으로</button></form>`;
    const input = el<HTMLInputElement>("[data-name]", slot);
    input.focus();
    return new Promise((resolve) => {
      el("[data-form]", slot).addEventListener("submit", (e) => {
        e.preventDefault();
        resolve(input.value.trim());
      });
    });
  }

  busy(): void {
    el("[data-slot]", this.box).innerHTML = "";
  }

  hide(): void {
    this.box.remove();
  }
}
