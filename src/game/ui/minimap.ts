// Zone maps drawn as an ink disc on paper (north up, like the camera). One painter, two sizes:
// - the corner minimap under the portrait (Minimap), and
// - the map sheet's big map (ZoneMap with `labels`): the same picture enlarged, with names written beside things.
// What never moves (the worn path, the gates and where they lead, the NPCs, the fixed monster spots and the boss
// ground) is painted once per zone and size into an offscreen canvas; each tick (10 Hz, from the game's slow UI
// step) only that picture is copied and the moving marks go on top: other players as small dots, you as a brush-tip
// arrow, quest marks over NPCs. Field monsters are not tracked: the map sheet tells where they live.
// Two canvases per map for the life of the game, nothing allocated per tick.

import { MONSTERS, isObstacle } from "../../shared/combat";
import { ZONES, type ZoneDef } from "../../shared/world";
import { NPC_INFO } from "../../shared/story";
import { t } from "../i18n";

const INK = "#1b1916", PAPER = "#e8e0cc", CINNABAR = "#b8321f", GOLD = "#c9962e";

export type NpcMarkKind = "offer" | "turnin" | "sub" | "wait" | null;

/** What moves on a map: you (only drawn when you are in the zone shown), the others, the quest marks. */
export interface MapLive {
  zone: string;
  x: number;
  z: number;
  fx: number;
  fz: number;
  others: readonly { x: number; z: number }[];
  count: number;
  marks: (id: string) => NpcMarkKind;
  /** the room's 필드 보스 while it is up (`on`), where it is */
  fb: { on: boolean; x: number; z: number };
}

export class ZoneMap {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base = document.createElement("canvas");
  private zone: ZoneDef | null = null;
  private dpr = 1;
  private size = 0;
  private scale = 1;
  /** CSS px the picture is laid out at (the element's own width) */
  private shown = 0;

  /** `labels`: write names beside the NPCs, the guards and the boss (the big map) */
  constructor(private readonly labels = false) {
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d");
  }

  get zoneId(): string { return this.zone?.id ?? ""; }

  /** text size on the big map, by how big it is shown (a phone's small map keeps small names) */
  private ts(): number { return Math.max(0.78, Math.min(1.35, this.shown / 280)); }

  /** world → canvas pixels (device pixels) */
  private px(x: number): number { return this.size / 2 + x * this.scale; }
  private pz(z: number): number { return this.size / 2 + z * this.scale; }

  /** A zone to show (repaints the still picture when it changes, or when the shown size changed). */
  setZone(zoneId: string, force = false): void {
    const def = ZONES[zoneId];
    if (!def) return;
    if (def === this.zone && !force) return;
    this.zone = def;
    this.paintBase();
  }

  /** Text in the page's own brush face (each language sets its own), at `px` CSS pixels. */
  private font(g: CanvasRenderingContext2D, px: number, weight = 700): void {
    const face = getComputedStyle(document.documentElement).getPropertyValue("--f-brush").trim() || "serif";
    g.font = `${weight} ${Math.round(px * this.dpr)}px ${face}`;
  }

