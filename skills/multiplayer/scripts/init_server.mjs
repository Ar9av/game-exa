#!/usr/bin/env node
// Sets up the Colyseus multiplayer server inside a gameforge project.
// Usage: node init_server.mjs <project-dir> [--port 2567] [--voice] [--lobby]
import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const projectDirArg = args.find((a) => !a.startsWith('--'));
if (!projectDirArg) {
  console.error('usage: init_server.mjs <project-dir> [--port 2567] [--voice] [--lobby]');
  process.exit(2);
}

const projectDir = resolve(process.cwd(), projectDirArg);
const portArg = args[args.indexOf('--port') + 1];
const port = portArg && !portArg.startsWith('--') ? parseInt(portArg, 10) : 2567;
const withVoice = args.includes('--voice');
const withLobby = args.includes('--lobby');

// ── helpers ────────────────────────────────────────────────────────────────

async function write(filePath, content) {
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  console.error(`  wrote ${filePath.replace(projectDir + '/', '')}`);
}

function log(msg) {
  console.error(msg);
}

// ── read game-state ────────────────────────────────────────────────────────

const statePath = join(projectDir, 'game-state.json');
if (!existsSync(statePath)) {
  console.error(`game-state.json not found in ${projectDir} — run gameforge init first`);
  process.exit(3);
}

const state = JSON.parse(await readFile(statePath, 'utf8'));
const genre = state.genre ?? 'top-down-adventure';
const projectName = state.name ?? 'game';

log(`\ngamewright multiplayer — project: ${projectName}  genre: ${genre}  port: ${port}`);
log('─'.repeat(60));

// ── server/package.json ────────────────────────────────────────────────────

const serverPackageJson = {
  name: `${projectName}-server`,
  version: '0.1.0',
  private: true,
  type: 'commonjs',
  scripts: {
    build: 'tsc',
    dev: 'ts-node-dev --respawn --transpile-only src/index.ts',
    start: 'node dist/index.js',
  },
  dependencies: {
    '@colyseus/core': '^0.15.0',
    '@colyseus/monitor': '^0.15.0',
    '@colyseus/schema': '^2.0.0',
    colyseus: '^0.15.0',
    cors: '^2.8.5',
    express: '^4.18.2',
  },
  devDependencies: {
    '@types/cors': '^2.8.13',
    '@types/express': '^4.17.21',
    '@types/node': '^20.0.0',
    'ts-node-dev': '^2.0.0',
    typescript: '^5.3.0',
  },
};

await write(join(projectDir, 'server', 'package.json'), JSON.stringify(serverPackageJson, null, 2) + '\n');

// ── server/tsconfig.json ───────────────────────────────────────────────────

const serverTsConfig = {
  compilerOptions: {
    target: 'ES2020',
    module: 'commonjs',
    lib: ['ES2020'],
    outDir: './dist',
    rootDir: './src',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    resolveJsonModule: true,
  },
  include: ['src/**/*'],
  exclude: ['node_modules', 'dist'],
};

await write(join(projectDir, 'server', 'tsconfig.json'), JSON.stringify(serverTsConfig, null, 2) + '\n');

// ── server/src/schemas/GameState.ts ───────────────────────────────────────

const gameStateTs = `import { Schema, MapSchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string')  sessionId: string = '';
  @type('string')  name: string = 'Player';
  @type('number')  x: number = 0;
  @type('number')  y: number = 0;
  @type('number')  hp: number = 3;
  @type('number')  score: number = 0;
  // input state — written by client, consumed by server sim loop
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
`;

await write(join(projectDir, 'server', 'src', 'schemas', 'GameState.ts'), gameStateTs);

// ── server/src/rooms/GameRoom.ts ───────────────────────────────────────────

// Genre-specific starting positions for up to 4 players
/** @type {Record<string, Array<{x: number, y: number}>>} */
const spawnPositions = {
  platformer: [
    { x: 64, y: 400 },
    { x: 128, y: 400 },
    { x: 192, y: 400 },
    { x: 256, y: 400 },
  ],
  default: [
    { x: 64, y: 64 },
    { x: 192, y: 64 },
    { x: 64, y: 192 },
    { x: 192, y: 192 },
  ],
};

const spawns = genre === 'platformer' ? spawnPositions.platformer : spawnPositions.default;
const spawnsLiteral = JSON.stringify(spawns, null, 4);

