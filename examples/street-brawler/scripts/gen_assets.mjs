#!/usr/bin/env node
// Procedural asset generator for street-brawler.
// Run: node examples/street-brawler/scripts/gen_assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DATA   = join(ROOT, 'public', 'data');
await mkdir(ASSETS, { recursive: true });
await mkdir(DATA,   { recursive: true });

// ── Pixel helpers ─────────────────────────────────────────────────────────────

function pix(buf, W, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}

function rect(buf, W, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      pix(buf, W, x, y, r, g, b, a);
}

function ellipse(buf, W, cx, cy, rx, ry, r, g, b, a = 255) {
  const y0 = Math.ceil(cy - ry), y1 = Math.floor(cy + ry);
  const x0 = Math.ceil(cx - rx), x1 = Math.floor(cx + rx);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) pix(buf, W, x, y, r, g, b, a);
    }
}

function hline(buf, W, x, y, len, r, g, b) {
  for (let i = 0; i < len; i++) pix(buf, W, x + i, y, r, g, b);
}

function vline(buf, W, x, y, len, r, g, b) {
  for (let i = 0; i < len; i++) pix(buf, W, x, y + i, r, g, b);
}

// Two-pass outline — never draw in-place during the scan pass
function addOutline(buf, W, x0, y0, sz, oR, oG, oB) {
  const toFill = [];
  for (let y = y0; y < y0 + sz; y++)
    for (let x = x0; x < x0 + sz; x++) {
      if (buf[(y * W + x) * 4 + 3] < 200) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx >= x0 + sz || ny < y0 || ny >= y0 + sz) continue;
        if (buf[(ny * W + nx) * 4 + 3] < 200) toFill.push(nx, ny);
      }
    }
  for (let i = 0; i < toFill.length; i += 2)
    pix(buf, W, toFill[i], toFill[i + 1], oR, oG, oB);
}

// ── TILESET (4 tiles × 32px) ──────────────────────────────────────────────────

const TS = 32;
const TILE_COUNT = 4;
const TW = TS * TILE_COUNT, TH = TS;
const tb = Buffer.alloc(TW * TH * 4, 0);

// 0: GROUND — cracked asphalt
{
  const ox = 0;
  rect(tb, TW, ox, 0, TS, TS, 68, 62, 58);
  // Crack lines
  for (let i = 0; i < TS; i++) {
    if (i < 10) pix(tb, TW, ox + i, 12, 48, 42, 38);
    if (i > 6 && i < 18) pix(tb, TW, ox + i, 12 + (i - 6), 48, 42, 38);
    if (i > 20 && i < 30) pix(tb, TW, ox + i, 22, 48, 42, 38);
  }
  // Lighter patches (worn sections)
  for (const [x, y, w, h] of [[2,2,4,3],[18,8,5,3],[8,20,4,4],[22,26,6,3],[4,27,4,2],[26,4,4,4]]) {
    rect(tb, TW, ox + x, y, w, h, 90, 82, 76);
  }
  // Darker grit
  for (const [x, y] of [[5,5],[12,3],[20,15],[7,24],[28,19],[14,28],[3,16],[25,10],[9,9],[17,22]]) {
    pix(tb, TW, ox + x, y, 50, 44, 40);
    pix(tb, TW, ox + x + 1, y, 50, 44, 40);
  }
  // Yellow lane-marking dash
  hline(tb, TW, ox + 13, 1, 6, 160, 140, 30);
  hline(tb, TW, ox + 13, 2, 6, 160, 140, 30);
}

// 1: WALL — dark brick
{
  const ox = TS;
  rect(tb, TW, ox, 0, TS, TS, 40, 34, 30);
  // Mortar grid
  for (let row = 0; row < 4; row++) {
    const by = row * 8;
    hline(tb, TW, ox, by, TS, 28, 24, 22);
    const brickOff = (row % 2) * 8;
    for (let col = 0; col < 4; col++) {
      const bx = col * 8 + brickOff;
      if (bx < TS) vline(tb, TW, ox + bx, by + 1, 7, 28, 24, 22);
      // Brick face highlights
      if (bx + 1 < TS) hline(tb, TW, ox + bx + 1, by + 1, Math.min(6, TS - bx - 2), 58, 50, 44);
      if (bx + 1 < TS) vline(tb, TW, ox + bx + 1, by + 2, 4, 55, 46, 40);
    }
  }
}

