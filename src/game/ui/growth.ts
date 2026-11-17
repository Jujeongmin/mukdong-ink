// Growth sheet bodies: 검법 단련 (training points into skills, awakenings at 5 and 10) and 붓 강화
// (+1..+15, failure, destruction from DESTROY_FROM, 파괴방지권). Numbers come from shared/growth.ts; the
// server rolls. Markup only uses CSS classes (style.css .gr-*, .enh-*), so the look can change freely.

import { SKILLS } from "../../shared/combat";
import { ITEM, ITEMS } from "../../shared/items";
import {
  AWAKENINGS, AWAKEN_AT, DESTROY_FROM, ENHANCE_MAX, ENHANCE_TABLE, MATERIALS, PROTECT_PRICE, SKILL_MAX, UNBREAKABLE,
  enhancedAtk, pointsEarned, pointsSpent, skillCdMul, skillDmgMul, trainCost, type EnhanceOutcome,
} from "../../shared/growth";
import type { GameApi, ProfileView } from "../../net/api";
import { fmt } from "../util";
import { attempt, esc, itemIcon, skillIconPos, toast } from "./dom";
import { audio } from "../audio";

export interface GrowthState {
  brush: string;
  protect: boolean;
  stage: "" | "trying" | EnhanceOutcome;
  /** the brush that just broke, shown shattering once */
  gone?: string;
}

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

export function freePoints(p: ProfileView): number {
  return p.points ?? pointsEarned(p.level, p.bonusPoints ?? 0) - pointsSpent(p.skills ?? []);
}

function materials(p: ProfileView): string {
  const m = (key: keyof typeof MATERIALS, n: number) => `<span class="gr-mat" title="${esc(MATERIALS[key].text)}"><b>${MATERIALS[key].name}</b> ${fmt(n)}</span>`;
  return `<div class="gr-mats">${m("stone", p.stones ?? 0)}${m("shard", p.shards ?? 0)}${m("protect", p.protects ?? 0)}<span class="gr-mat"><b>안료</b> ${fmt(p.pigment)}</span></div>`;
}

/* ---------- 검법 단련 ---------- */
export function skillsHtml(p: ProfileView, busy: boolean): string {
  const pts = freePoints(p);
  const rows = SKILLS.map((s, i) => {
    const lv = p.skills?.[i] ?? 1;
    const locked = p.level < s.unlock;
    let pips = "";
    for (let k = 1; k <= SKILL_MAX; k++) pips += `<i class="${k <= lv ? "on" : ""}${(AWAKEN_AT as readonly number[]).includes(k) ? " aw" : ""}"></i>`;
    const aw = AWAKEN_AT.map((at) => `<li class="${lv >= at ? "reached" : ""}"><b>${at}단계 각성</b> ${esc(AWAKENINGS[i][at].text)}</li>`).join("");
    let next = `<span class="gr-max">끝까지 닦았다</span>`;
    let btn = "";
    if (locked) {
      next = `<span class="gr-lock">${s.unlock}경지에 익힌다</span>`;
    } else if (lv < SKILL_MAX) {
      const c = trainCost(lv);
      const cd = s.cd;
      next = `<span>피해 ×${skillDmgMul(lv).toFixed(2)} → <b>×${skillDmgMul(lv + 1).toFixed(2)}</b></span><span>재사용 ${(cd * skillCdMul(lv)).toFixed(1)}초 → <b>${(cd * skillCdMul(lv + 1)).toFixed(1)}초</b></span>`;
      const cost = `포인트 ${c.points}, 안료 ${c.pigment}${c.shards ? `, ${MATERIALS.shard.name} ${c.shards}` : ""}`;
      const can = pts >= c.points && p.pigment >= c.pigment && (p.shards ?? 0) >= c.shards && !busy;
      btn = `<button class="btn btn-sm" type="button" data-do="train" data-i="${i}" ${can ? "" : "disabled"}>단련</button><small class="gr-cost">${cost}</small>`;
    }
    return `<div class="gr-skill${locked ? " locked" : ""}">
      <i class="spr ic-sk gr-ico" style="background-position:${skillIconPos(i)}" aria-hidden="true"></i>
      <div class="gr-body">
        <div class="gr-head"><b>${esc(s.name)}</b><span class="gr-lv">${lv} / ${SKILL_MAX}</span></div>
        <div class="gr-pips" aria-hidden="true">${pips}</div>
        <div class="gr-next">${next}</div>
        <ul class="gr-aw">${aw}</ul>
      </div>
      <div class="gr-act">${btn}</div>
    </div>`;
  }).join("");
  return `<p class="sub">수련 포인트 <b class="gr-pts">${pts}</b>. 경지가 오를 때마다 하나씩, 의뢰로도 얻는다. 체력과 공격은 경지에 따라 저절로 오른다.</p>${materials(p)}<div class="gr-list">${rows}</div>`;
}

