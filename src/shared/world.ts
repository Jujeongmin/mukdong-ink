// Zones, NPCs, portals, quests and shop products. Layout data drives both the client's scenery and
// the server's spawn/portal/proximity checks ("what you see is what you walk on").

export interface Portal {
  to: string;
  x: number;
  z: number;
  /** where you appear in the destination zone */
  arriveX: number;
  arriveZ: number;
  label: string;
}
export interface Npc {
  id: string;
  name: string;
  role: "elder" | "dyer" | "altar" | "guide";
  x: number;
  z: number;
}
export interface SpawnRule {
  kind: string;
  count: number;
  level: [number, number];
}
export interface ZoneDef {
  id: string;
  name: string;
  /** walkable disc radius around (0,0) */
  radius: number;
  safe: boolean;
  levels: [number, number];
  ground: number;
  spawns: SpawnRule[];
  boss?: { kind: string; level: number; respawnMs: number; x: number; z: number };
  portals: Portal[];
  npcs: Npc[];
  /** scenery theme used by the client */
  theme: "village" | "bamboo" | "pond" | "peak";
}

export const ZONES: Record<string, ZoneDef> = {
  village: {
    id: "village", name: "먹골 마을", radius: 22, safe: true, levels: [1, 20], ground: 0xb7b08f, theme: "village",
    spawns: [],
    portals: [{ to: "bamboo", x: 0, z: -20, arriveX: 0, arriveZ: 24, label: "죽림으로" }],
    npcs: [
      { id: "elder", name: "먹노인", role: "elder", x: -6, z: -4 },
      { id: "dyer", name: "단이", role: "dyer", x: 7, z: -2 },
      { id: "altar", name: "돌쇠", role: "altar", x: 0, z: -9 },
    ],
  },
  bamboo: {
    id: "bamboo", name: "죽림", radius: 30, safe: false, levels: [1, 8], ground: 0x86a35e, theme: "bamboo",
    spawns: [{ kind: "blob", count: 10, level: [1, 3] }, { kind: "shade", count: 2, level: [4, 7] }],
    portals: [
      { to: "village", x: 0, z: 27, arriveX: 0, arriveZ: -16, label: "마을로" },
      { to: "pond", x: 0, z: -27, arriveX: 0, arriveZ: 24, label: "연못가로" },
    ],
    npcs: [{ id: "baram", name: "바람이", role: "guide", x: -4.5, z: 20 }],
  },
  pond: {
    id: "pond", name: "연못가", radius: 30, safe: false, levels: [8, 15], ground: 0x9cbf6a, theme: "pond",
    spawns: [{ kind: "blob", count: 6, level: [7, 10] }, { kind: "shade", count: 4, level: [8, 12] }, { kind: "spitter", count: 4, level: [9, 13] }],
    portals: [
      { to: "bamboo", x: 0, z: 27, arriveX: 0, arriveZ: -23, label: "죽림으로" },
      { to: "peak", x: 0, z: -27, arriveX: 0, arriveZ: 24, label: "먹봉우리로" },
    ],
    npcs: [{ id: "noeul", name: "노을", role: "guide", x: 4.5, z: 20 }],
  },
  peak: {
    id: "peak", name: "먹봉우리", radius: 30, safe: false, levels: [15, 20], ground: 0xbfa780, theme: "peak",
    spawns: [{ kind: "shade", count: 5, level: [15, 19] }, { kind: "spitter", count: 4, level: [15, 19] }],
    boss: { kind: "boss", level: 20, respawnMs: 180000, x: 0, z: -12 },
    portals: [{ to: "pond", x: 0, z: 27, arriveX: 0, arriveZ: -23, label: "연못가로" }],
    npcs: [{ id: "heukwol", name: "흑월", role: "guide", x: -4.5, z: 20 }],
  },
};
export const START_ZONE = "village";
export const START_POS = { x: 0, z: 6 };
export const PORTAL_REACH = 3;
export const NPC_REACH = 4;

/* ---------- channels ---------- */
export const CHANNELS = 10;
export const CHANNEL_CAPACITY = 20; // players per zone room
export function roomIdFor(zone: string, channel: number): string {
  return `ink-${zone}-${channel}`;
}
export function parseRoomId(roomId: string): { zone: string; channel: number } | null {
  const m = /^ink-([a-z]+)-(\d+)$/.exec(roomId);
  if (!m || !ZONES[m[1]]) return null;
  const channel = Number(m[2]);
  if (!(channel >= 1 && channel <= CHANNELS)) return null;
  return { zone: m[1], channel };
}

/** Max distance a player may move per second (walk 7.5, dash bursts) — server speed clamp. */
export const MAX_SPEED = 9;
export const MOVE_SLACK = 1.5; // network jitter per report; dashes earn their distance only when their counter moves
export const DASH_BURST = 4.5; // basic dash (atkKind 5)
export const WIND_BURST = 11.5; // 바람질주 (skill 3)
export const POSE_MIN_GAP_MS = 110; // platform allows 10 calls/s per function

/* ---------- quests ---------- */
export type QuestGoal =
  | { type: "talk"; npc: string }
  | { type: "kill"; kind: string | "any"; zone?: string; count: number }
  | { type: "reach"; zone: string }
  | { type: "level"; level: number }
  | { type: "equip"; slot: "weapon" | "hat" | "sash"; notId: string }
  | { type: "dye" };

