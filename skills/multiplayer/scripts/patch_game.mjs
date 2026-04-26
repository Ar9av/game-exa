#!/usr/bin/env node
// Patches the existing src/scenes/Game.js to add Colyseus multiplayer hooks.
// Usage: node patch_game.mjs <project-dir> [--local]
//
// The patch is ADDITIVE: it injects import lines, net init in create(),
// input forwarding in update(), and two new methods. It never removes lines.
import { resolve, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const projectDirArg = args.find((a) => !a.startsWith('--'));
if (!projectDirArg) {
  console.error('usage: patch_game.mjs <project-dir> [--local]');
  process.exit(2);
}

const projectDir = resolve(process.cwd(), projectDirArg);
const localOnly  = args.includes('--local');

// ── helpers ────────────────────────────────────────────────────────────────

function log(msg) { console.error(msg); }

/** Find the closing brace of a method body, starting search at `fromLine`. */
function findMethodEnd(lines, fromLine) {
  let depth = 0;
  let inMethod = false;
  for (let i = fromLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; inMethod = true; }
      if (ch === '}') { depth--; }
    }
    if (inMethod && depth === 0) return i;
  }
  return lines.length - 1;
}

/** Find the line number (0-based) of the first line matching a regex, starting from `from`. */
function findLine(lines, re, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/** Return true if the file already contains the given string (idempotency guard). */
function alreadyPatched(source, marker) {
  return source.includes(marker);
}

// ── read files ─────────────────────────────────────────────────────────────

const statePath = join(projectDir, 'game-state.json');
if (!existsSync(statePath)) {
  console.error(`game-state.json not found in ${projectDir}`);
  process.exit(3);
}

const state = JSON.parse(await readFile(statePath, 'utf8'));
const genre = state.genre ?? 'top-down-adventure';

const gamePath = join(projectDir, 'src', 'scenes', 'Game.js');
if (!existsSync(gamePath)) {
  console.error(`Game.js not found at ${gamePath} — run codesmith first`);
  process.exit(3);
}

let source = await readFile(gamePath, 'utf8');

// ── idempotency guard ──────────────────────────────────────────────────────

const PATCH_MARKER = '// [multiplayer-patch]';
if (alreadyPatched(source, PATCH_MARKER)) {
  log('Game.js already patched — nothing to do');
  console.log(JSON.stringify({ event: 'patch_game.skipped', reason: 'already-patched' }));
  process.exit(0);
}

log(`patching ${gamePath}  (genre: ${genre}, localOnly: ${localOnly})`);

// ── build patch content ────────────────────────────────────────────────────

// Genre-aware input shape comment
const inputComment = genre === 'platformer'
  ? '// platformer: left/right movement + up=jump, down unused'
  : genre === 'shoot-em-up'
  ? '// shoot-em-up: 4-direction movement + action=fire'
  : '// top-down: 4-direction movement + action=attack/interact';

// The two new methods to append inside the class
const newMethods = localOnly
  ? `
  ${PATCH_MARKER}
  // ── local 2-player methods ─────────────────────────────────────────
  _spawnPlayer2(tileSize) {
    const manifest = this.registry.get('manifest');
    const sheet = manifest?.sprites?.[0];
    const tex = sheet?.textureKey ?? '__DEFAULT';
    const frame = sheet ? sheet.rows.length > 0 ? sheet.rows.length * (sheet.cols.length || 1) - (sheet.cols.length || 1) : 0 : 0;
    this.player2 = this.physics.add.sprite(128, 128, tex, frame);
    this.player2.setTint(0x88ffaa);
    if (tileSize) this.player2.setDisplaySize(tileSize, tileSize);
    if (this.layer) this.physics.add.collider(this.player2, this.layer);
    this.keys2 = this.input.keyboard.addKeys({ left: 'F', right: 'H', up: 'T', down: 'G', action: 'R' });
    this.add.text(4, 14, 'P2: F/H/T/G', { fontSize: '7px', color: '#88ffaa' }).setScrollFactor(0).setDepth(99);
  }

  _updatePlayer2() {
    if (!this.player2 || this.gameOver) return;
    const speed = 80;
    const b = this.player2.body;
    b.setVelocity(0);
    if (this.keys2.left.isDown)  b.setVelocityX(-speed);
    if (this.keys2.right.isDown) b.setVelocityX( speed);
    if (this.keys2.up.isDown)    b.setVelocityY(-speed);
    if (this.keys2.down.isDown)  b.setVelocityY( speed);
    if (b.velocity.x !== 0 || b.velocity.y !== 0) b.velocity.normalize().scale(speed);
  }
  // ── end local 2-player methods ─────────────────────────────────────
`
  : `
  ${PATCH_MARKER}
  // ── network methods ────────────────────────────────────────────────
  _collectInput() {
    ${inputComment}
    return {
      left:   !!(this.cursors?.left?.isDown  || this.keys?.A?.isDown),
      right:  !!(this.cursors?.right?.isDown || this.keys?.D?.isDown),
      up:     !!(this.cursors?.up?.isDown    || this.keys?.W?.isDown),
      down:   !!(this.cursors?.down?.isDown  || this.keys?.S?.isDown),
      action: !!(this.keys?.SPACE?.isDown),
    };
  }

  _syncFromServer(serverState) {
    if (!serverState?.players) return;
    const myId = this._net.sessionId;
    serverState.players.forEach((player, sessionId) => {
      if (sessionId === myId) {
        // Reconcile: if server position diverges > 8px, snap toward it
        if (this.player) {
          const dx = player.x - this.player.x;
          const dy = player.y - this.player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 8) {
            this.player.x += dx * 0.15;
            this.player.y += dy * 0.15;
          }
        }
        return;
      }
      if (!this._remotePlayers.has(sessionId)) {
        // Dynamic import so RemotePlayer is only loaded when needed
        import('../net/RemotePlayer.js').then(({ default: RemotePlayer }) => {
          if (!this._remotePlayers.has(sessionId)) {
            const rp = new RemotePlayer(this, player.x, player.y, player.name);
            this._remotePlayers.set(sessionId, rp);
          }
        });
      } else {
        this._remotePlayers.get(sessionId)?.syncFrom(player);
      }
    });
    // Remove players who left
    this._remotePlayers.forEach((rp, id) => {
      if (!serverState.players.has(id)) {
        rp.destroy();
        this._remotePlayers.delete(id);
      }
    });
  }
  // ── end network methods ────────────────────────────────────────────
`;

// ── apply patches to source ────────────────────────────────────────────────

let lines = source.split('\n');

// PATCH 1: Add import lines after the last existing import
let lastImportLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*import\s/.test(lines[i])) lastImportLine = i;
}

