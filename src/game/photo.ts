// 사진 모드: the HUD steps aside, the camera can be turned (drag), tilted (vertical drag) and pulled in or out
// (wheel / pinch-free buttons), and 찍기 saves the game frame (no HUD) as a JPEG download. The world keeps
// running underneath (you are still standing in it), so the overlay is small: a hint line and two tablets.
// The view offsets are read by the game's camera every frame; nothing here touches three.js objects.

import { el } from "./ui/dom";

export interface PhotoView {
  /** turn around the player, radians (kept to ±0.6: the painted backdrop is drawn for a camera facing north) */
  yaw: number;
  /** 0.55 (close) .. 1.6 (far) */
  zoom: number;
  /** 0 (low, cinematic) .. 1 (the usual high quarter view) */
  tilt: number;
}

export class PhotoMode {
  readonly view: PhotoView = { yaw: 0, zoom: 1, tilt: 1 };
  private readonly box: HTMLElement;
  private drag: { id: number; x: number; y: number } | null = null;
  on = false;

  constructor(private readonly root: HTMLElement, canvas: HTMLCanvasElement, private readonly h: { shoot(): void; close(): void }) {
    root.insertAdjacentHTML("beforeend", `
      <div class="photo-ui" data-photo hidden>
        <p class="photo-hint">끌어서 돌리고 기울이기 · 휠로 당기기 · Esc 닫기</p>
        <div class="photo-bar">
          <button class="btn btn-sm btn-secondary" type="button" data-pz="-1" aria-label="당기기">+</button>
          <button class="btn btn-sm btn-secondary" type="button" data-pz="1" aria-label="멀리">−</button>
          <button class="btn btn-lg photo-shoot" type="button" data-shoot>찍기</button>
          <button class="btn btn-sm btn-secondary" type="button" data-preset aria-label="처음 시점">처음 시점</button>
          <button class="btn btn-sm btn-secondary" type="button" data-pclose>닫기</button>
        </div>
        <i class="photo-flash" data-flash aria-hidden="true"></i>
      </div>`);
    this.box = el("[data-photo]", root);
    el("[data-shoot]", this.box).addEventListener("click", () => this.h.shoot());
    el("[data-pclose]", this.box).addEventListener("click", () => this.h.close());
    el("[data-preset]", this.box).addEventListener("click", () => { this.view.yaw = 0; this.view.zoom = 1; this.view.tilt = 1; });
    this.box.querySelectorAll<HTMLElement>("[data-pz]").forEach((b) => b.addEventListener("click", () => this.zoomBy(Number(b.dataset.pz) * 0.12)));
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.on) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
    window.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!this.on || !d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      this.view.yaw = Math.max(-0.6, Math.min(0.6, this.view.yaw - dx * 0.004));
      this.view.tilt = Math.max(0, Math.min(1, this.view.tilt + dy * 0.004));
    });
    window.addEventListener("pointerup", (e) => { if (this.drag?.id === e.pointerId) this.drag = null; });
    canvas.addEventListener("wheel", (e) => {
      if (!this.on) return;
      e.preventDefault();
      this.zoomBy(Math.sign(e.deltaY) * 0.08);
    }, { passive: false });
  }

  private zoomBy(d: number): void {
    this.view.zoom = Math.max(0.55, Math.min(1.6, this.view.zoom + d));
  }

  open(): void {
    this.on = true;
    this.view.yaw = 0; this.view.zoom = 1; this.view.tilt = 1;
    this.box.hidden = false;
    this.root.classList.add("photo-mode");
  }

  close(): void {
    this.on = false;
    this.drag = null;
    this.box.hidden = true;
    this.root.classList.remove("photo-mode");
  }

  /** A white blink over the screen when the shutter fires. */
  flash(): void {
    const f = el("[data-flash]", this.box);
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
  }
}

/** The game frame (WebGL canvas, no HUD) as a JPEG download. Call right after a render. */
export function saveFrame(src: HTMLCanvasElement): void {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `chaemuk-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
  src.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/jpeg", 0.92);
}