// Movement speed constants per genre
const speed = genre === 'platformer' ? 120 : 80;
const gravityY = genre === 'platformer' ? 600 : 0;

const gameRoomTs = `import { Room, Client } from '@colyseus/core';
import { GameState, Player } from '../schemas/GameState';

// Spawn positions for up to 4 players
const SPAWNS: Array<{ x: number; y: number }> = ${spawnsLiteral};

// Physics constants (must match Phaser client config)
const SPEED = ${speed};
const GRAVITY_Y = ${gravityY};   // 0 for top-down genres
const TICK_MS = 50;              // 20 Hz

interface InputMessage {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  action: boolean;
}

export class GameRoom extends Room<GameState> {
  maxClients = 4;

  // Per-player vertical velocity for platformer gravity simulation
  private _velY = new Map<string, number>();
  // Track which players are grounded (crude: reset when y >= spawnY)
  private _grounded = new Map<string, boolean>();

  onCreate(_options: unknown): void {
    this.setState(new GameState());

    // Accept input messages from clients
    this.onMessage<InputMessage>('input', (client, input) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.left   = !!input.left;
      player.right  = !!input.right;
      player.up     = !!input.up;
      player.down   = !!input.down;
      player.action = !!input.action;
    });

    // Accept chat messages — broadcast to everyone
    this.onMessage<{ text: string }>('chat', (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      const name = player?.name ?? client.sessionId.slice(0, 6);
      this.broadcast('chat', { from: name, text: String(msg.text).slice(0, 200) });
    });

    // 20 Hz simulation loop
    this.clock.setInterval(() => this._simulate(), TICK_MS);
  }

  onJoin(client: Client, options?: { name?: string }): void {
    const spawnIdx = this.state.players.size % SPAWNS.length;
    const spawn = SPAWNS[spawnIdx];

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = (options?.name ?? 'Player').slice(0, 20);
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = 3;
    player.score = 0;

    this.state.players.set(client.sessionId, player);
    this._velY.set(client.sessionId, 0);
    this._grounded.set(client.sessionId, GRAVITY_Y === 0);

    if (this.state.players.size >= 2 && this.state.phase === 'waiting') {
      this.state.phase = 'playing';
    }

    console.log(\`[GameRoom] \${player.name} joined (slot \${spawnIdx}), total: \${this.state.players.size}\`);
  }

  onLeave(client: Client, _consented: boolean): void {
    const player = this.state.players.get(client.sessionId);
    console.log(\`[GameRoom] \${player?.name ?? client.sessionId} left\`);
    this.state.players.delete(client.sessionId);
    this._velY.delete(client.sessionId);
    this._grounded.delete(client.sessionId);

    if (this.state.players.size === 0) {
      this.state.phase = 'waiting';
    }
  }

  onDispose(): void {
    console.log('[GameRoom] disposed');
  }

  private _simulate(): void {
    if (this.state.phase !== 'playing') return;

    const dt = TICK_MS / 1000; // seconds per tick

    this.state.players.forEach((player, sessionId) => {
      // Horizontal movement
      let vx = 0;
      if (player.left)  vx -= SPEED;
      if (player.right) vx += SPEED;

      // Top-down: vertical movement from up/down keys
      let vy = this._velY.get(sessionId) ?? 0;
      if (GRAVITY_Y === 0) {
        vy = 0;
        if (player.up)   vy -= SPEED;
        if (player.down) vy += SPEED;
        // Normalize diagonal
        if (vx !== 0 && vy !== 0) {
          const len = Math.sqrt(vx * vx + vy * vy);
          vx = (vx / len) * SPEED;
          vy = (vy / len) * SPEED;
        }
      } else {
        // Platformer: gravity + jump
        const grounded = this._grounded.get(sessionId) ?? false;
        vy += GRAVITY_Y * dt;
        if (player.up && grounded) {
          vy = -330; // jump impulse
          this._grounded.set(sessionId, false);
        }
      }

      // Integrate position
      player.x += vx * dt;
      player.y += vy * dt;

      // Simple world bounds clamp (client tilemap provides real collision)
      if (player.x < 0)    player.x = 0;
      if (player.y < 0)    { player.y = 0; vy = 0; }
      if (player.x > 3000) player.x = 3000;

      // Crude ground for platformer (y > spawn floor resets velocity)
      if (GRAVITY_Y > 0 && player.y >= SPAWNS[0].y) {
        player.y = SPAWNS[0].y;
        vy = 0;
        this._grounded.set(sessionId, true);
      }

      this._velY.set(sessionId, vy);
    });

    this.state.tick++;
  }
}
`;

