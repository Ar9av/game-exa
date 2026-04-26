#!/usr/bin/env node
// Static playability analysis: parse level data, return structured issues.
// Usage: node static_check.mjs <project-dir>
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const projectDir = resolve(process.argv[2] ?? '.');
const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd || !state.levels?.length) {
  console.error('static_check: state missing gdd or levels');
  process.exit(3);
}

const palette = state.gdd.tilesetPalette;
const playerEntity = state.gdd.entities.find((e) => e.kind === 'player');
const isPlatformer = state.gdd.genre === 'platformer';
const isTopDown = state.gdd.genre === 'top-down-adventure' || state.gdd.genre === 'dungeon-crawler';

// Approximate max horizontal jump distance in tiles.
// Default Phaser arcade: jump v=330, g=600, hSpeed=120; tileSize=32 with sf=2.
// Time in air = 2v/g (ignoring sf since v and g scale together).
// Distance = hSpeed * 2v/g = 120 * 2*330/600 = 132 px = 4.125 tiles at tileSize=32.
// Use 4 tiles as the safe gap-jump limit; warn if architect drew >= 5 tile gap.
const MAX_JUMP_TILES = 4;

const issues = [];

function tileAt(level, x, y) {
  if (y < 0 || y >= level.size[1] || x < 0 || x >= level.size[0]) return null;
  return level.tiles[y][x];
}

function isPassable(level, x, y) {
  const t = tileAt(level, x, y);
  return t != null && palette[t].passable;
}

function isImpassable(level, x, y) {
  const t = tileAt(level, x, y);
  return t != null && !palette[t].passable;
}

function bfsReachableTiles(level, startX, startY) {
  // 4-connected flood fill on passable tiles. For top-down this is gameplay reachability.
  // For platformer it's "every tile the player could occupy" — connected by walking
  // through air/floor; jump connectivity is approximated by allowing diagonal up-1 moves
  // that would otherwise need a jump.
  const reach = new Set();
  const queue = [[startX, startY]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (reach.has(key)) continue;
    if (!isPassable(level, x, y)) continue;
    reach.add(key);
    const moves = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    if (isPlatformer) {
      // Allow short upward hops onto adjacent platforms (1 tile up-and-over).
      moves.push([-1, -1], [1, -1]);
    }
    for (const [dx, dy] of moves) queue.push([x + dx, y + dy]);
  }
  return reach;
}

