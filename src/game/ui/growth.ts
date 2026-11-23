// Growth sheet bodies: 검법 단련 (training points into skills, awakenings at 5 and 10) and 붓 강화
// (+1..+15, failure, destruction from DESTROY_FROM, 파괴방지권). Numbers come from shared/growth.ts; the
// server rolls. Markup only uses CSS classes (ui-sheets.css .gr2-*, .enh2-*), so the look can change freely.
//
// 검법 단련 is two panes: a compact skill list (icon, name, Lv badge, ink-dab pips with ensō rings at 5 and 10)
// and the selected skill's detail (next step in plain words, the two awakenings, cost chips, one big button).
// Phones: the list, and the detail slides up as a card.

import { SKILLS } from "../../shared/combat";
import { ITEM, ITEMS } from "../../shared/items";
import { cdMulOf } from "../../shared/profile";
import {
  AWAKENINGS, AWAKEN_AT, DESTROY_FROM, ENHANCE_MAX, ENHANCE_TABLE, MATERIALS, PROTECT_PRICE, SKILL_MAX, UNBREAKABLE,
  atkText, enhancedAtk, pointsEarned, pointsSpent, skillCdMul, skillDmgMul, trainCost, type EnhanceOutcome,
} from "../../shared/growth";
import type { GameApi, ProfileView } from "../../net/api";
import { SKILL_COLOR, attempt, esc, itemIcon, resBar, resChip, skillIconPos, tipAttr, toast } from "./dom";
import { audio } from "../audio";
import { t } from "../i18n";

export interface GrowthState {
  brush: string;
  protect: boolean;
  stage: "" | "trying" | EnhanceOutcome;
  /** the brush that just broke, shown shattering once */
  gone?: string;
  /** a tutorial gate points here: 화염선풍's first awakening (gate 8) or the odds table (gate 9) */
  focus?: "awaken1" | "odds";
  /** the skill shown in the detail pane */
  skill?: number;
  /** phones: the detail card is up; `slide` plays its entrance once */
  detail?: boolean;
  slide?: boolean;
}

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;
const sec = (v: number) => t("{n}초", { n: +v.toFixed(1) });

export function freePoints(p: ProfileView): number {
  return p.points ?? pointsEarned(p.level, p.bonusPoints ?? 0) - pointsSpent(p.skills ?? []);
}

/** Selection-only actions (no server call, no busy state). */
export function growthLocal(what: string, b: HTMLElement, st: GrowthState): boolean {
  if (what === "pickSkill") { st.skill = Number(b.dataset.i); st.detail = true; st.slide = true; return true; }
  if (what === "closeDetail") { st.detail = false; return true; }
  if (what === "pickBrush") { st.brush = b.dataset.id ?? st.brush; st.stage = ""; return true; }
  if (what === "toggleProtect") { st.protect = !st.protect; return true; }
  return false;
}

/* ---------- 검법 단련 ---------- */
function pips(lv: number, focusAt = 0): string {
  let h = "";
  for (let k = 1; k <= SKILL_MAX; k++) {
    const ms = (AWAKEN_AT as readonly number[]).includes(k);
    h += `<i class="pip${ms ? " ms" : ""}${k <= lv ? " on" : ""}${k === focusAt ? " focus" : ""}"></i>`;
  }
  return `<span class="pips" aria-hidden="true">${h}</span>`;
}

