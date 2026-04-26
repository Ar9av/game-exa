#!/usr/bin/env node
// Generate sprite sheets for a project's GDD entities.
// Usage: node generate_sheets.mjs <project-dir> [--placeholder] [--quality low|medium|high]
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { generateSprites, generateSpritesProcedural } from '../../../src/lib/sprites.js';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const placeholder = args.includes('--placeholder');
const quality = args[args.indexOf('--quality') + 1] || 'low';

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd?.entities?.length) { console.error('no GDD entities; run game-designer first'); process.exit(3); }

const assetsDir = join(projectDir, 'public', 'assets');
await mkdir(assetsDir, { recursive: true });

const log = { info: (...a) => console.error(...a), success: (...a) => console.error(...a) };
const result = placeholder
  ? await generateSpritesProcedural({ entities: state.gdd.entities, outDir: assetsDir, relDir: 'assets', log })
  : await generateSprites({ entities: state.gdd.entities, outDir: assetsDir, relDir: 'assets', style: `retro 8-bit pixel-art ${state.gdd.genre}`, quality, cwd: projectDir, log });

const sprites = result.sprites.map((s, i) => ({ ...s, textureKey: `entities-${i + 1}` }));
state.assets = state.assets || {};
state.assets.sprites = sprites;
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

// Merge into manifest.json
const manifestPath = join(assetsDir, 'manifest.json');
let manifest = { sprites: [], tiles: null };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
manifest.sprites = sprites;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({ ok: true, mode: placeholder ? 'procedural' : 'image-gen', sheets: sprites.length }));
