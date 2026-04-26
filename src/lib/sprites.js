import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const SKILL_ROOT = join(homedir(), '.all-skills', 'sprite-sheet');
const SKILL_SCRIPT = join(SKILL_ROOT, 'scripts', 'generate.mjs');
const ENV_FILE = join(homedir(), '.all-skills', '.env');

const ROWS_PER_SHEET = 9;
const DEFAULT_STATES = ['idle', 'walk', 'attack', 'hurt'];

function ensureSkill() {
  if (!existsSync(SKILL_SCRIPT)) {
    throw new Error(`Sprite sheet generator not found at ${SKILL_SCRIPT}`);
  }
  if (!existsSync(ENV_FILE)) {
    throw new Error(`Sprite sheet env file not found at ${ENV_FILE} (FAL_KEY required)`);
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Convert pure magenta (#FF00FF) pixels to alpha=0.
 * Tolerant: R>200 && G<80 && B>200 (matches the skill's chroma key advice).
 */
async function chromaKeyMagenta(pngPath) {
  const img = sharp(pngPath);
  const { width, height } = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer();
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i] > 200 && raw[i + 1] < 80 && raw[i + 2] > 200) {
      raw[i + 3] = 0;
    }
  }
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(pngPath);
}

function runGenerator(args, { cwd, log }) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('node', [`--env-file=${ENV_FILE}`, SKILL_SCRIPT, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; if (log?.verbose) process.stderr.write(d); });
    proc.stderr.on('data', (d) => { stderr += d; if (log?.verbose) process.stderr.write(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`sprite generator exited ${code}: ${stderr || stdout}`));
    });
  });
}

/**
 * Generate sprite sheets for the given entities, batching them into sheets
 * of up to ROWS_PER_SHEET rows. Returns a manifest the game code can index by.
 *
 * @param {object} args
 * @param {Array<{id:string, color?:string, desc?:string, states?:string[]}>} args.entities
 * @param {string} args.outDir   - absolute output dir for sheets
 * @param {string} args.relDir   - asset path relative to project root (e.g. 'public/assets')
 * @param {string} [args.style]  - visual style passed to the model
 * @param {string} [args.quality]
 * @param {object} args.log
 * @returns {Promise<{sprites: Array<{sheet:string,relSheet:string,rows:string[],cols:string[],cell:number,bg:string}>}>}
 */
export async function generateSprites({ entities, outDir, relDir, style = 'retro 8-bit pixel-art', quality = 'low', cwd, log }) {
  ensureSkill();
  await mkdir(outDir, { recursive: true });
  const cols = mergedStates(entities);
  const groups = chunk(entities, ROWS_PER_SHEET);
  const sprites = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const sheetName = groups.length === 1 ? 'entities.png' : `entities-${i + 1}.png`;
    const sheetPath = resolve(outDir, sheetName);
    const subjects = g.map((e) => e.id).join(',');
    const colors   = g.map((e) => e.color ?? '').join(',');
    const descs    = g.map((e) => (e.desc ?? '').replace(/\|/g, '/')).join('|');

    const args = [
      '--subjects', subjects,
      '--states', cols.join(','),
      '--grid', `${g.length}x${cols.length}`,
      '--quality', quality,
      '--output', sheetPath,
      '--style', style,
      '--bg', 'magenta',
    ];
    if (colors.replace(/,/g, '')) args.push('--colors', colors);
    if (descs.replace(/\|/g, '')) args.push('--descs', descs);

    log?.info?.(`generating sprite sheet ${i + 1}/${groups.length}: ${g.length} entities × ${cols.length} states`);
    await runGenerator(args, { cwd, log });

    log?.info?.(`post-processing magenta → alpha: ${sheetName}`);
    await chromaKeyMagenta(sheetPath);

    const cell = pickCell(g.length, cols.length);
    sprites.push({
      sheet: sheetPath,
      relSheet: join(relDir, sheetName),
      rows: g.map((e) => e.id),
      cols,
      cell,
      bg: 'magenta',
    });
  }

  return { sprites };
}

