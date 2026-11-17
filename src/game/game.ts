// The client game: title → connect → profile → enter zone → play. Local movement is predicted exactly
// like the prototype; all outcomes (damage, rewards, HP, quests, shop) come from GameApi.

import { createGameApi } from "../net";
import type { GameApi, HitResult, ProfileView, RoomView, ZoneEntry } from "../net/api";
import type { Look, Pose, RoomPlayer } from "../shared/types";
import { MONSTERS, SKILLS } from "../shared/combat";
import { NPC_REACH, START_ZONE, ZONES, type Npc, type Portal } from "../shared/world";
import { Actor, IMPACT, type ActorHooks } from "./actor";
import { Monsters } from "./monsters";
import { ZoneScene } from "./world";
import * as THREE from "three";
import { camFocus, camFwd, camera, clearLights, feel, initRenderer, memoryInfo, renderFrame, resize, setEdge, setHorizon, setLoop, addLight } from "./render/gfx";
import { SKILL_COL, clearFx, hitFeel, inkHit, killBurst, ring, updateFx, sparkBurst } from "./render/fx";
import { Ambient } from "./render/ambient";
import { Hud } from "./ui/hud";
import { Input, KEYS, type Act } from "./ui/input";
import { Sheets } from "./ui/sheets";
import { Dialogue } from "./ui/dialogue";
import { Story } from "./story";
import { npcMark } from "./quests";
import { Title, mockAdPresenter } from "./ui/title";
import { CharacterCreator } from "./ui/create";
import { Loading } from "./ui/loading";
import { Hints } from "./ui/hints";
import { MAIN_QUESTS } from "../shared/world";
import type { MView } from "./monsters";
import { AutoPlay } from "./autoplay";
import { attempt, el, errorCode, errorText, esc, installSprites, toast } from "./ui/dom";

const BUF = 0.15;
/* cursor-on-ground aiming, reused (no per-frame allocation) */
const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndcV = new THREE.Vector2();
const hitV = new THREE.Vector3();
/** 먹동이's thought when a skill first stirs in his hands (index = skill id). */
const SKILL_THOUGHT: Record<number, string> = {
  1: "손끝에 불기운이… 화염선풍?",
  2: "발밑이 무겁게 울린다… 대지낙하?",
  3: "몸이 바람처럼 가볍다… 바람질주?",
  4: "먹이 손에 감겨 온다… 먹감옥?",
};
/** grey sparks when a blow slides off armor or vines */
const GREY = [0.62, 0.6, 0.58] as const;
const hz = new THREE.Vector3();
const PORTAL_WALK = 1.7;
const PORTAL_PROMPT = 3;
const QUIET_COMBAT = ["on_cooldown", "rate_limited", "too_far", "dead", "not_ready", "wrong_room"] as const;
const GOLD_RGB = [0.95, 0.78, 0.35] as const;

interface Remote {
  actor: Actor;
  name: string;
  level: number;
  dead: boolean;
}
interface PendingHits {
  t: number;
  res: HitResult;
}

export class Game {
  private readonly hud: Hud;
  private readonly sheets: Sheets;
  private readonly dialogue: Dialogue;
  private readonly story: Story;
  private readonly hints: Hints;
  /* discovery-hint bookkeeping (docs/TUTORIAL.md); checked on events and at ~4 Hz */
  private hintTick = 0;
  private lastHurtAt = -1e9;
  private lastSwingAt = -1e9;
  private swings = 0;
  private lastManualAt = -1e9;
  private kills = 0;
  /** kills in 죽림 while c1q3 is running (gate 2: the third one) */
  private gateKills = 0;
  private readonly eliteTagged: MView[] = [];
  private readonly auto: AutoPlay;
  private readonly input: Input;
  private readonly monsters = new Monsters();
  private readonly ambient = new Ambient();
  private readonly remotes = new Map<string, Remote>();
  private readonly pending: PendingHits[] = [];
  private readonly pose: Pose = { x: 0, z: 0, y: 0, yaw: 0, atkSeq: 0, atkKind: 0, skillSeq: 0, skill: 0 };
  private player!: Actor;
  private zone!: ZoneScene;
  private profile!: ProfileView;
  private entry!: ZoneEntry;
  private transitioning = false;
  private dead = false;
  private respawning = false;
  private lastFrame = 0;
  private camX = 0;
  private camZ = 0;
  private lastProfileAt = 0;
  private profileCheckAt = 0;
  private uiTick = 0;
  private readonly targetPool: { x: number; z: number }[] = [];

