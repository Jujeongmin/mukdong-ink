// What both GameApi implementations share: the calls, the zone/room flow (enterZone → join the room →
// arrive), the subscriptions pushed to the game's callbacks and the pose throttle. Each implementation
// supplies a Link (how calls and room subscriptions reach the server) plus ads and the shop.

import type { Pose, RoomPlayer } from "../shared/types";
import type { AttackReq, EnhanceResult, GachaResult, GameApi, HitResult, ProfileView, RoomView, SkillReq, ZoneEntry } from "./api";
import { readChatLine, type ChatMessage } from "../shared/chat";
import type { RankBoard, RankView } from "../shared/rank";
import { sleep } from "./errors";
import { membersOf, playersOf, profileOf, roomViewOf } from "./feed";
import { PoseThrottle } from "./poseThrottle";

export type Json = Record<string, unknown>;

export interface Link {
  call<T>(name: string, args?: unknown[]): Promise<T>;
  /** Fire and forget (no answer awaited, failures dropped). */
  send(name: string, args?: unknown[]): void;
  joinRoom(roomId: string): Promise<void>;
  watchRoom(roomId: string, onState: (state: Json) => void, onUsers: (users: Json[]) => void, onChat?: (line: unknown) => void): () => void;
  watchProfile(onState: (state: Json) => void): () => void;
}

// Joining a room is tried this many times, waiting this much longer before each retry (the room
// servers can be away for a few seconds at a time; Grove Hunters' numbers).
const JOIN_ATTEMPTS = 7;
const JOIN_RETRY_MS = 900;

export abstract class BaseGameApi implements GameApi {
  abstract readonly mode: "verse8" | "local";
  abstract readonly account: string;
  abstract connect(): Promise<void>;
  abstract watchAdForJade(): Promise<ProfileView | null>;
  abstract buyJade(productId: string): Promise<void>;

  protected link: Link | null = null;
  protected entry: ZoneEntry | null = null;
  private readonly roomCbs = new Set<(room: RoomView) => void>();
  private readonly playerCbs = new Set<(players: Record<string, RoomPlayer>) => void>();
  private readonly profileCbs = new Set<(p: ProfileView) => void>();
  private readonly chatCbs = new Set<(line: ChatMessage) => void>();
  // Lines already handed out (room state and the room message both bring each one).
  private readonly chatSeen = new Set<string>();
  private roomOff: (() => void) | null = null;
  private profileOff: (() => void) | null = null;
  private members: string[] | null = null;
  private users: Json[] = [];
  private lastRoom: RoomView | null = null;
  private lastPlayers: Record<string, RoomPlayer> | null = null;
  private lastProfile: ProfileView | null = null;
  // Bumped on every room change, so a slow rejoin does not undo a newer move.
  private generation = 0;
  protected readonly poses = new PoseThrottle((pose) => this.link?.send("reportPose", [pose]));

  protected need(): Link {
    if (!this.link) throw new Error("not_ready");
    return this.link;
  }

  protected call<T>(name: string, args: unknown[] = []): Promise<T> {
    return this.need().call<T>(name, args);
  }

  /** Starts the profile subscription (call once the link is up, and again after it was remade). */
  protected watchProfile(): void {
    this.profileOff?.();
    this.profileOff = this.need().watchProfile((state) => {
      const p = profileOf(this.account, state);
      if (p) this.pushProfile(p);
    });
  }

  private pushProfile(p: ProfileView): ProfileView {
    this.lastProfile = p;
    for (const cb of this.profileCbs) cb(p);
    return p;
  }

  private viewed(p: ProfileView): ProfileView {
    return this.pushProfile(p);
  }

  /** The profile last pushed or answered (null before loadProfile). */
  get profile(): ProfileView | null {
    return this.lastProfile;
  }

