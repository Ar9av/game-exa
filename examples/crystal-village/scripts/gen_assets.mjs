#!/usr/bin/env node
// Procedural asset generator for crystal-village — high-quality pixel art.
// Run from the project root: node examples/crystal-village/scripts/gen_assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');
const ASSETS = join(ROOT, 'public', 'assets');
await mkdir(ASSETS, { recursive: true });

const TS = 32;

// ── Pixel helpers ────────────────────────────────────────────────────────────
function pix(buf, W, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}
function rect(buf, W, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0+h; y++)
    for (let x = x0; x < x0+w; x++)
      pix(buf, W, x, y, r, g, b, a);
}
function ellipse(buf, W, cx, cy, rx, ry, r, g, b, a = 255) {
  for (let y = Math.ceil(cy-ry); y <= Math.floor(cy+ry); y++)
    for (let x = Math.ceil(cx-rx); x <= Math.floor(cx+rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx*dx + dy*dy <= 1) pix(buf, W, x, y, r, g, b, a);
    }
}
function hline(buf, W, x, y, len, r, g, b) {
  for (let i = 0; i < len; i++) pix(buf, W, x+i, y, r, g, b);
}
function vline(buf, W, x, y, len, r, g, b) {
  for (let i = 0; i < len; i++) pix(buf, W, x, y+i, r, g, b);
}

// ── TILESET (6 tiles × 32px = 192×32) ───────────────────────────────────────
const TILE_COUNT = 6;
const TW = TS * TILE_COUNT, TH = TS;
const tb = Buffer.alloc(TW * TH * 4, 0);

// ─── 0: GRASS ────────────────────────────────────────────────────────────────
{
  const ox = 0;
  rect(tb, TW, ox, 0, TS, TS, 54, 120, 46);
  // Darker shadow patches
  for (const [x,y] of [[2,3],[9,8],[15,3],[20,14],[27,9],[4,20],[12,18],[22,25],[6,28],[29,22]])
    for (const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]])
      pix(tb, TW, ox+x+dx, y+dy, 38, 92, 32);
  // Lighter highlights
  for (const [x,y] of [[6,6],[16,1],[25,12],[11,23],[3,14]])
    for (const [dx,dy] of [[0,0],[1,0]])
      pix(tb, TW, ox+x+dx, y+dy, 76, 154, 60);
  // Grass blade strokes (thin diagonal marks)
  for (const [x,y] of [[5,5],[5,4],[7,2],[7,1],[13,8],[13,7],[18,4],[18,3],
                         [24,7],[24,6],[28,11],[8,16],[8,15],[14,20],[14,19],
                         [21,13],[21,12],[3,27],[26,24],[11,29],[17,27]])
    pix(tb, TW, ox+x, y, 90, 172, 70);
}

// ─── 1: COBBLESTONE PATH ─────────────────────────────────────────────────────
{
  const ox = TS;
  rect(tb, TW, ox, 0, TS, TS, 136, 114, 84);
  // 6 rounded cobblestones
  const stones = [
    [2,2,12,8], [16,2,13,8],
    [2,12,9,8], [13,12,15,8],
    [2,22,12,8], [16,22,13,8],
  ];
  for (const [sx, sy, sw, sh] of stones) {
    rect(tb, TW, ox+sx, sy, sw, sh, 198, 172, 130);
    // Top-left highlight
    hline(tb, TW, ox+sx, sy, sw, 222, 200, 160);
    vline(tb, TW, ox+sx, sy+1, sh-1, 212, 188, 148);
    // Inner face lighter centre
    rect(tb, TW, ox+sx+2, sy+2, sw-4, sh-4, 208, 182, 140);
    // Bottom-right shadow
    hline(tb, TW, ox+sx+1, sy+sh-1, sw-1, 148, 122, 85);
    vline(tb, TW, ox+sx+sw-1, sy+1, sh-2, 155, 130, 92);
  }
}