  constructor(private readonly api: GameApi, root: HTMLElement, private readonly loading: Loading) {
    this.hud = new Hud(root, {
      potion: () => void this.drinkPotion(),
      gear: () => this.openGear(),
      growth: () => this.openGrowth(),
      interact: () => this.interact(),
      skill: (i) => this.pressSkill(i),
      respawn: () => void this.respawn(),
      auto: () => this.toggleAuto(),
      travel: () => this.autoTravel(),
      autoSettings: () => this.auto.settings,
      saveAutoSettings: () => this.auto.saveSettings(),
    });
    this.sheets = new Sheets(root, { api, profile: () => this.profile, apply: (p) => this.applyProfile(p), hint: (id, text) => this.hints.think(id, text, { urgent: true }), seen: (id) => this.hints.has(id), mark: (id) => this.hints.mark(id) });
    this.dialogue = new Dialogue(root, () => this.profile?.name || "먹동이");
    this.hints = new Hints(root);
    this.hints.busy = () => {
      const now = performance.now();
      return now - this.lastHurtAt < 3000 || now - this.lastSwingAt < 2000 || this.dialogue.isOpen() || this.sheets.isOpen();
    };
    this.story = new Story({ api, dialogue: this.dialogue, sheets: this.sheets, hints: this.hints, profile: () => this.profile, apply: (p) => this.applyProfile(p) });
    this.input = new Input({
      blocked: () => this.sheets.isOpen() || this.dialogue.isOpen() || this.transitioning || !this.player,
      act: (a) => this.pressAct(a),
      skill: (i) => this.pressSkill(i),
      potion: () => void this.drinkPotion(),
      interact: () => this.interact(),
      gear: () => this.openGear(),
      growth: () => this.openGrowth(),
      help: () => this.hud.help(),
      escape: () => this.sheets.close(),
      manual: () => this.onManual(),
      auto: () => this.toggleAuto(),
    }, root, document.getElementById("stage") as HTMLCanvasElement);
    this.auto = new AutoPlay({
      player: () => this.player,
      monsters: () => this.monsters.views,
      zone: () => this.zone.def,
      profile: () => this.profile,
      canAct: () => !this.dead && !this.transitioning && !this.dialogue.isOpen() && !this.respawning,
      paused: () => this.sheets.isOpen(),
      sinceManual: () => performance.now() - this.lastManualAt,
      skillReady: (i) => this.profile.level >= SKILLS[i].unlock && this.player.cd[i] <= 0,
      drinkPotion: () => void this.drinkPotion(),
      travel: (to, from) => this.travel(to, from),
      talk: (npc) => this.story.talk(npc),
      think: (id, text) => { this.hints.think(id, text, { urgent: true, repeat: true }); },
      changed: () => this.hud.setAuto(this.auto.on, this.auto.traveling),
    });
  }

  /** Any manual move/attack/skill: auto-battle steps aside for a moment, auto-travel stops. */
  private onManual(): void {
    this.lastManualAt = performance.now();
  }

  private toggleAuto(): void {
    if (!this.player || this.dead || this.transitioning) return;
    if (this.zone.def.safe) { this.hints.think("auto-safe", "마을에선 붓을 쉬게 두자.", { urgent: true, repeat: true }); return; }
    const on = this.auto.toggle();
    toast(on ? "자동 사냥" : "자동 사냥 끔");
  }

  private autoTravel(): void {
    if (!this.player || this.dead || this.transitioning || this.dialogue.isOpen()) return;
    if (this.auto.traveling) { this.auto.stop(); return; }
    const why = this.auto.startTravel();
    if (why) this.hints.think("auto-why", why, { urgent: true, repeat: true });
  }

  /* ---------- start ---------- */
  async begin(profile: ProfileView): Promise<void> {
    this.hints.bind(this.api.account);
    this.monsters.onEffect = (kind) => {
      if (kind === "shot" && this.questIs("c1q7")) this.hints.think("gate5", "떨어질 자리를 보고 굴러야겠다.", { key: KEYS.roll, urgent: true });
      if (kind === "slam" && this.zone.def.id === "peak" && this.questIs("c1q10")) this.hints.think("gate7", "지금이다!", { key: KEYS.roll, urgent: true });
    };
    this.auto.bind(this.api.account);
    for (const part of ["growth", "gear", "potion", "auto"] as const) if (this.hints.has(`ui:${part}`)) this.hud.reveal(part, false);
    this.profile = profile;
    const zoneId = ZONES[profile.zone] ? profile.zone : START_ZONE;
    this.entry = await this.api.enterZone(zoneId);
    const hooks: ActorHooks = {
      attack: (kind, a) => this.sendAttack(kind, a),
      skill: (i, a, delay) => this.sendSkill(i, a, delay),
      // mouse players face the cursor on every swing and cast; others get the nearest-target assist
      aim: (x, z, hasIn, ih) => this.auto.aimHeading(x, z) ?? this.cursorHeading(x, z) ?? this.monsters.aim(x, z, hasIn, ih),
      cursor: (x, z) => this.cursorHeading(x, z),
      evade: (x, z) => this.evadeHeading(x, z),
    };
    this.zone = new ZoneScene(ZONES[this.entry.zone] ?? ZONES[START_ZONE]);
    this.ambient.setTheme(this.zone.def.theme);
    setEdge(this.zone.def.radius + 5);
    this.zone.field.dynamic = this.monsters.obstacles;
    this.player = new Actor(true, hooks, this.zone.field);
    this.player.applyLook(this.lookOf(profile));
    this.player.teleport(this.entry.x, this.entry.z);
    this.player.head = Math.PI / 2;
    this.camX = this.entry.x;
    this.camZ = this.entry.z;
    this.hud.setZone(this.entry.zone, this.entry.channel);
    this.loading.channel(this.entry.channel);
    this.applyProfile(profile);
    this.zoneTags();
    this.api.onProfile((p) => this.applyProfile(p));
    this.api.onRoom((r) => this.onRoom(r));
    this.api.onPlayers((pl) => this.onPlayers(pl));
    window.addEventListener("resize", resize);
    (window as unknown as { __ink?: unknown }).__ink = { info: memoryInfo, game: this };
    this.lastFrame = performance.now();
    setLoop(() => this.frame());
  }

