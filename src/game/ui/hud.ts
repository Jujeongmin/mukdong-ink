// In-game HUD, painted rather than boxed: an ensō portrait with brush-stroke HP/EXP, a bare wallet, a
// hanging-scroll quest strip, a thumb arc of ensō skill rings, a zone name painted in on arrival, name
// tags, pooled damage numbers, boss stroke, level-up, death, fades.
// Per-frame work only touches styles when a value actually changed.

import * as THREE from "three";
import { SKILLS } from "../../shared/combat";
import { ZONES } from "../../shared/world";
import type { ProfileView } from "../../net/api";
import { camera } from "../render/gfx";
import { fmt, hexCss } from "../util";
import { mainStatus, nextStep, progressText } from "../quests";
import { el, esc, skillIconPos } from "./dom";

export interface HudHandlers {
  potion(): void;
  gear(): void;
  interact(): void;
  skill(i: number): void;
  respawn(): void;
}

// Bottom-right thumb arc: the basic attack is the big ring at the pivot; skills sit on an arc around it
// (물결 at the left end, 먹 at the top), touch-only jump/dash and the potion gourd on the outer arc.
const SKILL_ANGLE = [180, 157.5, 135, 112.5, 90];

const MARKUP = `
<div class="portrait passive" aria-label="나">
  <div class="ring spr-enso"><i class="head"></i><i class="scarf" data-scarf></i></div>
  <b class="lv-seal" data-lv title="경지">1</b>
  <div class="vitals">
    <span class="who" data-name>먹동이</span>
    <div class="hp" title="생명"><i class="track spr-stroke"></i><i class="fill spr-stroke" data-hp></i><span data-hpt></span></div>
    <div class="exp" title="경험"><i class="track spr-stroke"></i><i class="fill spr-stroke" data-exp></i></div>
    <span class="zone-mini" data-zone></span>
  </div>
</div>
<div class="purse">
  <span title="안료: 사냥으로 얻는 재화"><i class="spr ic-pigment" aria-hidden="true"></i><b data-pig>0</b></span>
  <span title="묵옥: 뽑기에 쓰는 재화"><i class="spr ic-jade" aria-hidden="true"></i><b data-jade>0</b></span>
  <button class="brush-label" type="button" data-gear><i class="spr-stroke" aria-hidden="true"></i><span>장비</span><kbd>G</kbd></button>
</div>
<aside class="jokja" data-quest hidden></aside>
<div class="zone-paint passive" data-zonepaint hidden><b data-zpname></b><span class="seal" data-zpch></span></div>
<div class="bossbar passive" data-boss hidden><b data-bossname></b><div class="hp"><i class="track spr-stroke"></i><i class="fill spr-stroke" data-bosshp></i></div></div>
<div class="tags passive" data-tags></div>
<div class="tags passive" data-dmg></div>
<div class="arc" data-arc>
  <button class="ring-btn atk" type="button" data-act="atk" aria-label="베기 (J)"><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(7)}"></i><b>베기</b><kbd>J</kbd></button>
  <button class="ring-btn small touch" type="button" data-act="dash" style="--a:126deg" aria-label="대시"><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(8)}"></i><b>대시</b></button>
  <button class="ring-btn small touch" type="button" data-act="jump" style="--a:144deg" aria-label="점프"><i class="rim spr-enso"></i><b>점프</b></button>
  <button class="gourd" type="button" data-potion style="--a:135deg" aria-label="물약 마시기 (Q)"><i class="body"></i><b data-pot>0</b><kbd>Q</kbd></button>
</div>
<div class="keyhelp passive" data-help hidden>
  <p><kbd>WASD</kbd> 걷기 <kbd>Space</kbd> 뛰기, 두 번이면 공중제비</p>
  <p><kbd>J</kbd> 베기 <kbd>K</kbd> 대시 <kbd>1</kbd>~<kbd>5</kbd> 오방 검법</p>
  <p><kbd>Q</kbd> 물약 <kbd>E</kbd> 말 걸기 <kbd>G</kbd> 장비 <kbd>H</kbd> 이 안내 접기</p>
</div>
<button class="prompt" type="button" data-prompt hidden></button>
<div class="toasts passive"></div>
<div class="stick"><i></i></div>
<div class="levelup passive" data-lvup hidden><i class="spr-enso"></i><b>경지 상승</b><small data-lvtext></small></div>
<div class="death" data-death hidden><div><b>먹에 잠겼다</b><span>마을에서 다시 일어납니다.</span><button type="button" data-respawn>다시 일어나기</button></div></div>
<div class="fade" data-fade><span data-fadetext></span></div>
`;

