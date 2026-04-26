import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { renderTemplate } from '../lib/template.js';
import { saveState, emptyState } from '../lib/state.js';
import { ensureValue, prompts as p } from '../lib/interactive.js';
import { runScript } from '../lib/server.js';
import { CliError, EX } from '../lib/errors.js';

export async function initCommand(name, opts, ctx) {
  const log = ctx.log;
  log.emit('init.start', { name });

  const projectName = await ensureValue(name, {
    name: 'project name',
    opts,
    prompt: () => p.text({ message: 'Project name?', placeholder: 'my-game', validate: (v) => /^[a-z0-9][a-z0-9-]*$/i.test(v) ? undefined : 'lowercase letters, digits, hyphens' }),
  });

  const projectDir = resolve(ctx.cwd, opts.dir ?? projectName);
  if (existsSync(projectDir)) {
    const entries = await readdir(projectDir);
    if (entries.length > 0 && !opts.force) {
      throw new CliError(`Directory ${projectDir} is not empty. Pass --force to override.`, EX.USAGE);
    }
  } else {
    await mkdir(projectDir, { recursive: true });
  }

  log.emit('init.scaffolding', { dir: projectDir });
  await renderTemplate('phaser-game', projectDir, {
    name: projectName,
    title: projectName.replace(/[-_]/g, ' '),
  });

  const state = emptyState({ name: projectName, prompt: opts.prompt ?? '', genre: opts.genre ?? null });
  await saveState(projectDir, state);

  if (!opts.skipInstall) {
    log.emit('init.npm-install', { dir: projectDir });
    try {
      await runScript('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: projectDir });
    } catch (e) {
      log.warn(`npm install failed: ${e.message} — continue manually with: cd ${basename(projectDir)} && npm install`);
    }
  }

  log.emit('init.done', { dir: projectDir });
  log.result({ projectDir });
  if (!ctx.json) {
    log.success(`scaffolded ${projectName} at ${projectDir}`);
    log.info(`next: cd ${basename(projectDir)} && gameforge generate "your idea"`);
  }
}