  /** Once the loading screen is gone: the prologue for a new player. Key help is H only (hints teach the rest). */
  async afterLoad(): Promise<void> {
    await this.story.prologue(this.api.account);
  }

  private lookOf(p: ProfileView): Look {
    return {
      weapon: p.equip.weapon, hat: p.equip.hat, sash: p.equip.sash, sashDye: p.dye.sash, scarfDye: p.dye.scarf,
      plus: p.enh?.[p.equip.weapon] ?? 0, skills: p.skills ?? [1, 1, 1, 1, 1],
    };
  }

  /* ---------- server state ---------- */
  applyProfile(p: ProfileView): void {
    const prev = this.profile;
    this.profile = p;
    this.lastProfileAt = performance.now();
    if (this.player) this.player.applyLook(this.lookOf(p));
    this.hud.setProfile(p);
    this.hud.tag(this, esc(p.name || "먹동이"), "me");
    if (prev && p.level > prev.level && this.player) {
      const sk = SKILLS.find((s) => s.unlock > prev.level && s.unlock <= p.level);
      this.hud.levelUp(p.level, sk ? sk.name : null);
      ring(this.player.x, this.player.z, 4, GOLD_RGB, 1.0);
      sparkBurst(this.player.x, 0.5, this.player.z, 40, GOLD_RGB, 0.9, 1.4);
      addLight(this.player.x, this.player.z, 9, 1.4, GOLD_RGB, this.player);
      toast(`+${p.level - prev.level} 수련 포인트`);
      if (sk) {
        this.hud.bloomSkill(sk.id);
        this.hints.think(`skill${sk.id}`, SKILL_THOUGHT[sk.id] ?? `${sk.name}…?`, { urgent: true });
      }
    }
    this.revealParts(p);
    if (prev && this.player) this.onHp(prev.hp, p.hp, p.hp <= 0);
    this.sheets.refresh();
  }

  /** HUD parts appear the first time they matter. */
  private revealParts(p: ProfileView): void {
    const open = (part: "growth" | "gear" | "potion" | "auto") => {
      if (this.hints.has(`ui:${part}`)) return;
      this.hints.mark(`ui:${part}`);
      this.hud.reveal(part, true);
    };
    if ((p.points ?? 0) > 0) open("growth");
    if (p.main > 2) open("auto");
    if (p.pigment > 0 || p.jade > 0 || p.main >= 1) open("gear");
    if (p.potions > 0 && p.hp < p.maxHp) open("potion");
  }

  private onHp(before: number, after: number, dead: boolean): void {
    if (after < before && !this.dead) {
      this.lastHurtAt = performance.now();
      if (!this.hints.has("ui:potion")) { this.hints.mark("ui:potion"); this.hud.reveal("potion", true); }

      // knock away from the nearest monster
      let nx = 0, nz = 1, best = 1e9;
      for (const v of this.monsters.views.values()) {
        if (v.mode === "dead") continue;
        const d = Math.hypot(this.player.x - v.x, this.player.z - v.z);
        if (d < best) { best = d; nx = (this.player.x - v.x) / (d || 1); nz = (this.player.z - v.z) / (d || 1); }
      }
      if (best > 12) { nx = 0; nz = 0; }
      this.player.hurt(nx, nz);
      this.hud.number(this.player.x, 2.3, this.player.z, `-${Math.round(before - after)}`, "hurt");
    }
    if (dead && !this.dead) {
      this.auto.stop();
      if (!this.hints.has("death")) { this.hints.mark("death"); this.hud.deathThought("물약을 챙길 걸… 단이에게 가 보자."); }
      else this.hud.deathThought(null);
      this.dead = true;
      this.player.die();
      this.sheets.close();
      this.dialogue.hold(true);
      this.hud.death(true);
    } else if (!dead && this.dead && !this.respawning) {
      this.dead = false;
      this.player.revive();
      this.dialogue.hold(false);
      this.hud.death(false);
    }
  }

