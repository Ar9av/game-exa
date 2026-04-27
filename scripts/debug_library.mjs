/**
 * Persistent cross-run debug library.
 *
 * Stores known Phaser / codesmith bug fixes so every subsequent generation
 * inherits lessons from past refiner runs. Lives at ~/.game-creation-agent/debug-library.json.
 *
 * Usage (from refiner, after a successful fix):
 *   import { appendFix } from './debug_library.mjs';
 *   await appendFix({ symptom, cause, fix, genre });
 *
 * Usage (from codesmith prompt injection):
 *   import { topFixes } from './debug_library.mjs';
 *   const pitfalls = await topFixes(20);
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LIB_DIR  = join(homedir(), '.game-creation-agent');
const LIB_PATH = join(LIB_DIR, 'debug-library.json');

async function load() {
  if (!existsSync(LIB_PATH)) return { version: 1, entries: [] };
  return JSON.parse(await readFile(LIB_PATH, 'utf8'));
}

async function save(lib) {
  await mkdir(LIB_DIR, { recursive: true });
  await writeFile(LIB_PATH, JSON.stringify(lib, null, 2));
}

/**
 * Append a new fix entry (or increment hitCount on an existing matching one).
 * @param {{ symptom: string, cause: string, fix: string, genre?: string }} entry
 */
export async function appendFix({ symptom, cause, fix, genre = 'any' }) {
  const lib = await load();
  const existing = lib.entries.find(e => e.symptom === symptom);
  if (existing) {
    existing.hitCount  = (existing.hitCount ?? 1) + 1;
    existing.fix       = fix;    // update fix in case it improved
    existing.updatedAt = new Date().toISOString();
  } else {
    lib.entries.push({
      id:        `fix-${Date.now()}`,
      symptom,
      cause,
      fix,
      genre,
      addedAt:   new Date().toISOString(),
      hitCount:  1,
    });
  }
  // Keep library bounded — drop oldest low-hit entries if over 200
  if (lib.entries.length > 200) {
    lib.entries.sort((a, b) => b.hitCount - a.hitCount);
    lib.entries = lib.entries.slice(0, 200);
  }
  await save(lib);
}

/**
 * Return top N entries sorted by hitCount descending.
 * @param {number} n
 * @returns {Array<{symptom, cause, fix, genre, hitCount}>}
 */
export async function topFixes(n = 20) {
  const lib = await load();
  return [...lib.entries]
    .sort((a, b) => (b.hitCount ?? 1) - (a.hitCount ?? 1))
    .slice(0, n);
}

/**
 * Format top fixes as a bullet list for LLM prompt injection.
 * @param {number} n
 * @returns {string}
 */
export async function formatPitfalls(n = 20) {
  const fixes = await topFixes(n);
  if (fixes.length === 0) return '';
  const lines = fixes.map(f =>
    `- **${f.symptom}** → ${f.fix}` + (f.genre !== 'any' ? ` (${f.genre})` : '')
  );
  return `## Known pitfalls from past runs (inject into codesmith prompt)\n\n${lines.join('\n')}`;
}

// CLI: node scripts/debug_library.mjs [--list] [--add symptom|cause|fix]
if (process.argv[1]?.endsWith('debug_library.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    const fixes = await topFixes(50);
    if (fixes.length === 0) { console.log('Debug library is empty.'); }
    else fixes.forEach((f, i) => console.log(`${i + 1}. [×${f.hitCount}] ${f.symptom}\n   → ${f.fix}\n`));
  } else if (args[0] === '--add') {
    const [symptom, cause, fix, genre] = args.slice(1);
    if (!symptom || !cause || !fix) {
      console.error('Usage: --add <symptom> <cause> <fix> [genre]');
      process.exit(1);
    }
    await appendFix({ symptom, cause, fix, genre });
    console.log('Added.');
  } else {
    console.log('Usage: node scripts/debug_library.mjs [--list] [--add symptom cause fix [genre]]');
  }
}