// ─── 2: WATER ────────────────────────────────────────────────────────────────
{
  const ox = TS*2;
  rect(tb, TW, ox, 0, TS, TS, 22, 58, 168);
  // Wave highlight bands (sinusoidal)
  for (let band = 0; band < 5; band++) {
    const baseY = band * 6 + 2;
    for (let x = 0; x < TS; x++) {
      const wave = Math.round(Math.sin((x / TS) * Math.PI * 3 + band * 1.2) * 2);
      const y = baseY + wave;
      if (y >= 0 && y < TS) pix(tb, TW, ox+x, y, 58, 110, 210);
      if (y-1 >= 0 && y-1 < TS) pix(tb, TW, ox+x, y-1, 44, 88, 190);
    }
  }
  // Sparkles and foam
  for (const [x,y] of [[3,1],[11,4],[20,0],[28,3],[7,8],[16,11],[24,6],
                         [4,14],[18,16],[29,12],[9,20],[22,23],[6,26],[15,29],[27,25]])
    pix(tb, TW, ox+x, y, 155, 210, 255);
  for (const [x,y] of [[3,1],[20,0],[15,29]])
    pix(tb, TW, ox+x, y, 235, 248, 255); // bright sparkles
}

// ─── 3: STONE WALL ───────────────────────────────────────────────────────────
{
  const ox = TS*3;
  rect(tb, TW, ox, 0, TS, TS, 72, 72, 88);
  const bH = 8, bW = 15;
  for (let row = 0; row < 4; row++) {
    const y0  = row * bH;
    const off = (row % 2) * 7;
    for (let bx = -off; bx < TS; bx += bW) {
      const x0  = Math.max(0, bx);
      const x1  = Math.min(bx + bW - 1, TS - 1);
      const w   = x1 - x0;
      if (w <= 0) continue;
      // Face
      rect(tb, TW, ox+x0+1, y0+1, w-1, bH-2, 118, 116, 140);
      // Top highlight
      hline(tb, TW, ox+x0+1, y0+1, w-1, 145, 143, 168);
      // Left highlight
      vline(tb, TW, ox+x0+1, y0+2, bH-3, 132, 130, 155);
      // Bottom shadow
      hline(tb, TW, ox+x0+1, y0+bH-2, w-1, 88, 86, 106);
      // Right shadow
      if (x1 < TS-1) vline(tb, TW, ox+x1, y0+2, bH-3, 94, 92, 112);
    }
  }
}

// ─── 4: FLOWER PATCH ─────────────────────────────────────────────────────────
{
  const ox = TS*4;
  rect(tb, TW, ox, 0, TS, TS, 54, 120, 46);
  // Grass variation
  for (const [x,y] of [[8,6],[18,2],[27,9],[5,15],[14,22],[24,17],[3,26]])
    for (const [dx,dy] of [[0,0],[1,0],[0,1]])
      pix(tb, TW, ox+x+dx, y+dy, 38, 92, 32);
  const flowers = [
    [5, 5, [255, 135, 195]],  // pink
    [14, 11, [255, 225, 70]], // yellow
    [24, 5, [195, 138, 255]], // lavender
    [8, 22, [255, 182, 120]], // peach
    [20, 20, [255, 135, 195]],// pink
    [28, 14, [255, 248, 140]],// light yellow
    [11, 28, [200, 178, 255]],// light purple
    [3, 14, [255, 210, 220]], // pale pink
  ];
  for (const [cx, cy, [pr,pg,pb]] of flowers) {
    // Stem
    pix(tb, TW, ox+cx, cy+2, 38, 112, 38);
    // 4 petals + center
    for (const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2]])
      pix(tb, TW, ox+cx+dx, cy+dy, pr, pg, pb);
    pix(tb, TW, ox+cx-1, cy-1, Math.min(255,pr+30), Math.min(255,pg+30), Math.min(255,pb+30));
    pix(tb, TW, ox+cx, cy, 255, 235, 55); // yellow center
    pix(tb, TW, ox+cx+1, cy, 220, 200, 45);
  }
}

