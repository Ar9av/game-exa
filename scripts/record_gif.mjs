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

// Focus canvas for keyboard input
const canvas = page.locator('canvas');
await canvas.click();

console.log('   Game ready — running automation...');

// ── Automation: hold Z to fire, zigzag movement ──────────────────────────────

const moveStep = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

// Hold Z (fire) for entire duration
page.keyboard.down('z');

const elapsed = { v: 0 };
const start = Date.now();

// Zigzag pattern: left → right → left ... while slowly drifting
const pattern = async () => {
  const moves = [
    { key: 'ArrowLeft',  ms: 280 },
    { key: 'ArrowRight', ms: 320 },
    { key: 'ArrowLeft',  ms: 240 },
    { key: 'ArrowUp',    ms: 180 },
    { key: 'ArrowRight', ms: 280 },
    { key: 'ArrowDown',  ms: 160 },
    { key: 'ArrowRight', ms: 300 },
    { key: 'ArrowLeft',  ms: 260 },
    { key: 'ArrowUp',    ms: 200 },
    { key: 'ArrowLeft',  ms: 240 },
  ];

  while (Date.now() - start < DURATION - 1500) {
    for (const m of moves) {
      if (Date.now() - start >= DURATION - 1500) break;
      await moveStep(m.key, m.ms);
      await page.waitForTimeout(40);
    }
    // Use bomb once mid-run
    const elapsed2 = Date.now() - start;
    if (elapsed2 > 5000 && elapsed2 < 6000) {
      await page.keyboard.press('x');
    }
  }
};

await pattern();
await page.keyboard.up('z');

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
