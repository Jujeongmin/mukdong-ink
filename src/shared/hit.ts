// Hit shapes from combat.ts tested against a body, the same way on the server (which decides) and the
// client (which may preview). Facing follows the rig: yaw 0 faces +x, forward = (cos yaw, -sin yaw).

import type { HitShape } from "./combat";

export function forwardX(yaw: number): number {
  return Math.cos(yaw);
}
export function forwardZ(yaw: number): number {
  return -Math.sin(yaw);
}

/** How far behind the swing's origin a body still counts (the brush sweeps a little behind you). */
export const BEHIND = 0.4;
/** Extra reach the server allows for lag between what the client saw and the last pose it stored. */
export const REACH_SLACK = 0.6;

/**
 * Whether a body of radius `r` at (ex, ez) is inside `shape` swung from (x, z) facing `yaw`.
 * `slack` widens every shape a little (server-side lag allowance).
 */
export function inShape(
  shape: HitShape, x: number, z: number, yaw: number, ex: number, ez: number, r: number, slack = 0,
): boolean {
  const dx = ex - x;
  const dz = ez - z;
  if (shape.shape === "ring") return Math.hypot(dx, dz) - r <= shape.r + slack;
  const fx = forwardX(yaw);
  const fz = forwardZ(yaw);
  const f = dx * fx + dz * fz;
  const s = -dx * fz + dz * fx;
  const length = shape.shape === "arc" ? shape.reach : shape.length;
  if (f < -BEHIND - r - slack || f > length + r + slack) return false;
  return Math.abs(s) <= shape.half + r + slack;
}
