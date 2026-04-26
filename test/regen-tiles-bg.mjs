#!/usr/bin/env node
// Generate a real pixel-art tileset + parallax background via FAL, install
// into examples/pixel-pete. Top-left tile is left magenta so SKY becomes
// transparent after chroma-key (the bg shows through).
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const env = readFileSync('/Users/ar9av/.all-skills/.env', 'utf8');
const FAL_KEY = env.match(/^FAL_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');

async function fal(prompt, w, h) {
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${FAL_KEY}` },
    body: JSON.stringify({ prompt, image_size: { width: w, height: h }, quality: 'low', num_images: 1, output_format: 'png' }),
  });
  if (!res.ok) throw new Error(`FAL ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Buffer.from(await fetch(data.images[0].url).then((r) => r.arrayBuffer()));
}

async function chromaKey(buf, outPath) {
  const meta = await sharp(buf).metadata();
  const raw = await sharp(buf).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) raw[i + 3] = 0;
  }
  await sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toFile(outPath);
}

console.log('1/2 Generating tileset...');
// 2x2 grid of 416x416 = 832x832 (under 700k px, ratio 1:1, multiples of 16)
const tilePrompt = `A pixel art tileset on a solid bright magenta background, color #FF00FF.

The image is exactly 832 by 832 pixels, arranged as a 2-column by 2-row grid of equal 416 by 416 cells.

Top-left cell: completely empty, leave the entire 416x416 cell as solid #FF00FF magenta with nothing drawn in it.

Top-right cell: a grass-on-dirt tile. Top half is bright green grass with chunky pixel blades. Bottom half is brown dirt soil with a few darker pebble pixels. The tile fills the entire 416x416 cell, no magenta showing.

Bottom-left cell: a plain brown dirt soil tile, filling the entire 416x416 cell with brown earth and a few darker speckles for variation. No magenta visible.

Bottom-right cell: a gray stone bricks tile, filling the entire 416x416 cell with a 4x4 grid of rectangular stone bricks in light gray with darker mortar lines. No magenta visible.

Strict pixel art, chunky pixels, no anti-aliasing on edges, vivid 8-bit retro color palette, no text or labels. Each non-magenta cell completely fills its 416x416 area edge to edge.`;
const tileBuf = await fal(tilePrompt, 832, 832);
// Resize down to 64x64 (2x2 of 32x32 cells), nearest neighbor preserves pixel-art crispness
const tileSmall = await sharp(tileBuf).resize(64, 64, { kernel: 'nearest' }).png().toBuffer();
await chromaKey(tileSmall, '/Users/ar9av/Documents/projects/game-creation-agent/examples/pixel-pete/public/assets/tiles.png');
console.log('  saved tiles.png (64x64)');

console.log('2/2 Generating background...');
// 16:9-ish wide bg, target 720x432 = 311k px — too small for FAL min. Bump to 1280x768 (ratio 1.67, ~983k px)
const bgPrompt = `A wide pixel art parallax background scene, daytime outdoor.

The image is exactly 1280 by 768 pixels.

A soft pastel blue sky filling the upper two thirds of the frame. A few large fluffy white pixel-art clouds drifting at different heights. Distant rolling green hills in silhouette across the lower third, layered for depth (lighter hills in back, darker hills in front). A soft gradient horizon line where the sky meets the hills.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, vivid clean colors. No characters, no foreground objects, no text, no UI, no borders. Just the sky-and-hills scenic background.`;
const bgBuf = await fal(bgPrompt, 1280, 768);
// Downscale to a width that tiles naturally; keep aspect
const bgSmall = await sharp(bgBuf).resize(480, 288, { kernel: 'nearest' }).png().toBuffer();
writeFileSync('/Users/ar9av/Documents/projects/game-creation-agent/examples/pixel-pete/public/assets/bg.png', bgSmall);
console.log('  saved bg.png (480x288)');

console.log('Done.');