// 2: SHADOW — darker asphalt
{
  const ox = TS * 2;
  rect(tb, TW, ox, 0, TS, TS, 42, 38, 35);
  // Faint lighter spots to break up the flat color
  for (const [x, y] of [[6,4],[14,10],[3,20],[22,16],[28,28],[9,28],[18,4],[25,22]]) {
    pix(tb, TW, ox + x, y, 55, 50, 46);
    pix(tb, TW, ox + x + 1, y + 1, 55, 50, 46);
  }
}

// 3: PROP — wooden crate
{
  const ox = TS * 3;
  rect(tb, TW, ox + 2, 2, TS - 4, TS - 4, 130, 90, 45);
  // Crate planks
  hline(tb, TW, ox + 2, 10, TS - 4, 100, 68, 30);
  hline(tb, TW, ox + 2, 20, TS - 4, 100, 68, 30);
  vline(tb, TW, ox + 10, 2, TS - 4, 100, 68, 30);
  vline(tb, TW, ox + 20, 2, TS - 4, 100, 68, 30);
  // Highlights
  hline(tb, TW, ox + 2, 2, TS - 4, 170, 125, 65);
  vline(tb, TW, ox + 2, 2, TS - 4, 170, 125, 65);
  // Dark border
  rect(tb, TW, ox + 2, 2, TS - 4, 1, 70, 45, 15);
  rect(tb, TW, ox + 2, TS - 3, TS - 4, 1, 70, 45, 15);
  rect(tb, TW, ox + 2, 2, 1, TS - 4, 70, 45, 15);
  rect(tb, TW, ox + TS - 3, 2, 1, TS - 4, 70, 45, 15);
}

await sharp(tb, { raw: { width: TW, height: TH, channels: 4 } })
  .png()
  .toFile(join(ASSETS, 'tiles.png'));
console.log('✓ tiles.png');

// ── SPRITE SHEET (3 rows × 2 cols × 48px) ────────────────────────────────────
// Rows: BRAWLER, THUG, BOSS
// Cols: idle, walk

const CELL = 48;
const COLS = 2, ROWS = 3;
const SW = CELL * COLS, SH = CELL * ROWS;
const sb = Buffer.alloc(SW * SH * 4, 0); // starts fully transparent

// Helper: draw into a specific cell
function cell(row, col, drawFn) {
  drawFn(sb, SW, col * CELL, row * CELL, CELL);
}

// ─── BRAWLER (row 0) ──────────────────────────────────────────────────────────