  private onRoom(r: RoomView): void {
    if (this.transitioning || !this.player) return;
    this.monsters.onRoom(r, this.player.x, this.player.z);
  }

  private onPlayers(pl: Record<string, RoomPlayer>): void {
    if (this.transitioning || !this.player) return;
    const me = this.api.account;
    for (const id in pl) {
      const rp = pl[id];
      if (id === me) {
        if (this.profile && rp.hp !== this.profile.hp) {
          const before = this.profile.hp;
          this.profile.hp = rp.hp;
          this.hud.setHp(rp.hp, rp.maxHp);
          this.onHp(before, rp.hp, rp.dead || rp.hp <= 0);
        } else if (rp.dead && !this.dead) this.onHp(this.profile.hp, 0, true);
        continue;
      }
      let r = this.remotes.get(id);
      if (!r) {
        r = { actor: new Actor(false, null, this.zone.field), name: rp.name, level: rp.level, dead: rp.dead };
        this.remotes.set(id, r);
      }
      r.name = rp.name;
      r.level = rp.level;
      r.dead = rp.dead;
      r.actor.setNet(rp.pose, rp.look, rp.dead);
      this.hud.tag(r, `${esc(rp.name || "먹동이")}<small>Lv ${rp.level}</small>`, rp.dead ? "dead" : "");
    }
    for (const [id, r] of this.remotes) {
      if (id in pl) continue;
      this.dropRemote(id, r);
    }
  }

  private dropRemote(id: string, r: Remote): void {
    r.actor.dispose();
    this.hud.dropTag(r);
    this.remotes.delete(id);
  }

  /* ---------- combat requests ---------- */
  private sendAttack(kind: number, a: Actor): void {
    this.lastSwingAt = performance.now();
    this.swings++;
    const sent = performance.now();
    void attempt(this.api.attack({ kind, x: a.x, z: a.z, yaw: a.head }), QUIET_COMBAT).then((res) => {
      // show the blow when the mocap swing actually lands (its impact frame), not when the server answers
      if (res) this.queueHits(res, Math.max(0, (IMPACT[kind] ?? 0) - (performance.now() - sent) / 1000));
    });
  }

  private sendSkill(i: number, a: Actor, delay: number): void {
    void attempt(this.api.castSkill({ skill: i, x: a.x, z: a.z, yaw: a.head }), QUIET_COMBAT).then((res) => {
      if (res) this.queueHits(res, delay);
    });
  }

  private queueHits(res: HitResult, delay: number): void {
    if (delay <= 0.05) this.showHits(res);
    else this.pending.push({ t: delay, res });
  }

  private showHits(res: HitResult): void {
    for (const h of res.hits) {
      const hv = this.monsters.views.get(h.id);
      if (h.resisted && hv) {
        // 먹 갑옷 / 덩굴: the blow slides off
        sparkBurst(hv.x, hv.def.height * 0.6, hv.z, 10, GREY, 0.7, 1);
        if (hv.kind === "shadelord" && this.questIs("c1q5")) this.hints.think("gate4", "칼이 미끄러진다…", { key: KEYS.growth, urgent: true });
        if (hv.def.boss && this.questIs("c1q10")) this.hints.think("gate6", "무딘 붓으론 안 된다…", { key: KEYS.growth, urgent: true });
      }
      if (h.kill) {
        this.kills++;
        if (this.zone.def.id === "bamboo" && this.questIs("c1q3")) {
          this.gateKills++;
          if (this.gateKills >= 3 && !this.hints.has("ui:auto")) {
            this.hints.mark("ui:auto");
            this.hud.reveal("auto", true);
            this.hints.think("gate2", "손에 익었다… 붓이 알아서 움직일 것 같다.", { key: KEYS.auto, urgent: true });
          }
        }
      }
    }
    let any = false, killed = false, heavy = 0;
    const pl = this.player;
    for (const h of res.hits) {
      const v = this.monsters.views.get(h.id);
      if (!v) continue;
      any = true;
      v.flash = 0.12;
      // ink where the blow lands, flung away from the player, bigger for bigger blows; a burst on a kill
      if (!h.resisted) {
        const dx = v.x - pl.x, dz = v.z - pl.z, d = Math.hypot(dx, dz) || 1;
        const power = Math.min(2, 0.6 + Math.log10(1 + h.dmg) * 0.35);
        heavy = Math.max(heavy, (power - 0.6) / 1.4);
        inkHit(v.x, v.def.height * 0.55, v.z, dx / d, dz / d, power);
        if (h.kill) { killed = true; killBurst(v.x, v.def.height * 0.5, v.z, v.def.radius); }
      }
      const def = MONSTERS[v.kind] ?? v.def;
      if (h.resisted) this.hud.number(v.x, def.height + 0.5, v.z, h.dmg > 0 ? `${h.dmg} 먹혀들지 않는다` : "먹혀들지 않는다", "resist");
      else this.hud.number(v.x, def.height + 0.5, v.z, String(h.dmg), h.kill ? "kill" : "");
    }
    if (any) hitFeel(heavy, killed);
    const p = this.player;
    let y = 2.6;
    if (res.exp > 0) { this.hud.number(p.x, y, p.z, `경험 +${res.exp}`, "gain"); y += 0.4; }
    if (res.pigment > 0) { this.hud.number(p.x, y, p.z, `안료 +${res.pigment}`, "gain"); y += 0.4; }
    if (res.jade > 0) this.hud.number(p.x, y, p.z, `묵옥 +${res.jade}`, "gain");
    const drops: string[] = [];
    if (res.stones) drops.push(`먹돌 +${res.stones}`);
    if (res.shards) drops.push(`색 조각 +${res.shards}`);
    if (drops.length) toast(drops.join(" / "));
    if (res.levelUp || res.exp > 0 || res.pigment > 0 || res.jade > 0 || res.stones || res.shards) this.profileCheckAt = performance.now() + 700;
  }

