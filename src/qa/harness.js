import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const VIEWPORT = { width: 800, height: 600 };

const NOISE_PATTERNS = [
  /Failed to load resource:.*404/i,
  /favicon\.ico/i,
  /\[vite\] connecting/i,
  /\[vite\] connected/i,
];

function isNoiseError(text) {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

async function launch() {
  // Prefer system Chrome (no 170MB download). Fall back to bundled Chromium.
  try {
    return await chromium.launch({
      channel: 'chrome',
      args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
    });
  } catch (err) {
    return chromium.launch({
      args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
    });
  }
}

export async function bootGame(url, { log } = {}) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push({ kind: 'exception', message: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isNoiseError(m.text())) {
      errors.push({ kind: 'console-error', message: m.text() });
    }
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__gameReady === true
      && window.__game?.scene?.scenes?.find((s) => s.sys.settings.key === 'Game')?.sys?.settings?.status === 5,
    { timeout: 15_000 },
  ).catch((e) => {
    errors.push({ kind: 'boot-timeout', message: e.message });
  });

  // Focus the canvas so keyboard input flows to Phaser.
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (c) { c.setAttribute('tabindex', '0'); c.focus(); }
  });

  log?.success?.(`booted ${url}`);
  return { browser, ctx, page, errors };
}

export async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export async function pressKey(page, key, ms = 50) {
  // Hold briefly so Phaser's 16ms update loop reliably observes isDown.
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export async function snapshotCanvas(page) {
  return page.locator('canvas').screenshot({ type: 'png' });
}

export async function readGameState(page) {
  return page.evaluate(() => window.__gameState ?? null);
}

export async function smoke(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    const ctx = c?.getContext('webgl2') || c?.getContext('webgl');
    let blank = true;
    if (ctx) {
      const px = new Uint8Array(4);
      try {
        ctx.readPixels(c.width / 2, c.height / 2, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        blank = px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 0;
      } catch { /* WebGL context may have been lost */ }
    }
    const g = window.__game;
    return {
      blank,
      fps: g?.loop?.actualFps ?? 0,
      booted: !!g?.isBooted,
      activeScenes: g?.scene?.scenes?.filter((s) => s.sys.settings.active).map((s) => s.sys.settings.key) ?? [],
      gameState: window.__gameState ?? null,
    };
  });
}

/**
 * Diff buf against baselinePath. If baseline missing OR updateBaselines, write
 * buf as the new baseline and return { status: 'recorded' }.
 */
export async function diffOrRecord({ buf, baselinePath, diffPath, threshold = 0.1, maxRatio = 0.05, updateBaselines = false }) {
  await mkdir(dirname(baselinePath), { recursive: true });
  if (!existsSync(baselinePath) || updateBaselines) {
    await writeFile(baselinePath, buf);
    return { status: 'recorded', ratio: 0 };
  }
  const baselineBuf = await readFile(baselinePath);
  let baseline, actual;
  try {
    baseline = PNG.sync.read(baselineBuf);
    actual = PNG.sync.read(buf);
  } catch (e) {
    await writeFile(baselinePath, buf);
    return { status: 'recorded', ratio: 0, note: 'baseline corrupt — rerecorded' };
  }
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    await mkdir(dirname(diffPath), { recursive: true });
    await writeFile(diffPath, buf);
    return { status: 'fail', ratio: 1, note: `dimension mismatch ${actual.width}x${actual.height} vs baseline ${baseline.width}x${baseline.height}` };
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const mismatched = pixelmatch(
    baseline.data, actual.data, diff.data, baseline.width, baseline.height,
    { threshold, includeAA: false, alpha: 0.3 },
  );
  const ratio = mismatched / (baseline.width * baseline.height);
  if (ratio > maxRatio) {
    await mkdir(dirname(diffPath), { recursive: true });
    await writeFile(diffPath, PNG.sync.write(diff));
    return { status: 'fail', ratio, mismatched };
  }
  return { status: 'pass', ratio, mismatched };
}

export async function freezeGame(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g?.loop?.sleep) g.loop.sleep();
  });
}