function drawBrawler(buf, W, ox, oy, SZ, walking) {
  // Colors
  const SK  = [220, 172, 128];  // skin
  const SKD = [185, 140, 95];   // skin shadow
  const HA  = [45,  28,  8];    // hair
  const JA  = [0,   108, 168];  // jacket teal-blue
  const JAD = [0,   72,  118];  // jacket dark
  const JAL = [40,  148, 200];  // jacket highlight
  const JE  = [52,  82,  158];  // jeans
  const JED = [32,  55,  115];  // jeans dark
  const BO  = [62,  42,  18];   // boots
  const BEL = [110, 78,  28];   // belt

  // Leg offset for walking
  const lLegX = walking ? -3 : 0;
  const rLegX = walking ? +3 : 0;
  const lArmX = walking ? +2 : 0;
  const rArmX = walking ? -2 : 0;

  // Boots
  rect(buf, W, ox + 15 + lLegX, oy + 42, 9, 4, ...BO);
  rect(buf, W, ox + 24 + rLegX, oy + 42, 9, 4, ...BO);
  // Boot highlight
  hline(buf, W, ox + 16 + lLegX, oy + 42, 7, 90, 62, 30);
  hline(buf, W, ox + 25 + rLegX, oy + 42, 7, 90, 62, 30);

  // Legs (jeans)
  rect(buf, W, ox + 16 + lLegX, oy + 31, 8, 12, ...JE);
  rect(buf, W, ox + 25 + rLegX, oy + 31, 8, 12, ...JE);
  // Leg shading (inner edge)
  vline(buf, W, ox + 23 + lLegX, oy + 31, 12, ...JED);
  vline(buf, W, ox + 32 + rLegX, oy + 31, 12, ...JED);
  // Jeans crease highlight
  vline(buf, W, ox + 18 + lLegX, oy + 31, 10, 78, 108, 188);
  vline(buf, W, ox + 27 + rLegX, oy + 31, 10, 78, 108, 188);

  // Belt
  rect(buf, W, ox + 15, oy + 29, 18, 3, ...BEL);
  // Belt buckle
  rect(buf, W, ox + 22, oy + 29, 4, 3, 200, 170, 60);

  // Jacket body
  rect(buf, W, ox + 14, oy + 18, 20, 12, ...JA);
  // Jacket lapels / collar
  rect(buf, W, ox + 20, oy + 18, 8, 6, ...JAL);
  // Zipper / center line
  vline(buf, W, ox + 24, oy + 18, 12, ...JAD);
  // Jacket side shading
  vline(buf, W, ox + 14, oy + 18, 12, ...JAD);
  vline(buf, W, ox + 33, oy + 18, 12, ...JAD);
  // Shoulder seams
  hline(buf, W, ox + 12, oy + 18, 24, ...JAD);

  // Left arm
  rect(buf, W, ox + 10 + lArmX, oy + 18, 5, 12, ...JA);
  rect(buf, W, ox + 10 + lArmX, oy + 30, 5, 5, ...SK);  // hand
  // Right arm
  rect(buf, W, ox + 33 + rArmX, oy + 18, 5, 12, ...JA);
  rect(buf, W, ox + 33 + rArmX, oy + 30, 5, 5, ...SK);  // hand

  // Neck
  rect(buf, W, ox + 21, oy + 15, 6, 3, ...SK);

  // Head
  ellipse(buf, W, ox + 24, oy + 9, 7, 8, ...SK);
  // Head shadow (lower half slightly darker)
  for (let y = oy + 13; y <= oy + 17; y++)
    for (let x = ox + 18; x <= ox + 30; x++) {
      const dx = (x - (ox+24)) / 7, dy = (y - (oy+9)) / 8;
      if (dx*dx + dy*dy <= 1) pix(buf, W, x, y, ...SKD);
    }

  // Hair
  ellipse(buf, W, ox + 24, oy + 4, 7, 5, ...HA);
  // Hair highlights
  hline(buf, W, ox + 20, oy + 2, 5, 70, 45, 18);

  // Eyes
  pix(buf, W, ox + 21, oy + 8, 30, 18, 8);
  pix(buf, W, ox + 27, oy + 8, 30, 18, 8);
  // Eye whites
  pix(buf, W, ox + 21, oy + 7, 240, 230, 220);
  pix(buf, W, ox + 27, oy + 7, 240, 230, 220);
  // Eyebrows
  hline(buf, W, ox + 20, oy + 5, 3, ...HA);
  hline(buf, W, ox + 26, oy + 5, 3, ...HA);
  // Nose
  pix(buf, W, ox + 24, oy + 11, ...SKD);
  // Mouth
  hline(buf, W, ox + 21, oy + 13, 6, 170, 115, 80);
  pix(buf, W, ox + 23, oy + 14, 180, 80, 80);
  pix(buf, W, ox + 24, oy + 14, 180, 80, 80);

  addOutline(buf, W, ox, oy, SZ, 25, 15, 5);
}

cell(0, 0, (buf, W, ox, oy, SZ) => drawBrawler(buf, W, ox, oy, SZ, false));
cell(0, 1, (buf, W, ox, oy, SZ) => drawBrawler(buf, W, ox, oy, SZ, true));

// ─── THUG (row 1) ─────────────────────────────────────────────────────────────

