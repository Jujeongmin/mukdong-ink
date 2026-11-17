// Auto-targeting for swings and casts (manual play and auto-battle alike): the player moves and dodges, the
// brush finds its own mark. Re-evaluated at every swing/cast start; the ~5 Hz scan only drives the indicator.
//
//   a) a monster that is coming at you (chase / wind / attack, facing you)
//   b) else the nearest in a ±70° cone around the move direction (or facing when standing)
//   c) else the nearest in reach
//   d) else nothing: swing/cast where you face
// Dead, dropping-in and obstacle monsters (vines) are skipped, except 화염선풍, which may take a vine when
// nothing else is in reach. 대지낙하 and 먹감옥 aim at the thickest knot of monsters in reach.
// No allocation: scans the live view map, returns a view or writes into scratch fields.

import { isObstacle } from "../shared/combat";
import type { MView } from "./monsters";
import { angDiff } from "./util";

/** reach per action: −1 = basic attack (with its dash-in), 0..4 = skills */
export const BASIC_REACH = 6;
const SKILL_REACH = [9, 4.5, 8, 9, 9];
const CONE = 1.22; // ±70°
/** skills that land on an area: aim at the densest cluster (radius of the blast) */
const CLUSTER_R: Record<number, number> = { 2: 4.8, 4: 4.4 };

export function reachOf(kind: number): number {
  return kind < 0 ? BASIC_REACH : SKILL_REACH[kind] ?? BASIC_REACH;
}

/** Can this monster be swung at at all? */
export function targetable(v: MView): boolean {
  return v.mode !== "dead" && v.drop <= 0 && v.look.group.visible;
}

/** Is the straight line from (x, z) to (tx, tz) cut by a live vine (other than `skip`)? Segment vs circle. */
export function blockedByVine(views: Map<string, MView>, x: number, z: number, tx: number, tz: number, skip: MView | null): boolean {
  const sx = tx - x, sz = tz - z, len2 = sx * sx + sz * sz;
  if (len2 < 1e-6) return false;
  for (const o of views.values()) {
    if (o === skip || o.mode === "dead" || !isObstacle(o.def)) continue;
    let t = ((o.x - x) * sx + (o.z - z) * sz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = x + sx * t - o.x, cz = z + sz * t - o.z;
    if (cx * cx + cz * cz < o.def.radius * o.def.radius * 0.8) return true;
  }
  return false;
}

/** Is it coming at (x, z): awake and facing us within its aggro range? */
export function attackingMe(v: MView, x: number, z: number): boolean {
  if (v.mode !== "chase" && v.mode !== "wind" && v.mode !== "attack") return false;
  const dx = x - v.x, dz = z - v.z;
  if (Math.hypot(dx, dz) > v.def.aggro + 2) return false;
  return Math.abs(angDiff(v.head, Math.atan2(-dz, dx))) < 0.7;
}

/**
 * The target for a swing (kind −1) or skill (0..4) from (x, z). `dir` is the move direction while moving,
 * else the facing. Returns null when nothing is in reach.
 */
export function pickTarget(views: Map<string, MView>, x: number, z: number, dir: number, kind: number): MView | null {
  const reach = reachOf(kind);
  let atk: MView | null = null, atkD = 1e9;
  let cone: MView | null = null, coneD = 1e9;
  let near: MView | null = null, nearD = 1e9;
  let vine: MView | null = null, vineD = 1e9;
  for (const v of views.values()) {
    if (!targetable(v)) continue;
    const dx = v.x - x, dz = v.z - z;
    const d = Math.hypot(dx, dz) - v.def.radius;
    if (d > reach) continue;
    if (isObstacle(v.def) || v.def.skillOnly) {
      if (kind === 1 && d < vineD && !blockedByVine(views, x, z, v.x, v.z, v)) { vineD = d; vine = v; }
      continue;
    }
    // don't waste swings into the wall: nothing behind a live vine
    if (blockedByVine(views, x, z, v.x, v.z, null)) continue;
    if (d < nearD) { nearD = d; near = v; }
    if (d < atkD && attackingMe(v, x, z)) { atkD = d; atk = v; }
    if (d < coneD && Math.abs(angDiff(dir, Math.atan2(-dz, dx))) <= CONE) { coneD = d; cone = v; }
  }
  return atk ?? cone ?? near ?? vine;
}

/** scratch result of clusterPoint */
export const cluster = { x: 0, z: 0, n: 0 };

/**
 * For area skills: the monster position (within reach) with the most monsters inside `r` of it; ties go
 * to the nearest. Writes `cluster`; n = 0 when none.
 */
export function clusterPoint(views: Map<string, MView>, x: number, z: number, kind: number): void {
  const reach = reachOf(kind), r = CLUSTER_R[kind] ?? 4;
  cluster.n = 0;
  let bestD = 1e9;
  for (const c of views.values()) {
    if (!targetable(c) || isObstacle(c.def) || c.def.skillOnly) continue;
    const dc = Math.hypot(c.x - x, c.z - z) - c.def.radius;
    if (dc > reach || blockedByVine(views, x, z, c.x, c.z, null)) continue;
    let n = 0;
    for (const o of views.values()) {
      if (!targetable(o) || isObstacle(o.def) || o.def.skillOnly) continue;
      if (Math.hypot(o.x - c.x, o.z - c.z) <= r) n++;
    }
    if (n > cluster.n || (n === cluster.n && dc < bestD)) { cluster.n = n; cluster.x = c.x; cluster.z = c.z; bestD = dc; }
  }
}

/** Heading to face for this action from (x, z), or null (keep facing). */
export function aimFor(views: Map<string, MView>, x: number, z: number, dir: number, kind: number): number | null {
  if (kind === 2 || kind === 4) {
    clusterPoint(views, x, z, kind);
    if (cluster.n > 0) return Math.atan2(-(cluster.z - z), cluster.x - x);
  }
  const t = pickTarget(views, x, z, dir, kind);
  return t ? Math.atan2(-(t.z - z), t.x - x) : null;
}