function mergedStates(entities) {
  const set = new Set();
  for (const e of entities) {
    for (const s of (e.states ?? DEFAULT_STATES)) set.add(s);
  }
  if (set.size === 0) return DEFAULT_STATES;
  // Preserve common order: idle, walk, attack, hurt, then alpha.
  const order = ['idle', 'walk', 'attack', 'hurt', 'run', 'jump', 'cast', 'block', 'death', 'victory'];
  const ordered = order.filter((s) => set.has(s));
  for (const s of [...set].sort()) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
}

function pickCell(rows, cols) {
  // Mirrors the skill's findCellPx algorithm
  for (let cell = 160; cell >= 32; cell -= 16) {
    const w = cols * cell, h = rows * cell;
    if (w % 16 || h % 16) continue;
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > 3) continue;
    const px = w * h;
    if (px < 655360 || px > 8294400) continue;
    return cell;
  }
  for (let cell = 176; cell <= 512; cell += 16) {
    const w = cols * cell, h = rows * cell;
    if (w % 16 || h % 16) continue;
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > 3) continue;
    const px = w * h;
    if (px < 655360 || px > 8294400) continue;
    return cell;
  }
  return 160;
}

/**
 * Generate a small tileset PNG procedurally (no LLM call) given a palette.
 * Each tile is a flat-colored cell. Good enough for v1 prototypes; can be
 * upgraded to call the sprite sheet skill later.
 */
export async function generateTileset({ palette, outPath, tileSize = 16 }) {
  await mkdir(dirname(outPath), { recursive: true });
  const w = tileSize * palette.length, h = tileSize;
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < palette.length; i++) {
    const { r, g, b } = hexToRgb(palette[i].color ?? '#888888');
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const idx = (y * w + (i * tileSize + x)) * 4;
        // Subtle border to make tile edges visible
        const onEdge = x === 0 || y === 0 || x === tileSize - 1 || y === tileSize - 1;
        const f = onEdge ? 0.7 : 1.0;
        buf[idx + 0] = Math.round(r * f);
        buf[idx + 1] = Math.round(g * f);
        buf[idx + 2] = Math.round(b * f);
        buf[idx + 3] = 255;
      }
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
  return { sheet: outPath, tileSize, ids: palette.map((p) => p.id) };
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

const NAMED_COLOR_RGB = {
  blue: '#4060ff', red: '#e04050', green: '#40c050', yellow: '#f0d030',
  purple: '#a040c0', orange: '#f08030', cyan: '#40c0e0', pink: '#f080a0',
  brown: '#a06030', gray: '#808080', grey: '#808080', white: '#f0f0f0',
  black: '#202020', gold: '#e0b040', silver: '#c0c0c0',
};

function colorToHex(phrase) {
  if (!phrase) return '#888888';
  if (/^#[0-9a-f]{3,6}$/i.test(phrase)) return phrase;
  const lower = phrase.toLowerCase();
  for (const [name, hex] of Object.entries(NAMED_COLOR_RGB)) {
    if (lower.includes(name)) return hex;
  }
  return '#888888';
}

/**
 * Procedural placeholder sprites. Each entity gets a row; each animation state
 * gets a column with a distinct silhouette so movement/state changes are visible
 * in tests. Useful when iterating on the framework without burning GPT Image 2 credits.
 */
export async function generateSpritesProcedural({ entities, outDir, relDir, log }) {
  await mkdir(outDir, { recursive: true });
  const cols = mergedStates(entities);
  const groups = chunk(entities, ROWS_PER_SHEET);
  const sprites = [];
  const cellPx = 32; // small, fast, browser still scales via Phaser

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const sheetName = groups.length === 1 ? 'entities.png' : `entities-${i + 1}.png`;
    const sheetPath = resolve(outDir, sheetName);
    const w = cols.length * cellPx;
    const h = g.length * cellPx;
    const buf = Buffer.alloc(w * h * 4);

    for (let row = 0; row < g.length; row++) {
      const e = g[row];
      const { r, g: gC, b } = hexToRgb(colorToHex(e.color));
      for (let col = 0; col < cols.length; col++) {
        const state = cols[col];
        drawCell(buf, w, col * cellPx, row * cellPx, cellPx, { r, g: gC, b }, state, e.kind);
      }
    }

    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(sheetPath);
    log?.info?.(`procedural sheet ${sheetName}: ${w}×${h} (${g.length}r × ${cols.length}c, cell=${cellPx})`);

    sprites.push({
      sheet: sheetPath,
      relSheet: join(relDir, sheetName),
      rows: g.map((e) => e.id),
      cols,
      cell: cellPx,
      bg: 'transparent',
    });
  }
  return { sprites };
}

