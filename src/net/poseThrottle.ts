// How often a pose goes to the server. Every pose is written to the room and sent to everyone in it,
// and Verse8 turns away more than 10 calls a second to one function, so:
// - never two closer than POSE_MIN_GAP_MS (110 ms);
// - while moving, one every POSE_MOVING_MS (200 ms);
// - a new attack or technique (its counter went up) as soon as the gap allows;
// - standing still, one every POSE_IDLE_MS (10 s) as a heartbeat.
// A pose held back is not lost: the latest one goes out when its time comes.

import type { Pose } from "../shared/types";
import { POSE_MIN_GAP_MS } from "../shared/world";

export const POSE_MOVING_MS = 200;
export const POSE_IDLE_MS = 10_000;
const EPSILON = 0.01;

export class PoseThrottle {
  private last: (Pose & { at: number }) | null = null;
  private pending: Pose | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly send: (pose: Pose) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Starts the idle heartbeat (call when standing in a room). */
  start(): void {
    this.stop();
    this.heartbeat = setInterval(() => {
      if (this.last && this.now() - this.last.at >= POSE_IDLE_MS) this.emit(this.pending ?? this.last);
    }, 1000);
  }

  /** Stops everything and forgets the last pose (leaving a room). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = null;
    this.heartbeat = null;
    this.last = null;
    this.pending = null;
  }

  offer(pose: Pose): void {
    const now = this.now();
    const last = this.last;
    if (!last) {
      this.emit(pose);
      return;
    }
    const moved = Math.abs(pose.x - last.x) > EPSILON || Math.abs(pose.z - last.z) > EPSILON
      || Math.abs(pose.yaw - last.yaw) > EPSILON || Math.abs(pose.y - last.y) > EPSILON;
    const acted = pose.atkSeq !== last.atkSeq || pose.skillSeq !== last.skillSeq;
    if (!moved && !acted) {
      this.pending = null;
      return;
    }
    const wait = acted ? POSE_MIN_GAP_MS : POSE_MOVING_MS;
    const since = now - last.at;
    if (since >= wait) {
      this.emit(pose);
      return;
    }
    // Held back: the latest pose goes out once the wait is over.
    this.pending = pose;
    const due = acted ? POSE_MIN_GAP_MS - since : POSE_MOVING_MS - since;
    if (this.timer) {
      if (!acted) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) this.emit(this.pending);
    }, Math.max(0, due));
  }

  private emit(pose: Pose): void {
    if (this.last && this.now() - this.last.at < POSE_MIN_GAP_MS) return;
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.last = { ...pose, at: this.now() };
    this.send(pose);
  }
}
