// DOM helpers: element lookup, sprite sheets, toasts and readable Korean error messages.

import type { ItemDef } from "../../shared/items";
import type { RuleCode } from "../../shared/types";

export function el<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`missing element ${sel}`);
  return e;
}

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
  };
  for (const [k, v] of Object.entries(kit)) root.setProperty(k, `url("${url(v)}")`);
  const style = document.createElement("style");
  style.textContent = `
    .ic-item { background-image: url("${url("./assets/items.png")}"); }
    .ic-sk, .ic-pigment, .ic-jade { background-image: url("${url("./assets/skills.png")}"); }`;
  document.head.appendChild(style);
}

export function itemIcon(it: ItemDef): string {
  const col = it.icon % 4, row = Math.floor(it.icon / 4);
  return `<i class="spr ic-item" style="background-position:${col * 33.333}% ${row * 33.333}%" aria-hidden="true"></i>`;
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
  bad_args: "요청이 올바르지 않습니다.",
  not_ready: "아직 준비 중입니다. 잠시 뒤 다시 해 보세요.",
  no_profile: "기록을 불러오지 못했습니다.",
  too_far: "너무 멉니다. 조금 더 가까이 가세요.",
  on_cooldown: "아직 다시 쓸 수 없습니다.",
  locked: "아직 쓸 수 없습니다. 경지를 더 올려야 합니다.",
  dead: "먹에 잠긴 동안에는 할 수 없습니다.",
  not_owned: "가지고 있지 않은 장비입니다.",
  no_currency: "재화가 부족합니다.",
  no_ads_left: "오늘 볼 수 있는 광고를 모두 봤습니다.",
  room_full: "이 채널이 가득 찼습니다.",
  wrong_room: "다른 지역의 일입니다.",
  quest_not_done: "아직 의뢰를 마치지 못했습니다.",
  already_claimed: "이미 보상을 받았습니다.",
  name_taken: "이미 쓰는 이름입니다.",
  bad_name: "쓸 수 없는 이름이다. 한글·영문·숫자 2~8자, 거친 말은 안 된다.",
  rate_limited: "조금 천천히 해 주세요.",
};

export function errorCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  if (e instanceof Error && e.message in RULE_TEXT) return e.message;
  return null;
}

export function errorText(e: unknown): string {
  const code = errorCode(e);
  if (code && code in RULE_TEXT) return RULE_TEXT[code as RuleCode];
  return "연결이 고르지 않습니다. 잠시 뒤 다시 해 보세요.";
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
