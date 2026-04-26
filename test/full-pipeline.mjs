#!/usr/bin/env node
/**
 * Full-pipeline test driving everything except the LLM agents.
 * Substitutes hand-crafted GDD/levels/code so we can validate sprites,
 * tilesets, manifest writing, and the QA harness end-to-end.
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { saveState, emptyState } from '../src/lib/state.js';
import { renderTemplate } from '../src/lib/template.js';
import { generateSpritesProcedural, generateTileset } from '../src/lib/sprites.js';
import { spawnDevServer } from '../src/lib/server.js';
import { runQA } from '../src/qa/runner.js';
import { GDD, LEVELS, GAME_JS } from './fixtures/slime-slayer.js';

const TEST_DIR = '/tmp/gameforge-test/slime-slayer';

const log = {
  info: (...a) => console.log('  ', ...a),
  success: (...a) => console.log('✔', ...a),
  warn: (...a) => console.warn('!', ...a),
  emit: (e, d) => console.log('→', e, d ?? ''),
};

console.log('→ wiping', TEST_DIR);
await rm(TEST_DIR, { recursive: true, force: true });

console.log('→ scaffolding template');
await renderTemplate('phaser-game', TEST_DIR, { name: 'slime-slayer', title: 'Slime Slayer' });

await new Promise((res, rej) => {
  const p = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: TEST_DIR, stdio: 'inherit' });
  p.on('close', (c) => c === 0 ? res() : rej(new Error(`npm install ${c}`)));
});

console.log('→ saving state');
const state = emptyState({ name: 'slime-slayer', prompt: 'pixel knight collects gems', genre: GDD.genre });
state.gdd = GDD;
state.levels = LEVELS;
await saveState(TEST_DIR, state);

console.log('→ generating procedural sprites');
const assetsDir = resolve(TEST_DIR, 'public', 'assets');
const dataDir = resolve(TEST_DIR, 'public', 'data');
await mkdir(assetsDir, { recursive: true });
await mkdir(dataDir, { recursive: true });
const { sprites } = await generateSpritesProcedural({
  entities: GDD.entities,
  outDir: assetsDir,
  relDir: 'assets',
  log,
});

console.log('→ generating tileset');
const tileset = await generateTileset({
  palette: GDD.tilesetPalette,
  outPath: resolve(assetsDir, 'tiles.png'),
  tileSize: 16,
});

console.log('→ writing manifest + levels + Game.js');
const manifest = {
  sprites: sprites.map((s, i) => ({ ...s, textureKey: `entities-${i + 1}` })),
  tiles: { relSheet: 'assets/tiles.png', tileSize: tileset.tileSize, ids: tileset.ids, passable: GDD.tilesetPalette.map((t) => !!t.passable) },
};
await writeFile(resolve(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(resolve(dataDir, 'levels.json'), JSON.stringify(LEVELS, null, 2));
await writeFile(resolve(TEST_DIR, 'src', 'scenes', 'Game.js'), GAME_JS);

state.assets = { sprites: manifest.sprites, tiles: manifest.tiles };
await saveState(TEST_DIR, state);

console.log('→ spawning dev server');
const server = await spawnDevServer({ projectDir: TEST_DIR, port: 5175, log });
console.log('  ready:', server.url);

let exitCode = 0;
try {
  console.log('→ running QA');
  const report = await runQA({ projectDir: TEST_DIR, url: server.url, gdd: GDD, updateBaselines: true, log });
  console.log('===== QA REPORT =====');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) exitCode = 5;
} finally {
  await server.kill();
}
process.exit(exitCode);
