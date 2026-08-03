// pixelworld — a tiny living isometric city.
// Layers: ground tiles -> depth-sorted props/entities -> UI bubbles.
// Placeholder art (flat diamonds + extruded boxes); sprites drop in later.

'use strict';

// ---------- constants ----------
const N = 24;                 // grid size
const TW = 64, TH = 32;       // tile diamond size (2:1)
const WALK_SPEED = 2.6;       // tiles / sec (NPC)
const PLAYER_SPEED = 4.2;

// seeded rng so the city is stable across reloads
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(1337);

// ---------- world generation ----------
const ROADS = [4, 5, 11, 12, 18, 19];   // 2-tile-wide boulevards
const tiles = [];      // 'grass' | 'road' | 'water' | 'park'
const props = [];      // {kind:'building'|'tree', x, y, h, color, ...}
const occupied = new Set();
const key = (x, y) => x + ',' + y;

for (let y = 0; y < N; y++) {
  tiles.push([]);
  for (let x = 0; x < N; x++) {
    let t = 'grass';
    if (ROADS.includes(x) || ROADS.includes(y)) t = 'road';
    if (x >= 20 && y <= 3) t = 'water';                       // bay corner
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10 && t === 'grass') t = 'park';
    tiles[y].push(t);
  }
}

const PALETTE = ['#c96f4a', '#d9a066', '#8a9bb8', '#7d9c6d', '#b8788a', '#a3826c', '#6d8f9c', '#c9b04a'];
// hue-rotate range per sprite: houses get the full painted-ladies rainbow,
// brick/landmark types only drift subtly
const HUE_RANGE = { house: 300, house2: 300, apt: 40, cafe: 24, shop: 70, tower: 70 };

function nearRoad(x, y) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N && tiles[ny][nx] === 'road') return true;
    }
  return false;
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const t = tiles[y][x];
    // buildings pack contiguously along street frontage (like the reference);
    // block interiors stay open for trees
    const frontage = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      ([dx, dy]) => tiles[y + dy] && tiles[y + dy][x + dx] === 'road');
    const downtown = x >= 12 && y >= 12;
    if (t === 'road') {
      // street lamps along the outer sidewalks, every 4th tile
      const hR = ROADS.includes(y), vR = ROADS.includes(x);
      if (hR && !vR && !ROADS.includes(y - 1) && x % 4 === 2) props.push({ kind: 'lamp', x, y, edge: 'TR' });
      if (hR && !vR && !ROADS.includes(y + 1) && x % 4 === 0) props.push({ kind: 'lamp', x, y, edge: 'LB' });
      if (vR && !hR && !ROADS.includes(x - 1) && y % 4 === 2) props.push({ kind: 'lamp', x, y, edge: 'TL' });
      if (vR && !hR && !ROADS.includes(x + 1) && y % 4 === 0) props.push({ kind: 'lamp', x, y, edge: 'RB' });
    }
    if (t === 'grass' && frontage && rng() < (downtown ? 0.62 : 0.85)) {
      const r = rng();
      const sprite = downtown
        ? (r < 0.6 ? 'tower' : r < 0.75 ? 'apt' : r < 0.9 ? 'shop' : 'cafe')
        : (r < 0.3 ? 'house' : r < 0.58 ? 'house2' : r < 0.78 ? 'apt' : r < 0.92 ? 'shop' : 'cafe');
      const range = HUE_RANGE[sprite] || 40;
      props.push({
        kind: 'building', x, y, h: 26 + rng() * 40,
        color: PALETTE[(rng() * PALETTE.length) | 0],
        sprite,
        scale: sprite === 'tower' ? 0.85 + rng() * 0.3 : 0.95 + rng() * 0.2,
        hue: Math.round(rng() * range - range / 2),
      });
      occupied.add(key(x, y));
    } else if (t === 'park' && rng() < 0.35) {
      props.push({ kind: 'tree', x, y, h: 18 + rng() * 14 });
      occupied.add(key(x, y));
    } else if (t === 'grass' && rng() < 0.1) {
      props.push({ kind: 'tree', x, y, h: 16 + rng() * 12 });
      occupied.add(key(x, y));
    }
  }
}

// singleton landmarks: clear whatever generated there and pin the landmark
function placeLandmark(x, y, sprite, scale) {
  const i = props.findIndex(p => p.x === x && p.y === y && p.kind !== 'lamp');
  if (i >= 0) props.splice(i, 1);
  props.push({ kind: 'building', x, y, h: 60, sprite, scale, hue: 0, color: PALETTE[0] });
  occupied.add(key(x, y));
}
placeLandmark(13, 13, 'pyramid', 1.3);
placeLandmark(8, 8, 'clock', 1.0);

