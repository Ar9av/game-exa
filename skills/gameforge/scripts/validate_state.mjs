#!/usr/bin/env node
// Validate game-state.json schema + invariants.
// Usage: node validate_state.mjs <project-dir>
import { loadState } from '../../../src/lib/state.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: validate_state.mjs <project-dir>'); process.exit(2); }

const state = await loadState(dir);
const errors = [];
if (state.version !== 1) errors.push(`version mismatch: ${state.version}`);
if (!state.name) errors.push('name missing');
if (state.gdd) {
  const players = (state.gdd.entities ?? []).filter((e) => e.kind === 'player');
  if (players.length !== 1) errors.push(`expected exactly 1 player, found ${players.length}`);
  if ((state.gdd.tilesetPalette ?? []).length < 2) errors.push('tilesetPalette < 2');
}
if (state.levels?.length && state.gdd) {
  for (const lvl of state.levels) {
    const [w, h] = lvl.size;
    if (lvl.tiles.length !== h) errors.push(`level ${lvl.id}: tile rows ${lvl.tiles.length} != ${h}`);
    for (const row of lvl.tiles) {
      if (row.length !== w) { errors.push(`level ${lvl.id}: tile row width != ${w}`); break; }
    }
  }
}
if (errors.length) { console.error('INVALID:\n  - ' + errors.join('\n  - ')); process.exit(1); }
console.log(JSON.stringify({ ok: true, hasGdd: !!state.gdd, levels: state.levels?.length ?? 0, sprites: state.assets?.sprites?.length ?? 0 }));
