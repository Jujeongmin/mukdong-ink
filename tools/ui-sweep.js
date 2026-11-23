// Dev check: opens every window and tab and runs the overflow audit on each.
//   await import('/tools/ui-sweep.js'); await __sweep()
await import("/tools/ui-audit.js?" + Date.now());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
window.__sweep = async (only) => {
  const S = window.__ink.game.sheets;
  const opens = {
    gear: () => S.openGear(), growth: () => S.openGrowth(), shop: () => S.openShop(), rank: () => S.openRank(), album: () => S.openAlbum(),
    settings: () => S.openSettings(), elder: () => S.openNpc({ role: "elder" }), dyer: () => S.openNpc({ role: "dyer" }), altar: () => S.openNpc({ role: "altar" }),
  };
  const res = [];
  if (!only || only.includes("hud")) { S.close(); await wait(450); res.push(`== hud
${__a()}`); }
  for (const [k, open] of Object.entries(opens)) {
    if (only && !only.includes(k)) continue;
    S.close(); await wait(450); open(); await wait(900);
    const tabs = [...document.querySelectorAll("#ui .sheet:not(.closing) .tabs [data-tab], #ui .sheet:not(.closing) .tabs button")];
    const ids = [...new Set(tabs.map((b) => b.dataset.tab).filter(Boolean))];
    if (!ids.length) { res.push(`== ${k}\n${__a()}`); continue; }
    for (const id of ids) {
      document.querySelector(`#ui .sheet:not(.closing) .tabs [data-tab="${id}"]`)?.click(); await wait(500);
      res.push(`== ${k}/${id}\n${__a()}`);
    }
  }
  S.close();
  return res.join("\n");
};
