import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = fileURLToPath(new URL('../../templates', import.meta.url));

/**
 * Render templates/<name>/ into dest, replacing {{key}} tokens in text files.
 */
export async function renderTemplate(name, dest, vars = {}) {
  const src = join(TEMPLATES_DIR, name);
  await copyTree(src, dest, vars);
}

async function copyTree(srcDir, dstDir, vars) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = join(srcDir, e.name);
    const d = join(dstDir, e.name);
    if (e.isDirectory()) {
      await copyTree(s, d, vars);
    } else {
      const stats = await stat(s);
      if (isText(e.name) && stats.size < 256 * 1024) {
        let raw = await readFile(s, 'utf8');
        raw = raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
        await writeFile(d, raw);
      } else {
        await copyFile(s, d);
      }
    }
  }
}

function isText(name) {
  return /\.(js|mjs|cjs|json|html|css|md|txt|gitignore|gitkeep|toml|yml|yaml|env)$/i.test(name) || name.startsWith('.');
}
