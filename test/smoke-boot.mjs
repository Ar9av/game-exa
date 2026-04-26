#!/usr/bin/env node
// Smoke test: spawn vite in /tmp/gameforge-test/scaffold-test, boot the empty
// Phaser game in headless Chromium, verify __gameReady fires and canvas renders.
import { spawnDevServer } from '../src/lib/server.js';
import { bootGame, snapshotCanvas, smoke } from '../src/qa/harness.js';
import { writeFile } from 'node:fs/promises';

const projectDir = '/tmp/gameforge-test/scaffold-test';

console.log('→ spawning vite in', projectDir);
const server = await spawnDevServer({ projectDir, port: 5174, log: { verbose: false } });
console.log('  ready:', server.url);

let exitCode = 0;
try {
  console.log('→ booting headless');
  const { browser, page, errors } = await bootGame(server.url);

  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= 30 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  const obs = await smoke(page);
  console.log('  smoke:', JSON.stringify(obs, null, 2));
  console.log('  errors:', JSON.stringify(errors, null, 2));

  const png = await snapshotCanvas(page);
  await writeFile('/tmp/gameforge-test/empty-canvas.png', png);
  console.log('  screenshot saved:', png.length, 'bytes →', '/tmp/gameforge-test/empty-canvas.png');

  if (errors.length) {
    console.error('FAIL: errors detected during boot');
    exitCode = 1;
  } else if (!obs.booted) {
    console.error('FAIL: game.isBooted false');
    exitCode = 1;
  } else if (obs.blank) {
    console.error('FAIL: canvas reads as blank');
    exitCode = 1;
  } else {
    console.log('PASS');
  }

  await browser.close();
} finally {
  await server.kill();
}
process.exit(exitCode);
