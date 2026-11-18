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
import { attempt, esc, itemIcon, resBar, resChip, skillIconPos, tipAttr, toast } from "./dom";
import { audio } from "../audio";

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
const sec = (v: number) => `${+v.toFixed(1)}초`;

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
    const badge = locked ? `<span class="lvb lock">Lv ${s.unlock}에 열림</span>` : `<span class="lvb">Lv ${lv}</span>`;
    return `<li><button type="button" class="gr2-row${i === sel ? " on" : ""}${locked ? " locked" : ""}${focus && i === 1 ? " focus" : ""}" data-do="pickSkill" data-i="${i}" aria-pressed="${i === sel}">
      <i class="spr ic-sk gr2-ico" style="background-position:${skillIconPos(i)}" aria-hidden="true"></i>
      <span class="gr2-name">${esc(s.name)}${ready ? `<i class="ready"${tipAttr("단련할 수 있다")}></i>` : ""}</span>${badge}
      ${pips(locked ? 0 : lv, focus && i === 1 ? AWAKEN_AT[0] : 0)}
    </button></li>`;
  }).join("");

  const help = "경지가 오를 때마다 수련 포인트 하나, 의뢰로도 얻는다.\n5와 10단계에서 검법이 깨어난다 (색 조각이 든다).";
  const bar = resBar([["points", pts], ["pigment", p.pigment], ["shard", p.shards ?? 0], ["stone", p.stones ?? 0], ["protect", p.protects ?? 0], ["jade", p.jade]], help);
  return `${bar}<div class="gr2${st.detail ? " detail-up" : ""}"><ol class="gr2-list">${rows}</ol>${skillDetail(p, sel, pts, busy, st)}</div>`;
}

function skillDetail(p: ProfileView, i: number, pts: number, busy: boolean, st: GrowthState): string {
  const s = SKILLS[i];
  const lv = p.skills?.[i] ?? 1;
  const locked = p.level < s.unlock;
  const focus = st.focus === "awaken1" && i === 1;
  const dmg = Math.round((skillDmgMul(lv) - 1) * 100);
  const now = `피해 ${dmg > 0 ? `+${dmg}%` : "기본"} · 재사용 ${sec(s.cd * skillCdMul(lv) * cdMulOf(p))}`;

  let next = "";
  let act = "";
  if (locked) {
    next = `<p class="gr2-lock">Lv ${s.unlock}에 열림 · 경지 ${s.unlock}에 오르면 익힌다</p>`;
  } else if (lv >= SKILL_MAX) {
    next = `<p class="gr2-max">끝까지 닦았다</p>`;
  } else {
    const c = trainCost(lv);
    const dUp = Math.round((skillDmgMul(lv + 1) - skillDmgMul(lv)) * 100);
    const cdDown = s.cd * (skillCdMul(lv) - skillCdMul(lv + 1)) * cdMulOf(p);
    next = `<div class="gr2-next"><h4 class="sec">다음 단련</h4><p>피해 ${dUp}% 증가 · 재사용 ${sec(cdDown)} 단축${(AWAKEN_AT as readonly number[]).includes(lv + 1) ? ` · <b>${lv + 1}단계 각성</b>` : ""}</p></div>`;
    const can = pts >= c.points && p.pigment >= c.pigment && (p.shards ?? 0) >= c.shards && !busy;
    const chips = resChip("points", c.points, { need: true, short: pts < c.points }) + resChip("pigment", c.pigment, { need: true, short: p.pigment < c.pigment })
      + (c.shards ? resChip("shard", c.shards, { need: true, short: (p.shards ?? 0) < c.shards }) : "");
    act = `<div class="gr2-cost"><span class="cap">드는 것</span>${chips}</div>
      <button class="btn btn-lg gr2-go" type="button" data-do="train" data-i="${i}" ${can ? "" : "disabled"}><span>단련</span><small>Lv ${lv + 1}${ro(lv + 1)}</small></button>`;
  }
  const tl = AWAKEN_AT.map((at) => {
    const reached = !locked && lv >= at;
    const isNext = !locked && !reached && (at === AWAKEN_AT[0] || lv >= AWAKEN_AT[0]);
    return `<li class="${reached ? "reached" : ""}${isNext ? " next" : ""}${focus && at === AWAKEN_AT[0] ? " focus" : ""}"><i class="node" aria-hidden="true"></i><b>${at}단계 각성</b><span>${esc(AWAKENINGS[i][at].text)}</span></li>`;
  }).join("");
  return `<section class="gr2-detail${locked ? " locked" : ""}${st.slide ? " slide" : ""}" aria-label="${esc(s.name)}">
    <button type="button" class="gr2-x btn btn-secondary btn-sm" data-do="closeDetail">닫기</button>
    <div class="gr2-hero">
      <i class="spr ic-sk gr2-big" style="background-position:${skillIconPos(i)}" aria-hidden="true"></i>
      <div><h3 class="ttl">${esc(s.name)}</h3><p class="gr2-lv">${locked ? `<b>잠김</b>` : `<b>Lv ${lv}</b><small> / ${SKILL_MAX}</small>`}</p><p class="cap">${locked ? `재사용 ${sec(s.cd)}` : now}</p></div>
    </div>
    ${next}
    <ol class="gr2-tl" aria-label="각성">${tl}</ol>
    ${focus ? `<p class="gr2-note">${AWAKEN_AT[0]}단계에서 검법이 깨어난다. ${MATERIALS.shard.name}이 하나 든다.</p>` : ""}
    ${act}
  </section>`;
}