export interface QuestDef {
  id: string;
  title: string;
  text: string;
  goal: QuestGoal;
  reward: { exp: number; pigment: number; jade?: number; potions?: number };
  /** NPC who offers the quest (accept by talking to them) */
  giver: string;
  /** NPC you hand it in to */
  turnIn: string;
}

/** Chapter 1 「물빛 조각」. Dialogue for each step is in story.ts (QUEST_STORY[id]). */
export const MAIN_QUESTS: QuestDef[] = [
  { id: "c1q1", title: "깨어난 아이", text: "먹노인의 말대로 염색 장인 단이에게 목도리를 보여 주자.", goal: { type: "talk", npc: "dyer" }, giver: "elder", turnIn: "dyer", reward: { exp: 20, pigment: 40, potions: 3 } },
  { id: "c1q2", title: "물들이기", text: "단이의 염색통에서 허리띠나 목도리를 한 번 물들여 보자.", goal: { type: "dye" }, giver: "dyer", turnIn: "dyer", reward: { exp: 40, pigment: 30 } },
  { id: "c1q3", title: "죽림의 먹방울", text: "죽림에서 먹방울 8마리를 베고 바람이를 찾아가자.", goal: { type: "kill", kind: "blob", zone: "bamboo", count: 8 }, giver: "elder", turnIn: "baram", reward: { exp: 100, pigment: 60 } },
  { id: "c1q4", title: "대숲의 시험", text: "4단계까지 수련해 바람이에게 화염선풍을 인정받자.", goal: { type: "level", level: 4 }, giver: "baram", turnIn: "baram", reward: { exp: 80, pigment: 60, potions: 2 } },
  { id: "c1q5", title: "그림자 무사", text: "죽림 깊은 곳의 먹그림자 3마리를 베자.", goal: { type: "kill", kind: "shade", zone: "bamboo", count: 3 }, giver: "baram", turnIn: "baram", reward: { exp: 250, pigment: 80, jade: 40 } },
  { id: "c1q6", title: "연못으로", text: "죽림 북쪽 문을 지나 연못가의 노을을 찾아가자.", goal: { type: "reach", zone: "pond" }, giver: "baram", turnIn: "noeul", reward: { exp: 200, pigment: 60 } },
  { id: "c1q7", title: "먹두꺼비", text: "연못을 더럽히는 먹두꺼비 10마리를 쫓아내자.", goal: { type: "kill", kind: "spitter", zone: "pond", count: 10 }, giver: "noeul", turnIn: "noeul", reward: { exp: 900, pigment: 150, potions: 3 } },
  { id: "c1q8", title: "시든 연꽃", text: "먹봉우리에 오를 만큼, 15단계까지 붓을 깊게 하자.", goal: { type: "level", level: 15 }, giver: "noeul", turnIn: "noeul", reward: { exp: 600, pigment: 150, jade: 40 } },
  { id: "c1q9", title: "봉우리로", text: "연못가 북쪽 문을 지나 먹봉우리의 흑월을 만나자.", goal: { type: "reach", zone: "peak" }, giver: "noeul", turnIn: "heukwol", reward: { exp: 800, pigment: 150 } },
  { id: "c1q10", title: "대먹귀", text: "먹봉우리의 대먹귀를 베고 물빛 조각을 되찾자.", goal: { type: "kill", kind: "boss", zone: "peak", count: 1 }, giver: "heukwol", turnIn: "heukwol", reward: { exp: 3000, pigment: 500, jade: 160 } },
];

/** Daily quests are given and handed in at 먹노인 (elder). */
export const DAILY_GIVER = "elder";

export const DAILY_QUESTS: QuestDef[] = [
  { id: "d1", title: "오늘의 사냥", text: "먹귀신 30마리를 베어라.", goal: { type: "kill", kind: "any", count: 30 }, giver: "elder", turnIn: "elder", reward: { exp: 150, pigment: 80 } },
  { id: "d2", title: "검법 수련", text: "오방 검법을 15번 써라.", goal: { type: "kill", kind: "skill", count: 15 }, giver: "elder", turnIn: "elder", reward: { exp: 100, pigment: 60 } },
  { id: "d3", title: "먹그림자 퇴치", text: "먹그림자 5마리를 물리쳐라.", goal: { type: "kill", kind: "shade", count: 5 }, giver: "elder", turnIn: "elder", reward: { exp: 120, pigment: 60, jade: 10 } },
];

/* ---------- store (VXShop) and rewarded ads ---------- */
export interface JadeProduct {
  productId: string; // must match the VXShop product id exactly
  jade: number;
  label: string;
}
export const JADE_PRODUCTS: JadeProduct[] = [
  { productId: "jade-300", jade: 300, label: "묵옥 300" },
  { productId: "jade-1100", jade: 1100, label: "묵옥 1,000 + 100" },
  { productId: "jade-3600", jade: 3600, label: "묵옥 3,200 + 400" },
];
export const AD_PLACEMENT = "jade_reward";
export const AD_REWARD_JADE = 40;
export const AD_DAILY = 3;
