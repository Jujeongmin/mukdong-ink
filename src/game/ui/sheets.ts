// NPC sheets (먹노인 quests, 염색 장인 dyes + potions, 병기 제단 gacha) and the gear sheet.
// Everything goes through GameApi and the screen refreshes from the returned ProfileView.
// One component language (ui-sheets.css): a resource bar of icon chips on top with a "?" tablet, picture
// tiles in rarity frames, cost chips, one big primary tablet per screen, captions instead of paragraphs.

import {
  AD_DAILY, AD_REWARD_JADE, DAILY_QUESTS, JADE_PRODUCTS, ZONES, type Npc, type QuestDef,
} from "../../shared/world";
import {
  COST1, COST10, DYES, DYE_COST, GACHA_EXTRA_BY_ID, ITEM, ITEMS, PITY, RARITY_RATES, dupeGrant, itemOdds, type Grant, type ItemDef,
} from "../../shared/items";
import { enhancedAtk } from "../../shared/growth";
import { POTION_COST, SKILLS } from "../../shared/combat";
import type { SlotId } from "../../shared/types";
import type { GachaPull, GameApi, ProfileView } from "../../net/api";
import { dailyStatus, mainStatus, npcName, progressText, rewardText } from "../quests";
import { fmt, hexCss } from "../util";
import { attempt, el, esc, itemIcon, resBar, resChip, resIcon, tipAttr, toast, type ResKind } from "./dom";
import { enhanceHtml, growthAction, growthLocal, skillsHtml, type GrowthState } from "./growth";
import { audio } from "../audio";
import { SETTINGS_TABS, bindSettings, settingsHtml, type SettingsCtx } from "./settings";
import { ALBUM_PAGES, album, pageEarned } from "../album";

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
  /** 화첩: walk a recovered region (추억 속 풍경); `memoryBlock` says why not right now */
  enterMemory?(pageId: string): void;
  memoryBlock?(): string | null;
}

/** One short line the first time each growth tab is opened. */
const GROWTH_FIRST: Record<string, string> = {
  skills: "포인트를 쏟을수록 검법이 깊어진다. 다섯과 열에서 깨어난다.",
  enhance: "먹돌로 붓을 다듬는다. 너무 욕심내면 붓이 부서질 수도.",
};

type SheetId = "elder" | "dyer" | "altar" | "gear" | "growth" | "settings" | "album";
const SLOT_NAME: Record<SlotId, string> = { weapon: "무기", hat: "머리", sash: "띠" };
/** what an item is called in a line of text: 검 / 붓 for weapons, else its slot */
const kindName = (it: ItemDef) => (it.slot === "weapon" ? (it.kind === "sword" ? "검" : "붓") : SLOT_NAME[it.slot]);
const RCLS: Record<string, string> = { 전설: "l", 영웅: "e", 희귀: "r", 일반: "c" };

function itemStat(it: ItemDef, plus = 0): string {
  return it.atk ? `공격 ${enhancedAtk(it.atk, plus)}` : it.tint ? "색 있는 장비" : kindName(it);
}

