// NPC sheets (먹노인 quests, 염색 장인 dyes + potions, 병기 제단 gacha) and the gear sheet.
// Everything goes through GameApi and the screen refreshes from the returned ProfileView.

import {
  AD_DAILY, AD_REWARD_JADE, DAILY_QUESTS, JADE_PRODUCTS, ZONES, type Npc,
} from "../../shared/world";
import {
  COST1, COST10, DUPE_PIGMENT, DYES, DYE_COST, ITEM, ITEMS, PITY, RARITY_RATES, itemOdds, type ItemDef,
} from "../../shared/items";
import { POTION_COST, SKILLS } from "../../shared/combat";
import type { SlotId } from "../../shared/types";
import type { GameApi, ProfileView } from "../../net/api";
import { dailyStatus, mainStatus, npcName, progressText, rewardText } from "../quests";
import { fmt, hexCss } from "../util";
import { attempt, el, esc, itemIcon, toast } from "./dom";
import { enhanceHtml, growthAction, skillsHtml, type GrowthState } from "./growth";
import { audio } from "../audio";
import { SETTINGS_TABS, bindSettings, settingsHtml, type SettingsCtx } from "./settings";

export interface SheetCtx {
  api: GameApi;
  profile(): ProfileView;
  apply(p: ProfileView): void;
  /** discovery hints (docs/TUTORIAL.md) */
  hint?(id: string, text: string): void;
  seen?(id: string): boolean;
  mark?(id: string): void;
  /** the settings menu's hooks */
  settings?: SettingsCtx;
}

/** One short line the first time each growth tab is opened. */
const GROWTH_FIRST: Record<string, string> = {
  skills: "포인트를 쏟을수록 검법이 깊어진다. 다섯과 열에서 깨어난다.",
  enhance: "먹돌로 붓을 다듬는다. 너무 욕심내면 붓이 부서질 수도.",
};

type SheetId = "elder" | "dyer" | "altar" | "gear" | "growth" | "settings";
const SLOT_NAME: Record<SlotId, string> = { weapon: "붓", hat: "머리", sash: "띠" };
const RCLS: Record<string, string> = { 전설: "l", 영웅: "e", 희귀: "r", 일반: "c" };

function itemStat(it: ItemDef): string {
  return it.atk ? `공격 ${it.atk}` : it.tint ? "색 있는 장비" : SLOT_NAME[it.slot];
}

const TABS: Partial<Record<SheetId, [string, string][]>> = {
  elder: [["main", "이어지는 의뢰"], ["daily", "오늘의 의뢰"]],
  dyer: [["dye", "염색"], ["potion", "물약"]],
  altar: [["pull", "뽑기"], ["odds", "확률표"], ["jade", "묵옥 얻기"]],
  growth: [["skills", "검법 단련"], ["enhance", "붓 강화"]],
  settings: SETTINGS_TABS,
};

/** NPC and gear sheets unroll as a hanging scroll (rods top and bottom, paper with a loose ink frame). */
export class Sheets {
  private readonly wrap: HTMLElement;
  private readonly card: HTMLElement;
  current: SheetId | null = null;
  private tab = "";
  private busy = false;
  private lastPull = "";
  private readonly growthState: GrowthState = { brush: "", protect: false, stage: "" };
  /** the first-open line stays while that tab stays open */
  private firstNote = "";
  private firstTab = "";

  constructor(root: HTMLElement, private readonly ctx: SheetCtx) {
    root.insertAdjacentHTML("beforeend", `<div class="sheet" data-sheet hidden><div class="scroll"><div class="sheet-card" role="dialog" aria-modal="true"></div><i class="sheet-frame" aria-hidden="true"></i></div></div>`);
    this.wrap = el("[data-sheet]", root);
    this.card = el(".sheet-card", this.wrap);
    this.wrap.addEventListener("pointerdown", (e) => { if (e.target === this.wrap) this.close(); });
  }

  isOpen(): boolean {
    return this.current !== null;
  }

