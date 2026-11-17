// Quest state as the client shows it. The server decides completion (shared mainDone); the client reads the
// profile and works out what each NPC has to say: offer, hand-in, still waiting, or nothing.

import { DAILY_QUESTS, MAIN_QUESTS, ZONES, type QuestDef, type QuestGoal } from "../shared/world";
import { NPC_INFO } from "../shared/story";
import { mainDone } from "../shared/profile";
import type { ProfileView } from "../net/api";

export function goalTarget(g: QuestGoal): number {
  if (g.type === "kill") return g.count;
  if (g.type === "level") return g.level;
  return 1;
}

export interface QuestStatus {
  q: QuestDef;
  prog: number;
  target: number;
  accepted: boolean;
  done: boolean;
}

export function mainStatus(p: ProfileView): QuestStatus | null {
  const q = MAIN_QUESTS[p.main];
  if (!q) return null;
  const target = goalTarget(q.goal);
  const accepted = !!p.mainAccepted;
  let prog = accepted ? p.mainProgress : 0;
  if (q.goal.type === "level") prog = Math.max(prog, p.level);
  const done = accepted && mainDone(p);
  if (done) prog = target;
  return { q, prog: Math.min(prog, target), target, accepted, done };
}

export function dailyStatus(p: ProfileView, i: number): QuestStatus & { claimed: boolean } {
  const q = DAILY_QUESTS[i];
  const target = goalTarget(q.goal);
  const prog = Math.min(target, p.daily?.progress?.[i] ?? 0);
  return { q, prog, target, accepted: true, done: prog >= target, claimed: !!p.daily?.claimed?.[i] };
}

export function progressText(s: QuestStatus): string {
  const g = s.q.goal;
  if (g.type === "level") return `경지 ${s.prog} / ${s.target}`;
  if (g.type === "kill") return `${s.prog} / ${s.target}`;
  return s.done ? "마침" : "아직";
}

export function rewardText(q: QuestDef): string {
  const r = q.reward;
  const parts = [`경험 ${r.exp}`, `안료 ${r.pigment}`];
  if (r.jade) parts.push(`묵옥 ${r.jade}`);
  if (r.potions) parts.push(`물약 ${r.potions}`);
  return parts.join(" · ");
}

export function npcName(id: string): string {
  return NPC_INFO[id]?.name ?? id;
}

/** Which zone an NPC stands in (for "go to X in Y" hints). */
export function npcZone(id: string): string | null {
  for (const z of Object.values(ZONES)) if (z.npcs.some((n) => n.id === id)) return z.id;
  return null;
}

/** One line telling the player who to go to next, or null while they should just keep at it. */
export function nextStep(p: ProfileView, here: string): string | null {
  const s = mainStatus(p);
  if (!s) return null;
  const who = !s.accepted ? s.q.giver : s.done || readyByTalk(s) ? s.q.turnIn : null;
  if (!who) return null;
  const z = npcZone(who);
  const where = z && z !== here ? ` (${ZONES[z].name})` : "";
  return `${npcName(who)}에게 말 걸기${where}`;
}

/** A "talk" goal is finished by the conversation itself, so it is ready as soon as it is accepted. */
export function readyByTalk(s: QuestStatus): boolean {
  return s.accepted && s.q.goal.type === "talk" && s.q.goal.npc === s.q.turnIn;
}

export type Mark = "offer" | "turnin" | "wait" | null;

/** The painted mark over an NPC's head. */
export function npcMark(p: ProfileView, npc: string): Mark {
  const s = mainStatus(p);
  if (s) {
    if (!s.accepted && s.q.giver === npc) return "offer";
    if (s.accepted && (s.done || readyByTalk(s)) && s.q.turnIn === npc) return "turnin";
    if (s.accepted && !s.done && s.q.turnIn === npc) return "wait";
  }
  if (npc === "elder" && DAILY_QUESTS.some((_, i) => { const d = dailyStatus(p, i); return d.done && !d.claimed; })) return "turnin";
  return null;
}
