// In-game HUD, painted rather than boxed: an ensō portrait with brush-stroke HP/EXP, a bare wallet, a
// hanging-scroll quest strip, a thumb arc of ensō skill rings, a zone name painted in on arrival, name
// tags, pooled damage numbers, boss stroke, level-up, death, fades.
// Per-frame work only touches styles when a value actually changed.

import * as THREE from "three";
import { SKILLS } from "../../shared/combat";
import { ITEM } from "../../shared/items";
import { AWAKENINGS, pointsEarned, pointsSpent, skillCdMul } from "../../shared/growth";
import { cdMulOf } from "../../shared/profile";
import { CHANNEL_CAPACITY, DAILY_QUESTS, ZONES } from "../../shared/world";
import type { ProfileView } from "../../net/api";
import { camera } from "../render/gfx";
import { fmt, hexCss } from "../util";
import { chapterOf, dailyStatus, mainStatus, mainWall, npcName, npcZone, objective, progressText, rewardText, subStatus } from "../quests";
import { RES, bindSliders, el, esc, resIcon, skillIconPos, type ResKind } from "./dom";
import { KEYS } from "./input";
import { audio } from "../audio";
import { roundDist, type QuestNav } from "../questnav";
import { gameSettings, onSlider, potionSlider } from "./settings";
import { toast as toastLine } from "./dom";

export interface HudHandlers {
  potion(): void;
  gear(): void;
  growth(): void;
  album(): void;
  /** pay every finished daily quest */
  claimDaily(): void;
  /** players per channel of this zone, and yours */
  channels(): Promise<{ current: number; players: number[] } | null>;
  /** move to another channel of this zone */
  changeChannel(channel: number): void;
  /** leave 추억 속 풍경 */
  exitMemory(): void;
  auto(): void;
  travel(): void;
  /** 자동 진행 on one daily quest (tapped in the tracker) */
  travelDaily(i: number): void;
  /** 자동 진행 on the 서브 퀘스트 */
  travelSub(): void;
  /** hand in the finished 서브 퀘스트 */
  claimSub(): void;
  autoSettings(): { skills: boolean[]; potion: boolean; threshold: number; questFirst: boolean };
  saveAutoSettings(): void;
  interact(): void;
  skill(i: number): void;
  respawn(): void;
  /** the settings menu, optionally on one tab */
  settings(tab?: string): void;
  /** open the chat input (mobile 말 button) */
  chat(): void;
}

// Bottom-right thumb arc: the basic attack is the big ring at the pivot; skills sit on an arc around it
// (물결 at the left end, 먹 at the top), touch-only jump/dash and the potion gourd on the outer arc.
const SKILL_ANGLE = [180, 157.5, 135, 112.5, 90];
const QSTATE = { "": "", fight: "전투 중", travel: "이동 중", auto: "자동 사냥 중" } as const;
/** HUD color per skill (물결 indigo, 화염 vermilion, 대지 ochre, 바람 pale cyan, 먹 violet-black) */
const SKILL_COLOR = ["#2f4f9e", "#d4462a", "#c08a2a", "#8fc7cf", "#3b2a48"];

