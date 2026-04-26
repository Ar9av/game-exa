import { resolve } from 'node:path';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadState, saveState } from '../lib/state.js';
import { refineCode } from '../agents/refiner.js';
import { CliError, EX } from '../lib/errors.js';
import { qaCommand } from './qa.js';

export async function refineCommand(opts, ctx) {
  const log = ctx.log;
  const state = await loadState(ctx.cwd);
  if (!state.gdd) throw new CliError('No GDD in state — run `gamewright generate` first.', EX.CONFIG);
  if (!state.qa?.length) throw new CliError('No QA report — run `gamewright qa` first.', EX.CONFIG);

  const lastQA = state.qa[state.qa.length - 1];
  if (lastQA.passed && !opts.force) {
    log.info('last QA passed; nothing to refine. Pass --force to refine anyway.');
    return;
  }

  const failures = lastQA.failures;
  const files = await collectGameFiles(ctx.cwd);
  log.emit('refine.start', { failures: failures.length, files: files.length });

  const { files: edits, rationale } = await refineCode({
    failures,
    projectDir: ctx.cwd,
    gdd: state.gdd,
    manifest: { sprites: state.assets.sprites, tiles: state.assets.tiles },
    files,
    log,
  });

  for (const f of edits) {
    if (!f.path.startsWith('src/')) {
      throw new CliError(`refiner tried to write outside src/: ${f.path}`, EX.GENERIC);
    }
    const abs = resolve(ctx.cwd, f.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content);
  }

  log.emit('refine.applied', { files: edits.length, rationale });
  await saveState(ctx.cwd, state);

  if (!opts.skipQa) {
    log.info('rerunning qa…');
    await qaCommand({ ...opts }, ctx);
  }
}

async function collectGameFiles(projectDir) {
  const out = [];
  await walk(resolve(projectDir, 'src'), 'src', out);
  return out;
}

async function walk(absDir, relDir, out) {
  let entries;
  try { entries = await readdir(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) await walk(`${absDir}/${e.name}`, rel, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(rel);
  }
}
