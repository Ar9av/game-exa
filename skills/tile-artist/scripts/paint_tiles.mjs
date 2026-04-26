#!/usr/bin/env node
// Paint a tileset PNG from gdd.tilesetPalette and update manifest.
// Usage: node paint_tiles.mjs <project-dir> [--tile-size 16]
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { generateTileset } from '../../../src/lib/sprites.js';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const tileSize = parseInt(args[args.indexOf('--tile-size') + 1] || '16', 10);

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd?.tilesetPalette) { console.error('no tileset palette in GDD'); process.exit(3); }

const assetsDir = join(projectDir, 'public', 'assets');
await mkdir(assetsDir, { recursive: true });
const tileset = await generateTileset({ palette: state.gdd.tilesetPalette, outPath: join(assetsDir, 'tiles.png'), tileSize });

const tiles = {
  relSheet: 'assets/tiles.png',
  tileSize,
  ids: tileset.ids,
  passable: state.gdd.tilesetPalette.map((t) => !!t.passable),
};
state.assets = state.assets || { sprites: [] };
state.assets.tiles = tiles;
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

const manifestPath = join(assetsDir, 'manifest.json');
let manifest = { sprites: [], tiles: null };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
manifest.tiles = tiles;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({ ok: true, tiles: tileset.ids.length, tileSize }));
