// iso-city-builder — zone, road, watch it grow.
// Built on the iso-living-world engine contract (2:1 dimetric, painter's-algorithm
// depth sort, bottom-center sprite anchoring) with a buildable/simulated tile layer
// underneath: zones, roads, growth, demand, traffic. See skills/iso-city-builder/SKILL.md.

'use strict';

// ---------- constants ----------
const N = 28;                 // grid size
const TW = 64, TH = 32;       // tile diamond size (2:1)
const CAR_SPEED = 3.2;
const PED_SPEED = 2.2;
const START_MONEY = 5000;
const TICK_MS = 1000;         // economy/growth tick cadence, decoupled from render fps

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(2026);

// ---------- tool table (drives palette UI + placement cost/effect) ----------
const TOOLS = [
  { id: 'select', label: 'Pan', ic: '\u{1F5B1}', cost: 0, kind: 'select' },
  { id: 'road', label: 'Road', ic: '\u{1F6E3}', cost: 10, kind: 'road' },
  { id: 'residential', label: 'Res', ic: '\u{1F3E0}', cost: 5, kind: 'zone', zoneType: 'residential' },
  { id: 'commercial', label: 'Com', ic: '\u{1F3EA}', cost: 5, kind: 'zone', zoneType: 'commercial' },
  { id: 'industrial', label: 'Ind', ic: '\u{1F3ED}', cost: 5, kind: 'zone', zoneType: 'industrial' },
  { id: 'bulldoze', label: 'Clear', ic: '\u{1F528}', cost: 0, kind: 'bulldoze' },
];
let currentTool = 'road';

// ---------- tile grid ----------
// each tile: { zone: 'none'|'residential'|'commercial'|'industrial', road: bool,
//              building: null | {level:number, abandoned:bool}, landValue: number }
const tiles = [];
for (let y = 0; y < N; y++) {
  const row = [];
  for (let x = 0; x < N; x++) row.push({ zone: 'none', road: false, building: null, landValue: 0 });
  tiles.push(row);
}
const key = (x, y) => x + ',' + y;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const tileAt = (x, y) => inBounds(x, y) ? tiles[y][x] : null;

// seed roads: a plus-shaped starter avenue so growth has somewhere to attach to
const MID = N >> 1;
for (let i = 0; i < N; i++) { tiles[MID][i].road = true; tiles[i][MID].road = true; }
// one starter house so the city isn't dead silent at t=0
tiles[MID - 2][MID - 1].zone = 'residential';
tiles[MID - 2][MID - 1].building = { level: 0, abandoned: false };

function roadNeighborMask(x, y) {
  let m = 0;
  if (tileAt(x, y - 1)?.road) m |= 1;   // N
  if (tileAt(x + 1, y)?.road) m |= 2;   // E
  if (tileAt(x, y + 1)?.road) m |= 4;   // S
  if (tileAt(x - 1, y)?.road) m |= 8;   // W
  return m;
}

// growth gate: BFS (depth<=8) through same-zone/empty-zoned tiles until a road is touched
function hasRoadAccess(x, y, zoneType) {
  const seen = new Set([key(x, y)]);
  let frontier = [[x, y]];
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next = [];
    for (const [cx, cy] of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, t = tileAt(nx, ny);
        if (!t || seen.has(key(nx, ny))) continue;
        if (t.road) return true;
        if (t.zone === zoneType || t.zone === 'none') { seen.add(key(nx, ny)); next.push([nx, ny]); }
      }
    }
    frontier = next;
  }
  return false;
}

// ---------- BFS pathfinding over the live road network ----------
function nearestRoadTile(x, y) {
  if (tileAt(x, y)?.road) return [x, y];
  const seen = new Set([key(x, y)]);
  let frontier = [[x, y]];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next = [];
    for (const [cx, cy] of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, t = tileAt(nx, ny);
        if (!t || seen.has(key(nx, ny))) continue;
        if (t.road) return [nx, ny];
        seen.add(key(nx, ny)); next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}

function pathOnRoads(sx, sy, tx, ty) {
  if (!tileAt(tx, ty)?.road) return null;
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
      if (!tileAt(nx, ny)?.road || prev.has(nk)) continue;
      prev.set(nk, [cx, cy]);
      q.push([nx, ny]);
    }
  }
  return null;
}