await write(join(projectDir, 'server', 'src', 'rooms', 'GameRoom.ts'), gameRoomTs);

// ── server/src/index.ts ────────────────────────────────────────────────────

const serverIndexTs = `import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { monitor } from '@colyseus/monitor';
import { GameRoom } from './rooms/GameRoom';

const PORT = parseInt(process.env.PORT ?? '${port}', 10);

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Colyseus admin monitor (http://localhost:${port}/colyseus)
app.use('/colyseus', monitor());

const httpServer = http.createServer(app);

const gameServer = new Server({ server: httpServer });
gameServer.define('game_room', GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(\`[Colyseus] listening on ws://localhost:\${PORT}\`);
  console.log(\`[Colyseus] monitor: http://localhost:\${PORT}/colyseus\`);
});

// Graceful shutdown
process.on('SIGTERM', () => gameServer.gracefullyShutdown());
process.on('SIGINT',  () => gameServer.gracefullyShutdown());
`;

await write(join(projectDir, 'server', 'src', 'index.ts'), serverIndexTs);

// ── src/net/ColyseusClient.js ──────────────────────────────────────────────

const colyseusClientJs = `// Colyseus client adapter for Phaser 3.
// Connects to ws://localhost:${port} (or VITE_COLYSEUS_URL env), joins "game_room",
// forwards player input every frame, and calls onStateChange with the latest server state.
import * as Colyseus from 'colyseus.js';

export default class ColyseusClient {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this._scene = scene;
    this._room = null;
    this._stateCallback = null;
    this._pendingInput = null;
    this._connected = false;

    const url = import.meta.env?.VITE_COLYSEUS_URL ?? 'ws://localhost:${port}';
    this._client = new Colyseus.Client(url);

    // Read room/session from URL params (set by lobby app)
    const params = new URLSearchParams(window.location.search);
    const roomId  = params.get('room');
    const session = params.get('session');

    if (roomId && session) {
      this._reconnect(roomId, session);
    } else {
      this._join();
    }

    // Send input at 20 Hz (every 50 ms) — decouple from render framerate
    this._sendInterval = setInterval(() => this._flushInput(), 50);

    scene.events.once('shutdown', () => this.destroy());
    scene.events.once('destroy',  () => this.destroy());
  }

  /** @returns {string | null} */
  get sessionId() {
    return this._room?.sessionId ?? null;
  }

  /** @param {(state: any) => void} cb */
  onStateChange(cb) {
    this._stateCallback = cb;
    // If already connected, call immediately with current state
    if (this._room) cb(this._room.state);
  }

  /**
   * Queue input to send on the next 50 ms flush.
   * @param {{ left: boolean, right: boolean, up: boolean, down: boolean, action: boolean }} input
   */
  sendInput(input) {
    this._pendingInput = input;
  }

  destroy() {
    clearInterval(this._sendInterval);
    this._room?.leave();
    this._room = null;
  }

  // ── private ────────────────────────────────────────────────────────────

  async _join() {
    try {
      const playerName = localStorage.getItem('playerName') ?? 'Player';
      this._room = await this._client.joinOrCreate('game_room', { name: playerName });
      this._onRoomJoined();
    } catch (err) {
      console.error('[ColyseusClient] join failed:', err);
    }
  }

  async _reconnect(roomId, sessionId) {
    try {
      this._room = await this._client.reconnect(roomId, sessionId);
      this._onRoomJoined();
    } catch (_err) {
      // Fallback to fresh join if reconnect token expired
      this._join();
    }
  }

  _onRoomJoined() {
    const room = this._room;
    this._connected = true;
    console.log(\`[ColyseusClient] joined room \${room.id} as \${room.sessionId}\`);

    // Full state sync on every server patch
    room.onStateChange((state) => {
      if (this._stateCallback) this._stateCallback(state);
    });

    // Handle chat messages
    room.onMessage('chat', (msg) => {
      console.info(\`[\${msg.from}] \${msg.text}\`);
      this._scene.events.emit('net:chat', msg);
    });

    // Handle peer-joined for voice (PeerJS)
    room.onMessage('peer-joined', (msg) => {
      this._scene.events.emit('net:peer-joined', msg);
    });

    room.onLeave((code) => {
      console.warn(\`[ColyseusClient] left room (code \${code})\`);
      this._connected = false;
    });
  }

  _flushInput() {
    if (!this._room || !this._pendingInput) return;
    this._room.send('input', this._pendingInput);
    this._pendingInput = null;
  }
}
`;

