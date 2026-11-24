// The Verse8 game-server globals emulated in the page, so the real server code (server/src) runs here
// for offline play: $global (user state, collections, room user counts), $room (room state and room
// user state of the caller's room), $sender, $lock and $asset, plus the platform's room hooks and a
// $roomTick timer. Ported from Grove Hunters' LocalWorld.
//
// Calls run one at a time (a shared queue), which is also what makes $lock a plain pass-through here.

export type Json = Record<string, any>;

export type WorldEvent =
  | { kind: "roomState"; roomId: string; state: Json }
  | { kind: "roomUsers"; roomId: string; users: Json[] }
  | { kind: "userState"; account: string; state: Json }
  | { kind: "message"; roomId: string; to: string | null; type: string; message: unknown }
  | { kind: "userMessage"; to: string; type: string; message: unknown };

/** What survives a reload: accounts' global state and the collections (rooms are live only). */
export interface WorldSnapshot {
  users: Record<string, Json>;
  collections: Record<string, Record<string, Json>>;
  seq: number;
}

interface RoomRecord {
  state: Json;
  users: Map<string, Json>;
  members: string[];
}

type AnyFunction = (...args: unknown[]) => unknown;

interface CollectionQuery {
  filters?: { field: string; operator: string; value: unknown }[];
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

const COMPARE: Record<string, (a: any, b: any) => boolean> = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

function query(items: Json[], options: CollectionQuery = {}): Json[] {
  let found = items;
  for (const filter of options.filters ?? []) {
    const test = COMPARE[filter.operator];
    if (!test) throw new Error(`LocalWorld: unsupported filter operator ${filter.operator}`);
    found = found.filter((item) => test(item[filter.field], filter.value));
  }
  for (const o of [...(options.orderBy ?? [])].reverse()) {
    const dir = o.direction === "desc" ? -1 : 1;
    found = [...found].sort((a, b) => (a[o.field] < b[o.field] ? -dir : a[o.field] > b[o.field] ? dir : 0));
  }
  return options.limit ? found.slice(0, options.limit) : found;
}

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function merge(target: Json, patch: Json): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete target[key];
    else target[key] = copy(value);
  }
}

const GLOBAL_NAMES = ["$global", "$room", "$sender", "$lock", "$asset", "$verifyAd", "$localMode"] as const;
const NO_ROOM = "__no_room__";

// The Verse8 globals are process-wide, so every world must take turns, not just calls within one world.
let sharedQueue: Promise<unknown> = Promise.resolve();

export class LocalWorld {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly userStates = new Map<string, Json>();
  private readonly assets = new Map<string, Map<string, number>>();
  private readonly collections = new Map<string, Map<string, Json>>();
  private readonly listeners = new Set<(event: WorldEvent) => void>();
  private readonly dirtyRooms = new Set<string>();
  private readonly dirtyUsers = new Set<string>();
  private readonly dirtyAccounts = new Set<string>();
  private pendingMessages: WorldEvent[] = [];
  private seq = 0;

  constructor(private readonly server: object) {}