interface TagSlot { el: HTMLElement; lx: number; ly: number; shown: boolean }
const vProj = new THREE.Vector3();

export class Hud {
  private readonly root: HTMLElement;
  private readonly skillBtns: HTMLElement[] = [];
  private readonly cdEls: HTMLElement[] = [];
  private readonly lockEls: HTMLElement[] = [];
  private readonly cdLast = new Float32Array(5).fill(-1);
  private readonly dmgPool: HTMLElement[] = [];
  private dmgNext = 0;
  private promptText = "";
  private bossShown = false;
  private bossFrac = -1;
  private hpFrac = -1;
  private zoneKey = "";
  private zoneId = "";
  private last: ProfileView | null = null;
  private zoneTimer = 0;
  private helpTimer = 0;
  private readonly tags = new Map<object, TagSlot>();
  private readonly tagBox: HTMLElement;

  constructor(root: HTMLElement, private readonly h: HudHandlers) {
    root.insertAdjacentHTML("beforeend", MARKUP);
    this.root = root;
    this.tagBox = el("[data-tags]", root);
    const arc = el("[data-arc]", root);
    SKILLS.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "ring-btn sk";
      b.type = "button";
      b.dataset.i = String(i);
      b.style.setProperty("--a", `${SKILL_ANGLE[i]}deg`);
      b.setAttribute("aria-label", `${s.name} (${i + 1})`);
      b.innerHTML = `<i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(i)}"></i><i class="cd"></i><kbd>${i + 1}</kbd><b>${s.label}</b><span class="lock" hidden>Lv ${s.unlock}</span>`;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); this.h.skill(i); });
      arc.appendChild(b);
      this.skillBtns.push(b);
      this.cdEls.push(el(".cd", b));
      this.lockEls.push(el(".lock", b));
    });
    const dmgBox = el("[data-dmg]", root);
    for (let i = 0; i < 28; i++) {
      const d = document.createElement("span");
      d.className = "dmg";
      d.addEventListener("animationend", () => d.classList.remove("go"));
      dmgBox.appendChild(d);
      this.dmgPool.push(d);
    }
    el("[data-potion]", root).addEventListener("click", () => this.h.potion());
    el("[data-gear]", root).addEventListener("click", () => this.h.gear());
    el("[data-prompt]", root).addEventListener("click", () => this.h.interact());
    el("[data-respawn]", root).addEventListener("click", () => this.h.respawn());
  }

  setProfile(p: ProfileView): void {
    el("[data-name]", this.root).textContent = p.name || "먹동이";
    el("[data-lv]", this.root).textContent = String(p.level);
    el("[data-scarf]", this.root).style.background = p.dye.scarf != null ? hexCss(p.dye.scarf) : "";
    this.setHp(p.hp, p.maxHp);
    const ef = p.expToNext > 0 ? Math.min(1, p.exp / p.expToNext) : 1;
    el("[data-exp]", this.root).style.setProperty("--f", ef.toFixed(3));
    el("[data-pot]", this.root).textContent = String(p.potions);
    el("[data-pig]", this.root).textContent = fmt(p.pigment);
    el("[data-jade]", this.root).textContent = fmt(p.jade);
    for (let i = 0; i < SKILLS.length; i++) {
      const locked = p.level < SKILLS[i].unlock;
      this.lockEls[i].hidden = !locked;
      this.skillBtns[i].classList.toggle("locked", locked);
    }
    this.setQuest(p);
  }

  setHp(hp: number, max: number): void {
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    if (Math.abs(f - this.hpFrac) < 1e-4) return;
    this.hpFrac = f;
    const fill = el("[data-hp]", this.root);
    fill.style.setProperty("--f", f.toFixed(3));
    fill.parentElement?.classList.toggle("low", f < 0.3);
    el("[data-hpt]", this.root).textContent = `${Math.max(0, Math.round(hp))}`;
  }

  /** The quest hangs on the right edge as a narrow scroll: title, text, progress dots, and who to talk to. */
  private setQuest(p: ProfileView): void {
    this.last = p;
    const box = el("[data-quest]", this.root);
    box.hidden = false;
    const s = mainStatus(p);
    if (!s) {
      box.classList.remove("done", "fresh");
      box.innerHTML = `<div class="paper"><h4>1장을 마쳤다</h4><p>먹노인이 날마다 새 일을 맡깁니다.</p></div>`;
      return;
    }
    const n = Math.min(s.target, 10);
    const filled = s.target <= 10 ? s.prog : Math.floor((s.prog / s.target) * 10);
    let dots = "";
    if (s.accepted && s.q.goal.type !== "talk") for (let i = 0; i < n; i++) dots += `<i class="${i < filled ? "on" : ""}"></i>`;
    const count = !s.accepted ? "" : s.q.goal.type === "kill" ? `<small>${s.prog}/${s.target}</small>` : s.q.goal.type === "level" ? `<small>경지 ${s.prog}/${s.target}</small>` : "";
    const step = nextStep(p, this.zoneId);
    box.classList.toggle("done", s.done);
    box.classList.toggle("fresh", !s.accepted);
    box.innerHTML = `<div class="paper"><h4>${esc(s.q.title)}</h4><p>${esc(s.q.text)}</p>${dots || count ? `<div class="dots" aria-label="${progressText(s)}">${dots}${count}</div>` : ""}${step ? `<p class="step">${esc(step)}</p>` : ""}${s.done ? `<span class="stamp" aria-hidden="true">마침</span>` : ""}</div>`;
  }

  /** Small persistent label; on a new zone the name is painted large down the left side for a moment. */
  setZone(zone: string, channel: number): void {
    const z = ZONES[zone];
    const name = z?.name ?? zone;
    el("[data-zone]", this.root).innerHTML = `${esc(name)} <small>${channel}채널</small>`;
    if (zone !== this.zoneId) { this.zoneId = zone; if (this.last) this.setQuest(this.last); }
    const key = `${zone}:${channel}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    const paint = el("[data-zonepaint]", this.root);
    el("[data-zpname]", this.root).textContent = name;
    el("[data-zpch]", this.root).textContent = `${channel}채널`;
    paint.hidden = false;
    paint.classList.remove("go");
    void paint.offsetWidth;
    paint.classList.add("go");
    window.clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => { paint.hidden = true; }, 2700);
  }

  /** Key help: shown once for new players, then H toggles it. */
  help(show?: boolean, autoHideMs = 0): void {
    const box = el("[data-help]", this.root);
    const on = show ?? box.hidden;
    box.hidden = !on;
    window.clearTimeout(this.helpTimer);
    if (on && autoHideMs > 0) this.helpTimer = window.setTimeout(() => { box.hidden = true; }, autoHideMs);
  }

  /** frac = remaining cooldown 0..1 */
  setCooldown(i: number, frac: number): void {
    const q = Math.round(frac * 40) / 40;
    if (q === this.cdLast[i]) return;
    this.cdLast[i] = q;
    this.cdEls[i].style.setProperty("--cd", String(q));
  }

  prompt(text: string | null): void {
    const p = el("[data-prompt]", this.root);
    const t = text ?? "";
    if (t === this.promptText) return;
    this.promptText = t;
    p.hidden = !text;
    if (text) p.innerHTML = `<i class="spr-stroke" aria-hidden="true"></i><kbd>E</kbd><span>${esc(text)}</span>`;
  }

  boss(name: string | null, frac: number): void {
    const b = el("[data-boss]", this.root);
    if (!name) {
      if (this.bossShown) { b.hidden = true; this.bossShown = false; }
      return;
    }
    if (!this.bossShown) {
      b.hidden = false;
      this.bossShown = true;
      el("[data-bossname]", this.root).textContent = name;
      this.bossFrac = -1;
    }
    if (Math.abs(frac - this.bossFrac) > 1e-3) {
      this.bossFrac = frac;
      el("[data-bosshp]", this.root).style.setProperty("--f", Math.max(0, frac).toFixed(3));
    }
  }

  /* ---------- floating numbers ---------- */
  number(x: number, y: number, z: number, text: string, cls: "" | "kill" | "hurt" | "gain"): void {
    vProj.set(x, y, z).project(camera);
    if (vProj.z > 1) return;
    const d = this.dmgPool[this.dmgNext];
    this.dmgNext = (this.dmgNext + 1) % this.dmgPool.length;
    d.className = cls ? `dmg ${cls}` : "dmg";
    d.textContent = text;
    const sx = (vProj.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 24;
    const sy = (-vProj.y * 0.5 + 0.5) * window.innerHeight;
    d.style.left = `${sx}px`;
    d.style.top = `${sy}px`;
    void d.offsetWidth; // restart the animation on a reused element
    d.classList.add("go");
  }

  /* ---------- name tags (actors, NPCs, portals) ---------- */
  tag(key: object, html: string, cls: string): void {
    let t = this.tags.get(key);
    if (!t) {
      const e = document.createElement("div");
      this.tagBox.appendChild(e);
      t = { el: e, lx: -1e9, ly: -1e9, shown: true };
      this.tags.set(key, t);
    }
    if (t.el.className !== `tag ${cls}`) t.el.className = `tag ${cls}`;
    if (t.el.innerHTML !== html) t.el.innerHTML = html;
  }
  placeTag(key: object, x: number, y: number, z: number): void {
    const t = this.tags.get(key);
    if (!t) return;
    vProj.set(x, y, z).project(camera);
    const vis = vProj.z < 1 && vProj.x > -1.2 && vProj.x < 1.2 && vProj.y > -1.2 && vProj.y < 1.2;
    if (vis !== t.shown) { t.shown = vis; t.el.style.display = vis ? "" : "none"; }
    if (!vis) return;
    const sx = (vProj.x * 0.5 + 0.5) * window.innerWidth, sy = (-vProj.y * 0.5 + 0.5) * window.innerHeight;
    if (Math.abs(sx - t.lx) < 0.4 && Math.abs(sy - t.ly) < 0.4) return;
    t.lx = sx; t.ly = sy;
    t.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }
  dropTag(key: object): void {
    const t = this.tags.get(key);
    if (!t) return;
    t.el.remove();
    this.tags.delete(key);
  }

  /* ---------- big moments ---------- */
  levelUp(level: number, unlocked: string | null): void {
    const box = el("[data-lvup]", this.root);
    el("[data-lvtext]", this.root).textContent = unlocked ? `${level}경지, ${unlocked}을 익혔다` : `${level}경지`;
    box.hidden = false;
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "";
    window.setTimeout(() => { box.hidden = true; }, 2300);
  }

  death(show: boolean, busy = false): void {
    el("[data-death]", this.root).hidden = !show;
    el<HTMLButtonElement>("[data-respawn]", this.root).disabled = busy;
  }

  fade(on: boolean, text = ""): void {
    el("[data-fadetext]", this.root).textContent = text;
    el("[data-fade]", this.root).classList.toggle("on", on);
  }
}