function walkable(x, y) {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const t = tiles[y][x];
  if (t === 'water') return false;
  if (occupied.has(key(x, y))) return false;
  return true;
}

// BFS pathfinding over walkable tiles (uniform cost, grid is tiny)
function findPath(sx, sy, tx, ty) {
  if (!walkable(tx, ty)) return null;
  const prev = new Map();
  const q = [[sx, sy]];
  prev.set(key(sx, sy), null);
  while (q.length) {
    const [cx, cy] = q.shift();
    if (cx === tx && cy === ty) {
      const out = [];
      let cur = [tx, ty];
      while (cur) { out.push(cur); cur = prev.get(key(cur[0], cur[1])); }
      return out.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, nk = key(nx, ny);
      if (!walkable(nx, ny) || prev.has(nk)) continue;
      prev.set(nk, [cx, cy]);
      q.push([nx, ny]);
    }
  }
  return null;
}

function randomRoadCell() {
  for (let i = 0; i < 200; i++) {
    const x = (rng() * N) | 0, y = (rng() * N) | 0;
    if (tiles[y][x] === 'road' && walkable(x, y)) return [x, y];
  }
  return [11, 11];
}

// ---------- entities ----------
const EMOJI = ['\u{1F4AC}', '\u{1F4A1}', '\u{1F4B0}', '\u{1F331}', '\u{1F6D2}', '\u{1F4CD}', '☕', '\u{1F3B5}'];
const SKINS = ['#e8b88a', '#c68d5e', '#8a5a3b', '#f0c9a0'];
const SHIRTS = ['#d94f4f', '#4f7dd9', '#4fa05a', '#d9a04f', '#8a4fd9', '#333a44', '#e878a0'];

function makePerson(x, y, isPlayer) {
  return {
    kind: 'person', isPlayer: !!isPlayer,
    px: x, py: y,               // float grid position
    path: [], pathI: 0,
    state: 'idle', idleT: 1 + rng() * 3,
    bubble: null, bubbleT: 0,
    skin: SKINS[(rng() * SKINS.length) | 0],
    shirt: isPlayer ? '#ffd23e' : SHIRTS[(rng() * SHIRTS.length) | 0],
    speed: isPlayer ? PLAYER_SPEED : WALK_SPEED,
    bob: rng() * Math.PI * 2,
    facing: 1, moving: false,
    hue: Math.round(rng() * 60 - 30),
  };
}

// generated sprites (meshroom)
function loadImg(src) { const im = new Image(); im.src = src; return im; }
const ready = im => im.complete && im.naturalWidth > 0;
const playerWalk = [0, 1, 2, 3].map(i => loadImg('assets/player/walk_' + i + '.png'));
const npcWalk = [0, 1, 2, 3].map(i => loadImg('assets/npc/walk_' + i + '.png'));
const PROP_IMG = {};
for (const n of ['house', 'shop', 'tower', 'tree', 'house2', 'apt', 'cafe', 'pyramid', 'clock', 'car'])
  PROP_IMG[n] = loadImg('assets/props/' + n + '_0.png');
// on-screen widths per sprite (height follows aspect ratio)
const PROP_W = { house: 68, shop: 76, tower: 64, tree: 46, house2: 60, apt: 84, cafe: 78, pyramid: 66, clock: 54 };

// cars shuttle along the boulevards
const cars = [];
for (let i = 0; i < 6; i++) {
  cars.push({
    axis: rng() < 0.5 ? 'h' : 'v',
    lane: ROADS[(rng() * ROADS.length) | 0],
    pos: 1 + rng() * (N - 3),
    dir: rng() < 0.5 ? 1 : -1,
    speed: 2.8 + rng() * 1.6,
    hue: Math.round(rng() * 300 - 150),
  });
}
function carThink(c, dt) {
  c.pos += c.dir * c.speed * dt;
  if (c.pos < 0.6) { c.pos = 0.6; c.dir = 1; }
  if (c.pos > N - 1.6) { c.pos = N - 1.6; c.dir = -1; }
}
function carGrid(c) { return c.axis === 'h' ? [c.pos, c.lane] : [c.lane, c.pos]; }
function drawCar(c) {
  const img = PROP_IMG.car;
  if (!ready(img)) return;
  const [gx, gy] = carGrid(c);
  const [cx, cy] = iso(gx, gy);
  const w = 38, h = w * (img.naturalHeight / img.naturalWidth);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.42, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy + 4);
  ctx.scale(c.axis === 'h' ? c.dir : -c.dir, 1);   // sprite faces screen-right
  if (c.hue) ctx.filter = `hue-rotate(${c.hue}deg)`;
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
  ctx.filter = 'none';
}

