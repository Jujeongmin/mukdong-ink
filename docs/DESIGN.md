# 채묵: 잃어버린 색 — design

## Pitch
An ink-wash (수묵화) multiplayer RPG on Verse8. The world is drawn in ink on rice paper; the only color comes from the
five-color (오방색) brush techniques players use and from dyed gear, so every other player's skill is visible as a
flash of color across the monochrome field. The hero (an ink stick figure, called 먹동이 in code) fights with a large calligraphy brush.

## Decided (by the user)
- RPG, 3D quarter-view camera, multiplayer, Verse8 first (paid store later if it does well).
- Channel MMO like Grove Hunters: zones × channels, each zone-channel one Verse8 room.
- Color only in skills and gear. World coloring / region purification was dropped. No party color combos.
- Monetization: paid currency 묵옥 → one gacha pool (published odds, pity; no rate-up banners, no cosmetic-only gacha):
  brushes, swords, hats, sashes, plus enhancement-material bundles in the 일반 tier (먹돌 꾸러미 +6, 큰 먹돌 꾸러미 +12,
  색 조각 +1). Starter gear is never drawn. Duplicate gear becomes materials (weapons → 먹돌 4/8/16/30, hats and sashes
  → 색 조각 1/1/2/4 by rarity). Pity always gives 전설 gear. Dyes with free 안료,
  rewarded ads only. No interstitials ever. Color restoration / progress is never sold.
- Quests: 본편 (story, one-time), 오늘의 의뢰 (daily, resets), 서브 퀘스트 = 지역 의뢰 (3 per field, repeatable, one open at a time from the field that suits your 경지). When 본편 needs a 경지 you lack, the tracker says so and 자동 진행 goes through dailies, then 서브, then back.
- The hero has no fixed name: NPCs call the player by their nickname (`{이름}` in story lines); default name 나그네.
- No hanja anywhere. Readable fonts (Gowun Batang headings, Gowun Dodum body).

## Content (v1)
- Zones: 먹골 마을 (safe hub: 먹노인 quests, 염색 장인 dyes+potions, 병기 제단 gacha) → 죽림 (Lv1–8) → 연못가 (Lv8–15)
  → 먹봉우리 (Lv15–20, boss 대먹귀) → east door → 솔재 마을 (second safe village: 산할미 daily quests, 여울 dyes+potions,
  무쇠 altar) → 옛 가마터 (Lv20–27) → 불탄 절터 (Lv27–33) → 향로 마당 (boss 잿불귀). Portals at zone edges.
- Villages (2026-11): 순간이동 between 먹골 and 솔재 from either village (map sheet, or the village elder's "다른 마을로"); 솔재
  opens once the main quest reaches "봉우리 너머" (c2q3). Falling past the peak (솔재, kiln, temple, censer) you rise in 솔재
  (ZoneDef.home), before it in 먹골. A fresh start still always comes into 먹골.
- Minimap (top left under the portrait, N or a tap opens the map sheet): the zone's path, gates with where they lead, NPCs
  (gold with a quest mark), fixed monster spots and the boss ground, other players, you. Field monsters are not tracked
  live; the map sheet lists each zone's monsters with levels, count and drops (pigment, 먹돌 / 색 조각 chance, jade), its
  NPCs and roads, and the 순간이동 button for villages.
- Levels 1–35 (MAX_LEVEL). Skills unlock: 물결베기 1, 화염선풍 4, 대지낙하 8, 바람질주 12, 먹감옥 16.
- Basic combo: 3 ground swings (third is a spin), air spin, dash slash.
- 궁극기 「무지개 붓질」 (2026-11, F or its button): there from level 1 (decided 2026-11-24). A gauge (0–100)
  fills as you strike (2 per monster hit, at most 8 a blow) and fell (6 each); full, the leap: gather, rise turning
  with the brush drawing a rainbow ring, hold at the top, drop; the server strikes a 7.5 m ring for 9 × attack when it
  is asked (at the leap's start) and you are untouchable for 2.2 s; kills die in the rainbow color of their direction.
  The gauge lives in room user state, goes with you through portals, and is kept in the profile on kills and zone
  changes. Auto-play fires it when full with something in reach (자동 설정 can turn that off). Others see it (pose skill 5).
  The button is the rainbow ensō picture itself, grey and filling with color from the bottom up, with a small percent.
- Monsters: 먹방울 (contact), 먹그림자 (wind-up melee), 먹두꺼비 (ranged ink shot), 대먹귀 (telegraphed slam boss).
- Main quest chain of 9 steps ending at the boss; 3 daily quests.
- Potions bought with 안료; respawn in the village of that part of the world after death.

## Health and potions (balance, 2026-11)
- Max health `100 + 20 × level` (+ hat and 도감 bonuses). It was 80 + 14/level, and a field monster's blow took
  12–25% of it; an MMO's is nearer 5–10%. 부푼 먹방울 (the roll gate) still takes 35–40% at level 2 (atk 42).
- Health comes back by itself once nothing has hit you for 5 s: 3% of max a second in a hunting zone, 12% in the
  village. The server's room tick does it (at most one write a second per player); the profile keeps it once full.
- A potion heals 45% of max health (1.5 s apart) and costs `10 + level` 안료 (15 at level 5, 45 at 35). A kill's
  안료 is flat (3 for a 먹방울, 8–10 late), so this keeps a potion at about four or five kills at every stage.
- Code: `maxHpFor`, `REGEN_*`, `POTION_HEAL`, `potionCost` in `src/shared/combat.ts`; `regenRoom` in the server.

## Rendering
- Scene rendered normally, then an ink post pass (edges from depth+normals, quantized washes, paper grain).
- Dyed materials write alpha 0.5 into the scene target; the ink pass keeps their color.
- Skill effects are drawn after the ink pass (overlay scene) in full color; "skill light" reveals the world's real color
  briefly around a skill.
- Images: `public/assets/skills.png` (3×3), `items.png` (4×4), `ui.png` (2×2) generated once with Codex
  (prompt in docs/IMAGE-PROMPT.md). Used as CSS sprites.

## Out of scope for v1
Party, guild, market, mail, PvP, mounts, cosmetics beyond the gacha pool.
