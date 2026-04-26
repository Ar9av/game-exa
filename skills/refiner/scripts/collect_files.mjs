#!/usr/bin/env node
// Emit { files: [{path, content}, ...] } for all .js/.mjs under src/.
// Usage: node collect_files.mjs <project-dir>
import { resolve, relative, join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const projectDir = resolve(process.argv[2] ?? '.');
const out = [];

async function walk(absDir) {
  let entries;
  try { entries = await readdir(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(absDir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(js|mjs)$/.test(e.name)) {
      out.push({ path: relative(projectDir, p), content: await readFile(p, 'utf8') });
    }
  }
}

await walk(join(projectDir, 'src'));
process.stdout.write(JSON.stringify({ files: out }, null, 2));