// ─── 5: TREE ─────────────────────────────────────────────────────────────────
{
  const ox = TS*5;
  rect(tb, TW, ox, 0, TS, TS, 26, 62, 26);
  // Trunk
  rect(tb, TW, ox+12, 21, 8, 11, 102, 62, 28);
  vline(tb, TW, ox+13, 21, 11, 122, 76, 38);
  vline(tb, TW, ox+19, 21, 11, 78, 46, 18);
  // Canopy — multiple ellipse layers for depth
  ellipse(tb, TW, ox+16, 14, 13, 11, 34, 80, 30);
  ellipse(tb, TW, ox+16, 13, 11, 9,  52, 118, 44);
  ellipse(tb, TW, ox+15, 11, 9,  7,  72, 150, 56);
  ellipse(tb, TW, ox+15, 9,  7,  5,  96, 186, 72);
  ellipse(tb, TW, ox+15, 7,  5,  4, 118, 210, 86);
  // Top bright highlight cluster
  for (const [x,y] of [[14,5],[15,4],[16,4],[17,4],[15,5],[16,5],[15,6],[16,6]])
    pix(tb, TW, ox+x, y, 145, 232, 100);
  pix(tb, TW, ox+16, 3, 175, 248, 120);
}

await sharp(tb, { raw: { width: TW, height: TH, channels: 4 } }).png().toFile(join(ASSETS, 'tiles.png'));
console.log('✓ tiles.png');

// ── ENTITY SPRITESHEET ────────────────────────────────────────────────────────
// 5 rows (HERO, ELDER, VILLAGER, GUARD, CRYSTAL) × 2 cols (idle, walk)
const ENTITIES = ['HERO', 'ELDER', 'VILLAGER', 'GUARD', 'CRYSTAL'];
const COLS     = ['idle', 'walk'];
const CELL     = 32;
const EW = COLS.length * CELL;
const EH = ENTITIES.length * CELL;
const eb = Buffer.alloc(EW * EH * 4, 0);

// ── Character drawing helpers ─────────────────────────────────────────────────

// Draw outline around all opaque pixels
function addOutline(buf, W, x0, y0, sz, or, og, ob) {
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let y = y0; y < y0+sz; y++)
    for (let x = x0; x < x0+sz; x++) {
      if (buf[(y*W+x)*4+3] < 200) continue;
      for (const [dx,dy] of dirs) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || nx >= W || ny < 0) continue;
        if (buf[(ny*W+nx)*4+3] < 200)
          pix(buf, W, nx, ny, or, og, ob);
      }
    }
}

