#!/usr/bin/env node
// Validate a GDD JSON against the schema. Reads file (or stdin if -) and exits 0 if valid.
// Usage: node validate_gdd.mjs <gdd.json | ->
import { readFile } from 'node:fs/promises';

const arg = process.argv[2];
if (!arg) { console.error('usage: validate_gdd.mjs <file | ->'); process.exit(2); }

let raw;
if (arg === '-') {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  raw = Buffer.concat(chunks).toString('utf8');
} else {
  raw = await readFile(arg, 'utf8');
}
let gdd;
try { gdd = JSON.parse(raw); } catch (e) { console.error('not valid JSON:', e.message); process.exit(1); }

const errors = [];
if (!gdd.title) errors.push('title missing');
if (!gdd.genre) errors.push('genre missing');
if (!Array.isArray(gdd.entities) || gdd.entities.length === 0) errors.push('entities empty');
const players = (gdd.entities ?? []).filter((e) => e.kind === 'player');
if (players.length !== 1) errors.push(`exactly 1 player required (found ${players.length})`);
if (gdd.entities && gdd.entities.length > 9) errors.push(`max 9 entities (sprite-sheet limit), found ${gdd.entities.length}`);
for (const e of gdd.entities ?? []) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(e.id ?? '')) errors.push(`entity id not SCREAMING_SNAKE_CASE: ${e.id}`);
  if (!Array.isArray(e.states) || !e.states.includes('idle')) errors.push(`entity ${e.id} missing 'idle' state`);
}
if (!Array.isArray(gdd.tilesetPalette) || gdd.tilesetPalette.length < 2) errors.push('tilesetPalette < 2 entries');
if (!gdd.levelHints || !Array.isArray(gdd.levelHints.size)) errors.push('levelHints.size missing');
else {
  const [w, h] = gdd.levelHints.size;
  if (w < 8 || w > 40 || h < 8 || h > 40) errors.push(`level size out of [8,40]: ${w}x${h}`);
}
if (errors.length) { console.error('INVALID:\n  - ' + errors.join('\n  - ')); process.exit(1); }
console.log(JSON.stringify({ ok: true, title: gdd.title, genre: gdd.genre, entities: gdd.entities.length }));
