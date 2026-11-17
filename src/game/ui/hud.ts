// In-game HUD, painted rather than boxed: an ensō portrait with brush-stroke HP/EXP, a bare wallet, a
// hanging-scroll quest strip, a thumb arc of ensō skill rings, a zone name painted in on arrival, name
// tags, pooled damage numbers, boss stroke, level-up, death, fades.
// Per-frame work only touches styles when a value actually changed.

import * as THREE from "three";
import { SKILLS } from "../../shared/combat";
import { ITEM } from "../../shared/items";
import { pointsEarned, pointsSpent } from "../../shared/growth";
import { ZONES } from "../../shared/world";
import type { ProfileView } from "../../net/api";
import { camera } from "../render/gfx";
import { fmt, hexCss } from "../util";
import { chapterOf, mainStatus, npcName, npcZone, objective, progressText } from "../quests";
import { el, esc, skillIconPos } from "./dom";
import { KEYS } from "./input";
import { audio } from "../audio";

export interface HudHandlers {
  potion(): void;
  gear(): void;
  growth(): void;
  auto(): void;
  travel(): void;
  autoSettings(): { skills: boolean[]; potion: boolean; threshold: number; questFirst: boolean };
  saveAutoSettings(): void;
  interact(): void;
  skill(i: number): void;
  respawn(): void;
}

// Bottom-right thumb arc: the basic attack is the big ring at the pivot; skills sit on an arc around it
// (물결 at the left end, 먹 at the top), touch-only jump/dash and the potion gourd on the outer arc.
const SKILL_ANGLE = [180, 157.5, 135, 112.5, 90];
/** HUD color per skill (물결 indigo, 화염 vermilion, 대지 ochre, 바람 pale cyan, 먹 violet-black) */
const SKILL_COLOR = ["#2f4f9e", "#d4462a", "#c08a2a", "#8fc7cf", "#3b2a48"];