function drawCell(buf, stride, x0, y0, size, color, state, kind) {
  // Body bbox depends on state: idle tall, walk slightly off-center, attack wider, hurt smaller.
  const margin = 4;
  let bx = x0 + margin, by = y0 + margin, bw = size - margin * 2, bh = size - margin * 2;
  let tint = 1.0;
  if (state === 'walk') { bx += 1; tint = 1.05; }
  if (state === 'attack') { bx -= 2; bw += 4; tint = 1.15; }
  if (state === 'hurt') { by += 2; bh -= 4; tint = 0.6; }
  if (state === 'jump') { by -= 2; tint = 1.1; }
  if (state === 'death') { bh = Math.max(4, bh / 2); by = y0 + size - bh - margin; tint = 0.4; }

  const r = Math.min(255, Math.round(color.r * tint));
  const g = Math.min(255, Math.round(color.g * tint));
  const b = Math.min(255, Math.round(color.b * tint));

  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const idx = (y * stride + x) * 4;
      buf[idx + 0] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
    }
  }
  // Eyes for "kind=player|enemy|boss|npc"
  if (kind === 'player' || kind === 'enemy' || kind === 'boss' || kind === 'npc') {
    const eyeY = by + Math.floor(bh * 0.3);
    const eyeXL = bx + Math.floor(bw * 0.25);
    const eyeXR = bx + Math.floor(bw * 0.7);
    for (const ex of [eyeXL, eyeXR]) {
      const idx = (eyeY * stride + ex) * 4;
      buf[idx + 0] = 255; buf[idx + 1] = 255; buf[idx + 2] = 255; buf[idx + 3] = 255;
    }
  }
  // Outline
  for (let y = by; y < by + bh; y++) {
    for (const x of [bx, bx + bw - 1]) {
      const idx = (y * stride + x) * 4;
      buf[idx + 0] = Math.round(r * 0.4); buf[idx + 1] = Math.round(g * 0.4); buf[idx + 2] = Math.round(b * 0.4); buf[idx + 3] = 255;
    }
  }
  for (let x = bx; x < bx + bw; x++) {
    for (const y of [by, by + bh - 1]) {
      const idx = (y * stride + x) * 4;
      buf[idx + 0] = Math.round(r * 0.4); buf[idx + 1] = Math.round(g * 0.4); buf[idx + 2] = Math.round(b * 0.4); buf[idx + 3] = 255;
    }
  }
}

// ── GPT Image 2 tile generation ───────────────────────────────────────────────

const TILE_DESC_MAP = {
  STONE:  'gray cobblestone dungeon floor, beveled stone blocks with mortar cracks, dark medieval dungeon atmosphere',
  BRICK:  'dark reddish-brown dungeon wall brick, rectangular masonry bricks with mortar gaps, rough castle stone',
  SPIKE:  'metal spike hazard, three sharp metallic spikes pointing upward from a dark iron base plate, danger marker',
  LADDER: 'wooden ladder, brown wooden rungs and vertical side rails, dungeon climbing prop',
  PIPE:   'cyan-colored metal sewer pipe cross-section viewed from the side, cylindrical pipe with rivets and rust stains',
  FLOOR:  'dark grimy concrete sewer tunnel floor, rough worn surface with grime buildup and moisture stains',
  ACID:   'toxic acid pool, bubbling luminescent green liquid with phosphorescent glow at edges, hazard puddle',
  GROUND: 'dirty urban street asphalt, cracked pavement with grime and scuff marks, beat-em-up city floor',
  WALL:   'dark rough concrete wall, charcoal-gray urban surface with subtle wear and weathering texture',
  PROP:   'old wooden crate, dark aged wood planks with metal corner brackets, beat-em-up stage prop',
  GRASS:  'bright green tropical island grass ground, lush vegetation texture with tiny blade details and soil patches',
  WATER:  'deep blue tropical ocean water, rippling wave pattern with light highlights and subtle white foam edges',
  FLOWER: 'small pink tropical flowers, colorful blossoms with green stems on sandy soil background, island decoration',
  TREE:   'dark dense forest tree canopy top-down view, dark green tropical leaves with visible branch structure below',
};