function randomRoadTile() {
  for (let i = 0; i < 200; i++) {
    const x = (rng() * N) | 0, y = (rng() * N) | 0;
    if (tiles[y][x].road) return [x, y];
  }
  return [MID, MID];
}
function randomBuildingTile() {
  const spots = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (tiles[y][x].building && !tiles[y][x].building.abandoned) spots.push([x, y]);
  return spots.length ? spots[(rng() * spots.length) | 0] : null;
}

// ---------- economy ----------
const econ = { money: START_MONEY, population: 0, jobs: 0, demand: { residential: 20, commercial: 0, industrial: 0 } };

function landValueFor(x, y) {
  // cheap proxy: closer to a road reads as more valuable; deterministic per-tile jitter
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (tileAt(x + dx, y + dy)?.road) return 70 + rng() * 20;
  }
  return 30 + rng() * 20;
}

function simTick() {
  // 1) let zoned-but-empty tiles attempt to spawn a building
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = tiles[y][x];
    if (t.zone === 'none' || t.building) continue;
    if (econ.demand[t.zone] > -10 && hasRoadAccess(x, y, t.zone) && rng() < 0.03) {
      t.building = { level: 0, abandoned: false };
      t.landValue = landValueFor(x, y);
    }
  }
  // 2) grow / abandon / recover existing buildings
  let population = 0, jobs = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = tiles[y][x];
    if (!t.building) continue;
    const demand = econ.demand[t.zone] ?? 0;
    if (!t.landValue) t.landValue = landValueFor(x, y);
    if (t.building.abandoned) {
      const recoverChance = Math.min(0.08, 0.03 + Math.max(0, demand - 30) / 1000);
      if (rng() < recoverChance) t.building.abandoned = false;
    } else {
      const demandBoost = Math.max(0, (demand - 30) / 70) * 0.7;
      const coverage = 20; // no service buildings in this MVP; flat baseline
      const target = t.landValue / 24 + coverage / 28 + Math.min(20, t.building.level * 4) / 60 + demandBoost;
      t.building.level += (Math.min(4, Math.max(0, target)) - t.building.level) * 0.08;
      if (demand < -20) {
        const abandonChance = Math.min(0.02, 0.005 + (-demand - 20) / 2000);
        if (rng() < abandonChance) t.building.abandoned = true;
      }
    }
    if (!t.building.abandoned) {
      const lvl = Math.floor(Math.min(4, Math.max(0, t.building.level)));
      if (t.zone === 'residential') population += (lvl + 1) * 4;
      else jobs += (lvl + 1) * 3;
    }
  }
  econ.population = population; econ.jobs = jobs;
  // 3) demand responds to the balance the player has created
  const resTarget = Math.max(-100, Math.min(100, (jobs - population) * 1.5));
  const comTarget = Math.max(-100, Math.min(100, (population - jobs * 0.6) * 1.2));
  const indTarget = Math.max(-100, Math.min(100, (population - jobs * 0.3) * 0.9));
  econ.demand.residential += (resTarget - econ.demand.residential) * 0.06;
  econ.demand.commercial += (comTarget - econ.demand.commercial) * 0.06;
  econ.demand.industrial += (indTarget - econ.demand.industrial) * 0.06;
  updateHud();
}
setInterval(simTick, TICK_MS);

// ---------- HUD ----------
const hudMoney = document.getElementById('hud-money');
const hudPop = document.getElementById('hud-pop');
const hudJobs = document.getElementById('hud-jobs');
const demandBars = { residential: document.getElementById('d-res'), commercial: document.getElementById('d-com'), industrial: document.getElementById('d-ind') };
function updateHud() {
  hudMoney.textContent = '$' + Math.round(econ.money).toLocaleString();
  hudPop.textContent = econ.population;
  hudJobs.textContent = econ.jobs;
  for (const k in demandBars) {
    const v = Math.max(-100, Math.min(100, econ.demand[k]));
    const el = demandBars[k];
    el.className = v < 0 ? 'neg' : '';
    el.style.width = Math.abs(v) / 100 * 20 + 'px';
  }
}

const toastEl = document.getElementById('toast');
let toastT = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 1200);
}

