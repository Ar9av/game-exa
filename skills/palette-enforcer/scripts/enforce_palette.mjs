#!/usr/bin/env node
// Quantize all PNGs in public/assets/ to a named 8-bit palette.
// Usage: node enforce_palette.mjs <project-dir> [--palette <id>]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const paletteFlagIdx = args.indexOf('--palette');
let paletteId = paletteFlagIdx >= 0 ? args[paletteFlagIdx + 1] : null;

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
const genre = state.gdd?.genre ?? '';

if (!paletteId) {
  if (['platformer', 'action-platformer', 'shoot-em-up'].includes(genre)) paletteId = 'pico8';
  else if (['top-down-rpg', 'dungeon-crawler'].includes(genre)) paletteId = 'endesga-32';
  else paletteId = 'sweetie-16';
}

const palettesPath = new URL('../references/palettes.json', import.meta.url).pathname;
const palettes = JSON.parse(await readFile(palettesPath, 'utf8'));
if (!palettes[paletteId]) {
  console.error(`Unknown palette "${paletteId}". Available: ${Object.keys(palettes).join(', ')}`);
  process.exit(3);
}

const paletteHex = palettes[paletteId].colors;

// Parse hex → [r, g, b]
const palette = paletteHex.map((h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
});

// Euclidean distance squared in RGB space (no sqrt needed for comparison)
function nearest(r, g, b) {
  let bestDist = Infinity;
  let bestColor = palette[0];
  for (const c of palette) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestDist) { bestDist = d; bestColor = c; }
  }
  return bestColor;
}

const assetsDir = join(projectDir, 'public', 'assets');
const files = await readdir(assetsDir);
const pngs = files.filter((f) => extname(f).toLowerCase() === '.png');

let processed = 0;
for (const file of pngs) {
  const fullPath = join(assetsDir, file);
  const img = sharp(fullPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // channels = 4 (RGBA)

  for (let i = 0; i < data.length; i += channels) {
    const a = data[i + 3];
    if (a < 128) continue; // keep transparent pixels unchanged

    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Preserve magenta chroma-key background — used by the runtime for alpha extraction.
    if (r === 255 && g === 0 && b === 255) continue;

    const [nr, ng, nb] = nearest(r, g, b);
    data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
  }

  await sharp(data, { raw: { width, height, channels } })
    .png()
    .toFile(fullPath);

  processed++;
  console.error(`[palette-enforcer] ${file} → ${paletteId}`);
}

// Write state.style.palette
state.style = { ...(state.style ?? {}), palette: paletteId };
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2));

console.log(JSON.stringify({
  ok: true,
  palette: paletteId,
  colors: paletteHex.length,
  filesProcessed: processed,
}));