for (const level of state.levels) {
  const [w, h] = level.size;
  const playerSpawn = level.spawns.find((s) => s.entity === playerEntity.id);
  if (!playerSpawn) {
    issues.push({ kind: 'no-player-spawn', level: level.id, severity: 'error', message: 'level has no player spawn' });
    continue;
  }

  // 1. Border integrity — outer ring must all be impassable.
  for (let x = 0; x < w; x++) {
    // Platformers have open sky at the top (no ceiling) — skip top border check.
    if (!isPlatformer && isPassable(level, x, 0)) issues.push({ kind: 'border-hole', level: level.id, severity: 'error', x, y: 0, message: `top border tile (${x},0) passable` });
    if (isPassable(level, x, h - 1)) issues.push({ kind: 'border-hole', level: level.id, severity: 'error', x, y: h - 1, message: `bottom border tile (${x},${h - 1}) passable` });
  }
  for (let y = 0; y < h; y++) {
    if (isPassable(level, 0, y))     issues.push({ kind: 'border-hole', level: level.id, severity: 'error', x: 0,     y, message: `left border tile (0,${y}) passable` });
    if (isPassable(level, w - 1, y)) issues.push({ kind: 'border-hole', level: level.id, severity: 'error', x: w - 1, y, message: `right border tile (${w - 1},${y}) passable` });
  }
  // shoot-em-up's space genre intentionally has fully-passable tiles + bg, so we
  // suppress border warnings when ALL palette entries are passable.
  if (palette.every((p) => p.passable)) {
    issues.splice(0, issues.length, ...issues.filter((i) => i.kind !== 'border-hole'));
  }

  // 2. Reachability flood fill from player spawn.
  const reach = bfsReachableTiles(level, playerSpawn.x, playerSpawn.y);

  for (const sp of level.spawns) {
    if (sp.entity === playerEntity.id) continue;
    if (!reach.has(`${sp.x},${sp.y}`)) {
      issues.push({
        kind: 'unreachable-spawn', level: level.id, severity: 'warning',
        entity: sp.entity, x: sp.x, y: sp.y,
        message: `${sp.entity} at (${sp.x},${sp.y}) not BFS-reachable from player spawn`,
      });
    }
  }

  // 3. Spawn collision
  const spawnLocations = new Map();
  for (const sp of level.spawns) {
    const k = `${sp.x},${sp.y}`;
    if (spawnLocations.has(k)) {
      issues.push({ kind: 'spawn-collision', level: level.id, severity: 'warning', x: sp.x, y: sp.y, entities: [spawnLocations.get(k), sp.entity], message: `${spawnLocations.get(k)} and ${sp.entity} share tile (${sp.x},${sp.y})` });
    }
    spawnLocations.set(k, sp.entity);
  }

  // 4. Platformer-specific: standable spawns + jump arc gaps.
  if (isPlatformer) {
    for (const sp of level.spawns) {
      // Pickups can float; players and enemies need ground beneath them (tile below impassable).
      const ent = state.gdd.entities.find((e) => e.id === sp.entity);
      if (!ent) continue;
      if (ent.kind === 'pickup' || ent.kind === 'projectile') continue;
      if (!isImpassable(level, sp.x, sp.y + 1)) {
        issues.push({
          kind: 'unsupported-spawn', level: level.id, severity: 'warning',
          entity: sp.entity, x: sp.x, y: sp.y,
          message: `${sp.entity} at (${sp.x},${sp.y}) has no ground tile below`,
        });
      }
    }

    // Build the set of rows that have at least one BFS-reachable floor tile.
    // A "floor tile" at (x, y) means: passable at y AND impassable at y+1 AND in reach set.
    const reachableFloorRows = new Set();
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        if (isPassable(level, x, y) && isImpassable(level, x, y + 1) && reach.has(`${x},${y}`)) {
          reachableFloorRows.add(y);
          break;
        }
      }
    }

    // Find the floor row (lowest passable row above an impassable row).
    // Scan each y for "is row y passable AND row y+1 impassable" → floor exists at y.
    // Only check rows that have at least one reachable floor tile (skip pure-sky rows).
    for (let y = 0; y < h - 1; y++) {
      if (!reachableFloorRows.has(y)) continue;
      let runStart = null;
      for (let x = 0; x < w; x++) {
        const isFloor = isPassable(level, x, y) && isImpassable(level, x, y + 1);
        const isWalkable = isPassable(level, x, y);
        // Track contiguous "no floor" runs ON walkable rows
        if (isWalkable && !isFloor) {
          if (runStart === null) runStart = x;
        } else {
          if (runStart !== null && (x - runStart) > MAX_JUMP_TILES) {
            issues.push({
              kind: 'gap-too-wide', level: level.id, severity: 'warning',
              y, x1: runStart, x2: x - 1, width: x - runStart, max: MAX_JUMP_TILES,
              message: `walkable gap at y=${y}, x=${runStart}..${x - 1} (${x - runStart} tiles, max safe jump = ${MAX_JUMP_TILES})`,
            });
          }
          runStart = null;
        }
      }
    }
  }
}

const errors = issues.filter((i) => i.severity === 'error').length;
const warnings = issues.filter((i) => i.severity === 'warning').length;
console.log(JSON.stringify({ ok: errors === 0, errors, warnings, total: issues.length, issues }, null, 2));
process.exit(errors > 0 ? 5 : 0);
