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
  /** fixed spots (count = at.length): each one spawns and respawns there */
  at?: { x: number; z: number }[];
}

/** 먹덩굴 around the bamboo grove's north gate (the pond portal at 0, -27): a closed half-ring, radius 8. */
export const BAMBOO_VINES: { x: number; z: number }[] = [
  { x: 7.79, z: -28.8 }, { x: 7.88, z: -25.63 }, { x: 6.73, z: -22.67 }, { x: 4.51, z: -20.39 }, { x: 1.59, z: -19.16 },
  { x: -1.59, z: -19.16 }, { x: -4.51, z: -20.39 }, { x: -6.73, z: -22.67 }, { x: -7.88, z: -25.63 }, { x: -7.79, z: -28.8 },
];
/** 부푼 먹방울 near the bamboo entrance, and the 그림자 무사's lair behind the vines. */
export const BAMBOO_BIGBLOB = { x: 0, z: 14 };
export const BAMBOO_LAIR = { x: 0, z: -21 };

/** 가마 지킴이: 서쪽 비탈 위 큰 가마 입구 (관문 A). */
export const KILN_LORD = { x: -12, z: -12 };
/** 북쪽 돌계단 양옆 석등지기 넷 (향로 마당 가는 길을 지킨다). */
export const TEMPLE_LANTERNS: { x: number; z: number }[] = [
  { x: -4.5, z: -8 }, { x: 4.5, z: -8 }, { x: -4.5, z: -15 }, { x: 4.5, z: -15 },
];
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
  theme: "village" | "bamboo" | "pond" | "peak" | "kiln" | "temple" | "censer" | "pass";
  /** a village: where you stand after 순간이동 into it, and after rising there */
  spawn?: { x: number; z: number };
  /** the village you rise in after falling here (default START_ZONE) */
  home?: string;
}

export const ZONES: Record<string, ZoneDef> = {
  village: {
    id: "village", name: "먹골 마을", radius: 22, safe: true, levels: [1, 20], ground: 0xb7b08f, theme: "village",
    spawn: { x: 0, z: 6 },
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
    spawns: [
      { kind: "blob", count: 10, level: [1, 3] }, { kind: "shade", count: 2, level: [4, 7] },
      { kind: "bigblob", count: 1, level: [2, 2], at: [BAMBOO_BIGBLOB] },
      { kind: "vine", count: BAMBOO_VINES.length, level: [1, 1], at: BAMBOO_VINES },
      { kind: "shadelord", count: 1, level: [4, 5], at: [BAMBOO_LAIR] },
    ],
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
    portals: [
      { to: "pond", x: 0, z: 27, arriveX: 0, arriveZ: -23, label: "연못가로" },
      // 2장: the east door (not north: arriving there would land beside 대먹귀).
      { to: "pass", x: 27, z: 3, arriveX: 0, arriveZ: 16, label: "솔재 마을로" },
    ],
    npcs: [{ id: "heukwol", name: "흑월", role: "guide", x: -4.5, z: 20 }],
  },
  // 두 번째 마을: 2장의 거점. Safe, with its own daily quests, potions and dyes, a brush altar, and 순간이동 to 먹골.
  pass: {
    id: "pass", name: "솔재 마을", radius: 22, safe: true, levels: [20, 35], ground: 0xb3ab94, theme: "pass",
    spawn: { x: 0, z: 4 }, home: "pass",
    spawns: [],
    portals: [
      { to: "peak", x: 0, z: 20, arriveX: 23, arriveZ: 3, label: "먹봉우리로" },
      { to: "kiln", x: 0, z: -20, arriveX: 0, arriveZ: 25, label: "옛 가마터로" },
    ],
    npcs: [
      { id: "sanhalmi", name: "산할미", role: "elder", x: -6, z: -3 },
      { id: "yeoul", name: "여울", role: "dyer", x: 7, z: -1 },
      { id: "musoe", name: "무쇠", role: "altar", x: 0, z: -9 },
    ],
  },
  // ---------- 2장 「불빛 조각」 (docs/CHAPTER2.md) ----------
  kiln: {
    id: "kiln", name: "옛 가마터", radius: 32, safe: false, levels: [20, 27], ground: 0xa59a8a, theme: "kiln", home: "pass",
    spawns: [
      { kind: "jar", count: 10, level: [20, 24] },
      { kind: "crow", count: 5, level: [21, 26] },
      { kind: "shade", count: 2, level: [22, 26] }, // 일일 퀘스트 d3(먹그림자)를 2장에서도 할 수 있게
      { kind: "kilnlord", count: 1, level: [24, 24], at: [KILN_LORD] },
    ],
    portals: [
      { to: "pass", x: 0, z: 29, arriveX: 0, arriveZ: -16, label: "솔재 마을로" },
      { to: "temple", x: 0, z: -29, arriveX: 0, arriveZ: 25, label: "불탄 절터로" },
    ],
    npcs: [{ id: "dalrae", name: "달래", role: "guide", x: 5, z: 21 }],
  },
  temple: {
    id: "temple", name: "불탄 절터", radius: 32, safe: false, levels: [27, 33], ground: 0x8f8c84, theme: "temple", home: "pass",
    spawns: [
      { kind: "shademonk", count: 8, level: [27, 31] },
      { kind: "lantern", count: TEMPLE_LANTERNS.length, level: [29, 32], at: TEMPLE_LANTERNS },
      { kind: "lantern", count: 2, level: [28, 31] },
      { kind: "crow", count: 3, level: [27, 30] },
      { kind: "shade", count: 2, level: [28, 32] },
    ],
    portals: [
      { to: "kiln", x: 0, z: 29, arriveX: 0, arriveZ: -25, label: "옛 가마터로" },
      { to: "censer", x: 0, z: -29, arriveX: 0, arriveZ: 17, label: "향로 마당으로" },
    ],
    npcs: [{ id: "haedam", name: "해담", role: "guide", x: -5, z: 21 }],
  },
  censer: {
    id: "censer", name: "향로 마당", radius: 24, safe: false, levels: [33, 35], ground: 0x7d7870, theme: "censer", home: "pass",
    spawns: [],
    boss: { kind: "ashboss", level: 35, respawnMs: 240000, x: 0, z: -7 },
    portals: [{ to: "temple", x: 0, z: 21, arriveX: 0, arriveZ: -25, label: "절터로" }],
    npcs: [],
  },
};
export const START_ZONE = "village";
export const START_POS = { x: 0, z: 6 };