/* ---------- 붓 강화 ---------- */
export function enhanceHtml(p: ProfileView, st: GrowthState, busy: boolean): string {
  const owned = ITEMS.filter((i) => i.slot === "weapon" && p.owned.includes(i.id));
  if (!owned.some((i) => i.id === st.brush)) st.brush = p.equip.weapon;
  const tiles = owned.map((it) => {
    const plus = p.enh?.[it.id] ?? 0;
    return `<button type="button" class="tile${it.id === st.brush ? " on" : ""}${p.equip.weapon === it.id ? " eq" : ""}" data-do="pickBrush" data-id="${it.id}" data-r="${it.r}"${tipAttr(`${it.name}${plus ? ` +${plus}` : ""}`, `${it.r} ${it.kind === "sword" ? "검" : "붓"} · 공격 ${atkText(enhancedAtk(it.atk ?? 10, plus))}${p.equip.weapon === it.id ? " · 착용 중" : ""}`)}>
      ${itemIcon(it, "l")}${plus ? `<b class="plus">+${plus}</b>` : ""}<span class="nm">${esc(it.name)}</span></button>`;
  }).join("");
  const it = ITEM[st.brush];
  const plus = p.enh?.[st.brush] ?? 0;
  const base = it?.atk ?? 10;
  const shown = st.stage === "destroyed" && st.gone ? ITEM[st.gone] : it;
  const stage = shown ? `<div class="enh-stage ${st.stage}" aria-live="polite"><div class="enh-brush" data-r="${shown.r}">${itemIcon(shown, "xl")}</div>${shown === it ? `<b class="enh-plus">+${plus}</b>` : ""}<span class="enh-seal">${st.stage === "success" ? "성공" : st.stage === "protected" ? "지킴" : ""}</span></div>` : "";

  let detail = "";
  if (it && plus >= ENHANCE_MAX) {
    detail = `<p class="enh2-done">+${ENHANCE_MAX}, 더 갈 데가 없는 붓이다.</p>`;
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
    const brkLabel = unbreakable ? "+0으로" : shielded ? "지킴" : "파괴";
    const seg = (cls: string, v: number, label: string) => v > 0 ? `<i class="${cls}" style="flex:${(v * 1000).toFixed(0)}"><span>${label} ${pct(v)}</span></i>` : "";
    const bar = `<div class="odds-bar" role="img" aria-label="성공 ${pct(ok)}, 실패 ${pct(keep)}${breaks && !shielded ? `, ${brkLabel} ${pct(lost)}` : ""}">
      ${seg("ok", ok, "성공")}${seg("keep", keep, "실패")}${breaks && !shielded ? seg(unbreakable ? "reset" : "brk", lost, brkLabel) : ""}</div>`;
    const legend = `<p class="odds-legend"><span class="k ok">성공 <b>${pct(ok)}</b></span><span class="k keep">실패 <b>${pct(keep)}</b><small>재료만 사라짐</small></span>${breaks ? `<span class="k ${shielded ? "safe" : unbreakable ? "reset" : "brk"}">${shielded ? "파괴 막음" : unbreakable ? "+0으로" : "파괴"} <b>${shielded ? "0%" : pct(lost)}</b></span>` : `<span class="k safe">부서지지 않음</span>`}</p>`;
    const chips = resChip("stone", step.stones, { need: true, short: (p.stones ?? 0) < step.stones }) + resChip("pigment", step.pigment, { need: true, short: p.pigment < step.pigment });
    const sw = breaks && !unbreakable
      ? `<div class="enh2-protect"><label class="ink-toggle${canProtect ? "" : " off"}"><span>${MATERIALS.protect.name}<small>${(p.protects ?? 0)}장 · 한 번에 한 장</small></span><input type="checkbox" data-do="toggleProtect" ${st.protect ? "checked" : ""} ${canProtect ? "" : "disabled"}><i aria-hidden="true"></i></label>
        <button class="btn btn-secondary btn-sm" type="button" data-do="buyProtect" ${p.jade >= PROTECT_PRICE && !busy ? "" : "disabled"}>사기 · 묵옥 ${PROTECT_PRICE}</button></div>`
      : "";
    detail = `<p class="enh2-atk">공격 <b>${atkText(enhancedAtk(base, plus))}</b> <i class="arrow" aria-hidden="true"></i> <b class="up">${atkText(enhancedAtk(base, plus + 1))}</b></p>
      ${bar}${legend}
      ${sw}
      <div class="gr2-cost"><span class="cap">드는 것</span>${chips}</div>
      <button class="btn btn-lg enh-try${plus + 1 >= 12 ? " btn-danger" : ""}" type="button" data-do="enhance" ${can ? "" : "disabled"}><span>+${plus + 1} 강화</span></button>`;
  }
  const odds = st.focus === "odds";
  const rows = ENHANCE_TABLE.map((s) => `<tr class="${s.destroyOnFail > 0 ? "risk" : ""}${odds && ((s.to >= 4 && s.to <= 6) || s.to === DESTROY_FROM) ? " focus" : ""}"><td>+${s.to}</td><td>${pct(s.success)}</td><td>${s.destroyOnFail > 0 ? pct(s.destroyOnFail) : "-"}</td><td>${s.destroyOnFail > 0 ? pct((1 - s.success) * s.destroyOnFail) : "-"}</td><td>${s.stones}</td><td>${s.pigment}</td></tr>`).join("");
  const help = `+${DESTROY_FROM}부터는 실패하면 붓이 부서질 수 있다.\n${MATERIALS.protect.name}을 쓰면 부서지지 않는다. 처음 받은 먹붓은 +0으로 돌아갈 뿐.`;
  return `${resBar([["stone", p.stones ?? 0], ["protect", p.protects ?? 0], ["pigment", p.pigment], ["jade", p.jade]], help)}
    <div class="enh2">
      <div class="enh2-pick"><h4 class="sec">무기 고르기</h4><div class="tiles">${tiles}</div></div>
      <section class="enh2-main">${stage}<h3 class="ttl enh2-name">${esc(it?.name ?? "")}</h3>${detail}</section>
    </div>
    <details class="rate-detail"${odds ? " open" : ""}><summary>강화 확률표</summary>
      <p class="cap${odds ? " focus" : ""}">+${DESTROY_FROM}부터는 실패하면 붓이 부서질 수 있다. ${MATERIALS.protect.name}을 쓰면 부서지지 않고 단계만 그대로 남는다. 처음 받은 먹붓은 부서지지 않고 +0으로 돌아간다.</p>
      <div class="rate-table"><table><thead><tr><th>목표</th><th>성공</th><th>실패 시 파괴</th><th>한 번에 파괴</th><th>먹돌</th><th>안료</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
}

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
      toast(`${SKILLS[i].name} Lv ${lv}${aw ? ` · ${aw}` : ""}`);
    }
    return true;
  }
  if (what === "buyProtect") {
    const r = await attempt(api.buyProtect(1));
    if (r) { apply(r); toast(`${MATERIALS.protect.name} 1장을 샀다`); }
    return true;
  }
  if (what === "enhance") {
    const id = st.brush;
    const name = ITEM[id]?.name ?? "붓";
    st.stage = "trying";
    redraw();
    audio.play("enhance-charge");
    const [r] = await Promise.all([attempt(api.enhance(id, st.protect)), new Promise((res) => window.setTimeout(res, 950))]);
    if (!r) { st.stage = ""; return true; }
    // the starter brush can't break: the server keeps it and only resets it to +0
    const kept = r.profile.owned.includes(id);
    st.gone = r.outcome === "destroyed" && !kept ? id : undefined;
    apply(r.profile);
    st.stage = r.outcome === "destroyed" && kept ? "fail" : r.outcome;
    // 먹붓 only resets, so it sounds like a failure; "protected" too
    audio.play(r.outcome === "success" ? "enhance-success" : r.outcome === "destroyed" && !kept ? "enhance-destroy" : "enhance-fail");
    if (r.outcome === "success") toast(`강화 성공! ${name} +${r.plus}`);
    else if (r.outcome === "fail") toast(`강화 실패. 재료만 사라졌다 (+${r.plus})`, true);
    else if (r.outcome === "protected") toast(`${MATERIALS.protect.name}이 ${name}을 지켰다 (+${r.plus})`);
    else toast(kept ? `${name} 강화 수치 초기화 (+0)` : `${name}이 부서졌다…`, true);
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
