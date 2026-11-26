// NPC sheets (먹노인 quests, 염색 장인 dyes + potions, 병기 제단 gacha) and the gear sheet.
// Everything goes through GameApi and the screen refreshes from the returned ProfileView.
// One component language (ui-sheets.css): a resource bar of icon chips on top with a "?" tablet, picture
// tiles in rarity frames, cost chips, one big primary tablet per screen, captions instead of paragraphs.

import {
  AD_DAILY, AD_DOUBLE_DAILY, AD_PULL_DAILY, AD_REWARD_JADE, DAILY_QUESTS, JADE_PRODUCTS, ZONES, villageOpen, type Npc, type QuestDef, type ZoneDef,
} from "../../shared/world";
import {
  COST1, COST10, DYES, DYE_COST, GACHA_EXTRA_BY_ID, ITEM, ITEMS, PITY, RARITY_RATES, dupeGrant, harmonySkill, HARMONY_BONUS, hatHpBonus, itemOdds, sashCdCut, type Grant, type ItemDef,
} from "../../shared/items";
import { DROPS, atkText, enhancedAtk } from "../../shared/growth";
import { adUsesLeft, dailyAllClaimed } from "../../shared/profile";
import { MONSTERS, SKILLS, isObstacle, potionCost } from "../../shared/combat";
import { BOOK, BOOK_STEP, bookBonus, bookStage } from "../../shared/book";
import { NPC_INFO } from "../../shared/story";
import { ZoneMap, type MapLive } from "./minimap";
import type { RankBoard, RankRow, RankView } from "../../shared/rank";
import type { SlotId } from "../../shared/types";
import type { GachaPull, GachaResult, GameApi, ProfileView } from "../../net/api";
import { dailyStatus, mainStatus, npcName, progressText, rewardText } from "../quests";
import { fmt, hexCss } from "../util";
import { attempt, el, esc, itemIcon, resBar, resChip, resIcon, tipAttr, toast, type ResKind } from "./dom";
import { anyTrainable, enhanceHtml, growthAction, growthLocal, skillsHtml, type GrowthState } from "./growth";
import { audio } from "../audio";
import { SETTINGS_TABS, bindSettings, settingsHtml, type SettingsCtx } from "./settings";
import { ALBUM_PAGES, album, pageEarned } from "../album";
import { t } from "../i18n";

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
  /** 먹그림 도감: a monster kind's picture (a data URL, drawn once), null if it can't be drawn now */
  monsterPic?(kind: string): string | null;
  memoryBlock?(): string | null;
  /** the zone you stand in (the map marks it, and 순간이동 starts only from a village) */
  zone?(): string;
  /** 순간이동 to a village (the game closes the sheet and moves you) */
  travel?(village: string): void;
  /** you, the others and the quest marks, for the big map */
  mapLive?(): MapLive;
}

/**
 * The world map: where each place sits on the sheet's painted map (viewBox 240 × 400). 1장 climbs the left side from
 * 먹골 to 먹봉우리; the east door leads over to 솔재, and 2장 climbs the right side to 향로 마당. Roads come from the
 * zones' own portals.
 */
const WORLD_AT: Record<string, [number, number]> = {
  village: [58, 368], bamboo: [76, 296], pond: [50, 224], peak: [80, 150],
  pass: [166, 176], kiln: [184, 112], temple: [154, 62], censer: [192, 22],
};

/** The world map as an inline ink drawing: the roads and a mark per place; a place is a button. */
function worldMap(here: string, sel: string): string {
  const roads: string[] = [];
  const seen = new Set<string>();
  for (const [id, at] of Object.entries(WORLD_AT)) {
    for (const p of ZONES[id]?.portals ?? []) {
      const to = WORLD_AT[p.to];
      const key = [id, p.to].sort().join("|");
      if (!to || seen.has(key)) continue;
      seen.add(key);
      // a road that bends a little (a brush stroke, not a ruler line)
      const mx = (at[0] + to[0]) / 2 + (to[1] - at[1]) * 0.12, my = (at[1] + to[1]) / 2 - (to[0] - at[0]) * 0.12;
      roads.push(`<path d="M${at[0]} ${at[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${to[0]} ${to[1]}"/>`);
    }
  }
  const places = Object.entries(WORLD_AT).filter(([id]) => ZONES[id]).map(([id, [x, y]]) => {
    const d = ZONES[id];
    const kind = d.safe ? "safe" : d.boss ? "boss" : "field";
    const right = x < 180;
    const lx = right ? x + 13 : x - 13, anchor = right ? "start" : "end";
    const sub = d.safe ? t("마을") : `Lv ${d.levels[0]}–${d.levels[1]}`;
    const mark = d.safe
      ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" transform="rotate(45 ${x} ${y})" class="wm-safe"/>`
      : d.boss ? `<circle cx="${x}" cy="${y}" r="7" class="wm-boss"/><circle cx="${x}" cy="${y}" r="2.6" class="wm-boss-dot"/>`
      : `<circle cx="${x}" cy="${y}" r="6" class="wm-field"/>`;
    return `<g class="wm-place ${kind}${id === sel ? " on" : ""}${id === here ? " here" : ""}" data-do="mapSel" data-z="${id}" role="button" tabindex="0" aria-label="${esc(t(d.name))}">
      <circle cx="${x}" cy="${y}" r="17" class="wm-hit"/>${id === sel ? `<circle cx="${x}" cy="${y}" r="12" class="wm-ring"/>` : ""}${mark}
      <text x="${lx}" y="${y - 1}" text-anchor="${anchor}" class="wm-name">${esc(t(d.name))}</text>
      <text x="${lx}" y="${y + 11}" text-anchor="${anchor}" class="wm-sub">${esc(sub)}</text>
      ${id === here ? `<path d="M${x} ${y - 21} l-5 -9 h10 z" class="wm-you"/>` : ""}</g>`;
  }).join("");
  return `<svg viewBox="0 0 240 400" class="wm" xmlns="http://www.w3.org/2000/svg"><g class="wm-roads">${roads.join("")}</g>${places}</svg>`;
}
/** what each kind of NPC does for you (the map's NPC list) */
const NPC_WORK: Record<Npc["role"], string> = {
  elder: t("오늘의 의뢰 · 순간이동"),
  dyer: t("염색 · 물약"),
  altar: t("병기 뽑기"),
  guide: t("이야기 · 지역 의뢰"),
};
/** "12%" (or "1%" for the rare ones, never 0 when it can drop) */
const pct = (p: number) => `${Math.max(1, Math.round(p * 100))}%`;

/** One short line the first time each growth tab is opened. */
const GROWTH_FIRST: Record<string, string> = {
  skills: t("포인트를 쏟을수록 검법이 깊어진다\n다섯과 열에서 깨어난다"),
  enhance: t("먹돌로 붓을 다듬는다\n너무 욕심내면 붓이 부서질 수도"),
};

