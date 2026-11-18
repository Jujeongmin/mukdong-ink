// The client game: title → connect → profile → enter zone → play. Local movement is predicted exactly
// like the prototype; all outcomes (damage, rewards, HP, quests, shop) come from GameApi.

import { createGameApi } from "../net";
import type { GameApi, HitResult, ProfileView, RoomView, ZoneEntry } from "../net/api";
import type { Look, Pose, RoomPlayer } from "../shared/types";
import { MONSTERS, SKILLS } from "../shared/combat";
import { NPC_REACH, START_ZONE, ZONES, type Npc, type Portal } from "../shared/world";
import { Actor, IMPACT, actorFx, actorSound, type ActorHooks } from "./actor";
import { Chat } from "./ui/chat";
import { newNav, questNav } from "./questnav";
import { RoutePreview } from "./render/route";
import { ALBUM_PAGES, PAGE_FOR_BOSS, album, pageEarned, paintFrame, type AlbumPage } from "./album";
import { TargetRing } from "./render/target-ring";
import { aimFor, pickTarget, targetable } from "./targeting";
import type { MView as TargetView } from "./monsters";
import { Portraits } from "./ui/portraits";
import { Rig } from "./render/rig";
import { gameSettings } from "./ui/settings";
import type { ChatMessage } from "../net/api";
import { audio, SKILL_SFX, type SfxName } from "./audio";
import { Monsters } from "./monsters";
import { ZoneScene, buildNpcRig } from "./world";
import * as THREE from "three";
import { camFocus, camFwd, camera, feelFlags, clearBloom, clearLights, clearStains, feel, holdColor, initRenderer, memoryInfo, renderFrame, resize, setEdge, setHorizon, setLoop, addLight, setQuality, setShake } from "./render/gfx";
import type { RGB } from "./util";
import { SKILL_COL, clearFx, fireFlow, glazeCrack, hitFeel, inkHit, killBurst, ring, shellBounce, updateFx, sparkBurst } from "./render/fx";
import { emberBloom } from "./render/ambient";
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
import { DAILY_QUESTS, MAIN_QUESTS } from "../shared/world";

/** A main quest's position by id (the list can change; never hard-code indices). */
const questIndex = (id: string): number => MAIN_QUESTS.findIndex((q) => q.id === id);
import type { MView } from "./monsters";
import { AutoPlay } from "./autoplay";
import { attempt, el, errorCode, errorText, esc, installSprites, toast } from "./ui/dom";

const BUF = 0.15;
/** 먹동이's thought when a skill first stirs in his hands (index = skill id). */
/** actor sound codes (see actorSound) → clips: 1..3 combo, 4 air spin, 5 roll */
const ACT_SFX: readonly (SfxName | null)[] = [null, "swing-1", "swing-2", "swing-3-spin", "swing-3-spin", "roll"];

/** 먹동이's line on the death screen: what took them, by the kind of monster that hurt them last. */
const DEATH_BY: Record<string, string> = {
  "": "먹이 몸을 덮었다",
  blob: "먹방울 떼에 휩쓸렸다",
  shade: "먹그림자에 붙들렸다",
  bigblob: "부푼 먹방울에 짓눌렸다",
  spitter: "먹두꺼비의 먹물을 뒤집어썼다",
  shadelord: "그림자 무사의 칼끝에 쓰러졌다",
  boss: "대먹귀의 주먹에 짓눌렸다",
  vine: "먹덩굴에 휘감겼다",
  jar: "옹기귀에 떠밀려 쓰러졌다",
  crow: "잿까마귀의 재에 덮였다",
  shademonk: "그림자 승병의 지팡이에 쓰러졌다",
  lantern: "석등지기에 짓눌렸다",
  kilnlord: "가마 지킴이의 재 껍데기에 짓눌렸다",
  ashboss: "잿불귀의 불길에 삼켜졌다",
};

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
/**
 * How a blow lands on screen: a skill's pigment (null: ink only), whether it is a brush strike (which bleeds the
 * player's own scarf color) and a floor on its weight.
 */
interface Blow { col: RGB | null; basic: boolean; heavy: number }
const LIGHT_BLOW: Blow = { col: null, basic: true, heavy: 0 };
const HEAVY_BLOW: Blow = { col: null, basic: true, heavy: 0.8 }; // the third strike
// 먹감옥 is ink itself: no pigment
const SKILL_BLOW: Blow[] = SKILL_COL.map((c, i) => ({ col: i === 4 ? null : c, basic: false, heavy: 0.5 }));
/** the scarf's dye as the color a brush strike bleeds (black dye: ink only); recomputed only when it changes */
let strikeHex = -2;
const strikeCol: [number, number, number] = [0, 0, 0];
function strikeTint(hex: number | null | undefined): RGB | null {
  if (hex == null) return null;
  if (hex !== strikeHex) {
    strikeHex = hex;
    strikeCol[0] = ((hex >> 16) & 255) / 255; strikeCol[1] = ((hex >> 8) & 255) / 255; strikeCol[2] = (hex & 255) / 255;
  }
  return strikeCol;
}
interface PendingHits {
  t: number;
  res: HitResult;
  blow: Blow;
}

