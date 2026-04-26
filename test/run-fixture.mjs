#!/usr/bin/env node
/**
 * Drive any fixture through the deterministic pipeline + QA.
 * Usage: node test/run-fixture.mjs <fixture-name> [port]
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { saveState, emptyState } from '../src/lib/state.js';
import { renderTemplate } from '../src/lib/template.js';
import { generateSpritesProcedural, generateTileset } from '../src/lib/sprites.js';
import { spawnDevServer } from '../src/lib/server.js';
import { runQA } from '../src/qa/runner.js';

const fixtureName = process.argv[2];
const port = parseInt(process.argv[3] ?? '5180', 10);
const updateBaselines = !process.argv.includes('--no-update');
const skipReinit = process.argv.includes('--reuse');
if (!fixtureName) {
  console.error('Usage: node test/run-fixture.mjs <fixture-name> [port]');
  process.exit(2);
}

const TEST_DIR = `/tmp/gameforge-test/${fixtureName}`;
const fixture = await import(`./fixtures/${fixtureName}.js`);
const { GDD, LEVELS, GAME_JS } = fixture;

const log = {
  info: (...a) => console.log('  ', ...a),
  success: (...a) => console.log('✔', ...a),
  warn: (...a) => console.warn('!', ...a),
  emit: (e, d) => console.log('→', e, d ?? ''),
};

if (!skipReinit) {
  console.log('→ wiping', TEST_DIR);
  await rm(TEST_DIR, { recursive: true, force: true });

  console.log('→ scaffolding template');
  await renderTemplate('phaser-game', TEST_DIR, { name: fixtureName, title: GDD.title });

  await new Promise((res, rej) => {
    const p = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: TEST_DIR, stdio: 'inherit' });
    p.on('close', (c) => c === 0 ? res() : rej(new Error(`npm install ${c}`)));
  });

  const state = emptyState({ name: fixtureName, prompt: GDD.tagline, genre: GDD.genre });
  state.gdd = GDD;
  state.levels = LEVELS;
  await saveState(TEST_DIR, state);

  const assetsDir = resolve(TEST_DIR, 'public', 'assets');
  const dataDir = resolve(TEST_DIR, 'public', 'data');
  await mkdir(assetsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const { sprites } = await generateSpritesProcedural({ entities: GDD.entities, outDir: assetsDir, relDir: 'assets', log });
  const tileset = await generateTileset({ palette: GDD.tilesetPalette, outPath: resolve(assetsDir, 'tiles.png'), tileSize: 16 });

  const manifest = {
    sprites: sprites.map((s, i) => ({ ...s, textureKey: `entities-${i + 1}` })),
    tiles: { relSheet: 'assets/tiles.png', tileSize: tileset.tileSize, ids: tileset.ids, passable: GDD.tilesetPalette.map((t) => !!t.passable) },
  };
  await writeFile(resolve(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(resolve(dataDir, 'levels.json'), JSON.stringify(LEVELS, null, 2));
  await writeFile(resolve(TEST_DIR, 'src', 'scenes', 'Game.js'), GAME_JS);
  state.assets = { sprites: manifest.sprites, tiles: manifest.tiles };
  await saveState(TEST_DIR, state);
}

const server = await spawnDevServer({ projectDir: TEST_DIR, port, log });
console.log('  ready:', server.url);

let exitCode = 0;
try {
  const report = await runQA({ projectDir: TEST_DIR, url: server.url, gdd: GDD, updateBaselines, log });
  console.log('===== QA REPORT =====');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) exitCode = 5;
} finally {
  await server.kill();
}
process.exit(exitCode);
