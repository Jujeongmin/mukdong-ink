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

/** Sprite sheet rules with URLs resolved against the page, so they work on any Verse8 sub-path. */
export function installSprites(): void {
  const url = (p: string) => new URL(p, document.baseURI).href;
  const base = `
    .ic-item { background-image: url("${url("./assets/items.png")}"); }
    .ic-sk, .ic-pigment, .ic-jade { background-image: url("${url("./assets/skills.png")}"); }`;
  const paintRule = (u: string) => `
    .spr-stroke, .spr-enso, .spr-frame, .spr-seal, .tag.portal::before, .tabs [aria-selected="true"]::after, .sheet-card, .dlg-box { background-image: url("${u}"); }`;
  const style = document.createElement("style");
  style.textContent = base;
  document.head.appendChild(style);
  // ui.png is painted on opaque paper. The HUD floats over the WebGL canvas in its own layer, where
  // blend modes can't reach the canvas, so lift the paper out once: ink becomes alpha, cinnabar keeps
  // its hue. The result is a one-time object URL (about 6 MB of pixels, decoded once).
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) throw new Error("no 2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      const PR = 233, PG = 224, PB = 204; // the sheet's paper
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        const diff = Math.max(PR - r, PG - gg, PB - b, Math.abs(r - PR) * 0.5);
        const a = Math.min(1, Math.max(0, (diff - 18) / 150));
        if (a <= 0) { px[i + 3] = 0; continue; }
        // un-mix the paper so edges stay dark instead of turning beige
        px[i] = Math.max(0, Math.min(255, (r - PR * (1 - a)) / a));
        px[i + 1] = Math.max(0, Math.min(255, (gg - PG * (1 - a)) / a));
        px[i + 2] = Math.max(0, Math.min(255, (b - PB * (1 - a)) / a));
        px[i + 3] = Math.round(a * 255);
      }
      g.putImageData(d, 0, 0);
      c.toBlob((blob) => {
        if (blob) style.textContent = base + paintRule(URL.createObjectURL(blob));
        c.width = c.height = 0; // free the canvas backing store
      }, "image/png");
    } catch {
      style.textContent = base + paintRule(url("./assets/ui.png"));
    }
  };
  img.onerror = () => { style.textContent = base + paintRule(url("./assets/ui.png")); };
  img.src = url("./assets/ui.png");
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
  bad_name: "이름은 한글·영문·숫자 2~10자로 지어 주세요.",
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
