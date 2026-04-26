#!/usr/bin/env node
// Scaffold a new Phaser game project from templates/phaser-game/.
// Usage: node init_project.mjs <name> [--dir path] [--force]
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTemplate } from '../../../src/lib/template.js';
import { saveState, emptyState } from '../../../src/lib/state.js';

const _file = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) { console.error('usage: init_project.mjs <name> [--dir path] [--force]'); process.exit(2); }
const force = args.includes('--force');
const dirArg = args[args.indexOf('--dir') + 1];
const projectDir = resolve(process.cwd(), dirArg && dirArg !== '--force' ? dirArg : name);

if (existsSync(projectDir)) {
  const entries = await readdir(projectDir);
  if (entries.length > 0 && !force) {
    console.error(`directory not empty: ${projectDir} (pass --force to override)`);
    process.exit(2);
  }
} else {
  await mkdir(projectDir, { recursive: true });
}

await renderTemplate('phaser-game', projectDir, { name, title: name.replace(/[-_]/g, ' ') });
await saveState(projectDir, emptyState({ name }));
console.log(JSON.stringify({ event: 'init.done', projectDir, name }));
