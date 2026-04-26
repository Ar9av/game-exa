#!/usr/bin/env node
// Dynamic playability analysis: drive the game in headless Chromium with a
// fuzzer, detect stuck states, unreachable win conditions, NaN, etc.
// Captures screenshots at intervals for VLM review.
//
// Usage: node dynamic_check.mjs <project-dir> [--port N] [--seconds 30]
import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnDevServer } from '../../../src/lib/server.js';
import { bootGame, snapshotCanvas } from '../../../src/qa/harness.js';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const port = parseInt(args[args.indexOf('--port') + 1] || '5193', 10);
const seconds = parseInt(args[args.indexOf('--seconds') + 1] || '30', 10);

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd) { console.error('no GDD in state'); process.exit(3); }

const isPlatformer = state.gdd.genre === 'platformer';
const ACTIONS_MOVE = isPlatformer ? ['ArrowLeft', 'ArrowRight'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const ACTIONS_BUTTON = ['Space'];

// Identify the win-counter field name from gdd.winCondition string heuristically
const winMatch = state.gdd.winCondition.match(/window\.__gameState\.([a-zA-Z_]+)\s*([><=]+)\s*(-?\d+)/);
const winField = winMatch?.[1];
const winTarget = winMatch ? Number(winMatch[3]) : null;

const SCREENSHOTS_DIR = join(projectDir, 'qa', 'gap-check');
await mkdir(SCREENSHOTS_DIR, { recursive: true });

const issues = [];
const log = (...a) => console.error('  ', ...a);

const server = await spawnDevServer({ projectDir, port, log: { verbose: false } });
log('server:', server.url);

let exitCode = 0;
try {
  const { browser, page, errors } = await bootGame(server.url);
  for (const e of errors) issues.push({ kind: 'boot-error', severity: 'error', message: e.message });

  // Initial state
  await page.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 60 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  await snapshotCanvas(page).then((b) => writeFile(join(SCREENSHOTS_DIR, 't0-boot.png'), b));
  const initialState = await page.evaluate(() => window.__gameState);
  log('initial:', JSON.stringify(initialState));

  // Spawn-trap: player took damage in first second
  await page.waitForTimeout(1000);
  const after1s = await page.evaluate(() => window.__gameState);
  if ((after1s?.playerHp ?? 999) < (initialState?.playerHp ?? 999)) {
    issues.push({
      kind: 'spawn-trap', severity: 'error',
      message: `player lost HP within 1s of spawn (no input given): ${initialState.playerHp} → ${after1s.playerHp}`,
    });
  }

  // Fuzzer
  const positions = [];
  let stuckSince = null;
  let lastWinCounter = winField ? after1s?.[winField] ?? 0 : 0;
  let progressedAt = Date.now();
  const start = Date.now();
  let nextScreenshot = 10000;

  while ((Date.now() - start) < seconds * 1000) {
    // Hold a movement key for 200-500ms
    const move = ACTIONS_MOVE[Math.floor(Math.random() * ACTIONS_MOVE.length)];
    await page.keyboard.down(move);
    await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
    await page.keyboard.up(move);

    // Occasionally press an action button
    if (Math.random() < 0.6) {
      const btn = ACTIONS_BUTTON[Math.floor(Math.random() * ACTIONS_BUTTON.length)];
      await page.keyboard.press(btn);
      await page.waitForTimeout(80);
    }

    const obs = await page.evaluate(() => window.__gameState);
    if (!obs) {
      issues.push({ kind: 'state-missing', severity: 'error', message: 'window.__gameState became undefined mid-fuzz' });
      break;
    }

    // NaN check
    for (const [k, v] of Object.entries(obs)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        issues.push({ kind: 'nan-state', severity: 'error', field: k, message: `${k} is non-finite (${v})` });
      }
    }

    // Stuck detection
    const last = positions[positions.length - 1];
    if (last && Math.abs(obs.playerX - last.playerX) < 4 && Math.abs(obs.playerY - last.playerY) < 4) {
      stuckSince = stuckSince ?? Date.now();
      if (Date.now() - stuckSince > 3000) {
        issues.push({
          kind: 'stuck', severity: 'warning',
          x: obs.playerX, y: obs.playerY,
          duration_ms: Date.now() - stuckSince,
          message: `player stuck for ${((Date.now() - stuckSince) / 1000).toFixed(1)}s at (${obs.playerX.toFixed(0)},${obs.playerY.toFixed(0)})`,
        });
        stuckSince = null;
      }
    } else {
      stuckSince = null;
    }

    // Win-counter progress
    if (winField && obs[winField] > lastWinCounter) {
      lastWinCounter = obs[winField];
      progressedAt = Date.now();
    }

    // Out-of-bounds
    if (obs.playerY > 2000 || obs.playerX < -200 || obs.playerX > 5000) {
      issues.push({
        kind: 'out-of-bounds', severity: 'error',
        x: obs.playerX, y: obs.playerY,
        message: `player escaped world bounds at (${obs.playerX.toFixed(0)},${obs.playerY.toFixed(0)})`,
      });
      break;
    }

    positions.push({ ts: Date.now() - start, ...obs });

    // Screenshots at intervals
    const elapsed = Date.now() - start;
    if (elapsed >= nextScreenshot) {
      const tag = `t${Math.floor(elapsed / 1000)}s`;
      const buf = await snapshotCanvas(page);
      await writeFile(join(SCREENSHOTS_DIR, `${tag}.png`), buf);
      nextScreenshot += 10000;
    }
  }

  // Win progress check
  if (winField && winTarget != null && lastWinCounter < winTarget) {
    const noProgressMs = Date.now() - progressedAt;
    if (noProgressMs >= seconds * 1000 - 1000) {
      issues.push({
        kind: 'no-win-progress', severity: 'warning',
        field: winField, current: lastWinCounter, target: winTarget,
        message: `${winField} stuck at ${lastWinCounter}/${winTarget} for ${seconds}s of fuzzing — win condition may be unreachable`,
      });
    } else {
      issues.push({
        kind: 'partial-win-progress', severity: 'info',
        field: winField, current: lastWinCounter, target: winTarget,
        message: `${winField} reached ${lastWinCounter}/${winTarget} during fuzz (didn't win, but progressed)`,
      });
    }
  }

  // Final screenshot
  const finalBuf = await snapshotCanvas(page);
  await writeFile(join(SCREENSHOTS_DIR, `t${seconds}s-final.png`), finalBuf);

  await browser.close();

  const errCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  console.log(JSON.stringify({
    ok: errCount === 0,
    errors: errCount, warnings: warnCount, info: issues.length - errCount - warnCount,
    issues,
    screenshots_dir: SCREENSHOTS_DIR,
    sample_count: positions.length,
  }, null, 2));
  if (errCount > 0) exitCode = 5;
} finally {
  await server.kill();
}
process.exit(exitCode);