  subscribe(listener: (event: WorldEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): WorldSnapshot {
    const collections: Record<string, Record<string, Json>> = {};
    for (const [id, items] of this.collections) collections[id] = Object.fromEntries(items);
    return copy({ users: Object.fromEntries(this.userStates), collections, seq: this.seq });
  }

  restore(snapshot: WorldSnapshot | null | undefined): void {
    if (!snapshot || typeof snapshot !== "object") return;
    for (const [account, state] of Object.entries(snapshot.users ?? {})) this.userStates.set(account, copy(state));
    for (const [id, items] of Object.entries(snapshot.collections ?? {})) this.collections.set(id, new Map(Object.entries(copy(items))));
    this.seq = Math.max(this.seq, Number(snapshot.seq) || 0);
  }

  /** A client's remote function call. Names starting with $ (and the hooks) are the platform's. */
  call(account: string, roomId: string | null, name: string, args: unknown[] = []): Promise<unknown> {
    return this.enqueue(async () => {
      const fn = (this.server as Record<string, unknown>)[name];
      if (typeof fn !== "function" || name.startsWith("$") || name.startsWith("onRoom") || name === "constructor") {
        throw new Error(`unknown server function: ${name}`);
      }
      const result = await this.withContext(account, roomId, () => (fn as AnyFunction).apply(this.server, copy(args)));
      return copy(result);
    });
  }

  /** A platform-side call (e.g. $onItemPurchased), run as "$system" outside any room. */
  system(name: string, args: unknown[] = []): Promise<unknown> {
    return this.enqueue(async () => {
      const fn = (this.server as Record<string, unknown>)[name];
      if (typeof fn !== "function" || !name.startsWith("$")) throw new Error(`unknown platform function: ${name}`);
      const result = await this.withContext("$system", null, () => (fn as AnyFunction).apply(this.server, copy(args)));
      return copy(result);
    });
  }

  /** A client joining a room: the room lists them, then onRoomJoin runs (inside the room). */
  join(account: string, roomId: string): Promise<void> {
    return this.enqueue(async () => {
      const room = this.room(roomId);
      if (!room.members.includes(account)) room.members.push(account);
      this.dirtyRooms.add(roomId);
      await this.hook("onRoomJoin", account, roomId);
    }) as Promise<void>;
  }

  /** Leaving for good: onRoomLeave runs while the room still lists them, then they go. */
  leave(account: string, roomId: string): Promise<void> {
    return this.enqueue(async () => {
      const room = this.rooms.get(roomId);
      if (!room?.members.includes(account)) return;
      await this.hook("onRoomLeave", account, roomId);
      room.members = room.members.filter((m) => m !== account);
      this.dirtyRooms.add(roomId);
      // The last one out ends the room (Verse8 deletes its state after onRoomDestroy).
      if (room.members.length === 0) this.rooms.delete(roomId);
      this.flush();
    }) as Promise<void>;
  }

  private async hook(name: string, account: string, roomId: string): Promise<void> {
    const fn = (this.server as Record<string, unknown>)[name];
    // Hooks run as the platform, not as the player.
    if (typeof fn === "function") await this.withContext("$system", roomId, () => (fn as AnyFunction).call(this.server, roomId, account));
    else this.flush();
  }

  /** One room tick, run as the platform inside the room, deltaMs after the last. */
  tick(roomId: string, deltaMs: number): Promise<void> {
    return this.enqueue(async () => {
      const hook = (this.server as Record<string, unknown>).$roomTick;
      if (typeof hook === "function") {
        await this.withContext("$system", roomId, () => (hook as AnyFunction).call(this.server, deltaMs, roomId), true);
      }
    }) as Promise<void>;
  }

  async tickAll(deltaMs: number): Promise<void> {
    for (const [roomId, room] of [...this.rooms]) if (room.members.length > 0) await this.tick(roomId, deltaMs);
  }

  /** Ticks every room with someone in it, as Verse8 does (about every 200 ms). Returns a stop function. */
  startTicking(everyMs = 200): () => void {
    let last = Date.now();
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      const now = Date.now();
      const delta = now - last;
      last = now;
      void this.tickAll(delta).finally(() => {
        busy = false;
      });
    }, everyMs);
    return () => clearInterval(timer);
  }

  async idle(): Promise<void> {
    let seen: Promise<unknown> | null = null;
    while (seen !== sharedQueue) {
      seen = sharedQueue;
      await seen;
    }
  }

  roomState(roomId: string): Json {
    const room = this.rooms.get(roomId);
    return copy({ ...(room?.state ?? {}), roomId, $users: room ? [...room.members] : [] });
  }

  roomUsers(roomId: string): Json[] {
    return [...(this.rooms.get(roomId)?.users.entries() ?? [])].map(([account, state]) => ({ ...copy(state), account }));
  }

  userState(account: string): Json {
    return copy(this.userStates.get(account) ?? {});
  }

  private enqueue(work: () => Promise<unknown>): Promise<unknown> {
    const result = sharedQueue.then(work, work);
    sharedQueue = result.catch(() => undefined);
    return result;
  }

  private async withContext<T>(account: string, roomId: string | null, fn: () => T | Promise<T>, isTick = false): Promise<T> {
    const scope = globalThis as Record<string, unknown>;
    const saved = GLOBAL_NAMES.map((name) => scope[name]);
    const sender = { account, roomId: roomId ?? NO_ROOM, ...(isTick ? { isTick: true } : {}) };
    scope.$sender = sender;
    scope.$global = this.globalApi();
    scope.$room = this.roomApi(roomId, account);
    scope.$lock = async (_key: string, work: () => unknown) => work();
    scope.$asset = this.assetApi(account);
    // Offline there is no ad network: the local mock ad is what was watched (see ads.ts).
    scope.$verifyAd = async () => "verified";
    // the in-page server: offline-only test hooks (Server.debugFieldBoss) may run
    scope.$localMode = true;
    try {
      return await fn();
    } finally {
      GLOBAL_NAMES.forEach((name, i) => {
        if (saved[i] === undefined) delete scope[name];
        else scope[name] = saved[i];
      });
      this.flush();
    }
  }

  private room(roomId: string): RoomRecord {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { state: {}, users: new Map(), members: [] };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  private collection(id: string): Map<string, Json> {
    let items = this.collections.get(id);
    if (!items) {
      items = new Map();
      this.collections.set(id, items);
    }
    return items;
  }

  private globalApi() {
    return {
      getAllRoomIds: async () => [...this.rooms.entries()].filter(([, r]) => r.members.length > 0).map(([id]) => id),
      getRoomUserAccounts: async (roomId: string) => [...(this.rooms.get(roomId)?.members ?? [])],
      countRoomUsers: async (roomId: string) => this.rooms.get(roomId)?.members.length ?? 0,
      sendMessageToUser: (type: string, to: string, message: unknown) => {
        this.pendingMessages.push({ kind: "userMessage", to, type, message: copy(message) });
      },
      getUserState: async (user: string) => copy(this.userStates.get(user) ?? {}),
      getUserStates: async (users: string[]) => users.map((user) => ({ ...copy(this.userStates.get(user) ?? {}), account: user })),
      updateUserState: async (user: string, patch: Json) => {
        const state = this.userStates.get(user) ?? {};
        merge(state, patch);
        this.userStates.set(user, state);
        this.dirtyAccounts.add(user);
        return copy(patch);
      },
      addCollectionItem: async (collectionId: string, item: Json, options?: { id?: string }) => {
        const stored = { ...copy(item), __id: options?.id ?? `item-${++this.seq}` };
        this.collection(collectionId).set(stored.__id, stored);
        return copy(stored);
      },
      getCollectionItem: async (collectionId: string, itemId: string) => {
        const item = this.collections.get(collectionId)?.get(itemId);
        if (!item) throw new Error(`Item ${itemId} not found in collection ${collectionId}`);
        return copy(item);
      },
      updateCollectionItem: async (collectionId: string, item: Json) => {
        const stored = this.collections.get(collectionId)?.get(item.__id);
        if (!stored) throw new Error(`Item ${item.__id} not found in collection ${collectionId}`);
        merge(stored, item);
        return copy(stored);
      },
      getCollectionItems: async (collectionId: string, options?: CollectionQuery) =>
        query([...this.collection(collectionId).values()], options).map(copy),
      deleteCollectionItem: async (collectionId: string, itemId: string) => {
        if (!this.collections.get(collectionId)?.delete(itemId)) {
          throw new Error(`Item ${itemId} not found in collection ${collectionId}`);
        }
        return { __id: itemId };
      },
      countCollectionItems: async (collectionId: string, options?: CollectionQuery) =>
        query([...this.collection(collectionId).values()], options).length,
      deleteCollection: async (collectionId: string) => {
        this.collections.delete(collectionId);
        return { collectionId };
      },
    };
  }

  private assetApi(caller: string) {
    const of = (account?: string) => {
      const who = account ?? caller;
      let balances = this.assets.get(who);
      if (!balances) {
        balances = new Map();
        this.assets.set(who, balances);
      }
      return balances;
    };
    const all = (account?: string) => Object.fromEntries(of(account));
    return {
      get: async (id: string, account?: string) => of(account).get(id) ?? 0,
      getAll: async (account?: string) => all(account),
      has: async (id: string, amount: number, account?: string) => (of(account).get(id) ?? 0) >= amount,
      mint: async (id: string, amount: number, account?: string) => {
        if (!(amount > 0)) throw new Error("Amount must be positive");
        of(account).set(id, (of(account).get(id) ?? 0) + amount);
        return all(account);
      },
      burn: async (id: string, amount: number, account?: string) => {
        if (!(amount > 0)) throw new Error("Amount must be positive");
        const have = of(account).get(id) ?? 0;
        if (have < amount) throw new Error(`Insufficient ${id}: has ${have}, needs ${amount}`);
        of(account).set(id, have - amount);
        return all(account);
      },
    };
  }

  // $room as Verse8 2.0 has it: always the caller's current room.
  private roomApi(roomId: string | null, account: string) {
    const here = () => {
      if (!roomId) throw new Error("not in a room");
      return { roomId, room: this.room(roomId) };
    };
    const push = (to: string | null, type: string, message: unknown) => {
      if (roomId) this.pendingMessages.push({ kind: "message", roomId, to, type, message: copy(message) });
    };
    const updateUser = (user: string, patch: Json) => {
      const { room } = here();
      const state = room.users.get(user) ?? {};
      merge(state, patch);
      room.users.set(user, state);
      this.dirtyUsers.add(roomId!);
      return copy(patch);
    };
    return {
      getRoomState: async () => this.roomState(here().roomId),
      clearRoomState: async (fields?: string[]) => {
        const { room } = here();
        if (fields === undefined) room.state = {};
        else for (const f of fields) delete room.state[f];
        this.dirtyRooms.add(roomId!);
        return copy(room.state);
      },
      updateRoomState: async (patch: Json) => {
        const { room } = here();
        merge(room.state, patch);
        this.dirtyRooms.add(roomId!);
        return copy(patch);
      },
      getUserState: async (user: string) => copy(here().room.users.get(user) ?? {}),
      updateUserState: async (user: string, patch: Json) => updateUser(user, patch),
      getMyState: async () => copy(here().room.users.get(account) ?? {}),
      updateMyState: async (patch: Json) => updateUser(account, patch),
      getUserStates: async (users: string[]) => users.map((user) => ({ ...copy(here().room.users.get(user) ?? {}), account: user })),
      getAllUserStates: async () => [...here().room.users.entries()].map(([user, state]) => ({ ...copy(state), account: user })),
      broadcastToRoom: (type: string, message: unknown) => push(null, type, message),
      sendMessageToUser: (type: string, to: string, message: unknown) => push(to, type, message),
    };
  }

  private flush(): void {
    const events: WorldEvent[] = [];
    for (const roomId of this.dirtyRooms) events.push({ kind: "roomState", roomId, state: this.roomState(roomId) });
    for (const roomId of this.dirtyUsers) events.push({ kind: "roomUsers", roomId, users: this.roomUsers(roomId) });
    for (const account of this.dirtyAccounts) events.push({ kind: "userState", account, state: this.userState(account) });
    events.push(...this.pendingMessages);
    this.dirtyRooms.clear();
    this.dirtyUsers.clear();
    this.dirtyAccounts.clear();
    this.pendingMessages = [];
    for (const event of events) for (const listener of this.listeners) listener(event);
  }
}