const MARKUP = `
<div class="portrait passive" aria-label="나" data-portrait data-tip-title="나" data-tip="">
  <i class="face" data-face aria-hidden="true"></i>
  <div class="ring spr-enso"><i class="head"></i><i class="scarf" data-scarf></i></div>
  <div class="vitals">
    <span class="who"><span data-name>나그네</span><b class="lv-seal" data-lv title="레벨">1</b></span>
    <div class="hp gauge" title="생명" data-hpbar><i class="track"></i><i class="chip" data-hpchip></i><i class="fill" data-hp></i><span data-hpt></span></div>
    <div class="exp gauge" title="경험" data-expbar><i class="track"></i><i class="fill" data-exp></i></div>
    <button type="button" class="zone-mini" data-zone data-tip-title="채널" data-tip="눌러서 채널을 고른다. 서 있던 자리 그대로 옮긴다."></button>
    <span class="brush-name" data-brush></span>
  </div>
</div>
<div class="purse">
  <span class="ui-later" data-ui="gear" data-tip-title="안료" data-tip="사냥으로 얻는 재화. 수련, 염색, 물약에 쓴다."><i class="spr ic-pigment" aria-hidden="true"></i><b data-pig>0</b></span>
  <span class="ui-later" data-ui="gear" data-tip-title="묵옥" data-tip="뽑기와 파괴방지권에 쓰는 귀한 옥. 광고 보상, 보스, 상점에서 얻는다."><i class="spr ic-jade" aria-hidden="true"></i><b data-jade>0</b></span>
  <button class="btn btn-secondary btn-sm snd" type="button" data-sound aria-label="소리 설정 (${KEYS.mute} 음소거)" data-tip-title="소리" data-tip="음량 조절. ${KEYS.mute} 키로 끄고 켠다."><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path class="snd-w" d="M13 7.2c1.2 1.6 1.2 4 0 5.6M15.2 5.4c2.2 2.7 2.2 6.5 0 9.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="snd-x" d="M13 7.5l4.5 5M17.5 7.5l-4.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  <button class="btn btn-secondary btn-sm snd" type="button" data-settings aria-label="설정 (Esc)" data-tip-title="설정 (Esc)" data-tip="소리, 그래픽, 조작, 게임 설정."><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.6l1.3 2.1 2.4-.6.6 2.4 2.1 1.3-1.2 2.2 1.2 2.2-2.1 1.3-.6 2.4-2.4-.6L10 17.4l-1.3-2.1-2.4.6-.6-2.4-2.1-1.3L4.8 10 3.6 7.8l2.1-1.3.6-2.4 2.4.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.4" fill="currentColor"/></svg></button>
  <i class="purse-break" aria-hidden="true"></i>
  <button class="brush-label btn btn-sm growth ui-later" data-ui="growth" type="button" data-growth data-tip-title="수련 (${KEYS.growth})" data-tip="검법 단련과 붓 강화. 붉은 숫자는 남은 수련 포인트."><i class="hud-ic" style="--c:0" aria-hidden="true"></i><span>수련</span><kbd>${KEYS.growth}</kbd><b class="pts" data-pts hidden></b></button>
  <button class="brush-label btn btn-sm ui-later" data-ui="gear" type="button" data-gear data-tip-title="장비 (${KEYS.gear})" data-tip="붓, 머리, 띠를 바꿔 낀다."><i class="hud-ic" style="--c:1" aria-hidden="true"></i><span>장비</span><kbd>${KEYS.gear}</kbd></button>
  <button class="brush-label btn btn-sm ui-later" data-ui="album" type="button" data-album data-tip-title="화첩 (${KEYS.album})" data-tip="벤 몬스터와 보스를 벤 순간 돌아온 색을 그림으로 모아 둔다."><i class="hud-ic" style="--c:2" aria-hidden="true"></i><span>화첩</span><kbd>${KEYS.album}</kbd></button>
</div>
<aside class="jokja" data-quest hidden></aside>
<div class="memory-bar" data-memory hidden><div class="mb-t"><b data-memory-t></b><small data-memory-p></small></div><button class="btn btn-sm" type="button" data-memory-exit>돌아가기<kbd>Esc</kbd></button></div>
<div class="zone-paint passive" data-zonepaint hidden><b data-zpname></b><span class="seal" data-zpch></span></div>
<div class="bossbar passive" data-boss hidden><b data-bossname></b><div class="hp gauge boss"><i class="track"></i><i class="fill" data-bosshp></i></div></div>
<div class="tags passive" data-tags></div>
<div class="tags passive" data-dmg></div>
<div class="arc" data-arc>
  <button class="ring-btn atk" type="button" data-act="atk" aria-label="베기 (클릭, J)" data-tip-title="베기 (클릭 · J)" data-tip="누르고 있으면 이어 벤다."><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(7)}"></i><b>베기</b><kbd>${KEYS.attack}</kbd></button>
  <button class="ring-btn roll touch" type="button" data-act="dash" style="--a:138deg" aria-label="구르기" data-tip-title="구르기 (Space)" data-tip="구르는 동안은 맞지 않는다."><i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(8)}"></i><b>구르기</b></button>
  <button class="ring-btn small auto ui-later" data-ui="auto" type="button" data-auto style="--a:168deg" aria-label="자동 진행 (Z)" aria-pressed="false" data-tip-title="자동 진행 (Z)" data-tip="의뢰를 받고, 사냥하고, 보고하러 저절로 간다. 갈 곳이 없으면 그 자리에서 사냥한다. 검법도 저절로 쓴다."><i class="rim spr-enso"></i><i class="auto-brush" aria-hidden="true"></i><b>자동</b></button>
  <button class="auto-set btn btn-secondary btn-sm ui-later" data-ui="auto" type="button" data-autoset aria-label="자동 사냥 설정" data-tip-title="자동 사냥 설정" data-tip="쓸 검법, 물약 기준, 의뢰 대상 먼저.">설정</button>
  <button class="gourd ui-later" data-ui="potion" type="button" data-potion style="--a:135deg" aria-label="물약 마시기 (${KEYS.potion})" data-tip-title="물약 마시기 (${KEYS.potion})" data-tip="길게 누르면 자동 사용 켜기/끄기" data-tip-touch="off"><i class="body"></i><b data-pot>0</b><kbd>${KEYS.potion}</kbd></button>
</div>
<div class="keyhelp passive" data-help hidden>
  <p><kbd>WASD</kbd> 걷기 <kbd>Space</kbd>/<kbd>Shift</kbd>/<kbd>우클릭</kbd> 구르기, 구르는 동안은 맞지 않는다</p>
  <p><kbd>클릭</kbd> 베기, 누르고 있으면 이어 베기. <kbd>1</kbd>–<kbd>5</kbd> 오방 검법 (가까운 적에게), 자동 사냥 중엔 저절로</p>
  <p><kbd>Z</kbd> 자동 진행 <kbd>Q</kbd> 물약 <kbd>G</kbd> 말 걸기 <kbd>I</kbd> 장비 <kbd>K</kbd> 수련 <kbd>H</kbd> 이 안내 접기</p>
  <p><kbd>Enter</kbd> 채팅 <kbd>M</kbd> 소리 끄기 <kbd>Esc</kbd> 설정</p>
</div>
<button class="prompt btn" type="button" data-prompt hidden></button>
<div class="auto-pop" data-autopop hidden role="dialog" aria-label="자동 사냥 설정"></div>
<div class="auto-pop channel-pop" data-chpop hidden role="dialog" aria-label="채널"></div>
<div class="reward-show passive" data-reward hidden aria-live="polite"></div>
<button class="btn btn-secondary btn-sm chat-btn touch" type="button" data-chatbtn aria-label="채팅" data-tip-title="채팅 (Enter)" data-tip="같은 채널 사람들과 말한다.">채팅</button>
<div class="toasts passive"></div>
<div class="stick"><i></i></div>
<div class="levelup passive" data-lvup hidden><i class="spr-enso"></i><b>경지 상승</b><small data-lvtext></small></div>
<div class="ink-death" data-death hidden aria-live="assertive">
  <i class="ink-death-bleed" aria-hidden="true"></i>
  <div class="ink-death-words">
    <h2 class="ink-death-ins" aria-label="먹에 잠겼다"><span style="--i:0">먹</span><span style="--i:1">에</span><span class="gap" style="--i:2"></span><span style="--i:3">잠</span><span style="--i:4">겼</span><span style="--i:5">다</span></h2>
    <div class="ink-death-side"><p class="ink-death-cause" data-death-cause></p><p class="ink-death-thought" data-death-thought hidden></p></div>
  </div>
  <div class="ink-death-rise" data-respawn role="button" tabindex="0" aria-label="다시 일어나기: 누르고 있기">
    <div class="enso-load" data-rise-enso><i class="bloom" aria-hidden="true"></i><i class="ring-track" aria-hidden="true"></i><i class="ring" aria-hidden="true"></i><i class="seam" aria-hidden="true"></i><i class="head" aria-hidden="true"></i></div>
    <small>누르고 있으면 다시 일어난다</small>
  </div>
</div>
<div class="fade" data-fade><span data-fadetext></span></div>
`;

