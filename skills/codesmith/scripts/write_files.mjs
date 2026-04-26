#!/usr/bin/env node
// Safety-checked writer for codesmith / refiner output.
// Refuses paths outside src/. Refuses absolute paths. Refuses directory traversal.
// Usage: node write_files.mjs <project-dir> <files-json>
//   files-json:  '{"files":[{"path":"src/scenes/Game.js","content":"..."}]}'
//   or use - for stdin
import { resolve, join, normalize } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [dirArg, jsonArg] = process.argv.slice(2);
if (!dirArg || !jsonArg) { console.error('usage: write_files.mjs <project-dir> <files-json | ->'); process.exit(2); }
const projectDir = resolve(dirArg);

let raw;
if (jsonArg === '-') {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  raw = Buffer.concat(chunks).toString('utf8');
} else {
  raw = await readFile(jsonArg, 'utf8');
}
const payload = JSON.parse(raw);
if (!Array.isArray(payload.files)) { console.error('payload.files must be an array'); process.exit(2); }

const written = [];
for (const f of payload.files) {
  if (!f.path || typeof f.content !== 'string') { console.error('each file needs path + content'); process.exit(2); }
  const norm = normalize(f.path).replace(/^\/+/, '');
  if (norm.includes('..')) { console.error(`directory traversal: ${f.path}`); process.exit(2); }
  if (!norm.startsWith('src/')) { console.error(`refusing path outside src/: ${f.path}`); process.exit(2); }
  const abs = join(projectDir, norm);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, f.content);
  written.push(norm);
}
console.log(JSON.stringify({ ok: true, written }));