const player = makePerson(11, 11, true);
const npcs = [];
for (let i = 0; i < 14; i++) {
  const [x, y] = randomRoadCell();
  npcs.push(makePerson(x, y));
}
const people = [player, ...npcs];

function npcThink(p, dt) {
  if (p.state === 'idle') {
    p.idleT -= dt;
    if (p.bubble === null && rng() < dt * 0.15) { p.bubble = EMOJI[(rng() * EMOJI.length) | 0]; p.bubbleT = 2.5; }
    if (p.idleT <= 0) {
      const [tx, ty] = randomRoadCell();
      const path = findPath(Math.round(p.px), Math.round(p.py), tx, ty);
      if (path && path.length > 1) { p.path = path; p.pathI = 1; p.state = 'walk'; }
      else p.idleT = 1 + rng() * 2;
    }
  } else if (p.state === 'walk') {
    stepAlongPath(p, dt);
    if (p.pathI >= p.path.length) { p.state = 'idle'; p.idleT = 1.5 + rng() * 4; }
  }
}

function stepAlongPath(p, dt) {
  let budget = p.speed * dt;
  while (budget > 0 && p.pathI < p.path.length) {
    const [tx, ty] = p.path[p.pathI];
    const dx = tx - p.px, dy = ty - p.py;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) { p.pathI++; continue; }
    const step = Math.min(dist, budget);
    p.px += (dx / dist) * step;
    p.py += (dy / dist) * step;
    budget -= step;
    if (step >= dist - 1e-6) p.pathI++;
  }
  return budget / p.speed;   // unspent time, so callers can chain moves seamlessly
}

// player: held keys queue grid steps
const held = new Set();
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { held.add(k); follow = true; e.preventDefault(); }
  if (k === 'f') follow = true;
  if (k === '=' || k === '+') cam.z = Math.min(2.5, cam.z * 1.15);
  if (k === '-') cam.z = Math.max(0.45, cam.z / 1.15);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));

function playerThink(p, dt) {
  // chain tile steps inside one frame so held-key movement never stalls
  // between tiles (that stall was the visible jitter)
  for (let guard = 0; guard < 6 && dt > 1e-5; guard++) {
    if (p.path.length && p.pathI < p.path.length) {
      dt = stepAlongPath(p, dt);
      continue;
    }
    // screen-relative: up = north-west-ish in grid terms
    let dx = 0, dy = 0;
    if (held.has('w') || held.has('arrowup')) { dx -= 1; dy -= 1; }
    if (held.has('s') || held.has('arrowdown')) { dx += 1; dy += 1; }
    if (held.has('a') || held.has('arrowleft')) { dx -= 1; dy += 1; }
    if (held.has('d') || held.has('arrowright')) { dx += 1; dy -= 1; }
    if (dx === 0 && dy === 0) return;
    const cx = Math.round(p.px), cy = Math.round(p.py);
    // try the diagonal intent, then fall back to each axis
    const tries = [[cx + Math.sign(dx), cy + Math.sign(dy)], [cx + Math.sign(dx), cy], [cx, cy + Math.sign(dy)]];
    let queued = false;
    for (const [tx, ty] of tries) {
      if ((tx !== cx || ty !== cy) && walkable(tx, ty)) {
        p.path = [[cx, cy], [tx, ty]]; p.pathI = 1;
        queued = true;
        break;
      }
    }
    if (!queued) return;   // boxed in — nowhere to go this frame
  }
}

// ---------- camera / canvas ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}
addEventListener('resize', resize); resize();

let cam = { x: 0, y: 0, z: 1.6 };   // world-pixel center + zoom
let follow = true;

const iso = (gx, gy) => [(gx - gy) * TW / 2, (gx + gy) * TH / 2];

let dragging = false, lastM = null;
canvas.addEventListener('mousedown', e => { dragging = true; lastM = [e.clientX, e.clientY]; });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => {
  if (!dragging) return;
  follow = false;
  cam.x -= (e.clientX - lastM[0]) / cam.z;
  cam.y -= (e.clientY - lastM[1]) / cam.z;
  lastM = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0012);
  cam.z = Math.max(0.45, Math.min(2.5, cam.z * f));
}, { passive: false });

