// Where the current main quest points, and how far: the quest card's distance line and the route preview.
// Zone hops come from a table built once from ZONES' portals (BFS from every zone), so the 4 Hz update walks
// the route without allocating: player → portal, arrival → next portal, …, arrival → target.

import { MONSTERS } from "../shared/combat";
import { ZONES, type Portal } from "../shared/world";
import type { ProfileView } from "../net/api";
import type { MView } from "./monsters";
import { mainStatus, npcName, readyByTalk } from "./quests";

/** next[from][to] = the portal in `from` that starts the shortest way to `to` */
const NEXT: Record<string, Record<string, Portal>> = {};
for (const from of Object.keys(ZONES)) {
  const first: Record<string, Portal> = {};
  const queue: string[] = [from];
  const seen = new Set<string>([from]);
  while (queue.length) {
    const z = queue.shift() as string;
    for (const p of ZONES[z]?.portals ?? []) {
      if (seen.has(p.to)) continue;
      seen.add(p.to);
      first[p.to] = z === from ? p : first[z];
      queue.push(p.to);
    }
  }
  NEXT[from] = first;
}

/** Where a quest points: an NPC, a zone, or the nearest monster of a kind. Reused, never reallocated. */
export interface QuestNav {
  ok: boolean;
  /** label: NPC or monster name, or the zone name for a 'reach' goal */
  who: string;
  /** target zone */
  zone: string;
  /** target point inside `zone` (NaN = anywhere in the zone: the arrival counts) */
  x: number;
  z: number;
  /** total walk along the portal route, metres */
  dist: number;
  /** the first intermediate zone on the way (for "죽림 경유"), "" when direct or here */
  via: string;
  /** what to walk to now: the next portal here, or the target itself (same zone) */
  stepX: number;
  stepZ: number;
  stepIsPortal: boolean;
}

export function newNav(): QuestNav {
  return { ok: false, who: "", zone: "", x: NaN, z: NaN, dist: 0, via: "", stepX: 0, stepZ: 0, stepIsPortal: false };
}

/** where each NPC stands (built once) */
const NPC_AT: Record<string, { zone: string; x: number; z: number }> = {};
for (const z of Object.values(ZONES)) for (const n of z.npcs) NPC_AT[n.id] = { zone: z.id, x: n.x, z: n.z };

function npcAt(id: string, out: QuestNav): boolean {
  const n = NPC_AT[id];
  if (!n) return false;
  out.zone = n.zone; out.x = n.x; out.z = n.z; out.who = npcName(id);
  return true;
}

/**
 * Fill `out` for the current main quest from the player's position. `views` are the monsters of the zone
 * we're in (for kill goals, the nearest matching one).
 */
export function questNav(p: ProfileView, here: string, px: number, pz: number, views: Map<string, MView>, out: QuestNav): void {
  out.ok = false;
  const s = mainStatus(p);
  if (!s) return;
  const g = s.q.goal;
  out.x = NaN; out.z = NaN; out.via = "";
  if (!s.accepted) { if (!npcAt(s.q.giver, out)) return; }
  else if (s.done || readyByTalk(s)) { if (!npcAt(s.q.turnIn, out)) return; }
  else if (g.type === "talk") { if (!npcAt(g.npc, out)) return; }
  else if (g.type === "reach") { out.zone = g.zone; out.who = ZONES[g.zone]?.name ?? g.zone; }
  else if (g.type === "kill" && g.zone) {
    out.zone = g.zone;
    out.who = g.kind === "any" ? "먹귀신" : MONSTERS[g.kind]?.name ?? "먹귀신";
    if (g.zone === here) {
      let bd = 1e9;
      for (const v of views.values()) {
        if (v.mode === "dead" || (g.kind !== "any" && v.kind !== g.kind)) continue;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < bd) { bd = d; out.x = v.x; out.z = v.z; }
      }
    }
  } else return;
  // walk the route
  let zone = here, x = px, z = pz, dist = 0, hops = 0;
  out.stepIsPortal = false;
  while (zone !== out.zone) {
    const portal = NEXT[zone]?.[out.zone];
    if (!portal) return;
    if (hops === 0) { out.stepX = portal.x; out.stepZ = portal.z; out.stepIsPortal = true; }
    else if (hops === 1) out.via = ZONES[zone]?.name ?? "";
    dist += Math.hypot(portal.x - x, portal.z - z);
    zone = portal.to;
    x = portal.arriveX; z = portal.arriveZ;
    hops++;
    if (hops > 12) return;
  }
  if (hops === 0) {
    if (Number.isNaN(out.x)) return; // here, nothing to point at (no monster of that kind in sight)
    out.stepX = out.x; out.stepZ = out.z;
  }
  if (!Number.isNaN(out.x)) dist += Math.hypot(out.x - x, out.z - z);
  out.dist = dist;
  out.ok = true;
}

/** 1 m steps under 100 m, then 10 m. */
export function roundDist(d: number): number {
  return d < 100 ? Math.max(1, Math.round(d)) : Math.round(d / 10) * 10;
}
