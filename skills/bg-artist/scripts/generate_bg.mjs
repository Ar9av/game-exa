#!/usr/bin/env node
// Generate a parallax background via GPT Image 2 (default provider: fal.ai).
// Usage: node generate_bg.mjs <project-dir> [--theme outdoor-day|outdoor-night|cave|space|forest] [--quality low|medium|high]
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const projectDir = resolve(args[0] ?? '.');
const themeArg = args[args.indexOf('--theme') + 1];
const quality = args[args.indexOf('--quality') + 1] || 'low';

const PROMPTS = {
  'outdoor-day': `A wide pixel art parallax background scene, daytime outdoor. The image is exactly 1280 by 768 pixels. A soft pastel blue sky filling the upper two thirds of the frame. A few large fluffy white pixel-art clouds drifting at different heights. Distant rolling green hills in silhouette across the lower third, layered for depth (lighter hills in back, darker hills in front). A soft gradient horizon line where the sky meets the hills. 8-bit retro pixel art style, chunky pixels, no anti-aliasing, vivid clean colors. No characters, no foreground objects, no text, no UI, no borders.`,
  'outdoor-night': `A wide pixel art parallax background scene, nighttime outdoor. The image is exactly 1280 by 768 pixels. A deep navy-blue night sky filling the upper two thirds of the frame. A large pale yellow moon high on the right side. Scattered tiny white star pixels at varied brightness across the sky. Distant rolling mountain silhouettes in dark blue-purple across the lower third, layered for depth. 8-bit retro pixel art style, chunky pixels, no anti-aliasing. No characters, no foreground objects, no text, no UI, no borders.`,
  'cave': `A wide pixel art parallax background scene, underground cave interior. The image is exactly 1280 by 768 pixels. A dark damp stone cave wall texture filling the entire frame. Subtle vertical streaks suggesting natural rock striations. A faint warm torch glow in the upper-left, fading into deeper shadow toward the right. A few cracks and small alcoves in the rock face suggesting depth. 8-bit retro pixel art style, chunky pixels, no anti-aliasing, dim moody palette of dark grays, browns, and a hint of warm orange near the glow. No characters, no foreground objects, no text, no UI, no borders.`,
  'space': `A wide pixel art parallax background scene, outer space. The image is exactly 1280 by 768 pixels. A deep dark navy and black space backdrop. Scattered tiny star pixels at three different brightness levels distributed across the frame. One or two large soft nebula clouds in distant purples and blues, blurry and diffuse. A small distant planet silhouette on one side. 8-bit retro pixel art style, chunky pixels, no anti-aliasing, palette of deep blues, purples, blacks, and bright white stars. No characters, no foreground objects, no text, no UI, no borders.`,
  'forest': `A wide pixel art parallax background scene, dense forest depths. The image is exactly 1280 by 768 pixels. A backdrop of overlapping tall pine and oak silhouettes layered for depth. Closer trees in dark forest green, mid-distance trees in muted teal-green, far trees fading into pale blue-green mist. Slivers of dim daylight filtering between trunks. 8-bit retro pixel art style, chunky pixels, no anti-aliasing, restful muted forest palette. No characters, no foreground objects, no text, no UI, no borders.`,
};

const GENRE_DEFAULT = {
  'platformer':         'outdoor-day',
  'top-down-adventure': null,                  // use tilemap fill, skip bg
  'shoot-em-up':        'space',
  'twin-stick-shooter': 'space',
  'dungeon-crawler':    'cave',
  'puzzle':             null,
};

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

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
if (!state.gdd) { console.error('no GDD in game-state.json — run game-designer first'); process.exit(3); }

const theme = themeArg || GENRE_DEFAULT[state.gdd.genre] || 'outdoor-day';
if (theme === null) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: `genre ${state.gdd.genre} does not use a bg image` }));
  process.exit(0);
}
const prompt = PROMPTS[theme];
if (!prompt) { console.error(`unknown theme: ${theme}`); process.exit(2); }

const auth = await findApiKey();
if (!auth) { console.error('FAL_KEY (preferred) or OPENAI_API_KEY required'); process.exit(3); }

console.error(`bg-artist: theme=${theme}, provider=${auth.provider}, quality=${quality}`);

let imgBuf;
if (auth.provider === 'fal') {
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${auth.key}` },
    body: JSON.stringify({ prompt, image_size: { width: 1280, height: 768 }, quality, num_images: 1, output_format: 'png' }),
  });
  if (!res.ok) { console.error('GPT Image 2 (fal):', res.status, await res.text()); process.exit(4); }
  const data = await res.json();
  imgBuf = Buffer.from(await fetch(data.images[0].url).then((r) => r.arrayBuffer()));
} else {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.key}` },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1280x768', quality, n: 1 }),
  });
  if (!res.ok) { console.error('GPT Image 2 (openai):', res.status, await res.text()); process.exit(4); }
  const data = await res.json();
  const b64 = data.data[0].b64_json;
  imgBuf = Buffer.from(b64, 'base64');
}

const small = await sharp(imgBuf).resize(480, 288, { kernel: 'nearest' }).png().toBuffer();
const assetsDir = join(projectDir, 'public', 'assets');
await mkdir(assetsDir, { recursive: true });
const outPath = join(assetsDir, 'bg.png');
await writeFile(outPath, small);

const manifestPath = join(assetsDir, 'manifest.json');
let manifest = { sprites: [], tiles: null };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
manifest.bg = { relPath: 'assets/bg.png', scrollFactor: 0.3, theme };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

state.assets = state.assets || { sprites: [] };
state.assets.bg = manifest.bg;
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

console.log(JSON.stringify({ ok: true, theme, provider: auth.provider, path: outPath }));
