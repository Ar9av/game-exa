import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { CliError, EX } from './errors.js';

export const STATE_FILE = 'game-state.json';
export const STATE_VERSION = 1;

export function emptyState({ name, prompt, genre } = {}) {
  return {
    version: STATE_VERSION,
    name: name ?? 'untitled',
    prompt: prompt ?? '',
    genre: genre ?? null,
    createdAt: new Date().toISOString(),
    gdd: null,
    levels: [],
    assets: { sprites: [], tiles: null },
    code: { entryPoint: 'src/main.js', scenes: ['Boot', 'Preload', 'Game'] },
    qa: [],
  };
}

export async function loadState(projectDir) {
  const file = resolve(projectDir, STATE_FILE);
  if (!existsSync(file)) {
    throw new CliError(`No game-state.json in ${projectDir}. Run 'gamewright init' first.`, EX.CONFIG);
  }
  const raw = await readFile(file, 'utf8');
  const state = JSON.parse(raw);
  if (state.version !== STATE_VERSION) {
    throw new CliError(`game-state.json version mismatch (${state.version} != ${STATE_VERSION}).`, EX.CONFIG);
  }
  return state;
}

export async function saveState(projectDir, state) {
  const file = resolve(projectDir, STATE_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2) + '\n');
  return file;
}

export function projectPath(state, ...rel) {
  return join(...rel);
}
