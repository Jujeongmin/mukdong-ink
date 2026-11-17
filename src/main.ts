// First, before anything reaches for storage: @agent8/gameserver touches localStorage while its
// module is being evaluated. See storageFallback.ts.
import "./storageFallback";

import "./style.css";
// sheets, resource chips, tooltips, HUD tablets (after style.css so it wins at equal specificity)
import "./ui-sheets.css";
import { boot } from "./game/game";

void boot();