export function skillsHtml(p: ProfileView, busy: boolean, st: GrowthState): string {
  const pts = freePoints(p);
  const focus = st.focus === "awaken1";
  if (st.skill == null) st.skill = focus ? 1 : 0;
  if (focus && st.detail == null) st.detail = true;
  const sel = Math.max(0, Math.min(SKILLS.length - 1, st.skill));

  const rows = SKILLS.map((s, i) => {
    const lv = p.skills?.[i] ?? 1;
    const locked = p.level < s.unlock;
    const c = trainCost(lv);
    const ready = !locked && lv < SKILL_MAX && pts >= c.points && p.pigment >= c.pigment && (p.shards ?? 0) >= c.shards;
    const badge = locked ? `<span class="lvb lock">${t("Lv {lv}에 열림", { lv: s.unlock })}</span>` : `<span class="lvb">Lv ${lv}</span>`;
    return `<li><button type="button" class="gr2-row${i === sel ? " on" : ""}${locked ? " locked" : ""}${focus && i === 1 ? " focus" : ""}" data-do="pickSkill" data-i="${i}" aria-pressed="${i === sel}" style="--skc:${SKILL_COLOR[i]}">
      <i class="spr ic-sk gr2-ico" style="background-position:${skillIconPos(i)}" aria-hidden="true"></i>
      <span class="gr2-name">${esc(t(s.name))}${ready ? `<i class="ready"${tipAttr(t("단련할 수 있다"))}></i>` : ""}</span>${badge}
      ${pips(locked ? 0 : lv, focus && i === 1 ? AWAKEN_AT[0] : 0)}
    </button></li>`;
  }).join("");

  const help = t("경지가 오를 때마다 수련 포인트 하나, 의뢰로도 얻는다.\n5와 10단계에서 검법이 깨어난다 (색 조각이 든다).");
  const bar = resBar([["points", pts], ["pigment", p.pigment], ["shard", p.shards ?? 0], ["stone", p.stones ?? 0], ["protect", p.protects ?? 0], ["jade", p.jade]], help);
  return `${bar}<div class="gr2${st.detail ? " detail-up" : ""}"><ol class="gr2-list">${rows}</ol>${skillDetail(p, sel, pts, busy, st)}</div>`;
}

function skillDetail(p: ProfileView, i: number, pts: number, busy: boolean, st: GrowthState): string {
  const s = SKILLS[i];
  const lv = p.skills?.[i] ?? 1;
  const locked = p.level < s.unlock;
  const focus = st.focus === "awaken1" && i === 1;
  const dmg = Math.round((skillDmgMul(lv) - 1) * 100);
  const now = `${t("피해 {v}", { v: dmg > 0 ? `+${dmg}%` : t("기본") })} · ${t("재사용 {cd}", { cd: sec(s.cd * skillCdMul(lv) * cdMulOf(p)) })}`;

  let next = "";
  let act = "";
  if (locked) {
    next = `<p class="gr2-lock">${t("Lv {lv}에 열림 · 경지 {lv}에 오르면 익힌다", { lv: s.unlock })}</p>`;
  } else if (lv >= SKILL_MAX) {
    next = `<p class="gr2-max">${t("끝까지 닦았다")}</p>`;
  } else {
    const c = trainCost(lv);
    const dUp = Math.round((skillDmgMul(lv + 1) - skillDmgMul(lv)) * 100);
    const cdDown = s.cd * (skillCdMul(lv) - skillCdMul(lv + 1)) * cdMulOf(p);
    next = `<div class="gr2-next"><h4 class="sec">${t("다음 단련")}</h4><p>${t("피해 {n}% 증가 · 재사용 {cd} 단축", { n: dUp, cd: sec(cdDown) })}${(AWAKEN_AT as readonly number[]).includes(lv + 1) ? ` · <b>${t("{n}단계 각성", { n: lv + 1 })}</b>` : ""}</p></div>`;
    const can = pts >= c.points && p.pigment >= c.pigment && (p.shards ?? 0) >= c.shards && !busy;
    const chips = resChip("points", c.points, { need: true, short: pts < c.points }) + resChip("pigment", c.pigment, { need: true, short: p.pigment < c.pigment })
      + (c.shards ? resChip("shard", c.shards, { need: true, short: (p.shards ?? 0) < c.shards }) : "");
    act = `<div class="gr2-cost"><span class="cap">${t("드는 것")}</span>${chips}</div>
      <button class="btn btn-lg gr2-go" type="button" data-do="train" data-i="${i}" ${can ? "" : "disabled"}><span>${t("단련")}</span><small>${ro(lv + 1) === "으로" ? t("Lv {lv}으로", { lv: lv + 1 }) : t("Lv {lv}로", { lv: lv + 1 })}</small></button>`;
  }
  const tl = AWAKEN_AT.map((at) => {
    const reached = !locked && lv >= at;
    const isNext = !locked && !reached && (at === AWAKEN_AT[0] || lv >= AWAKEN_AT[0]);
    return `<li class="${reached ? "reached" : ""}${isNext ? " next" : ""}${focus && at === AWAKEN_AT[0] ? " focus" : ""}"><i class="node" aria-hidden="true"></i><b>${t("{n}단계 각성", { n: at })}</b><span>${esc(t(AWAKENINGS[i][at].text))}</span></li>`;
  }).join("");
  return `<section class="gr2-detail${locked ? " locked" : ""}${st.slide ? " slide" : ""}" aria-label="${esc(t(s.name))}" style="--skc:${SKILL_COLOR[i]}">
    <button type="button" class="gr2-x btn btn-secondary btn-sm" data-do="closeDetail">${t("닫기")}</button>
    <div class="gr2-hero">
      <span class="gr2-art" aria-hidden="true"><i class="spr ic-sk gr2-big" style="background-position:${skillIconPos(i)}" aria-hidden="true"></i></span>
      <div><h3 class="ttl">${esc(t(s.name))}</h3><p class="gr2-lv">${locked ? `<b>${t("잠김")}</b>` : `<b>Lv ${lv}</b><small> / ${SKILL_MAX}</small>`}</p><p class="cap">${locked ? t("재사용 {cd}", { cd: sec(s.cd) }) : now}</p></div>
    </div>
    ${next}
    <ol class="gr2-tl" aria-label="${t("각성")}">${tl}</ol>
    ${focus ? `<p class="gr2-note">${t("{n}단계에서 검법이 깨어난다. {mat}이 하나 든다.", { n: AWAKEN_AT[0], mat: t(MATERIALS.shard.name) })}</p>` : ""}
    ${act}
  </section>`;
}

