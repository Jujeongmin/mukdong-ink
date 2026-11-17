// One tooltip for the whole UI: a small paper tablet with a thin double ink rule (ui-sheets.css .tip).
// Any element opts in with attributes, read when the tip opens (so they can change freely):
//   data-tip="body"            short explanation (\n for a second line)
//   data-tip-title="title"     optional first line in brush type
//   data-tip-click             (the "?" tablets) a tap/click toggles it, pinned until the next tap elsewhere
//   data-tip-touch="off"       no long-press tip on touch (the element has its own long press)
// Mouse: shows after a short rest (280 ms; 60 ms when moving from one tip to the next), hides 90 ms after leaving.
// Touch: long-press ~400 ms shows it and swallows the click that follows; it stays until the next touch.
// Keyboard focus shows it too. Placement: above the target, flipped below when there's no room, clamped to the
// viewport. One element, no per-frame work.

const SHOW_MS = 280;
const SWAP_MS = 60;
const HIDE_MS = 90;
const LONG_MS = 400;

let box: HTMLElement | null = null;
let target: HTMLElement | null = null;
let showT = 0;
let hideT = 0;
let longT = 0;
let pinned = false;
let swallowClick = false;
let down: { x: number; y: number } | null = null;

function tipOf(n: EventTarget | null): HTMLElement | null {
  return n instanceof Element ? n.closest<HTMLElement>("[data-tip], [data-tip-title]") : null;
}

function fill(t: HTMLElement): boolean {
  if (!box) return false;
  const title = t.dataset.tipTitle ?? "";
  const body = t.dataset.tip ?? "";
  if (!title && !body) return false;
  box.replaceChildren();
  if (title) { const b = document.createElement("b"); b.textContent = title; box.appendChild(b); }
  if (body) { const p = document.createElement("span"); p.textContent = body; box.appendChild(p); }
  return true;
}

function place(t: HTMLElement): void {
  if (!box) return;
  const r = t.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, m = 8;
  box.style.left = "0px";
  box.style.top = "0px";
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(m, Math.min(vw - w - m, x));
  let y = r.top - h - 8;
  let below = false;
  if (y < m) { y = r.bottom + 8; below = true; }
  if (y + h > vh - m) y = Math.max(m, vh - h - m);
  box.style.left = `${Math.round(x)}px`;
  box.style.top = `${Math.round(y)}px`;
  box.classList.toggle("below", below);
  box.style.setProperty("--ax", `${Math.round(Math.max(10, Math.min(w - 10, r.left + r.width / 2 - x)))}px`);
}

function show(t: HTMLElement): void {
  window.clearTimeout(hideT);
  if (!box || !t.isConnected || !fill(t)) return;
  target = t;
  box.hidden = false;
  place(t);
  box.classList.add("on");
}

export function hideTip(): void {
  window.clearTimeout(showT);
  window.clearTimeout(longT);
  pinned = false;
  target = null;
  if (box) { box.classList.remove("on"); box.hidden = true; }
}

function soon(t: HTMLElement): void {
  window.clearTimeout(showT);
  window.clearTimeout(hideT);
  const visible = !!box && !box.hidden;
  showT = window.setTimeout(() => show(t), visible ? SWAP_MS : SHOW_MS);
}

/** Install once (idempotent). */
export function installTooltips(): void {
  if (box) return;
  box = document.createElement("div");
  box.className = "tip";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  document.body.appendChild(box);

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || pinned) return;
    const t = tipOf(e.target);
    if (!t) return;
    if (t === target && box && !box.hidden) { window.clearTimeout(hideT); return; }
    soon(t);
  }, true);
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse" || pinned) return;
    const from = tipOf(e.target);
    if (!from) return;
    const to = tipOf(e.relatedTarget);
    if (to === from) return;
    window.clearTimeout(showT);
    hideT = window.setTimeout(hideTip, HIDE_MS);
  }, true);

  document.addEventListener("pointerdown", (e) => {
    const t = tipOf(e.target);
    if (box && !box.hidden && t !== target) hideTip();
    if (e.pointerType === "mouse" || !t || t.dataset.tipTouch === "off" || t.hasAttribute("data-tip-click")) return;
    down = { x: e.clientX, y: e.clientY };
    window.clearTimeout(longT);
    longT = window.setTimeout(() => { show(t); pinned = true; swallowClick = true; }, LONG_MS);
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { window.clearTimeout(longT); down = null; }
  }, true);
  const lift = () => { window.clearTimeout(longT); down = null; };
  document.addEventListener("pointerup", lift, true);
  document.addEventListener("pointercancel", lift, true);
  document.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip-click]") : null);
    // a click usually re-renders what the tip pointed at
    if (!t) { if (!pinned && box && !box.hidden) hideTip(); return; }
    e.preventDefault();
    if (pinned && target === t) { hideTip(); return; }
    show(t);
    pinned = true;
  }, true);
  // long-press on touch would also open the system menu on some browsers
  document.addEventListener("contextmenu", (e) => { if (tipOf(e.target) && e instanceof PointerEvent && e.pointerType !== "mouse") e.preventDefault(); }, true);

  document.addEventListener("focusin", (e) => {
    const t = tipOf(e.target);
    if (t && t.matches(":focus-visible")) soon(t);
  });
  document.addEventListener("focusout", () => { if (!pinned) { window.clearTimeout(showT); hideT = window.setTimeout(hideTip, HIDE_MS); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box && !box.hidden) hideTip(); }, true);
  window.addEventListener("resize", hideTip);
  document.addEventListener("scroll", () => { if (box && !box.hidden) hideTip(); }, true);
}
