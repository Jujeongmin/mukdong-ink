// Conversations with NPCs: quests are offered, accepted and handed in by talking. What an NPC says depends
// on the main quest's state (offer → accept, progress, complete → reward → maybe the next offer); otherwise
// idle chatter, then the NPC's own service (daily list, dye vats, the altar).

import { CHAPTER_ENDS, IDLE_LINES, DAILY_INTRO, DAILY_INTRO_BY, TRAVEL_LINE, PROLOGUE, QUEST_STORY, SUB_STORY, chapterOf, type Line } from "../shared/story";
import { MAIN_QUESTS, VILLAGES, villageOpen, type Npc } from "../shared/world";
import type { GameApi, ProfileView } from "../net/api";
import { dailyStatus, mainStatus, readyByTalk, rewardText, subStatus } from "./quests";
import type { Dialogue } from "./ui/dialogue";
import type { Sheets } from "./ui/sheets";
import { attempt, toast } from "./ui/dom";
import { audio } from "./audio";
import { t } from "./i18n";

export interface StoryCtx {
  api: GameApi;
  dialogue: Dialogue;
  sheets: Sheets;
  /** discovery-hint memory (first death → 단이 mentions potions once) */
  hints?: { has(id: string): boolean; mark(id: string): void };
  profile(): ProfileView;
  apply(p: ProfileView): void;
  /** hand in the finished 서브 퀘스트 (reward shown by the game) */
  claimSub?(): Promise<void>;
  /** 자동 진행 on the 서브 퀘스트 */
  startSub?(): void;
  /** the map sheet (순간이동 between villages is chosen there) */
  openMap?(): void;
}

