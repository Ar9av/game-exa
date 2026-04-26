#!/usr/bin/env node
// Validate levels JSON against a GDD's palette and entity list.
// Usage: node validate_levels.mjs <levels.json> <gdd.json>
import { readFile } from 'node:fs/promises';

const [levelsArg, gddArg] = process.argv.slice(2);
if (!levelsArg || !gddArg) { console.error('usage: validate_levels.mjs <levels.json> <gdd.json>'); process.exit(2); }

const levels = JSON.parse(await readFile(levelsArg, 'utf8'));
const gdd = JSON.parse(await readFile(gddArg, 'utf8'));
const palette = gdd.tilesetPalette;
const playerId = gdd.entities.find((e) => e.kind === 'player')?.id;
const validIds = new Set(gdd.entities.map((e) => e.id));

const errors = [];
if (!Array.isArray(levels) || levels.length === 0) errors.push('levels empty');
for (const lvl of levels ?? []) {
  const [w, h] = lvl.size;
  if (lvl.tiles.length !== h) errors.push(`level ${lvl.id}: rows ${lvl.tiles.length} != ${h}`);
  for (let y = 0; y < lvl.tiles.length; y++) {
    if (lvl.tiles[y].length !== w) errors.push(`level ${lvl.id}: row ${y} width ${lvl.tiles[y].length} != ${w}`);
    for (let x = 0; x < lvl.tiles[y].length; x++) {
      const v = lvl.tiles[y][x];
      if (!Number.isInteger(v) || v < 0 || v >= palette.length) {
        errors.push(`level ${lvl.id}: tile (${x},${y})=${v} out of palette range`);
      }
    }
  }
  const playerSpawns = lvl.spawns.filter((s) => s.entity === playerId);
  if (playerSpawns.length !== 1) errors.push(`level ${lvl.id}: ${playerSpawns.length} player spawns (need 1)`);
  for (const s of lvl.spawns ?? []) {
    if (!validIds.has(s.entity)) errors.push(`level ${lvl.id}: unknown entity ${s.entity}`);
    if (s.x < 0 || s.x >= w || s.y < 0 || s.y >= h) errors.push(`level ${lvl.id}: spawn ${s.entity} OOB (${s.x},${s.y})`);
    else if (!palette[lvl.tiles[s.y][s.x]].passable) errors.push(`level ${lvl.id}: spawn ${s.entity} on impassable tile`);
  }
}
if (errors.length) { console.error('INVALID:\n  - ' + errors.join('\n  - ')); process.exit(1); }
console.log(JSON.stringify({ ok: true, levels: levels.length, sizes: levels.map((l) => l.size) }));