/* ---------- villages and 순간이동 ---------- */
/** The safe zones, in story order: 순간이동 runs between them. */
export const VILLAGES: readonly string[] = ["village", "pass"];
/**
 * Whether 순간이동 into village `id` is open to you: 먹골 always; 솔재 once the story has sent you over the
 * peak's east door (the quest "봉우리 너머" or later).
 */
export function villageOpen(p: { main: number }, id: string): boolean {
  if (id === START_ZONE) return true;
  if (id === "pass") return p.main >= MAIN_QUESTS.findIndex((q) => q.id === "c2q3");
  return false;
}
/** 궁극기 is there from the first level (decided 2026-11-24; it opened after 1장's boss before). */
export function ultOpen(_p: { main: number }): boolean {
  return true;
}

/** The village you rise in after falling in `zone`. */
export function homeOf(zone: string): string {
  const h = ZONES[zone]?.home;
  return h && ZONES[h]?.safe ? h : START_ZONE;
}
/** Where you stand on coming into village `id` by 순간이동 or on rising there. */
export function spawnOf(id: string): { x: number; z: number } {
  return ZONES[id]?.spawn ?? START_POS;
}
export const PORTAL_REACH = 3;
export const NPC_REACH = 4;
/** Standing this close to a quest NPC in a hunting zone, monsters leave you be (you can read the dialogue). */
export const NPC_SAFE_R = 5;

/* ---------- channels ---------- */
export const CHANNELS = 10;
export const CHANNEL_CAPACITY = 15; // players per zone room (everyone in a room hears every move; kept low for lag)
/** A player picks their own channel at most this often (no hopping from boss to boss). */
export const CHANNEL_HOP_MS = 10_000;
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
/** A burst is earned at most once per gap: the client's dash cooldown is 0.42 s, 바람질주's at least 3.65 s (lv 10). */
export const DASH_BURST_GAP_MS = 380;
export const WIND_BURST_GAP_MS = 2900;
/** A roll (the dash, atkKind 5) makes you untouchable this long after the server sees it. */
export const ROLL_IFRAME_MS = 450;
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
  reward: { exp: number; pigment: number; jade?: number; potions?: number; stones?: number; shards?: number; protects?: number; points?: number };
  /** NPC who offers the quest (accept by talking to them) */
  giver: string;
  /** NPC you hand it in to */
  turnIn: string;
}

