// The settings menu (one sheet with tabs: 소리 / 그래픽 / 조작 / 게임 / 정보) and the per-device settings store
// ("ink.settings" in localStorage). Everything applies live through `gameSettings.onChange`.

import { version } from "../../../package.json";
import { audio } from "../audio";
import { getQuality } from "../render/gfx";
import { bindSliders, esc, sliderHtml } from "./dom";
import { KEYS } from "./input";

export type Quality = "low" | "mid" | "high" | "auto";
export type NameMode = "all" | "mine" | "off";

export interface GameSettings {
  quality: Quality;
  /** camera shake on hits */
  shake: boolean;
  /** damage numbers over monsters and the player */
  dmgNumbers: boolean;
  /** fewer effects and sounds from other players */
  lowRemote: boolean;
  names: NameMode;
  chat: boolean;
  /** hide lines the server masked */
  chatFilter: boolean;
  /** drink a potion by itself when HP drops below potionAt (hunting zones, manual play too) */
  autoPotion: boolean;
  /** 0.2–0.7 of max HP */
  potionAt: number;
}

const DEFAULTS: GameSettings = { quality: "auto", shake: true, dmgNumbers: true, lowRemote: false, names: "all", chat: true, chatFilter: true, autoPotion: true, potionAt: 0.4 };
const STORE = "ink.settings";

class SettingsStore {
  readonly v: GameSettings = { ...DEFAULTS };
  private readonly fns: ((s: GameSettings) => void)[] = [];

  /** the stored settings already had their own potion choice (else the old auto-battle one is migrated) */
  hasPotion = false;

  constructor() {
    try {
      const raw = window.localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<GameSettings> & { framing?: unknown };
        // the corner framing art is gone: drop its stored switch
        if ("framing" in saved) { delete saved.framing; window.localStorage.setItem(STORE, JSON.stringify({ ...this.v, ...saved })); }
        this.hasPotion = "autoPotion" in saved;
        Object.assign(this.v, saved);
      }
    } catch {
      // storage blocked: defaults
    }
  }

  set(patch: Partial<GameSettings>): void {
    Object.assign(this.v, patch);
    try { window.localStorage.setItem(STORE, JSON.stringify(this.v)); } catch { /* not persisted */ }
    for (const f of this.fns) f(this.v);
  }

  /** Called now and on every change. */
  onChange(f: (s: GameSettings) => void): void {
    this.fns.push(f);
    f(this.v);
  }
}

export const gameSettings = new SettingsStore();

export const SETTINGS_TABS: [string, string][] = [["sound", "소리"], ["gfx", "그래픽"], ["keys", "조작"], ["game", "게임"], ["info", "정보"]];

export interface SettingsCtx {
  /** the player's nickname (never the account id) */
  name(): string;
  resetHints(): void;
  openAuto(): void;
}

const toggle = (key: keyof GameSettings, label: string, sub = "", disabled = false) =>
  `<label class="set-row ink-toggle${disabled ? " off" : ""}"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" data-set="${key}" ${gameSettings.v[key] && !disabled ? "checked" : ""} ${disabled ? "disabled" : ""}><i aria-hidden="true"></i></label>`;

const LEVEL_NAME: Record<string, string> = { low: "낮음", mid: "보통", high: "높음" };

function choice<T extends string>(key: keyof GameSettings, label: string, opts: [T, string][]): string {
  const cur = gameSettings.v[key];
  return `<div class="set-row"><span>${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([v, l]) =>
    `<button type="button" role="radio" class="seg-b" aria-checked="${cur === v}" data-choice="${key}" data-v="${v}">${l}</button>`).join("")}</div></div>`;
}

function slider(k: "master" | "music" | "sfx", label: string): string {
  return sliderHtml({ key: `vol-${k}`, label, value: audio.settings[k], accent: k === "master" });
}

/** The auto-potion threshold (also in the auto-battle popover): 20–70 % of max HP, in 5 % steps. */
export function potionSlider(): string {
  return sliderHtml({ key: "potion-at", label: "물약 기준", value: Math.round(gameSettings.v.potionAt * 100), min: 20, max: 70, step: 5, unit: "%" });
}

/** Slider keys shared by the settings sheet and the auto-battle popover. */
export function onSlider(key: string, v: number): void {
  if (key === "potion-at") gameSettings.set({ potionAt: v / 100 });
  else if (key === "vol-master" || key === "vol-music" || key === "vol-sfx") audio.set({ [key.slice(4)]: v });
}

const KEY_ROWS: [string, string][] = [
  [KEYS.move, "걷기"],
  ["Space · Shift · 우클릭", "구르기 (구르는 동안은 맞지 않는다)"],
  ["좌클릭 · J", "베기, 누르고 있으면 이어 베기"],
  ["1 · 2 · 3 · 4 · 5", "오방 검법 (물결·화염·대지·바람·먹), 커서 쪽으로. 고리를 눌러도 된다. 자동 사냥 중엔 저절로"],
  [KEYS.auto, "자동 사냥"],
  [KEYS.potion, "물약"],
  [KEYS.talk, "말 걸기"],
  [KEYS.gear, "장비"],
  [KEYS.growth, "수련"],
  [KEYS.help, "조작 안내"],
  [KEYS.mute, "소리 끄기·켜기"],
  ["Enter", "채팅"],
  ["Esc", "설정 · 창 닫기"],
];