// ---------- canvas (declared early: palette UI below toggles a class on it) ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ---------- palette UI ----------
const paletteEl = document.getElementById('palette');
for (const t of TOOLS) {
  const btn = document.createElement('button');
  btn.dataset.id = t.id;
  btn.innerHTML = `<span class="ic">${t.ic}</span>${t.label}<span class="cost">${t.cost ? '$' + t.cost : ''}</span>`;
  btn.addEventListener('click', () => selectTool(t.id));
  paletteEl.appendChild(btn);
}
function selectTool(id) {
  currentTool = id;
  for (const btn of paletteEl.children) btn.classList.toggle('active', btn.dataset.id === id);
  canvas.classList.toggle('painting', id !== 'select');
}
selectTool(currentTool);

// ---------- paint action ----------
function toolDef(id) { return TOOLS.find(t => t.id === id); }
function paintTile(x, y) {
  const t = tileAt(x, y);
  if (!t) return;
  const tool = toolDef(currentTool);
  if (tool.kind === 'select') return;
  if (tool.kind === 'bulldoze') {
    t.zone = 'none'; t.road = false; t.building = null;
    return;
  }
  if (tool.cost > econ.money) { toast('Not enough money'); return; }
  if (tool.kind === 'road') {
    if (t.road) return;
    t.road = true; t.zone = 'none'; t.building = null;
    econ.money -= tool.cost; updateHud();
  } else if (tool.kind === 'zone') {
    if (t.road || t.zone === tool.zoneType) return;
    t.zone = tool.zoneType; t.building = null;
    econ.money -= tool.cost; updateHud();
  }
}

// ---------- vehicles & pedestrians ----------
const cars = [];
for (let i = 0; i < 10; i++) {
  const [x, y] = randomRoadTile();
  cars.push({ gx: x, gy: y, path: [], pathI: 0, speed: CAR_SPEED * (0.85 + rng() * 0.3), hue: Math.round(rng() * 300 - 150), facing: 1 });
}
function retargetCar(c) {
  const [tx, ty] = randomRoadTile();
  const path = pathOnRoads(Math.round(c.gx), Math.round(c.gy), tx, ty);
  if (path && path.length > 1) { c.path = path; c.pathI = 1; }
}
function stepAlong(e, dt, speed) {
  let budget = speed * dt;
  while (budget > 0 && e.pathI < e.path.length) {
    const [tx, ty] = e.path[e.pathI];
    const dx = tx - e.gx, dy = ty - e.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) { e.pathI++; continue; }
    const step = Math.min(dist, budget);
    e.gx += (dx / dist) * step; e.gy += (dy / dist) * step;
    budget -= step;
    if (step >= dist - 1e-6) e.pathI++;
    const sdx = dx - dy;
    if (Math.abs(sdx) > 1e-4) e.facing = Math.sign(sdx);
  }
}
function carThink(c, dt) {
  if (c.pathI >= c.path.length) retargetCar(c);
  else stepAlong(c, dt, c.speed);
}

const peds = [];
function spawnPed() {
  const spot = randomBuildingTile();
  if (!spot) return;
  const near = nearestRoadTile(spot[0], spot[1]) || spot;
  peds.push({ gx: near[0], gy: near[1], path: [], pathI: 0, state: 'idle', idleT: 1 + rng() * 3, speed: PED_SPEED, facing: 1, hue: Math.round(rng() * 60 - 30), bob: rng() * Math.PI * 2 });
}
function pedThink(p, dt) {
  if (p.state === 'idle') {
    p.idleT -= dt;
    if (p.idleT <= 0) {
      const [tx, ty] = randomRoadTile();
      const path = pathOnRoads(Math.round(p.gx), Math.round(p.gy), tx, ty);
      if (path && path.length > 1) { p.path = path; p.pathI = 1; p.state = 'walk'; }
      else p.idleT = 1 + rng() * 2;
    }
  } else {
    stepAlong(p, dt, p.speed);
    if (p.pathI >= p.path.length) { p.state = 'idle'; p.idleT = 1.5 + rng() * 4; }
  }
}
// (re)seed pedestrians whenever the population grows enough to support more
setInterval(() => {
  const target = Math.min(14, Math.round(econ.population / 8));
  while (peds.length < target) spawnPed();
}, 2000);

// ---------- camera ----------
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}
addEventListener('resize', resize); resize();

