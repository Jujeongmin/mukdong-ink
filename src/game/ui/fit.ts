// Translated text is often longer than the Korean the layout was tuned for. In the other languages, any element
// that clips or refuses to wrap (nowrap, overflow hidden, line-clamp) and whose text no longer fits gets scaled
// down with `zoom` (which also scales children with their own px sizes), in steps, to at most MIN. Checked when
// that part of the UI changes (one pass per frame) and on resize. Korean is left alone: it was laid out by hand.
import { getLang } from "../i18n";

const MIN = 0.62;
const STEP = 0.93;
/** pooled floating numbers and the like change every frame and never clip */
const SKIP = ".dmg, canvas, svg, [data-nofit]";

function clips(cs: CSSStyleDeclaration): boolean {
  if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") return false;
  return cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre" || cs.overflowX === "hidden" || cs.overflowY === "hidden" || cs.textOverflow === "ellipsis";
}

/** One-line text is judged by width only (descenders poke a few px below a clipped box); wrapping text by height. */
function overflows(e: HTMLElement): boolean {
  if (e.scrollWidth > e.clientWidth + 1) return true;
  const cs = getComputedStyle(e);
  return cs.whiteSpace !== "nowrap" && cs.overflowY !== "visible" && e.scrollHeight > e.clientHeight + 4;
}

function fitOne(e: HTMLElement): void {
  if (!e.firstChild || e.clientWidth === 0) return;
  const cs = getComputedStyle(e);
  if (cs.display === "none" || !clips(cs)) return;
  // start from full size each time (the text may have become shorter)
  if (e.dataset.fitZ) { e.style.zoom = ""; delete e.dataset.fitZ; }
  if (e.dataset.fitF !== undefined) { e.style.fontSize = e.dataset.fitF; delete e.dataset.fitF; }
  if (!overflows(e)) return;
  let z = 1;
  while (z * STEP >= MIN) {
    z *= STEP;
    e.style.zoom = z.toFixed(3);
    if (!overflows(e)) { e.dataset.fitZ = z.toFixed(3); return; }
  }
  e.style.zoom = "";
  // zoom also shrinks a box sized in px (max-width etc.), so it never fits: shrink just the font instead
  const inline = e.style.fontSize;
  const base = parseFloat(getComputedStyle(e).fontSize);
  for (let f = STEP; f >= MIN; f *= STEP) {
    e.style.fontSize = `${(base * f).toFixed(1)}px`;
    if (!overflows(e)) { e.dataset.fitF = inline; return; }
  }
  // still too long (or it clips on purpose): leave it as it was
  e.style.fontSize = inline;
}

function scan(root: Element): void {
  if (!(root instanceof HTMLElement) || root.closest(SKIP)) return;
  fitOne(root);
  root.querySelectorAll<HTMLElement>("*").forEach((e) => { if (!e.closest(SKIP)) fitOne(e); });
}

/** Watch the UI root (only outside Korean). */
export function startFit(root: HTMLElement): void {
  if (getLang() === "ko") return;
  const pending = new Set<Element>();
  let raf = 0;
  const flush = () => {
    raf = 0;
    // parents first: a parent's zoom changes what its children have room for
    const list = [...pending].filter((e) => e.isConnected && ![...pending].some((p) => p !== e && p.contains(e)));
    pending.clear();
    for (const e of list) scan(e);
  };
  const queue = (e: Element | null) => {
    if (!e || e.closest(SKIP)) return;
    pending.add(e);
    if (!raf) raf = requestAnimationFrame(flush);
  };
  new MutationObserver((ms) => {
    for (const m of ms) queue(m.target.nodeType === 1 ? (m.target as Element) : m.target.parentElement);
  }).observe(root, { subtree: true, childList: true, characterData: true });
  let t = 0;
  window.addEventListener("resize", () => { window.clearTimeout(t); t = window.setTimeout(() => queue(root), 200); });
  // web fonts arriving change widths
  void document.fonts?.ready.then(() => queue(root));
  queue(root);
}