function drawThug(buf, W, ox, oy, SZ, walking) {
  const SK  = [195, 148, 98];
  const SKD = [160, 115, 70];
  const HA  = [22,  18,  12];
  const SH  = [72,  68,  64];   // torn shirt grey
  const SHD = [48,  44,  40];   // shirt dark
  const PAN = [38,  34,  30];   // dark pants
  const PND = [24,  22,  18];
  const BO  = [32,  24,  12];
  const STU = [150, 110, 78];   // stubble

  const lLegX = walking ? -3 : 0;
  const rLegX = walking ? +3 : 0;
  const lArmX = walking ? +2 : 0;
  const rArmX = walking ? -2 : 0;

  // Boots
  rect(buf, W, ox + 15 + lLegX, oy + 42, 8, 4, ...BO);
  rect(buf, W, ox + 25 + rLegX, oy + 42, 8, 4, ...BO);

  // Pants
  rect(buf, W, ox + 16 + lLegX, oy + 30, 8, 12, ...PAN);
  rect(buf, W, ox + 24 + rLegX, oy + 30, 8, 12, ...PAN);
  vline(buf, W, ox + 23 + lLegX, oy + 30, 12, ...PND);
  vline(buf, W, ox + 31 + rLegX, oy + 30, 12, ...PND);

  // Torn shirt body
  rect(buf, W, ox + 14, oy + 18, 20, 13, ...SH);
  // Tear marks (lighter streaks)
  for (const [rx, ry, rh] of [[17,19,4],[26,22,5],[21,25,3],[30,18,3]]) {
    vline(buf, W, ox + rx, oy + ry, rh, 95, 88, 82);
  }
  // Shirt darkening at sides
  vline(buf, W, ox + 14, oy + 18, 13, ...SHD);
  vline(buf, W, ox + 33, oy + 18, 13, ...SHD);

  // Arms (bare - muscular)
  rect(buf, W, ox + 9 + lArmX, oy + 18, 5, 15, ...SK);
  rect(buf, W, ox + 34 + rArmX, oy + 18, 5, 15, ...SK);
  // Muscle line on upper arm
  vline(buf, W, ox + 11 + lArmX, oy + 18, 8, ...SKD);
  vline(buf, W, ox + 36 + rArmX, oy + 18, 8, ...SKD);

  // Neck
  rect(buf, W, ox + 21, oy + 15, 6, 4, ...SK);

  // Head — slightly bigger/rougher
  ellipse(buf, W, ox + 24, oy + 9, 7.5, 8.5, ...SK);
  // Head shadow
  for (let y = oy + 13; y <= oy + 18; y++)
    for (let x = ox + 17; x <= ox + 31; x++) {
      const dx = (x - (ox+24)) / 7.5, dy = (y - (oy+9)) / 8.5;
      if (dx*dx + dy*dy <= 1) pix(buf, W, x, y, ...SKD);
    }

  // Hair (short buzzcut)
  ellipse(buf, W, ox + 24, oy + 3, 7, 4.5, ...HA);

  // Stubble
  for (const [sx, sy] of [[19,14],[21,15],[25,15],[27,14],[23,15],[22,13],[26,13]]) {
    pix(buf, W, ox + sx, oy + sy, ...STU);
  }

  // Eyes — narrower, menacing
  pix(buf, W, ox + 20, oy + 8, 18, 12, 6);
  pix(buf, W, ox + 21, oy + 8, 18, 12, 6);
  pix(buf, W, ox + 27, oy + 8, 18, 12, 6);
  pix(buf, W, ox + 28, oy + 8, 18, 12, 6);
  hline(buf, W, ox + 19, oy + 6, 4, ...HA);  // brow
  hline(buf, W, ox + 26, oy + 6, 4, ...HA);
  // Snarl
  hline(buf, W, ox + 20, oy + 12, 8, 140, 90, 60);
  pix(buf, W, ox + 22, oy + 13, 210, 60, 50);
  pix(buf, W, ox + 25, oy + 13, 210, 60, 50);

  addOutline(buf, W, ox, oy, SZ, 15, 10, 5);
}

