#!/usr/bin/env node
// Run the headless QA harness. Spawns vite dev, drives scenarios, diffs screenshots.
// Usage: node run_qa.mjs <project-dir> [--url URL] [--update-baselines] [--port N]
import { resolve, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnDevServer } from '../../../src/lib/server.js';
import { runQA } from '../../../src/qa/runner.js';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const urlArg = args[args.indexOf('--url') + 1];
const port = parseInt(args[args.indexOf('--port') + 1] || '5173', 10);
const updateBaselines = args.includes('--update-baselines');

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd) { console.error('no GDD in state.json — run designer first'); process.exit(3); }

const log = { info: (...a) => console.error(...a), success: (...a) => console.error(...a) };
const isUrl = urlArg && /^https?:/.test(urlArg);
let server, url;
if (isUrl) { url = urlArg; }
else { server = await spawnDevServer({ projectDir, port, log }); url = server.url; }

let exitCode = 0;
try {
  const report = await runQA({ projectDir, url, gdd: state.gdd, updateBaselines, log });
  state.qa = [...(state.qa ?? []), report].slice(-5);
  await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.passed, scenarios: report.scenarios.length, failures: report.failures.length, report: 'qa/qa-report.json' }));
  if (!report.passed) exitCode = 5;
} finally {
  if (server) await server.kill();
}
process.exit(exitCode);
