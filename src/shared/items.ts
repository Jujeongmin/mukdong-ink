import type { Rarity, SlotId } from "./types";

export interface ItemDef {
  id: string;
  slot: SlotId;
  name: string;
  r: Rarity;
  /** icon cell, left-to-right, top-to-bottom, in the sheet `atlas` names */
  icon: number;
  /**
   * which icon sheet: "items" (default) = public/assets/items_v3.png (4x4); "weapons2" = public/assets/weapons3.png
   * (3x2, the swords)
   */
  atlas?: "items" | "weapons2";
  /** weapons: the hero's signature brush, or a sword (both paint ink strokes when swung) */
  kind?: "brush" | "sword";
  atk?: number;
  /** look */
  shape?: "satgat" | "gat" | "mask" | null;
  shaft?: number;
  shaftTint?: number;
  tassel?: number;
  gold?: boolean;
  heavy?: boolean;
  /** a colored item stays in color in the ink world */
  tint?: number;
  /** swords: blade length in metres (the blade stays ink-black / steel-grey; only accents take `tint`) */
  bladeLen?: number;
  /** swords: the guard's shape */
  guard?: "none" | "round" | "square" | "cloud";
}

export const ITEMS: ItemDef[] = [
  { id: "w_brush", slot: "weapon", kind: "brush", name: "먹붓", r: "일반", icon: 0, atk: 10 },
  { id: "w_bamboo", slot: "weapon", kind: "brush", name: "대나무붓", r: "일반", icon: 1, atk: 11, shaft: 0x7f9a52 },
  { id: "w_heavy", slot: "weapon", kind: "brush", name: "검은바람붓", r: "희귀", icon: 2, atk: 14, shaft: 0x2e2a26, heavy: true },
  { id: "w_tassel", slot: "weapon", kind: "brush", name: "푸른용붓", r: "영웅", icon: 3, atk: 18, tassel: 0x2f6fb0, tint: 0x2f6fb0 },
  { id: "w_lotus", slot: "weapon", kind: "brush", name: "붉은연꽃붓", r: "영웅", icon: 4, atk: 18, shaftTint: 0xc0281c, tint: 0xc0281c },
  { id: "w_gold", slot: "weapon", kind: "brush", name: "황금붓", r: "전설", icon: 5, atk: 24, gold: true, tint: 0xd9a640 },
  // Swords: equipment and gacha only; the brush stays the default and signature weapon. Accents (tassel, guard)
  // take color on 영웅/전설 only.
  { id: "w_inkblade", slot: "weapon", kind: "sword", name: "먹칼", r: "일반", atlas: "weapons2", icon: 0, atk: 11, bladeLen: 0.9, guard: "round" },
  { id: "w_reedblade", slot: "weapon", kind: "sword", name: "갈대검", r: "희귀", atlas: "weapons2", icon: 1, atk: 14, bladeLen: 1.0, guard: "none" },
  { id: "w_rainblade", slot: "weapon", kind: "sword", name: "빗줄기검", r: "영웅", atlas: "weapons2", icon: 2, atk: 18, bladeLen: 1.05, guard: "square", tassel: 0x5fa8a0, tint: 0x5fa8a0 },
  { id: "w_nightblade", slot: "weapon", kind: "sword", name: "달밤검", r: "영웅", atlas: "weapons2", icon: 3, atk: 18, bladeLen: 1.1, guard: "cloud", tassel: 0x7a2f6a, tint: 0x7a2f6a },
  { id: "w_voidblade", slot: "weapon", kind: "sword", name: "칠흑검", r: "전설", atlas: "weapons2", icon: 4, atk: 24, bladeLen: 1.2, guard: "cloud", tint: 0xd9a640 },
  { id: "h_satgat", slot: "hat", name: "삿갓", r: "일반", icon: 6, shape: "satgat" },
  { id: "h_none", slot: "hat", name: "맨머리", r: "일반", icon: 7, shape: null },
  { id: "h_gat", slot: "hat", name: "검은 갓", r: "희귀", icon: 8, shape: "gat" },
  { id: "h_mask", slot: "hat", name: "나무탈", r: "영웅", icon: 9, shape: "mask" },
  { id: "h_goldgat", slot: "hat", name: "금테 갓", r: "전설", icon: 10, shape: "gat", tint: 0xc9a23a },
  { id: "s_plain", slot: "sash", name: "무명 띠", r: "일반", icon: 11 },
  { id: "s_hemp", slot: "sash", name: "삼베 띠", r: "일반", icon: 12 },
  { id: "s_indigo", slot: "sash", name: "남색 띠", r: "희귀", icon: 13, tint: 0x2a4f8a },
  { id: "s_red", slot: "sash", name: "붉은 띠", r: "영웅", icon: 14, tint: 0xa8231a },
  { id: "s_gold", slot: "sash", name: "금실 띠", r: "전설", icon: 15, tint: 0xc9a23a },
];

export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const STARTER_OWNED = ["w_brush", "h_none", "h_satgat", "s_plain"];
export const STARTER_EQUIP: Record<SlotId, string> = { weapon: "w_brush", hat: "h_none", sash: "s_plain" };

