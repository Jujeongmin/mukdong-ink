// Languages: Korean is the source; every other language is a dictionary keyed by the Korean text itself
// (src/game/i18n/<lang>.json). `t("한국어 {n}", { n })` looks the Korean up and fills {placeholders}. A missing entry
// falls back to the Korean. The dictionary is loaded before the game modules are evaluated (see main.ts), so
// module-level tables may call t() too. Changing the language reloads the page.
// Keys: `npm run i18n:keys` lists every key the code and the shared data use (tools/i18n-keys.mjs).

import { fillKo } from "./josa";

export type Lang = "ko" | "en" | "ja" | "zh-Hant" | "zh-Hans";

/** Each language named in itself, for the picker. */
export const LANGS: readonly { id: Lang; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "zh-Hant", label: "繁體中文" },
  { id: "zh-Hans", label: "简体中文" },
];

const STORE_KEY = "ink.lang";
const LOADERS: Record<Exclude<Lang, "ko">, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import("./i18n/en.json"),
  ja: () => import("./i18n/ja.json"),
  "zh-Hant": () => import("./i18n/zh-Hant.json"),
  "zh-Hans": () => import("./i18n/zh-Hans.json"),
};
/** Web fonts per language (Google Fonts serves only the glyph ranges a page uses). */
const FONTS: Partial<Record<Lang, string>> = {
  ja: "Shippori+Mincho:wght@400;700&family=Zen+Kaku+Gothic+New:wght@400;700",
  "zh-Hant": "Noto+Serif+TC:wght@400;700&family=Noto+Sans+TC:wght@400;700",
  "zh-Hans": "Noto+Serif+SC:wght@400;700&family=Noto+Sans+SC:wght@400;700",
};

let lang: Lang = "ko";
let dict: Record<string, string> = {};

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && LANGS.some((l) => l.id === v);
}

/** The saved choice, else the browser's language (Chinese split into Traditional and Simplified), else Korean. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* storage blocked: go by the browser */ }
  const prefs = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  for (const raw of prefs) {
    const p = (raw || "").toLowerCase();
    if (p.startsWith("ko")) return "ko";
    if (p.startsWith("ja")) return "ja";
    if (p.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(p) ? "zh-Hant" : "zh-Hans";
    if (p.startsWith("en")) return "en";
  }
  return prefs.length ? "en" : "ko";
}

/** Load the dictionary and fonts for the chosen language; call once before the game modules load. */
export async function initLang(): Promise<void> {
  lang = detectLang();
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  if (lang === "ko") return;
  const fonts = FONTS[lang];
  if (fonts) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${fonts}&display=swap`;
    document.head.appendChild(link);
  }
  try {
    dict = (await LOADERS[lang]()).default;
  } catch (e) {
    console.error("language pack failed to load", e);
    dict = {};
  }
  // words drawn by CSS (::after content) come from these variables
  const css: [string, string][] = [["--tx-auto", t("자동")], ["--tx-manual", t("수동")], ["--tx-worn", t("착용 중")], ["--tx-next", t("눌러서 넘기기")]];
  for (const [v, text] of css) document.documentElement.style.setProperty(v, JSON.stringify(text));
  // the boot splash in index.html is plain Korean: put it into the chosen language
  document.title = t("채묵: 잃어버린 색");
  const set = (sel: string, ko: string) => { const n = document.querySelector(sel); if (n) n.textContent = t(ko); };
  set(".boot-title", "채묵");
  set(".boot-sub:not(.boot-load)", "잃어버린 색");
  set(".boot-load", "먹을 가는 중…");
}

export function getLang(): Lang {
  return lang;
}

/** Save a new language and reload into it. */
export function setLang(next: Lang): void {
  if (next === lang) return;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* the reload goes by the browser then */ }
  location.reload();
}

/**
 * The text in the current language. `ko` is the Korean source (also the dictionary key); `{name}` placeholders
 * (latin names only) are filled from `vars`. `{이름}` / `{이름/아}` are left for fillName (the player's nickname).
 */
export function t(ko: string, vars?: Record<string, string | number>): string {
  let s = lang === "ko" ? ko : dict[ko] ?? ko;
  if (!vars) return s;
  if (lang !== "ko") return s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return fillKo(s, vars);
}

