#!/usr/bin/env node
// Procedural asset generator for crystal-village.
// Run from the gamewright project root: node examples/crystal-village/scripts/gen_assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const ASSETS = join(ROOT, 'public', 'assets');
await mkdir(ASSETS, { recursive: true });

const TS = 32;

function pix(buf, W, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}
function rect(buf, W, x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      pix(buf, W, x, y, r, g, b);
}

// ── TILESET ──────────────────────────────────────────────────────────────────
// 6 tiles × 32px = 192×32
const TILE_COUNT = 6;
const TW = TS * TILE_COUNT, TH = TS;
const tb = Buffer.alloc(TW * TH * 4, 0);

// 0: GRASS
rect(tb, TW, 0, 0, TS, TS, 58, 138, 58);
for (const [x, y] of [[4,3],[9,8],[15,5],[20,13],[26,9],[12,18],[5,23],[28,19],[17,29],[7,14],[22,25],[2,27]])
  for (const [dx,dy] of [[0,0],[1,0],[0,1]])
    pix(tb, TW, x+dx, y+dy, 40, 100, 40);

// 1: PATH (cobblestone-ish)
rect(tb, TW, TS, 0, TS, TS, 185, 152, 95);
for (const [sx,sy,sw,sh] of [[2,2,11,5],[14,4,12,4],[2,13,8,6],[12,14,12,7],[5,23,13,5]]) {
  rect(tb, TW, TS+sx, sy, sw, sh, 202, 170, 112);
  rect(tb, TW, TS+sx, sy-1, sw, 1, 148, 115, 70);
  rect(tb, TW, TS+sx, sy+sh, sw, 1, 148, 115, 70);
  rect(tb, TW, TS+sx-1, sy, 1, sh, 148, 115, 70);
  rect(tb, TW, TS+sx+sw, sy, 1, sh, 148, 115, 70);
}

// 2: WATER
rect(tb, TW, TS*2, 0, TS, TS, 44, 94, 200);
for (let y = 2; y < TS; y += 6)
  for (let x = 0; x < TS; x++)
    if (((x * 2 + y) % 7) < 3) pix(tb, TW, TS*2+x, y, 76, 128, 222);
for (const [x,y] of [[3,4],[11,4],[20,4],[3,10],[11,10],[20,10],[3,17],[11,17],[20,17],[3,23],[11,23],[20,23]])
  pix(tb, TW, TS*2+x, y, 170, 210, 255);

// 3: STONE WALL (brick pattern)
rect(tb, TW, TS*3, 0, TS, TS, 88, 88, 100);
for (let y = 0; y < TS; y += 9) rect(tb, TW, TS*3, y, TS, 1, 54, 54, 66);
for (let row = 0; row < 4; row++) {
  const y = row * 9;
  const off = (row % 2) * 16;
  for (let x = 0; x < TS; x += 16)
    rect(tb, TW, TS*3 + ((x + off) % TS), y, 1, 9, 54, 54, 66);
  const bx = (off === 0) ? 1 : 17;
  rect(tb, TW, TS*3+bx, y+1, 13, 7, 110, 110, 125);
  rect(tb, TW, TS*3+bx+16, y+1, 13, 7, 110, 110, 125);
}

// 4: FLOWER PATCH
rect(tb, TW, TS*4, 0, TS, TS, 58, 138, 58);
for (const [dx,dy] of [[4,3],[9,8],[15,5],[20,13],[26,9],[12,18],[5,23],[28,19],[17,29],[7,14]])
  for (const [ox,oy] of [[0,0],[1,0],[0,1]])
    pix(tb, TW, TS*4+dx+ox, dy+oy, 40, 100, 40);
for (const [fx,fy] of [[5,5],[14,11],[23,5],[8,20],[27,15],[11,28],[20,24],[3,14],[26,27]]) {
  pix(tb, TW, TS*4+fx,   fy-2, 240, 140, 200);
  pix(tb, TW, TS*4+fx,   fy+2, 240, 140, 200);
  pix(tb, TW, TS*4+fx-2, fy,   240, 140, 200);
  pix(tb, TW, TS*4+fx+2, fy,   240, 140, 200);
  pix(tb, TW, TS*4+fx,   fy,   255, 230,  50);
}

// 5: TREE (dark blob with lighter highlight)
rect(tb, TW, TS*5, 0, TS, TS, 22, 55, 22);
const tcx = TS*5 + TS/2, tcy = TS/2 - 1;
for (let y = 1; y < TS-1; y++) {
  for (let x = 1; x < TS-1; x++) {
    const dx = (x + TS*5) - tcx, dy = y - tcy;
    if ((dx*dx)/130 + (dy*dy)/160 <= 1) {
      const shade = dy < -3 ? 1.35 : (dy < 4 ? 1.1 : 0.85);
      const base = dy < -3 ? 65 : 52;
      pix(tb, TW, x + TS*5, y,
        Math.min(255, Math.round((base - 25) * shade)),
        Math.min(255, Math.round((base + 15) * shade)),
        Math.min(255, Math.round((base - 25) * shade)));
    }
  }
}
// Top highlight
for (const [x,y] of [[14,7],[15,7],[16,7],[15,8],[14,6],[16,8]])
  pix(tb, TW, TS*5+x, y, 120, 200, 100);