cell(1, 0, (buf, W, ox, oy, SZ) => drawThug(buf, W, ox, oy, SZ, false));
cell(1, 1, (buf, W, ox, oy, SZ) => drawThug(buf, W, ox, oy, SZ, true));

// ─── BOSS (row 2) — bigger, red jacket ────────────────────────────────────────

function drawBoss(buf, W, ox, oy, SZ, walking) {
  const SK  = [205, 158, 108];
  const SKD = [165, 118, 72];
  const HA  = [12,  10,  8];
  const JA  = [185, 28,  28];   // red jacket
  const JAD = [128, 14,  14];   // dark red
  const JAL = [220, 55,  55];   // highlight red
  const PAN = [20,  18,  16];   // black pants
  const PND = [12,  10,  8];
  const BO  = [14,  12,  10];   // black boots
  const GOL = [190, 155, 40];   // gold chains/buckle

  const lLegX = walking ? -3 : 0;
  const rLegX = walking ? +3 : 0;
  const lArmX = walking ? +3 : 0;
  const rArmX = walking ? -3 : 0;

  // Boots (larger)
  rect(buf, W, ox + 13 + lLegX, oy + 41, 10, 6, ...BO);
  rect(buf, W, ox + 25 + rLegX, oy + 41, 10, 6, ...BO);
  hline(buf, W, ox + 14 + lLegX, oy + 41, 8, 40, 36, 30);
  hline(buf, W, ox + 26 + rLegX, oy + 41, 8, 40, 36, 30);

  // Pants (wider legs)
  rect(buf, W, ox + 14 + lLegX, oy + 30, 10, 12, ...PAN);
  rect(buf, W, ox + 26 + rLegX, oy + 30, 10, 12, ...PAN);
  vline(buf, W, ox + 23 + lLegX, oy + 30, 12, ...PND);
  vline(buf, W, ox + 35 + rLegX, oy + 30, 12, ...PND);

  // Gold chain (belt)
  rect(buf, W, ox + 14, oy + 29, 20, 2, ...GOL);
  // Buckle
  rect(buf, W, ox + 21, oy + 28, 6, 4, ...GOL);
  pix(buf, W, ox + 24, oy + 29, 255, 220, 80);

  // Red jacket body (wider)
  rect(buf, W, ox + 11, oy + 16, 26, 14, ...JA);
  // Lapels
  rect(buf, W, ox + 18, oy + 16, 12, 7, ...JAL);
  // Open collar - chest visible
  rect(buf, W, ox + 21, oy + 16, 6, 5, ...SK);
  // Gold chain on chest
  for (let ci = 0; ci < 5; ci++)
    pix(buf, W, ox + 22 + ci, oy + 18 + ci % 2, ...GOL);
  // Jacket center line
  vline(buf, W, ox + 24, oy + 16, 14, ...JAD);
  // Side shading
  vline(buf, W, ox + 11, oy + 16, 14, ...JAD);
  vline(buf, W, ox + 36, oy + 16, 14, ...JAD);
  hline(buf, W, ox + 11, oy + 16, 26, ...JAD);  // shoulder line

  // Arms (large)
  rect(buf, W, ox + 6 + lArmX, oy + 16, 6, 16, ...JA);
  rect(buf, W, ox + 6 + lArmX, oy + 32, 6, 6, ...SK);
  rect(buf, W, ox + 36 + rArmX, oy + 16, 6, 16, ...JA);
  rect(buf, W, ox + 36 + rArmX, oy + 32, 6, 6, ...SK);
  // Arm shading
  vline(buf, W, ox + 11 + lArmX, oy + 16, 16, ...JAD);
  vline(buf, W, ox + 41 + rArmX, oy + 16, 16, ...JAD);

  // Neck (thick)
  rect(buf, W, ox + 20, oy + 13, 8, 4, ...SK);

  // Head (slightly larger)
  ellipse(buf, W, ox + 24, oy + 8, 8.5, 9, ...SK);
  // Head shadow
  for (let y = oy + 12; y <= oy + 17; y++)
    for (let x = ox + 16; x <= ox + 32; x++) {
      const dx = (x - (ox+24)) / 8.5, dy = (y - (oy+8)) / 9;
      if (dx*dx + dy*dy <= 1) pix(buf, W, x, y, ...SKD);
    }

  // Hair (slicked back)
  ellipse(buf, W, ox + 24, oy + 2, 8, 5, ...HA);
  hline(buf, W, ox + 18, oy + 1, 12, 28, 22, 14);  // hair highlight

  // Eyes — cold, menacing
  rect(buf, W, ox + 18, oy + 7, 4, 3, 15, 10, 5);
  rect(buf, W, ox + 26, oy + 7, 4, 3, 15, 10, 5);
  // Eye glint
  pix(buf, W, ox + 19, oy + 7, 220, 200, 180);
  pix(buf, W, ox + 27, oy + 7, 220, 200, 180);
  // Brow (thick, low)
  hline(buf, W, ox + 17, oy + 5, 6, ...HA);
  hline(buf, W, ox + 25, oy + 5, 6, ...HA);
  // Scar
  vline(buf, W, ox + 28, oy + 7, 5, 140, 80, 60);
  // Nose (broader)
  rect(buf, W, ox + 22, oy + 10, 4, 2, ...SKD);
  // Sneer
  hline(buf, W, ox + 19, oy + 13, 10, 155, 100, 65);
  pix(buf, W, ox + 21, oy + 14, 200, 60, 50);
  pix(buf, W, ox + 26, oy + 14, 200, 60, 50);

  // Earring (gold stud)
  pix(buf, W, ox + 16, oy + 10, ...GOL);

  addOutline(buf, W, ox, oy, SZ, 20, 8, 5);
}