  /** labels waiting to be placed (paintBase writes them last, most important first, so none sits on another) */
  private readonly pending: { text: string; x: number; y: number; color: string; font: string; prio: number }[] = [];
  /**
   * A label with a paper halo so it reads over the ink. `prio`: 0 gates, 1 people, 2 the boss, 3 guards; a label
   * that would cover one already written moves a line down or up, and a guard's name with no room is left out.
   */
  private say(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, prio = 0): void {
    this.pending.push({ text, x, y, color, font: g.font, prio });
  }
  private flushLabels(g: CanvasRenderingContext2D): void {
    const d = this.dpr, S = this.size;
    const taken: { l: number; t: number; r: number; b: number }[] = [];
    this.pending.sort((a, b) => a.prio - b.prio);
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const L of this.pending) {
      g.font = L.font;
      const w = g.measureText(L.text).width, h = Number(/(\d+(?:\.\d+)?)px/.exec(L.font)?.[1]) || 12 * d;
      let spot: { x: number; y: number } | null = null;
      for (const dy of [0, 1.15, -1.15, 2.3, -2.3]) {
        const lx = Math.max(4 * d, Math.min(S - 4 * d - w, L.x));
        const ly = Math.max(9 * d, Math.min(S - 9 * d, L.y + dy * h));
        const box = { l: lx - 2 * d, t: ly - h / 2 - d, r: lx + w + 2 * d, b: ly + h / 2 + d };
        if (!taken.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) { spot = { x: lx, y: ly }; taken.push(box); break; }
      }
      if (!spot) {
        if (L.prio >= 3) continue;
        spot = { x: Math.max(4 * d, Math.min(S - 4 * d - w, L.x)), y: Math.max(9 * d, Math.min(S - 9 * d, L.y)) };
      }
      g.lineWidth = 3.2 * d;
      g.strokeStyle = "rgba(232, 224, 204, 0.92)";
      g.strokeText(L.text, spot.x, spot.y);
      g.fillStyle = L.color;
      g.fillText(L.text, spot.x, spot.y);
    }
    this.pending.length = 0;
  }

  private paintBase(): void {
    const def = this.zone;
    if (!def) return;
    // the picture follows its CSS box (smaller on phones; the big map fills its column)
    this.shown = this.canvas.clientWidth || (this.labels ? 360 : 132);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.round(this.shown * this.dpr);
    for (const c of [this.canvas, this.base]) { c.width = this.size; c.height = this.size; }
    const g = this.base.getContext("2d");
    if (!g) return;
    const S = this.size, R = def.radius, d = this.dpr;
    // marks grow a little with the map, not in proportion (a big map stays a map, not a poster)
    const k = this.labels ? Math.max(1, Math.min(2, this.shown / 200)) : 1;
    this.scale = (S / 2 - 7 * d * k) / (R + 1.5);
    g.clearRect(0, 0, S, S);
    // paper disc, a little darker toward the rim, and an ink ring that doesn't quite close (a brushed ensō)
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
    grad.addColorStop(0, PAPER);
    grad.addColorStop(1, def.safe ? "#d9cfb6" : "#cfc6b0");
    g.fillStyle = grad;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3 * d * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK;
    g.lineCap = "round";
    g.lineWidth = 3.2 * d * k;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3.5 * d * k, -1.35, Math.PI * 2 - 1.75); g.stroke();
    g.lineWidth = 1.2 * d * k;
    g.globalAlpha = 0.5;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 7 * d * k, 0.4, Math.PI * 2 - 0.2); g.stroke();
    g.globalAlpha = 0.25;
    g.lineWidth = 1 * d;
    g.beginPath(); g.arc(S / 2, S / 2, R * this.scale, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    // the worn path, south gate to north (the same curve the ground paints)
    g.strokeStyle = "rgba(60, 52, 44, 0.32)";
    g.lineWidth = 3.4 * d * k;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const f = i / 24, z = R - 1 - f * (R * 2 - 2), x = Math.sin(f * 5 + R) * 2.2;
      if (i === 0) g.moveTo(this.px(x), this.pz(z)); else g.lineTo(this.px(x), this.pz(z));
    }
    g.stroke();
    // fixed monster spots: guards as ink diamonds, obstacles as grey dots; on the big map, each kind named once
    g.textBaseline = "middle";
    this.font(g, 11 * this.ts());
    for (const sp of def.spawns) {
      if (!sp.at) continue;
      const m = MONSTERS[sp.kind];
      let named = false;
      for (const a of sp.at) {
        const x = this.px(a.x), y = this.pz(a.z);
        if (m && isObstacle(m)) { g.fillStyle = "rgba(40,36,32,0.45)"; g.beginPath(); g.arc(x, y, 1.8 * d * k, 0, Math.PI * 2); g.fill(); }
        else {
          g.fillStyle = INK;
          const r = 4 * d * k;
          g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.85, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.85, y); g.closePath(); g.fill();
        }
        if (this.labels && m && !named) {
          named = true;
          const name = t(m.name);
          // obstacles in a row (먹덩굴, 석등지기) are named once, under the middle of the row
          const mid = sp.at[Math.floor(sp.at.length / 2)];
          const mx = this.px(mid.x), my = this.pz(mid.z);
          this.say(g, name, mx - g.measureText(name).width / 2, my + 11 * d * k, "#4a433c", 3);
        }
      }
    }
    if (def.boss) {
      const x = this.px(def.boss.x), y = this.pz(def.boss.z);
      g.fillStyle = "rgba(184, 50, 31, 0.22)";
      g.beginPath(); g.arc(x, y, 9 * d * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = CINNABAR;
      g.lineWidth = 2 * d * k;
      g.beginPath(); g.arc(x, y, 6 * d * k, 0, Math.PI * 2); g.stroke();
      g.fillStyle = CINNABAR;
      g.beginPath(); g.arc(x, y, 2.6 * d * k, 0, Math.PI * 2); g.fill();
      const m = MONSTERS[def.boss.kind];
      if (this.labels && m) {
        this.font(g, 13 * this.ts());
        const name = `${t(m.name)} · Lv ${def.boss.level}`;
        this.say(g, name, x - g.measureText(name).width / 2, y + 16 * d * k, CINNABAR, 2);
      }
    }
    // gates: a short bar across the way out, with where it leads written beside it
    this.font(g, this.labels ? 12.5 * this.ts() : 9.5);
    for (const p of def.portals) {
      const x = this.px(p.x), y = this.pz(p.z);
      const a = Math.atan2(p.z, p.x);
      g.strokeStyle = INK;
      g.lineWidth = 2.6 * d * k;
      const ux = -Math.sin(a) * 5 * d * k, uy = Math.cos(a) * 5 * d * k;
      g.beginPath(); g.moveTo(x - ux, y - uy); g.lineTo(x + ux, y + uy); g.stroke();
      const to = ZONES[p.to];
      if (!to) continue;
      const label = this.labels ? `→ ${t(to.name)}` : t(to.name);
      const w = g.measureText(label).width;
      // inside the disc, toward the middle from the gate
      this.say(g, label, x - Math.cos(a) * 11 * d * k - w / 2, y - Math.sin(a) * 10 * d * k);
    }
    // the NPCs' names (their dots go on each tick, gold when they want you)
    if (this.labels) {
      this.font(g, 12 * this.ts());
      for (const n of def.npcs) {
        const name = t(NPC_INFO[n.id]?.name ?? n.name);
        this.say(g, name, this.px(n.x) + 7 * d * k, this.pz(n.z) + 1 * d, INK, 1);
      }
    }
    this.flushLabels(g);
  }

  /** One tick: the still picture, the others, the NPCs, and you (when `live` is in this zone). */
  draw(live: MapLive | null): void {
    const g = this.ctx, def = this.zone;
    if (!g || !def) return;
    // the box changed size (a resize, the phone layout, the sheet opening): paint again at the new size
    const w = this.canvas.clientWidth;
    if (w && w !== this.shown) this.paintBase();
    const S = this.size, d = this.dpr;
    const k = this.labels ? Math.max(1, Math.min(2, this.shown / 200)) : 1;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.base, 0, 0);
    const here = !!live && live.zone === def.id;
    if (here && live.fb.on) {
      // the field boss: a cinnabar mark that breathes, so it is found at a glance
      const x = this.px(live.fb.x), y = this.pz(live.fb.z), pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      g.fillStyle = `rgba(184, 50, 31, ${(0.18 + 0.2 * pulse).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, (8 + 3 * pulse) * d * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = CINNABAR;
      g.strokeStyle = PAPER;
      g.lineWidth = 1.4 * d;
      g.beginPath(); g.arc(x, y, 4.2 * d * k, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (here) {
      g.fillStyle = "rgba(60, 74, 110, 0.85)";
      for (let i = 0; i < live.count; i++) {
        const o = live.others[i];
        g.beginPath(); g.arc(this.px(o.x), this.pz(o.z), 2.3 * d * k, 0, Math.PI * 2); g.fill();
      }
    }
    for (const n of def.npcs) {
      const m = live ? live.marks(n.id) : null;
      const nx = this.px(n.x), ny = this.pz(n.z);
      const want = m === "offer" || m === "turnin" || m === "sub";
      g.fillStyle = want ? GOLD : INK;
      g.beginPath(); g.arc(nx, ny, 3.2 * d * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = PAPER;
      g.lineWidth = 1.2 * d;
      g.stroke();
      if (want) {
        g.font = `900 ${Math.round(10 * d * k)}px serif`;
        g.textBaseline = "alphabetic";
        g.fillStyle = m === "offer" ? GOLD : CINNABAR;
        g.fillText(m === "offer" ? "!" : "?", nx - 2.5 * d * k, ny - 5 * d * k);
      }
    }
    if (!here) return;
    // you: a brush-tip arrow pointing the way you face, cinnabar like the scarf
    const len = Math.hypot(live.fx, live.fz) || 1, ax = live.fx / len, az = live.fz / len;
    const cx = this.px(Math.max(-def.radius, Math.min(def.radius, live.x))), cy = this.pz(Math.max(-def.radius, Math.min(def.radius, live.z)));
    const s = d * k;
    g.fillStyle = CINNABAR;
    g.strokeStyle = PAPER;
    g.lineWidth = 1.4 * d;
    g.beginPath();
    g.moveTo(cx + ax * 7 * s, cy + az * 7 * s);
    g.lineTo(cx - ax * 4 * s - az * 4.4 * s, cy - az * 4 * s + ax * 4.4 * s);
    g.lineTo(cx - ax * 1.6 * s, cy - az * 1.6 * s);
    g.lineTo(cx - ax * 4 * s + az * 4.4 * s, cy - az * 4 * s - ax * 4.4 * s);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** The corner minimap: a ZoneMap in a round button under the portrait, its zone's name beneath. */
export class Minimap {
  readonly el: HTMLButtonElement;
  private readonly map = new ZoneMap(false);
  private readonly name: HTMLElement;

  constructor(onOpen: () => void) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "minimap";
    this.el.dataset.tipTitle = `${t("지도")} (N)`;
    this.el.dataset.tip = t("눌러서 지도를 편다\n몬스터, 드랍, NPC, 순간이동");
    this.el.setAttribute("aria-label", `${t("지도")} (N)`);
    this.el.appendChild(this.map.canvas);
    this.name = document.createElement("b");
    this.name.className = "mm-name";
    this.el.appendChild(this.name);
    this.el.addEventListener("click", onOpen);
  }

  setZone(zoneId: string): void {
    const def = ZONES[zoneId];
    if (!def) return;
    this.name.textContent = t(def.name);
    this.map.setZone(zoneId, true);
  }

  draw(live: MapLive): void {
    this.map.draw(live);
  }
}