  /* ---------- input actions ---------- */
  private pressAct(a: Act): void {
    if (!this.player || this.dead) return;
    this.player.input[a] = BUF;
  }

  private pressSkill(i: number): void {
    if (!this.player || this.sheets.isOpen() || this.transitioning) return;
    if (this.dead) return;
    const s = SKILLS[i];
    if (!s) return;
    if (this.profile.level < s.unlock) { this.hints.think("tease", `이 자리엔 어떤 검법이 들어올까… (Lv ${s.unlock})`, { repeat: true, urgent: true }); return; }
    if (this.player.cd[i] > 0) return;
    this.player.input.sk = i;
    this.player.input.skT = BUF;
  }

  private async drinkPotion(): Promise<void> {
    if (!this.profile || this.dead || this.transitioning) return;
    if (this.profile.potions <= 0) { toast("물약이 없습니다 · 마을 염색 장인에게서 살 수 있습니다"); return; }
    if (this.profile.hp >= this.profile.maxHp) { toast("생명이 가득합니다"); return; }
    const before = this.profile.hp;
    const p = await attempt(this.api.usePotion());
    if (!p) return;
    this.applyProfile(p);
    const healed = p.hp - before;
    if (healed > 0) this.hud.number(this.player.x, 2.4, this.player.z, `+${healed}`, "gain");
    sparkBurst(this.player.x, 1, this.player.z, 14, SKILL_COL[3], 0.5, 1.2);
  }

  private openGrowth(): void {
    if (!this.profile || this.transitioning || this.dialogue.isOpen()) return;
    this.input.clear();
    if (this.hints.has("gate6") && !this.hints.has("gate6-open")) { this.hints.mark("gate6-open"); this.sheets.openGrowth("enhance"); }
    else this.sheets.openGrowth();
  }

  private openGear(): void {
    if (!this.profile || this.transitioning) return;
    this.input.clear();
    this.sheets.openGear();
  }