interface TagSlot { el: HTMLElement; lx: number; ly: number; shown: boolean; w: number; h: number; rank: number; dim: boolean }
/** which name wins when two overlap (lower = kept clear); speech bubbles never dim */
const TAG_RANK: Record<string, number> = { me: 0, npc: 1, elite: 2, portal: 3, pc: 4 };
const tagOrder: TagSlot[] = [];
const vProj = new THREE.Vector3();

export class Hud {
  private readonly root: HTMLElement;
  private readonly skillBtns: HTMLElement[] = [];
  private readonly cdEls: HTMLElement[] = [];
  private readonly lockEls: HTMLElement[] = [];
  private readonly cdLast = new Float32Array(5).fill(-1);
  private readonly cdsLast = new Int16Array(5).fill(-1);
  private readonly cdsEls: HTMLElement[] = [];
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
  /** re-measures the top-right row and the thumb arc (parts appear over time) */
  private relayout: () => void = () => {};
  /** what 자동 진행 is on: -1 the main quest, a daily's index, -3 the 서브 퀘스트, -2 nothing */
  private autoFocus = -2;
  /** 데미지 숫자 (settings) */
  showDmg = true;
  /** speech bubbles over heads: owner → its own tag entry and when it goes */
  private readonly says = new Map<object, { key: object; until: number }>();
  /** the quest's distance line ("먹노인 · 12m") and the card's state tag (전투 중 / 이동 중 / 자동 사냥 중) */
  private qdist = "";
  private qState: "" | "fight" | "travel" | "auto" = "";
  private navWho = "";
  private navVia = "";
  private navZone = "";
  private navD = -1;
  /** the pointer rests on 자동 진행 (route preview) */
  goHover = false;
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
      b.setAttribute("aria-label", `${s.name} (${i + 1})`);
      b.dataset.tipTitle = `${s.name} (${i + 1})`;
      b.innerHTML = `<i class="rim spr-enso"></i><i class="spr ic-sk" style="background-position:${skillIconPos(i)}"></i><i class="cd"></i><span class="cds" aria-hidden="true"></span><b>${s.label}</b><kbd>${i + 1}</kbd><span class="sklv" data-sklv>1</span><span class="lock" hidden>Lv ${s.unlock}</span>`;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); this.h.skill(i); });
      arc.appendChild(b);
      this.skillBtns.push(b);
      this.cdEls.push(el(".cd", b));
      this.cdsEls.push(el(".cds", b));
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
    this.wireGourd(el("[data-potion]", root));
    // the quest card hangs just under the top-right row (its height changes as menu icons appear, and by screen size)
    const purse = root.querySelector<HTMLElement>(".purse");
    if (purse && typeof ResizeObserver !== "undefined") {
      const portrait = root.querySelector<HTMLElement>(".portrait");
      const place = () => {
        root.style.setProperty("--purse-b", `${Math.ceil(purse.getBoundingClientRect().bottom)}px`);
        if (portrait) root.style.setProperty("--portrait-b", `${Math.ceil(portrait.getBoundingClientRect().bottom)}px`);
        // the top of the thumb arc (its highest visible button): the tracker stops above it
        let top = window.innerHeight;
        root.querySelectorAll<HTMLElement>("[data-arc] > *").forEach((b) => { const r = b.getBoundingClientRect(); if (r.height > 0 && r.right > window.innerWidth * 0.55) top = Math.min(top, r.top); });
        root.style.setProperty("--arc-top", `${Math.floor(top)}px`);
      };
      window.setTimeout(place, 0);
      this.relayout = place;
      new ResizeObserver(place).observe(purse);
      if (portrait) new ResizeObserver(place).observe(portrait);
      window.addEventListener("resize", place);
    }
    el("[data-gear]", root).addEventListener("click", () => this.h.gear());
    el("[data-growth]", root).addEventListener("click", () => this.h.growth());
    el("[data-album]", root).addEventListener("click", () => this.h.album());
    el("[data-memory-exit]", root).addEventListener("click", () => this.h.exitMemory());
    // the daily card is rebuilt often; one delegated listener on its box
    el("[data-quest]", root).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-claim-daily]");
      if (!b || b.disabled) return;
      e.stopPropagation();
      b.disabled = true;
      this.h.claimDaily();
    });
    el("[data-auto]", root).addEventListener("click", () => this.h.auto());
    el("[data-autoset]", root).addEventListener("click", () => this.toggleAutoPop());
    el("[data-zone]", root).addEventListener("click", (e) => { e.stopPropagation(); void this.toggleChannels(); });
    el("[data-chpop]", root).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ch]");
      if (b && !b.disabled) { this.closeChannels(); this.h.changeChannel(Number(b.dataset.ch)); return; }
      if ((e.target as HTMLElement).closest("[data-chclose]")) this.closeChannels();
    });
    el("[data-sound]", root).addEventListener("click", () => this.h.settings("sound"));
    el("[data-settings]", root).addEventListener("click", () => this.h.settings());
    el("[data-chatbtn]", root).addEventListener("click", () => this.h.chat());
    audio.onChange(() => this.syncSound());
    this.syncSound();
    el("[data-prompt]", root).addEventListener("click", () => this.h.interact());
    this.wireRise();
    gameSettings.onChange(() => this.gourdTip());
  }

  /** 추억 속 풍경: a title bar with the way back; the quest card, purse and skills step aside. */
  setMemory(title: string | null, place = ""): void {
    const bar = el("[data-memory]", this.root);
    bar.hidden = title === null;
    this.root.classList.toggle("in-memory", title !== null);
    if (title === null) return;
    el("[data-memory-t]", bar).textContent = title;
    el("[data-memory-p]", bar).textContent = `${place} · 기억 속 풍경`;
  }

  /** Your own figure in the ensō (replaces the drawn head once the in-engine cutout exists). */
  setFace(url: string): void {
    const f = el("[data-face]", this.root);
    if (f.dataset.url === url) return;
    f.dataset.url = url;
    f.style.backgroundImage = `url("${url}")`;
    el("[data-portrait]", this.root).classList.add("has-face");
  }

  setProfile(p: ProfileView): void {
    el("[data-name]", this.root).textContent = p.name || "나그네";
    el("[data-lv]", this.root).textContent = String(p.level);
    el("[data-scarf]", this.root).style.background = p.dye.scarf != null ? hexCss(p.dye.scarf) : "";
    this.setHp(p.hp, p.maxHp);
    const ef = p.expToNext > 0 ? Math.min(1, p.exp / p.expToNext) : 1;
    el("[data-exp]", this.root).style.setProperty("--f", ef.toFixed(3));
    if (this.lastExp >= 0 && (p.exp > this.lastExp || p.level > this.lastLevel)) this.flashClass("[data-expbar]", "gain", 900);
    this.lastExp = p.exp;
    this.lastLevel = p.level;
    el("[data-pot]", this.root).textContent = String(p.potions);
    // no potions: the gourd greys out and its 자동 enso goes (nothing to drink)
    el("[data-potion]", this.root).classList.toggle("empty", p.potions <= 0);
    el("[data-pig]", this.root).textContent = fmt(p.pigment);
    el("[data-jade]", this.root).textContent = fmt(p.jade);
    // of the skills still locked, only the next to open shows (dimmed, with its level); the rest appear as they open
    let next = Infinity;
    for (const sk of SKILLS) if (p.level < sk.unlock) next = Math.min(next, sk.unlock);
    for (let i = 0; i < SKILLS.length; i++) {
      const locked = p.level < SKILLS[i].unlock;
      this.skillBtns[i].classList.toggle("later", locked && SKILLS[i].unlock > next);
      const lv = p.skills?.[i] ?? 1;
      const b = this.skillBtns[i];
      this.lockEls[i].hidden = !locked;
      b.classList.toggle("locked", locked);
      b.classList.toggle("aw1", lv >= 5 && lv < 10);
      b.classList.toggle("aw2", lv >= 10);
      const lvEl = el("[data-sklv]", b);
      lvEl.textContent = String(lv);
      lvEl.toggleAttribute("data-lv1", lv <= 1); // a level-1 badge says nothing; show it once trained
      const sk = SKILLS[i];
      const aw = lv >= 10 ? AWAKENINGS[i][10] : lv >= 5 ? AWAKENINGS[i][5] : null;
      b.dataset.tip = locked ? `Lv ${sk.unlock}에 열림 · 재사용 ${sk.cd}초`
        : `Lv ${lv} · 재사용 ${+(sk.cd * skillCdMul(lv) * cdMulOf(p)).toFixed(1)}초 · 자동 사냥 중엔 저절로 쓴다${aw ? `
각성: ${aw.text}` : ""}`;
    }
    this.last = p;
    this.gourdTip();
    this.portraitTip();
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
    this.tipHp = Math.max(0, Math.round(hp));
    this.tipMax = max;
    this.portraitTip();
  }

  /* ---------- tooltips with live numbers (tooltip.ts reads the attributes when it opens) ---------- */
  private tipHp = 0;
  private tipMax = 0;
  private portraitTip(): void {
    const p = this.last;
    const box = this.root.querySelector<HTMLElement>("[data-portrait]");
    if (!box || !p) return;
    box.dataset.tipTitle = `${p.name || "나그네"} · Lv ${p.level}`;
    box.dataset.tip = `생명 ${this.tipHp} / ${this.tipMax || p.maxHp}
경험 ${p.exp.toLocaleString("ko-KR")} / ${p.expToNext.toLocaleString("ko-KR")}`;
  }
  private gourdTip(): void {
    const g = this.root.querySelector<HTMLElement>("[data-potion]");
    if (!g || !this.last) return;
    const s = gameSettings.v;
    g.dataset.tip = `길게 누르면 자동 사용 켜기/끄기
남은 물약 ${this.last.potions}개 · 자동 사용 ${s.autoPotion ? `켜짐 (생명 ${Math.round(s.potionAt * 100)}% 아래)` : "꺼짐"}`;
  }

  /**
   * Quest tracker: a small framed paper card. Header (chapter + title, a cinnabar check-dab once done), one
   * objective line with its count and a slim gold progress line, a status tag and the 자동 진행 pill.
   * On phones it folds into a one-line chip (tap the header).
   */
  /**
   * The quest tracker: one panel, scrolled, the main quest on top in cinnabar (it is the story), today's quests
   * under it. Tapping a quest starts 자동 진행 on it (again: stop). When the main quest is walled by 경지, it says so
   * and points at today's quests, which light up: strengthen there first, then come back.
   */
  private setQuest(p: ProfileView): void {
    this.last = p;
    const box = el("[data-quest]", this.root);
    box.hidden = false;
    if (this.questFolded === null) this.questFolded = window.matchMedia("(max-width: 520px)").matches;
    box.classList.toggle("folded", this.questFolded);
    const s = mainStatus(p);
    const wall = mainWall(p);
    let main: string;
    if (!s) {
      main = `<div class="qcard qmain"><header><span class="qch">본편</span><h4>이야기를 다 따라왔다</h4><button type="button" class="qfold" data-qfold aria-label="접기/펴기"></button></header><div class="qbody"><p class="qobj"><span>다음 장을 기다리는 동안 오늘의 의뢰를</span></p></div></div>`;
    } else {
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
      const going = this.travelling && this.autoFocus === -1;
      const wallLine = wall ? `<p class="qwall"><b>막힘</b> 경지 ${wall}이 필요하다 · 아래 서브·오늘의 의뢰로 강해지자</p>` : "";
      main = `<div class="qcard qmain ${state}${going ? " going" : ""}${wall ? " walled" : ""}" data-go role="button" tabindex="0" aria-pressed="${going}" data-tip-title="${going ? "자동 진행 중 · 누르면 멈춘다" : "본편 · 누르면 자동 진행 (Z)"}" data-tip="${esc(s.q.text)}">
      <header><span class="qch">본편 ${chapterOf(s.q.id)}장</span><h4>${esc(s.q.title)}${s.done ? `<i class="qcheck" aria-label="완료"></i>` : ""}</h4>${o.count ? `<small class="qmini">${o.count}</small>` : ""}<small class="qmini qdist-mini" data-qdist>${esc(this.qdist)}</small><button type="button" class="qfold" data-qfold aria-label="접기/펴기"></button></header>
      <div class="qbody">
        <p class="qobj" aria-label="${esc(progressText(s))}"><span>${esc(o.text)}</span>${o.count ? `<b>${o.count}</b>` : ""}</p>${bar}
        ${wallLine}<small class="qdist" data-qdist>${esc(this.qdist)}</small>
        <footer><span class="qstate" data-qstate>${QSTATE[this.qState]}</span>${tag}</footer>
      </div></div>`;
    }
    box.innerHTML = `<div class="qpanel${wall ? " walled" : ""}"><div class="qscroll">${main}${this.subRow(p, !!wall)}${this.dailyCard(p, !!wall)}</div></div>`;
    this.relayout();
    // more below than fits: the bottom fades (no scrollbar), until scrolled to the end
    const qs = box.querySelector<HTMLElement>(".qscroll"), qp = box.querySelector<HTMLElement>(".qpanel");
    if (qs && qp) {
      const fade = () => qp.classList.toggle("long", qs.scrollHeight - qs.scrollTop - qs.clientHeight > 4);
      requestAnimationFrame(fade);
      qs.addEventListener("scroll", fade, { passive: true });
    }
    const card = box.querySelector<HTMLElement>("[data-go]");
    card?.addEventListener("click", () => this.h.travel());
    card?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.h.travel(); } });
    box.querySelectorAll<HTMLElement>("[data-sub]").forEach((li) => {
      const go = () => (li.dataset.sub === "done" ? this.h.claimSub() : this.h.travelSub());
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    box.querySelectorAll<HTMLElement>("[data-daily]").forEach((li) => {
      const go = () => this.h.travelDaily(Number(li.dataset.daily));
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    box.querySelector("[data-qfold]")?.addEventListener("click", (e) => { e.stopPropagation(); this.foldQuest(); });
    box.dataset.state = this.qState;
  }

  /** ~4 Hz: is the pointer resting on the quest card (자동 진행)? (survives the card's re-renders) */
  refreshHover(): void {
    this.goHover = !!this.root.querySelector("[data-go]:hover");
  }

  /** ~4 Hz: the distance line. Text is rebuilt only when what it says changes. */
  setQuestNav(nav: QuestNav): void {
    const d = nav.ok ? roundDist(nav.dist) : -1;
    if (d === this.navD && nav.who === this.navWho && nav.via === this.navVia && nav.zone === this.navZone) return;
    this.navD = d; this.navWho = nav.who; this.navVia = nav.via; this.navZone = nav.zone;
    if (d < 0) this.qdist = "";
    else if (nav.zone === this.zoneId) this.qdist = `${nav.who} · ${d}m`;
    else this.qdist = `${nav.via ? `${nav.via} 경유` : ZONES[nav.zone]?.name ?? nav.zone} · 약 ${d}m`;
    this.root.querySelectorAll("[data-qdist]").forEach((e) => { e.textContent = this.qdist; });
  }

  /** The card's state: 전투 중 > 이동 중 > 자동 사냥 중 > the quest's own status. */
  setQuestState(s: "" | "fight" | "travel" | "auto"): void {
    if (s === this.qState) return;
    this.qState = s;
    const box = el("[data-quest]", this.root);
    box.dataset.state = s;
    const t = box.querySelector("[data-qstate]");
    if (t) t.textContent = QSTATE[s];
  }

  /** The day's quests that are still open, under the main card: title + progress, or who to report to. */
  /** The 서브 퀘스트 (지역 의뢰) as one line: a 서브 tag, the title, the count (받기 once done). */
  private subRow(p: ProfileView, walled: boolean): string {
    const s = subStatus(p);
    if (!s) return "";
    const going = this.travelling && this.autoFocus === -3;
    const tip = s.done ? `data-tip-title="보상 받기" data-tip="보상 · ${esc(rewardText(s.q))}"` : `data-tip-title="${going ? "자동 진행 중 · 누르면 멈춘다" : "서브 · 누르면 자동 진행"}" data-tip="${esc(s.q.text)}\n${esc(npcName(s.q.giver))}의 의뢰 · 끝내면 다음 의뢰가 이어진다."`;
    return `<ul class="qcard daily qdaily qsub${walled ? " lit" : ""}"><li class="${s.done ? "done" : ""}${going ? " going" : ""}" data-sub="${s.done ? "done" : "go"}" role="button" tabindex="0" ${tip}><i class="qd-tag sub">서브</i><span>${esc(s.q.title)}</span>${s.done ? `<b class="qd-get">받기</b>` : `<b>${s.prog}/${s.target}</b>`}</li></ul>`;
  }

  /**
   * A reward shown where you look, with no panel: what it was for in brush letters, then each thing gained as its
   * picture and amount, rising and fading over a couple of seconds.
   */
  reward(title: string, r: { exp?: number; pigment?: number; jade?: number; stones?: number; shards?: number; potions?: number; protects?: number; points?: number }, quote?: { who: string; text: string }): void {
    // a level-up banner takes the same spot: the reward waits until it has gone
    const wait = this.levelUntil - performance.now();
    if (wait > 0) { window.setTimeout(() => this.reward(title, r, quote), wait); return; }
    const map: [keyof typeof r, ResKind][] = [["exp", "exp"], ["pigment", "pigment"], ["jade", "jade"], ["stones", "stone"], ["shards", "shard"], ["potions", "potion"], ["protects", "protect"], ["points", "points"]];
    const items = map.filter(([k]) => (r[k] ?? 0) > 0).map(([k, kind], i) => `<span class="rw-item" style="--i:${i}">${resIcon(kind, "l")}<b>+${(r[k] ?? 0).toLocaleString("ko-KR")}</b><small>${esc(RES[kind].name)}</small></span>`).join("");
    if (!items) return;
    const box = el("[data-reward]", this.root);
    box.innerHTML = `<p class="rw-title">${esc(title)}</p><div class="rw-items">${items}</div>${quote ? `<p class="rw-quote"><b>${esc(quote.who)}</b> ${esc(quote.text)}</p>` : ""}`;
    box.hidden = false;
    box.classList.remove("go");
    void box.offsetWidth;
    box.classList.add("go");
    window.clearTimeout(this.rewardTimer);
    this.rewardTimer = window.setTimeout(() => { box.hidden = true; }, quote ? 3400 : 2800);
  }
  private rewardTimer = 0;

  /**
   * Today's quests as compact one-line rows under 본편 (like most mobile MMOs' trackers): a small 일일 tag, the
   * title, the count. A finished one turns into 받기 and is paid on a tap; an unfinished one starts 자동 진행 on it.
   */
  private dailyCard(p: ProfileView, walled = false): string {
    const rewardLine = (q: (typeof DAILY_QUESTS)[number]) => `보상 · ${rewardText(q)}`;
    let rows = "";
    for (let i = 0; i < DAILY_QUESTS.length; i++) {
      const d = dailyStatus(p, i);
      if (d.claimed) continue;
      const going = this.travelling && this.autoFocus === i;
      const tip = d.done ? `data-tip-title="보상 받기" data-tip="${esc(rewardLine(d.q))}"` : `data-tip-title="${going ? "자동 진행 중 · 누르면 멈춘다" : "누르면 자동 진행"}" data-tip="${esc(d.q.text)}"`;
      rows += `<li class="${d.done ? "done" : ""}${going ? " going" : ""}" ${d.done ? "data-claim-daily" : `data-daily="${i}"`} role="button" tabindex="0" ${tip}><i class="qd-tag">일일</i><span>${esc(d.q.title)}</span>${d.done ? `<b class="qd-get">받기</b>` : `<b>${d.prog}/${d.target}</b>`}</li>`;
    }
    return rows ? `<ul class="qcard daily qdaily${walled ? " lit" : ""}">${rows}</ul>` : "";
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

  /** frac = remaining cooldown 0..1; secs = seconds left, shown whole in the middle of the ring while cooling */
  setCooldown(i: number, frac: number, secs = 0): void {
    const s = secs > 0 ? Math.ceil(secs) : 0;
    if (s !== this.cdsLast[i]) {
      this.cdsLast[i] = s;
      this.cdsEls[i].textContent = s > 0 ? String(s) : "";
    }
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
    if (!this.showDmg && (cls === "" || cls === "kill" || cls === "hurt")) return;
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
      t = { el: e, lx: -1e9, ly: -1e9, shown: true, w: 0, h: 0, rank: 9, dim: false };
      this.tags.set(key, t);
    }
    if (t.el.className.replace(" dim", "") !== `tag ${cls}`) { t.el.className = `tag ${cls}`; t.dim = false; t.w = 0; }
    t.rank = TAG_RANK[cls.split(" ")[0]] ?? 9;
    if (t.el.innerHTML !== html) { t.el.innerHTML = html; t.w = 0; }
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
  /**
   * After every tag is placed this frame: where two names overlap on screen, the less important one goes faint
   * (it stays where it is; moving it would make names hop as people walk). Sizes are measured once per text.
   */
  fadeOverlaps(): void {
    tagOrder.length = 0;
    for (const t of this.tags.values()) {
      if (!t.shown || t.rank > 4) continue;
      if (t.w === 0) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
      tagOrder.push(t);
    }
    tagOrder.sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < tagOrder.length; i++) {
      const t = tagOrder[i];
      let hidden = false;
      for (let j = 0; j < i && !hidden; j++) {
        const o = tagOrder[j];
        if (o.dim) continue;
        hidden = Math.abs(t.lx - o.lx) * 2 < (t.w + o.w) * 0.9 && t.ly > o.ly - o.h * 0.9 && o.ly > t.ly - t.h * 0.9;
      }
      if (hidden !== t.dim) { t.dim = hidden; t.el.classList.toggle("dim", hidden); }
    }
  }

  /** A speech bubble over `owner`'s head for 4 s (placed by placeSay each frame). */
  say(owner: object, text: string): void {
    let s = this.says.get(owner);
    if (!s) { s = { key: {}, until: 0 }; this.says.set(owner, s); }
    s.until = performance.now() + 4000;
    this.tag(s.key, esc(text), "say");
  }
  placeSay(owner: object, x: number, y: number, z: number): void {
    const s = this.says.get(owner);
    if (!s) return;
    if (performance.now() > s.until) { this.dropTag(s.key); this.says.delete(owner); return; }
    this.placeTag(s.key, x, y, z);
  }
  /** Room change: every bubble goes. */
  clearSays(): void {
    for (const s of this.says.values()) this.dropTag(s.key);
    this.says.clear();
  }

  dropSay(owner: object): void {
    const s = this.says.get(owner);
    if (s) { this.dropTag(s.key); this.says.delete(owner); }
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

  /** when the level-up banner is gone (a reward shown meanwhile waits for it) */
  private levelUntil = 0;
  levelUp(level: number, unlocked: string | null): void {
    this.levelUntil = performance.now() + 2200;
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
  /** The gourd flashes once: a potion was just drunk on its own (물약 자동 사용). */
  potionPing(): void {
    const g = this.root.querySelector<HTMLElement>("[data-potion]");
    if (!g) return;
    g.classList.remove("ping");
    void g.offsetWidth;
    g.classList.add("ping");
  }

  reveal(part: "growth" | "gear" | "potion" | "auto" | "album", bloom: boolean): void {
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
  setAuto(on: boolean, travelling: boolean, focus = -2): void {
    const b = el("[data-auto]", this.root);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    if (travelling !== this.travelling || focus !== this.autoFocus) {
      this.travelling = travelling;
      this.autoFocus = focus;
      if (this.last) this.setQuest(this.last);
    }
  }

  /** The gourd: tap to drink; hold (~0.55 s) to switch 물약 자동 사용; a 자동 mark while it's on. */
  private wireGourd(g: HTMLElement): void {
    let timer = 0, held = false;
    g.addEventListener("pointerdown", () => {
      held = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        held = true;
        const on = !gameSettings.v.autoPotion;
        gameSettings.set({ autoPotion: on });
        toastLine(on ? "물약 자동 사용: 켬" : "물약 자동 사용: 끔");
      }, 550);
    });
    const cancel = () => window.clearTimeout(timer);
    g.addEventListener("pointerup", cancel);
    g.addEventListener("pointerleave", cancel);
    g.addEventListener("pointercancel", cancel);
    g.addEventListener("click", (e) => { if (held) { e.preventDefault(); held = false; return; } this.h.potion(); });
    g.addEventListener("contextmenu", (e) => e.preventDefault());
    gameSettings.onChange((s) => g.classList.toggle("auto-on", s.autoPotion));
  }

  autoPopOpen(): boolean {
    return !el("[data-autopop]", this.root).hidden;
  }

  closeSoundPop(): void {
    el("[data-autopop]", this.root).hidden = true;
  }

  /** The speaker shows a cross while muted; an open panel follows M. */
  private syncSound(): void {
    el("[data-sound]", this.root).classList.toggle("muted", audio.settings.muted);
    const m = this.root.querySelector<HTMLInputElement>(".sheet-card [data-mute]");
    if (m) m.checked = audio.settings.muted;
  }

  /**
   * The channel picker: each channel of this zone with how full it is (여유 / 보통 / 혼잡 / 가득), yours marked.
   * A full one can't be picked. Counts are read when it opens.
   */
  private async toggleChannels(): Promise<void> {
    const pop = el("[data-chpop]", this.root);
    if (!pop.hidden) { this.closeChannels(); return; }
    pop.hidden = false;
    pop.innerHTML = `<h4>채널</h4><p class="ch-note">불러오는 중…</p>`;
    const list = await this.h.channels();
    if (pop.hidden) return;
    if (!list) { pop.innerHTML = `<h4>채널</h4><p class="ch-note">지금은 채널을 볼 수 없다.</p><button type="button" class="btn btn-sm close" data-chclose>닫기</button>`; return; }
    const cap = CHANNEL_CAPACITY;
    const rows = list.players.map((n, i) => {
      const ch = i + 1, mine = ch === list.current, full = n >= cap && !mine;
      const f = n / cap, word = full ? "가득" : f >= 0.75 ? "혼잡" : f >= 0.4 ? "보통" : "여유";
      return `<button type="button" class="ch-row${mine ? " mine" : ""}" data-ch="${ch}" data-load="${word}" ${mine || full ? "disabled" : ""}><b>${ch}채널</b><i class="ch-bar" style="--f:${Math.min(1, f).toFixed(2)}"></i><span>${mine ? "지금 여기" : word}</span></button>`;
    }).join("");
    pop.innerHTML = `<h4>채널 <small>${esc(ZONES[this.zoneId]?.name ?? "")}</small></h4><div class="ch-list">${rows}</div><small class="ch-note">서 있던 자리 그대로 옮긴다 · 10초에 한 번</small><button type="button" class="btn btn-sm close" data-chclose>닫기</button>`;
  }
  private closeChannels(): void {
    el("[data-chpop]", this.root).hidden = true;
  }

  toggleAutoPop(): void {
    const pop = el("[data-autopop]", this.root);
    if (!pop.hidden) { pop.hidden = true; return; }
    const st = this.h.autoSettings();
    pop.innerHTML = `<h4>자동 사냥</h4>
      <small class="auto-note">자동 사냥에서 쓸 검법</small>
      <div class="auto-skills">${SKILLS.map((sk, i) => `<label><input type="checkbox" data-sk="${i}" ${st.skills[i] ? "checked" : ""}> ${esc(sk.name)}</label>`).join("")}</div>
      <label><input type="checkbox" data-potion-auto ${gameSettings.v.autoPotion ? "checked" : ""}> 생명이 낮으면 물약 (어디서나)</label>
      ${potionSlider()}
      <label><input type="checkbox" data-quest-first ${st.questFirst ? "checked" : ""}> 의뢰 대상 먼저</label>
      <button type="button" class="close btn btn-secondary btn-sm" data-popclose>닫기</button>`;
    pop.hidden = false;
    pop.querySelectorAll<HTMLInputElement>("[data-sk]").forEach((c) => c.addEventListener("change", () => { st.skills[Number(c.dataset.sk)] = c.checked; this.h.saveAutoSettings(); }));
    el<HTMLInputElement>("[data-potion-auto]", pop).addEventListener("change", (e) => gameSettings.set({ autoPotion: (e.target as HTMLInputElement).checked }));
    el<HTMLInputElement>("[data-quest-first]", pop).addEventListener("change", (e) => { st.questFirst = (e.target as HTMLInputElement).checked; this.h.saveAutoSettings(); });
    bindSliders(pop, onSlider);
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

  /** One thought beside the inscription (first death only). */
  deathThought(text: string | null): void {
    const t = el("[data-death-thought]", this.root);
    t.hidden = !text;
    t.textContent = text ?? "";
  }

  /** What took you, in 먹동이's own words. */
  deathCause(text: string): void {
    el("[data-death-cause]", this.root).textContent = text;
  }

  /* ---------- death: the ink takes the screen; hold the ensō to rise ---------- */
  private deathShownAt = 0;
  private riseTimer = 0;
  private riseBusy = false;
  private outTimer = 0;

  /**
   * show: ink bleeds in from the edges, the scene greys, the HUD fades, the inscription writes itself.
   * busy: the respawn request is in flight (the circle stays closed). Hiding lets the ink recede outward.
   */
  death(show: boolean, busy = false): void {
    const box = el("[data-death]", this.root);
    this.riseBusy = busy;
    window.clearTimeout(this.outTimer);
    if (show) {
      if (box.hidden || box.classList.contains("out")) {
        box.classList.remove("out", "rising", "risen");
        box.hidden = false;
        this.deathShownAt = performance.now();
        this.setRise(0, false);
      }
      if (!busy && box.classList.contains("risen")) { box.classList.remove("risen", "rising"); this.setRise(0, false); }
      this.root.classList.add("dead");
      document.documentElement.classList.add("dying");
      return;
    }
    this.root.classList.remove("dead");
    document.documentElement.classList.remove("dying");
    if (box.hidden) return;
    box.classList.add("out");
    this.outTimer = window.setTimeout(() => { box.hidden = true; box.classList.remove("out", "rising", "risen"); }, 1100);
  }

  private setRise(f: number, slow: boolean): void {
    const e = el("[data-rise-enso]", this.root);
    e.classList.toggle("unwind", !slow && f === 0);
    e.style.setProperty("--f", String(f));
  }

  /** The ensō you hold to rise: pointer/touch hold or Space/Enter held ~0.7 s; a plain tap works after 2 s. */
  private wireRise(): void {
    const rise = el("[data-respawn]", this.root);
    const box = el("[data-death]", this.root);
    let holding = false;
    const ready = () => !box.hidden && !box.classList.contains("out") && !box.classList.contains("risen") && !this.riseBusy;
    const complete = () => {
      window.clearTimeout(this.riseTimer);
      holding = false;
      this.setRise(1, true);
      box.classList.add("risen");
      audio.play("respawn");
      window.setTimeout(() => this.h.respawn(), 380);
    };
    const start = () => {
      if (!ready() || holding) return;
      holding = true;
      box.classList.add("rising");
      this.setRise(1, true);
      this.riseTimer = window.setTimeout(() => { if (holding) complete(); }, 720);
    };
    const stop = (tap: boolean) => {
      if (!holding) return;
      holding = false;
      window.clearTimeout(this.riseTimer);
      // can't hold? after 2 s a plain tap is enough
      if (tap && performance.now() - this.deathShownAt > 2000) { complete(); return; }
      box.classList.remove("rising");
      this.setRise(0, false);
    };
    rise.addEventListener("pointerdown", (e) => { e.preventDefault(); rise.setPointerCapture?.(e.pointerId); start(); });
    rise.addEventListener("pointerup", () => stop(true));
    rise.addEventListener("pointercancel", () => stop(false));
    rise.addEventListener("lostpointercapture", () => stop(false));
    const isKey = (e: KeyboardEvent) => e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter";
    window.addEventListener("keydown", (e) => { if (!box.hidden && isKey(e)) { e.preventDefault(); if (!e.repeat) start(); } });
    window.addEventListener("keyup", (e) => { if (!box.hidden && isKey(e)) stop(true); });
  }

  fade(on: boolean, text = ""): void {
    el("[data-fadetext]", this.root).textContent = text;
    el("[data-fade]", this.root).classList.toggle("on", on);
  }
}
