# PeerJS Voice/Video Reference

Reference for the PeerJS WebRTC layer used by `src/net/VoiceChat.js`. Covers the PeerJS API, getUserMedia, signaling, call setup, and rendering video inside or alongside a Phaser scene.

## PeerJS API overview

PeerJS wraps WebRTC's `RTCPeerConnection` and `RTCDataChannel` behind a simpler abstraction. All signaling (offer/answer/ICE exchange) is handled by a PeerJS signaling server — either the PeerJS cloud server (`peerjs.com`) or a self-hosted `peer-server`.

### Installation

```bash
npm install peerjs
```

```js
import { Peer } from 'peerjs';
```

Or via CDN (no build step):

```html
<script src="https://unpkg.com/peerjs@1/dist/peerjs.min.js"></script>
<!-- exposes window.Peer -->
```

---

## `Peer` — the main class

```js
// Connect to PeerJS cloud server with a specific ID
const peer = new Peer(myId, { /* optional config */ });

// Connect to a self-hosted PeerServer
const peer = new Peer(myId, {
  host: 'your-server.example.com',
  port: 443,
  path: '/peerjs',
  secure: true,
});

// Auto-assigned ID (cloud server)
const peer = new Peer();
peer.on('open', (id) => { console.log('My peer ID:', id); });
```

### Key events on `Peer`

| Event | Callback signature | When it fires |
|---|---|---|
| `open` | `(id: string)` | PeerJS server assigned an ID and connection is ready |
| `call` | `(call: MediaConnection)` | Another peer called this peer |
| `connection` | `(conn: DataConnection)` | Another peer opened a data connection |
| `error` | `(err: Error)` | Network, signaling, or browser error |
| `close` | `()` | Peer destroyed |
| `disconnected` | `()` | Lost server connection; may reconnect via `peer.reconnect()` |

---

## `DataConnection` — bidirectional data channel

```js
// Initiator
const conn = peer.connect(remotePeerId, { reliable: true });
conn.on('open', () => conn.send({ type: 'hello', payload: 'world' }));
conn.on('data', (data) => console.log('received:', data));

// Receiver (inside peer.on('connection'))
peer.on('connection', (conn) => {
  conn.on('data', (data) => { /* handle */ });
  conn.send({ type: 'ack' });
});
```

`DataConnection` is not used by `VoiceChat.js` (the Colyseus room handles game messaging), but is available for custom peer-to-peer features (e.g. direct file transfer, custom sync).

---

## `MediaConnection` — audio/video streams

### Get local media stream first

```js
// Audio + video
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

// Audio only (fallback if camera not available)
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

// Specific constraints
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true },
  video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { max: 15 } },
});
```

Always catch errors — the user may deny permission or have no camera:

```js
let localStream;
try {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
} catch (err) {
  // err.name can be 'NotAllowedError', 'NotFoundError', 'OverconstrainedError'
  console.warn('camera/mic denied:', err.name);
  // Try audio-only fallback
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (audioErr) {
    console.error('audio also denied — voice chat unavailable');
  }
}
```

### Initiating a call (caller side)

```js
// peer = initialized Peer instance, localStream = getUserMedia result
const call = peer.call(remotePeerId, localStream, {
  metadata: { name: 'Player1', sessionId: mySessionId },
});

call.on('stream', (remoteStream) => {
  attachVideoElement(remotePeerId, remoteStream);
});

call.on('close', () => {
  detachVideoElement(remotePeerId);
});

call.on('error', (err) => {
  console.error('call error:', err);
});
```

### Answering a call (receiver side)

```js
peer.on('call', (call) => {
  call.answer(localStream);   // send our stream back

  call.on('stream', (remoteStream) => {
    attachVideoElement(call.peer, remoteStream);
  });

  call.on('close', () => {
    detachVideoElement(call.peer);
  });
});
```

### Closing a call

```js
call.close();
// Fires 'close' event on both sides
```

---

## Signaling: cloud server vs self-hosted

### PeerJS cloud server (peerjs.com)

Default when no config is provided. Free, rate-limited, suitable for development and game-jam scale (< 50 concurrent connections).

```js
const peer = new Peer(myId);
// or
const peer = new Peer(); // auto ID
```

Limitations: public peer IDs may collide; cloud server can be slow in some regions; not suitable for production.

### Self-hosted `peer-server`

```bash
npm install -g peer
peerjs --port 9000 --path /peerjs
```