/** Chapter 1 「물빛 조각」. Dialogue for each step is in story.ts (QUEST_STORY[id]). */
export const MAIN_QUESTS: QuestDef[] = [
  { id: "c1q3", title: "죽림의 먹방울", text: "죽림에서 먹방울 8마리를 베고 바람이를 찾아가자.", goal: { type: "kill", kind: "blob", zone: "bamboo", count: 8 }, giver: "elder", turnIn: "baram", reward: { exp: 160, pigment: 130, potions: 3 } },
  { id: "c1q4", title: "대숲의 시험", text: "4단계까지 수련해 바람이에게 화염선풍을 인정받자.", goal: { type: "level", level: 4 }, giver: "baram", turnIn: "baram", reward: { exp: 80, pigment: 60, potions: 2 } },
  { id: "c1q5", title: "그림자 무사", text: "죽림 북쪽 문, 덩굴 너머 굴의 그림자 무사를 베자.", goal: { type: "kill", kind: "shadelord", zone: "bamboo", count: 1 }, giver: "baram", turnIn: "baram", reward: { exp: 250, pigment: 80, jade: 40, shards: 1, points: 1 } },
  { id: "c1q6", title: "연못으로", text: "죽림 북쪽 문을 지나 연못가의 노을을 찾아가자.", goal: { type: "reach", zone: "pond" }, giver: "baram", turnIn: "noeul", reward: { exp: 200, pigment: 60 } },
  { id: "c1q7", title: "먹두꺼비", text: "연못을 더럽히는 먹두꺼비 10마리를 쫓아내자.", goal: { type: "kill", kind: "spitter", zone: "pond", count: 10 }, giver: "noeul", turnIn: "noeul", reward: { exp: 900, pigment: 150, potions: 3, stones: 10, shards: 1 } },
  { id: "c1q8", title: "시든 연꽃", text: "먹봉우리에 오를 만큼, 15단계까지 붓을 깊게 하자.", goal: { type: "level", level: 15 }, giver: "noeul", turnIn: "noeul", reward: { exp: 600, pigment: 150, jade: 40 } },
  { id: "c1q9", title: "봉우리로", text: "연못가 북쪽 문을 지나 먹봉우리의 흑월을 만나자.", goal: { type: "reach", zone: "peak" }, giver: "noeul", turnIn: "heukwol", reward: { exp: 800, pigment: 150 } },
  { id: "c1q10", title: "대먹귀", text: "먹봉우리의 대먹귀를 베고 물빛 조각을 되찾자.", goal: { type: "kill", kind: "boss", zone: "peak", count: 1 }, giver: "heukwol", turnIn: "heukwol", reward: { exp: 3000, pigment: 500, jade: 160, shards: 3, protects: 1, points: 2 } },
  /** Chapter 2 「불빛 조각」. Dialogue for each step is in story.ts (QUEST_STORY[id]). */
  { id: "c2q1", title: "흑월의 전갈", text: "산을 내려가 먹노인에게 흑월의 말을 전하자.", goal: { type: "talk", npc: "elder" }, giver: "heukwol", turnIn: "elder", reward: { exp: 1000, pigment: 200, potions: 5 } },
  { id: "c2q2", title: "그을린 천", text: "먹노인이 건넨 그을린 천을 단이에게 보이자.", goal: { type: "talk", npc: "dyer" }, giver: "elder", turnIn: "dyer", reward: { exp: 1000, pigment: 200 } },
  { id: "c2q3", title: "봉우리 너머", text: "먹봉우리 동쪽 문 너머 솔재 마을을 지나 옛 가마터로 가자.", goal: { type: "reach", zone: "kiln" }, giver: "dyer", turnIn: "dalrae", reward: { exp: 1500, pigment: 250, potions: 5 } },
  { id: "c2q4", title: "깨진 옹기", text: "옛 가마터에서 옹기귀 15마리를 깨자.", goal: { type: "kill", kind: "jar", zone: "kiln", count: 15 }, giver: "dalrae", turnIn: "dalrae", reward: { exp: 2500, pigment: 300, stones: 5, shards: 1, points: 1 } },
  { id: "c2q5", title: "가마 지킴이", text: "큰 가마 입구의 가마 지킴이를 베자. 깨어난 화염선풍이 필요하다.", goal: { type: "kill", kind: "kilnlord", zone: "kiln", count: 1 }, giver: "dalrae", turnIn: "dalrae", reward: { exp: 3000, pigment: 400, jade: 40, stones: 5, points: 1 } },
  { id: "c2q6", title: "하나 남은 등불", text: "27단계까지 붓을 깊게 하고, 불탄 절터의 등지기를 찾자.", goal: { type: "level", level: 27 }, giver: "dalrae", turnIn: "haedam", reward: { exp: 2500, pigment: 300, potions: 5 } },
  { id: "c2q7", title: "그림자 승병", text: "불탄 절터의 그림자 승병 15명을 쉬게 하자.", goal: { type: "kill", kind: "shademonk", zone: "temple", count: 15 }, giver: "haedam", turnIn: "haedam", reward: { exp: 3500, pigment: 400, shards: 1 } },
  { id: "c2q8", title: "꺼진 석등", text: "향로 마당 가는 길을 막은 석등지기 6기를 쓰러뜨리자.", goal: { type: "kill", kind: "lantern", zone: "temple", count: 6 }, giver: "haedam", turnIn: "haedam", reward: { exp: 4000, pigment: 450, stones: 10, potions: 5 } },
  { id: "c2q9", title: "해담의 고백", text: "잿불귀와 맞설 만큼, 32단계까지 붓을 깊게 하자.", goal: { type: "level", level: 32 }, giver: "haedam", turnIn: "haedam", reward: { exp: 3000, pigment: 400, jade: 60, protects: 1, points: 1 } },
  { id: "c2q10", title: "잿불귀", text: "향로 마당의 잿불귀를 베고 불빛 조각을 되찾자.", goal: { type: "kill", kind: "ashboss", zone: "censer", count: 1 }, giver: "haedam", turnIn: "haedam", reward: { exp: 8000, pigment: 1000, jade: 200, stones: 15, shards: 4, protects: 2, points: 2 } },
];