  private nearNpc(): Npc | null {
    let best: Npc | null = null, bd = NPC_REACH - 0.6;
    for (const n of this.zone.def.npcs) {
      const d = Math.hypot(n.x - this.player.x, n.z - this.player.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  private nearPortal(reach: number): Portal | null {
    for (const p of this.zone.def.portals) {
      if (Math.hypot(p.x - this.player.x, p.z - this.player.z) < reach) return p;
    }
    return null;
  }

  private interact(): void {
    if (!this.player || this.dead || this.transitioning) return;
    if (this.sheets.isOpen()) return;
    const n = this.nearNpc();
    if (n) { this.input.clear(); void this.story.talk(n); return; }
    const p = this.nearPortal(PORTAL_PROMPT);
    if (p) void this.travel(p.to, this.zone.def.id);
  }

  /* ---------- zones ---------- */
  private async travel(to: string, viaPortal?: string): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    this.sheets.close();
    this.input.clear();
    this.loading.show(to, "길을 건너는 중…");
    try {
      const entry = await this.api.enterZone(to, viaPortal);
      this.loading.progress(0.7);
      this.rebuild(entry);
    } catch (e) {
      toast(errorText(e), true);
      // step back from the gate so we don't walk straight into it again
      const p = this.player;
      const d = Math.hypot(p.x, p.z) || 1;
      p.teleport(p.x - (p.x / d) * 3, p.z - (p.z / d) * 3);
    } finally {
      await this.loading.hide();
      this.transitioning = false;
    }
  }

  private rebuild(entry: ZoneEntry): void {
    const changed = entry.zone !== this.entry.zone || entry.channel !== this.entry.channel;
    this.entry = entry;
    if (changed) {
      for (const a of this.zone.anchors) this.hud.dropTag(a);
      this.zone.dispose();
      this.monsters.clear();
      for (const [id, r] of this.remotes) this.dropRemote(id, r);
      clearFx();
      clearLights();
      this.zone = new ZoneScene(ZONES[entry.zone] ?? ZONES[START_ZONE]);
      this.ambient.setTheme(this.zone.def.theme);
    setEdge(this.zone.def.radius + 5);
      this.zone.field.dynamic = this.monsters.obstacles;
      this.player.field = this.zone.field;
      this.zoneTags();
      this.hud.setZone(entry.zone, entry.channel);
      this.loading.channel(entry.channel);
      this.auto.zoneChanged();
    }
    this.player.teleport(entry.x, entry.z);
    this.camX = entry.x;
    this.camZ = entry.z;
  }

  /** NPC name tags carry a painted mark: ! has a quest, ? can take one back, … is waiting on you. */
  private npcMarks(): void {
    if (!this.profile) return;
    for (const a of this.zone.anchors) {
      if (a.kind !== "npc" || !a.id) continue;
      const m = npcMark(this.profile, a.id);
      const mark = m === "offer" ? `<i class="qmark offer">!</i>` : m === "turnin" ? `<i class="qmark turnin">?</i>` : m === "wait" ? `<i class="qmark wait">…</i>` : "";
      this.hud.tag(a, `${mark}${esc(a.text)}`, "npc");
    }
  }

  private zoneTags(): void {
    for (const a of this.zone.anchors) this.hud.tag(a, esc(a.text), a.kind);
  }

  private async respawn(): Promise<void> {
    if (this.respawning) return;
    this.respawning = true;
    this.hud.death(true, true);
    try {
      this.transitioning = true;
      this.loading.show("village", "다시 일어나는 중");
      const entry = await this.api.respawn();
      this.loading.progress(0.7);
      this.rebuild(entry);
      this.dead = false;
      this.player.revive();
      this.dialogue.hold(false);
      this.hud.death(false);
      this.hud.deathThought(null);
      const p = await attempt(this.api.loadProfile());
      if (p) this.applyProfile(p);
    } catch (e) {
      const code = errorCode(e);
      toast(code === "on_cooldown" || code === "not_ready" ? "조금만 더 기다렸다가 일어나세요" : errorText(e), true);
      this.hud.death(true, false);
    } finally {
      this.respawning = false;
      await this.loading.hide();
      this.transitioning = false;
    }
  }

  /* ---------- frame ---------- */
  private frame(): void {
    const now = performance.now();
    const realDt = Math.min((now - this.lastFrame) / 1000, 1 / 30);
    this.lastFrame = now;
    feel.time += realDt;
    let dt = realDt;
    if (feel.hitstop > 0) { feel.hitstop -= realDt; dt *= 0.08; }
    resize();

    const p = this.player;
    this.input.read();
    const inp = p.input;
    inp.mx = this.dead ? 0 : this.input.mx;
    inp.mz = this.dead ? 0 : this.input.mz;
    if (inp.mx !== 0 || inp.mz !== 0) this.auto.manual(true);
    if (this.auto.on && this.dialogue.isOpen()) this.auto.stop();
    this.auto.decide(realDt);
    // skills fire on their own in manual play too (rings can still be clicked to fire early)
    if (!this.auto.active() && !this.dead && !this.transitioning && !this.dialogue.isOpen() && !this.sheets.isOpen()) this.auto.manualSkills(realDt);
    if (inp.mx === 0 && inp.mz === 0) this.auto.steer(realDt);
    inp.atk = Math.max(0, inp.atk - realDt);
    // holding the button keeps the combo going (the actor still waits out the chain timing)
    if (this.input.holdAtk && !this.dead && !this.sheets.isOpen() && !this.dialogue.isOpen()) inp.atk = BUF;
    inp.dash = Math.max(0, inp.dash - realDt);
    inp.jump = Math.max(0, inp.jump - realDt);
    inp.skT -= realDt;
    if (inp.skT <= 0) inp.sk = -1;

    p.update(dt);
    for (const r of this.remotes.values()) r.actor.update(dt);

    // monsters face whoever is closest
    const tg = this.monsters.targets;
    let n = 0;
    const pushT = (x: number, z: number) => {
      if (!this.targetPool[n]) this.targetPool[n] = { x: 0, z: 0 };
      const o = this.targetPool[n++];
      o.x = x; o.z = z;
    };
    if (!this.dead) pushT(p.x, p.z);
    for (const r of this.remotes.values()) if (!r.dead) pushT(r.actor.x, r.actor.z);
    tg.length = 0;
    for (let i = 0; i < n; i++) tg.push(this.targetPool[i]);
    this.monsters.update(dt, feel.time, p.x, p.z);
    this.zone.update(dt, feel.time);
    this.ambient.update(realDt, feel.time, p.x, p.z);
    updateFx(dt);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      h.t -= realDt;
      if (h.t <= 0) { this.pending.splice(i, 1); this.showHits(h.res); }
    }

    this.updateCamera(realDt);
    p.render(dt);
    for (const r of this.remotes.values()) r.actor.render(dt);

    // tags every frame (they follow the camera); text changes only when needed
    this.hud.placeTag(this, p.x, p.y + 2.55, p.z);
    for (const r of this.remotes.values()) this.hud.placeTag(r, r.actor.x, r.actor.y + 2.55, r.actor.z);
    for (const a of this.zone.anchors) this.hud.placeTag(a, a.x, a.y, a.z);
    // elites carry a name plate (arrays reused; no per-frame allocation)
    const el = this.monsters.elites;
    for (let i = 0; i < el.length; i++) {
      const v = el[i];
      if (!this.eliteTagged.includes(v)) { this.eliteTagged.push(v); this.hud.tag(v, esc(v.def.name), "elite"); }
      this.hud.placeTag(v, v.x, v.y + v.def.height * 1.45 + 0.4, v.z);
    }
    for (let i = this.eliteTagged.length - 1; i >= 0; i--) {
      const v = this.eliteTagged[i];
      if (!el.includes(v)) { this.hud.dropTag(v); this.eliteTagged.splice(i, 1); }
    }

    this.uiTick -= realDt;
    if (this.uiTick <= 0) {
      this.uiTick = 0.1;
      this.slowUi();
    }

    if (!this.transitioning) {
      const pose = this.pose;
      pose.x = p.x; pose.z = p.z; pose.y = p.y; pose.yaw = p.head;
      pose.atkSeq = p.atkSeq; pose.atkKind = p.atkKind; pose.skillSeq = p.skillSeq; pose.skill = p.skill;
      this.api.reportPose(pose);
    }
    renderFrame(realDt);
  }

  /** Heading away from the nearest monster that is winding up or attacking (the roll's default direction). */
  private evadeHeading(x: number, z: number): number | null {
    let best = 8, ax = 0, az = 0, found = false;
    for (const v of this.monsters.views.values()) {
      if (v.mode !== "wind" && v.mode !== "attack" && v.mode !== "chase") continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < best) { best = d; ax = x - v.x; az = z - v.z; found = true; }
    }
    return found ? Math.atan2(-az, ax) : null;
  }

