#!/usr/bin/env node
/**
 * Polish loop: take a fixture, generate real GPT Image 2 assets (sprites +
 * tiles + bg per genre), wire them into the example dir, boot headless,
 * screenshot. Used to iteratively get each example looking like a real game.
 *
 * Usage:
 *   node test/build-polished.mjs <fixture-name> [port] [--no-fal]    # uses fixture name
 *   node test/build-polished.mjs <fixture-name> [port] --skip-sprites
 *   node test/build-polished.mjs <fixture-name> [port] --skip-bg
 *
 * Examples:
 *   node test/build-polished.mjs star-defender 5191
 *   node test/build-polished.mjs slime-slayer 5192 --skip-bg
 */
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { saveState, emptyState } from '../src/lib/state.js';
import { renderTemplate } from '../src/lib/template.js';
import { generateTileset } from '../src/lib/sprites.js';
import { spawnDevServer } from '../src/lib/server.js';
import { bootGame, snapshotCanvas, smoke } from '../src/qa/harness.js';

const args = process.argv.slice(2);
const fixtureName = args[0];
const port = parseInt(args[1] && !args[1].startsWith('--') ? args[1] : '5190', 10);
const noFal = args.includes('--no-fal');
const skipSprites = args.includes('--skip-sprites');
const skipTiles = args.includes('--skip-tiles');
const skipBg = args.includes('--skip-bg');

if (!fixtureName) {
  console.error('usage: node test/build-polished.mjs <fixture> [port] [--skip-sprites] [--skip-tiles] [--skip-bg] [--no-fal]');
  process.exit(2);
}

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', fixtureName);
const fixture = await import(`./fixtures/${fixtureName}.js`);
const { GDD, LEVELS } = fixture;

const log = (...a) => console.log('  ', ...a);

