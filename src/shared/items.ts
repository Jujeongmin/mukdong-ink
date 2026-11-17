import type { Rarity, SlotId } from "./types";

export interface ItemDef {
  id: string;
  slot: SlotId;
  name: string;
  r: Rarity;
  /** cell in public/assets/items.png (4x4, left-to-right, top-to-bottom) */
  icon: number;
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
  trail?: "gold";
}

export const ITEMS: ItemDef[] = [
  { id: "w_brush", slot: "weapon", name: "먹붓", r: "일반", icon: 0, atk: 10 },
  { id: "w_bamboo", slot: "weapon", name: "죽필", r: "일반", icon: 1, atk: 11, shaft: 0x7f9a52 },
  { id: "w_heavy", slot: "weapon", name: "흑풍필", r: "희귀", icon: 2, atk: 14, shaft: 0x2e2a26, heavy: true },
  { id: "w_tassel", slot: "weapon", name: "청룡필", r: "영웅", icon: 3, atk: 18, tassel: 0x2f6fb0, tint: 0x2f6fb0 },
  { id: "w_lotus", slot: "weapon", name: "홍련필", r: "영웅", icon: 4, atk: 18, shaftTint: 0xc0281c, tint: 0xc0281c },
  { id: "w_gold", slot: "weapon", name: "금니붓", r: "전설", icon: 5, atk: 24, gold: true, tint: 0xd9a640, trail: "gold" },
  { id: "h_satgat", slot: "hat", name: "삿갓", r: "일반", icon: 6, shape: "satgat" },
  { id: "h_none", slot: "hat", name: "맨머리", r: "일반", icon: 7, shape: null },
  { id: "h_gat", slot: "hat", name: "흑립", r: "희귀", icon: 8, shape: "gat" },
  { id: "h_mask", slot: "hat", name: "나무탈", r: "영웅", icon: 9, shape: "mask" },
  { id: "h_goldgat", slot: "hat", name: "금테 흑립", r: "전설", icon: 10, shape: "gat", tint: 0xc9a23a },
  { id: "s_plain", slot: "sash", name: "무명 띠", r: "일반", icon: 11 },
  { id: "s_hemp", slot: "sash", name: "삼베 띠", r: "일반", icon: 12 },
  { id: "s_indigo", slot: "sash", name: "쪽빛 띠", r: "희귀", icon: 13, tint: 0x2a4f8a },
  { id: "s_red", slot: "sash", name: "홍띠", r: "영웅", icon: 14, tint: 0xa8231a },
  { id: "s_gold", slot: "sash", name: "금수 띠", r: "전설", icon: 15, tint: 0xc9a23a },
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
  { name: "다홍", hex: 0xc0281c },
  { name: "쪽빛", hex: 0x2a4f8a },
  { name: "송화", hex: 0xd9b13a },
  { name: "연두", hex: 0x7fae3e },
  { name: "자주", hex: 0x7a2f6a },
  { name: "옥색", hex: 0x5fa8a0 },
  { name: "먹", hex: null },
];
export const DYE_COST = 30; // 안료 per dye
export const STARTER_DYE = { sash: 0x2a4f8a, scarf: 0xe58aa5 };

/* ---------- gacha (오방 병기전) ---------- */
export const RARITY_RATES: { r: Rarity; p: number }[] = [
  { r: "전설", p: 0.02 },
  { r: "영웅", p: 0.08 },
  { r: "희귀", p: 0.3 },
  { r: "일반", p: 0.6 },
];
export const GACHA_POOL = ITEMS.filter((i) => i.id !== "h_none");
export const PITY = 50; // legendary guaranteed on the 50th pull without one
export const COST1 = 160; // 묵옥
export const COST10 = 1600;
export const DUPE_PIGMENT = 20;

/** Per-item probability shown in the published odds table. */
export function itemOdds(): { id: string; r: Rarity; p: number }[] {
  const out: { id: string; r: Rarity; p: number }[] = [];
  for (const { r, p } of RARITY_RATES) {
    const list = GACHA_POOL.filter((i) => i.r === r);
    for (const it of list) out.push({ id: it.id, r, p: p / list.length });
  }
  return out;
}

/**
 * Pure gacha roll. `rand` returns [0,1). Pity counts pulls since the last legendary.
 * A 10-pull guarantees at least one 희귀 or better (the 10th is lifted if needed).
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
    const list = GACHA_POOL.filter((i) => i.r === r);
    ids.push(list[Math.min(list.length - 1, Math.floor(rand() * list.length))].id);
  }
  return { ids, pity };
}
