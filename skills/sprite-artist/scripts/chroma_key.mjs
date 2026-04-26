#!/usr/bin/env node
// Convert pure magenta (#FF00FF) pixels in a PNG to alpha=0.
// Usage: node chroma_key.mjs <input.png> [output.png]
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input) { console.error('usage: chroma_key.mjs <input.png> [output.png]'); process.exit(2); }
const out = output ?? input;

const img = sharp(input);
const meta = await img.metadata();
const raw = await img.ensureAlpha().raw().toBuffer();
let stripped = 0;
for (let i = 0; i < raw.length; i += 4) {
  if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) { raw[i + 3] = 0; stripped++; }
}
await sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toFile(out);
console.log(JSON.stringify({ ok: true, stripped, total: meta.width * meta.height }));