const iso = (gx, gy) => [(gx - gy) * TW / 2, (gx + gy) * TH / 2];

let cam = { x: 0, y: 0, z: 1.1 };
{ const [cx, cy] = iso(MID, MID); cam.x = cx; cam.y = cy - 40; }

function screenToGrid(clientX, clientY) {
  const wx = (clientX - W / 2) / cam.z + cam.x;
  const wy = (clientY - H / 2) / cam.z + cam.y;
  const gx = (wx / (TW / 2) + wy / (TH / 2)) / 2;
  const gy = (wy / (TH / 2) - wx / (TW / 2)) / 2;
  return [Math.round(gx), Math.round(gy)];
}

let dragging = false, painting = false, lastM = null;
canvas.addEventListener('mousedown', e => {
  if (currentTool === 'select' || e.button === 2) { dragging = true; lastM = [e.clientX, e.clientY]; return; }
  painting = true;
  const [gx, gy] = screenToGrid(e.clientX, e.clientY);
  paintTile(gx, gy);
});
addEventListener('mouseup', () => { dragging = false; painting = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (dragging) {
    cam.x -= (e.clientX - lastM[0]) / cam.z;
    cam.y -= (e.clientY - lastM[1]) / cam.z;
    lastM = [e.clientX, e.clientY];
  } else if (painting) {
    const [gx, gy] = screenToGrid(e.clientX, e.clientY);
    paintTile(gx, gy);
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0012);
  cam.z = Math.max(0.4, Math.min(2.5, cam.z * f));
}, { passive: false });
addEventListener('keydown', e => {
  const k = e.key;
  if (k >= '1' && k <= '6') selectTool(TOOLS[+k - 1]?.id || currentTool);
});

// ---------- assets ----------
function loadImg(src) { const im = new Image(); im.src = src; return im; }
const ready = im => im.complete && im.naturalWidth > 0;
const npcWalk = [0, 1, 2, 3].map(i => loadImg('assets/npc/walk_' + i + '.png'));
const PROP_IMG = {};
for (const n of ['house', 'shop', 'tower', 'house2', 'apt', 'cafe', 'car'])
  PROP_IMG[n] = loadImg('assets/props/' + n + '_0.png');
const PROP_W = { house: 68, shop: 76, tower: 64, house2: 60, apt: 84, cafe: 78 };

const RES_TIER = ['house', 'house', 'house2', 'apt', 'tower'];
const COM_TIER = ['shop', 'shop', 'cafe', 'cafe', 'tower'];
const IND_TIER = ['house2', 'house2', 'apt', 'apt', 'tower'];
function spriteFor(t) {
  const lvl = Math.max(0, Math.min(4, Math.floor(t.building.level)));
  if (t.zone === 'residential') return RES_TIER[lvl];
  if (t.zone === 'commercial') return COM_TIER[lvl];
  return IND_TIER[lvl];
}

// ---------- drawing ----------
function diamond(cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy); ctx.lineTo(cx, cy + h / 2); ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}
const ZONE_TINT = { none: null, residential: 'rgba(120,180,110,.28)', commercial: 'rgba(110,150,210,.28)', industrial: 'rgba(210,170,90,.28)' };

