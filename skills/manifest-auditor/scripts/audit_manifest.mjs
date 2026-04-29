#!/usr/bin/env node
// Static cross-reference of Game.js animation/texture keys against manifest.json.
// Usage: node audit_manifest.mjs <project-dir> [--fix]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const autoFix = args.includes('--fix');

const manifestPath = join(projectDir, 'public', 'assets', 'manifest.json');
const gamePath = join(projectDir, 'src', 'scenes', 'Game.js');

let manifest, gameSource;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  console.error('audit_manifest: manifest.json not found');
  process.exit(3);
}
try {
  gameSource = await readFile(gamePath, 'utf8');
} catch {
  console.error('audit_manifest: src/scenes/Game.js not found');
  process.exit(3);
}

// Build valid animation key set from manifest
const validAnimKeys = new Set();
for (const sheet of manifest.sprites ?? []) {
  for (const row of sheet.rows ?? []) {
    for (const col of sheet.cols ?? []) {
      validAnimKeys.add(`${row}-${col.toLowerCase()}`);
    }
  }
}

// Build valid texture key set
const validTexKeys = new Set(['tiles']);
for (const sheet of manifest.sprites ?? []) {
  if (sheet.textureKey) validTexKeys.add(sheet.textureKey);
}
if (manifest.bg) validTexKeys.add('bg');

// Extract all string literals with line numbers
function extractStrings(src) {
  const results = [];
  const lines = src.split('\n');
  lines.forEach((line, lineIdx) => {
    const re = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      results.push({ value: m[2], line: lineIdx + 1 });
    }
  });
  return results;
}

// Patterns that indicate animation key usage
const animPatterns = [
  /\.play\(\s*['"]([^'"]+)['"]/g,
  /\.chain\(\s*['"]([^'"]+)['"]/g,
];
// Patterns that indicate texture key usage
const texPatterns = [
  /\.add\.sprite\([^)]*,\s*['"]([^'"]+)['"]/g,
  /\.add\.image\([^)]*,\s*['"]([^'"]+)['"]/g,
  /\.physics\.add\.sprite\([^)]*,\s*['"]([^'"]+)['"]/g,
  /\.textures\.get\(\s*['"]([^'"]+)['"]/g,
  /createMultiple\([^)]*key:\s*['"]([^'"]+)['"]/g,
];

const issues = [];

function extractKeysWithLines(src, patterns) {
  const results = [];
  const lines = src.split('\n');
  lines.forEach((line, lineIdx) => {
    for (const pat of patterns) {
      const re = new RegExp(pat.source, pat.flags);
      let m;
      while ((m = re.exec(line)) !== null) {
        results.push({ key: m[1], line: lineIdx + 1 });
      }
    }
  });
  return results;
}

const animRefs = extractKeysWithLines(gameSource, animPatterns);
const texRefs  = extractKeysWithLines(gameSource, texPatterns);

// Check animation keys
for (const { key, line } of animRefs) {
  if (!validAnimKeys.has(key)) {
    // Find closest match (edit distance heuristic: same entity prefix)
    const entity = key.split('-')[0];
    const suggestions = [...validAnimKeys].filter((k) => k.startsWith(entity + '-'));
    issues.push({
      kind: 'unknown-anim-key',
      key,
      line,
      suggestion: suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : `Valid keys: ${[...validAnimKeys].join(', ')}`,
      severity: 'error',
    });
  }
}

// Check texture keys — only flag if the key looks like it's supposed to be a texture
// (skip short common words that are args to other APIs)
const skipTexKeys = new Set(['top', 'left', 'right', 'bottom', 'center', 'Game', 'Boot', 'Preload', 'Menu', 'GameOver']);
for (const { key, line } of texRefs) {
  if (skipTexKeys.has(key)) continue;
  if (!validTexKeys.has(key)) {
    const suggestions = [...validTexKeys].filter((k) => k.toLowerCase().includes(key.toLowerCase().split('-')[0]));
    issues.push({
      kind: 'unknown-texture-key',
      key,
      line,
      suggestion: suggestions.length ? `Manifest has: ${suggestions.join(', ')}` : `Valid texture keys: ${[...validTexKeys].join(', ')}`,
      severity: 'error',
    });
  }
}

// Auto-fix: apply best-guess substitutions in Game.js
if (autoFix && issues.length > 0) {
  let fixed = gameSource;
  let fixCount = 0;
  for (const issue of issues) {
    if (issue.kind === 'unknown-anim-key') {
      const entity = issue.key.split('-')[0];
      const candidates = [...validAnimKeys].filter((k) => k.startsWith(entity + '-'));
      if (candidates.length === 1) {
        fixed = fixed.replaceAll(`'${issue.key}'`, `'${candidates[0]}'`).replaceAll(`"${issue.key}"`, `"${candidates[0]}"`);
        issue.fixed = candidates[0];
        fixCount++;
      }
    }
  }
  if (fixCount > 0) {
    await writeFile(gamePath, fixed);
    console.error(`[manifest-auditor] auto-fixed ${fixCount} animation key(s) in Game.js`);
  }
}

const errors = issues.filter((i) => i.severity === 'error').length;
const warnings = issues.filter((i) => i.severity === 'warning').length;
console.log(JSON.stringify({ ok: errors === 0, errors, warnings, total: issues.length, issues }, null, 2));
process.exit(errors > 0 ? 5 : 0);
