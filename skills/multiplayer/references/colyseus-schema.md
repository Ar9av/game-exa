# Colyseus Schema Reference

Reference for the Colyseus state synchronization layer used by the multiplayer skill. Covers schema decorators, collection types, synchronization guarantees, and client-side state listeners.

## Schema decorators (`@colyseus/schema`)

Colyseus uses TypeScript decorator-based schemas to define the authoritative server state. Only schema-decorated properties are synchronized to clients. Plain properties are server-local.

```ts
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string')  sessionId: string = '';
  @type('string')  name: string = 'Player';
  @type('number')  x: number = 0;
  @type('number')  y: number = 0;
  @type('number')  hp: number = 3;
  @type('number')  score: number = 0;
  @type('boolean') left: boolean = false;
  @type('boolean') right: boolean = false;
  @type('boolean') up: boolean = false;
  @type('boolean') down: boolean = false;
  @type('boolean') action: boolean = false;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string')        phase: 'waiting' | 'playing' | 'ended' = 'waiting';
  @type('number')        tick: number = 0;
}
```

### Primitive `@type` values

| Type string | JS type | Notes |
|---|---|---|
| `'string'`  | string  | UTF-8, max ~64 KB. Use for names, chat text. |
| `'number'`  | number  | 64-bit float. For integers use `'int8'`…`'int32'` / `'uint8'`…`'uint32'` to save bandwidth. |
| `'boolean'` | boolean | Packed as 1 bit in delta patch. |
| `'int8'` .. `'int32'` | number | Signed integers. `'int16'` covers –32768…32767, ideal for pixel coords at normal game scales. |
| `'uint8'` .. `'uint32'`| number | Unsigned. `'uint8'` for HP (0–255). |
| `'float32'` | number  | Single-precision float. Saves 4 bytes vs `'number'` for positions if precision ≤ 0.001. |

For this skill's `Player` schema, you can save ~30% bandwidth by changing:
```ts
@type('int16') x: number = 0;
@type('int16') y: number = 0;
@type('uint8') hp: number = 3;
@type('uint16') score: number = 0;
```

### Nested schemas

```ts
class Inventory extends Schema {
  @type('uint8') coins: number = 0;
}

class Player extends Schema {
  @type(Inventory) inventory = new Inventory();
}
```

Access on client: `player.inventory.coins` — changes delta-patched automatically.

---

## MapSchema vs ArraySchema

### `MapSchema<T>` — keyed by string

```ts
@type({ map: Player }) players = new MapSchema<Player>();

// Server: add/remove
this.state.players.set(sessionId, new Player());
this.state.players.delete(sessionId);
this.state.players.get(sessionId);

// Server: iterate
this.state.players.forEach((player, key) => { ... });
```

**Use when**: the collection is keyed by a non-sequential ID (e.g. `sessionId`). Deletions are safe: removing a key sends a single delete patch instead of shifting indexes.

### `ArraySchema<T>` — ordered by numeric index

```ts
@type([Player]) players = new ArraySchema<Player>();

// Server: add/remove
this.state.players.push(new Player());
this.state.players.splice(index, 1);

// Server: iterate
for (const player of this.state.players) { ... }
```

**Use when**: order matters (e.g. turn order in a card game, leaderboard). Insertions/deletions send index-based patches, which can be larger than MapSchema deletes if the array is long.

**Recommendation for this skill**: use `MapSchema<Player>` keyed by `sessionId`. Players join/leave at arbitrary times; MapSchema delete patches are minimal.

---

## State synchronization guarantees

- **Delivery**: Colyseus uses WebSocket (TCP), so all patches are delivered in order and reliably.
- **Consistency model**: eventual consistency. The client always sees the server's authoritative state, but with up to one network round-trip of lag.
- **Patch interval**: default 50 ms (20 Hz). Set in room options:
  ```ts
  // In onCreate():
  this.setPatchRate(50); // 50 ms = 20 Hz
  ```
  Do not lower below 50 ms for browser games — delta serialization + WebSocket framing overhead exceeds gains below that threshold.
- **Delta encoding**: Colyseus computes a binary diff of the schema state each patch interval. Only changed fields are transmitted. A `Player` with only `x` and `y` changing sends ~6–10 bytes per patch (with int16 types), not the full schema.
- **No server-to-client guarantee of frame timing**: the client receives patches asynchronously. `ColyseusClient.js` applies them via `onStateChange`, which fires whenever a new patch arrives. The Phaser scene interpolates between the last known server position and the current server target each render frame.

---

## Client-side state change listeners

All listeners are registered on the `Room` object returned by `client.joinOrCreate()` or `client.reconnect()`.

### `room.onStateChange(callback)`

Fires after every server patch is applied to the client's replicated state. The full (post-patch) state object is passed.

