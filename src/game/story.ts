// Conversations with NPCs: quests are offered, accepted and handed in by talking. What an NPC says depends
// on the main quest's state (offer → accept, progress, complete → reward → maybe the next offer); otherwise
// idle chatter, then the NPC's own service (daily list, dye vats, the altar).

import { CHAPTER_END, IDLE_LINES, DAILY_INTRO, PROLOGUE, QUEST_STORY, type Line } from "../shared/story";
import { MAIN_QUESTS, type Npc } from "../shared/world";
import type { GameApi, ProfileView } from "../net/api";
import { dailyStatus, mainStatus, readyByTalk, rewardText } from "./quests";
import type { Dialogue } from "./ui/dialogue";
import type { Sheets } from "./ui/sheets";
import { attempt, toast } from "./ui/dom";

export interface StoryCtx {
  api: GameApi;
  dialogue: Dialogue;
  sheets: Sheets;
  /** discovery-hint memory (first death → 단이 mentions potions once) */
  hints?: { has(id: string): boolean; mark(id: string): void };
  profile(): ProfileView;
  apply(p: ProfileView): void;
}

const LATER = { label: "나중에", value: "" };

export class Story {
  private busy = false;

  constructor(private readonly ctx: StoryCtx) {}

  isBusy(): boolean {
    return this.busy || this.ctx.dialogue.isOpen();
  }

  /** The opening narration, once per account, for a brand-new player in the village. */
  async prologue(account: string): Promise<void> {
    const p = this.ctx.profile();
    if (p.main !== 0 || p.mainAccepted || p.level !== 1 || p.zone !== "village") return;
    const key = `ink.prologue.${account}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // storage blocked: play it anyway
    }
    await this.ctx.dialogue.play(PROLOGUE, { dark: true });
  }

  async talk(npc: Npc): Promise<void> {
    if (this.isBusy()) return;
    this.busy = true;
    const { api, dialogue } = this.ctx;
    try {
      // talking is itself progress for "talk" goals; it also refreshes the profile
      const t = await attempt(api.talk(npc.id), ["too_far"]);
      if (t) this.ctx.apply(t);
      const s = mainStatus(this.ctx.profile());
      const st = s ? QUEST_STORY[s.q.id] : undefined;
      let handled = false;
      if (s && st && s.accepted && s.q.turnIn === npc.id && (s.done || readyByTalk(s))) {
        handled = true;
        await dialogue.play(st.complete);
        const r = await attempt(api.claimMain(npc.id));
        if (r) {
          this.ctx.apply(r);
          toast(`의뢰 완료: ${s.q.title} (${rewardText(s.q)})`);
          if (!MAIN_QUESTS[r.main]) await dialogue.play(CHAPTER_END, { dark: true });
          else await this.offer(npc);
        }
      } else if (s && st && !s.accepted && s.q.giver === npc.id) {
        handled = true;
        await this.offer(npc);
      } else if (s && st && s.accepted && (s.q.giver === npc.id || s.q.turnIn === npc.id)) {
        handled = true;
        await dialogue.play(st.progress);
      }
      await this.service(npc, handled);
    } finally {
      this.busy = false;
    }
  }

  private async offer(npc: Npc): Promise<void> {
    const s = mainStatus(this.ctx.profile());
    if (!s || s.accepted || s.q.giver !== npc.id) return;
    const st = QUEST_STORY[s.q.id];
    if (!st) return;
    const pick = await this.ctx.dialogue.play(st.offer, { choices: [{ label: st.accept, value: "yes" }, LATER] });
    if (pick !== "yes") return;
    const r = await attempt(this.ctx.api.acceptMain(npc.id));
    if (r) {
      this.ctx.apply(r);
      toast(`새 의뢰: ${s.q.title}`);
    }
  }

  /** After the story part: idle chatter and the NPC's own work. */
  private async service(npc: Npc, handled: boolean): Promise<void> {
    const { dialogue, sheets } = this.ctx;
    const p = this.ctx.profile();
    const idle = pickIdle(npc.id);
    if (npc.role === "elder") {
      if (!handled && idle) await dialogue.play(idle);
      // the daily list only when the elder had no story for you this time
      const open = !handled && [0, 1, 2].some((i) => !dailyStatus(p, i).claimed);
      if (open) {
        const pick = await dialogue.play(DAILY_INTRO, { choices: [{ label: "오늘의 의뢰 보기", value: "daily" }, LATER] });
        if (pick === "daily") sheets.openNpc(npc, "daily");
      }
      return;
    }
    if (npc.role === "dyer" && !handled && this.ctx.hints?.has("death") && !this.ctx.hints.has("dyer-potion")) {
      this.ctx.hints.mark("dyer-potion");
      const pick = await dialogue.play([{ who: "dyer", text: "또 먹에 잠겼다면서요? 물약 몇 개 챙겨 가요! 여기서 팔아요." }], { choices: [{ label: "물약 보기", value: "potion" }, { label: "그만 가 볼게", value: "" }] });
      if (pick === "potion") sheets.openNpc(npc, "potion");
      return;
    }
    if (npc.role === "dyer" || npc.role === "altar") {
      const work = npc.role === "dyer" ? { label: "물들이기", value: "open" } : { label: "제단 앞에 서기", value: "open" };
      const s = mainStatus(p);
      // right after taking the dye quest, go straight to the vats
      if (handled && s?.accepted && s.q.goal.type === "dye" && npc.role === "dyer") { sheets.openNpc(npc); return; }
      if (handled) return; // after a story beat, a second word with them opens the vats / altar
      const lines: Line[] = idle ?? [{ who: npc.id, text: "…" }];
      const pick = await dialogue.play(lines, { choices: [work, { label: "그만 가 볼게", value: "" }] });
      if (pick === "open") sheets.openNpc(npc);
      return;
    }
    if (!handled && idle) await dialogue.play(idle);
  }
}

function pickIdle(id: string): Line[] | null {
  const sets = IDLE_LINES[id];
  if (!sets || sets.length === 0) return null;
  return sets[Math.floor(Math.random() * sets.length)];
}