async function getFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  try {
    const envFile = join(homedir(), '.all-skills', '.env');
    const raw = await readFile(envFile, 'utf8');
    const m = raw.match(/^\s*FAL_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch {}
  return null;
}

async function fetchGPTTile(falKey, prompt, quality) {
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${falKey}` },
    body: JSON.stringify({ prompt, image_size: { width: 512, height: 512 }, quality, num_images: 1, output_format: 'png' }),
  });
  if (!res.ok) throw new Error(`GPT Image 2 (fal): ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Buffer.from(await fetch(data.images[0].url).then((r) => r.arrayBuffer()));
}

function solidTile(buf, ti, ts, stride, r, g, b) {
  for (let y = 0; y < ts; y++) {
    for (let x = 0; x < ts; x++) {
      const i = (y * stride + ti * ts + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
}

/**
 * Generate each tile in the palette via GPT Image 2, stitch into a horizontal strip.
 * SKY tiles are filled with solid magenta (Game.js hides them via setAlpha(0)).
 * Falls back to solid-color tiles if FAL_KEY is unavailable or a tile call fails.
 */
export async function generateTilesetGPT({ palette, outPath, tileSize = 32, genre = '', tagline = '', quality = 'low', log = console.log }) {
  await mkdir(dirname(outPath), { recursive: true });

  const falKey = await getFalKey();
  if (!falKey) {
    log('⚠ No FAL_KEY — falling back to solid-color tiles');
    return generateTileset({ palette, outPath, tileSize });
  }

  const n = palette.length;
  const outW = tileSize * n;
  const outH = tileSize;
  const outBuf = Buffer.alloc(outW * outH * 4, 0);

  for (let i = 0; i < n; i++) {
    const tile = palette[i];

    // SKY / transparent → solid magenta; Game.js hides it with setAlpha(0)
    if (tile.id === 'SKY' || tile.color === '#FF00FF') {
      solidTile(outBuf, i, tileSize, outW, 0xFF, 0x00, 0xFF);
      continue;
    }

    const tileDesc = tile.desc
      ?? TILE_DESC_MAP[tile.id]
      ?? `${tile.id.toLowerCase().replace(/_/g, ' ')} tile, ${tile.color}-toned surface`;

    const prompt = [
      `Pixel art game tile, flat seamlessly tileable surface texture: ${tileDesc}.`,
      genre ? `${genre} game aesthetic.` : '',
      tagline ? `${tagline}.` : '',
      'Seamlessly tileable, 16-bit retro pixel art, chunky well-defined pixels, clean sharp edges.',
      'No text, no characters, no HUD elements, no border frame, no drop shadows.',
    ].filter(Boolean).join(' ');

    try {
      log(`  → tile [${i + 1}/${n}] ${tile.id}`);
      const imgBuf = await fetchGPTTile(falKey, prompt, quality);
      const pixels = await sharp(imgBuf)
        .resize(tileSize, tileSize)
        .ensureAlpha()
        .raw()
        .toBuffer();

      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const si = (y * tileSize + x) * 4;
          const di = (y * outW + i * tileSize + x) * 4;
          outBuf[di] = pixels[si]; outBuf[di + 1] = pixels[si + 1];
          outBuf[di + 2] = pixels[si + 2]; outBuf[di + 3] = pixels[si + 3];
        }
      }
    } catch (err) {
      log(`  ⚠ ${tile.id} failed (${err.message}), using solid color`);
      const { r, g, b } = hexToRgb(tile.color ?? '#888888');
      solidTile(outBuf, i, tileSize, outW, r, g, b);
    }
  }

  await sharp(outBuf, { raw: { width: outW, height: outH, channels: 4 } }).png().toFile(outPath);
  return { sheet: outPath, tileSize, ids: palette.map((p) => p.id) };
}