/** Daily quests are given and handed in at 먹노인 (elder). */
export const DAILY_GIVER = "elder";

export const DAILY_QUESTS: QuestDef[] = [
  { id: "d1", title: "오늘의 사냥", text: "먹귀신 30마리를 베어라.", goal: { type: "kill", kind: "any", count: 30 }, giver: "elder", turnIn: "elder", reward: { exp: 150, pigment: 80, stones: 5 } },
  { id: "d2", title: "검법 수련", text: "오방 검법을 15번 써라.", goal: { type: "kill", kind: "skill", count: 15 }, giver: "elder", turnIn: "elder", reward: { exp: 100, pigment: 60 } },
  { id: "d3", title: "먹그림자 퇴치", text: "먹그림자 5마리를 물리쳐라.", goal: { type: "kill", kind: "shade", count: 5 }, giver: "elder", turnIn: "elder", reward: { exp: 120, pigment: 60, jade: 10, shards: 1 } },
];

/**
 * 서브 퀘스트 (지역 의뢰): three per hunting field, given by that field's keeper, repeatable without end. One is
 * open at a time, from the field that suits your 경지; finishing it opens the next of that field (round and round).
 * This is the way to grow when 본편 asks for a 경지 you don't have yet. Rewards: about a third of a level's
 * experience at the field's middle level, with pigment and ink stones.
 */