async function findFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const envFile = join(process.env.HOME, '.all-skills', '.env');
  if (existsSync(envFile)) {
    const raw = await readFile(envFile, 'utf8');
    const m = raw.match(/^\s*FAL_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

async function fal(prompt, w, h) {
  const key = await findFalKey();
  if (!key) throw new Error('FAL_KEY not found');
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({ prompt, image_size: { width: w, height: h }, quality: 'low', num_images: 1, output_format: 'png' }),
  });
  if (!res.ok) throw new Error(`GPT Image 2 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return Buffer.from(await fetch(data.images[0].url).then((r) => r.arrayBuffer()));
}

async function chromaKey(buf) {
  const meta = await sharp(buf).metadata();
  const raw = await sharp(buf).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) raw[i + 3] = 0;
  }
  return sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer();
}

// ============================================================================
// 1. Scaffold the example dir
// ============================================================================
console.log(`\n=== Scaffolding ${EXAMPLE_DIR} ===`);
await rm(EXAMPLE_DIR, { recursive: true, force: true });
await renderTemplate('phaser-game', EXAMPLE_DIR, { name: fixtureName, title: GDD.title });

console.log('Installing deps...');
await new Promise((res, rej) => {
  const p = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: EXAMPLE_DIR, stdio: 'inherit' });
  p.on('close', (c) => c === 0 ? res() : rej(new Error(`npm install ${c}`)));
});

// ============================================================================
// 2. Trim entity states to filter-safe set (drop "hurt" — content filter trips on it)
// ============================================================================
const SAFE_STATES = new Set(['idle', 'walk', 'jump', 'cast', 'block', 'victory']);
const trimmedEntities = GDD.entities.map((e) => ({
  ...e,
  states: e.states.filter((s) => SAFE_STATES.has(s)),
})).map((e) => ({
  ...e,
  states: e.states.length === 0 ? ['idle'] : e.states,
}));

const safeGdd = { ...GDD, entities: trimmedEntities };
const state = emptyState({ name: fixtureName, prompt: GDD.tagline, genre: GDD.genre });
state.gdd = safeGdd;
state.levels = LEVELS;
await saveState(EXAMPLE_DIR, state);

// ============================================================================
// 3. Generate sprite sheet via GPT Image 2
// ============================================================================
const ASSETS_DIR = join(EXAMPLE_DIR, 'public', 'assets');
const DATA_DIR = join(EXAMPLE_DIR, 'public', 'data');
await mkdir(ASSETS_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });

const COLS_ORDER = ['idle', 'walk', 'jump', 'cast', 'block', 'victory'];
const allStates = new Set();
trimmedEntities.forEach((e) => e.states.forEach((s) => allStates.add(s)));
const cols = COLS_ORDER.filter((s) => allStates.has(s));
const rows = trimmedEntities.length;

let cellSrc;
function pickCell(rows, cols) {
  for (let cell = 480; cell >= 96; cell -= 16) {
    const w = cols * cell, h = rows * cell;
    if (w % 16 || h % 16) continue;
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > 3) continue;
    const px = w * h;
    if (px < 655360 || px > 8294400) continue;
    return cell;
  }
  throw new Error(`No valid cell for ${rows}x${cols}`);
}
cellSrc = pickCell(rows, cols.length);

const SHEET_PATH = join(ASSETS_DIR, 'entities.png');
const cellOut = 32;     // displayed cell size; sprites are downscaled to 32x32 per cell

if (!skipSprites && !noFal) {
  console.log(`\n=== GPT Image 2: sprite sheet (${rows}r × ${cols.length}c, ${cellSrc}px source → ${cellOut}px out) ===`);
  const colsHint = cols.map((c) => c === 'idle' ? 'standing' : c === 'walk' ? 'mid-step / drifting' : c === 'jump' ? 'mid-air' : c).join(', ');
  const rowsBlock = trimmedEntities.map((e, i) =>
    `Row ${i + 1}: ${e.desc.toLowerCase()} (${e.color} color scheme), ${cols.length} frames showing ${colsHint}.`
  ).join('\n');

  const prompt = `A pixel art sprite sheet on a solid bright magenta background, color #FF00FF.

The image is exactly ${cols.length * cellSrc} by ${rows * cellSrc} pixels, arranged as a ${cols.length}-column by ${rows}-row grid of equal ${cellSrc} by ${cellSrc} cells.

${rowsBlock}

Columns left to right: ${cols.join(', ')}.

Style rules:
- Chunky 8-bit pixel art with limited palette per character.
- No anti-aliasing on outlines.
- Strict grid alignment, no bleed between cells.
- No text, no numbers, no labels.
- Background must be exactly #FF00FF magenta everywhere outside the characters.
- Each character is centered in its cell with a few pixels of magenta breathing room.
`;
  const buf = await fal(prompt, cols.length * cellSrc, rows * cellSrc);
  const small = await sharp(buf).resize(cols.length * cellOut, rows * cellOut, { kernel: 'nearest' }).png().toBuffer();
  const stripped = await chromaKey(small);
  await writeFile(SHEET_PATH, stripped);
  log('saved', SHEET_PATH);
} else if (!skipSprites) {
  // No FAL — fall back to procedural via the existing helper (small + colored)
  const { generateSpritesProcedural } = await import('../src/lib/sprites.js');
  await generateSpritesProcedural({ entities: trimmedEntities, outDir: ASSETS_DIR, relDir: 'assets', log: { info: log } });
}

// ============================================================================
// 4. Generate tileset (GPT Image 2 if bg present, else opaque procedural-fancy)
// ============================================================================
const TILES_PATH = join(ASSETS_DIR, 'tiles.png');
const palette = GDD.tilesetPalette;
const wantsBg = !!{ 'platformer': true, 'shoot-em-up': true, 'twin-stick-shooter': true, 'dungeon-crawler': true }[GDD.genre] && !skipBg;

if (!skipTiles && !noFal && palette.length <= 4) {
  console.log(`\n=== GPT Image 2: tileset (${palette.length} tiles, bg=${wantsBg ? 'yes' : 'no'}) ===`);
  const cellSrcTile = 416;
  const slots = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const cellPrompts = palette.map((p, i) => {
    if (wantsBg && p.passable) {
      return `${slots[i]} cell: completely empty, leave the entire ${cellSrcTile}x${cellSrcTile} cell as solid #FF00FF magenta with nothing drawn in it.`;
    }
    return `${slots[i]} cell: a ${p.color} ${p.id.toLowerCase().replace(/_/g, ' ')} tile, filling the entire ${cellSrcTile}x${cellSrcTile} cell edge to edge with no magenta showing through. Detailed pixel-art texture appropriate for the tile type.`;
  });
  while (cellPrompts.length < 4) cellPrompts.push(`${slots[cellPrompts.length]} cell: completely empty, leave the entire ${cellSrcTile}x${cellSrcTile} cell as solid #FF00FF magenta.`);

  const tilePrompt = `A pixel art tileset on a solid bright magenta background, color #FF00FF.

The image is exactly ${cellSrcTile * 2} by ${cellSrcTile * 2} pixels, arranged as a 2-column by 2-row grid of equal ${cellSrcTile} by ${cellSrcTile} cells.

${cellPrompts.join('\n\n')}

Strict pixel art, chunky pixels, no anti-aliasing on edges, vivid 8-bit retro color palette, no text or labels. Each non-magenta cell completely fills its ${cellSrcTile}x${cellSrcTile} area edge to edge.`;

  const tileBuf = await fal(tilePrompt, cellSrcTile * 2, cellSrcTile * 2);
  const tileOut = 32;
  const small = await sharp(tileBuf).resize(tileOut * 2, tileOut * 2, { kernel: 'nearest' }).png().toBuffer();
  const final = await chromaKey(small);
  await writeFile(TILES_PATH, final);
  log('saved', TILES_PATH);
} else if (!skipTiles) {
  // Procedural fallback
  await generateTileset({ palette, outPath: TILES_PATH, tileSize: 32 });
}