await sharp(tb, { raw: { width: TW, height: TH, channels: 4 } }).png().toFile(join(ASSETS, 'tiles.png'));
console.log('✓ tiles.png');

// ── ENTITY SPRITESHEET ────────────────────────────────────────────────────────
// Rows: HERO, ELDER, VILLAGER, GUARD, CRYSTAL
// Cols: idle, walk
const ENTITIES = [
  { id: 'HERO',     rgb: [60,  120, 220], kind: 'player' },
  { id: 'ELDER',    rgb: [160,  60, 200], kind: 'npc'    },
  { id: 'VILLAGER', rgb: [220, 140,  60], kind: 'npc'    },
  { id: 'GUARD',    rgb: [200,  60,  60], kind: 'npc'    },
  { id: 'CRYSTAL',  rgb: [60,  220, 220], kind: 'pickup' },
];
const COLS = ['idle', 'walk'];
const CELL = 32;
const EW = COLS.length * CELL, EH = ENTITIES.length * CELL;
const eb = Buffer.alloc(EW * EH * 4, 0);

for (let row = 0; row < ENTITIES.length; row++) {
  const { rgb, kind } = ENTITIES[row];
  for (let col = 0; col < COLS.length; col++) {
    drawChar(eb, EW, col * CELL, row * CELL, CELL, rgb, kind, COLS[col]);
  }
}

function drawChar(buf, stride, x0, y0, sz, [r,g,b], kind, state) {
  if (kind === 'pickup') {
    // Gem / crystal diamond shape
    const cx = x0 + sz/2, cy = y0 + sz/2 + 1;
    for (let y = y0+4; y < y0+sz-3; y++) {
      for (let x = x0+4; x < x0+sz-3; x++) {
        const adx = Math.abs(x - cx), ady = Math.abs(y - cy);
        if (adx + ady < (sz * 0.37)) {
          const f = (y < cy) ? 1.25 : 0.75;
          pix(buf, stride, x, y, Math.min(255, r*f), Math.min(255, g*f), Math.min(255, b*f));
        }
      }
    }
    // Facet lines
    for (let i = 3; i < sz-4; i++) {
      const adx = Math.abs(i - (sz/2-x0)), _ = 0;
      if (adx < sz*0.3) pix(buf, stride, x0+i, y0+sz/2, Math.min(255,r*0.5), Math.min(255,g*0.5), Math.min(255,b*0.5));
    }
    // Sparkle
    pix(buf, stride, cx, y0+6, 255, 255, 255);
    pix(buf, stride, cx+1, y0+5, 220, 255, 255);
    return;
  }

  const m = 5;
  let bx = x0+m, by = y0+m, bw = sz-m*2, bh = sz-m*2;
  if (state === 'walk') { bx += 1; bh -= 1; by += 1; }

  // Body
  rect(buf, stride, bx, by, bw, bh, r, g, b);

  // Head (top 35%)
  const hh = Math.floor(bh * 0.36);
  const skinR = Math.min(255, r+50), skinG = Math.min(255, g+35), skinB = Math.min(255, b+20);
  rect(buf, stride, bx+1, by, bw-2, hh, skinR, skinG, skinB);

  // Eyes
  const ey = by + Math.floor(hh * 0.45);
  pix(buf, stride, bx + Math.floor(bw*0.28), ey, 25, 25, 25);
  pix(buf, stride, bx + Math.floor(bw*0.65), ey, 25, 25, 25);

  // Hat/hair for NPC differentiation
  if (kind === 'npc') {
    rect(buf, stride, bx+1, by, bw-2, 2, Math.max(0,r-50), Math.max(0,g-40), Math.max(0,b-30));
  } else if (kind === 'player') {
    // Hair
    rect(buf, stride, bx+2, by-1, bw-4, 2, Math.max(0,r-60), Math.max(0,g-60), 30);
  }

  // Outline
  for (let y = by; y < by+bh; y++) {
    pix(buf, stride, bx, y, r*0.35|0, g*0.35|0, b*0.35|0);
    pix(buf, stride, bx+bw-1, y, r*0.35|0, g*0.35|0, b*0.35|0);
  }
  for (let x = bx; x < bx+bw; x++) {
    pix(buf, stride, x, by, r*0.35|0, g*0.35|0, b*0.35|0);
    pix(buf, stride, x, by+bh-1, r*0.35|0, g*0.35|0, b*0.35|0);
  }
}

await sharp(eb, { raw: { width: EW, height: EH, channels: 4 } }).png().toFile(join(ASSETS, 'entities.png'));
console.log('✓ entities.png');

// ── MANIFEST ─────────────────────────────────────────────────────────────────
const manifest = {
  sprites: [{
    sheet:      join(ASSETS, 'entities.png'),
    relSheet:   'assets/entities.png',
    rows:       ENTITIES.map(e => e.id),
    cols:       COLS,
    cell:       CELL,
    bg:         'transparent',
    textureKey: 'entities-1',
  }],
  tiles: {
    relSheet: 'assets/tiles.png',
    tileSize: TS,
    ids:      ['GRASS', 'PATH', 'WATER', 'STONE_WALL', 'FLOWER', 'TREE'],
    passable: [true,    true,   false,   false,        true,     false],
  },
  bg: null,
};
await writeFile(join(ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('✓ manifest.json');
