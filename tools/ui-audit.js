// Dev check, loaded in the running game: await import('/tools/ui-audit.js'); __a()
// pasted into the page: reports text that clips, runs out of its box, leaves the screen, and HUD blocks that overlap
window.__a = (scope) => {
  const root = scope ? document.querySelector(scope) : document.querySelector("#ui");
  const vw = innerWidth, vh = innerHeight, out = [];
  const vis = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return false; } return true; };
  const name = (e) => (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : e.tagName.toLowerCase()) + ' "' + (e.textContent || "").trim().slice(0, 26) + '"';
  const R = (r) => [r.left, r.top, r.right, r.bottom].map(Math.round).join(",");
  for (const e of root.querySelectorAll("*")) {
    if (e.closest(".dmg, canvas")) continue;
    const texts = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !vis(e)) continue;
    const cs = getComputedStyle(e);
    if (e.clientWidth > 0 && (cs.overflowX !== "visible" || cs.whiteSpace === "nowrap") && (e.scrollWidth > e.clientWidth + 1 || (cs.overflowY !== "visible" && e.scrollHeight > e.clientHeight + 1)) && cs.overflowY !== "auto" && cs.overflowX !== "auto")
      out.push("CLIP " + name(e) + (e.dataset.fitZ ? " fit=" + e.dataset.fitZ : ""));
    const rg = document.createRange();
    for (const n of texts) {
      rg.selectNodeContents(n);
      const tr = rg.getBoundingClientRect();
      const clipped = (() => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const c = getComputedStyle(x); if (c.overflowX !== "visible" || c.overflowY !== "visible") return true; } return false; })();
      if (!clipped && (tr.right > vw + 1 || tr.left < -1 || tr.bottom > vh + 1 || tr.top < -1)) out.push("OFFSCREEN " + name(e) + " " + R(tr));
      if (e.closest("details:not([open])")) continue;
      // the text runs past its block's box (overflow visible)
      let box = e;
      while (box && getComputedStyle(box).display.startsWith("inline")) box = box.parentElement;
      if (box) {
        const br = box.getBoundingClientRect();
        if (br.width > 4 && (tr.right > br.right + 3 || tr.left < br.left - 3)) out.push("SPILL " + name(e) + " text " + R(tr) + " box " + R(br));
      }
    }
  }
  // HUD blocks overlapping each other
  const blocks = [...document.querySelectorAll("#ui > *")].filter((e) => vis(e) && !e.matches(".sheet, .loading, .dlg, .fade, .toasts, .tags, .tip, .power-pop, script")).map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.width < vw * 0.9);
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const [a, ra] = blocks[i], [b, rb] = blocks[j];
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && h > 4) out.push("OVERLAP " + name(a).slice(0, 30) + " x " + name(b).slice(0, 30) + " " + Math.round(w) + "x" + Math.round(h));
  }
  const card = document.querySelector("#ui .sheet:not(.closing) .sheet-card");
  if (card) { const sc = card.querySelector(".scroll") || card; if (sc.scrollHeight > sc.clientHeight + 2) out.push("SCROLLS sheet " + sc.scrollHeight + "/" + sc.clientHeight); }
  return [...new Set(out)].join("\n") || "clean";
};
