#!/usr/bin/env node
// Run 4 QA workers concurrently and merge into a single failure report.
// Usage: node orchestrate_qa.mjs <project-dir> [--no-physics]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const skipPhysics = args.includes('--no-physics');

async function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => res(p)); });
    srv.on('error', rej);
  });
}

// Resolve sibling skill script paths relative to this skill's location
const skillsRoot = resolve(fileURLToPath(import.meta.url), '../../../../');
const staticScript   = join(skillsRoot, 'gap-checker', 'scripts', 'static_check.mjs');
const goldenScript   = join(skillsRoot, 'playtester', 'scripts', 'run_qa.mjs');
const fuzzerScript   = join(skillsRoot, 'gap-checker', 'scripts', 'dynamic_check.mjs');
const physicsScript  = join(skillsRoot, 'physics-debug-validator', 'scripts', 'validate_physics.mjs');

async function runScript(scriptPath, extraArgs = []) {
  return new Promise((res) => {
    const child = spawn('node', [scriptPath, projectDir, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { /* non-JSON output */ }
      res({ code, stdout: stdout.trim(), stderr: stderr.trim(), parsed });
    });
    child.on('error', (err) => {
      res({ code: -1, stdout: '', stderr: err.message, parsed: null });
    });
  });
}

const qaDir = join(projectDir, 'qa');
await mkdir(qaDir, { recursive: true });

const startTs = Date.now();
console.error('[orchestra] allocating ports…');

// Pre-allocate ports for browser-based workers
const [portGolden, portFuzzer, portPhysics] = await Promise.all([
  getFreePort(), getFreePort(), getFreePort(),
]);

console.error(`[orchestra] ports: golden=${portGolden} fuzzer=${portFuzzer} physics=${portPhysics}`);
console.error('[orchestra] launching workers…');

const workerPromises = [
  runScript(staticScript).then((r) => ({ name: 'static', ...r })),
  runScript(goldenScript, ['--port', String(portGolden)]).then((r) => ({ name: 'golden-path', ...r })),
  runScript(fuzzerScript, ['--port', String(portFuzzer)]).then((r) => ({ name: 'fuzzer', ...r })),
];

if (!skipPhysics) {
  workerPromises.push(
    runScript(physicsScript, ['--port', String(portPhysics)]).then((r) => ({ name: 'physics-debug', ...r })),
  );
}

const workerResults = await Promise.all(workerPromises);
const elapsed = Date.now() - startTs;

// Merge into unified failure list
const merged = [];
const workers = {};

for (const w of workerResults) {
  const parsed = w.parsed ?? {};
  workers[w.name] = parsed;

  // static / physics-debug: issues[]
  if (Array.isArray(parsed.issues)) {
    for (const issue of parsed.issues) {
      merged.push({ kind: issue.kind, source: w.name, severity: issue.severity ?? 'error', message: issue.message, detail: issue });
    }
  }
  // golden-path / fuzzer: failures[]
  if (Array.isArray(parsed.failures)) {
    for (const f of parsed.failures) {
      merged.push({ kind: f.kind, source: w.name, severity: 'error', message: f.message, detail: f });
    }
  }
  // physics-debug: misaligned bodies
  if (Array.isArray(parsed.bodies)) {
    for (const b of parsed.bodies.filter((b) => !b.aligned)) {
      merged.push({ kind: 'hitbox-misaligned', source: w.name, severity: 'warning', message: b.issue, detail: b });
    }
  }

  const status = w.code === 0 ? 'pass' : 'fail';
  console.error(`[orchestra] ${w.name}: ${status} (exit ${w.code})`);
}

const errorCount = merged.filter((m) => m.severity === 'error').length;
const warningCount = merged.filter((m) => m.severity === 'warning').length;
const ok = errorCount === 0;

const report = {
  ts: new Date().toISOString(),
  elapsedMs: elapsed,
  ok,
  failCount: errorCount,
  warnCount: warningCount,
  workers,
  merged,
};

const reportPath = join(qaDir, 'orchestra-report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));

// Append to state.qa (keep last 5)
try {
  const statePath = join(projectDir, 'game-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.qa = [...(state.qa ?? []), { ts: report.ts, passed: ok, source: 'orchestra', failCount: errorCount }].slice(-5);
  await writeFile(statePath, JSON.stringify(state, null, 2));
} catch { /* non-fatal */ }

console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 5);