/* ---------- 붓 강화 ---------- */
export function enhanceHtml(p: ProfileView, st: GrowthState, busy: boolean): string {
  const owned = ITEMS.filter((i) => i.slot === "weapon" && p.owned.includes(i.id));
  if (!owned.some((i) => i.id === st.brush)) st.brush = p.equip.weapon;
  const tiles = owned.map((it) => {
    const plus = p.enh?.[it.id] ?? 0;
    return `<button type="button" class="tile${it.id === st.brush ? " on" : ""}${p.equip.weapon === it.id ? " eq" : ""}" data-do="pickBrush" data-id="${it.id}" data-r="${it.r}"${tipAttr(`${t(it.name)}${plus ? ` +${plus}` : ""}`, `${t("{r} {kind} · 공격 {atk}", { r: t(it.r), kind: it.kind === "sword" ? t("검") : t("붓"), atk: atkText(enhancedAtk(it.atk ?? 10, plus)) })}${p.equip.weapon === it.id ? ` · ${t("착용 중")}` : ""}`)}>
      ${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}<span class="nm">${esc(t(it.name))}</span></button>`;
  }).join("");
  const it = ITEM[st.brush];
  const plus = p.enh?.[st.brush] ?? 0;
  const base = it?.atk ?? 10;
  const shown = st.stage === "destroyed" && st.gone ? ITEM[st.gone] : it;
  const stage = shown ? `<div class="enh-stage ${st.stage}" aria-live="polite"><div class="enh-brush" data-r="${shown.r}">${itemIcon(shown, "xl")}</div>${shown === it ? `<b class="enh-plus">+${plus}</b>` : ""}<span class="enh-seal">${st.stage === "success" ? t("성공") : st.stage === "protected" ? t("지킴") : ""}</span></div>` : "";

  let detail = "";
  if (it && plus >= ENHANCE_MAX) {
    detail = `<p class="enh2-done">${t("+{n}, 더 갈 데가 없는 붓이다.", { n: ENHANCE_MAX })}</p>`;
  } else if (it) {
    const step = ENHANCE_TABLE[plus];
    const breaks = step.destroyOnFail > 0;
    const unbreakable = st.brush === UNBREAKABLE;
    const canProtect = breaks && !unbreakable && (p.protects ?? 0) > 0;
    if (!canProtect) st.protect = false;
    const can = !busy && (p.stones ?? 0) >= step.stones && p.pigment >= step.pigment;
    const ok = step.success;
    const lost = breaks ? (1 - ok) * step.destroyOnFail : 0;
    const shielded = st.protect && breaks;
    const keep = 1 - ok - (shielded ? 0 : lost);
    const brkLabel = unbreakable ? t("+0으로") : shielded ? t("지킴") : t("파괴");
    const seg = (cls: string, v: number, label: string) => v > 0 ? `<i class="${cls}" style="flex:${(v * 1000).toFixed(0)}"><span>${label} ${pct(v)}</span></i>` : "";
    const bar = `<div class="odds-bar" role="img" aria-label="${t("성공 {ok}, 실패 {keep}", { ok: pct(ok), keep: pct(keep) })}${breaks && !shielded ? `, ${brkLabel} ${pct(lost)}` : ""}">
      ${seg("ok", ok, t("성공"))}${seg("keep", keep, t("실패"))}${breaks && !shielded ? seg(unbreakable ? "reset" : "brk", lost, brkLabel) : ""}</div>`;
    const legend = `<p class="odds-legend"><span class="k ok">${t("성공")} <b>${pct(ok)}</b></span><span class="k keep">${t("실패")} <b>${pct(keep)}</b><small>${t("재료만 사라짐")}</small></span>${breaks ? `<span class="k ${shielded ? "safe" : unbreakable ? "reset" : "brk"}">${shielded ? t("파괴 막음") : unbreakable ? t("+0으로") : t("파괴")} <b>${shielded ? "0%" : pct(lost)}</b></span>` : `<span class="k safe">${t("부서지지 않음")}</span>`}</p>`;
    const chips = resChip("stone", step.stones, { need: true, short: (p.stones ?? 0) < step.stones }) + resChip("pigment", step.pigment, { need: true, short: p.pigment < step.pigment });
    const sw = breaks && !unbreakable
      ? `<div class="enh2-protect"><label class="ink-toggle${canProtect ? "" : " off"}"><span>${t(MATERIALS.protect.name)}<small>${t("{n}장 · 한 번에 한 장", { n: p.protects ?? 0 })}</small></span><input type="checkbox" data-do="toggleProtect" ${st.protect ? "checked" : ""} ${canProtect ? "" : "disabled"}><i aria-hidden="true"></i></label>
        <button class="btn btn-secondary btn-sm" type="button" data-do="buyProtect" ${p.jade >= PROTECT_PRICE && !busy ? "" : "disabled"}>${t("사기 · 묵옥 {n}", { n: PROTECT_PRICE })}</button></div>`
      : "";
    detail = `<p class="enh2-atk">${t("공격")} <b>${atkText(enhancedAtk(base, plus))}</b> <i class="arrow" aria-hidden="true"></i> <b class="up">${atkText(enhancedAtk(base, plus + 1))}</b></p>
      ${bar}${legend}
      ${sw}
      <div class="gr2-cost"><span class="cap">${t("드는 것")}</span>${chips}</div>
      <button class="btn btn-lg enh-try${plus + 1 >= 12 ? " btn-danger" : ""}" type="button" data-do="enhance" ${can ? "" : "disabled"}><span>${t("+{n} 강화", { n: plus + 1 })}</span></button>`;
  }
  const odds = st.focus === "odds";
  const rows = ENHANCE_TABLE.map((s) => `<tr class="${s.destroyOnFail > 0 ? "risk" : ""}${odds && ((s.to >= 4 && s.to <= 6) || s.to === DESTROY_FROM) ? " focus" : ""}"><td>+${s.to}</td><td>${pct(s.success)}</td><td>${s.destroyOnFail > 0 ? pct(s.destroyOnFail) : "-"}</td><td>${s.destroyOnFail > 0 ? pct((1 - s.success) * s.destroyOnFail) : "-"}</td><td>${s.stones}</td><td>${s.pigment}</td></tr>`).join("");
  const help = t("+{n}부터는 실패하면 붓이 부서질 수 있다.\n{mat}을 쓰면 부서지지 않는다. 처음 받은 먹붓은 +0으로 돌아갈 뿐.", { n: DESTROY_FROM, mat: t(MATERIALS.protect.name) });
  return `${resBar([["stone", p.stones ?? 0], ["protect", p.protects ?? 0], ["pigment", p.pigment], ["jade", p.jade]], help)}
    <div class="enh2">
      <div class="enh2-pick"><h4 class="sec">${t("무기 고르기")}</h4><div class="tiles">${tiles}</div>
        <details class="rate-detail"${odds ? " open" : ""}><summary>${t("강화 확률표")}</summary>
          <p class="cap${odds ? " focus" : ""}">${t("+{n}부터는 실패하면 붓이 부서질 수 있다. {mat}을 쓰면 부서지지 않고 단계만 그대로 남는다. 처음 받은 먹붓은 부서지지 않고 +0으로 돌아간다.", { n: DESTROY_FROM, mat: t(MATERIALS.protect.name) })}</p>
          <div class="rate-table"><table><thead><tr><th>${t("목표")}</th><th>${t("성공")}</th><th>${t("실패 시 파괴")}</th><th>${t("한 번에 파괴")}</th><th>${t("먹돌")}</th><th>${t("안료")}</th></tr></thead><tbody>${rows}</tbody></table></div>
        </details>
      </div>
      <section class="enh2-main"><div class="enh2-head">${stage}<h3 class="ttl enh2-name">${esc(it ? t(it.name) : "")}</h3></div>${detail}</section>
    </div>`;
}