const LATER = { label: t("나중에"), value: "" };

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
      const talked = await attempt(api.talk(npc.id), ["too_far"]);
      if (talked) this.ctx.apply(talked);
      const s = mainStatus(this.ctx.profile());
      const st = s ? QUEST_STORY[s.q.id] : undefined;
      let handled = false;
      if (s && st && s.accepted && s.q.turnIn === npc.id && (s.done || readyByTalk(s))) {
        handled = true;
        await dialogue.play(st.complete);
        const r = await attempt(api.claimMain(npc.id));
        if (r) {
          this.ctx.apply(r);
          toast(t("의뢰 완료: {title} ({reward})", { title: t(s.q.title), reward: rewardText(s.q) }));
          audio.play("quest-done");
          // a chapter closes when its last quest is handed in (the next one belongs to another chapter, or none)
          const next = MAIN_QUESTS[r.main], ch = chapterOf(s.q.id);
          if (!next || chapterOf(next.id) !== ch) {
            const end = CHAPTER_ENDS[ch];
            if (end) await dialogue.play(end, { dark: true });
          }
          if (next && next.giver === npc.id) await this.offer(npc);
        }
      } else if (s && st && !s.accepted && s.q.giver === npc.id) {
        handled = true;
        await this.offer(npc);
      } else if (s && st && s.accepted && (s.q.giver === npc.id || s.q.turnIn === npc.id)) {
        handled = true;
        await dialogue.play(st.progress);
        // only a "not yet" from 본편: their 서브 퀘스트 can still come up
        if (await this.sub(npc)) return;
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
    const pick = await this.ctx.dialogue.play(st.offer, { choices: [{ label: t(st.accept), value: "yes" }, LATER] });
    if (pick !== "yes") return;
    const r = await attempt(this.ctx.api.acceptMain(npc.id));
    if (r) {
      this.ctx.apply(r);
      toast(t("새 의뢰: {title}", { title: t(s.q.title) }));
    }
  }

  /**
   * A field keeper with no story for you this time talks about their 서브 퀘스트: done, a word and the reward;
   * under way, what they need (and you can head off on it at once). Returns true if they did.
   */
  private async sub(npc: Npc): Promise<boolean> {
    const s = subStatus(this.ctx.profile());
    const lines = s ? SUB_STORY[s.q.id] : undefined;
    if (!s || !lines || s.q.giver !== npc.id) return false;
    if (s.done) {
      await this.ctx.dialogue.play([{ who: npc.id, text: lines.done }]);
      await this.ctx.claimSub?.();
      return true;
    }
    const left = s.target - s.prog;
    const said: Line[] = s.prog > 0 ? [{ who: npc.id, text: (LEFT[npc.id] ?? LEFT.baram)(left) }] : lines.offer;
    const pick = await this.ctx.dialogue.play(said, { choices: [{ label: t("바로 간다"), value: "go" }, LATER] });
    if (pick === "go") this.ctx.startSub?.();
    return true;
  }

  /** After the story part: idle chatter and the NPC's own work. */
  private async service(npc: Npc, handled: boolean): Promise<void> {
    const { dialogue, sheets } = this.ctx;
    const p = this.ctx.profile();
    if (!handled && (await this.sub(npc))) return;
    const idle = pickIdle(npc.id);
    if (npc.role === "elder") {
      if (!handled && idle) await dialogue.play(idle);
      if (handled) return; // the daily list only when the elder had no story for you this time
      const daily = [0, 1, 2].some((i) => !dailyStatus(p, i).claimed);
      // 순간이동 to another village, once the story has opened one
      const travel = !!this.ctx.openMap && VILLAGES.some((v) => v !== p.zone && villageOpen(p, v));
      if (!daily && !travel) return;
      const choices = [
        ...(daily ? [{ label: t("오늘의 의뢰 보기"), value: "daily" }] : []),
        ...(travel ? [{ label: t("다른 마을로"), value: "travel" }] : []),
        LATER,
      ];
      const intro = daily ? (DAILY_INTRO_BY[npc.id] ?? DAILY_INTRO) : (TRAVEL_LINE[npc.id] ?? TRAVEL_LINE.elder);
      const pick = await dialogue.play(intro, { choices });
      if (pick === "daily") sheets.openNpc(npc, "daily");
      else if (pick === "travel") this.ctx.openMap?.();
      return;
    }
    if (npc.role === "dyer" && !handled && this.ctx.hints?.has("death") && !this.ctx.hints.has("dyer-potion")) {
      this.ctx.hints.mark("dyer-potion");
      const pick = await dialogue.play([{ who: npc.id, text: t("또 먹에 잠겼다면서요? 물약 몇 개 챙겨 가요! 여기서 팔아요.") }], { choices: [{ label: t("물약 보기"), value: "potion" }, { label: t("그만 가 볼게"), value: "" }] });
      if (pick === "potion") sheets.openNpc(npc, "potion");
      return;
    }
    if (npc.role === "dyer" || npc.role === "altar") {
      const work = npc.role === "dyer" ? { label: t("물들이기"), value: "open" } : { label: t("제단 앞에 서기"), value: "open" };
      const s = mainStatus(p);
      // right after taking the dye quest, go straight to the vats
      if (handled && s?.accepted && s.q.goal.type === "dye" && npc.role === "dyer") { sheets.openNpc(npc); return; }
      if (handled) return; // after a story beat, a second word with them opens the vats / altar
      const lines: Line[] = idle ?? [{ who: npc.id, text: "…" }];
      const pick = await dialogue.play(lines, { choices: [work, { label: t("그만 가 볼게"), value: "" }] });
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

/** Each keeper's way of saying how many are left, for a 서브 퀘스트 already under way. */
const LEFT: Record<string, (n: number) => string> = {
  baram: (n) => t("아직 {n} 남았어.", { n }),
  noeul: (n) => t("아직 {n} 남았단다.", { n }),
  heukwol: (n) => t("{n} 남았다.", { n }),
  dalrae: (n) => t("아직 {n} 남었어.", { n }),
  haedam: (n) => t("아직 {n} 남았소.", { n }),
};