type SheetId = "elder" | "dyer" | "altar" | "gear" | "growth" | "settings" | "album" | "rank" | "map";
const SLOT_NAME: Record<SlotId, string> = { weapon: t("무기"), hat: t("머리"), sash: t("띠") };
/** what an item is called in a line of text: 검 / 붓 for weapons, else its slot */
const kindName = (it: ItemDef) => (it.slot === "weapon" ? (it.kind === "sword" ? t("검") : t("붓")) : SLOT_NAME[it.slot]);
const RCLS: Record<string, string> = { 전설: "l", 영웅: "e", 희귀: "r", 일반: "c" };

/**
 * The 염색 sheet's preview: the stick figure (round head, joined limbs, big brush) drawn in ink, its sash and scarf in
 * the colors it wears now (undyed = ink). Drawn on a wash of the scarf's color so a new dye shows at once.
 */
function dyeFigure(sash: number | null | undefined, scarf: number | null | undefined): string {
  const c = (h: number | null | undefined) => (h == null ? "#3d3a36" : hexCss(h));
  return `<figure class="dye-fig" style="--sash:${c(sash)};--scarf:${c(scarf)}" aria-hidden="true"><svg viewBox="0 0 120 170">
    <g fill="none" stroke="#2b2622" stroke-linecap="round" stroke-linejoin="round">
      <path d="M60 40 L60 98" stroke-width="7"/>
      <path d="M60 52 L44 74 L36 96" stroke-width="6"/><path d="M60 52 L76 70 L90 66" stroke-width="6"/>
      <path d="M60 98 L48 128 L44 158" stroke-width="7"/><path d="M60 98 L72 128 L80 156" stroke-width="7"/>
      <path d="M92 70 L104 8" stroke-width="4"/>
    </g>
    <path d="M100 10 Q112 -4 108 18 Q104 30 100 10 Z" fill="#2b2622"/>
    <circle cx="60" cy="24" r="15" fill="#2b2622"/>
    <g fill="none" stroke="var(--scarf)" stroke-linecap="round" stroke-linejoin="round">
      <path d="M49 40 Q60 47 71 40" stroke-width="7"/>
      <path d="M50 42 Q34 50 22 46 Q30 54 14 60" stroke-width="5"/>
    </g>
    <g fill="none" stroke="var(--sash)" stroke-linecap="round" stroke-linejoin="round">
      <path d="M51 90 L69 90" stroke-width="7"/>
      <path d="M54 92 Q50 106 56 116" stroke-width="4"/><path d="M57 92 Q62 104 60 114" stroke-width="3.5"/>
    </g>
  </svg></figure>`;
}

/** gearBonusText (shared/items.ts) built here so it can be translated: same rounding */
function gearBonus(id: string): string {
  const hp = hatHpBonus(id), cd = sashCdCut(id);
  return hp > 0 ? t("생명 +{n}%", { n: Math.round(hp * 100) }) : cd > 0 ? t("재사용 -{n}%", { n: Math.round(cd * 100) }) : "";
}

function itemStat(it: ItemDef, plus = 0): string {
  return it.atk ? t("공격 {atk}", { atk: atkText(enhancedAtk(it.atk, plus)) }) : gearBonus(it.id) || kindName(it);
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
  return [g.stones ? t("먹돌 {n}", { n: g.stones }) : "", g.shards ? t("색 조각 {n}", { n: g.shards }) : ""].filter(Boolean).join(" · ");
}
/** The picture for a gacha material bundle (materials2.webp cell: 0 먹돌, 1 색 조각, 2 파괴방지권, 3 물약). */
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
  elder: [["main", t("이어지는 의뢰")], ["daily", t("오늘의 의뢰")]],
  dyer: [["dye", t("염색")], ["potion", t("물약")]],
  altar: [["pull", t("뽑기")], ["odds", t("확률표")], ["jade", t("묵옥 얻기")]],
  growth: [["skills", t("검법 단련")], ["enhance", t("붓 강화")]],
  album: [["pages", t("되찾은 색")], ["book", t("먹그림 도감")]],
  settings: SETTINGS_TABS,
};

