// DOM helpers: element lookup, sprite sheets, toasts and readable Korean error messages.

import type { ItemDef } from "../../shared/items";
import type { RuleCode } from "../../shared/types";
import { installTooltips } from "./tooltip";
import { t } from "../i18n";

export function el<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`missing element ${sel}`);
  return e;
}

/** Each 검법's own color in the UI (cooldown rings, the 수련 sheet), by skill index. */
export const SKILL_COLOR = ["#2f4f9e", "#d4462a", "#c08a2a", "#8fc7cf", "#3b2a48"];

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Sprite sheets and the UI ink kit, with URLs resolved against the page so they work on any Verse8 sub-path.
 * The kit (public/assets/ui/) is a paper tile plus alpha masks; CSS colors them (mask-image), so each image
 * is loaded once by the browser and never copied into a canvas.
 */
export function installSprites(): void {
  const url = (p: string) => new URL(p, document.baseURI).href;
  const root = document.documentElement.style;
  const kit: Record<string, string> = {
    "--paper-tile": "./assets/ui/ui-paper.jpg",
    "--m-frame": "./assets/ui/ui-frame.png",
    "--m-stroke": "./assets/ui/ui-stroke.png",
    "--m-line": "./assets/ui/ui-line.png",
    "--m-enso": "./assets/ui/ui-enso.png",
    "--m-dab": "./assets/ui/ui-dab.png",
    "--m-splash": "./assets/ui/ui-splash.png",
    "--sheet-mat": "./assets/materials2.webp",
    "--sheet-hud": "./assets/hud_icons3.png",
    "--ult-icon": "./assets/ui/ult_icon.webp",
  };
  for (const [k, v] of Object.entries(kit)) root.setProperty(k, `url("${url(v)}")`);
  // ink-sketch sheets (v3, redrawn to match the prologue paintings); new names so deploy caches can't serve the old ones
  const style = document.createElement("style");
  style.textContent = `
    .ic-item { background-image: url("${url("./assets/items_v3.webp")}"); }
    .ic-sk, .ic-pigment, .ic-jade { background-image: url("${url("./assets/skills_v3.webp")}"); }
    .ic-mat { background-image: url("${url("./assets/materials2.webp")}"); }
    .ic-item.w2 { background-image: url("${url("./assets/weapons3.webp")}"); }`;
  document.head.appendChild(style);
  // a sheet that fails to load would leave empty frames: say so in the console instead of failing silently
  for (const f of ["items_v3.webp", "skills_v3.webp", "materials2.webp", "weapons3.webp"]) {
    const img = new Image();
    img.onerror = () => console.warn(`[ui] icon sheet failed to load: ${f}`);
    img.src = url(`./assets/${f}`);
  }
  installTooltips();
}

/**
 * An item picture. Positions are on the element itself; the sheet is set on `.ic-item` above.
 * The element is a plain block sized by CSS (44 px by default; `.ic-item.s` / `.l` / `.xl` for other sizes).
 */
export function itemIcon(it: ItemDef, size = ""): string {
  const w2 = weapons2Cell(it);
  if (w2 >= 0) {
    // weapons3.webp: 3×2, the swords
    return `<i class="spr ic-item w2${size ? ` ${size}` : ""}" style="background-position:${(w2 % 3) * 50}% ${Math.floor(w2 / 3) * 100}%" aria-hidden="true"></i>`;
  }
  const col = it.icon % 4, row = Math.floor(it.icon / 4);
  return `<i class="spr ic-item${size ? ` ${size}` : ""}" style="background-position:${col * 33.333}% ${row * 33.333}%" aria-hidden="true"></i>`;
}

/** The swords' cells in weapons3.webp, by id (used until / unless the item names its atlas). */
const WEAPONS2: Record<string, number> = { w_inkblade: 0, w_reedblade: 1, w_rainblade: 2, w_nightblade: 3, w_voidblade: 4 };
/** Cell in weapons3.webp, or -1 for an items_v3.webp item. An `atlas: "weapons2"` field wins and uses `icon` as the cell. */
function weapons2Cell(it: ItemDef): number {
  if (it.atlas === "weapons2") return it.icon;
  if (it.atlas) return -1;
  return WEAPONS2[it.id] ?? -1;
}