export class Game {
  private readonly hud: Hud;
  private readonly sheets: Sheets;
  private readonly dialogue: Dialogue;
  private readonly story: Story;
  private readonly hints: Hints;
  private readonly chat: Chat;
  /** the soft keyboard is up: don't resize the renderer under it */
  private layoutLocked = false;
  /* discovery-hint bookkeeping (docs/TUTORIAL.md); checked on events and at ~4 Hz */
  private hintTick = 0;
  private lastHurtAt = -1e9;
  /** a blow of ours landed (combat state for the quest card) */
  private lastHitAt = -1e9;
  /** where the main quest points (4 Hz), and its ground preview */
  private readonly nav = newNav();
  private route: RoutePreview | null = null;
  /** what the next swing would pick (~5 Hz) and its mark on the ground */
  private aimTarget: TargetView | null = null;
  private aimScan = 0;
  private targetRing: TargetRing | null = null;
  /** dialogue portraits rendered from the speakers' own rigs, cached */
  private readonly portraits = new Portraits();
  /** the kind of monster that hurt us last (for the death line) */
  private lastHurtKind = "";
  private nearestKind = "";
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
      album: () => this.openAlbum(),
      claimDaily: () => void this.claimDailyAll(),
      channels: () => attempt(this.api.channelList(), ["not_ready"]),
      changeChannel: (ch) => void this.changeChannel(ch),
      exitMemory: () => void this.exitMemory(),
      interact: () => this.interact(),
      skill: (i) => this.pressSkill(i),
      respawn: () => void this.respawn(),
      auto: () => this.autoProgress(),
      travel: () => this.autoProgress(),
      travelDaily: (i) => this.autoDaily(i),
      autoSettings: () => this.auto.settings,
      saveAutoSettings: () => this.auto.saveSettings(),
      settings: (tab) => this.openSettings(tab),
      chat: () => this.chat.openInput(),
    });
    this.sheets = new Sheets(root, { api, profile: () => this.profile, apply: (p) => this.applyProfile(p),
      enterMemory: (id) => void this.enterMemory(id), memoryBlock: () => this.memoryBlock(), hint: (id, text) => this.hints.think(id, text, { urgent: true }), seen: (id) => this.hints.has(id), mark: (id) => this.hints.mark(id),
      settings: {
        name: () => this.profile?.name ?? "",
        resetHints: () => { this.hints.reset(); toast("안내 혼잣말을 처음부터 다시 본다"); },
        openAuto: () => { this.sheets.close(); this.hud.toggleAutoPop(); },
      } });
    this.dialogue = new Dialogue(root, () => this.profile?.name || "나그네");
    this.hints = new Hints(root);
    this.hints.busy = () => {
      const now = performance.now();
      return now - this.lastHurtAt < 3000 || now - this.lastSwingAt < 2000 || this.dialogue.isOpen() || this.sheets.isOpen();
    };
    this.story = new Story({ api, dialogue: this.dialogue, sheets: this.sheets, hints: this.hints, profile: () => this.profile, apply: (p) => this.applyProfile(p) });
    this.input = new Input({
      blocked: () => this.sheets.isOpen() || this.dialogue.isOpen() || this.transitioning || !this.player || this.chat.isOpen() || this.dead,
      act: (a) => this.pressAct(a),
      skill: (i) => this.pressSkill(i),
      potion: () => void this.drinkPotion(),
      interact: () => this.interact(),
      gear: () => this.openGear(),
      growth: () => this.openGrowth(),
      album: () => this.openAlbum(),
      help: () => this.hud.help(),
      escape: () => this.onEscape(),
      chat: () => { if (gameSettings.v.chat) this.chat.openInput(); },
      mute: () => { toast(audio.toggleMute() ? "소리를 껐습니다 (M)" : "소리를 켰습니다 (M)"); },
      manual: () => this.onManual(),
      auto: () => this.autoProgress(),
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
      travel: (to, from) => this.travel(to, from, true),
      talk: (npc) => this.story.talk(npc),
      think: (id, text) => { this.hints.think(id, text, { urgent: true, repeat: true }); },
      changed: () => { this.hud.setAuto(this.auto.on || this.auto.progress, this.auto.traveling || this.auto.progress, this.auto.progress ? this.auto.daily : -2); },
      claimDailies: () => this.claimDailyAll(),
    });
    // sounds: every actor's swings, rolls and casts (others by distance); monster spits and slams
    actorSound.fn = (code, a) => {
      const name = code >= 10 ? SKILL_SFX[code - 10] : ACT_SFX[code];
      if (!name) return;
      if (a.local) audio.play(name);
      else if (!gameSettings.v.lowRemote) audio.play(name, a.x, a.z, 0.8, true);
    };
    this.monsters.onSound = (ev, src, x, z) => {
      if (ev === "shot") audio.play(src === "crow" ? "crow-caw" : "monster-spit", x, z);
      else if (ev === "land") { if (src === "crow") audio.play("ash-impact", x, z); }
      else audio.play(src === "lantern" ? "stone-slam" : src === "ashboss" ? "boss-slam-bronze" : "monster-slam", x, z);
    };
    this.monsters.onMode = (v, prev) => {
      const m = v.mode;
      if (v.kind === "jar") {
        if (m === "dead") audio.play("jar-break", v.x, v.z);
        else if ((m === "chase" && prev === "idle") || m === "attack") audio.play("jar-hop", v.x, v.z, 0.8);
      } else if (v.kind === "shademonk" && m === "attack") audio.play("monk-staff", v.x, v.z);
      else if (v.kind === "ashboss") {
        if (m === "wind") audio.play("boss-windup", v.x, v.z);
        else if (m === "dead") audio.play("boss-fade", v.x, v.z);
      }
    };
    this.chat = new Chat(root, { send: (t) => this.sayChat(t), typing: (on) => this.lockLayout(on) });
    gameSettings.onChange((s) => {
      setQuality(s.quality);
      setShake(s.shake);
      actorFx.remoteLow = s.lowRemote;
      this.hud.showDmg = s.dmgNumbers;
      this.chat.filter = s.chatFilter;
      root.classList.toggle("names-mine", s.names === "mine");
      root.classList.toggle("names-off", s.names === "off");
      root.classList.toggle("chat-off", !s.chat);
      if (!s.chat) this.chat.close();
    });
  }

  /** Esc: close what's open (auto popover, a sheet); with nothing open, the settings menu. */
  private onEscape(): void {
    if (this.hud.autoPopOpen()) { this.hud.closeSoundPop(); return; }
    if (this.sheets.isOpen()) { this.sheets.close(); return; }
    if (this.memory) { void this.exitMemory(); return; }
    if (this.dialogue.isOpen() || this.transitioning || this.dead) return;
    this.openSettings();
  }

  private openSettings(tab?: string): void {
    if (this.dialogue.isOpen()) return;
    this.input.clear();
    this.hud.closeSoundPop();
    this.sheets.openSettings(tab);
  }

  /* ---------- chat ---------- */
  /** room the chat log currently shows (cleared with a label line on a change) */
  private chatRoom = "";

  private wireChat(): void {
    this.api.onChat((m) => this.onChatLine(m));
  }

  /** A new room (zone or channel): clear the log and say where we are. */
  private chatRoomChanged(zone: string, channel: number): void {
    const key = `${zone}:${channel}`;
    if (key === this.chatRoom) return;
    this.chatRoom = key;
    this.hud.clearSays();
    // the log was cleared when we left; the new room's recent lines may already be in, so the label goes first
    this.chat.label(`— ${ZONES[zone]?.name ?? zone} ${channel}채널 —`);
  }

  private async sayChat(text: string): Promise<void> {
    try {
      await this.api.chatSay(text);
    } catch (e) {
      const code = errorCode(e);
      toast(code === "on_cooldown" ? "잠시 후에 다시 말할 수 있다" : code === "rate_limited" ? "같은 말을 너무 자주 했다" : code === "bad_args" ? "말이 너무 길거나 비었다" : errorText(e), true);
      throw e;
    }
  }

  private onChatLine(m: ChatMessage): void {
    if (!gameSettings.v.chat) return;
    this.chat.push(m);
    if (m.sys || (gameSettings.v.chatFilter && /\*{2,}/.test(m.text))) return;
    // the bubble goes over the speaker if they're in this room (matched by nickname; ids are never shown)
    if (this.profile && m.name === this.profile.name) { this.hud.say(this, m.text); return; }
    for (const r of this.remotes.values()) if (r.name === m.name) { this.hud.say(r, m.text); return; }
  }

  /** While the chat box has the keyboard, the game keeps its size (a phone's keyboard shrinks the iframe). */
  private lockLayout(on: boolean): void {
    const html = document.documentElement;
    if (on) {
      html.style.setProperty("--lock-h", `${window.innerHeight}px`);
      html.classList.add("typing-lock");
      this.layoutLocked = true;
      this.input.clear();
    } else {
      html.classList.remove("typing-lock");
      this.layoutLocked = false;
      resize();
    }
  }

  /** Any manual move/attack/skill: auto-battle steps aside for a moment, auto-travel stops. */
  private onManual(): void {
    this.lastManualAt = performance.now();
  }

  /** Z: 자동 진행 - takes the main quest, goes where it leads, hands it in, and on to the next. */
  private autoProgress(): void {
    // stopping always works (mid-conversation, mid-crossing); starting needs a free moment
    if (this.auto.progress || this.auto.on || this.auto.traveling) { this.auto.stop(); toast("자동 진행 끔"); return; }
    if (!this.player || this.dead || this.transitioning || this.dialogue.isOpen() || this.memory) return;
    const why = this.auto.toggleProgress();
    if (why) { this.hints.think("auto-why", why, { urgent: true, repeat: true }); return; }
    toast("자동 진행");
  }

  /** A daily quest tapped in the tracker: 자동 진행 on that one (again on the same one: stop). */
  private autoDaily(i: number): void {
    if (this.auto.progress && this.auto.daily === i) { this.auto.stop(); toast("자동 진행 끔"); return; }
    if (!this.player || this.dead || this.transitioning || this.dialogue.isOpen() || this.memory) return;
    const why = this.auto.startDaily(i);
    if (why) { this.hints.think("auto-why", why, { urgent: true, repeat: true }); return; }
    toast(`자동 진행 · ${DAILY_QUESTS[i].title}`);
  }

  /* ---------- start ---------- */
  async begin(profile: ProfileView): Promise<void> {
    this.hints.bind(this.api.account);
    this.dialogue.bindAccount(this.api.account);
    this.dialogue.portraitFor = (who) => this.portraitOf(who);
    this.dialogue.autoNext = () => this.auto.progress;
    this.dialogue.autoHold = () => this.sheets.isOpen();
    this.monsters.onEffect = (kind) => {
      if (kind === "shot" && this.questIs("c1q7")) this.hints.think("gate5", "떨어질 자리를 보고 굴러야겠다.", { key: KEYS.roll, urgent: true });
      if (kind === "slam" && this.zone.def.id === "peak" && this.questIs("c1q10")) this.hints.think("gate7", "지금이다!", { key: KEYS.roll, urgent: true });
      if (kind === "slam" && this.zone.def.id === "censer" && this.questIs("c2q10")) this.hints.think("gate10", "고리가 넓다… 끝까지!", { key: KEYS.roll, urgent: true });
    };
    this.auto.bind(this.api.account);
    // 화첩: a chapter boss falling near you paints the color bloom's fullest moment into the album
    album.onChange = () => { if (album.count() > 0) this.revealAlbum(); if (this.sheets.current === "album") this.sheets.refresh(); };
    void album.bind(this.api.account);
    this.monsters.onBossFall = (kind, x, z) => {
      const page = PAGE_FOR_BOSS[kind];
      const pl = this.player;
      if (!page || !pl || this.dead || album.has(page.id) || Math.hypot(pl.x - x, pl.z - z) > 30) return null;
      return (canvas) => {
        void paintFrame(canvas).then(async (blob) => {
          if (!blob || !(await album.keep(page.id, blob))) return;
          audio.play("pickup");
          toast(`화첩에 한 장이 남았다: ${page.title} [${KEYS.album}]`);
        });
      };
    };
    for (const part of ["growth", "gear", "potion", "auto", "album"] as const) if (this.hints.has(`ui:${part}`)) this.hud.reveal(part, false);
    this.profile = profile;
    const zoneId = ZONES[profile.zone] ? profile.zone : START_ZONE;
    this.entry = await this.api.enterZone(zoneId);
    const hooks: ActorHooks = {
      attack: (kind, a) => this.sendAttack(kind, a),
      skill: (i, a, delay) => this.sendSkill(i, a, delay),
      // mouse players face the cursor on every swing and cast; others get the nearest-target assist
      // auto-targeting for everyone: whoever is on you, else ahead, else nearest (targeting.ts)
      aim: (x, z, dir, kind) => aimFor(this.monsters.views, x, z, dir, kind),
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
    this.chatRoomChanged(this.entry.zone, this.entry.channel);
    audio.musicForZone(this.entry.zone);
    audio.ambience(this.entry.zone);
    this.applyProfile(profile);
    this.zoneTags();
    this.api.onProfile((p) => this.applyProfile(p));
    this.api.onRoom((r) => this.onRoom(r));
    this.api.onPlayers((pl) => this.onPlayers(pl));
    window.addEventListener("resize", () => { if (!this.layoutLocked) resize(); });
    this.wireChat();
    (window as unknown as { __ink?: unknown }).__ink = { info: memoryInfo, game: this, audio };
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
    // the top-left ensō shows your own face (the same in-engine cutout the dialogue uses; cached per look)
    if (this.player) { const face = this.portraitOf("me"); if (face) this.hud.setFace(face.neutral); }
    this.hud.tag(this, esc(p.name || "나그네"), "me");
    if (prev && p.level > prev.level && this.player) {
      const sk = SKILLS.find((s) => s.unlock > prev.level && s.unlock <= p.level);
      this.hud.levelUp(p.level, sk ? sk.name : null);
      audio.play("levelup");
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
    const open = (part: "growth" | "gear" | "potion" | "auto" | "album") => {
      if (this.hints.has(`ui:${part}`)) return;
      this.hints.mark(`ui:${part}`);
      this.hud.reveal(part, true);
    };
    if ((p.points ?? 0) > 0) open("growth");
    if (p.main > questIndex("c1q3")) open("auto");
    if (p.pigment > 0 || p.jade > 0 || p.main > questIndex("c1q3")) open("gear");
    // the gourd shows as soon as there are potions (물약 자동 사용 works from then on, so it must be visible)
    if (p.potions > 0) open("potion");
    if (ALBUM_PAGES.some((pg) => pageEarned(pg, p.main))) open("album");
  }

  private revealAlbum(): void {
    if (this.hints.has("ui:album")) return;
    this.hints.mark("ui:album");
    this.hud.reveal("album", true);
  }

  private onHp(before: number, after: number, dead: boolean): void {
    if (after < before && !this.dead) {
      this.lastHurtAt = performance.now();
      if (!this.hints.has("ui:potion")) { this.hints.mark("ui:potion"); this.hud.reveal("potion", true); }

      // knock away from the nearest monster
      let nx = 0, nz = 1, best = 1e9, nearestScore = 1e9;
      this.nearestKind = "";
      for (const v of this.monsters.views.values()) {
        if (v.mode === "dead") continue;
        const d = Math.hypot(this.player.x - v.x, this.player.z - v.z);
        if (d < best) { best = d; nx = (this.player.x - v.x) / (d || 1); nz = (this.player.z - v.z) / (d || 1); }
        // the death line names whoever was swinging at us (nearest one mid-attack), else the nearest
        const swinging = v.mode === "attack" || v.mode === "wind";
        if (d < 14 && (swinging ? d - 6 : d) < nearestScore) { nearestScore = swinging ? d - 6 : d; this.nearestKind = v.kind; }
      }
      if (best > 12) { nx = 0; nz = 0; }
      this.lastHurtKind = this.nearestKind;
      this.player.hurt(nx, nz);
      if (!dead) audio.play("player-hurt");
      this.hud.number(this.player.x, 2.3, this.player.z, `-${Math.round(before - after)}`, "hurt");
    }
    if (dead && !this.dead) {
      this.auto.stop();
      this.hud.deathCause(performance.now() - this.lastHurtAt < 6000 ? DEATH_BY[this.lastHurtKind] ?? DEATH_BY[""] : DEATH_BY[""]);
      if (!this.hints.has("death")) { this.hints.mark("death"); this.hud.deathThought("물약을 챙길 걸… 단이에게 가 보자."); }
      else this.hud.deathThought(null);
      this.dead = true;
      this.player.die();
      this.sheets.close();
      this.dialogue.hold(true);
      this.hud.death(true);
      audio.play("death");
      audio.duck(true);
    } else if (!dead && this.dead && !this.respawning) {
      this.dead = false;
      this.player.revive();
      this.dialogue.hold(false);
      this.hud.death(false);
      audio.duck(false);
    }
  }

  private onRoom(r: RoomView): void {
    if (this.transitioning || !this.player || this.memory) return;
    this.monsters.onRoom(r, this.player.x, this.player.z);
  }

  private onPlayers(pl: Record<string, RoomPlayer>): void {
    if (this.transitioning || !this.player || this.memory) return;
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
      this.hud.tag(r, `${esc(rp.name || "나그네")}<small>Lv ${rp.level}</small>`, rp.dead ? "pc dead" : "pc");
    }
    for (const [id, r] of this.remotes) {
      if (id in pl) continue;
      this.dropRemote(id, r);
    }
  }

  private dropRemote(id: string, r: Remote): void {
    this.hud.dropSay(r);
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
      if (res) this.queueHits(res, Math.max(0, (IMPACT[kind] ?? 0) - (performance.now() - sent) / 1000), kind === 3 ? HEAVY_BLOW : LIGHT_BLOW);
    });
  }

  private sendSkill(i: number, a: Actor, delay: number): void {
    void attempt(this.api.castSkill({ skill: i, x: a.x, z: a.z, yaw: a.head }), QUIET_COMBAT).then((res) => {
      if (res) this.queueHits(res, delay, SKILL_BLOW[i] ?? LIGHT_BLOW);
    });
  }

  private queueHits(res: HitResult, delay: number, blow: Blow): void {
    if (delay <= 0.05) this.showHits(res, blow);
    else this.pending.push({ t: delay, res, blow });
  }

  private showHits(res: HitResult, blow: Blow): void {
    if (res.hits.length) this.lastHitAt = performance.now();
    for (const h of res.hits) {
      const hv = this.monsters.views.get(h.id);
      if (h.resisted && hv) {
        // 먹 갑옷 / 덩굴: the blow slides off
        sparkBurst(hv.x, hv.def.height * 0.6, hv.z, 10, GREY, 0.7, 1);
        if (hv.kind === "shadelord" && this.questIs("c1q5")) this.hints.think("gate4", "칼이 미끄러진다…", { key: KEYS.growth, urgent: true });
        if (hv.def.boss && this.questIs("c1q10")) this.hints.think("gate6", "무딘 붓으론 안 된다…", { key: KEYS.growth, urgent: true });
        if (hv.kind === "kilnlord" && this.questIs("c2q5")) this.hints.think("gate8", "불씨가 얕다… 화염선풍을 깨워야 한다.", { key: KEYS.growth, urgent: true });
        if (hv.kind === "ashboss" && this.questIs("c2q10")) this.hints.think("gate9", "불길이 붓을 밀어낸다… 붓을 더 벼려야 한다.", { key: KEYS.growth, urgent: true });
      }
      // 8b: the awakened fire gets through the shell (shown once, also to those who never saw gate 8)
      if (!h.resisted && hv && hv.kind === "kilnlord" && this.questIs("c2q5")) this.hints.think("gate8b", "깨어난 불이 껍데기를 녹인다.", { urgent: true });
      if (h.kill) {
        this.kills++;
        if (this.zone.def.id === "bamboo" && this.questIs("c1q3")) {
          this.gateKills++;
          if (this.gateKills >= 3 && !this.hints.has("ui:auto")) {
            this.hints.mark("ui:auto");
            this.hud.reveal("auto", true);
            this.hints.think("gate2", "손에 익었다… 붓이 알아서 움직일 것 같다.", { urgent: true });
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
      // 가마 지킴이: its ash shell only bounces the blow, until an awakened 화염선풍 cracks the glaze
      if (v.kind === "kilnlord") {
        if (h.resisted) shellBounce(v.x, v.def.height * 0.6, v.z);
        else glazeCrack(v.x, v.def.height * 0.6, v.z);
      }
      // 잿불귀 falls: the white fire at its brush tip turns cinnabar and flows into the player's brush
      if (h.kill && v.kind === "ashboss") {
        fireFlow(v.x + Math.cos(v.head) * 1.2, 6.2, v.z - Math.sin(v.head) * 1.2, pl);
        emberBloom();
      }
      // ink where the blow lands, flung away from the player, bigger for bigger blows; a burst on a kill
      if (!h.resisted) {
        const dx = v.x - pl.x, dz = v.z - pl.z, d = Math.hypot(dx, dz) || 1;
        const power = Math.min(2, 0.6 + Math.log10(1 + h.dmg) * 0.35);
        heavy = Math.max(heavy, (power - 0.6) / 1.4, blow.heavy);
        inkHit(v.x, v.def.height * 0.55, v.z, dx / d, dz / d, power, blow.basic ? strikeTint(this.profile?.dye.scarf) : blow.col);
        if (h.kill) { killed = true; killBurst(v.x, v.def.height * 0.5, v.z, v.def.radius); }
      }
      if (v.kind === "kilnlord") audio.play(h.resisted ? "armor-clunk" : "glaze-crack", v.x, v.z);
      else audio.play(h.resisted ? "resisted" : h.kill ? "kill-burst" : "hit-ink", v.x, v.z);
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
    if (drops.length) { toast(drops.join(" / ")); audio.play("pickup"); }
    if (res.levelUp || res.exp > 0 || res.pigment > 0 || res.jade > 0 || res.stones || res.shards) this.profileCheckAt = performance.now() + 700;
  }

  /* ---------- input actions ---------- */
  private pressAct(a: Act): void {
    if (!this.player || this.dead || (this.memory && a === "atk")) return;
    this.player.input[a] = BUF;
  }

  private pressSkill(i: number): void {
    if (!this.player || this.sheets.isOpen() || this.transitioning || this.memory) return;
    if (this.dead) return;
    const s = SKILLS[i];
    if (!s) return;
    if (this.profile.level < s.unlock) { this.hints.think("tease", `이 자리엔 어떤 검법이 들어올까… (Lv ${s.unlock})`, { repeat: true, urgent: true }); return; }
    if (this.player.cd[i] > 0) return;
    this.player.input.sk = i;
    this.player.input.skT = BUF;
  }

  private potionBusy = false;
  private lastPotionAt = -1e9;
  /** told once that the gourd is empty (until it's refilled) */
  private emptyNoted = false;

  /** 물약 자동 사용: below the threshold in a hunting zone, drink (manual play too); never in the village or dead. */
  private autoPotion(): void {
    const p = this.profile;
    if (!p || !gameSettings.v.autoPotion || this.dead || this.zone.def.safe || this.transitioning || p.hp <= 0) return;
    if (p.potions > 0) this.emptyNoted = false;
    if (p.hp / Math.max(1, p.maxHp) >= gameSettings.v.potionAt) return;
    if (p.potions <= 0) {
      if (!this.emptyNoted) { this.emptyNoted = true; this.hints.think("potion-empty", "물약이 떨어졌다… 단이에게 가 보자", { urgent: true, repeat: true }); }
      return;
    }
    const now = performance.now();
    if (this.potionBusy || now - this.lastPotionAt < 1600) return;
    this.lastPotionAt = now;
    this.potionBusy = true;
    void this.drinkPotion(true).finally(() => { this.potionBusy = false; });
  }

  /** `auto`: drunk by 물약 자동 사용 (said so on screen, and the gourd flashes, so it's clear it happened) */
  private async drinkPotion(auto = false): Promise<void> {
    if (!this.profile || this.dead || this.transitioning) return;
    if (this.profile.potions <= 0) { toast("물약이 없습니다 · 마을 염색 장인에게서 살 수 있습니다"); return; }
    if (this.profile.hp >= this.profile.maxHp) { toast("생명이 가득합니다"); return; }
    const before = this.profile.hp;
    const p = await attempt(this.api.usePotion());
    if (!p) return;
    this.applyProfile(p);
    const healed = p.hp - before;
    if (healed > 0) this.hud.number(this.player.x, 2.4, this.player.z, auto ? `자동 물약 +${healed}` : `+${healed}`, "gain");
    if (auto) this.hud.potionPing();
    sparkBurst(this.player.x, 1, this.player.z, 14, SKILL_COL[3], 0.5, 1.2);
    audio.play("potion");
  }

  private openGrowth(): void {
    if (!this.profile || this.transitioning || this.dialogue.isOpen() || this.dead) return;
    this.input.clear();
    if (this.hints.has("gate6") && !this.hints.has("gate6-open")) { this.hints.mark("gate6-open"); this.sheets.openGrowth("enhance"); }
    else if (this.hints.has("gate8") && !this.hints.has("gate8-open")) { this.hints.mark("gate8-open"); this.sheets.openGrowth("skills", "awaken1"); }
    else if (this.hints.has("gate9") && !this.hints.has("gate9-open")) { this.hints.mark("gate9-open"); this.sheets.openGrowth("enhance", "odds"); }
    else this.sheets.openGrowth();
  }

  /** Every finished daily quest, paid from the tracker (no walk back to 먹노인). */
  private async claimDailyAll(): Promise<void> {
    const before = this.profile;
    const p = await attempt(this.api.claimDailyAll());
    if (!p) { this.hud.setProfile(before); return; }
    const sum = { exp: 0, pigment: 0, jade: 0, stones: 0, shards: 0 };
    DAILY_QUESTS.forEach((q, i) => {
      if (!before.daily.claimed[i] && p.daily.claimed[i]) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += q.reward[k] ?? 0;
    });
    this.applyProfile(p);
    const names: Record<keyof typeof sum, string> = { exp: "경험", pigment: "안료", jade: "묵옥", stones: "먹돌", shards: "색 조각" };
    toast(`오늘의 의뢰 보상 · ${(Object.keys(sum) as (keyof typeof sum)[]).filter((k) => sum[k]).map((k) => `${names[k]} ${sum[k]}`).join(" · ")}`);
    audio.play("quest-done");
  }

  private openAlbum(): void {
    if (!this.profile || this.transitioning || this.dead) return;
    if (!this.hints.has("ui:album")) return;
    this.input.clear();
    this.sheets.openAlbum();
  }

  private openGear(): void {
    if (!this.profile || this.transitioning || this.dead) return;
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
    if (!this.player || this.dead || this.transitioning || this.memory) return;
    if (this.sheets.isOpen()) return;
    const n = this.nearNpc();
    if (n) { this.input.clear(); void this.story.talk(n); return; }
    const p = this.nearPortal(PORTAL_PROMPT);
    if (p) void this.travel(p.to, this.zone.def.id);
  }

  /* ---------- zones ---------- */
  /**
   * Change zone. Returns true on arrival. With `retry` (auto-travel), a too_far answer (the server hasn't
   * seen us reach the gate yet) is quiet and doesn't push us back: the driver just keeps walking.
   */
  private async travel(to: string, viaPortal?: string, retry = false): Promise<boolean> {
    if (this.transitioning || this.memory) return false;
    this.transitioning = true;
    this.sheets.close();
    this.input.clear();
    if (viaPortal) audio.play("portal");
    this.loading.show(to, "길을 건너는 중…");
    let ok = false;
    try {
      const entry = await this.api.enterZone(to, viaPortal);
      this.chat.clear();
      this.loading.progress(0.7);
      this.rebuild(entry);
      ok = true;
    } catch (e) {
      if (!(retry && errorCode(e) === "too_far")) {
        toast(errorText(e), true);
        // step back from the gate so we don't walk straight into it again
        const p = this.player;
        const d = Math.hypot(p.x, p.z) || 1;
        p.teleport(p.x - (p.x / d) * 3, p.z - (p.z / d) * 3);
      }
    } finally {
      await this.loading.hide();
      this.transitioning = false;
    }
    return ok;
  }

  /** To another channel of this zone, where you stand (the HUD's channel picker). */
  private async changeChannel(channel: number): Promise<void> {
    if (this.transitioning || this.memory || this.dead || !this.player) return;
    this.transitioning = true;
    this.auto.stop();
    this.sheets.close();
    this.input.clear();
    this.loading.show(this.zone.def.id, `${channel}채널로 건너가는 중…`);
    try {
      const entry = await this.api.changeChannel(channel);
      this.chat.clear();
      this.loading.progress(0.7);
      this.rebuild(entry);
      toast(`${channel}채널`);
    } catch (e) {
      const code = errorCode(e);
      toast(code === "room_full" ? "그 채널은 가득 찼다" : code === "on_cooldown" ? "채널은 10초에 한 번 바꿀 수 있다" : code === "dead" ? "쓰러진 채로는 옮길 수 없다" : errorText(e), true);
    } finally {
      await this.loading.hide();
      this.transitioning = false;
    }
  }

  private rebuild(entry: ZoneEntry): void {
    const changed = entry.zone !== this.entry.zone || entry.channel !== this.entry.channel;
    this.entry = entry;
    if (changed) {
      this.swapZone(entry.zone);
      this.hud.setZone(entry.zone, entry.channel);
      this.loading.channel(entry.channel);
      this.chatRoomChanged(entry.zone, entry.channel);
    }
    this.player.teleport(entry.x, entry.z);
    this.camX = entry.x;
    this.camZ = entry.z;
  }

  /** Tear the current zone down (scenery, monsters, other players, effects) and build `zoneId`'s. */
  private swapZone(zoneId: string): void {
    for (const a of this.zone.anchors) this.hud.dropTag(a);
    this.zone.dispose();
    this.monsters.clear();
    for (const [id, r] of this.remotes) this.dropRemote(id, r);
    clearFx();
    clearLights();
    clearStains();
    clearBloom();
    this.zone = new ZoneScene(ZONES[zoneId] ?? ZONES[START_ZONE]);
    this.ambient.setTheme(this.zone.def.theme);
    setEdge(this.zone.def.radius + 5);
    this.zone.field.dynamic = this.monsters.obstacles;
    this.player.field = this.zone.field;
    this.zoneTags();
    audio.musicForZone(zoneId);
    audio.ambience(zoneId);
    this.auto.zoneChanged();
  }

  /* ---------- 추억 속 풍경: walk a recovered region alone, in its own color ---------- */
  // Built locally (no room, no monsters, no other players); your real self keeps standing where you were in a
  // safe zone, and nothing you do here reaches the server. Esc or 돌아가기 brings you back.
  private memory: { page: AlbumPage; backX: number; backZ: number } | null = null;

  /** Why the memory can't be opened right now, or null. */
  memoryBlock(): string | null {
    if (!this.player || this.dead || this.transitioning) return "지금은 펼칠 수 없다";
    if (!this.zone.def.safe) return "마을에서만 펼칠 수 있다";
    return null;
  }

  async enterMemory(pageId: string): Promise<void> {
    const page = ALBUM_PAGES.find((pg) => pg.id === pageId);
    if (!page?.zone || !ZONES[page.zone] || this.memory || this.memoryBlock()) return;
    this.transitioning = true;
    this.sheets.close();
    this.input.clear();
    if (this.auto.on) this.auto.toggle();
    if (this.auto.traveling) this.auto.stop();
    this.loading.show(page.zone, "기억 속으로…");
    this.memory = { page, backX: this.player.x, backZ: this.player.z };
    this.swapZone(page.zone);
    holdColor(page.color ?? null);
    const def = ZONES[page.zone];
    const sx = def.boss?.x ?? 0, sz = (def.boss?.z ?? 0) + 5;
    this.player.teleport(sx, sz);
    this.camX = sx;
    this.camZ = sz;
    this.hud.setMemory(`${page.chapter} · ${page.title}`, def.name);
    await this.loading.hide();
    this.transitioning = false;
  }

  async exitMemory(): Promise<void> {
    const m = this.memory;
    if (!m || this.transitioning) return;
    this.transitioning = true;
    this.input.clear();
    this.loading.show(this.entry.zone, "다시 먹빛 세상으로");
    holdColor(null);
    this.memory = null;
    this.swapZone(this.entry.zone);
    this.player.teleport(m.backX, m.backZ);
    this.camX = m.backX;
    this.camZ = m.backZ;
    this.hud.setMemory(null);
    await this.loading.hide();
    this.transitioning = false;
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
      this.chat.clear();
      const entry = await this.api.respawn();
      this.loading.progress(0.7);
      this.rebuild(entry);
      this.dead = false;
      this.player.revive();
      this.dialogue.hold(false);
      this.hud.death(false);
      audio.duck(false);
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
    if (this.player) audio.listen(this.player.x, this.player.z);
    const realDt = Math.min((now - this.lastFrame) / 1000, 1 / 30);
    this.lastFrame = now;
    feel.time += realDt;
    let dt = realDt;
    // a heavy blow holds the world almost still, then it creeps on slowly before running again
    if (feel.freeze > 0) { feel.freeze -= realDt; dt *= 0.02; }
    else if (feel.hitstop > 0) { feel.hitstop -= realDt; dt *= 0.08; }
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
      if (h.t <= 0) { this.pending.splice(i, 1); this.showHits(h.res, h.blow); }
    }

    this.updateCamera(realDt);
    p.render(dt);
    for (const r of this.remotes.values()) r.actor.render(dt);

    // tags every frame (they follow the camera); text changes only when needed
    this.hud.placeTag(this, p.x, p.y + 2.55, p.z);
    for (const r of this.remotes.values()) this.hud.placeTag(r, r.actor.x, r.actor.y + 2.55, r.actor.z);
    this.hud.placeSay(this, p.x, p.y + 3.15, p.z);
    this.hints.place(p.x, p.y + 3.3, p.z);
    const at = this.aimTarget;
    if (at && targetable(at) && !this.dead) {
      this.targetRing ??= new TargetRing();
      this.targetRing.show(at.x, at.z, at.def.radius, feel.time);
    } else this.targetRing?.hide();
    if (this.nav.ok && !this.dead && (this.auto.traveling || this.hud.goHover)) {
      this.route ??= new RoutePreview();
      this.route.update(p.x, p.z, this.nav.stepX, this.nav.stepZ, this.nav.stepIsPortal, feel.time);
    } else this.route?.hide();
    for (const r of this.remotes.values()) this.hud.placeSay(r, r.actor.x, r.actor.y + 3.15, r.actor.z);
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

    if (!this.transitioning && !this.memory) {
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


  /** ~4 Hz: the quest card's distance line and state tag (no allocation on the hot path). */
  private questTick(): void {
    const p = this.player;
    if (!p || !this.profile) return;
    questNav(this.profile, this.zone.def.id, p.x, p.z, this.monsters.views, this.nav);
    this.hud.setQuestNav(this.nav);
    this.hud.refreshHover();
    const now = performance.now();
    // swinging the brush in the village is only practice: no 전투 중 there
    const fight = !this.dead && !this.zone.def.safe && (now - this.lastHurtAt < 4000 || now - this.lastHitAt < 4000 || p.inCombat);
    this.hud.setQuestState(fight ? "fight" : this.auto.traveling ? "travel" : this.auto.on ? "auto" : "");
  }

  /**
   * A speaker's portrait: the player's own figure (keyed by their dyes and hat), an NPC standing in this zone,
   * or 홍매, who never stands anywhere (a figure made for her, then let go).
   */
  private portraitOf(who: string): { neutral: string; speak: string } | null {
    if (who === "me") {
      if (!this.player || !this.profile) return null;
      const p = this.profile;
      const key = `me:${p.dye?.scarf ?? ""}:${p.dye?.sash ?? ""}:${p.equip.hat}:${p.equip.sash}:${p.equip.weapon}`;
      return this.portraits.get(key) ?? this.portraits.capture(key, this.player.rig);
    }
    const have = this.portraits.get(who);
    if (have) return have;
    if (who === "hongmae") {
      const rig = new Rig();
      rig.setBuild({ height: 1.02, head: 0.96, limb: 0.86, legs: 1.04 });
      rig.setHat(undefined);
      rig.setSash(0xc8322a);
      return this.portraits.capture(who, rig);
    }
    // the NPC's own rig in this zone; else a figure built from its look (lines spoken elsewhere)
    const rig = this.zone.npcRig(who) ?? buildNpcRig(who);
    return rig ? this.portraits.capture(who, rig) : null;
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
          if (p.level >= SKILLS[1].unlock) h.think("gate3", "불이라도 있으면… 화염선풍으로 태워 보자", { key: "2", urgent: true });
          else h.think("gate3", "불이라도 있으면… 바람이에게 가 보자.", { urgent: true });
          break;
        }
      }
    }
  }

  private slowUi(): void {
    this.autoPotion();
    this.aimScan -= 0.1;
    if (this.aimScan <= 0) {
      this.aimScan = 0.2;
      const pl = this.player, inp = pl.input, moving = Math.hypot(inp.mx, inp.mz) > 0.15;
      this.aimTarget = this.zone.def.safe || this.dead ? null : pickTarget(this.monsters.views, pl.x, pl.z, moving ? Math.atan2(-inp.mz, inp.mx) : pl.head, -1);
    }
    this.hintTick -= 0.1;
    if (this.hintTick <= 0) { this.hintTick = 0.25; this.checkHints(); this.questTick(); }
    const p = this.player;
    // a living monster within reach of a fight: 먹동이 brings the brush down into a low guard
    let threat = false;
    for (const v of this.monsters.views.values()) if (v.hp > 0 && Math.abs(v.x - p.x) < 8 && Math.abs(v.z - p.z) < 8) { threat = true; break; }
    p.threat = threat;
    for (let i = 0; i < SKILLS.length; i++) this.hud.setCooldown(i, p.cd[i] / p.skillCd(i), p.cd[i]);
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
    const shake = feelFlags.shake ? feel.shake : 0; // settings: camera shake off
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
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
    setQuality(gameSettings.v.quality); // the player's choice from the start (title scene too)
    title.startScene();
  } catch (e) {
    console.error(e);
    title.busy();
    title.status("이 브라우저에서 WebGL을 켤 수 없어 화면을 그리지 못했습니다. 하드웨어 가속을 켜고 다시 열어 보세요.");
    return;
  }
  const loading = new Loading(root);
  // sound waits for the first tap/click/key (the title tap); the title theme is queued for it
  audio.arm();
  audio.music("title");
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