Or programmatically (inside the Colyseus server's `index.ts`):

```ts
import { PeerServer } from 'peer';

const peerServer = PeerServer({ port: 9001, path: '/peerjs' });
peerServer.on('connection', (client) => {
  console.log('peer connected:', client.getId());
});
```

Client config:

```js
const peer = new Peer(myId, {
  host: 'localhost',
  port: 9001,
  path: '/peerjs',
  secure: false,
});
```

### TURN/STUN for internet play

PeerJS uses STUN by default (Google's public servers). For peers behind symmetric NAT or strict firewalls, TURN relay is required:

```js
const peer = new Peer(myId, {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:your-turn-server.example.com:3478',
        username: 'user',
        credential: 'password',
      },
    ],
  },
});
```

Free TURN options: Twilio (free tier), Metered (free tier), or self-host `coturn`.

---

## Connecting two players: initiator/joiner protocol

In multiplayer games, one peer must initiate the call. The Colyseus server coordinates this via the `peer-joined` message:

### Server-side (GameRoom.ts)

```ts
// When a new player joins, tell ALL existing players about the newcomer's peer ID
onJoin(client: Client, opts?: { name?: string }) {
  // ... add to state.players ...
  this.broadcast('peer-joined', { peerId: client.sessionId }, { except: client });
}
```

### Client-side (ColyseusClient.js + VoiceChat.js)

```js
// In ColyseusClient._onRoomJoined():
room.onMessage('peer-joined', (msg) => {
  this._scene.events.emit('net:peer-joined', msg);
});

// In VoiceChat._init():
this._scene.events.on('net:peer-joined', ({ peerId }) => {
  if (peerId !== this._sessionId) this.callPeer(peerId);
});
```

Result: every existing player calls the newcomer. The newcomer auto-answers via `peer.on('call')`. No explicit "who calls whom" coordination needed — all existing players call; the newcomer answers all.

---

## Rendering video in a Phaser scene

Phaser does not render HTML `<video>` elements on the canvas natively. Two approaches:

### Approach A: DOM overlay (recommended for game UI)

Mount `<video>` elements as a fixed-position `<div>` overlay on top of the canvas. The canvas handles game rendering; the overlay handles video tiles. This is what `VoiceChat.js` does.

```js
const container = document.createElement('div');
Object.assign(container.style, {
  position: 'fixed',
  bottom: '8px',
  right: '8px',
  display: 'flex',
  gap: '4px',
  zIndex: '999',
  pointerEvents: 'none',  // don't block game input
});
document.body.appendChild(container);

function mountVideo(id, stream, muted = false) {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;  // mute own preview to prevent echo
  Object.assign(video.style, {
    width: '80px',
    height: '60px',
    borderRadius: '4px',
    objectFit: 'cover',
    border: '1px solid #444',
  });
  container.appendChild(video);
}
```

### Approach B: Phaser `this.add.dom()` (embed in scene)

Phaser's DOM element support can embed arbitrary HTML inside the scene coordinate space. Useful for in-game HUD elements that scroll with the camera.

```js
// In create() — requires { dom: { createContainer: true } } in Phaser config
const videoEl = document.createElement('video');
videoEl.srcObject = remoteStream;
videoEl.autoplay = true;
videoEl.muted = false;
videoEl.style.width = '80px';
videoEl.style.height = '60px';

// Place at world position (e.g. above a player sprite)
const domEl = this.add.dom(player.x, player.y - 50, videoEl);
domEl.setScrollFactor(1);  // scroll with world
```

Note: `add.dom()` requires `parent: 'body'` or a valid parent in the Phaser config, and the game canvas must not have `pointer-events: none`.

---

## Cleanup on scene destroy

All PeerJS resources must be freed when the Phaser scene shuts down to prevent memory leaks and dangling WebRTC connections.

```js
// In VoiceChat constructor:
scene.events.once('shutdown', () => this.destroy());
scene.events.once('destroy',  () => this.destroy());

// In VoiceChat.destroy():
destroy() {
  // Close all active calls
  this._calls.forEach((call) => call.close());
  this._calls.clear();

  // Remove video elements from DOM
  this._videoEls.forEach((el) => el.remove());
  this._videoEls.clear();

  // Stop all local media tracks
  if (this._localStream) {
    this._localStream.getTracks().forEach((t) => t.stop());
    this._localStream = null;
  }

  // Destroy PeerJS instance (closes signaling server connection)
  if (this._peer) {
    this._peer.destroy();
    this._peer = null;
  }

  // Remove container div
  if (this._videoContainer) {
    this._videoContainer.remove();
    this._videoContainer = null;
  }
}
```

`getTracks().forEach(t => t.stop())` is critical — without it, the browser continues capturing the camera/mic even after the game scene is gone, keeping the indicator light on.

---

## Common pitfalls

| Issue | Cause | Fix |
|---|---|---|
| Remote video black/no audio | `video.autoplay` not set, or browser autoplay policy | Set `video.autoplay = true; video.muted = false` and ensure a user gesture occurred before play |
| Echo on local audio | Local preview not muted | Always set `video.muted = true` for own stream |
| `NotAllowedError` on getUserMedia | User denied permission or HTTPS required | Show a "grant microphone" prompt; ensure HTTPS in production (getUserMedia blocked on HTTP except localhost) |
| Peers can't connect | Symmetric NAT without TURN | Add TURN server to `iceServers` config |
| PeerJS ID collision | Two players get same peer ID | Use Colyseus `sessionId` as peer ID — it's already guaranteed unique by the server |
| Call hangs after peer leaves | `call.on('close')` not handled | Always register `call.on('close', () => detachVideoElement(peerId))` |
| Memory leak | `getTracks().stop()` not called on scene destroy | Always call `localStream.getTracks().forEach(t => t.stop())` in destroy |

---

## References

- PeerJS docs: https://peerjs.com/docs/
- PeerJS GitHub: https://github.com/peers/peerjs
- PeerServer (self-hosted signaling): https://github.com/peers/peerjs-server
- WebRTC getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- coturn (self-hosted TURN): https://github.com/coturn/coturn
