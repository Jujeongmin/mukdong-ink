# 채묵: 잃어버린 색 — design

## Pitch
An ink-wash (수묵화) multiplayer RPG on Verse8. The world is drawn in ink on rice paper; the only color comes from the
five-color (오방색) brush techniques players use and from dyed gear, so every other player's skill is visible as a
flash of color across the monochrome field. The hero, 먹동이, fights with a large calligraphy brush.

## Decided (by the user)
- RPG, 3D quarter-view camera, multiplayer, Verse8 first (paid store later if it does well).
- Channel MMO like Grove Hunters: zones × channels, each zone-channel one Verse8 room.
- Color only in skills and gear. World coloring / region purification was dropped. No party color combos.
- Monetization: paid currency 묵옥 → gacha for brushes/hats/sashes (published odds, pity), dyes with free 안료,
  rewarded ads only. No interstitials ever. Color restoration / progress is never sold.
- No hanja anywhere. Readable fonts (Gowun Batang headings, Gowun Dodum body).

## Content (v1)
- Zones: 먹골 마을 (safe hub: 먹노인 quests, 염색 장인 dyes+potions, 병기 제단 gacha) → 죽림 (Lv1–8) → 연못가 (Lv8–15)
  → 먹봉우리 (Lv15–20, boss 대먹귀). Portals at zone edges.
- Levels 1–20. Skills unlock: 물결베기 1, 화염선풍 4, 대지낙하 8, 바람질주 12, 먹감옥 16.
- Basic combo: 3 ground swings (third is a spin), air spin, dash slash.
- Monsters: 먹방울 (contact), 먹그림자 (wind-up melee), 먹두꺼비 (ranged ink shot), 대먹귀 (telegraphed slam boss).
- Main quest chain of 9 steps ending at the boss; 3 daily quests.
- Potions bought with 안료; respawn in the village after death.

## Rendering
- Scene rendered normally, then an ink post pass (edges from depth+normals, quantized washes, paper grain).
- Dyed materials write alpha 0.5 into the scene target; the ink pass keeps their color.
- Skill effects are drawn after the ink pass (overlay scene) in full color; "skill light" reveals the world's real color
  briefly around a skill.
- Images: `public/assets/skills.png` (3×3), `items.png` (4×4), `ui.png` (2×2) generated once with Codex
  (prompt in docs/IMAGE-PROMPT.md). Used as CSS sprites.

## Out of scope for v1
Party, guild, market, mail, PvP, mounts, cosmetics beyond the gacha pool.