/* ---------- resources: one picture, name and how-to-get line per currency / material ---------- */
export type ResKind = "pigment" | "jade" | "stone" | "shard" | "protect" | "potion" | "points" | "exp";
export const RES: Record<ResKind, { name: string; tip: string }> = {
  pigment: { name: t("안료"), tip: t("사냥으로 얻는 재화\n수련, 염색, 물약에 쓴다") },
  jade: { name: t("묵옥"), tip: t("뽑기와 파괴방지권에 쓰는 귀한 옥\n광고 보상, 보스, 상점에서 얻는다") },
  stone: { name: t("먹돌"), tip: t("먹귀신이 떨군다\n붓을 강화할 때 쓴다") },
  shard: { name: t("색 조각"), tip: t("먹귀신이 드물게, 우두머리가 꼭 떨군다\n검법을 깨울 때(5·10단계) 쓴다") },
  protect: { name: t("파괴방지권"), tip: t("강화가 실패해도 붓이 부서지지 않게 지킨다\n묵옥으로 산다") },
  potion: { name: t("물약"), tip: t("생명을 크게 채운다\n염색 장인에게 안료로 산다") },
  points: { name: t("수련 포인트"), tip: t("경지가 오를 때마다 하나, 의뢰로도 얻는다\n검법 단련에 쓴다") },
  exp: { name: t("경험"), tip: t("쌓이면 경지가 오른다") },
};

/** The picture for a resource (`.ic-res` sizes it; pigment / jade come from the skills sheet, the rest from materials2.webp). */
export function resIcon(k: ResKind, size = ""): string {
  const cls = k === "pigment" ? "ic-pigment" : k === "jade" ? "ic-jade" : k === "points" ? "ic-pts" : k === "exp" ? "ic-exp" : `ic-mat ic-mat-${k}`;
  return `<i class="spr ic-res ${cls}${size ? ` ${size}` : ""}" aria-hidden="true"></i>`;
}

/** Tooltip attributes (see tooltip.ts): a title line and a short body. */
export function tipAttr(title: string, body = ""): string {
  return ` data-tip-title="${esc(title)}"${body ? ` data-tip="${esc(body)}"` : ` data-tip=""`}`;
}

/**
 * A resource chip: picture + number (tabular). `need` turns it into a cost chip ("have / need" colouring),
 * `short` marks it as not enough.
 */
export function resChip(k: ResKind, n: number, opt: { need?: boolean; short?: boolean; label?: boolean } = {}): string {
  const r = RES[k];
  const num = k === "exp" ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR");
  return `<span class="rchip${opt.need ? " cost" : ""}${opt.short ? " short" : ""}"${tipAttr(r.name, r.tip)} aria-label="${esc(r.name)} ${num}">${resIcon(k)}${opt.label ? `<em>${esc(r.name)}</em>` : ""}<b>${num}</b></span>`;
}

/** The resource bar at the top of a sheet, with an optional "?" tablet holding a two-line tip. */
export function resBar(items: [ResKind, number][], help = ""): string {
  const q = help ? `<button type="button" class="tipq" data-tip-click${tipAttr(t("도움말"), help)} aria-label="${t("도움말")}">?</button>` : "";
  return `<div class="resbar">${items.map(([k, n]) => resChip(k, n)).join("")}${q}</div>`;
}

/* ---------- ink slider: one component for every 0–100 style setting ---------- */
export interface SliderOpts {
  /** data attribute key for the input: `data-sl="<key>"` */
  key: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** shown after the number ("%") */
  unit?: string;
  /** cinnabar fill (the master volume) */
  accent?: boolean;
  sub?: string;
}

export function sliderHtml(o: SliderOpts): string {
  const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1;
  const p = ((o.value - min) / (max - min)) * 100;
  const id = `sl-${o.key}`;
  return `<div class="isl${o.accent ? " accent" : ""}" style="--p:${p.toFixed(2)}">
    <label class="isl-l" for="${id}">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</label>
    <span class="isl-track"><i class="isl-groove" aria-hidden="true"></i><i class="isl-ticks" aria-hidden="true"></i><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${o.value}" data-sl="${esc(o.key)}" data-unit="${esc(o.unit ?? "")}"><b class="isl-bubble" aria-hidden="true">${o.value}${esc(o.unit ?? "")}</b></span>
    <output class="isl-v" for="${id}">${o.value}<small>${esc(o.unit ?? "")}</small></output>
  </div>`;
}

/**
 * Wire every `.isl` slider under `root`. Arrow keys move ±5 steps of 1 (or one step when the step is larger),
 * Page keys ±10, Home/End to the ends; the bubble over the thumb shows while dragging or keyboard-focused.
 */
