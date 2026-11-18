# 채묵: 잃어버린 색 (mukdong-ink)

Verse8 web multiplayer RPG. Vite + TypeScript + three.js (vanilla DOM UI, no React). Server in `server/src/server.ts`
(@agent8/gameserver-node). Client and server share `src/shared/`. Read `docs/DESIGN.md` and `docs/API.md` first.

- Talk to the user in Korean.
- **Never** put hanja / Chinese characters anywhere (UI, textures, seals, icons, fonts). Use hangul or drawn shapes.
- HUD gauges (HP, EXP, boss HP, skill cooldown rings) are colored and must stand out (HP cinnabar red, EXP gold, skills in their own colors). The "color only in skills and dyed gear" rule is about the 3D world, not these gauges.
- **Never** show the browser's default scrollbar. Scrollbars are hidden globally in `src/style.css`; scrollable panels keep scrolling and hint overflow with a fade or a drawn ink bar.
- **Never** add interstitial ads. Rewarded ads only, only from a button press.
- The world is ink-wash; color appears only in skills and dyed/colored gear.
- Protagonist has no fixed name: it is the player's nickname (fallback "나그네"). NPC lines call the player with
  `{이름}` / `{이름/아}` (see `fillName` in `src/shared/story.ts`). Look: stick figure, round head, ~5 heads tall,
  connected joints, scarf + sash props, no clothes, fights with a large calligraphy brush. Code and comments still
  call the figure 먹동이 internally. Not "졸라맨" — never use that name or look.
- Server patterns follow the user's live Verse8 game Grove Hunters (`C:\Users\anjsh\OneDrive\Desktop\grove hunters`,
  read-only reference): one `Server` class + feature modules, identity from `$sender.account`, `$lock` around every
  shared write, purchase dedupe by receipt row, gacha rolled on the server under a lock, pity per player.
- `src/shared/` must stay pure: no DOM, no three, no module side effects, no inline IIFEs (server sandbox), randomness
  passed in.
- Verse8 project: remote `gitlab` (gitlab.verse8.io/anjshdkdl99/game-pe7z), branch `develop`. Pushing `master` to
  `gitlab develop` deploys the game (and its server). The user's standing OK: push after every finished, verified
  task (`git push gitlab master:develop`). Never edit `.agent8.lock` / `.env` (the verse id). The token lives only in
  `.git/config`. `npm run dev` now talks to the real server (the `.env` verse); `npm run dev:offline` stays local.
- Before saying work is done: `npx tsc -b`, `npx vitest run`, `npm run server:test`, `npx vite build`.
- three.js/WebAudio memory rules: `~/.claude/web-game-memory-checklist.md` (share geometry/materials, pool effects,
  no per-frame allocation, dispose what you create).
- `proto/` holds the single-file prototypes the design came from (reference only, not built).