if (!localOnly) {
  const importLines = [
    `import ColyseusClient from '../net/ColyseusClient.js'; ${PATCH_MARKER}`,
  ];
  if (lastImportLine >= 0) {
    lines.splice(lastImportLine + 1, 0, ...importLines);
  } else {
    lines.unshift(...importLines);
  }
  // Recalculate after insert
  lastImportLine += importLines.length;
}

// PATCH 2: Inject net init at the END of create(), just before scene-ready emit
// Strategy: find `this.events.emit('scene-ready')` and insert before it.
const createInjectLines = localOnly
  ? [
      `    // [multiplayer-patch] local 2-player spawn`,
      `    const _tileSize = this.registry.get('manifest')?.tiles?.tileSize ?? 16;`,
      `    this._spawnPlayer2(_tileSize);`,
    ]
  : [
      `    // [multiplayer-patch] network init`,
      `    this._net = new ColyseusClient(this);`,
      `    this._remotePlayers = new Map();`,
      `    this._net.onStateChange((state) => this._syncFromServer(state));`,
    ];

const sceneReadyIdx = findLine(lines, /this\.events\.emit\(['"]scene-ready['"]\)/);
if (sceneReadyIdx >= 0) {
  lines.splice(sceneReadyIdx, 0, ...createInjectLines);
} else {
  // Fallback: find end of create() and inject before closing brace
  const createLine = findLine(lines, /^\s*(async\s+)?create\s*\(/);
  if (createLine >= 0) {
    const createEnd = findMethodEnd(lines, createLine);
    lines.splice(createEnd, 0, ...createInjectLines);
    log('  warning: scene-ready not found — injected before create() closing brace');
  } else {
    log('  warning: create() not found — skipping create injection');
  }
}

// PATCH 3: Inject input send at END of update()
// Find update() and inject before its last closing brace.
const updateLine = findLine(lines, /^\s*(async\s+)?update\s*\(/);
if (updateLine >= 0) {
  const updateEnd = findMethodEnd(lines, updateLine);
  const updateInjectLines = localOnly
    ? [`    this._updatePlayer2(); ${PATCH_MARKER}`]
    : [`    if (this._net) this._net.sendInput(this._collectInput()); ${PATCH_MARKER}`];
  lines.splice(updateEnd, 0, ...updateInjectLines);
} else {
  log('  warning: update() not found — skipping update injection');
}

// PATCH 4: Append new methods before the last closing brace of the class
// Find the last `}` at column 0 that closes the class.
let classEnd = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (/^}/.test(lines[i])) { classEnd = i; break; }
}

if (classEnd >= 0) {
  const methodLines = newMethods.split('\n');
  lines.splice(classEnd, 0, ...methodLines);
} else {
  log('  warning: class closing brace not found — appending methods at end');
  lines.push(...newMethods.split('\n'));
}

// PATCH 5 (local only): inject P2 spawn inside the local-only create() area
// Already handled in PATCH 2 above.

// ── write patched file ─────────────────────────────────────────────────────

const patched = lines.join('\n');
await writeFile(gamePath, patched, 'utf8');
log(`patched Game.js (${patched.split('\n').length} lines)`);

// ── update game-state.json to record the patch ─────────────────────────────

if (!state.multiplayer) state.multiplayer = {};
state.multiplayer.patched = true;
state.multiplayer.localOnly = localOnly;
state.multiplayer.patchedAt = new Date().toISOString();
await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  event: 'patch_game.done',
  gamePath: gamePath.replace(projectDir + '/', ''),
  localOnly,
  genre,
  lineCount: patched.split('\n').length,
}));