// ============================================================================
// 5. Generate background (GPT Image 2, if genre wants it)
// ============================================================================
const BG_PATH = join(ASSETS_DIR, 'bg.png');
let bgManifest = null;

const BG_THEMES = {
  'platformer': `daytime outdoor scene. A soft pastel blue sky filling the upper two thirds of the frame. A few large fluffy white pixel-art clouds drifting at different heights. Distant rolling green hills in silhouette across the lower third, layered for depth (lighter hills in back, darker hills in front).`,
  'shoot-em-up': `outer space scene. A deep dark navy and black space backdrop. Scattered tiny star pixels at three different brightness levels distributed across the frame. One or two large soft nebula clouds in distant purples and blues, blurry and diffuse. A small distant planet silhouette on one side.`,
  'twin-stick-shooter': `outer space scene. Deep dark navy and black backdrop with scattered stars at varied brightness, two soft nebula clouds in purple and blue.`,
  'dungeon-crawler': `underground cave interior. A dark damp stone cave wall texture filling the entire frame. Subtle vertical streaks suggesting natural rock striations. A faint warm torch glow in the upper-left, fading into deeper shadow toward the right.`,
};

if (wantsBg && !noFal) {
  const themeDesc = BG_THEMES[GDD.genre];
  if (themeDesc) {
    console.log(`\n=== GPT Image 2: background (${GDD.genre}) ===`);
    const bgPrompt = `A wide pixel art parallax background, ${themeDesc}

The image is exactly 1280 by 768 pixels.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, vivid clean colors. No characters, no foreground objects, no text, no UI, no borders. Just the scenic background.`;
    const buf = await fal(bgPrompt, 1280, 768);
    const small = await sharp(buf).resize(480, 288, { kernel: 'nearest' }).png().toBuffer();
    await writeFile(BG_PATH, small);
    bgManifest = { relPath: 'assets/bg.png', scrollFactor: 0.3, theme: GDD.genre };
    log('saved', BG_PATH);
  }
}

// ============================================================================
// 6. Write manifest + levels + Game.js
// ============================================================================
const manifest = {
  sprites: [{
    sheet: SHEET_PATH,
    relSheet: 'assets/entities.png',
    rows: trimmedEntities.map((e) => e.id),
    cols,
    cell: cellOut,
    bg: 'magenta',
    textureKey: 'entities-1',
  }],
  tiles: {
    relSheet: 'assets/tiles.png',
    tileSize: 32,
    ids: palette.map((p) => p.id),
    passable: palette.map((p) => !!p.passable),
  },
};
if (bgManifest) manifest.bg = bgManifest;
await writeFile(join(ASSETS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(DATA_DIR, 'levels.json'), JSON.stringify(LEVELS, null, 2));

// Use the polished Game.js pattern: pull from the fixture, but inject sf-scaled physics.
// For now, write the fixture's GAME_JS verbatim; if it doesn't have polish, the screenshot
// will tell us and we iterate.
await writeFile(join(EXAMPLE_DIR, 'src', 'scenes', 'Game.js'), fixture.GAME_JS);

state.assets = { sprites: manifest.sprites, tiles: manifest.tiles, bg: bgManifest };
await saveState(EXAMPLE_DIR, state);

// ============================================================================
// 7. Boot + screenshot
// ============================================================================
console.log('\n=== Booting headless ===');
const server = await spawnDevServer({ projectDir: EXAMPLE_DIR, port, log: { verbose: false } });
log('server:', server.url);

let exitCode = 0;
try {
  const { browser, page, errors } = await bootGame(server.url);
  await page.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 120 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  const obs = await smoke(page);
  const shot = await snapshotCanvas(page);
  const outPng = `/tmp/gameforge-test/${fixtureName}-polished.png`;
  await writeFile(outPng, shot);

  console.log('\n=== Result ===');
  console.log('errors:', errors.length, errors.slice(0, 3));
  console.log('observations:', JSON.stringify(obs));
  console.log('screenshot:', outPng);

  // Quick input drive
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  if (GDD.genre === 'platformer') { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
  const after = await page.evaluate(() => window.__gameState);
  console.log('after-input state:', JSON.stringify(after));

  await browser.close();
  if (errors.length || !obs.booted) exitCode = 1;
} finally {
  await server.kill();
}
process.exit(exitCode);