```js
room.onStateChange((state) => {
  // state is the full GameState mirror
  state.players.forEach((player, sessionId) => {
    console.log(sessionId, player.x, player.y);
  });
});
```

**In this skill**: `ColyseusClient._onRoomJoined()` calls `room.onStateChange` and forwards to `this._stateCallback`, which is wired to `Game._syncFromServer()`.

### `room.state.players.onAdd(callback, triggerAll?)`

Fires when a new entry is added to the MapSchema.

```js
room.state.players.onAdd((player, sessionId) => {
  console.log('player added:', sessionId);
  // player is a live reference; mutations are synced automatically
});
```

`triggerAll = true` (default) replays existing entries on registration — useful for late joiners.

### `room.state.players.onRemove(callback)`

Fires when an entry is deleted from the MapSchema.

```js
room.state.players.onRemove((player, sessionId) => {
  console.log('player left:', sessionId);
  // Destroy the RemotePlayer sprite here
});
```

### Per-field `onChange` on a schema instance

```js
player.listen('x', (newValue, prevValue) => {
  sprite.x = newValue; // or lerp toward newValue
});
```

Fine-grained alternative to polling in `onStateChange`. Use `listen` when you only care about one field (avoids iterating the full state map each patch).

### `room.onMessage(type, callback)`

For custom messages not part of the schema (chat, game events, signals):

```js
room.onMessage('chat', ({ from, text }) => {
  displayChatMessage(from, text);
});

room.onMessage('game-event', ({ kind, data }) => {
  if (kind === 'explosion') spawnParticles(data.x, data.y);
});
```

---

## Message types used by this skill

| Type | Direction | Payload | Notes |
|---|---|---|---|
| `input` | client → server | `{ left, right, up, down, action }` | Sent every 50 ms by `ColyseusClient._flushInput()` |
| `chat` | client → server | `{ text: string }` | Broadcast by server to all clients |
| `chat` | server → client | `{ from: string, text: string }` | Emitted as `net:chat` Phaser scene event |
| `peer-joined` | server → client | `{ peerId: string }` | Triggers PeerJS `callPeer()` in `VoiceChat.js` |
| `game-event` | server → all | `{ kind: string, data: object }` | General extensible event (explosions, pickups, etc.) |

---

## Example: complete GameState + Player schemas

```ts
import { Schema, MapSchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string')  sessionId: string = '';
  @type('string')  name: string = 'Player';
  @type('int16')   x: number = 0;
  @type('int16')   y: number = 0;
  @type('uint8')   hp: number = 3;
  @type('uint16')  score: number = 0;
  @type('boolean') left: boolean = false;
  @type('boolean') right: boolean = false;
  @type('boolean') up: boolean = false;
  @type('boolean') down: boolean = false;
  @type('boolean') action: boolean = false;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string')        phase: 'waiting' | 'playing' | 'ended' = 'waiting';
  @type('uint32')        tick: number = 0;
}
```

### GameRoom using the schema

```ts
import { Room, Client } from '@colyseus/core';
import { GameState, Player } from '../schemas/GameState';

export class GameRoom extends Room<GameState> {
  maxClients = 4;

  onCreate() {
    this.setState(new GameState());
    this.setPatchRate(50);                    // 20 Hz

    this.onMessage('input', (client, input) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.left   = !!input.left;
      p.right  = !!input.right;
      p.up     = !!input.up;
      p.down   = !!input.down;
      p.action = !!input.action;
    });

    this.clock.setInterval(() => this._tick(), 50);
  }

  onJoin(client: Client, opts?: { name?: string }) {
    const p = new Player();
    p.sessionId = client.sessionId;
    p.name = opts?.name ?? 'Player';
    p.x = 64 + this.state.players.size * 32;
    p.y = 64;
    this.state.players.set(client.sessionId, p);
    if (this.state.players.size >= 2) this.state.phase = 'playing';
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  private _tick() {
    const dt = 0.05;
    this.state.players.forEach((p) => {
      let vx = 0, vy = 0;
      if (p.left)  vx -= 80;
      if (p.right) vx += 80;
      if (p.up)    vy -= 80;
      if (p.down)  vy += 80;
      if (vx !== 0 && vy !== 0) {
        const len = Math.hypot(vx, vy);
        vx = vx / len * 80;
        vy = vy / len * 80;
      }
      p.x += vx * dt;
      p.y += vy * dt;
    });
    this.state.tick++;
  }
}
```

---

## References

- Official docs: https://docs.colyseus.io/colyseus/state/schema/
- `@colyseus/schema` npm: https://www.npmjs.com/package/@colyseus/schema
- `@colyseus/core` npm: https://www.npmjs.com/package/@colyseus/core
- `@colyseus/monitor` npm: https://www.npmjs.com/package/@colyseus/monitor
