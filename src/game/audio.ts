// Sound: files only (no synthesized audio). One AudioContext, created and resumed on the first user gesture.
//
//   master ─┬─ music bus ← duck ← A/B gains ← MediaElementSource ← two <audio> elements (BGM streams, never decoded)
//           ├─ sfx bus   ← per-play gain ← AudioBufferSource (short mono clips, decoded lazily and cached)
//           └─ amb bus   ← fade gain ← looping AudioBufferSource (only the current zone's 10 s bed is held)
//
// BGM tracks have an intro and a loop section (bgm/loops.json): play to `end`, jump back to `start`, checked at
// 20 Hz with setInterval. Zone changes crossfade A↔B over 1.5 s. Hidden tab: context suspended, BGM paused.
// Settings (master/music/sfx 0–100, mute) persist in localStorage "ink.audio". Ambience follows 효과음 at AMB_MIX.

const BASE = "./assets/audio/";
const BGM_FADE = 1.5;
const AMB_FADE = 0.4;
const HEAR_RANGE = 22;
const MAX_VOICES = 4;
const MIN_GAP_MS = 40;
const LOOP_EPS = 0.03;

export type BgmTrack = "title" | "village" | "bamboo" | "pond" | "peak" | "kiln" | "temple" | "censer";
export type SfxName =
  | "swing-1" | "swing-2" | "swing-3-spin" | "hit-ink" | "kill-burst" | "roll" | "resisted" | "player-hurt"
  | "skill-wave" | "skill-fire" | "skill-earth" | "skill-wind" | "skill-ink"
  | "monster-slam" | "monster-spit" | "levelup" | "quest-done"
  | "enhance-charge" | "enhance-success" | "enhance-fail" | "enhance-destroy"
  | "ui-click" | "ui-open" | "dialogue-next" | "pickup" | "potion" | "portal" | "death" | "respawn"
  // chapter 2
  | "jar-hop" | "jar-break" | "crow-caw" | "ash-impact" | "monk-staff" | "stone-slam" | "armor-clunk" | "glaze-crack"
  | "boss-windup" | "boss-slam-bronze" | "boss-fade" | "lantern-ignite" | "voice-bleed";

export const SKILL_SFX: readonly SfxName[] = ["skill-wave", "skill-fire", "skill-earth", "skill-wind", "skill-ink"];
const SWINGS: readonly SfxName[] = ["swing-1", "swing-2", "swing-3-spin"];
const COMBAT_SET: readonly SfxName[] = ["swing-1", "swing-2", "swing-3-spin", "hit-ink", "kill-burst", "roll", "resisted", "player-hurt", "ui-click", "ui-open"];
/** sounds that get a slight random pitch so repeats don't sound identical */
const VARY = new Set<SfxName>(["swing-1", "swing-2", "swing-3-spin", "hit-ink", "kill-burst", "resisted", "jar-hop", "jar-break", "crow-caw", "ash-impact", "monk-staff", "armor-clunk"]);
/** per-sound level trims (the clips are loudness-normalized; these only set the mix) */
const TRIM: Partial<Record<SfxName, number>> = { "ui-click": 0.45, "dialogue-next": 0.4, "ui-open": 0.55, "swing-1": 0.7, "swing-2": 0.7, "swing-3-spin": 0.8, "hit-ink": 0.75, roll: 0.6 };

const AMB_OF: Record<string, string> = {
  village: "amb-village", bamboo: "amb-bamboo", pond: "amb-pond", peak: "amb-rain", kiln: "amb-kiln", temple: "amb-temple", censer: "amb-censer",
};
const ZONE_BGM: Record<string, BgmTrack> = { village: "village", bamboo: "bamboo", pond: "pond", peak: "peak", kiln: "kiln", temple: "temple", censer: "censer" };

export interface AudioSettings { master: number; music: number; sfx: number; muted: boolean }
const DEFAULTS: AudioSettings = { master: 80, music: 60, sfx: 80, muted: false };
/** ambience level as a share of the 효과음 slider (no slider of its own) */
const AMB_MIX = 0.6;
const STORE = "ink.audio";

interface Deck { el: HTMLAudioElement; gain: GainNode; track: BgmTrack | null }

