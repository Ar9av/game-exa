#!/usr/bin/env node
// Direct FAL call with a sanitized prompt to avoid content-filter trips.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const env = readFileSync('/Users/ar9av/.all-skills/.env', 'utf8');
const FAL_KEY = env.match(/^FAL_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');

const W = 816, H = 816, CELL = 272;
const PROMPT = `A pixel art sprite sheet on a solid bright magenta background, color #FF00FF.

The image is exactly ${W} by ${H} pixels, arranged as a 3-column by 3-row grid of equal ${CELL} by ${CELL} cells.

Row 1: a friendly cartoon hero with a small red hat, three frames showing standing, walking, jumping.
Row 2: a small cute purple creature with wings, three frames showing standing, gliding, gliding.
Row 3: a sparkling gold coin, three frames showing the coin from front, side, and front again.

Columns left to right: pose 1 (standing), pose 2 (walking or gliding), pose 3 (jumping or another gentle pose).

Style rules:
- Chunky 8-bit pixel art with limited palette per character.
- No anti-aliasing on outlines.
- Strict grid alignment, no bleed between cells.
- No text, no numbers, no labels.
- Background must be exactly #FF00FF magenta everywhere outside the characters.
`;

console.log('Calling FAL...');
const res = await fetch('https://fal.run/openai/gpt-image-2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Key ${FAL_KEY}` },
  body: JSON.stringify({
    prompt: PROMPT,
    image_size: { width: W, height: H },
    quality: 'low',
    num_images: 1,
    output_format: 'png',
  }),
});

if (!res.ok) {
  console.error('FAL error', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const url = data.images[0].url;
console.log('Got image:', url);

const img = await fetch(url).then((r) => r.arrayBuffer());
const out = '/Users/ar9av/Documents/projects/game-creation-agent/examples/pixel-pete/public/assets/entities.png';
writeFileSync(out, Buffer.from(img));
console.log('Wrote', out, 'size', img.byteLength, 'bytes');

// Magenta -> alpha
const meta = await sharp(out).metadata();
const raw = await sharp(out).ensureAlpha().raw().toBuffer();
let stripped = 0;
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) { raw[i + 3] = 0; stripped++; }
}
await sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toFile(out);
console.log('Chroma key:', stripped, 'pixels stripped of', meta.width * meta.height);