// ---------- drawing ----------
function diamond(cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

const TILE_FILL = { grass: '#a8c686', park: '#8fbc74', road: '#b5aca4', water: '#7ab3d4' };

// dirt cliff under the island's two visible edges
function drawBase() {
  const D = 72;
  const E = [N * TW / 2, (N - 1) * TH / 2];        // east corner
  const S = [0, (2 * N - 1) * TH / 2];             // south corner
  const Wc = [-N * TW / 2, (N - 1) * TH / 2];      // west corner
  ctx.beginPath();
  ctx.moveTo(S[0], S[1]); ctx.lineTo(E[0], E[1]); ctx.lineTo(E[0], E[1] + D); ctx.lineTo(S[0], S[1] + D);
  ctx.closePath(); ctx.fillStyle = '#9b7350'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(Wc[0], Wc[1]); ctx.lineTo(S[0], S[1]); ctx.lineTo(S[0], S[1] + D); ctx.lineTo(Wc[0], Wc[1] + D);
  ctx.closePath(); ctx.fillStyle = '#7d5a3e'; ctx.fill();
  // a few darker speckles so it reads as earth
  ctx.fillStyle = 'rgba(60,40,25,.25)';
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = Wc[0] + (E[0] - Wc[0]) * t;
    const y = (t < 0.5 ? Wc[1] + (S[1] - Wc[1]) * (t * 2) : S[1] + (E[1] - S[1]) * ((t - 0.5) * 2));
    ctx.fillRect(x + ((i * 37) % 23) - 11, y + 14 + ((i * 53) % (D - 26)), 5, 3);
  }
}

function drawTile(x, y) {
  const t = tiles[y][x];
  const [cx, cy] = iso(x, y);
  diamond(cx, cy, TW, TH);
  ctx.fillStyle = TILE_FILL[t];
  if (t === 'grass' && (x + y) % 2) ctx.fillStyle = '#a2c07f';
  if (t === 'park' && (x + y) % 2) ctx.fillStyle = '#88b56c';
  if (t === 'water' && (x + y) % 2) ctx.fillStyle = '#6fabd0';
  ctx.fill();
  if (t === 'road') {
    const hRoad = ROADS.includes(y), vRoad = ROADS.includes(x);
    // sidewalk strips along the two edges parallel to the road direction
    const T = [cx, cy - TH / 2], R = [cx + TW / 2, cy], B = [cx, cy + TH / 2], L = [cx - TW / 2, cy];
    const inset = (p) => [p[0] + (cx - p[0]) * 0.22, p[1] + (cy - p[1]) * 0.22];
    const strip = (p1, p2) => {
      const q1 = inset(p1), q2 = inset(p2);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q1[0], q1[1]);
      ctx.closePath(); ctx.fillStyle = '#cfc7bc'; ctx.fill();
    };
    // sidewalks only on the outer edge of each 2-lane boulevard
    if (hRoad && !vRoad) {
      if (!ROADS.includes(y - 1)) strip(T, R);
      if (!ROADS.includes(y + 1)) strip(L, B);
    }
    if (vRoad && !hRoad) {
      if (!ROADS.includes(x - 1)) strip(T, L);
      if (!ROADS.includes(x + 1)) strip(R, B);
    }
    // crosswalk stripes where a lane meets a perpendicular boulevard
    const nearCross = hRoad && !vRoad
      ? (ROADS.includes(x - 1) || ROADS.includes(x + 1))
      : vRoad && !hRoad ? (ROADS.includes(y - 1) || ROADS.includes(y + 1)) : false;
    if (nearCross) {
      const u = hRoad ? [TW / 4, TH / 4] : [-TW / 4, TH / 4];   // along the lane
      const v = hRoad ? [-TW / 4, TH / 4] : [TW / 4, TH / 4];   // across the lane
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 3;
      for (let i = -1.5; i <= 1.5; i++) {
        const px = cx + u[0] * i * 0.4, py = cy + u[1] * i * 0.4;
        ctx.beginPath();
        ctx.moveTo(px - v[0] * 0.55, py - v[1] * 0.55);
        ctx.lineTo(px + v[0] * 0.55, py + v[1] * 0.55);
        ctx.stroke();
      }
    }
    if (!(hRoad && vRoad) && !nearCross) {
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (hRoad) { ctx.moveTo(cx - TW / 5, cy - TH / 10); ctx.lineTo(cx + TW / 5, cy + TH / 10); }
      else { ctx.moveTo(cx + TW / 5, cy - TH / 10); ctx.lineTo(cx - TW / 5, cy + TH / 10); }
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,.05)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

// screen-space bounding box of a building sprite (or its vector fallback)
function buildingRect(b) {
  const [cx, cy] = iso(b.x, b.y);
  const img = PROP_IMG[b.sprite];
  const w = (img && ready(img)) ? PROP_W[b.sprite] * b.scale : TW;
  const hh = (img && ready(img)) ? w * (img.naturalHeight / img.naturalWidth) : b.h + TH;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy + TH / 2 - hh, y1: cy + TH / 2 };
}