// ─── HERO (row 0): blue adventurer ─────────────────────────────────────────
function drawHero(buf, W, x0, y0, walk) {
  const half = x0 + CELL/2;

  // Brown hair cap
  ellipse(buf, W, half, y0+7, 6, 5, 118, 66, 22);
  // Hair top
  rect(buf, W, half-5, y0+3, 10, 4, 132, 76, 28);
  hline(buf, W, half-4, y0+3, 8, 148, 92, 38); // lighter top edge

  // Skin face
  ellipse(buf, W, half, y0+10, 6, 6, 255, 208, 156);
  // Face shading
  pix(buf, W, half-5, y0+10, 228, 178, 122);
  pix(buf, W, half+5, y0+10, 228, 178, 122);
  pix(buf, W, half, y0+14, 240, 188, 132);

  // Eyes
  pix(buf, W, half-2, y0+9, 38, 24, 12);
  pix(buf, W, half+2, y0+9, 38, 24, 12);
  // Eye whites
  pix(buf, W, half-2, y0+8, 245, 238, 220);
  pix(buf, W, half+2, y0+8, 245, 238, 220);
  // Nose
  pix(buf, W, half, y0+11, 220, 165, 110);
  // Smile
  pix(buf, W, half-1, y0+12, 195, 135, 85);
  pix(buf, W, half+1, y0+12, 195, 135, 85);

  // Red bandana on forehead
  rect(buf, W, half-5, y0+6, 10, 2, 215, 50, 50);
  pix(buf, W, half-5, y0+6, 185, 32, 32);

  // Body — blue tunic
  rect(buf, W, half-5, y0+16, 10, 8, 66, 128, 212);
  vline(buf, W, half-5, y0+16, 8, 44, 92, 170);
  vline(buf, W, half+4, y0+16, 8, 44, 92, 170);
  hline(buf, W, half-4, y0+16, 8, 88, 155, 242); // collar highlight
  // Tunic inner detail
  vline(buf, W, half, y0+17, 5, 78, 140, 222);

  // Belt
  rect(buf, W, half-5, y0+24, 10, 2, 82, 56, 28);
  pix(buf, W, half, y0+24, 218, 178, 55); // buckle
  pix(buf, W, half+1, y0+24, 195, 158, 45);

  // Arms
  rect(buf, W, half-8, y0+16, 3, 7, 66, 128, 212);
  rect(buf, W, half+5, y0+16, 3, 7, 66, 128, 212);
  // Hands (skin)
  ellipse(buf, W, half-7, y0+22, 2, 2, 255, 208, 156);
  ellipse(buf, W, half+7, y0+22, 2, 2, 255, 208, 156);

  // Legs — dark pants
  const lY = walk ? y0+26 : y0+26, rY = walk ? y0+26 : y0+26;
  const lX = walk ? -2 : 0, rX = walk ? 2 : 0;
  rect(buf, W, half-5+lX, lY, 4, 6, 44, 76, 148);
  rect(buf, W, half+1-rX, rY, 4, 6, 44, 76, 148);

  // Boots
  rect(buf, W, half-5+lX, lY+5, 5, 3, 108, 68, 28);
  rect(buf, W, half+1-rX, rY+5, 5, 3, 108, 68, 28);
  hline(buf, W, half-6+lX, lY+7, 6, 80, 48, 18);
  hline(buf, W, half-rX,   rY+7, 6, 80, 48, 18);

  addOutline(buf, W, x0, y0, CELL, 28, 18, 8);
}
drawHero(eb, EW, 0,    0, false);
drawHero(eb, EW, CELL, 0, true);