cell(2, 0, (buf, W, ox, oy, SZ) => drawBoss(buf, W, ox, oy, SZ, false));
cell(2, 1, (buf, W, ox, oy, SZ) => drawBoss(buf, W, ox, oy, SZ, true));

await sharp(sb, { raw: { width: SW, height: SH, channels: 4 } })
  .png()
  .toFile(join(ASSETS, 'entities.png'));
console.log('✓ entities.png');

// ── LEVEL DATA ────────────────────────────────────────────────────────────────

const LW = 60, LH = 12;
const levelTiles = [];
for (let r = 0; r < LH; r++) {
  const row = [];
  for (let c = 0; c < LW; c++) {
    if (r < 5) {
      row.push(-1); // empty — let the city-street bg image show through
    } else if (r === LH - 1) {
      row.push(1); // bottom border wall
    } else if (c === 0 || c === LW - 1) {
      row.push(1); // side border wall
    } else if (r === 5) {
      row.push(2); // awning/shadow strip directly above floor
    } else if (r === 6) {
      // Sidewalk with props
      if (c % 14 === 8) row.push(3); // barrel/crate prop
      else row.push(0);
    } else {
      // Street floor (rows 7-10): mostly GROUND with shadow patches
      if (c % 18 === 4 && r === 7) row.push(3); // prop on street
      else if ((c * 3 + r * 7) % 11 === 0) row.push(2); // shadow patch
      else row.push(0); // asphalt
    }
  }
  levelTiles.push(row);
}

const levelsJson = {
  levels: [{
    id:    'street',
    theme: 'city-street',
    size:  [LW, LH],
    tiles: levelTiles,
  }],
};
await writeFile(join(DATA, 'levels.json'), JSON.stringify(levelsJson, null, 2));
console.log('✓ levels.json');

// ── MANIFEST ──────────────────────────────────────────────────────────────────

const manifest = {
  sprites: [{
    sheet:      join(ASSETS, 'entities.png'),
    relSheet:   'assets/entities.png',
    rows:       ['BRAWLER', 'THUG', 'BOSS'],
    cols:       ['idle', 'walk'],
    cell:       CELL,
    bg:         'transparent',
    textureKey: 'entities-1',
  }],
  tiles: {
    relSheet: 'assets/tiles.png',
    tileSize: TS,
    ids:      ['GROUND', 'WALL', 'SHADOW', 'PROP'],
    passable: [true, false, true, false],
  },
  bg: null,
};
await writeFile(join(ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('✓ manifest.json');
console.log('All assets generated.');