// fade buildings that stand between the camera and the player
function updateOcclusion(dt) {
  const [plx, ply] = iso(player.px, player.py);
  const headY = ply - 20;
  for (const b of props) {
    if (b.kind !== 'building') continue;
    let target = 1;
    if (b.x + b.y > player.px + player.py + 0.05) {   // drawn in front of player
      const r = buildingRect(b);
      if (plx > r.x0 - 8 && plx < r.x1 + 8 && headY > r.y0 - 6 && ply < r.y1 + 26) target = 0.3;
    }
    b.alpha = (b.alpha === undefined) ? 1 : b.alpha + (target - b.alpha) * Math.min(1, dt * 10);
  }
}

function drawBuilding(b) {
  const [cx, cy] = iso(b.x, b.y);
  ctx.globalAlpha = b.alpha === undefined ? 1 : b.alpha;
  const img = PROP_IMG[b.sprite];
  if (img && ready(img)) {
    const w = PROP_W[b.sprite] * b.scale;
    const hh = w * (img.naturalHeight / img.naturalWidth);
    if (b.hue) ctx.filter = `hue-rotate(${b.hue}deg)`;
    ctx.drawImage(img, cx - w / 2, cy + TH / 2 - hh, w, hh);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    return;
  }
  const h = b.h;
  const T = [cx, cy - TH / 2], R = [cx + TW / 2, cy], B = [cx, cy + TH / 2], L = [cx - TW / 2, cy];
  // left (SW) face
  ctx.beginPath();
  ctx.moveTo(L[0], L[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(B[0], B[1] - h); ctx.lineTo(L[0], L[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(b.color, 0.72); ctx.fill();
  // right (SE) face
  ctx.beginPath();
  ctx.moveTo(B[0], B[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(B[0], B[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(b.color, 0.88); ctx.fill();
  // roof
  ctx.beginPath();
  ctx.moveTo(T[0], T[1] - h); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(B[0], B[1] - h); ctx.lineTo(L[0], L[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(b.color, 1.08); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.8; ctx.stroke();
  // windows on both visible faces
  ctx.fillStyle = 'rgba(40,50,70,.55)';
  const rows = Math.floor((h - 10) / 13);
  for (let r = 0; r < rows; r++) {
    const wy = -8 - r * 13;
    for (const t of [0.3, 0.62]) {
      // left face runs L -> B
      let wx = L[0] + (B[0] - L[0]) * t, wyb = L[1] + (B[1] - L[1]) * t;
      ctx.fillRect(wx - 2, wyb + wy, 4.5, 6);
      // right face runs B -> R
      wx = B[0] + (R[0] - B[0]) * t; wyb = B[1] + (R[1] - B[1]) * t;
      ctx.fillRect(wx - 2, wyb + wy, 4.5, 6);
    }
  }
  ctx.globalAlpha = 1;
}

function drawLamp(l) {
  const [cx, cy] = iso(l.x, l.y);
  const C = { T: [cx, cy - TH / 2], R: [cx + TW / 2, cy], B: [cx, cy + TH / 2], L: [cx - TW / 2, cy] };
  const pair = { TR: [C.T, C.R], LB: [C.L, C.B], TL: [C.T, C.L], RB: [C.R, C.B] }[l.edge];
  const mx = (pair[0][0] + pair[1][0]) / 2, my = (pair[0][1] + pair[1][1]) / 2;
  // pull slightly inward onto the sidewalk strip
  const px = mx + (cx - mx) * 0.12, py = my + (cy - my) * 0.12;
  ctx.strokeStyle = '#3c3c44'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 17); ctx.stroke();
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath(); ctx.arc(px, py - 18.5, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,217,138,.25)';
  ctx.beginPath(); ctx.arc(px, py - 18.5, 5, 0, Math.PI * 2); ctx.fill();
}

function drawTree(t) {
  const [cx, cy] = iso(t.x, t.y);
  const img = PROP_IMG.tree;
  if (ready(img)) {
    const w = PROP_W.tree * (t.h / 26);
    const hh = w * (img.naturalHeight / img.naturalWidth);
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.3, w * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(img, cx - w / 2, cy + 6 - hh, w, hh);
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 2, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - t.h * 0.5); ctx.stroke();
  ctx.fillStyle = '#4e8a4e';
  ctx.beginPath(); ctx.arc(cx, cy - t.h * 0.55 - 7, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5da05a';
  ctx.beginPath(); ctx.arc(cx - 4, cy - t.h * 0.55 - 4, 7, 0, Math.PI * 2); ctx.fill();
}

function drawPerson(p, now) {
  const [cx, cy] = iso(p.px, p.py);
  const frames = p.isPlayer ? playerWalk : npcWalk;
  if (frames.every(ready)) {
    const img = frames[p.moving ? (Math.floor(now * 9 + p.bob * 2) % 4 + 4) % 4 : 0];
    const h = 46, w = h * (img.naturalWidth / img.naturalHeight);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy + 3);
    ctx.scale(p.facing, 1);
    if (!p.isPlayer && p.hue) ctx.filter = `hue-rotate(${p.hue}deg)`;
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    ctx.filter = 'none';
    return;
  }
  const bob = p.state === 'walk' ? Math.sin(now * 14 + p.bob) * 1.6 : 0;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.15)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  // body
  ctx.fillStyle = p.shirt;
  ctx.beginPath();
  ctx.roundRect(cx - 4.5, cy - 14 + bob, 9, 12, 3.5);
  ctx.fill();
  // head
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(cx, cy - 18 + bob, 5, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = '#3a2c22';
  ctx.beginPath(); ctx.arc(cx, cy - 19.5 + bob, 4.6, Math.PI, 0); ctx.fill();
  if (p.isPlayer) {
    ctx.strokeStyle = 'rgba(255,210,62,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8.5, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawBubble(p) {
  if (!p.bubble) return;
  const [cx, cy] = iso(p.px, p.py);
  const y = cy - 58;
  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - 13, y - 13, 26, 24, 7);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 4, y + 11); ctx.lineTo(cx, y + 17); ctx.lineTo(cx + 4, y + 11);
  ctx.closePath(); ctx.fill();
  ctx.font = '14px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.bubble, cx, y);
}

// ---------- main loop ----------
let last = performance.now();
{
  const [px, py] = iso(player.px, player.py);
  cam.x = px; cam.y = py;
}

function frame(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;

  for (const c of cars) carThink(c, dt);
  for (const p of people) { p._ox = p.px; p._oy = p.py; }
  playerThink(player, dt);
  for (const p of npcs) npcThink(p, dt);
  for (const p of people) {
    const dgx = p.px - p._ox, dgy = p.py - p._oy;
    p.moving = Math.hypot(dgx, dgy) > 1e-4;
    const sdx = dgx - dgy;              // screen-space horizontal component
    if (Math.abs(sdx) > 1e-4) p.facing = Math.sign(sdx);
  }
  for (const p of people) {
    if (p.bubble) { p.bubbleT -= dt; if (p.bubbleT <= 0) p.bubble = null; }
  }

  updateOcclusion(dt);

  if (follow) {
    const [px, py] = iso(player.px, player.py);
    cam.x += (px - cam.x) * Math.min(1, dt * 5);
    cam.y += (py - 10 - cam.y) * Math.min(1, dt * 5);
  }

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  // ground
  drawBase();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      drawTile(x, y);

  // depth-sorted props + people (painter's: by grid x+y)
  const drawables = [];
  for (const pr of props) {
    const f = pr.kind === 'building' ? () => drawBuilding(pr)
      : pr.kind === 'lamp' ? () => drawLamp(pr)
      : () => drawTree(pr);
    drawables.push({ d: pr.x + pr.y, f });
  }
  for (const c of cars) {
    const [gx, gy] = carGrid(c);
    drawables.push({ d: gx + gy + 0.015, f: () => drawCar(c) });
  }
  for (const p of people) drawables.push({ d: p.px + p.py + 0.01, f: () => drawPerson(p, now) });
  drawables.sort((a, b) => a.d - b.d);
  for (const d of drawables) d.f();

  // UI layer
  for (const p of people) drawBubble(p);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