function drawTile(x, y) {
  const t = tiles[y][x];
  const [cx, cy] = iso(x, y);
  diamond(cx, cy, TW, TH);
  ctx.fillStyle = (x + y) % 2 ? '#a2c07f' : '#a8c686';
  ctx.fill();
  if (t.road) {
    diamond(cx, cy, TW, TH);
    ctx.fillStyle = '#b5aca4'; ctx.fill();
    const m = roadNeighborMask(x, y);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
    const C = { T: [cx, cy - TH / 2], R: [cx + TW / 2, cy], B: [cx, cy + TH / 2], L: [cx - TW / 2, cy] };
    if (m & 1) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(C.T[0], C.T[1]); ctx.stroke(); }
    if (m & 2) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(C.R[0], C.R[1]); ctx.stroke(); }
    if (m & 4) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(C.B[0], C.B[1]); ctx.stroke(); }
    if (m & 8) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(C.L[0], C.L[1]); ctx.stroke(); }
  } else if (t.zone !== 'none') {
    diamond(cx, cy, TW, TH);
    ctx.fillStyle = ZONE_TINT[t.zone]; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function drawBuilding(x, y, t) {
  const [cx, cy] = iso(x, y);
  const sprite = spriteFor(t);
  const img = PROP_IMG[sprite];
  const abandoned = t.building.abandoned;
  if (img && ready(img)) {
    const w = PROP_W[sprite] * (0.75 + Math.min(4, t.building.level) * 0.08);
    const hh = w * (img.naturalHeight / img.naturalWidth);
    ctx.globalAlpha = abandoned ? 0.5 : 1;
    if (t.zone === 'industrial') ctx.filter = 'grayscale(55%) brightness(0.85)';
    ctx.drawImage(img, cx - w / 2, cy + TH / 2 - hh, w, hh);
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    return;
  }
  // vector fallback before sprites finish loading
  const h = 24 + t.building.level * 14;
  const color = t.zone === 'residential' ? '#c96f4a' : t.zone === 'commercial' ? '#6d8f9c' : '#b8a04a';
  const T = [cx, cy - TH / 2], R = [cx + TW / 2, cy], B = [cx, cy + TH / 2], L = [cx - TW / 2, cy];
  ctx.globalAlpha = abandoned ? 0.5 : 1;
  ctx.beginPath(); ctx.moveTo(L[0], L[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(B[0], B[1] - h); ctx.lineTo(L[0], L[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(color, 0.72); ctx.fill();
  ctx.beginPath(); ctx.moveTo(B[0], B[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(B[0], B[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(color, 0.88); ctx.fill();
  ctx.beginPath(); ctx.moveTo(T[0], T[1] - h); ctx.lineTo(R[0], R[1] - h); ctx.lineTo(B[0], B[1] - h); ctx.lineTo(L[0], L[1] - h);
  ctx.closePath(); ctx.fillStyle = shade(color, 1.08); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawCar(c) {
  const img = PROP_IMG.car;
  if (!ready(img)) return;
  const [cx, cy] = iso(c.gx, c.gy);
  const w = 34, h = w * (img.naturalHeight / img.naturalWidth);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 3, w * 0.42, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy + 4);
  ctx.scale(c.facing >= 0 ? 1 : -1, 1);
  if (c.hue) ctx.filter = `hue-rotate(${c.hue}deg)`;
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
  ctx.filter = 'none';
}

function drawPed(p, now) {
  const [cx, cy] = iso(p.gx, p.gy);
  if (npcWalk.every(ready)) {
    const moving = p.state === 'walk';
    const img = npcWalk[moving ? (Math.floor(now * 9 + p.bob * 2) % 4 + 4) % 4 : 0];
    const h = 40, w = h * (img.naturalWidth / img.naturalHeight);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy + 3);
    ctx.scale(p.facing >= 0 ? 1 : -1, 1);
    if (p.hue) ctx.filter = `hue-rotate(${p.hue}deg)`;
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore(); ctx.filter = 'none';
  }
}

function drawHoverPreview() {
  if (!hoverTile || currentTool === 'select') return;
  const [x, y] = hoverTile;
  if (!inBounds(x, y)) return;
  const [cx, cy] = iso(x, y);
  diamond(cx, cy, TW, TH);
  const tool = toolDef(currentTool);
  ctx.fillStyle = tool.kind === 'bulldoze' ? 'rgba(200,60,60,.35)' : 'rgba(255,210,62,.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
}
let hoverTile = null;
addEventListener('mousemove', e => { hoverTile = screenToGrid(e.clientX, e.clientY); });

// ---------- main loop ----------
let last = performance.now();
function frame(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;

  for (const c of cars) carThink(c, dt);
  for (const p of peds) pedThink(p, dt);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) drawTile(x, y);

  const drawables = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = tiles[y][x];
    if (t.building) drawables.push({ d: x + y, f: () => drawBuilding(x, y, t) });
  }
  for (const c of cars) drawables.push({ d: c.gx + c.gy + 0.01, f: () => drawCar(c) });
  for (const p of peds) drawables.push({ d: p.gx + p.gy + 0.01, f: () => drawPed(p, now) });
  drawables.sort((a, b) => a.d - b.d);
  for (const d of drawables) d.f();

  drawHoverPreview();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateHud();
