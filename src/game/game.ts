// The client game: title → connect → profile → enter zone → play. Local movement is predicted exactly
// like the prototype; all outcomes (damage, rewards, HP, quests, shop) come from GameApi.

import { createGameApi } from "../net";
import type { GameApi, HitResult, ProfileView, RoomView, ZoneEntry } from "../net/api";
import type { Look, Pose, RoomPlayer } from "../shared/types";
import { MONSTERS, SKILLS } from "../shared/combat";
import { NPC_REACH, START_ZONE, ZONES, type Npc, type Portal } from "../shared/world";
import { Actor, type ActorHooks } from "./actor";
import { Monsters } from "./monsters";
import { ZoneScene } from "./world";
import * as THREE from "three";
import { camFwd, camera, clearLights, feel, initRenderer, memoryInfo, renderFrame, resize, setEdge, setHorizon, setLoop, addLight } from "./render/gfx";
import { SKILL_COL, clearFx, ring, updateFx, sparkBurst } from "./render/fx";
import { Ambient } from "./render/ambient";
import { Hud } from "./ui/hud";
import { Input, type Act } from "./ui/input";
import { Sheets } from "./ui/sheets";
import { Dialogue } from "./ui/dialogue";
import { Story } from "./story";
import { npcMark } from "./quests";
import { Title, mockAdPresenter } from "./ui/title";
import { attempt, el, errorCode, errorText, esc, installSprites, toast } from "./ui/dom";