/** The game's hook for an awakening reached here (a surge of the skill's color round the player). */
/**
 * Hooks into the game. `holdPower(true)` keeps the HUD's 전투력 where it is while an enhancement is still
 * charging (the server answer, and the profile push, arrive before the result is shown); false lets it rise.
 */
export const growthFx: { onAwaken: ((skill: number) => void) | null; holdPower: ((on: boolean) => void) | null } = { onAwaken: null, holdPower: null };

/* ---------- actions ---------- */
export async function growthAction(
  what: string, b: HTMLElement, api: GameApi, p: ProfileView, st: GrowthState, apply: (p: ProfileView) => void, redraw: () => void,
): Promise<boolean> {
  if (growthLocal(what, b, st)) return true;
  if (what === "train") {
    const i = Number(b.dataset.i);
    const before = p.skills?.[i] ?? 1;
    const r = await attempt(api.trainSkill(i));
    if (r) {
      apply(r);
      const lv = r.skills?.[i] ?? before + 1;
      const aw = (AWAKEN_AT as readonly number[]).includes(lv) ? AWAKENINGS[i][lv as 5 | 10].text : "";
      toast(`${t(SKILLS[i].name)} Lv ${lv}${aw ? ` · ${t(aw)}` : ""}`);
      if (aw) growthFx.onAwaken?.(i);
    }
    return true;
  }
  if (what === "buyProtect") {
    const r = await attempt(api.buyProtect(1));
    if (r) { apply(r); toast(t("{name} 1장을 샀다", { name: t(MATERIALS.protect.name) })); }
    return true;
  }
  if (what === "enhance") {
    const id = st.brush;
    const name = ITEM[id] ? t(ITEM[id].name) : t("붓");
    st.stage = "trying";
    redraw();
    audio.play("enhance-charge");
    growthFx.holdPower?.(true);
    let r: Awaited<ReturnType<typeof api.enhance>> | null;
    try {
      [r] = await Promise.all([attempt(api.enhance(id, st.protect)), new Promise((res) => window.setTimeout(res, 950))]);
    } finally {
      growthFx.holdPower?.(false);
    }
    if (!r) { st.stage = ""; return true; }
    // the starter brush can't break: the server keeps it and only resets it to +0
    const kept = r.profile.owned.includes(id);
    st.gone = r.outcome === "destroyed" && !kept ? id : undefined;
    apply(r.profile);
    st.stage = r.outcome === "destroyed" && kept ? "fail" : r.outcome;
    // 먹붓 only resets, so it sounds like a failure; "protected" too
    audio.play(r.outcome === "success" ? "enhance-success" : r.outcome === "destroyed" && !kept ? "enhance-destroy" : "enhance-fail");
    if (r.outcome === "success") toast(t("강화 성공! {name} +{n}", { name, n: r.plus }));
    else if (r.outcome === "fail") toast(t("강화 실패. 재료만 사라졌다 (+{n})", { n: r.plus }), true);
    else if (r.outcome === "protected") toast(t("{mat}이 {name}을 지켰다 (+{n})", { mat: t(MATERIALS.protect.name), name, n: r.plus }));
    else toast(kept ? t("{name} 강화 수치 초기화 (+0)", { name }) : t("{name}이 부서졌다…", { name }), true);
    window.setTimeout(() => { if (st.stage !== "" && st.stage !== "trying") { st.stage = ""; redraw(); } }, 1800);
    return true;
  }
  return false;
}

/** 로 / 으로 after a number read aloud (1·2·4·5·7·8·9·10 take 로 only when the last sound is a vowel or ㄹ). */
function ro(n: number): string {
  // last digit read: 0 영 1 일 2 이 3 삼 4 사 5 오 6 육 7 칠 8 팔 9 구; 10 십
  const d = n % 10 === 0 ? (n % 100 === 0 ? "백" : "십") : "영일이삼사오육칠팔구"[n % 10];
  return "삼육십백".includes(d) ? "으로" : "로";
}