await write(join(projectDir, 'src', 'net', 'ColyseusClient.js'), colyseusClientJs);

// ── src/net/RemotePlayer.js ────────────────────────────────────────────────

const remotePLayerJs = `// Phaser sprite representing a networked remote player.
// Uses linear interpolation toward the server-authoritative position.
export default class RemotePlayer {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} name
   */
  constructor(scene, x, y, name = 'Player') {
    this._scene = scene;

    // Try to reuse the same texture as the local player (first entities sheet)
    const textureKey = scene.textures.exists('entities-1') ? 'entities-1' : '__DEFAULT';
    this._sprite = scene.physics.add.sprite(x, y, textureKey);
    this._sprite.setTint(0x88aaff); // tint distinguishes remote from local

    // Name label above sprite
    this._label = scene.add.text(x, y - 14, name, {
      fontSize: '6px',
      color: '#ffffff',
      backgroundColor: '#00000066',
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1).setDepth(50);

    // Target position for interpolation
    this._targetX = x;
    this._targetY = y;

    // Register update listener
    this._updateFn = () => this._update();
    scene.events.on('update', this._updateFn);
  }

  /**
   * Apply state received from the server.
   * @param {{ x: number, y: number, hp: number, score: number, name: string }} serverPlayer
   */
  syncFrom(serverPlayer) {
    this._targetX = serverPlayer.x;
    this._targetY = serverPlayer.y;
    if (serverPlayer.name && this._label.text !== serverPlayer.name) {
      this._label.setText(serverPlayer.name);
    }
  }

  destroy() {
    this._scene.events.off('update', this._updateFn);
    this._sprite.destroy();
    this._label.destroy();
  }

  // ── private ────────────────────────────────────────────────────────────

  _update() {
    if (!this._sprite.active) return;
    // Lerp 30% per frame toward server target (~6 frames to close 1px gap at 60 fps)
    const lerpFactor = 0.3;
    this._sprite.x += (this._targetX - this._sprite.x) * lerpFactor;
    this._sprite.y += (this._targetY - this._sprite.y) * lerpFactor;

    // Keep label in sync
    this._label.x = this._sprite.x;
    this._label.y = this._sprite.y - 14;

    // Flip sprite to face direction of movement
    const dx = this._targetX - this._sprite.x;
    if (Math.abs(dx) > 1) this._sprite.setFlipX(dx < 0);

    // Play walk/idle animation if the texture has them
    const walkKey = 'PLAYER-walk';
    const idleKey = 'PLAYER-idle';
    const moving = Math.abs(this._targetX - this._sprite.x) > 2 || Math.abs(this._targetY - this._sprite.y) > 2;
    if (this._sprite.anims) {
      const key = moving ? walkKey : idleKey;
      if (this._scene.anims.exists(key) && this._sprite.anims.currentAnim?.key !== key) {
        this._sprite.play(key, true);
      }
    }
  }
}
`;

await write(join(projectDir, 'src', 'net', 'RemotePlayer.js'), remotePLayerJs);

// ── src/net/VoiceChat.js (--voice) ────────────────────────────────────────