/** 으로 / 로 after a word (로 after a vowel or ㄹ): 파랑으로, 보라로. */
function withRo(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return "로";
  const jong = c % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** "먹돌 16" / "색 조각 1" (a gacha bundle or what a duplicate turned into). */
function grantText(g?: Grant): string {
  if (!g) return "";
  return [g.stones ? `먹돌 ${g.stones}` : "", g.shards ? `색 조각 ${g.shards}` : ""].filter(Boolean).join(" · ");
}
/** The picture for a gacha material bundle (materials.png cell: 0 먹돌, 1 색 조각, 2 파괴방지권, 3 물약). */
const MAT_KIND: ResKind[] = ["stone", "shard", "protect", "potion"];
function bundleIcon(id: string, size: string): string {
  const g = GACHA_EXTRA_BY_ID[id];
  return resIcon(MAT_KIND[g?.icon ?? 0] ?? "stone", size);
}

/** Reward chips for a quest: 경험 first, then whatever else it gives. */
function rewardChips(q: QuestDef): string {
  const r = q.reward;
  const list: [ResKind, number | undefined][] = [["exp", r.exp], ["pigment", r.pigment], ["jade", r.jade], ["potion", r.potions], ["stone", r.stones], ["shard", r.shards], ["protect", r.protects], ["points", r.points]];
  return `<span class="chips">${list.filter(([, n]) => n).map(([k, n]) => resChip(k, n as number)).join("")}</span>`;
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
  /** the last gacha pull; the reveal runs on a clock from `at`, so re-renders mid-reveal don't restart or cut it */
  private pull: { pulls: GachaPull[]; at: number } | null = null;
  private readonly growthState: GrowthState = { brush: "", protect: false, stage: "" };
  /** gear sheet: the picked tile and the slot filter */
  private gearSel = "";
  private gearFilter: SlotId | "" = "";
  /** 화첩: the page shown large, if any */
  private albumSel = "";
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
  openNpc(n: Pick<Npc, "role">, tab?: string): void {
    this.pull = null;
    if (n.role !== "elder" && n.role !== "dyer" && n.role !== "altar") return;
    this.show(n.role, tab);
  }

  openGrowth(tab?: "skills" | "enhance", focus?: GrowthState["focus"]): void {
    this.growthState.focus = focus;
    if (this.current === "growth") { this.close(); return; }
    const p = this.ctx.profile();
    this.growthState.brush = p.equip.weapon;
    this.growthState.stage = "";
    this.growthState.detail = focus === "awaken1" ? true : undefined;
    this.growthState.slide = focus === "awaken1";
    if (focus === "awaken1") this.growthState.skill = 1;
    this.show("growth", tab);
    if (tab === "enhance") this.card.querySelector('[data-tab="enhance"]')?.classList.add("hint-glow");
    // gate 9: the odds table sits under the stage; bring the highlighted rows into view
    if (focus === "odds") this.card.querySelector(".rate-detail tr.focus")?.scrollIntoView({ block: "center" });
  }

  openGear(): void {
    if (this.current === "gear") { this.close(); return; }
    this.gearSel = "";
    this.show("gear");
  }

  /** 화첩: the pictures of each recovered color. */
  openAlbum(page = ""): void {
    if (this.current === "album" && !page) { this.close(); return; }
    this.albumSel = page;
    this.show("album");
  }

  private show(id: SheetId, tab?: string): void {
    if (!this.current) audio.play("ui-open");
    this.current = id;
    this.tab = tab ?? TABS[id]?.[0][0] ?? "";
    this.wrap.hidden = false;
    this.wrap.dataset.kind = id;
    this.render();
    this.card.querySelector<HTMLElement>("[data-close]")?.focus();
  }

  close(): void {
    this.current = null;
    this.growthState.focus = undefined;
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
    else if (this.current === "album") html = this.album(p);
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
      html = this.head("수련") + intro + (this.tab === "enhance" ? enhanceHtml(p, this.growthState, this.busy) : skillsHtml(p, this.busy, this.growthState));
      this.growthState.slide = false;
    }
    this.card.dataset.tab = this.tab;
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
    this.card.querySelectorAll<HTMLElement>("[data-page]").forEach((b) => b.addEventListener("click", () => {
      this.albumSel = this.albumSel === b.dataset.page ? "" : b.dataset.page ?? "";
      this.render();
    }));
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

  /* ---------- 화첩 ---------- */
  private album(p: ProfileView): string {
    const date = (at: number) => { const d = new Date(at); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
    const sel = ALBUM_PAGES.find((pg) => pg.id === this.albumSel && album.has(pg.id));
    if (sel) {
      const pic = album.picture(sel.id)!;
      return `${this.head("화첩")}<figure class="album-big" style="--hue:${sel.hue}">
        <button type="button" class="album-pic" data-page="${sel.id}" aria-label="작게 보기"><img src="${pic.url}" alt="${esc(sel.title)}"></button>
        <figcaption><div><b class="sec">${esc(sel.chapter)} · ${esc(sel.title)}</b><span class="cap">${esc(sel.place)} · ${date(pic.at)}</span></div>${this.walkBtn(sel.id, true)}</figcaption></figure>`;
    }
    const got = ALBUM_PAGES.filter((pg) => album.has(pg.id) || pageEarned(pg, p.main)).length;
    const pages = ALBUM_PAGES.map((pg) => {
      const pic = album.picture(pg.id);
      const earned = !!pic || pageEarned(pg, p.main);
      const body = pic
        ? `<button type="button" class="album-pic" data-page="${pg.id}" aria-label="${esc(pg.title)} 크게 보기"><img src="${pic.url}" alt="" loading="lazy"></button>`
        : `<div class="album-pic empty"><span>${earned ? "그림이 비어 있다.<br>다시 베면 이 날이 남는다." : pg.boss ? "아직 되찾지 못한 색" : "아직 이어지지 않은 이야기"}</span></div>`;
      const sub = pic ? `${pg.place} · ${date(pic.at)}` : pg.place;
      return `<li class="album-page${pic ? " has" : earned ? " earned" : " locked"}" style="--hue:${pg.hue}">${body}
        <div class="album-cap"><div><b class="sec">${esc(pg.chapter)} · ${esc(earned || pic ? pg.title : pg.boss ? "?" : pg.title)}</b><span class="cap">${esc(sub)}</span></div>${earned && pg.zone ? this.walkBtn(pg.id, false) : ""}</div></li>`;
    }).join("");
    return `${this.head("화첩")}<p class="say">보스를 벤 순간 잠깐 돌아온 색을 그림으로 남긴다. 들어가 보면 그날의 색 속을 혼자 걸어 볼 수 있다.</p>
      <p class="cap album-count">${got} / ${ALBUM_PAGES.length}장</p><ol class="album-grid">${pages}</ol>`;
  }

  /** 들어가 보기: into 추억 속 풍경 (only from a safe place; the reason shows as the tip otherwise) */
  private walkBtn(pageId: string, big: boolean): string {
    const why = this.ctx.memoryBlock?.() ?? null;
    return `<button type="button" class="btn ${big ? "btn-lg" : "btn-sm"} album-walk" data-do="memory" data-page-go="${pageId}"${tipAttr("들어가 보기", why ?? "그날 되찾은 색 속을 혼자 걸어 본다. 몬스터도 다른 사람도 없다.")} ${why ? "disabled" : ""}>들어가 보기</button>`;
  }

  /* ---------- 먹노인 ---------- */
  private elder(p: ProfileView): string {
    const s = mainStatus(p);
    let say = "먹이 번지는 곳마다 먹귀신이 깨어난다. 붓을 들 수 있는 자가 필요하구나.";
    if (s?.done) say = "잘 해냈구나. 이 보상을 받아 가거라.";
    else if (s && s.q.goal.type === "kill") say = `${ZONES[s.q.goal.zone ?? ""]?.name ?? "들판"}으로 가 보거라. 먹이 짙어지고 있다.`;
    else if (s && s.q.goal.type === "dye") say = "염색 장인을 찾아가 보거라. 색을 입은 붓잡이는 멀리서도 보인단다.";
    else if (!s) say = "이제 내가 가르칠 것은 없구나. 날마다 들러 일을 도와다오.";
    const bar = resBar([["pigment", p.pigment], ["jade", p.jade], ["potion", p.potions]]);
    if (this.tab === "daily") {
      const daily = DAILY_QUESTS.map((_, i) => {
        const d = dailyStatus(p, i);
        const f = d.target > 0 ? Math.min(1, d.prog / d.target) : 0;
        const btn = d.claimed ? `<span class="qdone">받음</span>`
          : d.done ? `<button class="btn btn-sm" type="button" data-do="claimDaily" data-i="${i}" ${this.busy ? "disabled" : ""}>보상 받기</button>` : `<span class="qdone">진행 중</span>`;
        return `<li class="qrow${d.claimed ? " claimed" : d.done ? " ready" : ""}">
          <div class="qmain"><b class="sec">${esc(d.q.title)}</b><span class="qprog"><i class="bar" style="--f:${f.toFixed(3)}" aria-hidden="true"></i><small>${d.prog} / ${d.target}</small></span>${rewardChips(d.q)}</div>${btn}</li>`;
      }).join("");
      const ready = DAILY_QUESTS.filter((_, k) => { const d = dailyStatus(p, k); return d.done && !d.claimed; }).length;
      const all = ready > 1 ? `<button class="btn btn-lg daily-all" type="button" data-do="claimDailyAll" ${this.busy ? "disabled" : ""}>모두 받기 (${ready})</button>` : "";
      return `${this.head("먹노인")}${resBar([["pigment", p.pigment], ["jade", p.jade], ["potion", p.potions]], "하루에 한 번씩 새로 맡긴다.\n다 하면 여기서, 또는 오른쪽 의뢰 칸에서 바로 받는다.")}<ol class="qrows">${daily}</ol>${all}`;
    }
    let main = `<p class="cap">이어지는 의뢰가 없다.</p>`;
    if (s) {
      const state = !s.accepted ? "아직 받지 않음" : s.done ? `${npcName(s.q.turnIn)}에게 알리기` : "진행 중";
      main = `<div class="qrow big${s.done ? " ready" : ""}"><div class="qmain"><b class="sec">${esc(s.q.title)}</b><p class="body">${esc(s.q.text)}</p>
        <span class="cap">진행 ${esc(progressText(s))} · ${esc(state)}</span>${rewardChips(s.q)}</div></div>`;
    }
    return `${this.head("먹노인")}${bar}<p class="say">${esc(say)}</p>${main}`;
  }

  /* ---------- 염색 장인 ---------- */
  private dyer(p: ProfileView): string {
    if (this.tab === "potion") {
      const pot = [1, 5, 10].map((n) => {
        const cost = n * POTION_COST;
        return `<button type="button" class="shop-tile" data-do="potion" data-n="${n}" ${p.pigment < cost || this.busy ? "disabled" : ""}>
          <span class="pic">${resIcon("potion", "xl")}${n > 1 ? `<b class="count">×${n}</b>` : ""}</span><b class="sec">물약 ${n}개</b>${resChip("pigment", cost, { need: true, short: p.pigment < cost })}</button>`;
      }).join("");
      return `${this.head("염색 장인")}${resBar([["potion", p.potions], ["pigment", p.pigment]], "물약은 생명을 크게 채운다.\nQ 키나 박 그림을 눌러 마신다.")}<div class="shop-tiles">${pot}</div>`;
    }
    const sw = (key: "sash" | "scarf") =>
      DYES.map((d, k) => {
        const on = p.dye[key] === d.hex;
        const poor = d.hex != null && p.pigment < DYE_COST;
        return `<button type="button" class="sw${on ? " on" : ""}" data-do="dye" data-t="${key}" data-k="${k}"${tipAttr(d.name, on ? "지금 색" : d.hex == null ? "검정으로 되돌린다" : `안료 ${DYE_COST}`)} aria-label="${esc(d.name)}${on ? " (지금 색)" : ""}" style="--c:${d.hex == null ? "#3d3a36" : hexCss(d.hex)}" ${on || poor || this.busy ? "disabled" : ""}><span>${esc(d.name)}</span></button>`;
      }).join("");
    return `${this.head("염색 장인")}${resBar([["pigment", p.pigment]], "색을 들이면 먹빛 세상에서도 네 색이 남는다.\n같이 싸우는 이들 눈에도 보인다.")}
      <div class="dye-cost"><span class="cap">한 번 물들이는 데</span>${resChip("pigment", DYE_COST, { need: true, short: p.pigment < DYE_COST })}</div>
      <div class="dye-row"><span class="sec">허리띠</span><div class="swatches">${sw("sash")}</div></div>
      <div class="dye-row"><span class="sec">목도리</span><div class="swatches">${sw("scarf")}</div></div>`;
  }

  /* ---------- 병기 제단 ---------- */
  private altar(p: ProfileView): string {
    const local = this.ctx.api.mode === "local";
    const head = this.head("오방 병기전", true);
    const help = "50번째 뽑기까지 전설이 없으면 전설을 준다. 10회 뽑기엔 희귀 이상이 하나.\n가진 장비가 또 나오면 먹돌(무기)이나 색 조각(머리·띠)으로 바뀐다.";
    const bar = resBar([["jade", p.jade], ["stone", p.stones ?? 0], ["shard", p.shards ?? 0]], help);
    if (this.tab === "odds") {
      const rates = RARITY_RATES.map((r) => `<span class="rate ${RCLS[r.r]}"><b>${r.r}</b> ${+(r.p * 100).toFixed(2)}%</span>`).join("");
      const odds = itemOdds();
      const rows = odds.map((o) => {
        const it = ITEM[o.id];
        const pic = o.kind === "material" ? bundleIcon(o.id, "s") : it ? itemIcon(it, "s") : "";
        const kind = o.kind === "material" ? `재료 · ${grantText(GACHA_EXTRA_BY_ID[o.id]?.grant)}` : it ? kindName(it) : "";
        return `<tr data-r="${o.r}"><td><span class="tcell">${pic}${esc(o.name)}</span></td><td class="${RCLS[o.r]}">${o.r}</td><td>${esc(kind)}</td><td>${(o.p * 100).toFixed(3)}%</td></tr>`;
      }).join("");
      const gear = odds.filter((o) => o.kind === "item").length;
      return `${head}${bar}<div class="rates">${rates}</div><p class="cap">${odds.length}종 · 장비 ${gear}, 재료 ${odds.length - gear}. 전설은 50번째 뽑기에 반드시.</p>
        <div class="rate-table"><table><thead><tr><th>나오는 것</th><th>등급</th><th>종류</th><th>확률</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="cap">중복 장비는 무기면 먹돌, 머리·띠면 색 조각으로 바뀐다.</p>`;
    }
    if (this.tab === "jade") {
      const shop = JADE_PRODUCTS.map((j, k) => `<button type="button" class="shop-tile" data-do="buy" data-id="${esc(j.productId)}" ${this.busy ? "disabled" : ""}>
        <span class="pic jade-pile n${k + 1}">${resIcon("jade", "xl")}</span><b class="sec">${esc(j.label)}</b><small class="cap">${local ? "모의 결제" : "결제 창"}</small></button>`).join("");
      return `${head}${bar}
        <div class="ad-row"><button class="btn btn-secondary" type="button" data-do="ad" ${p.adsLeft <= 0 || this.busy ? "disabled" : ""}>광고 보고 ${resIcon("jade")} ${AD_REWARD_JADE}</button><span class="cap">오늘 ${Math.max(0, p.adsLeft)} / ${AD_DAILY}</span></div>
        <div class="shop-tiles">${shop}</div>
        <p class="mock">${local ? "오프라인(로컬) 모드: 충전은 <b>모의 결제</b>로 바로 지급, 실제 돈은 나가지 않는다. 광고도 모의 화면." : "충전은 Verse8 결제 창에서 진행된다."} 광고는 버튼을 누를 때만. 경지와 진행은 팔지 않는다.</p>`;
    }
    const left = Math.max(0, PITY - p.pity);
    const showcase = ["w_gold", "h_goldgat", "s_gold"].map((id) => ITEM[id]).filter(Boolean).map((it) => `<span class="show"${tipAttr(it.name, `전설 ${kindName(it)}`)}>${itemIcon(it, "l")}</span>`).join("");
    const pull = this.pull;
    const age = pull ? (performance.now() - pull.at) / 1000 : 99;
    const results = pull ? pull.pulls.map((d, k) => {
      const fresh = age < 4 ? " fresh" : "";
      const delay = `--d:${(k * 0.12 - age).toFixed(2)}s`;
      if (d.kind === "material") {
        const what = grantText(d.grant ?? GACHA_EXTRA_BY_ID[d.id]?.grant);
        return `<div class="rv mat${fresh}" data-r="${d.r}" style="${delay}"${tipAttr(d.name, `재료 · ${what}`)}>
          <span class="face"><span class="pic">${bundleIcon(d.id, "l")}</span><b>${esc(d.name)}</b><small>${esc(what)}</small></span><i class="back" aria-hidden="true"></i></div>`;
      }
      const it = ITEM[d.id];
      if (!it) return "";
      const got = d.dupe ? grantText(d.grant ?? dupeGrant(it)) : "";
      return `<div class="rv${d.dupe ? " dupe" : ""}${fresh}" data-r="${it.r}" style="${delay}"${tipAttr(it.name, `${it.r} ${kindName(it)}${d.dupe ? ` · 이미 가진 장비라 ${got}(으)로 바뀌었다` : ""}`)}>
        <span class="face">${itemIcon(it, "l")}<b>${esc(it.name)}</b><small>${d.dupe ? "이미 가짐" : "새 장비"}</small></span>${d.dupe ? `<span class="ribbon">중복 → ${esc(got)}</span>` : ""}<i class="back" aria-hidden="true"></i></div>`;
    }).join("") : "";
    return `${head}${bar}
      <div class="banner"><div class="showcase">${showcase}</div>
        <div class="pity"><span class="cap">전설까지</span><b>${left}</b><span class="cap">번</span><i class="bar" style="--f:${(p.pity / PITY).toFixed(3)}" aria-hidden="true"></i></div></div>
      <div class="pull-row">
        <button class="pull btn btn-lg" type="button" data-do="pull" data-n="1" ${p.jade < COST1 || this.busy ? "disabled" : ""}><b>1회 뽑기</b><span class="cost">${resIcon("jade")}${fmt(COST1)}</span></button>
        <button class="pull btn btn-lg" type="button" data-do="pull" data-n="10" ${p.jade < COST10 || this.busy ? "disabled" : ""}><b>10회 뽑기</b><span class="cost">${resIcon("jade")}${fmt(COST10)}</span></button>
      </div>
      <div class="results${pull && pull.pulls.length > 1 ? " ten" : ""}" aria-live="polite">${results}</div>`;
  }

  /* ---------- 장비 ---------- */
  private gear(p: ProfileView): string {
    const plusOf = (it: ItemDef) => (it.slot === "weapon" ? p.enh?.[it.id] ?? 0 : 0);
    const slots = (["weapon", "hat", "sash"] as SlotId[]).map((s) => {
      const it = ITEM[p.equip[s]];
      if (!it) return `<div class="eqslot empty"><span class="cap">${SLOT_NAME[s]}</span><b>없음</b></div>`;
      const plus = plusOf(it);
      return `<button type="button" class="eqslot" data-do="pickGear" data-id="${it.id}" data-r="${it.r}"><span class="pic">${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}</span><span class="cap">${SLOT_NAME[s]}</span><b>${esc(it.name)}</b><small class="${RCLS[it.r]}">${it.r} · ${itemStat(it, plus)}</small></button>`;
    }).join("");
    const owned = new Set(p.owned);
    const mine = ITEMS.filter((i) => owned.has(i.id));
    if (!ITEM[this.gearSel] || !owned.has(this.gearSel)) this.gearSel = p.equip.weapon;
    const list = mine.filter((i) => !this.gearFilter || i.slot === this.gearFilter);
    const tiles = list.map((it) => {
      const on = p.equip[it.slot] === it.id;
      const plus = plusOf(it);
      return `<button type="button" class="tile${on ? " eq" : ""}${it.id === this.gearSel ? " on" : ""}" data-do="pickGear" data-id="${it.id}" data-r="${it.r}"${tipAttr(`${it.name}${plus ? ` +${plus}` : ""}`, `${it.r} ${kindName(it)} · ${itemStat(it, plus)}${on ? " · 착용 중" : ""}`)}>
        ${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}<span class="nm">${esc(it.name)}</span></button>`;
    }).join("");
    const sel = ITEM[this.gearSel];
    const selOn = sel && p.equip[sel.slot] === sel.id;
    const detail = sel ? `<div class="gear-detail" data-r="${sel.r}">${itemIcon(sel, "l")}<div><b class="sec">${esc(sel.name)}${plusOf(sel) ? ` +${plusOf(sel)}` : ""}</b><span class="cap"><em class="${RCLS[sel.r]}">${sel.r}</em> ${kindName(sel)} · ${itemStat(sel, plusOf(sel))}</span></div>
      ${selOn ? `<span class="qdone">착용 중</span>` : `<button class="btn" type="button" data-do="equip" data-id="${sel.id}" ${this.busy ? "disabled" : ""}>착용</button>`}</div>` : "";
    const filters = ([["", "전체"], ["weapon", "무기"], ["hat", "머리"], ["sash", "띠"]] as [SlotId | "", string][]).map(([v, l]) =>
      `<button type="button" role="radio" class="seg-b" aria-checked="${this.gearFilter === v}" data-do="gearFilter" data-v="${v}">${l}</button>`).join("");
    const nextSkill = SKILLS.find((s) => s.unlock > p.level);
    return `${this.head("장비")}${resBar([["pigment", p.pigment], ["jade", p.jade], ["stone", p.stones ?? 0]], "새 장비는 병기 제단에서, 띠와 목도리 염색은 염색 장인에게.\n붓은 수련 › 붓 강화에서 다듬는다.")}
      <div class="gear2">
        <div class="gear2-eq"><h4 class="sec">착용</h4><div class="eqslots">${slots}</div>
          <p class="stats"><span${tipAttr("공격력", "붓과 경지로 오른다.")}><small>공격</small><b>${p.atk}</b></span><span${tipAttr("생명", "경지가 오를수록 늘어난다.")}><small>생명</small><b>${p.maxHp}</b></span></p>
          ${nextSkill ? `<p class="cap">${esc(nextSkill.name)} · Lv ${nextSkill.unlock}에 열림</p>` : ""}</div>
        <div class="gear2-inv"><div class="inv-head"><h4 class="sec">가진 장비 <small>${owned.size} / ${ITEMS.length}</small></h4><div class="seg" role="radiogroup" aria-label="부위">${filters}</div></div>
          <div class="tiles">${tiles}</div>${detail}</div>
      </div>`;
  }

  /* ---------- actions ---------- */
  private async act(b: HTMLElement): Promise<void> {
    if (this.busy) return;
    const api = this.ctx.api;
    const what = b.dataset.do;
    // selection only: no server call, no busy flicker
    if (what && growthLocal(what, b, this.growthState)) { this.render(); return; }
    if (what === "pickGear") { this.gearSel = b.dataset.id ?? ""; this.render(); return; }
    if (what === "memory") { this.ctx.enterMemory?.(b.dataset.pageGo ?? ""); return; }
    if (what === "gearFilter") { this.gearFilter = (b.dataset.v ?? "") as SlotId | ""; this.render(); return; }
    this.busy = true;
    this.render();
    try {
      if (what && (await growthAction(what, b, api, this.ctx.profile(), this.growthState, this.ctx.apply, () => { if (this.current) this.render(); }))) {
        // handled by the growth sheet; gate 9b: the first failure while 잿불귀 waits teaches that only stones are lost
        const ms = mainStatus(this.ctx.profile());
        if (what === "enhance" && this.growthState.stage === "fail" && ms?.accepted && ms.q.id === "c2q10") this.ctx.hint?.("gate9b", "먹돌만 날아갔다. 붓은 멀쩡하다.");
      } else if (what === "claimDaily") {
        const i = Number(b.dataset.i);
        const p = await attempt(api.claimDaily(i));
        if (p) { this.ctx.apply(p); toast(`오늘의 의뢰 완료 · ${rewardText(DAILY_QUESTS[i])}`); audio.play("quest-done"); }
      } else if (what === "claimDailyAll") {
        const p = await attempt(api.claimDailyAll());
        if (p) { this.ctx.apply(p); toast("오늘의 의뢰 보상을 모두 받았다"); audio.play("quest-done"); }
      } else if (what === "dye") {
        const d = DYES[Number(b.dataset.k)];
        const p = await attempt(api.dye(b.dataset.t === "scarf" ? "scarf" : "sash", d.hex));
        if (p) { this.ctx.apply(p); toast(d.hex == null ? "검정으로 되돌렸다" : `${d.name}${withRo(d.name)} 물들였다`); }
      } else if (what === "potion") {
        const n = Number(b.dataset.n);
        const p = await attempt(api.buyPotions(n));
        if (p) { this.ctx.apply(p); toast(`물약 ${n}개를 샀다`); }
      } else if (what === "pull") {
        const n = b.dataset.n === "10" ? 10 : 1;
        const r = await attempt(api.pullGacha(n));
        if (r) {
          // an older server answers without `pulls`: rebuild the rows from ids / dupes
          const pulls: GachaPull[] = r.pulls ?? r.ids.map((id, k): GachaPull => {
            const it = ITEM[id];
            const g = GACHA_EXTRA_BY_ID[id];
            return it ? { id, name: it.name, r: it.r, kind: "item", dupe: !!r.dupes[k], grant: r.dupes[k] ? dupeGrant(it) : undefined }
              : { id, name: g?.name ?? id, r: g?.r ?? "일반", kind: "material", dupe: false, grant: g?.grant };
          });
          this.pull = { pulls, at: performance.now() };
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