  /** Heading from (x, z) to the point under the mouse cursor, or null if the player isn't aiming with a mouse. */
  private cursorHeading(x: number, z: number): number | null {
    if (!this.input.mouseAim) return null;
    ndcV.set(this.input.ndc.x, this.input.ndc.y);
    ray.setFromCamera(ndcV, camera);
    if (!ray.ray.intersectPlane(ground, hitV)) return null;
    const dx = hitV.x - x, dz = hitV.z - z;
    if (dx * dx + dz * dz < 0.04) return null;
    return Math.atan2(-dz, dx);
  }

  /** The current main quest is `id` and accepted. */
  private questIs(id: string): boolean {
    const p = this.profile;
    return !!p && p.mainAccepted && MAIN_QUESTS[p.main]?.id === id;
  }

  /** Fixed tutorial gates that hang on a place and a sight (docs/TUTORIAL-GATES.md), ~4 Hz, no allocation. */
  private checkHints(): void {
    const p = this.profile, pl = this.player;
    if (!p || !pl || this.dead || this.transitioning || this.story.isBusy()) return;
    const h = this.hints;
    if (this.zone.def.id !== "bamboo") return;
    // gate 1: the swollen blob gathers itself for the first time (c1q3)
    if (!h.has("gate1") && this.questIs("c1q3")) {
      for (const v of this.monsters.views.values()) {
        if (v.kind === "bigblob" && v.mode === "wind") { h.think("gate1", "뭔가 온다… 굴러서 피하자.", { key: KEYS.roll, urgent: true }); break; }
      }
    }
    // gate 3: the first touch of the ink vines before the pond gate
    if (!h.has("gate3")) {
      const obs = this.monsters.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (Math.hypot(o.x - pl.x, o.z - pl.z) < o.r + 1.1) {
          h.think("gate3", p.level >= SKILLS[1].unlock ? "불길이라면 태울 수 있겠다… 화염선풍." : "불이라도 있으면… 바람이에게 가 보자.", { urgent: true });
          break;
        }
      }
    }
  }

  private slowUi(): void {
    this.hintTick -= 0.1;
    if (this.hintTick <= 0) { this.hintTick = 0.25; this.checkHints(); }
    const p = this.player;
    // a living monster within reach of a fight: 먹동이 brings the brush down into a low guard
    let threat = false;
    for (const v of this.monsters.views.values()) if (v.hp > 0 && Math.abs(v.x - p.x) < 8 && Math.abs(v.z - p.z) < 8) { threat = true; break; }
    p.threat = threat;
    for (let i = 0; i < SKILLS.length; i++) this.hud.setCooldown(i, p.cd[i] / p.skillCd(i));
    // interaction prompt + walking into portals
    let prompt: string | null = null;
    if (!this.dead && !this.transitioning && !this.sheets.isOpen() && !this.story.isBusy()) {
      const npc = this.nearNpc();
      if (npc) prompt = `${npc.name}에게 말 걸기`;
      else {
        const gate = this.nearPortal(PORTAL_PROMPT);
        if (gate) prompt = gate.label;
        // only walking in on purpose counts (not being knocked into the gate)
        const walking = p.state === "move" && Math.hypot(p.input.mx, p.input.mz) > 0.3 && !this.auto.active();
        const inGate = walking ? this.nearPortal(PORTAL_WALK) : null;
        if (inGate) void this.travel(inGate.to, this.zone.def.id);
      }
    }
    this.hud.prompt(prompt);
    this.npcMarks();
    const boss = this.monsters.boss(p.x, p.z);
    this.hud.boss(boss ? `${boss.def.name} · Lv ${boss.level}` : null, boss ? boss.hp / Math.max(1, boss.maxHp) : 0);
    // profile fallback: if a reward came back but no profile push followed, fetch it once
    if (this.profileCheckAt && performance.now() > this.profileCheckAt) {
      const stale = this.lastProfileAt < this.profileCheckAt - 700;
      this.profileCheckAt = 0;
      if (stale) void attempt(this.api.loadProfile(), ["rate_limited"]).then((pp) => { if (pp) this.applyProfile(pp); });
    }
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight), k = aspect < 1.1 ? 1.45 : 1;
    this.camX += (p.x + p.fx * 1.2 - this.camX) * Math.min(1, dt * 4);
    this.camZ += (p.z + p.fz * 1.2 - this.camZ) * Math.min(1, dt * 4);
    feel.shake = Math.max(0, feel.shake - dt * 2.5);
    const sx = (Math.random() - 0.5) * feel.shake, sy = (Math.random() - 0.5) * feel.shake;
    // a low quarter view: the player stays lower-middle, the field ahead reads, and the upper part of the
    // frame opens onto the field's far edge, the painted backdrop and the moon
    camera.position.set(this.camX + sx, 8.4 * k + sy, this.camZ + 15 * k);
    camera.lookAt(this.camX + sx * 0.5, 2.2 + sy * 0.5, this.camZ - 4);
    camFocus.set(this.camX, 0, this.camZ);
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    // the painted backdrop starts where the field's far edge meets the screen
    hz.set(this.camX, 0, -(this.zone.def.radius + 11)).project(camera);
    setHorizon(Math.min(0.99, Math.max(0.45, hz.y * 0.5 + 0.5)), this.camX);
  }
}