if (withVoice) {
  const voiceChatJs = `// PeerJS voice/video chat layer.
// Activated with --voice flag. Call VoiceChat.init() after Colyseus room join.
// Requires PeerJS: import { Peer } from 'peerjs' (CDN or npm: peerjs)
import { Peer } from 'peerjs';

export default class VoiceChat {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} sessionId  — Colyseus sessionId used as PeerJS peer ID
   */
  constructor(scene, sessionId) {
    this._scene = scene;
    this._sessionId = sessionId;
    this._peer = null;
    this._localStream = null;
    this._calls = new Map();        // peerId → MediaConnection
    this._videoEls = new Map();     // peerId → HTMLVideoElement
    this._videoContainer = null;

    this._init();
  }

  /** Call this when a new peer joins (fired by net:peer-joined scene event). */
  callPeer(peerId) {
    if (!this._localStream || !this._peer) return;
    if (this._calls.has(peerId)) return; // already connected
    const call = this._peer.call(peerId, this._localStream, { metadata: { sessionId: this._sessionId } });
    this._calls.set(peerId, call);
    call.on('stream', (remoteStream) => this._attachStream(peerId, remoteStream));
    call.on('close', () => this._detachStream(peerId));
  }

  /** Mute/unmute local audio. */
  setMuted(muted) {
    if (!this._localStream) return;
    this._localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  /** Toggle local camera. */
  setVideoEnabled(enabled) {
    if (!this._localStream) return;
    this._localStream.getVideoTracks().forEach((t) => { t.enabled = enabled; });
  }

  destroy() {
    this._calls.forEach((call) => call.close());
    this._calls.clear();
    this._videoEls.forEach((el) => el.remove());
    this._videoEls.clear();
    if (this._localStream) this._localStream.getTracks().forEach((t) => t.stop());
    if (this._peer) this._peer.destroy();
    if (this._videoContainer) this._videoContainer.remove();
  }

  // ── private ────────────────────────────────────────────────────────────

  async _init() {
    // Get local audio+video
    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
      console.warn('[VoiceChat] getUserMedia failed (audio+video):', err.message);
      try {
        this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (audioErr) {
        console.error('[VoiceChat] getUserMedia audio failed:', audioErr.message);
        return;
      }
    }

    // Create a container div for video tiles, positioned over the Phaser canvas
    this._videoContainer = document.createElement('div');
    Object.assign(this._videoContainer.style, {
      position: 'fixed',
      bottom: '8px',
      right: '8px',
      display: 'flex',
      gap: '4px',
      zIndex: '999',
    });
    document.body.appendChild(this._videoContainer);

    // Mount local preview (muted to avoid echo)
    this._mountVideo('local', this._localStream, true);

    // Connect to PeerJS signaling server
    const peerHost  = import.meta.env?.VITE_PEER_HOST;
    const peerPort  = import.meta.env?.VITE_PEER_PORT ? parseInt(import.meta.env.VITE_PEER_PORT, 10) : 443;
    const peerPath  = import.meta.env?.VITE_PEER_PATH ?? '/peerjs';

    const peerConfig = peerHost
      ? { host: peerHost, port: peerPort, path: peerPath, secure: peerPort === 443 }
      : {}; // use PeerJS cloud server (peerjs.com) when no custom host

    this._peer = new Peer(this._sessionId, peerConfig);

    this._peer.on('open', (id) => {
      console.log('[VoiceChat] peer connected:', id);
    });

    // Answer incoming calls automatically
    this._peer.on('call', (call) => {
      call.answer(this._localStream);
      const peerId = call.peer;
      this._calls.set(peerId, call);
      call.on('stream', (remoteStream) => this._attachStream(peerId, remoteStream));
      call.on('close', () => this._detachStream(peerId));
    });

    this._peer.on('error', (err) => {
      console.error('[VoiceChat] peer error:', err);
    });

    // Listen for Colyseus net:peer-joined event to initiate calls
    this._scene.events.on('net:peer-joined', ({ peerId }) => {
      if (peerId !== this._sessionId) this.callPeer(peerId);
    });

    this._scene.events.once('shutdown', () => this.destroy());
    this._scene.events.once('destroy',  () => this.destroy());
  }

  _mountVideo(id, stream, muted = false) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    Object.assign(video.style, { width: '80px', height: '60px', borderRadius: '4px', objectFit: 'cover' });
    this._videoContainer.appendChild(video);
    this._videoEls.set(id, video);
  }

  _attachStream(peerId, stream) {
    if (this._videoEls.has(peerId)) return;
    this._mountVideo(peerId, stream, false);
  }

  _detachStream(peerId) {
    const el = this._videoEls.get(peerId);
    if (el) { el.remove(); this._videoEls.delete(peerId); }
    this._calls.delete(peerId);
  }
}
`;

  await write(join(projectDir, 'src', 'net', 'VoiceChat.js'), voiceChatJs);
}

// ── lobby/ React app (--lobby) ─────────────────────────────────────────────