export function settingsHtml(tab: string, ctx: SettingsCtx): string {
  if (tab === "sound") {
    return `<div class="set-list">
      ${slider("master", "전체")}${slider("music", "음악")}${slider("sfx", "효과음")}
      <label class="set-row ink-toggle"><span>음소거<small>${KEYS.mute} 키로도 켜고 끈다</small></span><input type="checkbox" data-mute ${audio.settings.muted ? "checked" : ""}><i aria-hidden="true"></i></label>
    </div>`;
  }
  if (tab === "gfx") {
    const q = getQuality();
    return `<div class="set-list">
      ${choice<Quality>("quality", "품질", [["low", "낮음"], ["mid", "보통"], ["high", "높음"], ["auto", `자동 (${LEVEL_NAME[q.level] ?? q.level})`]])}
      ${toggle("shake", "화면 흔들림", "벨 때 화면이 떨린다")}
      ${toggle("dmgNumbers", "데미지 숫자")}
      ${toggle("lowRemote", "다른 유저 효과 줄이기", "다른 이들의 검법 효과와 소리를 줄인다")}
    </div>`;
  }
  if (tab === "keys") {
    return `<table class="key-table"><tbody>${KEY_ROWS.map(([k, d]) => `<tr><th><kbd>${esc(k)}</kbd></th><td>${esc(d)}</td></tr>`).join("")}</tbody></table>
      <p class="sub">모바일: 왼쪽 원으로 걷고, 오른쪽 고리로 베고 구른다. 말 버튼으로 채팅.</p>
      <button type="button" class="btn btn-secondary btn-sm" data-open-auto>자동 사냥 설정 열기</button>`;
  }
  if (tab === "game") {
    return `<div class="set-list">
      ${choice<NameMode>("names", "이름표", [["all", "모두"], ["mine", "나와 NPC"], ["off", "끄기"]])}
      ${toggle("chat", "채팅 표시")}
      ${toggle("chatFilter", "채팅 거르기", "가려진 말은 아예 보이지 않게")}
      ${toggle("autoPotion", "물약 자동 사용", "사냥터에서 생명이 기준 아래로 떨어지면 저절로 마신다")}
      ${potionSlider()}
      <div class="set-row"><span>힌트 다시 보기<small>이 계정의 안내 혼잣말을 처음부터</small></span><button type="button" class="btn btn-secondary btn-sm" data-reset-hints>다시 보기</button></div>
      <p class="set-confirm" data-confirm hidden>정말 처음부터 다시 볼까? <button type="button" class="btn btn-sm btn-danger" data-reset-yes>그래</button> <button type="button" class="btn btn-secondary btn-sm" data-reset-no>아니</button></p>
    </div>`;
  }
  // 정보
  return `<dl class="info-list">
      <dt>이름</dt><dd>${esc(ctx.name() || "먹동이")}</dd>
      <dt>판</dt><dd>${esc(version)}</dd>
    </dl>
    <h3>만든 것들</h3>
    <ul class="credits">
      <li><b>움직임</b> Quaternius, Universal Animation Library 2 (CC0)</li>
      <li><b>음악과 효과음</b> 이 게임을 위해 PixelLab(pixellab.ai)으로 만들었다</li>
      <li><b>그림</b> 먹 도구, 표지와 불러오기 그림, 검법과 장비 그림: 이 게임을 위해 Codex로 만들었다</li>
    </ul>`;
}

/** Wire the controls after a render. `rerender` redraws the sheet. */
export function bindSettings(card: HTMLElement, rerender: () => void, ctx: SettingsCtx): void {
  card.querySelectorAll<HTMLInputElement>("[data-set]").forEach((c) => c.addEventListener("change", () => {
    gameSettings.set({ [c.dataset.set as keyof GameSettings]: c.checked } as Partial<GameSettings>);
  }));
  card.querySelectorAll<HTMLElement>("[data-choice]").forEach((b) => b.addEventListener("click", () => {
    gameSettings.set({ [b.dataset.choice as keyof GameSettings]: b.dataset.v } as Partial<GameSettings>);
    rerender();
  }));
  bindSliders(card, onSlider);
  card.querySelector<HTMLInputElement>("[data-mute]")?.addEventListener("change", (e) => audio.set({ muted: (e.target as HTMLInputElement).checked }));
  card.querySelector("[data-open-auto]")?.addEventListener("click", () => ctx.openAuto());
  const confirm = card.querySelector<HTMLElement>("[data-confirm]");
  card.querySelector("[data-reset-hints]")?.addEventListener("click", () => { if (confirm) confirm.hidden = false; });
  card.querySelector("[data-reset-no]")?.addEventListener("click", () => { if (confirm) confirm.hidden = true; });
  card.querySelector("[data-reset-yes]")?.addEventListener("click", () => { ctx.resetHints(); if (confirm) confirm.hidden = true; });
}
