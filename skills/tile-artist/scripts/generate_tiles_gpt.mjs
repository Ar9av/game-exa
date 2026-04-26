#!/usr/bin/env node
// Generate a real pixel-art tileset via GPT Image 2 (default provider: fal.ai),
// then chroma-key the magenta cell(s) to alpha. Replaces the procedural strip
// from paint_tiles.mjs when you want richer tiles.
//
// Usage: node generate_tiles_gpt.mjs <project-dir> [--quality low|medium|high]
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const quality = args[args.indexOf('--quality') + 1] || 'low';

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd?.tilesetPalette) { console.error('no tilesetPalette in GDD'); process.exit(3); }

const palette = state.gdd.tilesetPalette;
if (palette.length < 2 || palette.length > 4) {
  console.error(`tile-artist (gpt) supports 2-4 tiles; GDD has ${palette.length}. Use the procedural paint_tiles.mjs for larger palettes.`);
  process.exit(2);
}

async function findApiKey() {
  if (process.env.FAL_KEY) return { key: process.env.FAL_KEY, provider: 'fal' };
  const envFile = join(homedir(), '.all-skills', '.env');
  if (existsSync(envFile)) {
    const raw = await readFile(envFile, 'utf8');
    const m = raw.match(/^\s*FAL_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return { key: m[1].replace(/^["']|["']$/g, ''), provider: 'fal' };
  }
  if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, provider: 'openai' };
  return null;
}
const auth = await findApiKey();
if (!auth) { console.error('FAL_KEY (preferred) or OPENAI_API_KEY required'); process.exit(3); }

// 2x2 grid satisfies the 3:1 ratio cap; if palette has 3 tiles, last cell stays magenta.
const cellSrc = 416;
const W = cellSrc * 2, H = cellSrc * 2;
const slots = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const cellPrompts = palette.map((p, i) => {
  if (p.passable) {
    return `${slots[i]} cell: completely empty, leave the entire ${cellSrc}x${cellSrc} cell as solid #FF00FF magenta with nothing drawn in it.`;
  }
  // Solid impassable tiles get a brief description from the GDD palette
  return `${slots[i]} cell: a ${p.color} ${p.id.toLowerCase().replace(/_/g, ' ')} tile, filling the entire ${cellSrc}x${cellSrc} cell edge to edge with no magenta showing through. Pixel-art texture appropriate for the tile type.`;
});

// Pad with explicit "fill with magenta" instructions for unused cells
while (cellPrompts.length < 4) {
  cellPrompts.push(`${slots[cellPrompts.length]} cell: completely empty, leave the entire ${cellSrc}x${cellSrc} cell as solid #FF00FF magenta with nothing drawn in it.`);
}

const prompt = `A pixel art tileset on a solid bright magenta background, color #FF00FF.

The image is exactly ${W} by ${H} pixels, arranged as a 2-column by 2-row grid of equal ${cellSrc} by ${cellSrc} cells.

${cellPrompts.join('\n\n')}

Strict pixel art, chunky pixels, no anti-aliasing on edges, vivid 8-bit retro color palette, no text or labels. Each non-magenta cell completely fills its ${cellSrc}x${cellSrc} area edge to edge.`;

console.error(`tile-artist (gpt): ${palette.length} tiles, provider=${auth.provider}, quality=${quality}`);

let imgBuf;
if (auth.provider === 'fal') {
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${auth.key}` },
    body: JSON.stringify({ prompt, image_size: { width: W, height: H }, quality, num_images: 1, output_format: 'png' }),
  });
  if (!res.ok) { console.error('GPT Image 2 (fal):', res.status, await res.text()); process.exit(4); }
  const data = await res.json();
  imgBuf = Buffer.from(await fetch(data.images[0].url).then((r) => r.arrayBuffer()));
} else {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.key}` },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size: `${W}x${H}`, quality, n: 1 }),
  });
  if (!res.ok) { console.error('GPT Image 2 (openai):', res.status, await res.text()); process.exit(4); }
  const data = await res.json();
  imgBuf = Buffer.from(data.data[0].b64_json, 'base64');
}

// Downscale to 64x64 (2x2 of 32x32 cells) with nearest-neighbor for crisp pixel art
const cellOut = 32;
const small = await sharp(imgBuf).resize(cellOut * 2, cellOut * 2, { kernel: 'nearest' }).png().toBuffer();

// Magenta -> alpha
const meta = await sharp(small).metadata();
const raw = await sharp(small).ensureAlpha().raw().toBuffer();
let stripped = 0;
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) { raw[i + 3] = 0; stripped++; }
}
const assetsDir = join(projectDir, 'public', 'assets');
await mkdir(assetsDir, { recursive: true });
const outPath = join(assetsDir, 'tiles.png');
await sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toFile(outPath);

const tiles = {
  relSheet: 'assets/tiles.png',
  tileSize: cellOut,
  ids: palette.map((p) => p.id),
  passable: palette.map((p) => !!p.passable),
};
state.assets = state.assets || { sprites: [] };
state.assets.tiles = tiles;
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

const manifestPath = join(assetsDir, 'manifest.json');
let manifest = { sprites: [], tiles: null };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
manifest.tiles = tiles;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({ ok: true, tiles: tiles.ids.length, tileSize: cellOut, provider: auth.provider, stripped, total: meta.width * meta.height }));
