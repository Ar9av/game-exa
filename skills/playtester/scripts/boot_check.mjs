#!/usr/bin/env node
// Minimal smoke: boot the game, confirm scene-ready, snapshot, exit.
// Usage: node boot_check.mjs <project-dir> [--port N]
import { resolve } from 'node:path';
import { spawnDevServer } from '../../../src/lib/server.js';
import { bootGame, snapshotCanvas, smoke } from '../../../src/qa/harness.js';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const port = parseInt(args[args.indexOf('--port') + 1] || '5176', 10);

const log = { info: (...a) => console.error(...a), success: (...a) => console.error(...a) };
const server = await spawnDevServer({ projectDir, port, log });
let exitCode = 0;
try {
  const { browser, page, errors } = await bootGame(server.url, { log });
  await page.evaluate(() => new Promise((res) => {
    let i = 0; const tick = () => (++i >= 30 ? res() : requestAnimationFrame(tick)); requestAnimationFrame(tick);
  }));
  const obs = await smoke(page);
  const png = await snapshotCanvas(page);
  const out = `${projectDir}/qa/boot-check.png`;
  await writeFile(out, png);
  await browser.close();
  const ok = !errors.length && obs.booted && !obs.blank;
  console.log(JSON.stringify({ ok, ...obs, errors, screenshot: out }));
  if (!ok) exitCode = 5;
} finally {
  await server.kill();
}
process.exit(exitCode);