const MARKUP = `
<div class="portrait passive" aria-label="나">
  <div class="ring spr-enso"><i class="head"></i><i class="scarf" data-scarf></i></div>
  <b class="lv-seal" data-lv title="경지">1</b>
  <div class="vitals">
    <span class="who" data-name>먹동이</span>
    <div class="hp gauge" title="생명" data-hpbar><i class="track"></i><i class="chip" data-hpchip></i><i class="fill" data-hp></i><span data-hpt></span></div>
    <div class="exp gauge" title="경험" data-expbar><i class="track"></i><i class="fill" data-exp></i></div>
    <span class="zone-mini" data-zone></span>
    <span class="brush-name" data-brush></span>
  </div>
</div>
<div class="purse">
  <span class="ui-later" data-ui="gear" title="안료: 사냥으로 얻는 재화"><i class="spr ic-pigment" aria-hidden="true"></i><b data-pig>0</b></span>
  <span class="ui-later" data-ui="gear" title="묵옥: 뽑기에 쓰는 재화"><i class="spr ic-jade" aria-hidden="true"></i><b data-jade>0</b></span>
  <button class="btn btn-secondary btn-sm snd" type="button" data-sound aria-label="소리 (${KEYS.mute} 음소거)" aria-haspopup="dialog"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path class="snd-w" d="M13 7.2c1.2 1.6 1.2 4 0 5.6M15.2 5.4c2.2 2.7 2.2 6.5 0 9.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="snd-x" d="M13 7.5l4.5 5M17.5 7.5l-4.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  <button class="brush-label btn btn-sm growth ui-later" data-ui="growth" type="button" data-growth><span>수련</span><kbd>${KEYS.growth}</kbd><b class="pts" data-pts hidden></b></button>
  <button class="brush-label btn btn-sm ui-later" data-ui="gear" type="button" data-gear><span>장비</span><kbd>${KEYS.gear}</kbd></button>
</div>
<aside class="jokja" data-quest hidden></aside>
<div class="zone-paint passive" data-zonepaint hidden><b data-zpname></b><span class="seal" data-zpch></span></div>
<div class="bossbar passive" data-boss hidden><b data-bossname></b><div class="hp gauge boss"><i class="track"></i><i class="fill" data-bosshp></i></div></div>
<div class="tags passive" data-tags></div>
<div class="tags passive" data-dmg></div>
<div class="arc" data-arc>
  <button class="ring-btn atk" type="button" data-act="atk" aria-label="베기 (클릭, J)"><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(7)}"></i><b>베기</b><kbd>${KEYS.attack}</kbd></button>
  <button class="ring-btn roll touch" type="button" data-act="dash" style="--a:138deg" aria-label="구르기"><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(8)}"></i><b>구르기</b></button>
  <button class="ring-btn small auto ui-later" data-ui="auto" type="button" data-auto style="--a:168deg" aria-label="자동 사냥 (Z)" aria-pressed="false"><i class="rim spr-enso"></i><i class="auto-brush" aria-hidden="true"></i><b>자동</b><kbd>Z</kbd></button>
  <button class="auto-set btn btn-secondary btn-sm ui-later" data-ui="auto" type="button" data-autoset aria-label="자동 사냥 설정">설정</button>
  <button class="gourd ui-later" data-ui="potion" type="button" data-potion style="--a:135deg" aria-label="물약 마시기 (${KEYS.potion})"><i class="body"></i><b data-pot>0</b><kbd>${KEYS.potion}</kbd></button>
</div>
<div class="keyhelp passive" data-help hidden>
  <p><kbd>WASD</kbd> 걷기 <kbd>Space</kbd>/<kbd>Shift</kbd>/<kbd>우클릭</kbd> 구르기, 구르는 동안은 맞지 않는다</p>
  <p><kbd>클릭</kbd> 베기, 누르고 있으면 이어 베기. 오방 검법은 닿는 적이 있으면 저절로 나간다</p>
  <p><kbd>Z</kbd> 자동 사냥 <kbd>1</kbd> 물약 <kbd>G</kbd> 말 걸기 <kbd>I</kbd> 장비 <kbd>K</kbd> 수련 <kbd>H</kbd> 이 안내 접기</p>
</div>
<button class="prompt btn" type="button" data-prompt hidden></button>
<div class="auto-pop" data-autopop hidden role="dialog" aria-label="자동 사냥 설정"></div>
<div class="auto-pop sound-pop" data-soundpop hidden role="dialog" aria-label="소리"></div>
<div class="toasts passive"></div>
<div class="stick"><i></i></div>
<div class="levelup passive" data-lvup hidden><i class="spr-enso"></i><b>경지 상승</b><small data-lvtext></small></div>
<div class="death" data-death hidden><div><div class="death-title"><b>먹에 잠겼다</b></div><span>마을에서 다시 일어납니다.</span><p class="death-thought" data-death-thought hidden></p><button type="button" class="btn btn-secondary btn-lg" data-respawn>다시 일어나기</button></div></div>
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
  private hpShown = 1;
  private lastExp = -1;
  private lastLevel = 0;
  private zoneKey = "";
  private travelling = false;
  /** quest tracker folded into a chip (phones); decided on first show */
  private questFolded: boolean | null = null;
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
      b.style.setProperty("--skc", SKILL_COLOR[i]);
      b.setAttribute("aria-label", `${s.name} (저절로 나감, 눌러서 바로 쓰기)`);
      b.innerHTML = `<i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(i)}"></i><i class="cd"></i><b>${s.label}</b><span class="sklv" data-sklv>1</span><span class="lock" hidden>Lv ${s.unlock}</span>`;
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
    el("[data-growth]", root).addEventListener("click", () => this.h.growth());
    el("[data-auto]", root).addEventListener("click", () => this.h.auto());
    el("[data-autoset]", root).addEventListener("click", () => this.toggleAutoPop());
    el("[data-sound]", root).addEventListener("click", () => this.toggleSoundPop());
    audio.onChange(() => this.syncSound());
    this.syncSound();
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
    if (this.lastExp >= 0 && (p.exp > this.lastExp || p.level > this.lastLevel)) this.flashClass("[data-expbar]", "gain", 900);
    this.lastExp = p.exp;
    this.lastLevel = p.level;
    el("[data-pot]", this.root).textContent = String(p.potions);
    el("[data-pig]", this.root).textContent = fmt(p.pigment);
    el("[data-jade]", this.root).textContent = fmt(p.jade);
    for (let i = 0; i < SKILLS.length; i++) {
      const locked = p.level < SKILLS[i].unlock;
      const lv = p.skills?.[i] ?? 1;
      const b = this.skillBtns[i];
      this.lockEls[i].hidden = !locked;
      b.classList.toggle("locked", locked);
      b.classList.toggle("aw1", lv >= 5 && lv < 10);
      b.classList.toggle("aw2", lv >= 10);
      el("[data-sklv]", b).textContent = String(lv);
    }
    const w = ITEM[p.equip.weapon];
    const plus = p.enh?.[p.equip.weapon] ?? 0;
    el("[data-brush]", this.root).textContent = w ? `${w.name}${plus > 0 ? ` +${plus}` : ""}` : "";
    const pts = p.points ?? pointsEarned(p.level, p.bonusPoints ?? 0) - pointsSpent(p.skills ?? []);
    const ptsEl = el("[data-pts]", this.root);
    ptsEl.hidden = pts <= 0;
    ptsEl.textContent = String(pts);
    this.setQuest(p);
  }

  setHp(hp: number, max: number): void {
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    if (Math.abs(f - this.hpFrac) < 1e-4) return;
    this.hpFrac = f;
    const fill = el("[data-hp]", this.root);
    if (this.hpFrac >= 0 && f < this.hpShown) this.flashClass("[data-hpbar]", "hit", 200);
    this.hpShown = f;
    fill.style.setProperty("--f", f.toFixed(3));
    // the lost part lingers as a darker chip, then catches up
    el("[data-hpchip]", this.root).style.setProperty("--f", f.toFixed(3));
    fill.parentElement?.classList.toggle("low", f < 0.3);
    el("[data-hpt]", this.root).textContent = `${Math.max(0, Math.round(hp))}`;
  }

  /**
   * Quest tracker: a small framed paper card. Header (chapter + title, a cinnabar check-dab once done), one
   * objective line with its count and a slim gold progress line, a status tag and the 자동 진행 pill.
   * On phones it folds into a one-line chip (tap the header).
   */
  private setQuest(p: ProfileView): void {
    this.last = p;
    const box = el("[data-quest]", this.root);
    box.hidden = false;
    if (this.questFolded === null) this.questFolded = window.matchMedia("(max-width: 520px)").matches;
    box.classList.toggle("folded", this.questFolded);
    const s = mainStatus(p);
    if (!s) {
      box.innerHTML = `<div class="qcard"><header data-qfold><span class="qch">1장</span><h4>1장을 마쳤다</h4></header><div class="qbody"><p class="qobj"><span>먹노인의 날마다 새 일</span></p></div></div>`;
      box.querySelector("[data-qfold]")?.addEventListener("click", () => this.foldQuest());
      return;
    }
    const o = objective(s);
    const ratio = s.target > 0 ? s.prog / s.target : 0;
    const bar = o.count ? `<i class="qbar" aria-hidden="true"><i class="qfill" style="--f:${ratio.toFixed(3)}"></i></i>` : "";
    let tag: string;
    if (!s.accepted) tag = `<span class="qtag new">새 의뢰</span>`;
    else if (s.done || s.q.goal.type === "talk") {
      const z = npcZone(s.q.turnIn);
      tag = `<span class="qtag done">${s.done ? "완료" : "진행 중"} · ${esc(npcName(s.q.turnIn))}${z && z !== this.zoneId ? ` (${esc(ZONES[z].name)})` : ""}</span>`;
    } else tag = `<span class="qtag">진행 중</span>`;
    const state = s.done ? "done" : !s.accepted ? "fresh" : "";
    box.innerHTML = `<div class="qcard ${state}" title="${esc(s.q.text)}">
      <header data-qfold><span class="qch">${chapterOf(s.q.id)}장</span><h4>${esc(s.q.title)}${s.done ? `<i class="qcheck" aria-label="완료"></i>` : ""}</h4>${o.count ? `<small class="qmini">${o.count}</small>` : ""}</header>
      <div class="qbody">
        <p class="qobj" aria-label="${esc(progressText(s))}"><span>${esc(o.text)}</span>${o.count ? `<b>${o.count}</b>` : ""}</p>${bar}
        <footer>${tag}<button type="button" class="qgo btn btn-sm${this.travelling ? " on" : ""}" data-go aria-pressed="${this.travelling}">${this.travelling ? "이동 중" : "자동 진행"}</button></footer>
      </div></div>`;
    box.querySelector("[data-go]")?.addEventListener("click", () => this.h.travel());
    box.querySelector("[data-qfold]")?.addEventListener("click", () => this.foldQuest());
  }

  /** Phones: the tracker folds to a one-line chip and back. */
  private foldQuest(): void {
    if (!window.matchMedia("(max-width: 520px)").matches) return;
    this.questFolded = !this.questFolded;
    el("[data-quest]", this.root).classList.toggle("folded", this.questFolded);
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
    if (text) p.innerHTML = `<kbd>${KEYS.talk}</kbd><span>${esc(text)}</span>`;
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
  number(x: number, y: number, z: number, text: string, cls: "" | "kill" | "hurt" | "gain" | "resist"): void {
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
  /** Restart a one-shot CSS class (hit flash, exp sweep, level burst). */
  private flashClass(sel: string, cls: string, ms: number): void {
    const e = this.root.querySelector<HTMLElement>(sel);
    if (!e) return;
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
    window.setTimeout(() => e.classList.remove(cls), ms);
  }

  levelUp(level: number, unlocked: string | null): void {
    this.flashClass("[data-expbar]", "burst", 1200);
    const box = el("[data-lvup]", this.root);
    el("[data-lvtext]", this.root).textContent = unlocked ? `${level}경지, ${unlocked}을 익혔다` : `${level}경지`;
    box.hidden = false;
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "";
    window.setTimeout(() => { box.hidden = true; }, 2300);
  }

  /** Show a HUD part that was waiting for its moment; `bloom` plays the ink-bloom intro. */
  reveal(part: "growth" | "gear" | "potion" | "auto", bloom: boolean): void {
    this.root.querySelectorAll<HTMLElement>(`[data-ui="${part}"]`).forEach((e) => {
      if (!e.classList.contains("ui-later")) return;
      e.classList.remove("ui-later");
      if (bloom) {
        e.classList.add("ui-bloom");
        window.setTimeout(() => e.classList.remove("ui-bloom"), 1600);
      }
    });
  }

  /** Auto button state; the quest strip shows when auto-travel is under way. */
  setAuto(on: boolean, travelling: boolean): void {
    const b = el("[data-auto]", this.root);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    if (travelling !== this.travelling) {
      this.travelling = travelling;
      if (this.last) this.setQuest(this.last);
    }
  }

  /** The sound settings: master, music, effects, ambience (0–100) and mute; saved and applied live. */
  private toggleSoundPop(): void {
    const pop = el("[data-soundpop]", this.root);
    if (!pop.hidden) { pop.hidden = true; return; }
    el("[data-autopop]", this.root).hidden = true;
    const st = audio.settings;
    const row = (k: "master" | "music" | "sfx" | "amb", label: string) =>
      `<label class="ink-slider"><span>${label}</span><span class="rng" style="--v:${st[k]}"><input type="range" min="0" max="100" step="1" value="${st[k]}" data-vol="${k}" aria-label="${label}"></span><b data-volv="${k}">${st[k]}</b></label>`;
    pop.innerHTML = `<h4>소리</h4>
      ${row("master", "전체")}${row("music", "음악")}${row("sfx", "효과음")}${row("amb", "주변 소리")}
      <label class="ink-check"><input type="checkbox" data-mute ${st.muted ? "checked" : ""}><i aria-hidden="true"></i> 음소거 <kbd>${KEYS.mute}</kbd></label>
      <button type="button" class="close btn btn-secondary btn-sm" data-soundclose>닫기</button>`;
    pop.hidden = false;
    pop.querySelectorAll<HTMLInputElement>("[data-vol]").forEach((r) => r.addEventListener("input", () => {
      const k = r.dataset.vol as "master" | "music" | "sfx" | "amb", v = Number(r.value);
      r.parentElement?.style.setProperty("--v", String(v));
      el(`[data-volv="${k}"]`, pop).textContent = String(v);
      audio.set({ [k]: v });
    }));
    el<HTMLInputElement>("[data-mute]", pop).addEventListener("change", (e) => audio.set({ muted: (e.target as HTMLInputElement).checked }));
    el("[data-soundclose]", pop).addEventListener("click", () => { pop.hidden = true; });
  }

  closeSoundPop(): void {
    el("[data-soundpop]", this.root).hidden = true;
  }

  /** The speaker shows a cross while muted; an open panel follows M. */
  private syncSound(): void {
    el("[data-sound]", this.root).classList.toggle("muted", audio.settings.muted);
    const m = this.root.querySelector<HTMLInputElement>("[data-soundpop] [data-mute]");
    if (m) m.checked = audio.settings.muted;
  }

  private toggleAutoPop(): void {
    const pop = el("[data-autopop]", this.root);
    if (!pop.hidden) { pop.hidden = true; return; }
    this.closeSoundPop();
    const st = this.h.autoSettings();
    pop.innerHTML = `<h4>자동 사냥</h4>
      <div class="auto-skills">${SKILLS.map((sk, i) => `<label><input type="checkbox" data-sk="${i}" ${st.skills[i] ? "checked" : ""}> ${esc(sk.name)}</label>`).join("")}</div>
      <label><input type="checkbox" data-potion-auto ${st.potion ? "checked" : ""}> 생명이 낮으면 물약</label>
      <label class="auto-range ink-slider"><span>기준</span><span class="rng" style="--v:${(Math.round(st.threshold * 100) - 20) * 2.5}"><input type="range" min="20" max="60" step="5" value="${Math.round(st.threshold * 100)}" data-thr aria-label="물약 기준"></span><b data-thrv>${Math.round(st.threshold * 100)}%</b></label>
      <label><input type="checkbox" data-quest-first ${st.questFirst ? "checked" : ""}> 의뢰 대상 먼저</label>
      <button type="button" class="close btn btn-secondary btn-sm" data-popclose>닫기</button>`;
    pop.hidden = false;
    pop.querySelectorAll<HTMLInputElement>("[data-sk]").forEach((c) => c.addEventListener("change", () => { st.skills[Number(c.dataset.sk)] = c.checked; this.h.saveAutoSettings(); }));
    el<HTMLInputElement>("[data-potion-auto]", pop).addEventListener("change", (e) => { st.potion = (e.target as HTMLInputElement).checked; this.h.saveAutoSettings(); });
    el<HTMLInputElement>("[data-quest-first]", pop).addEventListener("change", (e) => { st.questFirst = (e.target as HTMLInputElement).checked; this.h.saveAutoSettings(); });
    el<HTMLInputElement>("[data-thr]", pop).addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      st.threshold = v / 100;
      (e.target as HTMLInputElement).parentElement?.style.setProperty("--v", String((v - 20) * 2.5));
      el("[data-thrv]", pop).textContent = `${v}%`;
      this.h.saveAutoSettings();
    });
    el("[data-popclose]", pop).addEventListener("click", () => { pop.hidden = true; });
  }

  /** A newly learned skill's ring blooms in its color. */
  bloomSkill(i: number): void {
    const b = this.skillBtns[i];
    if (!b) return;
    b.classList.remove("ui-bloom");
    void b.offsetWidth;
    b.classList.add("ui-bloom");
    window.setTimeout(() => b.classList.remove("ui-bloom"), 1800);
  }

  /** One thought under the 다시 일어나기 screen (first death only). */
  deathThought(text: string | null): void {
    const t = el("[data-death-thought]", this.root);
    t.hidden = !text;
    t.textContent = text ?? "";
  }

  death(show: boolean, busy = false): void {
    el("[data-death]", this.root).hidden = !show;
    this.root.classList.toggle("dead", show);
    el<HTMLButtonElement>("[data-respawn]", this.root).disabled = busy;
  }

  fade(on: boolean, text = ""): void {
    el("[data-fadetext]", this.root).textContent = text;
    el("[data-fade]", this.root).classList.toggle("on", on);
  }
}