export const SUB_QUESTS: (QuestDef & { zone: string })[] = [
  { id: "s_bam1", zone: "bamboo", title: "대숲 청소", text: "죽림의 먹방울 12마리를 쓸어내자.", goal: { type: "kill", kind: "blob", zone: "bamboo", count: 12 }, giver: "baram", turnIn: "baram", reward: { exp: 90, pigment: 30, stones: 1 } },
  { id: "s_bam2", zone: "bamboo", title: "그림자 몰기", text: "대숲에 숨은 먹그림자 4마리를 몰아내자.", goal: { type: "kill", kind: "shade", zone: "bamboo", count: 4 }, giver: "baram", turnIn: "baram", reward: { exp: 100, pigment: 35, stones: 1 } },
  { id: "s_bam3", zone: "bamboo", title: "대숲 순찰", text: "죽림을 돌며 먹귀신 15마리를 베자.", goal: { type: "kill", kind: "any", zone: "bamboo", count: 15 }, giver: "baram", turnIn: "baram", reward: { exp: 110, pigment: 40, stones: 2 } },
  { id: "s_pond1", zone: "pond", title: "물가의 먹방울", text: "연못가의 먹방울 12마리를 걷어내자.", goal: { type: "kill", kind: "blob", zone: "pond", count: 12 }, giver: "noeul", turnIn: "noeul", reward: { exp: 400, pigment: 60, stones: 2 } },
  { id: "s_pond2", zone: "pond", title: "두꺼비 쫓기", text: "먹물을 뱉는 먹두꺼비 8마리를 쫓아내자.", goal: { type: "kill", kind: "spitter", zone: "pond", count: 8 }, giver: "noeul", turnIn: "noeul", reward: { exp: 430, pigment: 65, stones: 2 } },
  { id: "s_pond3", zone: "pond", title: "연못 순찰", text: "연못가를 돌며 먹귀신 18마리를 베자.", goal: { type: "kill", kind: "any", zone: "pond", count: 18 }, giver: "noeul", turnIn: "noeul", reward: { exp: 460, pigment: 70, stones: 3 } },
  { id: "s_peak1", zone: "peak", title: "봉우리 그림자", text: "먹봉우리의 먹그림자 10마리를 베자.", goal: { type: "kill", kind: "shade", zone: "peak", count: 10 }, giver: "heukwol", turnIn: "heukwol", reward: { exp: 800, pigment: 90, stones: 3 } },
  { id: "s_peak2", zone: "peak", title: "바위틈 두꺼비", text: "바위틈의 먹두꺼비 10마리를 몰아내자.", goal: { type: "kill", kind: "spitter", zone: "peak", count: 10 }, giver: "heukwol", turnIn: "heukwol", reward: { exp: 850, pigment: 95, stones: 3 } },
  { id: "s_peak3", zone: "peak", title: "봉우리 순찰", text: "먹봉우리를 돌며 먹귀신 20마리를 베자.", goal: { type: "kill", kind: "any", zone: "peak", count: 20 }, giver: "heukwol", turnIn: "heukwol", reward: { exp: 900, pigment: 100, stones: 4 } },
  { id: "s_kiln1", zone: "kiln", title: "깨진 옹기", text: "가마터를 뛰노는 옹기귀 12마리를 깨뜨리자.", goal: { type: "kill", kind: "jar", zone: "kiln", count: 12 }, giver: "dalrae", turnIn: "dalrae", reward: { exp: 1300, pigment: 120, stones: 4 } },
  { id: "s_kiln2", zone: "kiln", title: "잿빛 날개", text: "재를 뿌리는 잿까마귀 8마리를 떨어뜨리자.", goal: { type: "kill", kind: "crow", zone: "kiln", count: 8 }, giver: "dalrae", turnIn: "dalrae", reward: { exp: 1350, pigment: 125, stones: 4 } },
  { id: "s_kiln3", zone: "kiln", title: "가마터 순찰", text: "옛 가마터를 돌며 먹귀신 20마리를 베자.", goal: { type: "kill", kind: "any", zone: "kiln", count: 20 }, giver: "dalrae", turnIn: "dalrae", reward: { exp: 1400, pigment: 130, stones: 5 } },
  { id: "s_tem1", zone: "temple", title: "승병의 그림자", text: "절터를 지키던 그림자 승병 10명을 쉬게 하자.", goal: { type: "kill", kind: "shademonk", zone: "temple", count: 10 }, giver: "haedam", turnIn: "haedam", reward: { exp: 2000, pigment: 150, stones: 5 } },
  { id: "s_tem2", zone: "temple", title: "꺼진 석등", text: "길을 막는 석등지기 4기를 무너뜨리자.", goal: { type: "kill", kind: "lantern", zone: "temple", count: 4 }, giver: "haedam", turnIn: "haedam", reward: { exp: 2100, pigment: 160, stones: 5 } },
  { id: "s_tem3", zone: "temple", title: "절터 순찰", text: "불탄 절터를 돌며 먹귀신 22마리를 베자.", goal: { type: "kill", kind: "any", zone: "temple", count: 22 }, giver: "haedam", turnIn: "haedam", reward: { exp: 2200, pigment: 170, stones: 6 } },
];

/* ---------- store (VXShop) and rewarded ads ---------- */
export interface JadeProduct {
  productId: string; // must match the VXShop product id exactly
  jade: number;
  label: string;
  /** the VX price set on the Verse8 dashboard (shown until VXShop's own list arrives; VXShop's wins) */
  vx: number;
}
export const JADE_PRODUCTS: JadeProduct[] = [
  { productId: "jade-300", jade: 300, label: "묵옥 300", vx: 300 },
  { productId: "jade-1100", jade: 1100, label: "묵옥 1,000 + 100", vx: 1000 },
  { productId: "jade-3600", jade: 3600, label: "묵옥 3,200 + 400", vx: 3000 },
];
export const AD_PLACEMENT = "jade_reward";
export const AD_REWARD_JADE = 40;
export const AD_DAILY = 3;