if (withLobby) {
  log('\nscaffolding lobby/ React app...');

  const lobbyPackageJson = {
    name: `${projectName}-lobby`,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --port 3000',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@reduxjs/toolkit': '^2.2.0',
      'colyseus.js': '^0.15.0',
      react: '^18.3.0',
      'react-dom': '^18.3.0',
      'react-redux': '^9.1.0',
    },
    devDependencies: {
      '@types/react': '^18.3.0',
      '@types/react-dom': '^18.3.0',
      '@vitejs/plugin-react': '^4.3.0',
      typescript: '^5.3.0',
      vite: '^5.2.0',
    },
  };

  await write(join(projectDir, 'lobby', 'package.json'), JSON.stringify(lobbyPackageJson, null, 2) + '\n');

  const lobbyViteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/matchmake': \`http://localhost:${port}\`,
      '/health':    \`http://localhost:${port}\`,
    },
  },
});
`;
  await write(join(projectDir, 'lobby', 'vite.config.ts'), lobbyViteConfig);

  const lobbyTsConfig = {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
    },
    include: ['src'],
  };
  await write(join(projectDir, 'lobby', 'tsconfig.json'), JSON.stringify(lobbyTsConfig, null, 2) + '\n');

  const lobbyIndexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Lobby</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  await write(join(projectDir, 'lobby', 'index.html'), lobbyIndexHtml);

  const lobbyMainTsx = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './components/App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);
`;
  await write(join(projectDir, 'lobby', 'src', 'main.tsx'), lobbyMainTsx);

  const lobbySliceTs = `import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Colyseus from 'colyseus.js';

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL ?? 'ws://localhost:${port}';
const client = new Colyseus.Client(COLYSEUS_URL);

export interface RoomInfo {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
}

interface LobbyState {
  playerName: string;
  rooms: RoomInfo[];
  status: 'idle' | 'loading' | 'joining' | 'joined' | 'error';
  error: string | null;
  roomId: string | null;
  sessionId: string | null;
}

const initialState: LobbyState = {
  playerName: localStorage.getItem('playerName') ?? 'Player',
  rooms: [],
  status: 'idle',
  error: null,
  roomId: null,
  sessionId: null,
};

export const fetchRooms = createAsyncThunk('lobby/fetchRooms', async () => {
  const rooms = await client.getAvailableRooms('game_room');
  return rooms.map((r): RoomInfo => ({
    roomId: r.roomId,
    name: r.metadata?.name ?? r.roomId.slice(0, 8),
    clients: r.clients,
    maxClients: r.maxClients,
  }));
});

export const joinRoom = createAsyncThunk(
  'lobby/joinRoom',
  async ({ roomId, playerName }: { roomId: string | null; playerName: string }) => {
    const room = roomId
      ? await client.joinById(roomId, { name: playerName })
      : await client.create('game_room', { name: playerName });
    return { roomId: room.id, sessionId: room.sessionId };
  },
);