  /** The settings menu (Esc, the gear button, or the speaker button for the sound tab). */
  openSettings(tab?: string): void {
    if (this.current === "settings" && (!tab || tab === this.tab)) { this.close(); return; }
    this.show("settings", tab);
  }

  /** Opens an NPC's own sheet (the conversation itself happens in story.ts). */
  openNpc(n: Npc, tab?: string): void {
    this.lastPull = "";
    if (n.role !== "elder" && n.role !== "dyer" && n.role !== "altar") return;
    this.show(n.role, tab);
  }

  openGrowth(tab?: "skills" | "enhance"): void {
    if (this.current === "growth") { this.close(); return; }
    this.growthState.brush = this.ctx.profile().equip.weapon;
    this.growthState.stage = "";
    this.show("growth", tab);
    if (tab === "enhance") this.card.querySelector('[data-tab="enhance"]')?.classList.add("hint-glow");
  }

  openGear(): void {
    if (this.current === "gear") { this.close(); return; }
    this.show("gear");
  }

  private show(id: SheetId, tab?: string): void {
    if (!this.current) audio.play("ui-open");
    this.current = id;
    this.tab = tab ?? TABS[id]?.[0][0] ?? "";
    this.wrap.hidden = false;
    this.render();
    this.card.querySelector<HTMLElement>("[data-close]")?.focus();
  }

  close(): void {
    this.current = null;
    this.wrap.hidden = true;
    this.card.innerHTML = "";
  }

  /** Re-render after a profile change (keeps the gacha results on screen). */
  refresh(): void {
    // the settings sheet doesn't depend on the profile (and must not redraw under a dragged slider)
    if (this.current && this.current !== "settings") this.render();
  }

