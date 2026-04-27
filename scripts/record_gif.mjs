/**
 * Records a gameplay GIF from a running Phaser game.
 * Launches headless Chromium, automates player input, captures video, converts to GIF.
 *
 * Usage:
 *   node scripts/record_gif.mjs --url http://127.0.0.1:5183 --out /tmp/game.gif --duration 14
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args    = process.argv.slice(2);
const getArg  = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };

const URL_ARG  = getArg('--url',      'http://127.0.0.1:5183');
const OUT_PATH = getArg('--out',      '/tmp/nova-blitz.gif');
const DURATION = parseInt(getArg('--duration', '14'), 10) * 1000;
const WIDTH    = parseInt(getArg('--width',    '480'), 10);
const HEIGHT   = parseInt(getArg('--height',   '360'), 10);
const WEBM_PATH = OUT_PATH.replace(/\.gif$/, '.webm');
const MP4_PATH  = OUT_PATH.replace(/\.gif$/, '.mp4');

console.log(`🎬 Recording ${DURATION / 1000}s of gameplay from ${URL_ARG}`);
console.log(`   Output: ${OUT_PATH}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  recordVideo: { dir: '/tmp/nova-blitz-video/', size: { width: WIDTH, height: HEIGHT } },
});

const page = await context.newPage();
await page.goto(URL_ARG, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Wait for the Game scene to be ready (uses window.__game and window.__gameReady)
await page.waitForFunction(() => window.__gameReady === true, { timeout: 15000 }).catch(() => {});

// Helper: inject Phaser input state directly via window.__game
const injectInput = (dir, isDown) => page.evaluate(({ dir, isDown }) => {
  const g = window.__game;
  if (!g) return false;
  const scene = g.scene.scenes.find(s => s.sys.settings.key === 'Game' && s.sys.isActive());
  if (!scene) return false;
  if (dir === 'fire') { scene.zKey.isDown = isDown; return true; }
  if (dir === 'bomb') { if (isDown) scene._bombBlast?.(); return true; }
  const map = { left: 'left', right: 'right', up: 'up', down: 'down' };
  if (map[dir] && scene.cursors) { scene.cursors[map[dir]].isDown = isDown; return true; }
  return false;
}, { dir, isDown });

console.log('   Game ready — running automation...');

const start = Date.now();
let bombUsed = false;

// Start continuous firing via interval
const fireInterval = setInterval(() => injectInput('fire', true), 50);

const moveStep = async (dir, ms) => {
  await injectInput(dir, true);
  await page.waitForTimeout(ms);
  await injectInput(dir, false);
  await page.waitForTimeout(30);
};

const moves = [
  { dir: 'left',  ms: 300 }, { dir: 'right', ms: 350 },
  { dir: 'left',  ms: 250 }, { dir: 'up',    ms: 200 },
  { dir: 'right', ms: 300 }, { dir: 'down',  ms: 180 },
  { dir: 'right', ms: 320 }, { dir: 'left',  ms: 270 },
  { dir: 'up',    ms: 220 }, { dir: 'left',  ms: 260 },
];

let mi = 0;
while (Date.now() - start < DURATION - 1000) {
  const m = moves[mi % moves.length];
  mi++;
  await moveStep(m.dir, m.ms);

  const elapsed2 = Date.now() - start;
  if (!bombUsed && elapsed2 > 5500 && elapsed2 < 6500) {
    bombUsed = true;
    console.log('   Dropping nova bomb...');
    await injectInput('bomb', true);
    await page.waitForTimeout(120);
    await injectInput('bomb', false);
  }
}

clearInterval(fireInterval);
await injectInput('fire', false);

// Final screenshot
await page.screenshot({ path: OUT_PATH.replace('.gif', '-final.png') });
console.log('   Captured final frame');

await context.close();
await browser.close();

// ── Convert video → GIF via ffmpeg ──────────────────────────────────────────

// Find the recorded webm
const videoDir = '/tmp/nova-blitz-video/';
const files = execSync(`ls -t ${videoDir}`).toString().trim().split('\n').filter(f => f.endsWith('.webm'));
if (files.length === 0) {
  console.error('No video file found in /tmp/nova-blitz-video/');
  process.exit(1);
}
const videoPath = join(videoDir, files[0]);
console.log(`\n🎞  Converting ${videoPath} → GIF...`);

// Two-pass GIF: first generate palette, then apply
const palette = '/tmp/nova-blitz-palette.png';

try {
  // Step 1: palette
  execSync(
    `ffmpeg -y -i "${videoPath}" -vf "fps=18,scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "${palette}"`,
    { stdio: 'pipe' }
  );
  // Step 2: apply palette (high-quality dither)
  execSync(
    `ffmpeg -y -i "${videoPath}" -i "${palette}" -lavfi "fps=18,scale=${WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${OUT_PATH}"`,
    { stdio: 'pipe' }
  );
  const sizeMB = (execSync(`stat -f%z "${OUT_PATH}"`).toString().trim() / 1024 / 1024).toFixed(1);
  console.log(`✅ GIF saved: ${OUT_PATH}  (${sizeMB} MB)`);
} catch (err) {
  // Fallback: simple single-pass
  console.warn('   Palette method failed, using simple conversion...');
  execSync(`ffmpeg -y -i "${videoPath}" -vf "fps=15,scale=${WIDTH}:-1:flags=lanczos" "${OUT_PATH}"`, { stdio: 'pipe' });
  console.log(`✅ GIF saved: ${OUT_PATH} (simple)`);
}