const lobbySlice = createSlice({
  name: 'lobby',
  initialState,
  reducers: {
    setPlayerName(state, action: PayloadAction<string>) {
      state.playerName = action.payload;
      localStorage.setItem('playerName', action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRooms.pending,  (state) => { state.status = 'loading'; state.error = null; })
      .addCase(fetchRooms.fulfilled,(state, action) => { state.status = 'idle'; state.rooms = action.payload; })
      .addCase(fetchRooms.rejected, (state, action) => { state.status = 'error'; state.error = action.error.message ?? 'fetch failed'; })
      .addCase(joinRoom.pending,    (state) => { state.status = 'joining'; state.error = null; })
      .addCase(joinRoom.fulfilled,  (state, action) => {
        state.status = 'joined';
        state.roomId    = action.payload.roomId;
        state.sessionId = action.payload.sessionId;
      })
      .addCase(joinRoom.rejected,   (state, action) => { state.status = 'error'; state.error = action.error.message ?? 'join failed'; });
  },
});

export const { setPlayerName } = lobbySlice.actions;
export default lobbySlice.reducer;
`;
  await write(join(projectDir, 'lobby', 'src', 'slices', 'lobbySlice.ts'), lobbySliceTs);

  const lobbyStoreTs = `import { configureStore } from '@reduxjs/toolkit';
import lobbyReducer from './slices/lobbySlice';

export const store = configureStore({
  reducer: { lobby: lobbyReducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
`;
  await write(join(projectDir, 'lobby', 'src', 'store.ts'), lobbyStoreTs);

  const appTsx = `import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { joinRoom, fetchRooms } from '../slices/lobbySlice';
import PlayerSetup from './PlayerSetup';
import RoomList from './RoomList';

const GAME_URL = import.meta.env.VITE_GAME_URL ?? 'http://localhost:5173';

export default function App() {
  const dispatch = useDispatch<AppDispatch>();
  const { status, roomId, sessionId, playerName } = useSelector((s: RootState) => s.lobby);

  // Redirect to game once joined
  useEffect(() => {
    if (status === 'joined' && roomId && sessionId) {
      const url = new URL(GAME_URL);
      url.searchParams.set('room', roomId);
      url.searchParams.set('session', sessionId);
      window.location.href = url.toString();
    }
  }, [status, roomId, sessionId]);

  useEffect(() => { dispatch(fetchRooms()); }, [dispatch]);

  const handleCreate = () => dispatch(joinRoom({ roomId: null, playerName }));

  return (
    <div style={{ fontFamily: 'monospace', maxWidth: 480, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>${projectName} — Lobby</h1>
      <PlayerSetup />
      <button onClick={handleCreate} disabled={status === 'joining'} style={{ marginBottom: 16 }}>
        {status === 'joining' ? 'Joining...' : 'Create new room'}
      </button>
      <RoomList />
      {status === 'error' && <p style={{ color: 'red' }}>Error — check console</p>}
    </div>
  );
}
`;
  await write(join(projectDir, 'lobby', 'src', 'components', 'App.tsx'), appTsx);

  const playerSetupTsx = `import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { setPlayerName } from '../slices/lobbySlice';

export default function PlayerSetup() {
  const dispatch = useDispatch<AppDispatch>();
  const playerName = useSelector((s: RootState) => s.lobby.playerName);
  return (
    <div style={{ marginBottom: 16 }}>
      <label>
        Your name:{' '}
        <input
          value={playerName}
          maxLength={20}
          onChange={(e) => dispatch(setPlayerName(e.target.value))}
          style={{ fontFamily: 'monospace', padding: '2px 4px' }}
        />
      </label>
    </div>
  );
}
`;
  await write(join(projectDir, 'lobby', 'src', 'components', 'PlayerSetup.tsx'), playerSetupTsx);

  const roomListTsx = `import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { joinRoom, fetchRooms } from '../slices/lobbySlice';

export default function RoomList() {
  const dispatch = useDispatch<AppDispatch>();
  const { rooms, status, playerName } = useSelector((s: RootState) => s.lobby);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>Available rooms</strong>
        <button onClick={() => dispatch(fetchRooms())} disabled={status === 'loading'} style={{ fontSize: 11 }}>
          {status === 'loading' ? '...' : 'Refresh'}
        </button>
      </div>
      {rooms.length === 0 ? (
        <p style={{ color: '#666' }}>No open rooms — create one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rooms.map((r) => (
            <li key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' }}>
              <span>{r.roomId.slice(0, 8)} ({r.clients}/{r.maxClients})</span>
              <button
                onClick={() => dispatch(joinRoom({ roomId: r.roomId, playerName }))}
                disabled={status === 'joining' || r.clients >= r.maxClients}
              >
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
`;
  await write(join(projectDir, 'lobby', 'src', 'components', 'RoomList.tsx'), roomListTsx);
}

// ── .env.example ───────────────────────────────────────────────────────────

const envExample = `# Colyseus server URL (leave blank for localhost:${port})
VITE_COLYSEUS_URL=ws://localhost:${port}

# PeerJS server (leave blank to use peerjs.com cloud server)
# VITE_PEER_HOST=your-peer-server.example.com
# VITE_PEER_PORT=443
# VITE_PEER_PATH=/peerjs

# Lobby → game redirect URL (used by lobby app)
VITE_GAME_URL=http://localhost:5173
`;

await write(join(projectDir, '.env.example'), envExample);

// ── final instructions ─────────────────────────────────────────────────────

console.log(JSON.stringify({
  event: 'multiplayer.init.done',
  projectDir,
  port,
  withVoice,
  withLobby,
  nextSteps: [
    `1. patch Game.js:  node skills/multiplayer/scripts/patch_game.mjs ${projectDir}`,
    `2. install server: cd ${projectDir}/server && npm install`,
    `3. start server:   cd ${projectDir}/server && npm run dev`,
    `4. start client:   cd ${projectDir} && npm run dev`,
    withLobby ? `5. start lobby:    cd ${projectDir}/lobby && npm install && npm run dev` : null,
  ].filter(Boolean),
}));