// ─── ELDER (row 1): purple robes, silver hair, hat ─────────────────────────
function drawElder(buf, W, x0, y0, walk) {
  const half = x0 + CELL/2;

  // Pointy wizard hat (purple with star)
  for (let i = 0; i < 10; i++) {
    const w = 2 + i;
    rect(buf, W, half - w/2|0, y0+i, w, 1, 128, 52, 188);
  }
  rect(buf, W, half-6, y0+10, 12, 3, 148, 68, 215);
  pix(buf, W, half, y0+2, 255, 230, 60); // hat star
  pix(buf, W, half-1, y0+3, 255, 210, 40);
  pix(buf, W, half+1, y0+3, 255, 210, 40);

  // Silver hair flowing
  rect(buf, W, half-6, y0+12, 12, 3, 196, 190, 178);
  pix(buf, W, half-6, y0+14, 180, 174, 162);
  pix(buf, W, half-7, y0+15, 180, 174, 162);
  pix(buf, W, half+6, y0+14, 180, 174, 162);
  pix(buf, W, half+7, y0+15, 180, 174, 162);

  // Face
  ellipse(buf, W, half, y0+14, 5, 5, 225, 182, 132);
  // White beard
  rect(buf, W, half-3, y0+17, 6, 4, 215, 210, 200);
  pix(buf, W, half, y0+21, 200, 195, 185);
  // Eyes
  pix(buf, W, half-2, y0+13, 38, 28, 18);
  pix(buf, W, half+2, y0+13, 38, 28, 18);
  // Wise expression lines
  pix(buf, W, half-3, y0+12, 195, 152, 108); // eyebrow left
  pix(buf, W, half+3, y0+12, 195, 152, 108);

  // Robes — wide trapezoid
  rect(buf, W, half-5, y0+22, 10, 10, 128, 52, 188);
  rect(buf, W, half-6, y0+26, 12, 6, 128, 52, 188);
  // Robe shading
  vline(buf, W, half-5, y0+22, 10, 100, 38, 155);
  vline(buf, W, half+4, y0+22, 10, 100, 38, 155);
  // Robe highlight
  vline(buf, W, half, y0+23, 7, 148, 72, 215);
  // Gold trim
  hline(buf, W, half-6, y0+31, 12, 198, 168, 58);

  // Staff (right side)
  vline(buf, W, half+8, y0+18, 14, 128, 92, 44);
  ellipse(buf, W, half+8, y0+17, 2, 2, 80, 225, 255);
  pix(buf, W, half+8, y0+15, 200, 240, 255);

  // Robe hem / boot hint
  rect(buf, W, half-4, y0+31, 4, 1, 82, 52, 28 + (walk?1:0));
  rect(buf, W, half+1, y0+31, 4, 1, 82, 52, 28);

  addOutline(buf, W, x0, y0, CELL, 28, 18, 8);
}
drawElder(eb, EW, 0,    CELL, false);
drawElder(eb, EW, CELL, CELL, true);

// ─── VILLAGER (row 2): orange tunic, brown hair, friendly ──────────────────
function drawVillager(buf, W, x0, y0, walk) {
  const half = x0 + CELL/2;

  // Brown hair
  ellipse(buf, W, half, y0+8, 6, 5, 142, 86, 28);
  rect(buf, W, half-5, y0+4, 10, 4, 155, 98, 36);
  hline(buf, W, half-4, y0+4, 8, 168, 112, 46);

  // Face
  ellipse(buf, W, half, y0+11, 6, 6, 255, 208, 156);
  pix(buf, W, half-5, y0+11, 230, 180, 126);
  pix(buf, W, half+5, y0+11, 230, 180, 126);
  // Eyes + friendly eyebrows
  pix(buf, W, half-2, y0+10, 42, 28, 14);
  pix(buf, W, half+2, y0+10, 42, 28, 14);
  pix(buf, W, half-2, y0+9, 100, 70, 28); // eyebrows
  pix(buf, W, half+2, y0+9, 100, 70, 28);
  // Big smile
  pix(buf, W, half-2, y0+13, 195, 135, 80);
  pix(buf, W, half+2, y0+13, 195, 135, 80);
  pix(buf, W, half, y0+14, 195, 135, 80);
  // Rosy cheeks
  pix(buf, W, half-4, y0+12, 245, 175, 155);
  pix(buf, W, half+4, y0+12, 245, 175, 155);

  // Orange tunic
  rect(buf, W, half-5, y0+17, 10, 9, 218, 132, 52);
  vline(buf, W, half-5, y0+17, 9, 188, 108, 36);
  vline(buf, W, half+4, y0+17, 9, 188, 108, 36);
  hline(buf, W, half-4, y0+17, 8, 238, 155, 70);
  // Apron pocket detail
  rect(buf, W, half-2, y0+21, 4, 3, 198, 155, 78);
  outline_rect(buf, W, half-2, y0+21, 4, 3, 168, 125, 52);

  // Arms
  rect(buf, W, half-8, y0+17, 3, 7, 218, 132, 52);
  rect(buf, W, half+5, y0+17, 3, 7, 218, 132, 52);
  ellipse(buf, W, half-7, y0+23, 2, 2, 255, 208, 156);
  ellipse(buf, W, half+7, y0+23, 2, 2, 255, 208, 156);

  // Pants (beige)
  const lX = walk ? -2 : 0, rX = walk ? 2 : 0;
  rect(buf, W, half-5+lX, y0+26, 4, 5, 175, 148, 108);
  rect(buf, W, half+1-rX, y0+26, 4, 5, 175, 148, 108);
  // Boots
  rect(buf, W, half-5+lX, y0+30, 5, 2, 98, 66, 26);
  rect(buf, W, half+1-rX, y0+30, 5, 2, 98, 66, 26);

  addOutline(buf, W, x0, y0, CELL, 28, 18, 8);
}
function outline_rect(buf, W, x0, y0, w, h, r, g, b) {
  hline(buf, W, x0, y0, w, r, g, b);
  hline(buf, W, x0, y0+h-1, w, r, g, b);
  vline(buf, W, x0, y0+1, h-2, r, g, b);
  vline(buf, W, x0+w-1, y0+1, h-2, r, g, b);
}
drawVillager(eb, EW, 0,    CELL*2, false);
drawVillager(eb, EW, CELL, CELL*2, true);