export function bindSliders(root: ParentNode, onInput: (key: string, v: number) => void): void {
  root.querySelectorAll<HTMLInputElement>(".isl input[type=range]").forEach((r) => {
    const box = r.closest<HTMLElement>(".isl");
    if (!box) return;
    const min = Number(r.min), max = Number(r.max), step = Number(r.step) || 1;
    const unit = r.dataset.unit ?? "";
    const out = box.querySelector<HTMLElement>(".isl-v");
    const bubble = box.querySelector<HTMLElement>(".isl-bubble");
    const show = (v: number) => {
      box.style.setProperty("--p", (((v - min) / (max - min)) * 100).toFixed(2));
      if (out) out.innerHTML = `${v}<small>${esc(unit)}</small>`;
      if (bubble) bubble.textContent = `${v}${unit}`;
    };
    const set = (v: number) => {
      const c = Math.min(max, Math.max(min, Math.round(v / step) * step));
      if (c === Number(r.value)) return;
      r.value = String(c);
      show(c);
      onInput(r.dataset.sl ?? "", c);
    };
    r.addEventListener("input", () => { show(Number(r.value)); onInput(r.dataset.sl ?? "", Number(r.value)); });
    r.addEventListener("keydown", (e) => {
      const big = step > 1 ? step : 5;
      const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? big : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -big
        : e.key === "PageUp" ? 10 : e.key === "PageDown" ? -10 : 0;
      if (d) { e.preventDefault(); set(Number(r.value) + d); }
      else if (e.key === "Home") { e.preventDefault(); set(min); }
      else if (e.key === "End") { e.preventDefault(); set(max); }
    });
    r.addEventListener("pointerdown", () => box.classList.add("drag"));
    const up = () => box.classList.remove("drag");
    r.addEventListener("pointerup", up);
    r.addEventListener("pointercancel", up);
    r.addEventListener("blur", up);
  });
}
export function skillIconPos(cell: number): string {
  return `${(cell % 3) * 50}% ${Math.floor(cell / 3) * 50}%`;
}

/* ---------- toasts ---------- */
let toastBox: HTMLElement | null = null;
export function toast(msg: string, err = false): void {
  if (!toastBox) toastBox = document.querySelector<HTMLElement>(".toasts");
  if (!toastBox) return;
  while (toastBox.childElementCount >= 3) toastBox.firstElementChild?.remove();
  const t = document.createElement("div");
  t.className = err ? "toast err" : "toast";
  t.textContent = msg;
  toastBox.appendChild(t);
  window.setTimeout(() => {
    t.classList.add("out");
    window.setTimeout(() => t.remove(), 360);
  }, err ? 2400 : 1900);
}

const RULE_TEXT: Record<RuleCode, string> = {
  bad_args: t("지금은 그렇게 할 수 없다"),
  not_ready: t("잠깐, 아직 준비가 덜 됐다\n조금 뒤에 다시"),
  no_profile: t("기록을 불러오지 못했다\n다시 들어와 보자"),
  too_far: t("너무 멀다\n조금 더 다가가자"),
  on_cooldown: t("아직이다\n조금 기다리자"),
  locked: t("아직 쓸 수 없다\n경지를 더 올리자"),
  not_dead: t("이미 일어나 있다"),
  dead: t("먹에 잠긴 채로는 할 수 없다"),
  not_owned: t("가지고 있지 않은 장비다"),
  no_currency: t("재화가 모자라다"),
  no_ads_left: t("오늘 볼 수 있는 광고는 다 봤다"),
  room_full: t("이 채널은 가득 찼다"),
  wrong_room: t("여기서 할 일이 아니다"),
  quest_not_done: t("아직 의뢰를 다 하지 못했다"),
  already_claimed: t("이미 받은 보상이다"),
  name_taken: t("이미 누가 쓰는 이름이다"),
  bad_name: t("쓸 수 없는 이름이다\n한글·영문·숫자 2~8자, 거친 말은 안 된다"),
  rate_limited: t("조금 천천히 하자"),
};

export function errorCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  if (e instanceof Error && e.message in RULE_TEXT) return e.message;
  return null;
}

export function errorText(e: unknown): string {
  const code = errorCode(e);
  if (code && code in RULE_TEXT) return RULE_TEXT[code as RuleCode];
  return t("연결이 고르지 않다\n잠시 뒤에 다시 해 보자");
}

/** Run an api call; show a readable toast on failure and return null. */
export async function attempt<T>(p: Promise<T>, quiet: readonly string[] = []): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    const code = errorCode(e);
    if (!code || !quiet.includes(code)) toast(errorText(e), true);
    if (!code) console.warn("[api]", e);
    return null;
  }
}
