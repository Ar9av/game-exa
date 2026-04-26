#!/usr/bin/env node
// Lightweight syntactic + reference checks on a generated Game.js.
// Usage: node validate_code.mjs <file.js> <manifest.json>
import { readFile } from 'node:fs/promises';

const [fileArg, manifestArg] = process.argv.slice(2);
if (!fileArg || !manifestArg) { console.error('usage: validate_code.mjs <file.js> <manifest.json>'); process.exit(2); }

const src = await readFile(fileArg, 'utf8');
const manifest = JSON.parse(await readFile(manifestArg, 'utf8'));
const validKeys = new Set(manifest.sprites.flatMap((s) => s.rows.flatMap((r) => s.cols.map((c) => `${r}-${c}`))));

const errors = [];
const warnings = [];
try {
  // Use dynamic import via data URL to confirm it parses (won't actually run Phaser).
  // Alternative: use a real parser. Function constructor is simplest for syntax check.
  new Function(src.replace(/^import .*?;?$/gm, '').replace(/^export default /m, ''));
} catch (e) {
  errors.push(`syntax: ${e.message}`);
}

if (!/export\s+default\s+class/.test(src)) errors.push('no `export default class`');
if (!/key:\s*['"]Game['"]/.test(src)) errors.push("scene key must be 'Game'");
if (!/scene-ready/.test(src)) errors.push("must emit 'scene-ready'");
if (!/window\.__gameState/.test(src)) errors.push('must update window.__gameState');
if (/Math\.random\(/.test(src)) warnings.push('Math.random() — prefer Phaser.Math.RND for determinism');

const animRefs = [...src.matchAll(/['"`]([A-Z][A-Z0-9_]*)-([a-z][a-z]+)['"`]/g)].map((m) => `${m[1]}-${m[2]}`);
const unknown = [...new Set(animRefs)].filter((k) => !validKeys.has(k));
if (unknown.length) errors.push(`unknown anim keys: ${unknown.join(', ')}`);

if (errors.length) { console.error('INVALID:\n  - ' + errors.join('\n  - ')); process.exit(1); }
console.log(JSON.stringify({ ok: true, warnings, animRefs: animRefs.length }));