// ─── GUARD (row 3): red armor, gray helmet ─────────────────────────────────
function drawGuard(buf, W, x0, y0, walk) {
  const half = x0 + CELL/2;

  // Helmet — gray dome
  ellipse(buf, W, half, y0+8, 7, 6, 132, 132, 148);
  rect(buf, W, half-6, y0+10, 12, 4, 142, 142, 160);
  hline(buf, W, half-5, y0+8, 10, 168, 168, 185); // dome highlight
  // Visor slit
  rect(buf, W, half-4, y0+12, 8, 2, 38, 38, 48);
  pix(buf, W, half-3, y0+12, 55, 65, 88);
  pix(buf, W, half+3, y0+12, 55, 65, 88);
  // Helmet plume (red)
  vline(buf, W, half, y0+2, 6, 215, 48, 48);
  pix(buf, W, half-1, y0+3, 215, 48, 48);
  pix(buf, W, half+1, y0+3, 215, 48, 48);

  // Chin / neck guard
  rect(buf, W, half-4, y0+14, 8, 3, 128, 128, 142);
  // Skin (just cheeks visible)
  pix(buf, W, half-4, y0+13, 228, 178, 125);
  pix(buf, W, half+4, y0+13, 228, 178, 125);

  // Red chest plate (cuirass)
  rect(buf, W, half-6, y0+17, 12, 9, 178, 52, 52);
  // Armor highlights
  hline(buf, W, half-5, y0+17, 10, 208, 72, 72);
  vline(buf, W, half-6, y0+17, 9, 148, 38, 38);
  vline(buf, W, half+5, y0+17, 9, 148, 38, 38);
  // Chest emblem (gold diamond)
  pix(buf, W, half, y0+20, 218, 178, 55);
  pix(buf, W, half-1, y0+21, 218, 178, 55);
  pix(buf, W, half+1, y0+21, 218, 178, 55);
  pix(buf, W, half, y0+22, 218, 178, 55);

  // Shoulder pauldrons
  ellipse(buf, W, half-7, y0+17, 3, 3, 138, 138, 158);
  ellipse(buf, W, half+7, y0+17, 3, 3, 138, 138, 158);

  // Arms (armored)
  rect(buf, W, half-9, y0+20, 3, 6, 132, 132, 148);
  rect(buf, W, half+6, y0+20, 3, 6, 132, 132, 148);
  // Gauntlets
  rect(buf, W, half-9, y0+25, 3, 2, 118, 118, 132);
  rect(buf, W, half+6, y0+25, 3, 2, 118, 118, 132);

  // Armored pants (gray)
  const lX = walk ? -2 : 0, rX = walk ? 2 : 0;
  rect(buf, W, half-5+lX, y0+26, 4, 5, 100, 100, 118);
  rect(buf, W, half+1-rX, y0+26, 4, 5, 100, 100, 118);
  // Dark boots
  rect(buf, W, half-5+lX, y0+30, 5, 2, 55, 55, 68);
  rect(buf, W, half+1-rX, y0+30, 5, 2, 55, 55, 68);
  hline(buf, W, half-6+lX, y0+31, 6, 40, 40, 52);
  hline(buf, W, half-rX,   y0+31, 6, 40, 40, 52);

  addOutline(buf, W, x0, y0, CELL, 28, 18, 8);
}
drawGuard(eb, EW, 0,    CELL*3, false);
drawGuard(eb, EW, CELL, CELL*3, true);