/** how long a sheet takes to roll itself up when closed (matches .sheet.closing in style.css) */
const CLOSE_MS = 260;

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

  /** VX prices from VXShop (Verse8 only), shown on the 묵옥 products */
  private prices: Record<string, number> = {};
  constructor(root: HTMLElement, private readonly ctx: SheetCtx) {
    ctx.api.onPrices?.((p) => {
      this.prices = p;
      if (this.current === "altar" && this.tab === "jade") this.render();
    });
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
  /** 상점 (the HUD button / B): the 오방 병기전 sheet from anywhere; a second press closes it. */
  openShop(): void {
    if (this.current === "altar") { this.close(); return; }
    this.pull = null;
    this.show("altar");
  }

  /** the NPC whose sheet is open (the elder sheet is titled with their name: 먹노인, 산할미) */
  private npcId = "elder";
  openNpc(n: Pick<Npc, "role" | "id">, tab?: string): void {
    this.pull = null;
    if (n.role !== "elder" && n.role !== "dyer" && n.role !== "altar") return;
    this.npcId = n.id;
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

  /** 랭킹: fetched fresh each time it opens (and per tab), shown when it arrives. */
  openRank(): void {
    if (this.current === "rank") { this.close(); return; }
    this.ranks = {};
    this.show("rank");
  }
  private ranks: Partial<Record<RankBoard, RankView | "loading" | "error">> = {};
  private loadRank(board: RankBoard): void {
    if (this.ranks[board]) return;
    this.ranks[board] = "loading";
    this.ctx.api.rankings(board).then(
      (v) => { this.ranks[board] = v; if (this.current === "rank") this.render(); },
      () => { this.ranks[board] = "error"; if (this.current === "rank") this.render(); },
    );
  }
  private rank(): string {
    const board: RankBoard = "power";
    this.loadRank(board);
    const v = this.ranks[board];
    const unit = (n: number) => t("전투력 {n}", { n: fmt(n) });
    const line = (r: RankRow) => `<li class="rk-row${r.me ? " me" : ""}${r.rank <= 3 ? ` top${r.rank}` : ""}"><b class="rk-n">${r.rank}</b><span class="rk-name">${esc(r.name)}</span><i class="rk-dots" aria-hidden="true"></i><span class="rk-v">${unit(r.value)}</span></li>`;
    let body: string;
    if (!v || v === "loading") body = `<p class="cap rk-note">${t("불러오는 중…")}</p>`;
    else if (v === "error") body = `<p class="cap rk-note">${t("지금은 순위를 볼 수 없다")}</p>`;
    else if (!v.top.length) body = `<p class="cap rk-note">${t("아직 아무도 없다")}</p>`;
    else {
      // the first three stand on a podium (2 · 1 · 3), each inside an ink ring; empty places stay as faint rings
      const seat = (n: number) => {
        const r = v.top.find((x) => x.rank === n);
        if (!r) return `<li class="pod-seat empty p${n}"><span class="pod-ring"><b>${n}</b></span><span class="rk-name">${t("빈 자리")}</span><span class="rk-v">—</span></li>`;
        return `<li class="pod-seat p${n}${r.me ? " me" : ""}"><span class="pod-ring"><b>${n}</b></span><span class="rk-name">${esc(r.name)}</span><span class="rk-v">${unit(r.value)}</span></li>`;
      };
      const rest = v.top.filter((r) => r.rank > 3);
      const mine = v.mine && !v.top.some((r) => r.me) ? v.mine : null;
      body = `<ol class="rk-podium">${[2, 1, 3].map(seat).join("")}</ol>
        ${rest.length ? `<ol class="rk-list">${rest.map(line).join("")}</ol>` : `<p class="cap rk-note rk-more">${t("4위부터는 여기에 적힌다")}</p>`}
        ${mine ? `<div class="rk-mine"><span class="cap">${t("내 순위")}</span><ol class="rk-list">${line(mine)}</ol></div>` : ""}`;
    }
    const say = t("전투력이 높은 순\n같으면 먼저 오른 사람이 앞");
    return `${this.head(t("랭킹"))}<p class="cap">${say}</p><div class="rk-sheet">${body}<i class="rk-wash" aria-hidden="true"></i></div>`;
  }

  /** 지도 (the minimap, N, or a village elder's 순간이동): opens on the zone you stand in. */
  openMap(): void {
    if (this.current === "map") { this.close(); return; }
    this.mapSel = this.ctx.zone?.() ?? "village";
    this.show("map");
  }
  private mapSel = "village";

  private map(p: ProfileView): string {
    const here = this.ctx.zone?.() ?? "";
    const sel = ZONES[this.mapSel] ? this.mapSel : here;
    const z = ZONES[sel];
    return `${this.head(t("지도"))}<div class="map3">
      <figure class="map-world" aria-label="${esc(t("지도"))}">${worldMap(here, sel)}</figure>
      <figure class="map-zone"><span class="map-zone-slot"></span><figcaption>${z ? esc(t(z.name)) : ""}</figcaption></figure>
      <section class="map-detail">${z ? this.mapZone(p, z, here) : ""}</section></div>`;
  }

  /** The big map (the minimap's picture enlarged, names written in): one for the life of the game. */
  private readonly zoneMap = new ZoneMap(true);
  /** After the map sheet is drawn: put the big map in its slot and paint the chosen place. */
  private mountMap(): void {
    const slot = this.card.querySelector(".map-zone-slot");
    if (!slot) return;
    slot.replaceWith(this.zoneMap.canvas);
    this.zoneMap.canvas.className = "map-zone-cv";
    const here = this.ctx.zone?.() ?? "";
    this.zoneMap.setZone(ZONES[this.mapSel] ? this.mapSel : here, true);
    this.zoneMap.draw(this.ctx.mapLive?.() ?? null);
  }
  /** Each slow UI tick while the map is open: you and the others move on it. */
  mapTick(live: MapLive): void {
    if (this.current === "map" && this.zoneMap.canvas.isConnected) this.zoneMap.draw(live);
  }

  private mapZone(p: ProfileView, z: ZoneDef, here: string): string {
    // the monsters of the field, one line per kind (levels and how many put together), then the boss
    const kinds = new Map<string, { lo: number; hi: number; n: number }>();
    for (const sp of z.spawns) {
      const k = kinds.get(sp.kind);
      if (k) { k.lo = Math.min(k.lo, sp.level[0]); k.hi = Math.max(k.hi, sp.level[1]); k.n += sp.count; }
      else kinds.set(sp.kind, { lo: sp.level[0], hi: sp.level[1], n: sp.count });
    }
    const monRow = (kind: string, lo: number, hi: number, n: number, boss: boolean, respawnMs = 0) => {
      const m = MONSTERS[kind];
      if (!m) return "";
      const dr = DROPS[kind];
      const pic = this.ctx.monsterPic?.(kind);
      const drops = [
        m.pigment ? `<span class="map-drop"${tipAttr(t("안료"), t("벨 때마다 얻는다"))}>${resIcon("pigment")}<b>${m.pigment}</b></span>` : "",
        dr && dr.stone[0] > 0 ? `<span class="map-drop"${tipAttr(t("먹돌"), t("붓을 강화할 때 쓴다"))}>${resIcon("stone")}<b>${dr.stone[0] >= 1 ? `×${dr.stone[1]}` : pct(dr.stone[0])}</b></span>` : "",
        dr && dr.shard[0] > 0 ? `<span class="map-drop"${tipAttr(t("색 조각"), t("검법을 각성시킨다"))}>${resIcon("shard")}<b>${dr.shard[0] >= 1 ? `×${dr.shard[1]}` : pct(dr.shard[0])}</b></span>` : "",
        m.jade ? `<span class="map-drop"${tipAttr(t("묵옥"), "")}>${resIcon("jade")}<b>${m.jade}</b></span>` : "",
      ].join("");
      const tag = boss ? `<em class="map-tag boss">${t("보스")} · ${t("{n}분마다", { n: Math.round(respawnMs / 60000) })}</em>`
        : isObstacle(m) ? `<em class="map-tag">${t("길막이")}</em>` : m.armor ? `<em class="map-tag gate">${t("관문")}</em>` : "";
      return `<li class="map-mon${boss ? " boss" : ""}"><span class="map-pic">${pic ? `<img src="${pic}" alt="">` : ""}</span>
        <span class="map-mname"><b>${esc(t(m.name))}</b><small>Lv ${lo === hi ? lo : `${lo}–${hi}`}${n > 1 ? ` · ${t("{n}마리", { n })}` : ""}</small>${tag}</span>
        <span class="map-drops">${drops}</span></li>`;
    };
    const mons = [...kinds].map(([kind, k]) => monRow(kind, k.lo, k.hi, k.n, false)).join("")
      + (z.boss ? monRow(z.boss.kind, z.boss.level, z.boss.level, 1, true, z.boss.respawnMs) : "");
    const npcs = z.npcs.map((n) => `<li><b>${esc(npcName(n.id))}</b><small>${esc(t(NPC_INFO[n.id]?.title ?? ""))}</small><span class="cap">${esc(NPC_WORK[n.role])}</span></li>`).join("");
    // 순간이동: between villages, starting from one
    let travel = "";
    if (z.safe && z.id !== here) {
      const open = villageOpen(p, z.id);
      const fromVillage = !!ZONES[here]?.safe;
      const why = !open ? t("아직 가 보지 못한 마을이다") : !fromVillage ? t("순간이동은 마을에서만 할 수 있다") : "";
      travel = `<div class="map-travel"><button class="btn btn-lg" type="button" data-do="travel" data-z="${z.id}" ${why || this.busy ? "disabled" : ""}>${t("{name}로 순간이동", { name: t(z.name) })}</button>${why ? `<p class="cap">${why}</p>` : ""}</div>`;
    }
    return `<h3 class="map-title">${esc(t(z.name))}<small>${z.safe ? t("마을 · 쉬는 곳, 생명이 빨리 찬다") : t("사냥터 · Lv {a}–{b}", { a: z.levels[0], b: z.levels[1] })}</small></h3>
      ${travel}
      ${mons ? `<h4 class="sec">${t("몬스터와 드랍")}</h4><ul class="map-mons">${mons}</ul>` : ""}
      ${npcs ? `<h4 class="sec">${t("사람들")}</h4><ul class="map-npcs">${npcs}</ul>` : ""}`;
  }

  /** 화첩: the pictures of each recovered color. */
  openAlbum(page = ""): void {
    if (this.current === "album" && !page) { this.close(); return; }
    this.albumSel = page;
    // before any color is recovered the 도감 is all there is to see
    const anyPage = ALBUM_PAGES.some((pg) => album.has(pg.id) || pageEarned(pg, this.ctx.profile().main));
    this.show("album", page || anyPage ? undefined : "book");
  }

  private show(id: SheetId, tab?: string): void {
    if (!this.current) audio.play("ui-open");
    // reopened while rolling up: start the unroll again
    if (this.wrap.classList.contains("closing")) {
      window.clearTimeout(this.closeTimer);
      this.wrap.classList.remove("closing");
      this.wrap.hidden = true;
    }
    this.current = id;
    this.tab = tab ?? TABS[id]?.[0][0] ?? "";
    this.wrap.hidden = false;
    this.wrap.dataset.kind = id;
    this.render();
    this.card.querySelector<HTMLElement>("[data-close]")?.focus();
  }

  /** Closes at once for the game (nothing is open any more); the scroll rolls itself up on screen first. */
  close(): void {
    if (!this.current && this.wrap.hidden) return;
    this.current = null;
    this.growthState.focus = undefined;
    if (this.wrap.hidden || this.wrap.classList.contains("closing")) return;
    this.wrap.classList.add("closing");
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.wrap.classList.remove("closing");
      if (this.current) return; // reopened meanwhile
      this.wrap.hidden = true;
      this.card.innerHTML = "";
    }, CLOSE_MS);
  }
  private closeTimer = 0;

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
    else if (this.current === "rank") html = this.rank();
    else if (this.current === "map") html = this.map(p);
    else if (this.current === "settings" && this.ctx.settings) html = this.head(t("설정")) + settingsHtml(this.tab, this.ctx.settings);
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
      html = this.head(t("수련")) + intro + (this.tab === "enhance" ? enhanceHtml(p, this.growthState, this.busy) : skillsHtml(p, this.busy, this.growthState));
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
    if (this.current === "map") this.mountMap();
    if (this.current === "settings" && this.ctx.settings) bindSettings(this.card, () => this.render(), this.ctx.settings);
    this.card.classList.toggle("is-settings", this.current === "settings");
  }

  /** A red dot on a tab that has something to do now (the same rule as the HUD's red number). */
  private tabDot(id: string): boolean {
    if (this.current === "growth" && id === "skills") return anyTrainable(this.ctx.profile());
    return false;
  }

  private head(title: string, seal = false): string {
    const tabs = this.current ? TABS[this.current] : undefined;
    const nav = tabs
      ? `<nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === this.tab}" data-tab="${id}">${esc(label)}${this.tabDot(id) ? `<i class="tab-dot"${tipAttr(t("할 수 있는 것이 있다"))}></i>` : ""}</button>`).join("")}</nav>`
      : "";
    return `<header><div>${seal ? `<i class="seal-dab" aria-hidden="true"></i>` : ""}<h2>${esc(title)}</h2></div><button class="close btn btn-secondary btn-sm" type="button" data-close aria-label="${t("닫기")}">${t("닫기")}</button></header>${nav}`;
  }

  /* ---------- 화첩 ---------- */
  private album(p: ProfileView): string {
    if (this.tab === "book") return this.book(p);
    const date = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const sel = ALBUM_PAGES.find((pg) => pg.id === this.albumSel && album.has(pg.id));
    if (sel) {
      const pic = album.picture(sel.id)!;
      return `${this.head(t("화첩"))}<figure class="album-big" style="--hue:${sel.hue}">
        <button type="button" class="album-pic" data-page="${sel.id}" aria-label="${t("작게 보기")}"><img src="${pic.url}" alt="${esc(sel.title)}"></button>
        <figcaption><div><b class="sec">${esc(sel.chapter)} · ${esc(sel.title)}</b><span class="cap">${esc(sel.place)} · ${date(pic.at)}</span></div>${this.walkBtn(sel.id, true)}</figcaption></figure>`;
    }
    const got = ALBUM_PAGES.filter((pg) => album.has(pg.id) || pageEarned(pg, p.main)).length;
    const pages = ALBUM_PAGES.map((pg) => {
      const pic = album.picture(pg.id);
      const earned = !!pic || pageEarned(pg, p.main);
      const body = pic
        ? `<button type="button" class="album-pic" data-page="${pg.id}" aria-label="${esc(t("{title} 크게 보기", { title: pg.title }))}"><img src="${pic.url}" alt="" loading="lazy"></button>`
        : `<div class="album-pic empty${pg.zone ? " has-art" : ""}"${pg.zone ? ` style="--art:url('./assets/art/loading-${pg.zone}.webp')"` : ""}><span>${earned ? t("그림이 비어 있다<br>다시 베면 이 날이 남는다") : pg.boss ? t("아직 되찾지 못한 색") : t("아직 이어지지 않은 이야기")}</span></div>`;
      const sub = pic ? `${pg.place} · ${date(pic.at)}` : pg.place;
      return `<li class="album-page${pic ? " has" : earned ? " earned" : " locked"}" style="--hue:${pg.hue}">${body}
        <div class="album-cap"><div><b class="sec"><i class="al-seal">${esc(pg.chapter)}</i>${esc(earned || pic ? pg.title : pg.boss ? t("아직 모르는 색") : pg.title)}</b><span class="cap">${esc(sub)}</span></div>${earned && pg.zone ? this.walkBtn(pg.id, false) : ""}</div></li>`;
    }).join("");
    return `${this.head(t("화첩"))}<p class="say">${t("보스를 벤 순간 잠깐 돌아온 색을 그림으로 남긴다\n들어가 보면 그날의 색 속을 혼자 걸어 볼 수 있다")}</p>
      <p class="cap album-count">${t("{got} / {total}장", { got, total: ALBUM_PAGES.length })}</p><ol class="album-grid">${pages}</ol>`;
  }

  /**
   * 먹그림 도감: a page per monster. Unmet ones are a faint shape and "?"; a 밑그림 is the figure in pale ink;
   * a finished page is the figure in full. Each step adds BOOK_STEP to 공격 or 생명 for good.
   */
  private book(p: ProfileView): string {
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const total = bookBonus(p.book ?? {});
    const done = BOOK.filter((b) => bookStage(b, p.book?.[b.kind] ?? 0) === 2).length;
    const pages = BOOK.map((b) => {
      const n = p.book?.[b.kind] ?? 0;
      const stage = bookStage(b, n);
      const def = MONSTERS[b.kind];
      const pic = this.ctx.monsterPic?.(b.kind);
      const stat = b.stat === "atk" ? t("공격") : t("생명");
      const next = stage === 2 ? t("완성") : `${fmt(n)} / ${fmt(b.need[stage])}`;
      const steps = [0, 1].map((k) => `<i class="bk-step${stage > k ? " on" : ""}" aria-hidden="true"></i>`).join("");
      const tip = tipAttr(n > 0 ? t(def.name) : "?", t("밑그림 {a} · 완성 {b}", { a: b.need[0], b: b.need[1] }));
      return `<li class="bk-page s${stage}${n > 0 ? "" : " unmet"}"${tip}>
        <div class="bk-pic">${pic ? `<img src="${pic}" alt="" loading="lazy">` : ""}</div>
        <b class="bk-name">${n > 0 ? esc(t(def.name)) : "?"}</b>
        <span class="bk-count">${steps}<small>${next}</small></span>
        <span class="bk-gain${stage > 0 ? " on" : ""}">${stat} +${pct(stage * BOOK_STEP)}<small> / ${pct(2 * BOOK_STEP)}</small></span></li>`;
    }).join("");
    return `${this.head(t("화첩"))}<p class="say">${t("몬스터를 잡을수록 그림이 채워지고, 공격이나 생명이 오른다")}</p>
      <p class="cap album-count">${t("완성 {done} / {total}장 · 공격 +{atk} · 생명 +{hp}", { done, total: BOOK.length, atk: pct(total.atk), hp: pct(total.hp) })}</p><ol class="bk-grid">${pages}</ol>`;
  }

  /** 들어가 보기: into 추억 속 풍경 (only from a safe place; the reason shows as the tip otherwise) */
  private walkBtn(pageId: string, big: boolean): string {
    const why = this.ctx.memoryBlock?.() ?? null;
    return `<button type="button" class="btn ${big ? "btn-lg" : "btn-sm"} album-walk" data-do="memory" data-page-go="${pageId}"${tipAttr(t("들어가 보기"), why ?? t("그날 되찾은 색 속을 혼자 걸어 본다\n몬스터도 다른 사람도 없다"))} ${why ? "disabled" : ""}>${t("들어가 보기")}</button>`;
  }

  /* ---------- 먹노인 ---------- */
  private elder(p: ProfileView): string {
    const s = mainStatus(p);
    let say = t("먹이 번지는 곳마다 먹귀신이 깨어난다\n붓을 들 수 있는 자가 필요하구나");
    if (s?.done) say = t("잘 해냈구나\n이 보상을 받아 가거라");
    else if (s && s.q.goal.type === "kill") {
      const zone = ZONES[s.q.goal.zone ?? ""]?.name;
      say = t("{zone}으로 가 보거라\n먹이 짙어지고 있다", { zone: zone ? t(zone) : t("들판") });
    }
    else if (s && s.q.goal.type === "dye") say = t("염색 장인을 찾아가 보거라\n색을 입은 붓잡이는 멀리서도 보인단다");
    else if (!s) say = t("이제 내가 가르칠 것은 없구나\n날마다 들러 일을 도와다오");
    const bar = resBar([["pigment", p.pigment], ["jade", p.jade], ["potion", p.potions]]);
    if (this.tab === "daily") {
      const daily = DAILY_QUESTS.map((_, i) => {
        const d = dailyStatus(p, i);
        const f = d.target > 0 ? Math.min(1, d.prog / d.target) : 0;
        const btn = d.claimed ? `<span class="qdone">${t("받음")}</span>`
          : d.done ? `<button class="btn btn-sm" type="button" data-do="claimDaily" data-i="${i}" ${this.busy ? "disabled" : ""}>${t("보상 받기")}</button>` : `<span class="qdone">${t("진행 중")}</span>`;
        return `<li class="qrow${d.claimed ? " claimed" : d.done ? " ready" : ""}">
          <div class="qmain"><b class="sec">${esc(t(d.q.title))}</b><span class="qprog"><i class="bar" style="--f:${f.toFixed(3)}" aria-hidden="true"></i><small>${d.prog} / ${d.target}</small></span>${rewardChips(d.q)}</div>${btn}</li>`;
      }).join("");
      const ready = DAILY_QUESTS.filter((_, k) => { const d = dailyStatus(p, k); return d.done && !d.claimed; }).length;
      const all = ready > 1 ? `<button class="btn btn-lg daily-all" type="button" data-do="claimDailyAll" ${this.busy ? "disabled" : ""}>${t("모두 받기 ({n})", { n: ready })}</button>` : "";
      const left = adUsesLeft(p, "double");
      const double = dailyAllClaimed(p) && this.ctx.api.adsAvailable()
        ? `<div class="ad-row daily-ad"><button class="btn btn-secondary" type="button" data-do="adDouble" ${left <= 0 || this.busy ? "disabled" : ""}>${t("광고 보고 오늘의 의뢰 보상 한 번 더")}</button><span class="cap">${t("오늘 {n} / {max}", { n: left, max: AD_DOUBLE_DAILY })}</span></div>` : "";
      return `${this.head(npcName(this.npcId))}${resBar([["pigment", p.pigment], ["jade", p.jade], ["potion", p.potions]], t("하루에 한 번씩 새로 맡긴다\n다 하면 여기서, 또는 오른쪽 의뢰 칸에서 바로 받는다"))}<ol class="qrows">${daily}</ol>${all}${double}`;
    }
    let main = `<p class="cap">${t("이어지는 의뢰가 없다")}</p>`;
    if (s) {
      const state = !s.accepted ? t("아직 받지 않음") : s.done ? t("{name}에게 알리기", { name: npcName(s.q.turnIn) }) : t("진행 중");
      main = `<div class="qrow big${s.done ? " ready" : ""}"><div class="qmain"><b class="sec">${esc(t(s.q.title))}</b><p class="body">${esc(t(s.q.text))}</p>
        <span class="cap">${esc(t("진행 {p} · {state}", { p: progressText(s), state }))}</span>${rewardChips(s.q)}</div></div>`;
    }
    return `${this.head(npcName(this.npcId))}${bar}<p class="say">${esc(say)}</p>${main}`;
  }

  /* ---------- 염색 장인 ---------- */
  private dyer(p: ProfileView): string {
    if (this.tab === "potion") {
      const pot = [1, 5, 10].map((n) => {
        const cost = n * potionCost(p.level);
        return `<button type="button" class="shop-tile" data-do="potion" data-n="${n}" ${p.pigment < cost || this.busy ? "disabled" : ""}>
          <span class="pic">${resIcon("potion", "xl")}${n > 1 ? `<b class="count">×${n}</b>` : ""}</span><b class="sec">${t("물약 {n}개", { n })}</b>${resChip("pigment", cost, { need: true, short: p.pigment < cost })}</button>`;
      }).join("");
      return `${this.head(t("염색 장인"))}${resBar([["potion", p.potions], ["pigment", p.pigment]], t("물약은 생명을 크게 채운다\nQ 키나 박 그림을 눌러 마신다"))}<div class="shop-tiles">${pot}</div>`;
    }
    const harmony = harmonySkill(p.dye);
    const sw = (key: "sash" | "scarf") =>
      DYES.map((d, k) => {
        const on = p.dye[key] === d.hex;
        const poor = d.hex != null && p.pigment < DYE_COST;
        const sk = d.skill != null ? t(SKILLS[d.skill].label) : "";
        return `<button type="button" class="sw${on ? " on" : ""}" data-do="dye" data-t="${key}" data-k="${k}"${tipAttr(sk ? `${t(d.name)} · ${t(SKILLS[d.skill!].name)}` : t(d.name), on ? t("지금 색") : d.hex == null ? t("먹빛으로 되돌린다") : t("안료 {n}", { n: DYE_COST }))} aria-label="${esc(t(d.name))}${on ? ` (${t("지금 색")})` : ""}" style="--c:${d.hex == null ? "#3d3a36" : hexCss(d.hex)}" ${on || poor || this.busy ? "disabled" : ""}><span>${esc(t(d.name))}${sk ? `<small>${esc(sk)}</small>` : ""}</span></button>`;
      }).join("");
    return `${this.head(t("염색 장인"))}${resBar([["pigment", p.pigment]], t("색을 들이면 먹빛 세상에서도 네 색이 남는다\n같이 싸우는 이들 눈에도 보인다"))}
      <div class="dye-cost"><span class="cap">${t("한 번 물들이는 데")}</span>${resChip("pigment", DYE_COST, { need: true, short: p.pigment < DYE_COST })}</div>
      <div class="dye-row"><span class="sec">${t("허리띠")}</span><div class="swatches">${sw("sash")}</div></div>
      <div class="dye-row"><span class="sec">${t("목도리")}</span><div class="swatches">${sw("scarf")}</div></div>
      ${dyeFigure(p.dye.sash, p.dye.scarf)}
      ${harmony >= 0 ? `<p class="dye-harmony on">${esc(t("염색 조화 · {skill} 피해 +{n}%", { skill: t(SKILLS[harmony].name), n: Math.round(HARMONY_BONUS * 100) }))}</p>` : `<p class="dye-harmony">${t("허리띠와 목도리가 같은 색이면 그 색 검법 피해 +{n}%", { n: Math.round(HARMONY_BONUS * 100) })}</p>`}`;
  }

  /* ---------- 병기 제단 ---------- */
  private altar(p: ProfileView): string {
    const local = this.ctx.api.mode === "local";
    const head = this.head(t("오방 병기전"), true);
    const help = t("50번째 뽑기까지 전설이 없으면 전설을 준다\n10회 뽑기엔 희귀 이상이 하나\n가진 장비가 또 나오면 먹돌(무기)이나 색 조각(머리·띠)으로 바뀐다");
    const bar = resBar([["jade", p.jade], ["stone", p.stones ?? 0], ["shard", p.shards ?? 0]], help);
    if (this.tab === "odds") {
      const rates = RARITY_RATES.map((r) => `<span class="rate ${RCLS[r.r]}"><b>${t(r.r)}</b> ${+(r.p * 100).toFixed(2)}%</span>`).join("");
      const odds = itemOdds();
      const rows = odds.map((o) => {
        const it = ITEM[o.id];
        const pic = o.kind === "material" ? bundleIcon(o.id, "s") : it ? itemIcon(it, "s") : "";
        const kind = o.kind === "material" ? t("재료 · {what}", { what: grantText(GACHA_EXTRA_BY_ID[o.id]?.grant) }) : it ? kindName(it) : "";
        return `<tr data-r="${o.r}"><td><span class="tcell">${pic}${esc(t(o.name))}</span></td><td class="${RCLS[o.r]}">${t(o.r)}</td><td>${esc(kind)}</td><td>${(o.p * 100).toFixed(3)}%</td></tr>`;
      }).join("");
      const gear = odds.filter((o) => o.kind === "item").length;
      return `${head}${bar}<div class="rates">${rates}</div><p class="cap">${t("{n}종 · 장비 {gear}, 재료 {mat}\n전설은 50번째 뽑기에 반드시", { n: odds.length, gear, mat: odds.length - gear })}</p>
        <div class="rate-table"><table><thead><tr><th>${t("나오는 것")}</th><th>${t("등급")}</th><th>${t("종류")}</th><th>${t("확률")}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="cap">${t("중복 장비는 무기면 먹돌, 머리·띠면 색 조각으로 바뀐다")}</p>`;
    }
    if (this.tab === "jade") {
      const shop = JADE_PRODUCTS.map((j, k) => `<button type="button" class="shop-tile" data-do="buy" data-id="${esc(j.productId)}" ${this.busy ? "disabled" : ""}>
        <span class="pic jade-pile n${k + 1}">${resIcon("jade", "xl")}</span><b class="sec">${esc(t(j.label))}</b><small class="cap price">${fmt(this.prices[j.productId] ?? j.vx)}VX${local ? ` · ${t("모의")}` : ""}</small></button>`).join("");
      return `${head}${bar}
        ${this.ctx.api.adsAvailable() ? `<div class="ad-row"><button class="btn btn-secondary" type="button" data-do="ad" ${p.adsLeft <= 0 || this.busy ? "disabled" : ""}>${t("광고 보고")} ${resIcon("jade")} ${AD_REWARD_JADE}</button><span class="cap">${t("오늘 {n} / {max}", { n: Math.max(0, p.adsLeft), max: AD_DAILY })}</span></div>` : ""}
        <div class="shop-tiles">${shop}</div>
        <p class="mock">${local ? t("오프라인(로컬) 모드: 충전은 <b>모의 결제</b>로 바로 지급, 실제 돈은 나가지 않는다\n광고도 모의 화면") : t("충전은 Verse8 결제 창에서 진행된다")} ${t("광고는 버튼을 누를 때만\n경지와 진행은 팔지 않는다")}</p>`;
    }
    const left = Math.max(0, PITY - p.pity);
    const showcase = ["w_gold", "h_goldgat", "s_gold"].map((id) => ITEM[id]).filter(Boolean).map((it, k) =>
      `<span class="show" style="--k:${k}"${tipAttr(t(it.name), `${t("전설")} ${kindName(it)}`)}><span class="halo">${itemIcon(it, "xl")}</span><b>${esc(t(it.name))}</b><small>${t("전설")} · ${kindName(it)}</small></span>`).join("");
    const pull = this.pull;
    const age = pull ? (performance.now() - pull.at) / 1000 : 99;
    const results = pull ? pull.pulls.map((d, k) => {
      const fresh = age < 4 ? " fresh" : "";
      const delay = `--d:${(k * 0.12 - age).toFixed(2)}s`;
      if (d.kind === "material") {
        const what = grantText(d.grant ?? GACHA_EXTRA_BY_ID[d.id]?.grant);
        return `<div class="rv mat${fresh}" data-r="${d.r}" style="${delay}"${tipAttr(t(d.name), t("재료 · {what}", { what }))}>
          <span class="face"><span class="pic">${bundleIcon(d.id, "l")}</span><b>${esc(t(d.name))}</b><small>${esc(what)}</small></span><i class="back" aria-hidden="true"></i></div>`;
      }
      const it = ITEM[d.id];
      if (!it) return "";
      const got = d.dupe ? grantText(d.grant ?? dupeGrant(it)) : "";
      return `<div class="rv${d.dupe ? " dupe" : ""}${fresh}" data-r="${it.r}" style="${delay}"${tipAttr(t(it.name), `${t(it.r)} ${kindName(it)}${d.dupe ? ` · ${t("이미 가진 장비라 {got}(으)로 바뀌었다", { got })}` : ""}`)}>
        <span class="face">${itemIcon(it, "l")}<b>${esc(t(it.name))}</b><small>${d.dupe ? t("이미 가짐") : t("새 장비")}</small></span>${d.dupe ? `<span class="ribbon">${esc(t("중복 → {got}", { got }))}</span>` : ""}<i class="back" aria-hidden="true"></i></div>`;
    }).join("") : "";
    return `${head}${bar}
      <div class="banner hero${pull ? " slim" : ""}"><i class="hero-wash" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></i>
        <p class="hero-k">${t("전설 병기")}</p><div class="showcase">${showcase}</div>
        <div class="pity"><span class="cap">${t("전설까지")}</span><b>${left}</b><span class="cap">${t("번")}</span><i class="bar" style="--f:${(p.pity / PITY).toFixed(3)}" aria-hidden="true"></i></div></div>
      <div class="pull-row">
        <button class="pull btn btn-lg" type="button" data-do="pull" data-n="1" ${p.jade < COST1 || this.busy ? "disabled" : ""}><b>${t("1회 뽑기")}</b><span class="cost">${resIcon("jade")}${fmt(COST1)}</span></button>
        <button class="pull btn btn-lg" type="button" data-do="pull" data-n="10" ${p.jade < COST10 || this.busy ? "disabled" : ""}><b>${t("10회 뽑기")}</b><span class="cost">${resIcon("jade")}${fmt(COST10)}</span></button>
      </div>
      ${this.ctx.api.adsAvailable() ? `<div class="ad-row pull-ad"><button class="btn btn-secondary" type="button" data-do="adPull" ${adUsesLeft(p, "pull") <= 0 || this.busy ? "disabled" : ""}>${t("광고 보고 무료 1회 뽑기")}</button><span class="cap">${t("오늘 {n} / {max}", { n: adUsesLeft(p, "pull"), max: AD_PULL_DAILY })}</span></div>` : ""}
      <div class="results${pull && pull.pulls.length > 1 ? " ten" : ""}" aria-live="polite">${results}</div>`;
  }

  /* ---------- 장비 ---------- */
  private gear(p: ProfileView): string {
    const plusOf = (it: ItemDef) => (it.slot === "weapon" ? p.enh?.[it.id] ?? 0 : 0);
    const slots = (["weapon", "hat", "sash"] as SlotId[]).map((s) => {
      const it = ITEM[p.equip[s]];
      if (!it) return `<div class="eqslot empty"><span class="cap">${SLOT_NAME[s]}</span><b>${t("없음")}</b></div>`;
      const plus = plusOf(it);
      return `<button type="button" class="eqslot" data-do="pickGear" data-id="${it.id}" data-r="${it.r}"><span class="pic">${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}</span><span class="cap">${SLOT_NAME[s]}</span><b>${esc(t(it.name))}</b><small class="${RCLS[it.r]}">${t(it.r)} · ${itemStat(it, plus)}</small></button>`;
    }).join("");
    const owned = new Set(p.owned);
    const mine = ITEMS.filter((i) => owned.has(i.id));
    if (!ITEM[this.gearSel] || !owned.has(this.gearSel)) this.gearSel = p.equip.weapon;
    const list = mine.filter((i) => !this.gearFilter || i.slot === this.gearFilter);
    const tiles = list.map((it) => {
      const on = p.equip[it.slot] === it.id;
      const plus = plusOf(it);
      return `<button type="button" class="tile${on ? " eq" : ""}${it.id === this.gearSel ? " on" : ""}" data-do="pickGear" data-id="${it.id}" data-r="${it.r}"${tipAttr(`${t(it.name)}${plus ? ` +${plus}` : ""}`, `${t(it.r)} ${kindName(it)} · ${itemStat(it, plus)}${on ? ` · ${t("착용 중")}` : ""}`)}>
        ${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}<span class="nm">${esc(t(it.name))}</span></button>`;
    }).join("");
    const sel = ITEM[this.gearSel];
    const selOn = sel && p.equip[sel.slot] === sel.id;
    const detail = sel ? `<div class="gear-detail" data-r="${sel.r}">${itemIcon(sel, "l")}<div><b class="sec">${esc(t(sel.name))}${plusOf(sel) ? ` +${plusOf(sel)}` : ""}</b><span class="cap"><em class="${RCLS[sel.r]}">${t(sel.r)}</em> ${kindName(sel)} · ${itemStat(sel, plusOf(sel))}</span></div>
      ${selOn ? `<span class="qdone">${t("착용 중")}</span>` : `<button class="btn" type="button" data-do="equip" data-id="${sel.id}" ${this.busy ? "disabled" : ""}>${t("착용")}</button>`}</div>` : "";
    const filters = ([["", t("전체")], ["weapon", t("무기")], ["hat", t("머리")], ["sash", t("띠")]] as [SlotId | "", string][]).map(([v, l]) =>
      `<button type="button" role="radio" class="seg-b" aria-checked="${this.gearFilter === v}" data-do="gearFilter" data-v="${v}">${l}</button>`).join("");
    const nextSkill = SKILLS.find((s) => s.unlock > p.level);
    return `${this.head(t("장비"))}${resBar([["pigment", p.pigment], ["jade", p.jade], ["stone", p.stones ?? 0]], t("새 장비는 병기 제단에서, 띠와 목도리 염색은 염색 장인에게\n붓은 수련 › 붓 강화에서 다듬는다"))}
      <div class="gear2">
        <div class="gear2-eq"><h4 class="sec">${t("착용")}</h4><div class="eqslots">${slots}</div>
          <p class="stats"><span class="pow"${tipAttr(t("전투력"), t("공격, 생명, 검법, 도감, 염색 조화를 모두 합친 힘\n랭킹은 이 순서다"))}><small>${t("전투력")}</small><b>${fmt(p.power ?? 0)}</b></span><span${tipAttr(t("공격력"), t("붓과 경지로 오른다"))}><small>${t("공격")}</small><b>${atkText(p.atk)}</b></span><span${tipAttr(t("생명"), t("경지가 오를수록 늘어난다\n머리 장비가 더 올려 준다"))}><small>${t("생명")}</small><b>${p.maxHp}</b></span></p>
          ${nextSkill ? `<p class="cap">${esc(t("{name} · Lv {lv}에 열림", { name: t(nextSkill.name), lv: nextSkill.unlock }))}</p>` : ""}</div>
        <div class="gear2-inv"><div class="inv-head"><h4 class="sec">${t("가진 장비")} <small>${owned.size} / ${ITEMS.length}</small></h4><div class="seg" role="radiogroup" aria-label="${t("부위")}">${filters}</div></div>
          <div class="tiles">${tiles}</div>${detail}</div>
      </div>`;
  }

  /** A pull's draws shown on the altar (a jade pull or the ad's free one). */
  private showPull(r: GachaResult & { profile: ProfileView }): void {
    // an older server answers without `pulls`: rebuild the rows from ids / dupes
    const pulls: GachaPull[] = r.pulls ?? r.ids.map((id, k): GachaPull => {
      const it = ITEM[id];
      const g = GACHA_EXTRA_BY_ID[id];
      return it ? { id, name: it.name, r: it.r, kind: "item", dupe: !!r.dupes[k], grant: r.dupes[k] ? dupeGrant(it) : undefined }
        : { id, name: g?.name ?? id, r: g?.r ?? "일반", kind: "material", dupe: false, grant: g?.grant };
    });
    this.pull = { pulls, at: performance.now() };
    this.ctx.apply(r.profile);
    if (r.ids.some((id) => ITEM[id]?.r === "전설")) toast(t("전설 장비를 얻었다!"));
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
    if (what === "mapSel") { this.mapSel = b.dataset.z ?? this.mapSel; this.render(); return; }
    if (what === "travel") { const to = b.dataset.z ?? ""; this.close(); this.ctx.travel?.(to); return; }
    if (what === "gearFilter") { this.gearFilter = (b.dataset.v ?? "") as SlotId | ""; this.render(); return; }
    this.busy = true;
    this.render();
    try {
      if (what && (await growthAction(what, b, api, this.ctx.profile(), this.growthState, this.ctx.apply, () => { if (this.current) this.render(); }))) {
        // handled by the growth sheet; gate 9b: the first failure while 잿불귀 waits teaches that only stones are lost
        const ms = mainStatus(this.ctx.profile());
        if (what === "enhance" && this.growthState.stage === "fail" && ms?.accepted && ms.q.id === "c2q10") this.ctx.hint?.("gate9b", t("먹돌만 날아갔다\n붓은 멀쩡하다"));
      } else if (what === "claimDaily") {
        const i = Number(b.dataset.i);
        const p = await attempt(api.claimDaily(i));
        if (p) { this.ctx.apply(p); toast(t("오늘의 의뢰 완료 · {reward}", { reward: rewardText(DAILY_QUESTS[i]) })); audio.play("quest-done"); }
      } else if (what === "claimDailyAll") {
        const p = await attempt(api.claimDailyAll());
        if (p) { this.ctx.apply(p); toast(t("오늘의 의뢰 보상을 모두 받았다")); audio.play("quest-done"); }
      } else if (what === "dye") {
        const d = DYES[Number(b.dataset.k)];
        const p = await attempt(api.dye(b.dataset.t === "scarf" ? "scarf" : "sash", d.hex));
        if (p) { this.ctx.apply(p); toast(d.hex == null ? t("검정으로 되돌렸다") : withRo(d.name) === "로" ? t("{dye}로 물들였다", { dye: t(d.name) }) : t("{dye}으로 물들였다", { dye: t(d.name) })); }
      } else if (what === "potion") {
        const n = Number(b.dataset.n);
        const p = await attempt(api.buyPotions(n));
        if (p) { this.ctx.apply(p); toast(t("물약 {n}개를 샀다", { n })); }
      } else if (what === "pull") {
        const n = b.dataset.n === "10" ? 10 : 1;
        const r = await attempt(api.pullGacha(n));
        if (r) this.showPull(r);
      } else if (what === "adPull") {
        const r = await attempt(api.freePullWithAd());
        if (r) this.showPull(r);
      } else if (what === "adDouble") {
        const p = await attempt(api.dailyDoubleWithAd());
        if (p) { this.ctx.apply(p); toast(t("오늘의 의뢰 보상을 한 번 더 받았다")); audio.play("quest-done"); }
      } else if (what === "ad") {
        const p = await attempt(api.watchAdForJade());
        if (p) { this.ctx.apply(p); toast(t("묵옥 +{n}", { n: AD_REWARD_JADE })); }
      } else if (what === "buy") {
        const id = b.dataset.id ?? "";
        const prod = JADE_PRODUCTS.find((j) => j.productId === id);
        const ok = await attempt(api.buyJade(id).then(() => true));
        if (ok) {
          const p = await attempt(api.loadProfile());
          if (p) this.ctx.apply(p);
          if (prod) toast(`${t("{label} 충전", { label: t(prod.label) })}${api.mode === "local" ? ` (${t("모의")})` : ""}`);
        }
      } else if (what === "equip") {
        const id = b.dataset.id ?? "";
        const p = await attempt(api.equip(id));
        if (p) { this.ctx.apply(p); toast(t("{name} 착용", { name: ITEM[id] ? t(ITEM[id].name) : t("장비") })); }
      }
    } finally {
      this.busy = false;
      if (this.current) this.render();
    }
  }
}