class AudioSystem {
  readonly settings: AudioSettings = { ...DEFAULTS };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private decks: Deck[] = [];
  private active = 0;
  private wantTrack: BgmTrack | null = null;
  private loops: Partial<Record<BgmTrack, { start: number; end: number }>> = {};
  private fadeTimer = 0;
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private readonly loading = new Map<SfxName, Promise<AudioBuffer | null>>();
  private readonly voices = new Map<SfxName, number>();
  private readonly lastAt = new Map<SfxName, number>();
  private swingVoices = 0;
  private listenX = 0;
  private listenZ = 0;
  // ambience: only the current zone's bed is held
  private ambZone = "";
  private ambSrc: AudioBufferSourceNode | null = null;
  private ambGain: GainNode | null = null;
  private ambToken = 0;
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const raw = window.localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<AudioSettings> & { amb?: unknown };
        // the old 주변 소리 slider is gone: drop its stored value
        if ("amb" in saved) { delete saved.amb; window.localStorage.setItem(STORE, JSON.stringify({ ...this.settings, ...saved })); }
        Object.assign(this.settings, saved);
      }
    } catch {
      // storage blocked or bad JSON: defaults
    }
  }

  /** Arms the first-gesture unlock. Nothing is created or played before a tap, click or key. */
  arm(): void {
    const once = () => {
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
      window.removeEventListener("touchend", once, true);
      this.unlock();
    };
    window.addEventListener("pointerdown", once, true);
    window.addEventListener("keydown", once, true);
    window.addEventListener("touchend", once, true);
    document.addEventListener("visibilitychange", () => this.onVisibility());
    // every tablet button clicks (one delegated listener)
    document.addEventListener("click", (e) => {
      const t = e.target as Element | null;
      if (t && t.closest(".btn")) this.play("ui-click");
    }, true);
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  private unlock(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.musicBus.connect(this.duckGain).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);
    this.applySettings();
    for (let i = 0; i < 2; i++) {
      const el = document.createElement("audio");
      el.crossOrigin = "anonymous"; // before any src
      el.preload = "auto";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.musicBus);
      this.decks.push({ el, gain, track: null });
    }
    void ctx.resume();
    // iOS: an element only plays later if it played once inside a gesture. The idle deck is unlocked
    // with the wanted track at gain 0; the active one starts for real below.
    const idle = this.decks[1];
    idle.el.src = `${BASE}bgm/${this.wantTrack ?? "title"}.mp3`;
    idle.el.play().then(() => idle.el.pause()).catch(() => undefined);
    void fetch(`${BASE}bgm/loops.json`).then((r) => r.json()).then((j: typeof this.loops) => { this.loops = j; }).catch(() => undefined);
    window.setInterval(() => this.loopTick(), 50);
    if (this.wantTrack) { const t = this.wantTrack; this.wantTrack = null; this.music(t); }
    if (this.ambZone) { const z = this.ambZone; this.ambZone = ""; this.ambience(z); }
    for (const n of COMBAT_SET) void this.load(n);
  }

  private onVisibility(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      void ctx.suspend();
      for (const d of this.decks) d.el.pause();
    } else {
      void ctx.resume();
      const d = this.decks[this.active];
      if (d.track) void d.el.play().catch(() => undefined);
    }
  }

  /* ---------- settings ---------- */
  set(patch: Partial<AudioSettings>): void {
    Object.assign(this.settings, patch);
    try { window.localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* not persisted */ }
    this.applySettings();
    for (const f of this.listeners) f();
  }

  toggleMute(): boolean {
    this.set({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  private applySettings(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus || !this.ambBus) return;
    const s = this.settings, t = ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : (s.master / 100) ** 2, t, 0.03);
    this.musicBus.gain.setTargetAtTime((s.music / 100) ** 2, t, 0.03);
    this.sfxBus.gain.setTargetAtTime((s.sfx / 100) ** 2, t, 0.03);
    this.ambBus.gain.setTargetAtTime(((s.sfx * AMB_MIX / 100) ** 2) * 0.5, t, 0.03);
  }

  /* ---------- music ---------- */
  /** Title music on the title / creation / first loading; the zone's track in the field. */
  music(track: BgmTrack): void {
    const ctx = this.ctx;
    if (!ctx) { this.wantTrack = track; return; }
    const cur = this.decks[this.active];
    if (cur.track === track) return;
    const nextIdx = cur.track ? 1 - this.active : this.active;
    const next = this.decks[nextIdx], prev = this.decks[1 - nextIdx];
    const t = ctx.currentTime;
    next.track = track;
    const src = `${BASE}bgm/${track}.mp3`;
    if (!next.el.src.endsWith(src.slice(1))) next.el.src = src;
    next.el.currentTime = 0;
    void next.el.play().catch(() => undefined);
    next.gain.gain.cancelScheduledValues(t);
    next.gain.gain.setValueAtTime(next.gain.gain.value, t);
    next.gain.gain.linearRampToValueAtTime(1, t + BGM_FADE);
    if (prev !== next && prev.track) {
      prev.gain.gain.cancelScheduledValues(t);
      prev.gain.gain.setValueAtTime(prev.gain.gain.value, t);
      prev.gain.gain.linearRampToValueAtTime(0, t + BGM_FADE);
      const stop = prev;
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => { if (this.decks[this.active] !== stop) { stop.el.pause(); stop.track = null; } }, BGM_FADE * 1000 + 100);
    }
    this.active = nextIdx;
  }

  musicForZone(zone: string): void {
    this.music(ZONE_BGM[zone] ?? "village");
  }

  /** Lower the music under the death screen, or bring it back. */
  duck(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckGain) return;
    this.duckGain.gain.setTargetAtTime(on ? 0.25 : 1, ctx.currentTime, 0.25);
  }

  private loopTick(): void {
    for (const d of this.decks) {
      if (!d.track || d.el.paused) continue;
      const l = this.loops[d.track];
      if (l && d.el.currentTime >= l.end - LOOP_EPS) d.el.currentTime = l.start;
      else if (!l && d.el.ended) { d.el.currentTime = 0; void d.el.play().catch(() => undefined); }
    }
  }

  /* ---------- ambience ---------- */
  ambience(zone: string): void {
    const name = AMB_OF[zone];
    if (zone === this.ambZone) return;
    this.ambZone = zone;
    const ctx = this.ctx;
    if (!ctx || !this.ambBus) return;
    const token = ++this.ambToken;
    // fade out and let go of the old bed (its buffer goes with the node)
    const oldSrc = this.ambSrc, oldGain = this.ambGain;
    this.ambSrc = null;
    this.ambGain = null;
    if (oldSrc && oldGain) {
      const t = ctx.currentTime;
      oldGain.gain.cancelScheduledValues(t);
      oldGain.gain.setValueAtTime(oldGain.gain.value, t);
      oldGain.gain.linearRampToValueAtTime(0, t + AMB_FADE);
      oldSrc.stop(t + AMB_FADE + 0.02);
      oldSrc.onended = () => { oldSrc.disconnect(); oldGain.disconnect(); oldSrc.buffer = null; };
    }
    if (!name) return;
    void this.fetchBuffer(`${BASE}sfx/${name}.mp3`).then((buf) => {
      if (!buf || token !== this.ambToken || !this.ctx || !this.ambBus) return;
      const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf;
      src.loop = true;
      src.connect(g).connect(this.ambBus);
      src.start();
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(1, c.currentTime + AMB_FADE);
      this.ambSrc = src;
      this.ambGain = g;
    });
  }

  /* ---------- effects ---------- */
  /** Where the listener stands (the local player); positional sounds fade with distance from here. */
  listen(x: number, z: number): void {
    this.listenX = x;
    this.listenZ = z;
  }

  /**
   * Play a clip. With a position it fades with distance (silent past ~22 m). `remote` marks other players'
   * swings, which are skipped while more than six swings already sound.
   */
  play(name: SfxName, x?: number, z?: number, vol = 1, remote = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== "running") return;
    let v = vol * (TRIM[name] ?? 1);
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.listenX, z - this.listenZ);
      if (d >= HEAR_RANGE) return;
      const k = 1 - d / HEAR_RANGE;
      v *= k * k;
    }
    if (v < 0.01) return;
    const swing = SWINGS.includes(name);
    if (remote && swing && this.swingVoices > 6) return;
    const now = performance.now();
    if ((this.voices.get(name) ?? 0) >= MAX_VOICES || now - (this.lastAt.get(name) ?? -1e9) < MIN_GAP_MS) return;
    const buf = this.buffers.get(name);
    if (!buf) {
      // first use: load now, and play it if it arrives quickly enough to still fit the moment
      void this.load(name).then((b) => { if (b && performance.now() - now < 250) this.play(name, x, z, vol, remote); });
      return;
    }
    this.lastAt.set(name, now);
    this.voices.set(name, (this.voices.get(name) ?? 0) + 1);
    if (swing) this.swingVoices++;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    if (VARY.has(name)) src.playbackRate.value = 0.95 + Math.random() * 0.1;
    g.gain.value = v;
    src.connect(g).connect(this.sfxBus);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      if (swing) this.swingVoices = Math.max(0, this.swingVoices - 1);
    };
    src.start();
  }

  private load(name: SfxName): Promise<AudioBuffer | null> {
    const have = this.buffers.get(name);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(name);
    if (!p) {
      p = this.fetchBuffer(`${BASE}sfx/${name}.mp3`).then((b) => { if (b) this.buffers.set(name, b); this.loading.delete(name); return b; });
      this.loading.set(name, p);
    }
    return p;
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Decoded bytes held (sfx cache + the ambience bed), for checks. */
  memoryBytes(): { sfx: number; amb: number } {
    let sfx = 0;
    for (const b of this.buffers.values()) sfx += b.length * b.numberOfChannels * 4;
    const a = this.ambSrc?.buffer;
    return { sfx, amb: a ? a.length * a.numberOfChannels * 4 : 0 };
  }
}

export const audio = new AudioSystem();
