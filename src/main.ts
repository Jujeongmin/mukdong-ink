// First, before anything reaches for storage: @agent8/gameserver touches localStorage while its
// module is being evaluated. See storageFallback.ts.
import "./storageFallback";

import "./style.css";
// sheets, resource chips, tooltips, HUD tablets (after style.css so it wins at equal specificity)
import "./ui-sheets.css";
import { initLang } from "./game/i18n";

// the language pack loads before the game modules are evaluated, so their tables can call t()
void initLang()
  .then(async () => {
    const [{ boot }, { startFit }] = await Promise.all([import("./game/game"), import("./game/ui/fit")]);
    const ui = document.getElementById("ui");
    if (ui) startFit(ui);
    await boot();
  });
