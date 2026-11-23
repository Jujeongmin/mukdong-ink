// The corner minimap: the zone you stand in drawn as an ink disc on paper (north up, like the camera). What never
// moves (the worn path, the gates and where they lead, the NPCs, the fixed monster spots and the boss ground) is
// painted once per zone into an offscreen canvas; each tick (10 Hz, from the game's slow UI step) only that
// picture is copied and the moving marks go on top: other players as small dots, you as a brush-tip arrow,
// quest marks over NPCs. Field monsters are not tracked here: the map sheet tells where they live.
// Two canvases for the life of the game, nothing allocated per tick.

import { MONSTERS, isObstacle } from "../../shared/combat";
import { ZONES, type ZoneDef } from "../../shared/world";
import { t } from "../i18n";

const CSS = 132;
const INK = "#1b1916", PAPER = "#e8e0cc", CINNABAR = "#b8321f", GOLD = "#c9962e";

export type NpcMarkKind = "offer" | "turnin" | "sub" | "wait" | null;

export class Minimap {
  readonly el: HTMLButtonElement;
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base = document.createElement("canvas");
  private zone: ZoneDef | null = null;
  private dpr = 1;
  private size = CSS;
  private scale = 1;

  constructor(onOpen: () => void) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "minimap";
    this.el.dataset.tipTitle = `${t("지도")} (N)`;
    this.el.dataset.tip = t("눌러서 지도를 편다. 몬스터, 드랍, NPC, 순간이동.");
    this.el.setAttribute("aria-label", `${t("지도")} (N)`);
    this.cv = document.createElement("canvas");
    this.cv.setAttribute("aria-hidden", "true");
    this.el.appendChild(this.cv);
    const name = document.createElement("b");
    name.className = "mm-name";
    this.el.appendChild(name);
    this.ctx = this.cv.getContext("2d");
    this.el.addEventListener("click", onOpen);
  }

  /** world → canvas pixels (device pixels) */
  private px(x: number): number { return this.size / 2 + x * this.scale; }
  private pz(z: number): number { return this.size / 2 + z * this.scale; }

  /** A new zone (or a resize): repaint the still picture. */
  setZone(zoneId: string): void {
    const def = ZONES[zoneId];
    if (!def) return;
    this.zone = def;
    (this.el.querySelector(".mm-name") as HTMLElement).textContent = t(def.name);
    this.paintBase();
  }

  private paintBase(): void {
    const def = this.zone;
    if (!def) return;
    // the shown size follows the CSS box (smaller on phones)
    const shown = this.el.clientWidth || CSS;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.round(shown * this.dpr);
    for (const c of [this.cv, this.base]) { c.width = this.size; c.height = this.size; }
    const g = this.base.getContext("2d");
    if (!g) return;
    const S = this.size, R = def.radius, d = this.dpr;
    this.scale = (S / 2 - 7 * d) / (R + 1.5);
    g.clearRect(0, 0, S, S);
    // paper disc, a little darker toward the rim, and an ink ring that doesn't quite close (a brushed ensō)
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
    grad.addColorStop(0, PAPER);
    grad.addColorStop(1, def.safe ? "#d9cfb6" : "#cfc6b0");
    g.fillStyle = grad;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3 * d, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK;
    g.lineCap = "round";
    g.lineWidth = 3.2 * d;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3.5 * d, -1.35, Math.PI * 2 - 1.75); g.stroke();
    g.lineWidth = 1.2 * d;
    g.globalAlpha = 0.5;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 7 * d, 0.4, Math.PI * 2 - 0.2); g.stroke();
    g.globalAlpha = 1;
    // the field's edge
    g.globalAlpha = 0.25;
    g.lineWidth = 1 * d;
    g.beginPath(); g.arc(S / 2, S / 2, R * this.scale, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    // the worn path, south gate to north (the same curve the ground paints)
    g.strokeStyle = "rgba(60, 52, 44, 0.32)";
    g.lineWidth = 3.4 * d;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const k = i / 24, z = R - 1 - k * (R * 2 - 2), x = Math.sin(k * 5 + R) * 2.2;
      if (i === 0) g.moveTo(this.px(x), this.pz(z)); else g.lineTo(this.px(x), this.pz(z));
    }
    g.stroke();
    // fixed monster spots: the boss ground in cinnabar, guards as ink diamonds, obstacles as grey dots
    for (const sp of def.spawns) {
      if (!sp.at) continue;
      const m = MONSTERS[sp.kind];
      for (const a of sp.at) {
        const x = this.px(a.x), y = this.pz(a.z);
        if (m && isObstacle(m)) { g.fillStyle = "rgba(40,36,32,0.45)"; g.beginPath(); g.arc(x, y, 1.8 * d, 0, Math.PI * 2); g.fill(); continue; }
        g.fillStyle = INK;
        g.beginPath(); g.moveTo(x, y - 4 * d); g.lineTo(x + 3.4 * d, y); g.lineTo(x, y + 4 * d); g.lineTo(x - 3.4 * d, y); g.closePath(); g.fill();
      }
    }
    if (def.boss) {
      const x = this.px(def.boss.x), y = this.pz(def.boss.z);
      g.fillStyle = "rgba(184, 50, 31, 0.22)";
      g.beginPath(); g.arc(x, y, 9 * d, 0, Math.PI * 2); g.fill();
      g.strokeStyle = CINNABAR;
      g.lineWidth = 2 * d;
      g.beginPath(); g.arc(x, y, 6 * d, 0, Math.PI * 2); g.stroke();
      g.fillStyle = CINNABAR;
      g.beginPath(); g.arc(x, y, 2.6 * d, 0, Math.PI * 2); g.fill();
    }
    // gates: a short bar across the way out, with where it leads written beside it
    // the page's own brush face (each language sets its own)
    const face = getComputedStyle(document.documentElement).getPropertyValue("--f-brush").trim() || "serif";
    g.font = `700 ${Math.round(9.5 * d)}px ${face}`;
    g.textBaseline = "middle";
    for (const p of def.portals) {
      const x = this.px(p.x), y = this.pz(p.z);
      const a = Math.atan2(p.z, p.x);
      g.strokeStyle = INK;
      g.lineWidth = 2.6 * d;
      const ux = -Math.sin(a) * 5 * d, uy = Math.cos(a) * 5 * d;
      g.beginPath(); g.moveTo(x - ux, y - uy); g.lineTo(x + ux, y + uy); g.stroke();
      const to = ZONES[p.to];
      if (!to) continue;
      const label = t(to.name);
      const w = g.measureText(label).width;
      // inside the disc, toward the middle from the gate
      let lx = x - Math.cos(a) * 11 * d - w / 2, ly = y - Math.sin(a) * 10 * d;
      lx = Math.max(6 * d, Math.min(S - 6 * d - w, lx));
      ly = Math.max(10 * d, Math.min(S - 10 * d, ly));
      g.lineWidth = 3 * d;
      g.strokeStyle = "rgba(232, 224, 204, 0.9)";
      g.strokeText(label, lx, ly);
      g.fillStyle = INK;
      g.fillText(label, lx, ly);
    }
  }

  /**
   * One tick: the still picture, the others, the NPCs (gold when they want you), and you. `fx, fz` is the way you
   * face; `marks(id)` the quest mark over an NPC.
   */
  draw(x: number, z: number, fx: number, fz: number, others: readonly { x: number; z: number }[], count: number, marks: (id: string) => NpcMarkKind): void {
    const g = this.ctx, def = this.zone;
    if (!g || !def) return;
    if (this.el.clientWidth && Math.round(this.el.clientWidth * Math.min(2, window.devicePixelRatio || 1)) !== this.size) this.paintBase();
    const S = this.size, d = this.dpr;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.base, 0, 0);
    g.fillStyle = "rgba(60, 74, 110, 0.85)";
    for (let i = 0; i < count; i++) {
      const o = others[i];
      g.beginPath(); g.arc(this.px(o.x), this.pz(o.z), 2.3 * d, 0, Math.PI * 2); g.fill();
    }
    for (const n of def.npcs) {
      const m = marks(n.id);
      const nx = this.px(n.x), ny = this.pz(n.z);
      g.fillStyle = m === "offer" || m === "turnin" || m === "sub" ? GOLD : INK;
      g.beginPath(); g.arc(nx, ny, 3.2 * d, 0, Math.PI * 2); g.fill();
      g.strokeStyle = PAPER;
      g.lineWidth = 1.2 * d;
      g.stroke();
      if (m === "offer" || m === "turnin" || m === "sub") {
        g.font = `900 ${Math.round(10 * d)}px serif`;
        g.textBaseline = "alphabetic";
        g.fillStyle = m === "offer" ? GOLD : CINNABAR;
        g.fillText(m === "offer" ? "!" : "?", nx + 3.5 * d, ny - 3 * d);
      }
    }
    // you: a brush-tip arrow pointing the way you face, cinnabar like the scarf
    const len = Math.hypot(fx, fz) || 1, ax = fx / len, az = fz / len;
    const cx = this.px(Math.max(-def.radius, Math.min(def.radius, x))), cy = this.pz(Math.max(-def.radius, Math.min(def.radius, z)));
    g.fillStyle = CINNABAR;
    g.strokeStyle = PAPER;
    g.lineWidth = 1.4 * d;
    g.beginPath();
    g.moveTo(cx + ax * 7 * d, cy + az * 7 * d);
    g.lineTo(cx - ax * 4 * d - az * 4.4 * d, cy - az * 4 * d + ax * 4.4 * d);
    g.lineTo(cx - ax * 1.6 * d, cy - az * 1.6 * d);
    g.lineTo(cx - ax * 4 * d + az * 4.4 * d, cy - az * 4 * d - ax * 4.4 * d);
    g.closePath();
    g.fill();
    g.stroke();
  }
}