export interface DyeDef {
  name: string;
  hex: number | null; // null = remove dye (back to ink)
}
export const DYES: DyeDef[] = [
  { name: "분홍", hex: 0xe58aa5 },
  { name: "빨강", hex: 0xc0281c },
  { name: "파랑", hex: 0x2a4f8a },
  { name: "노랑", hex: 0xd9b13a },
  { name: "연두", hex: 0x7fae3e },
  { name: "보라", hex: 0x7a2f6a },
  { name: "청록", hex: 0x5fa8a0 },
  { name: "검정", hex: null },
];
export const DYE_COST = 30; // 안료 per dye
export const STARTER_DYE = { sash: 0x2a4f8a, scarf: 0xe58aa5 };

/* ---------- gacha (오방 병기전) ---------- */
// No rate-up banners and no cosmetic-only draws (decided by the user, 2026-11-17): one pool, published odds,
// pity. The starter gear is never drawn (everyone has it); the 일반 tier also holds enhancement materials.
export const RARITY_RATES: { r: Rarity; p: number }[] = [
  { r: "전설", p: 0.02 },
  { r: "영웅", p: 0.08 },
  { r: "희귀", p: 0.3 },
  { r: "일반", p: 0.6 },
];

/** Materials a draw or a duplicate can give. */
export interface Grant {
  stones?: number;
  shards?: number;
}

/** A draw that is not gear: an enhancement-material bundle (gacha only, never 전설). */
export interface GachaExtra {
  id: string;
  name: string;
  r: Rarity;
  /** cell in public/assets/materials2.png (0 먹돌, 1 색 조각, 2 파괴방지권, 3 물약) */
  atlas: "materials";
  icon: number;
  grant: Grant;
}
export const GACHA_EXTRA: GachaExtra[] = [
  { id: "g_stones6", name: "먹돌 꾸러미", r: "일반", atlas: "materials", icon: 0, grant: { stones: 6 } },
  { id: "g_stones12", name: "큰 먹돌 꾸러미", r: "일반", atlas: "materials", icon: 0, grant: { stones: 12 } },
  { id: "g_shard1", name: "색 조각", r: "일반", atlas: "materials", icon: 1, grant: { shards: 1 } },
];
export const GACHA_EXTRA_BY_ID: Record<string, GachaExtra> = Object.fromEntries(GACHA_EXTRA.map((g) => [g.id, g]));

/** Gear everyone starts with (or the bare head): never drawn. */
export const NOT_DRAWN = ["w_brush", "h_satgat", "s_plain", "h_none"];
/** The gear that can be drawn. */
export const GACHA_POOL = ITEMS.filter((i) => !NOT_DRAWN.includes(i.id));

/** One entry of the draw: gear or a material bundle. */
export interface GachaEntry {
  id: string;
  name: string;
  r: Rarity;
  kind: "item" | "material";
}
export const GACHA_ENTRIES: GachaEntry[] = [
  ...GACHA_POOL.map((i): GachaEntry => ({ id: i.id, name: i.name, r: i.r, kind: "item" })),
  ...GACHA_EXTRA.map((g): GachaEntry => ({ id: g.id, name: g.name, r: g.r, kind: "material" })),
];

export const PITY = 50; // legendary gear guaranteed on the 50th pull without one
export const COST1 = 160; // 묵옥
export const COST10 = 1600;

/** What a duplicate of owned gear turns into: 먹돌 for weapons, 색 조각 for hats and sashes, by rarity. */
export const DUPE_STONES: Record<Rarity, number> = { 일반: 4, 희귀: 8, 영웅: 16, 전설: 30 };
export const DUPE_SHARDS: Record<Rarity, number> = { 일반: 1, 희귀: 1, 영웅: 2, 전설: 4 };
export function dupeGrant(item: ItemDef): Grant {
  return item.slot === "weapon" ? { stones: DUPE_STONES[item.r] } : { shards: DUPE_SHARDS[item.r] };
}

/** Per-entry probability shown in the published odds table (gear and materials; they add up to 1). */
export function itemOdds(): { id: string; name: string; r: Rarity; kind: "item" | "material"; p: number }[] {
  const out: { id: string; name: string; r: Rarity; kind: "item" | "material"; p: number }[] = [];
  for (const { r, p } of RARITY_RATES) {
    const list = GACHA_ENTRIES.filter((e) => e.r === r);
    for (const e of list) out.push({ id: e.id, name: e.name, r, kind: e.kind, p: p / list.length });
  }
  return out;
}

/**
 * Pure gacha roll. `rand` returns [0,1). Pity counts pulls since the last legendary.
 * A 10-pull guarantees at least one 희귀 or better (the 10th is lifted if needed). Ids are gear ids or
 * GACHA_EXTRA ids; 전설 (and so pity) is always gear.
 */
export function rollGacha(n: 1 | 10, pity: number, rand: () => number): { ids: string[]; pity: number } {
  const ids: string[] = [];
  let rarePlus = false;
  for (let k = 0; k < n; k++) {
    let r: Rarity;
    if (pity >= PITY - 1) r = "전설";
    else {
      const u = rand();
      let acc = 0;
      r = "일반";
      for (const rr of RARITY_RATES) {
        acc += rr.p;
        if (u < acc) {
          r = rr.r;
          break;
        }
      }
      if (n === 10 && k === 9 && !rarePlus && r === "일반") r = "희귀";
    }
    if (r !== "일반") rarePlus = true;
    pity = r === "전설" ? 0 : pity + 1;
    const list = GACHA_ENTRIES.filter((e) => e.r === r);
    ids.push(list[Math.min(list.length - 1, Math.floor(rand() * list.length))].id);
  }
  return { ids, pity };
}