const BUF = 0.15;
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

  constructor(private readonly api: GameApi, root: HTMLElement) {
    this.hud = new Hud(root, {
      potion: () => void this.drinkPotion(),
      gear: () => this.openGear(),
      interact: () => this.interact(),
      skill: (i) => this.pressSkill(i),
      respawn: () => void this.respawn(),
    });
    this.sheets = new Sheets(root, { api, profile: () => this.profile, apply: (p) => this.applyProfile(p) });
    this.dialogue = new Dialogue(root, () => this.profile?.name || "먹동이");
    this.story = new Story({ api, dialogue: this.dialogue, sheets: this.sheets, profile: () => this.profile, apply: (p) => this.applyProfile(p) });
    this.input = new Input({
      blocked: () => this.sheets.isOpen() || this.dialogue.isOpen() || this.transitioning || !this.player,
      act: (a) => this.pressAct(a),
      skill: (i) => this.pressSkill(i),
      potion: () => void this.drinkPotion(),
      interact: () => this.interact(),
      gear: () => this.openGear(),
      help: () => this.hud.help(),
      escape: () => this.sheets.close(),
    }, root);
  }

  /* ---------- start ---------- */
  async begin(profile: ProfileView): Promise<void> {
    this.profile = profile;
    const zoneId = ZONES[profile.zone] ? profile.zone : START_ZONE;
    this.entry = await this.api.enterZone(zoneId);
    const hooks: ActorHooks = {
      attack: (kind, a) => this.sendAttack(kind, a),
      skill: (i, a, delay) => this.sendSkill(i, a, delay),
      aim: (x, z, hasIn, ih) => this.monsters.aim(x, z, hasIn, ih),
    };
    this.zone = new ZoneScene(ZONES[this.entry.zone] ?? ZONES[START_ZONE]);
    this.ambient.setTheme(this.zone.def.theme);
    setEdge(this.zone.def.radius + 5);
    this.player = new Actor(true, hooks, this.zone.field);
    this.player.applyLook(this.lookOf(profile));
    this.player.teleport(this.entry.x, this.entry.z);
    this.player.head = Math.PI / 2;
    this.camX = this.entry.x;
    this.camZ = this.entry.z;
    this.hud.setZone(this.entry.zone, this.entry.channel);
    this.applyProfile(profile);
    this.zoneTags();
    this.api.onProfile((p) => this.applyProfile(p));
    this.api.onRoom((r) => this.onRoom(r));
    this.api.onPlayers((pl) => this.onPlayers(pl));
    window.addEventListener("resize", resize);
    (window as unknown as { __ink?: unknown }).__ink = { info: memoryInfo, game: this };
    this.lastFrame = performance.now();
    setLoop(() => this.frame());
    void this.story.prologue(this.api.account);
    // key help once for a new player on a keyboard; H brings it back
    if (!window.matchMedia("(pointer: coarse)").matches && !seenHelp()) this.hud.help(true, 12000);
  }

  private lookOf(p: ProfileView): Look {
    return { weapon: p.equip.weapon, hat: p.equip.hat, sash: p.equip.sash, sashDye: p.dye.sash, scarfDye: p.dye.scarf };
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
      if (sk) toast(`${sk.name}을(를) 익혔다 · ${sk.id + 1}번`);
    }
    if (prev && this.player) this.onHp(prev.hp, p.hp, p.hp <= 0);
    this.sheets.refresh();
  }

  private onHp(before: number, after: number, dead: boolean): void {
    if (after < before && !this.dead) {
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
      this.dead = true;
      this.player.die();
      this.sheets.close();
      this.hud.death(true);
    } else if (!dead && this.dead && !this.respawning) {
      this.dead = false;
      this.player.revive();
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
    void attempt(this.api.attack({ kind, x: a.x, z: a.z, yaw: a.head }), QUIET_COMBAT).then((res) => {
      if (res) this.queueHits(res, 0);
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
    let any = false;
    for (const h of res.hits) {
      const v = this.monsters.views.get(h.id);
      if (!v) continue;
      any = true;
      v.flash = 0.12;
      const def = MONSTERS[v.kind] ?? v.def;
      this.hud.number(v.x, def.height + 0.5, v.z, String(h.dmg), h.kill ? "kill" : "");
    }
    if (any) {
      feel.hitstop = Math.max(feel.hitstop, 0.05);
      feel.shake = Math.max(feel.shake, 0.12);
    }
    const p = this.player;
    let y = 2.6;
    if (res.exp > 0) { this.hud.number(p.x, y, p.z, `경험 +${res.exp}`, "gain"); y += 0.4; }
    if (res.pigment > 0) { this.hud.number(p.x, y, p.z, `안료 +${res.pigment}`, "gain"); y += 0.4; }
    if (res.jade > 0) this.hud.number(p.x, y, p.z, `묵옥 +${res.jade}`, "gain");
    if (res.levelUp || res.exp > 0 || res.pigment > 0 || res.jade > 0) this.profileCheckAt = performance.now() + 700;
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
    if (this.profile.level < s.unlock) { toast(`${s.name}은(는) Lv ${s.unlock}에 익힙니다`); return; }
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
    this.hud.fade(true, ZONES[to]?.name ?? "");
    try {
      const entry = await this.api.enterZone(to, viaPortal);
      this.rebuild(entry);
    } catch (e) {
      toast(errorText(e), true);
      // step back from the gate so we don't walk straight into it again
      const p = this.player;
      const d = Math.hypot(p.x, p.z) || 1;
      p.teleport(p.x - (p.x / d) * 3, p.z - (p.z / d) * 3);
    } finally {
      window.setTimeout(() => { this.transitioning = false; this.hud.fade(false); }, 250);
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
      this.player.field = this.zone.field;
      this.zoneTags();
      this.hud.setZone(entry.zone, entry.channel);
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
      this.hud.fade(true, "다시 일어나는 중");
      const entry = await this.api.respawn();
      this.rebuild(entry);
      this.dead = false;
      this.player.revive();
      this.hud.death(false);
      const p = await attempt(this.api.loadProfile());
      if (p) this.applyProfile(p);
    } catch (e) {
      const code = errorCode(e);
      toast(code === "on_cooldown" || code === "not_ready" ? "조금만 더 기다렸다가 일어나세요" : errorText(e), true);
      this.hud.death(true, false);
    } finally {
      this.respawning = false;
      window.setTimeout(() => { this.transitioning = false; this.hud.fade(false); }, 250);
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
    inp.atk = Math.max(0, inp.atk - realDt);
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

  private slowUi(): void {
    const p = this.player;
    for (let i = 0; i < SKILLS.length; i++) this.hud.setCooldown(i, p.cd[i] / SKILLS[i].cd);
    // interaction prompt + walking into portals
    let prompt: string | null = null;
    if (!this.dead && !this.transitioning && !this.sheets.isOpen() && !this.story.isBusy()) {
      const npc = this.nearNpc();
      if (npc) prompt = `${npc.name}에게 말 걸기`;
      else {
        const gate = this.nearPortal(PORTAL_PROMPT);
        if (gate) prompt = gate.label;
        // only walking in on purpose counts (not being knocked into the gate)
        const walking = p.state === "move" && Math.hypot(p.input.mx, p.input.mz) > 0.3;
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
    // a little lower than the prototype so the top of the frame reaches the hazy horizon and the sky
    camera.position.set(this.camX + sx, 9 * k + sy, this.camZ + 14 * k);
    camera.lookAt(this.camX + sx * 0.5, 1.4 + sy * 0.5, this.camZ - 2);
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    // the painted backdrop starts where the field's far edge meets the screen
    hz.set(this.camX, 0, -(this.zone.def.radius + 11)).project(camera);
    setHorizon(Math.min(0.99, Math.max(0.45, hz.y * 0.5 + 0.5)), this.camX);
  }
}

function seenHelp(): boolean {
  try {
    if (window.localStorage.getItem("ink.help.seen")) return true;
    window.localStorage.setItem("ink.help.seen", "1");
  } catch {
    // storage blocked: just show it this time
  }
  return false;
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
  } catch (e) {
    console.error(e);
    title.busy();
    title.status("이 브라우저에서 WebGL을 켤 수 없어 화면을 그리지 못했습니다. 하드웨어 가속을 켜고 다시 열어 보세요.");
    return;
  }
  await title.waitStart();
  const api = createGameApi({ mode: "auto", adPresenter: mockAdPresenter });
  let game: Game | null = null;
  for (;;) {
    title.busy();
    try {
      title.status("먹을 가는 중… (연결)");
      await api.connect();
      title.status("기록을 펼치는 중…");
      let profile = await api.loadProfile();
      while (!profile.name) {
        title.status("처음 오셨군요. 이름을 지어 주세요.");
        const name = await title.askName("");
        title.busy();
        const p = await attempt(api.setName(name));
        if (p) profile = p;
      }
      title.status("들판으로 나가는 중…");
      game ??= new Game(api, root);
      await game.begin(profile);
      title.hide();
      if (api.mode === "local") toast("오프라인(로컬) 모드로 시작했습니다");
      return;
    } catch (e) {
      console.error(e);
      title.status(`시작하지 못했습니다 · ${errorText(e)}`);
      await title.waitStart("다시 시도");
    }
  }
}