  async loadProfile(): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("loadProfile"));
  }
  async setName(name: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("setName", [name]));
  }
  async createCharacter(name: string, scarf: number | null, sash: number | null): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("createCharacter", [name, scarf, sash]));
  }
  async trainSkill(skill: number): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("trainSkill", [skill]));
  }
  async enhance(itemId: string, useProtect: boolean): Promise<EnhanceResult> {
    const result = await this.call<EnhanceResult>("enhance", [itemId, useProtect]);
    this.viewed(result.profile);
    return result;
  }
  async buyProtect(count: number): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("buyProtect", [count]));
  }

  async enterZone(zone: string, viaPortal?: string): Promise<ZoneEntry> {
    const entry = await this.call<ZoneEntry>("enterZone", viaPortal === undefined ? [zone] : [zone, viaPortal]);
    return this.moveTo(entry);
  }

  async respawn(): Promise<ZoneEntry> {
    return this.moveTo(await this.call<ZoneEntry>("respawn"));
  }

  rankings(board: RankBoard): Promise<RankView> {
    return this.call("rankings", [board]);
  }
  channelList(): Promise<{ current: number; players: number[] }> {
    return this.call("channelList");
  }

  async changeChannel(channel: number): Promise<ZoneEntry> {
    return this.moveTo(await this.call<ZoneEntry>("changeChannel", [channel]));
  }

  /** Joins the room the server picked and stands you in it; the room's feed then goes to the callbacks. */
  protected async moveTo(entry: ZoneEntry): Promise<ZoneEntry> {
    const mine = ++this.generation;
    this.poses.stop();
    this.unlisten();
    this.entry = null;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.need().joinRoom(entry.roomId);
        break;
      } catch (error) {
        const terminal = (error as { terminal?: unknown } | null)?.terminal === true;
        if (terminal || attempt >= JOIN_ATTEMPTS) throw error;
        await sleep(JOIN_RETRY_MS * attempt);
      }
    }
    const arrived = await this.call<ZoneEntry>("arrive");
    if (mine !== this.generation) return arrived;
    this.entry = arrived;
    this.listen(arrived.roomId);
    this.poses.start();
    return arrived;
  }

  /** The room connection was remade: its subscriptions are made again. */
  protected relisten(): void {
    if (this.entry) this.listen(this.entry.roomId);
  }

  /** The platform gave the room up: joined again, where you stood. */
  protected async rejoin(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    try {
      await this.moveTo(entry);
    } catch {
      // The next enterZone/respawn from the game starts over.
    }
  }

  private listen(roomId: string): void {
    this.unlisten();
    // Chat is live only: a new room starts with nothing remembered.
    this.chatSeen.clear();
    this.members = null;
    this.users = [];
    this.roomOff = this.need().watchRoom(
      roomId,
      (state) => {
        this.members = membersOf(state);
        const view = roomViewOf(state);
        this.lastRoom = view;
        for (const cb of this.roomCbs) cb(view);
        this.pushPlayers();
      },
      (users) => {
        this.users = users;
        this.pushPlayers();
      },
      (raw) => {
        const line = readChatLine(raw);
        if (line) this.pushChat([line]);
      },
    );
  }

  private pushChat(lines: ChatMessage[]): void {
    const fresh = lines.filter((l) => !this.chatSeen.has(l.id)).sort((a, b) => a.at - b.at);
    for (const line of fresh) {
      this.chatSeen.add(line.id);
      for (const cb of this.chatCbs) cb(line);
    }
    // Ids are kept only to drop the second copy of your own line (the answer and the broadcast): a few will do.
    if (this.chatSeen.size > 64) {
      const keep = [...this.chatSeen].slice(-16);
      this.chatSeen.clear();
      for (const id of keep) this.chatSeen.add(id);
    }
  }

  async chatSay(text: string): Promise<ChatMessage> {
    const line = await this.call<ChatMessage>("chatSay", [text]);
    this.pushChat([line]);
    return line;
  }

  onChat(cb: (line: ChatMessage) => void): () => void {
    this.chatCbs.add(cb);
    return () => {
      this.chatCbs.delete(cb);
    };
  }

  private pushPlayers(): void {
    const players = playersOf(this.users, this.members);
    this.lastPlayers = players;
    for (const cb of this.playerCbs) cb(players);
  }

  private unlisten(): void {
    this.roomOff?.();
    this.roomOff = null;
    this.lastRoom = null;
    this.lastPlayers = null;
  }

  reportPose(pose: Pose): void {
    if (this.entry) this.poses.offer(pose);
  }

  async attack(req: AttackReq): Promise<HitResult> {
    return this.afterHit(await this.call<HitResult>("attack", [req]));
  }
  async castSkill(req: SkillReq): Promise<HitResult> {
    return this.afterHit(await this.call<HitResult>("castSkill", [req]));
  }
  /** A kill changed exp/currency/quests on the server: push the fresh profile to onProfile listeners. */
  private afterHit(r: HitResult): HitResult {
    if (r.exp || r.pigment || r.jade || r.levelUp) void this.loadProfile().catch(() => undefined);
    return r;
  }
  async usePotion(): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("usePotion"));
  }
  async buyPotions(count: number): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("buyPotions", [count]));
  }
  async equip(itemId: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("equip", [itemId]));
  }
  async dye(target: "sash" | "scarf", hex: number | null): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("dye", [target, hex]));
  }
  async pullGacha(n: 1 | 10): Promise<GachaResult & { profile: ProfileView }> {
    const result = await this.call<GachaResult & { profile: ProfileView }>("pullGacha", [n]);
    this.viewed(result.profile);
    return result;
  }
  async talk(npcId: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("talk", [npcId]));
  }
  async acceptMain(npcId: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("acceptMain", [npcId]));
  }
  async claimMain(npcId?: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("claimMain", npcId === undefined ? [] : [npcId]));
  }
  async claimDaily(index: number): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("claimDaily", [index]));
  }
  async claimSub(): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("claimSub", []));
  }
  async claimDailyAll(): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("claimDailyAll", []));
  }
  protected async claimAd(requestId: string): Promise<ProfileView> {
    return this.viewed(await this.call<ProfileView>("claimAdReward", [requestId]));
  }

  onRoom(cb: (room: RoomView) => void): () => void {
    this.roomCbs.add(cb);
    if (this.lastRoom) cb(this.lastRoom);
    return () => {
      this.roomCbs.delete(cb);
    };
  }
  onPlayers(cb: (players: Record<string, RoomPlayer>) => void): () => void {
    this.playerCbs.add(cb);
    if (this.lastPlayers) cb(this.lastPlayers);
    return () => {
      this.playerCbs.delete(cb);
    };
  }
  onProfile(cb: (p: ProfileView) => void): () => void {
    this.profileCbs.add(cb);
    if (this.lastProfile) cb(this.lastProfile);
    return () => {
      this.profileCbs.delete(cb);
    };
  }
}
