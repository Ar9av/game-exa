#!/usr/bin/env node
// Boot the game with Phaser physics debug enabled, capture physics body positions,
// screenshot the debug overlay, emit a structured body alignment report.
// Usage: node validate_physics.mjs <project-dir> [--port N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const portFlagIdx = args.indexOf('--port');
let port = portFlagIdx >= 0 ? parseInt(args[portFlagIdx + 1]) : 0;

async function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => res(p)); });
    srv.on('error', rej);
  });
}

if (!port) port = await getFreePort();

const qaDir = join(projectDir, 'qa');
await mkdir(qaDir, { recursive: true });

// Start vite dev server
const vite = spawn('node', ['node_modules/.bin/vite', '--port', String(port), '--strictPort'], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverReady = new Promise((res, rej) => {
  const timeout = setTimeout(() => rej(new Error('vite server timeout')), 30000);
  const onData = (chunk) => {
    const txt = chunk.toString().replace(/\x1b\[[0-9;]*m/g, '');
    if (txt.includes('Local:') || txt.includes('localhost')) {
      clearTimeout(timeout);
      vite.stdout.off('data', onData);
      res();
    }
  };
  vite.stdout.on('data', onData);
  vite.stderr.on('data', onData);
  vite.on('exit', (code) => { clearTimeout(timeout); rej(new Error(`vite exited ${code}`)); });
});

let browser, result;
try {
  await serverReady;

  browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();

  // Inject script to enable physics debug after game is ready
  await page.addInitScript(() => {
    window.__physicsDebugRequested = true;
  });

  await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Wait for game to be ready
  await page.waitForFunction(() => window.__gameReady === true, { timeout: 20000 });

  // Enable Phaser arcade debug on the live game instance
  await page.evaluate(() => {
    const g = window.__game;
    if (!g?.physics?.world) return;
    g.physics.world.drawDebug = true;
    if (!g.physics.world.debugGraphic) {
      g.physics.world.createDebugGraphic();
    }
    g.physics.world.debugGraphic.clear();
  });

  // Wait one frame for debug graphics to render
  await page.waitForTimeout(500);

  // Capture debug screenshot
  const screenshotBuf = await page.locator('canvas').screenshot();
  const screenshotPath = join(qaDir, 'physics-debug.png');
  await writeFile(screenshotPath, screenshotBuf);

  // Extract body metadata from live Phaser world
  const bodies = await page.evaluate(() => {
    const g = window.__game;
    if (!g?.physics?.world) return [];
    const results = [];
    g.physics.world.bodies.iterate((body) => {
      const go = body.gameObject;
      if (!go) return;
      const label = go.name || go.texture?.key || 'unknown';
      results.push({
        label,
        bodyX: Math.round(body.x),
        bodyY: Math.round(body.y),
        bodyW: Math.round(body.width),
        bodyH: Math.round(body.height),
        spriteX: Math.round(go.x),
        spriteY: Math.round(go.y),
        spriteW: Math.round(go.displayWidth ?? go.width ?? 0),
        spriteH: Math.round(go.displayHeight ?? go.height ?? 0),
        offsetX: Math.round(body.offset?.x ?? 0),
        offsetY: Math.round(body.offset?.y ?? 0),
      });
    });
    return results;
  });

  // Analyze alignment: flag bodies where center is more than 30% of sprite dimension off
  const annotated = bodies.map((b) => {
    const spriteCX = b.spriteX;
    const spriteCY = b.spriteY;
    const bodyCX = b.bodyX + b.bodyW / 2;
    const bodyCY = b.bodyY + b.bodyH / 2;
    const dx = Math.abs(bodyCX - spriteCX);
    const dy = Math.abs(bodyCY - spriteCY);
    const threshold = Math.max(b.spriteW, b.spriteH, 16) * 0.3;
    const aligned = dx <= threshold && dy <= threshold;
    const entry = { ...b, aligned };
    if (!aligned) {
      entry.issue = `body center offset (${Math.round(dx)}px X, ${Math.round(dy)}px Y) exceeds 30% of sprite size`;
    }
    return entry;
  });

  const misalignedCount = annotated.filter((b) => !b.aligned).length;
  result = {
    ok: true,
    screenshotPath: 'qa/physics-debug.png',
    bodies: annotated,
    misalignedCount,
  };

  await writeFile(join(qaDir, 'physics-bodies.json'), JSON.stringify(result, null, 2));
} catch (err) {
  result = { ok: false, error: err.message };
} finally {
  await browser?.close();
  vite.kill();
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 5);