/* ---------- boot ---------- */
export async function boot(): Promise<void> {
  installSprites();
  const root = el("#ui");
  const canvas = el<HTMLCanvasElement>("#stage");
  document.querySelector(".boot")?.remove();
  const title = new Title(root);
  try {
    initRenderer(canvas);
    title.startScene();
  } catch (e) {
    console.error(e);
    title.busy();
    title.status("이 브라우저에서 WebGL을 켤 수 없어 화면을 그리지 못했습니다. 하드웨어 가속을 켜고 다시 열어 보세요.");
    return;
  }
  const loading = new Loading(root);
  await title.waitStart();
  const api = createGameApi({ mode: "auto", adPresenter: mockAdPresenter });
  let game: Game | null = null;
  for (;;) {
    await title.wipeOut();
    loading.show("village", "먹을 가는 중…");
    try {
      await api.connect();
      loading.progress(0.3);
      loading.status("기록을 펼치는 중…");
      let profile = await api.loadProfile();
      loading.setZone(profile.zone);
      loading.progress(0.5);
      // first visit: draw your 먹동이 (name, scarf and sash colors)
      if (!(profile.created ?? !!profile.name)) {
        await loading.hide();
        const creator = new CharacterCreator(root);
        for (;;) {
          const c = await creator.ask();
          try {
            profile = await api.createCharacter(c.name, c.scarf, c.sash);
            break;
          } catch (e) {
            creator.error(errorText(e));
          }
        }
        creator.close();
        loading.show(profile.zone, "");
      }
      loading.status("들판으로 나가는 중…");
      game ??= new Game(api, root, loading);
      await game.begin(profile);
      title.hide();
      await loading.hide();
      if (api.mode === "local") toast("오프라인(로컬) 모드로 시작했습니다");
      void game.afterLoad();
      return;
    } catch (e) {
      console.error(e);
      await loading.hide();
      title.reveal();
      title.status(`시작하지 못했습니다 · ${errorText(e)}`);
      await title.waitStart("다시 시도");
    }
  }
}