  private render(): void {
    const p = this.ctx.profile();
    let html = "";
    if (this.current === "elder") html = this.elder(p);
    else if (this.current === "dyer") html = this.dyer(p);
    else if (this.current === "altar") html = this.altar(p);
    else if (this.current === "gear") html = this.gear(p);
    else if (this.current === "settings" && this.ctx.settings) html = this.head("설정") + settingsHtml(this.tab, this.ctx.settings);
    else if (this.current === "growth") {
      const first = `growth-${this.tab}`;
      let intro = "";
      if (this.ctx.seen && !this.ctx.seen(first)) {
        intro = `<p class="first-note">${esc(GROWTH_FIRST[this.tab] ?? "")}</p>`;
        this.ctx.mark?.(first);
        this.firstNote = intro;
      } else if (this.firstNote && this.firstTab === this.tab) intro = this.firstNote;
      this.firstTab = this.tab;
      if (!intro) this.firstNote = "";
      html = this.head("수련") + intro + (this.tab === "enhance" ? enhanceHtml(p, this.growthState, this.busy) : skillsHtml(p, this.busy));
    }
    const scroll = this.card.scrollTop;
    this.card.innerHTML = html;
    this.card.scrollTop = scroll;
    this.card.querySelector("[data-close]")?.addEventListener("click", () => this.close());
    this.card.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      this.tab = b.dataset.tab ?? "";
      this.card.scrollTop = 0;
      this.render();
    }));
    this.card.querySelectorAll<HTMLElement>("[data-do]").forEach((b) => b.addEventListener("click", () => this.act(b)));
    if (this.current === "settings" && this.ctx.settings) bindSettings(this.card, () => this.render(), this.ctx.settings);
    this.card.classList.toggle("is-settings", this.current === "settings");
  }

  private head(title: string, seal = false): string {
    const tabs = this.current ? TABS[this.current] : undefined;
    const nav = tabs
      ? `<nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === this.tab}" data-tab="${id}">${esc(label)}</button>`).join("")}</nav>`
      : "";
    return `<header><div>${seal ? `<i class="seal-dab" aria-hidden="true"></i>` : ""}<h2>${esc(title)}</h2></div><button class="close btn btn-secondary btn-sm" type="button" data-close aria-label="닫기">닫기</button></header>${nav}`;
  }

  /* ---------- 먹노인 ---------- */
  private elder(p: ProfileView): string {
    const s = mainStatus(p);
    let say = "먹이 번지는 곳마다 먹귀신이 깨어난다. 붓을 들 수 있는 자가 필요하구나.";
    if (s?.done) say = "잘 해냈구나. 이 보상을 받아 가거라.";
    else if (s && s.q.goal.type === "kill") say = `${ZONES[s.q.goal.zone ?? ""]?.name ?? "들판"}으로 가 보거라. 먹이 짙어지고 있다.`;
    else if (s && s.q.goal.type === "dye") say = "염색 장인을 찾아가 보거라. 색을 입은 붓잡이는 멀리서도 보인단다.";
    else if (!s) say = "이제 내가 가르칠 것은 없구나. 날마다 들러 일을 도와다오.";
    if (this.tab === "daily") {
      const daily = DAILY_QUESTS.map((_, i) => {
        const d = dailyStatus(p, i);
        const label = d.claimed ? "받음" : d.done ? "보상 받기" : `${d.prog} / ${d.target}`;
        return `<div class="qitem${d.claimed ? " claimed" : ""}"><div><b>${esc(d.q.title)}</b><small>${esc(d.q.text)}</small><span class="reward">${rewardText(d.q)}</span></div>
          <button class="btn btn-sm" type="button" data-do="claimDaily" data-i="${i}" ${d.done && !d.claimed && !this.busy ? "" : "disabled"}>${label}</button></div>`;
      }).join("");
      return `${this.head("먹노인")}<p class="sub">하루에 한 번씩 새로 맡깁니다.</p><div class="qlist">${daily}</div>`;
    }
    let main = `<p class="sub">이어지는 의뢰가 없습니다.</p>`;
    if (s) {
      main = `<div class="qitem"><div><b>${esc(s.q.title)}</b><small>${esc(s.q.text)}</small><small>진행 ${progressText(s)}</small><span class="reward">${rewardText(s.q)}</span></div>
        <span class="qstate">${!s.accepted ? "아직 받지 않음" : s.done ? `${esc(npcName(s.q.turnIn))}에게 알리기` : "진행 중"}</span></div>`;
    }
    return `${this.head("먹노인")}<p class="say">${esc(say)}</p>${main}`;
  }

  /* ---------- 염색 장인 ---------- */
  private dyer(p: ProfileView): string {
    if (this.tab === "potion") {
      const pot = [1, 5, 10].map((n) => `<button type="button" data-do="potion" data-n="${n}" ${p.pigment < n * POTION_COST || this.busy ? "disabled" : ""}><b>물약 ${n}개</b><small>안료 ${fmt(n * POTION_COST)}</small></button>`).join("");
      return `${this.head("염색 장인")}<p class="sub">물약은 생명을 크게 채웁니다. 지금 ${p.potions}개, 안료 ${fmt(p.pigment)}.</p><div class="shop">${pot}</div>`;
    }
    const sw = (key: "sash" | "scarf") =>
      DYES.map((d, k) => {
        const on = p.dye[key] === d.hex;
        const poor = d.hex != null && p.pigment < DYE_COST;
        return `<button type="button" class="sw${on ? " on" : ""}" data-do="dye" data-t="${key}" data-k="${k}" title="${esc(d.name)}" aria-label="${esc(d.name)}${on ? " (지금 색)" : ""}" style="--c:${d.hex == null ? "#3d3a36" : hexCss(d.hex)}" ${on || poor || this.busy ? "disabled" : ""}><span>${esc(d.name)}</span></button>`;
      }).join("");
    return `${this.head("염색 장인")}<p class="say">색을 들이면 먹빛 세상에서도 네 색이 남는다. 같이 싸우는 이들 눈에도 보이지.</p>
      <p class="sub">한 번 물들이는 데 안료 ${DYE_COST}. 가진 안료 ${fmt(p.pigment)}.</p>
      <div class="dye-row"><span>허리띠</span><div class="swatches">${sw("sash")}</div></div>
      <div class="dye-row"><span>목도리</span><div class="swatches">${sw("scarf")}</div></div>`;
  }

  /* ---------- 병기 제단 ---------- */
  private altar(p: ProfileView): string {
    const local = this.ctx.api.mode === "local";
    const head = this.head("오방 병기전", true);
    if (this.tab === "odds") {
      const rates = RARITY_RATES.map((r) => `<i class="${RCLS[r.r]}">${r.r} ${+(r.p * 100).toFixed(2)}%</i>`).join("");
      const rows = itemOdds().map((o) => {
        const it = ITEM[o.id];
        return `<tr><td>${o.r}</td><td>${esc(it.name)}</td><td>${SLOT_NAME[it.slot]}</td><td>${(o.p * 100).toFixed(3)}%</td></tr>`;
      }).join("");
      return `${head}<div class="rates">${rates}</div><p class="sub">50번째 뽑기까지 전설이 없으면 전설을 줍니다. 10회 뽑기에는 희귀 이상이 하나 들어 있습니다. 장비 ${itemOdds().length}종의 확률은 아래와 같습니다.</p>
        <div class="rate-table"><table><thead><tr><th>등급</th><th>장비</th><th>부위</th><th>확률</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if (this.tab === "jade") {
      const shop = JADE_PRODUCTS.map((j) => `<button type="button" data-do="buy" data-id="${esc(j.productId)}" ${this.busy ? "disabled" : ""}><b>${esc(j.label)}</b><small>${local ? "모의 결제, 바로 지급" : "결제 창이 열립니다"}</small></button>`).join("");
      return `${head}<p class="sub">가진 묵옥 ${fmt(p.jade)}</p>
        <div class="row"><button class="ghost-btn btn btn-secondary btn-sm" type="button" data-do="ad" ${p.adsLeft <= 0 || this.busy ? "disabled" : ""}>광고 보고 묵옥 ${AD_REWARD_JADE} 받기 (오늘 ${Math.max(0, p.adsLeft)}/${AD_DAILY})</button></div>
        <div class="shop">${shop}</div>
        <p class="mock">${local ? "지금은 오프라인(로컬) 모드라 충전은 <b>모의 결제</b>로 바로 지급되고 실제 돈은 나가지 않습니다. 광고도 모의 화면입니다." : "충전은 Verse8 결제 창에서 진행됩니다."} 광고는 버튼을 누를 때만 나옵니다. 경지와 진행은 팔지 않습니다.</p>`;
    }
    const left = Math.max(0, PITY - p.pity);
    return `${head}
      <div class="banner-art"><b>붓과 갓과 띠를 내리는 제단</b>
        <div class="pity">전설까지 <b>${left}</b>번 남았습니다. 중복은 안료 ${DUPE_PIGMENT}로 바뀝니다.</div></div>
      <div class="pull-row">
        <button class="pull btn" type="button" data-do="pull" data-n="1" ${p.jade < COST1 || this.busy ? "disabled" : ""}><b>1회 뽑기</b><span>묵옥 ${fmt(COST1)}</span></button>
        <button class="pull btn" type="button" data-do="pull" data-n="10" ${p.jade < COST10 || this.busy ? "disabled" : ""}><b>10회 뽑기</b><span>묵옥 ${fmt(COST10)}</span></button>
      </div>
      <div class="results" aria-live="polite">${this.lastPull}</div>`;
  }

  /* ---------- 장비 ---------- */
  private gear(p: ProfileView): string {
    const slots = (["weapon", "hat", "sash"] as SlotId[]).map((s) => {
      const it = ITEM[p.equip[s]];
      if (!it) return `<div class="slot"><div><span>${SLOT_NAME[s]}</span><b>없음</b></div></div>`;
      return `<div class="slot">${itemIcon(it)}<div><span>${SLOT_NAME[s]}</span><b>${esc(it.name)}</b><span>${it.r} ${itemStat(it)}</span></div></div>`;
    }).join("");
    const owned = new Set(p.owned);
    const inv = ITEMS.filter((i) => owned.has(i.id)).map((it) => {
      const on = p.equip[it.slot] === it.id;
      return `<button type="button" class="item${on ? " on" : ""}" data-do="equip" data-id="${it.id}" data-r="${it.r}" ${this.busy ? "disabled" : ""}><span class="g">${itemIcon(it)}</span><b>${esc(it.name)}</b><small>${on ? "착용 중" : `${it.r} ${itemStat(it)}`}</small></button>`;
    }).join("");
    const nextSkill = SKILLS.find((s) => s.unlock > p.level);
    return `${this.head("장비")}<div class="slots">${slots}</div>
      <p class="sub">공격력 ${p.atk}, 생명 ${p.maxHp}.${nextSkill ? ` ${esc(nextSkill.name)}은 ${nextSkill.unlock}경지에 익힙니다.` : ""}</p>
      <h3>가진 장비 <small>${owned.size}/${ITEMS.length}, 눌러서 착용</small></h3><div class="inv">${inv}</div>
      <p class="mock">띠와 목도리 염색은 마을의 염색 장인에게, 새 장비는 병기 제단에서 얻습니다.</p>`;
  }

  /* ---------- actions ---------- */
  private async act(b: HTMLElement): Promise<void> {
    if (this.busy) return;
    const api = this.ctx.api;
    const what = b.dataset.do;
    this.busy = true;
    this.render();
    try {
      if (what && (await growthAction(what, b, api, this.ctx.profile(), this.growthState, this.ctx.apply, () => { if (this.current) this.render(); }))) {
        // handled by the growth sheet
      } else if (what === "claimDaily") {
        const i = Number(b.dataset.i);
        const p = await attempt(api.claimDaily(i));
        if (p) { this.ctx.apply(p); toast(`오늘의 의뢰 완료 · ${rewardText(DAILY_QUESTS[i])}`); audio.play("quest-done"); }
      } else if (what === "dye") {
        const d = DYES[Number(b.dataset.k)];
        const p = await attempt(api.dye(b.dataset.t === "scarf" ? "scarf" : "sash", d.hex));
        if (p) { this.ctx.apply(p); toast(d.hex == null ? "먹빛으로 되돌렸다" : `${d.name}으로 물들였다`); }
      } else if (what === "potion") {
        const n = Number(b.dataset.n);
        const p = await attempt(api.buyPotions(n));
        if (p) { this.ctx.apply(p); toast(`물약 ${n}개를 샀다`); }
      } else if (what === "pull") {
        const n = b.dataset.n === "10" ? 10 : 1;
        const r = await attempt(api.pullGacha(n));
        if (r) {
          this.lastPull = r.ids.map((id, k) => {
            const it = ITEM[id];
            if (!it) return "";
            return `<div class="card" data-r="${it.r}" style="animation-delay:${k * 0.07}s">${itemIcon(it)}<b>${esc(it.name)}</b><small>${it.r}${r.dupes[k] ? ` · 중복 → 안료 ${DUPE_PIGMENT}` : " · 새 장비"}</small></div>`;
          }).join("");
          this.ctx.apply(r.profile);
          if (r.ids.some((id) => ITEM[id]?.r === "전설")) toast("전설 장비를 얻었다!");
        }
      } else if (what === "ad") {
        const p = await attempt(api.watchAdForJade());
        if (p) { this.ctx.apply(p); toast(`묵옥 +${AD_REWARD_JADE}`); }
      } else if (what === "buy") {
        const id = b.dataset.id ?? "";
        const prod = JADE_PRODUCTS.find((j) => j.productId === id);
        const ok = await attempt(api.buyJade(id).then(() => true));
        if (ok) {
          const p = await attempt(api.loadProfile());
          if (p) this.ctx.apply(p);
          if (prod) toast(`${prod.label} 충전${api.mode === "local" ? " (모의)" : ""}`);
        }
      } else if (what === "equip") {
        const id = b.dataset.id ?? "";
        const p = await attempt(api.equip(id));
        if (p) { this.ctx.apply(p); toast(`${ITEM[id]?.name ?? "장비"} 착용`); }
      }
    } finally {
      this.busy = false;
      if (this.current) this.render();
    }
  }
}