// ─── CRYSTAL (row 4): multi-faceted gem ────────────────────────────────────
function drawCrystal(buf, W, x0, y0, walk) {
  const cx = x0 + CELL/2;
  const cy = y0 + CELL/2 + 1;
  const wobble = walk ? 2 : 0;

  // Outer glow ring
  ellipse(buf, W, cx, cy+wobble, 10, 11, 100, 230, 255, 40);
  ellipse(buf, W, cx, cy+wobble, 9,  10, 120, 240, 255, 60);

  // Main gem — diamond shape using multiple pixels
  const R = 8;
  for (let y = cy-R+wobble; y <= cy+R+wobble; y++) {
    const dist = Math.abs(y - (cy+wobble));
    const halfW = R - dist;
    for (let x = cx-halfW; x <= cx+halfW; x++) {
      const fx = (x - cx) / R;
      const fy = (y - cy - wobble) / R;
      // Color zones: top = bright cyan, bottom = deep blue, sides = mid
      let r, g, b;
      if (fy < -0.3) { r=80;  g=235; b=255; } // top bright
      else if (fy < 0.2) { r=50; g=185; b=245; } // mid
      else { r=22; g=120; b=210; } // bottom dark
      // Left face darker, right slightly lighter
      if (fx < -0.3) { r=Math.max(0,r-30); g=Math.max(0,g-25); b=Math.max(0,b-15); }
      else if (fx > 0.3) { r=Math.min(255,r+15); g=Math.min(255,g+10); b=Math.min(255,b+5); }
      pix(buf, W, x, y, r, g, b);
    }
  }

  // Central facet line (horizontal)
  hline(buf, W, cx-5, cy+wobble, 10, 30, 155, 215);
  // Vertical facet line
  for (let d = -5; d <= 5; d++)
    pix(buf, W, cx, cy+d+wobble, 35, 160, 220);

  // Inner bright highlight (upper-left)
  for (const [dx,dy] of [[-2,-4],[-3,-3],[-2,-3],[-1,-4]])
    pix(buf, W, cx+dx, cy+dy+wobble, 180, 248, 255);

  // Star sparkle at top
  const sx = cx-1, sy = cy-R-1+wobble;
  pix(buf, W, sx,   sy,   255, 255, 255);
  pix(buf, W, sx-2, sy,   200, 240, 255);
  pix(buf, W, sx+2, sy,   200, 240, 255);
  pix(buf, W, sx,   sy-2, 200, 240, 255);
  pix(buf, W, sx,   sy+1, 220, 248, 255);

  // Dark outline
  addOutline(buf, W, x0, y0, CELL, 18, 100, 145);
}
drawCrystal(eb, EW, 0,    CELL*4, false);
drawCrystal(eb, EW, CELL, CELL*4, true);

await sharp(eb, { raw: { width: EW, height: EH, channels: 4 } }).png().toFile(join(ASSETS, 'entities.png'));
console.log('✓ entities.png');

// ── MANIFEST ─────────────────────────────────────────────────────────────────
const manifest = {
  sprites: [{
    sheet:      join(ASSETS, 'entities.png'),
    relSheet:   'assets/entities.png',
    rows:       ENTITIES,
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