/* ---------- 붓 강화 ---------- */
export function enhanceHtml(p: ProfileView, st: GrowthState, busy: boolean): string {
  const owned = ITEMS.filter((i) => i.slot === "weapon" && p.owned.includes(i.id));
  if (!owned.some((i) => i.id === st.brush)) st.brush = p.equip.weapon;
  const list = owned.map((it) => {
    const plus = p.enh?.[it.id] ?? 0;
    return `<button type="button" class="item${it.id === st.brush ? " on" : ""}" data-do="pickBrush" data-id="${it.id}" data-r="${it.r}"><span class="g">${itemIcon(it)}</span><b>${esc(it.name)}${plus ? ` +${plus}` : ""}</b><small>${p.equip.weapon === it.id ? "착용 중" : it.r}</small></button>`;
  }).join("");
  const it = ITEM[st.brush];
  const plus = p.enh?.[st.brush] ?? 0;
  const base = it?.atk ?? 10;
  let detail: string;
  if (!it) detail = "";
  else if (plus >= ENHANCE_MAX) {
    detail = `<p class="sub">+${ENHANCE_MAX}, 더 갈 데가 없는 붓이다. 공격 ${enhancedAtk(base, plus)}.</p>`;
  } else {
    const step = ENHANCE_TABLE[plus];
    const breaks = step.destroyOnFail > 0;
    const unbreakable = st.brush === UNBREAKABLE;
    const canProtect = breaks && !unbreakable && (p.protects ?? 0) > 0;
    if (!canProtect) st.protect = false;
    const can = !busy && (p.stones ?? 0) >= step.stones && p.pigment >= step.pigment;
    detail = `
      <div class="enh-odds">
        <span>공격 ${enhancedAtk(base, plus)} → <b>${enhancedAtk(base, plus + 1)}</b></span>
        <span>성공 <b>${pct(step.success)}</b></span>
        ${breaks ? `<span class="enh-risk">실패하면 ${pct(step.destroyOnFail)} 확률로 ${unbreakable ? "+0으로 돌아감" : "붓이 부서짐"}</span>` : `<span>실패해도 부서지지 않음</span>`}
        <span>재료 ${MATERIALS.stone.name} ${step.stones}, 안료 ${step.pigment}</span>
      </div>
      <label class="enh-protect${canProtect ? "" : " off"}"><input type="checkbox" data-do="toggleProtect" ${st.protect ? "checked" : ""} ${canProtect ? "" : "disabled"}> ${MATERIALS.protect.name} 쓰기 (가진 것 ${p.protects ?? 0}장)</label>
      <div class="row">
        <button class="btn enh-try${plus + 1 >= 12 ? " btn-danger" : ""}" type="button" data-do="enhance" ${can ? "" : "disabled"}>+${plus + 1} 강화하기</button>
        <button class="ghost-btn btn btn-secondary btn-sm" type="button" data-do="buyProtect" ${p.jade >= PROTECT_PRICE && !busy ? "" : "disabled"}>${MATERIALS.protect.name} 사기 (묵옥 ${PROTECT_PRICE})</button>
      </div>`;
  }
  const shown = st.stage === "destroyed" && st.gone ? ITEM[st.gone] : it;
  const stage = shown ? `<div class="enh-stage ${st.stage}" aria-live="polite"><div class="enh-brush">${itemIcon(shown)}</div><b class="enh-name">${esc(shown.name)}${shown === it ? ` +${plus}` : ""}</b><span class="enh-seal">${st.stage === "success" ? "성공" : st.stage === "protected" ? "지킴" : ""}</span></div>` : "";
  const rows = ENHANCE_TABLE.map((s) => `<tr class="${s.destroyOnFail > 0 ? "risk" : ""}"><td>+${s.to}</td><td>${pct(s.success)}</td><td>${s.destroyOnFail > 0 ? pct(s.destroyOnFail) : "-"}</td><td>${s.destroyOnFail > 0 ? pct((1 - s.success) * s.destroyOnFail) : "-"}</td><td>${s.stones}</td><td>${s.pigment}</td></tr>`).join("");
  return `${materials(p)}
    <div class="inv enh-list">${list}</div>
    ${stage}${detail}
    <details class="rate-detail"><summary>강화 확률 전체 보기</summary>
      <p class="sub">+${DESTROY_FROM}부터는 실패하면 붓이 부서질 수 있습니다. ${MATERIALS.protect.name}을 쓰면 부서지지 않고 단계만 그대로 남습니다. 처음 받은 먹붓은 부서지지 않고 +0으로 돌아갑니다.</p>
      <div class="rate-table"><table><thead><tr><th>목표</th><th>성공</th><th>실패 시 파괴</th><th>한 번에 파괴될 확률</th><th>먹돌</th><th>안료</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
}

/* ---------- actions ---------- */
export async function growthAction(
  what: string, b: HTMLElement, api: GameApi, p: ProfileView, st: GrowthState, apply: (p: ProfileView) => void, redraw: () => void,
): Promise<boolean> {
  if (what === "pickBrush") { st.brush = b.dataset.id ?? st.brush; st.stage = ""; return true; }
  if (what === "toggleProtect") { st.protect = !st.protect; return true; }
  if (what === "train") {
    const i = Number(b.dataset.i);
    const before = p.skills?.[i] ?? 1;
    const r = await attempt(api.trainSkill(i));
    if (r) {
      apply(r);
      const lv = r.skills?.[i] ?? before + 1;
      const aw = (AWAKEN_AT as readonly number[]).includes(lv) ? AWAKENINGS[i][lv as 5 | 10].text : "";
      toast(`${SKILLS[i].name} ${lv}단계${aw ? ` · ${aw}` : ""}`);
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
