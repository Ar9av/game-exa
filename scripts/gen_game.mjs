#!/usr/bin/env node
/**
 * Asset generator — bypasses LLM stages, uses hardcoded GDDs and levels,
 * then calls GPT Image 2 (via fal.ai) for sprites, tiles, and background.
 *
 * Tile generation: generateTilesetGPT() makes one GPT Image 2 call per
 * non-SKY tile type (512×512 → 32×32), using each palette entry's `desc`
 * field as the prompt. Solid-color fallback per tile if a call fails.
 * SKY tiles are filled magenta; Game.js hides them via setAlpha(0).
 *
 * Usage: node --env-file=~/.all-skills/.env scripts/gen_game.mjs <game-name>
 * Games: dungeon-knight | dragon-brawl | island-quest | sewer-bot
 */
import { resolve, join, dirname } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { generateSprites, generateTilesetGPT } from '../src/lib/sprites.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── helpers ─────────────────────────────────────────────────────────────────

function grid(H, W, fill) {
  return Array.from({ length: H }, () => Array(W).fill(fill));
}
function hLine(g, r, c1, c2, v) {
  for (let c = c1; c <= c2; c++) if (r >= 0 && r < g.length && c >= 0 && c < g[0].length) g[r][c] = v;
}
function vLine(g, c, r1, r2, v) {
  for (let r = r1; r <= r2; r++) if (r >= 0 && r < g.length && c >= 0 && c < g[0].length) g[r][c] = v;
}
function fill(g, r1, c1, r2, c2, v) {
  for (let r = r1; r <= r2; r++) hLine(g, r, c1, c2, v);
}

// ─── dungeon-knight (action-platformer) ──────────────────────────────────────

const DUNGEON_KNIGHT_GDD = {
  title: 'Dungeon Knight',
  genre: 'action-platformer',
  tagline: 'A cursed knight scales a spike-filled dungeon collecting orbs to unlock the exit portal',
  loop: 'Platform upward through a tall dungeon, jumping over spikes and slashing skeletons. Collect 5 glowing orbs scattered across the levels to unlock the exit.',
  winCondition: 'window.__gameState.orbsCollected >= 5',
  loseCondition: 'window.__gameState.playerHp <= 0',
  controls: {
    movement: 'platformer',
    actions: [
      { key: 'SPACE', name: 'Jump', description: 'Jump with coyote-time grace' },
      { key: 'Z', name: 'Slash', description: 'Horizontal sword slash in front of player' },
    ],
  },
  entities: [
    { id: 'KNIGHT', kind: 'player', color: 'steel blue', desc: 'Armored knight in blue plate mail wielding a glowing sword', states: ['idle', 'walk', 'jump', 'cast', 'block'], speed: 160, hp: 5 },
    { id: 'SKELETON', kind: 'enemy', color: 'bone white', desc: 'Rattling skeleton warrior with cracked bones and a rusty sword', states: ['idle', 'walk'], speed: 60, hp: 2 },
    { id: 'SLIME', kind: 'enemy', color: 'acid green', desc: 'Bouncy green slime blob with beady red eyes and a wide grin', states: ['idle', 'walk'], speed: 40, hp: 1 },
    { id: 'GHOST', kind: 'enemy', color: 'ethereal cyan', desc: 'Translucent blue ghost with hollow glowing eyes floating eerily', states: ['idle', 'walk'], speed: 80, hp: 1 },
    { id: 'ORB', kind: 'pickup', color: 'golden yellow', desc: 'Glowing golden orb pulsing with magical energy', states: ['idle'], speed: 0, hp: 0 },
    { id: 'DARK_KNIGHT', kind: 'boss', color: 'dark crimson black', desc: 'Massive dark knight in obsidian plate with glowing red eyes wielding a giant war hammer', states: ['idle', 'walk', 'cast'], speed: 50, hp: 10 },
  ],
  tilesetPalette: [
    { id: 'SKY',    color: '#FF00FF', passable: true  },
    { id: 'STONE',  color: '#607070', passable: false, desc: 'gray cobblestone dungeon floor tile, beveled stone blocks with deep mortar cracks, dark damp medieval dungeon atmosphere, worn stone surface' },
    { id: 'BRICK',  color: '#8B5A3C', passable: false, desc: 'dark reddish-brown dungeon wall brick tile, rectangular masonry bricks with thick mortar gaps, rough-hewn castle stone wall texture' },
    { id: 'SPIKE',  color: '#C04020', passable: true,  desc: 'deadly metal spike hazard tile, three sharp metallic spikes pointing upward from a dark iron base plate, danger trap marker, blood-stained tips' },
    { id: 'LADDER', color: '#A07840', passable: true,  desc: 'old wooden ladder tile, brown wooden rungs on vertical side rails, dungeon prop, worn and splintered wood' },
  ],
  levelHints: { size: [22, 32], count: 1, themes: ['cursed dungeon'] },
};

function makeDungeonKnightLevels() {
  const W = 22, H = 32;
  const [SKY, STONE, BRICK, SPIKE] = [0, 1, 2, 3];
  const g = grid(H, W, SKY);

  // Outer shell
  fill(g, 0, 0, 0, W - 1, STONE);       // ceiling
  fill(g, H - 2, 0, H - 1, W - 1, STONE); // floor (2 thick)
  vLine(g, 0, 0, H - 1, STONE);         // left wall
  vLine(g, W - 1, 0, H - 1, STONE);     // right wall

  // Platforms (ascending bottom → top)
  hLine(g, 25, 2, 7, STONE);  hLine(g, 25, 13, 18, BRICK); // tier 1
  hLine(g, 21, 3, 9, STONE);  hLine(g, 21, 14, 19, BRICK); // tier 2
  hLine(g, 17, 1, 7, BRICK);  hLine(g, 17, 12, 18, STONE); // tier 3
  hLine(g, 13, 4, 11, STONE); hLine(g, 13, 14, 20, BRICK); // tier 4
  hLine(g, 9, 1, 8, BRICK);   hLine(g, 9, 12, 19, STONE);  // tier 5
  hLine(g, 5, 2, 19, STONE);                                // tier 6 wide
  hLine(g, 2, 6, 15, BRICK);                                // exit platform

  // Spikes
  hLine(g, 29, 9, 10, SPIKE);
  hLine(g, 29, 13, 14, SPIKE);

  return [{
    id: '1-1',
    theme: 'cursed dungeon',
    size: [W, H],
    tiles: g,
    spawns: [
      { entity: 'KNIGHT',     x: 5,  y: 29 },
      { entity: 'SKELETON',   x: 5,  y: 24 },
      { entity: 'SLIME',      x: 15, y: 24 },
      { entity: 'GHOST',      x: 4,  y: 16 },
      { entity: 'SKELETON',   x: 15, y: 12 },
      { entity: 'SLIME',      x: 8,  y: 8  },
      { entity: 'ORB',        x: 7,  y: 24 },
      { entity: 'ORB',        x: 16, y: 20 },
      { entity: 'ORB',        x: 7,  y: 12 },
      { entity: 'ORB',        x: 15, y: 8  },
      { entity: 'ORB',        x: 10, y: 4  },
      { entity: 'DARK_KNIGHT', x: 11, y: 1 },
    ],
    goal: { kind: 'tile', x: 10, y: 1 },
  }];
}

// ─── dragon-brawl (beat-em-up) ───────────────────────────────────────────────

const DRAGON_BRAWL_GDD = {
  title: 'Dragon Brawl',
  genre: 'beat-em-up',
  tagline: 'A street fighter battles through waves of gang members in gritty urban alleys',
  loop: 'Walk the streets and pummel waves of thugs. Defeat 12 enemies to reach the boss and clear the stage.',
  winCondition: 'window.__gameState.enemiesDefeated >= 12',
  loseCondition: 'window.__gameState.playerHp <= 0',
  controls: {
    movement: '4-direction',
    actions: [
      { key: 'SPACE', name: 'Punch/Kick', description: 'Attack enemies in front of you' },
      { key: 'Z', name: 'Jump', description: 'Jump over attacks' },
    ],
  },
  entities: [
    { id: 'FIGHTER', kind: 'player', color: 'red leather jacket', desc: 'Muscular street fighter in a red jacket with spiked gloves and a fierce expression', states: ['idle', 'walk', 'cast', 'block'], speed: 90, hp: 8 },
    { id: 'THUG', kind: 'enemy', color: 'dark grey hoodie', desc: 'Stocky street thug in a dark hoodie with chain weapon and menacing stance', states: ['idle', 'walk'], speed: 55, hp: 2 },
    { id: 'ENFORCER', kind: 'enemy', color: 'blue leather', desc: 'Bulky gang enforcer in blue leather jacket with brass knuckles', states: ['idle', 'walk'], speed: 45, hp: 4 },
    { id: 'BIKER', kind: 'enemy', color: 'black studded leather', desc: 'Biker gang member in black studded leather with metal bat weapon', states: ['idle', 'walk'], speed: 70, hp: 2 },
    { id: 'BOSS_DRAGON', kind: 'boss', color: 'gold armored dark', desc: 'Massive dragon-tattooed crime boss in gold-accented dark armor with glowing fists', states: ['idle', 'walk', 'cast'], speed: 40, hp: 15 },
  ],
  tilesetPalette: [
    { id: 'GROUND', color: '#4A3728', passable: true,  desc: 'dark brown cracked asphalt urban street ground tile, scuffed city pavement with grime stains and cigarette marks, 1980s city nighttime brawler aesthetic' },
    { id: 'WALL',   color: '#252525', passable: false, desc: 'dark charcoal-gray concrete urban wall tile, rough city building wall with graffiti tags and weathered paint, beat-em-up urban setting' },
    { id: 'PROP',   color: '#604830', passable: false, desc: 'old wooden crate or barrel prop tile, dark aged wood planks with metal corner brackets and rusty nails, city alley prop' },
  ],
  levelHints: { size: [40, 12], count: 1, themes: ['dark urban street'] },
};

function makeDragonBrawlLevels() {
  const W = 40, H = 12;
  const [GROUND, WALL, PROP] = [0, 1, 2];
  const g = grid(H, W, GROUND);

  // Border
  fill(g, 0, 0, 0, W - 1, WALL);
  fill(g, H - 1, 0, H - 1, W - 1, WALL);
  vLine(g, 0, 0, H - 1, WALL);
  vLine(g, W - 1, 0, H - 1, WALL);

  // Building facades (visual top rows — camera shows street level)
  fill(g, 1, 1, 3, W - 2, WALL);

  // Decorative props along back wall (dumpsters, crates)
  for (const c of [5, 12, 20, 27, 34]) {
    g[3][c] = PROP;
  }

  // Sidewalk curb
  fill(g, H - 2, 1, H - 2, W - 2, WALL);

  return [{
    id: '1-1',
    theme: 'dark urban street',
    size: [W, H],
    tiles: g,
    spawns: [
      { entity: 'FIGHTER',    x: 5,  y: 7 },
      { entity: 'BOSS_DRAGON', x: 35, y: 7 },
    ],
    goal: { kind: 'entity', entityId: 'BOSS_DRAGON' },
  }];
}

// ─── island-quest (top-down-adventure) ───────────────────────────────────────

const ISLAND_QUEST_GDD = {
  title: 'Island Quest',
  genre: 'top-down-adventure',
  tagline: 'A young hero explores a magical island collecting five heart crystals to restore the sacred shrine',
  loop: 'Explore the lush island, battle forest creatures with your sword, and collect heart crystals scattered across the land. Restore all five crystals to the shrine to save the island.',
  winCondition: 'window.__gameState.heartsCollected >= 5',
  loseCondition: 'window.__gameState.playerHp <= 0',
  controls: {
    movement: '8-direction',
    actions: [
      { key: 'SPACE', name: 'Sword', description: 'Swing sword in facing direction' },
    ],
  },
  entities: [
    { id: 'HERO', kind: 'player', color: 'green tunic', desc: 'Young hero in a green tunic and pointy cap wielding a gleaming short sword', states: ['idle', 'walk'], speed: 110, hp: 6 },
    { id: 'VILLAGER', kind: 'npc', color: 'warm brown', desc: 'Friendly island villager in warm brown peasant clothes with a cheerful face', states: ['idle', 'walk'], speed: 30, hp: 999 },
    { id: 'FOREST_SPRITE', kind: 'enemy', color: 'deep forest green', desc: 'Mischievous forest sprite with leafy wings and thorny claws in deep green', states: ['idle', 'walk'], speed: 70, hp: 2 },
    { id: 'STONE_GOLEM', kind: 'enemy', color: 'mossy gray stone', desc: 'Lumbering stone golem covered in moss with glowing amber eyes', states: ['idle', 'walk'], speed: 35, hp: 5 },
    { id: 'WIZARD', kind: 'boss', color: 'deep purple', desc: 'Ancient dark wizard in deep purple robes with a skull staff and electric energy around hands', states: ['idle', 'walk', 'cast'], speed: 50, hp: 12 },
    { id: 'HEART', kind: 'pickup', color: 'bright red crystal', desc: 'Glowing bright red heart-shaped crystal radiating warm light', states: ['idle'], speed: 0, hp: 0 },
  ],
  tilesetPalette: [
    { id: 'GRASS',  color: '#40A028', passable: true,  desc: 'bright green lush island grass ground tile, vivid tropical vegetation texture with tiny grass blade details and patches of dark soil, top-down view' },
    { id: 'WATER',  color: '#1E5EA0', passable: false, desc: 'deep blue tropical ocean water tile, rippling wave pattern with light blue highlights and subtle white foam edges, top-down island adventure view' },
    { id: 'WALL',   color: '#787878', passable: false, desc: 'gray ancient stone wall tile, weathered temple stone blocks with moss and lichen stains, archaeological island ruin texture, top-down view' },
    { id: 'FLOWER', color: '#E060B0', passable: true,  desc: 'pink wildflower decoration tile, small colorful tropical blossoms with green stems on bright soil, island flora decoration, top-down view' },
    { id: 'TREE',   color: '#1E4010', passable: false, desc: 'dark dense forest tree canopy tile, thick tropical dark green leaves with visible branch network, top-down aerial view of tree crown' },
  ],
  levelHints: { size: [20, 15], count: 1, themes: ['magical island'] },
};

function makeIslandQuestLevels() {
  const W = 20, H = 15;
  const [GRASS, WATER, WALL, FLOWER, TREE] = [0, 1, 2, 3, 4];
  const g = grid(H, W, GRASS);

  // Water border (ocean surround)
  fill(g, 0, 0, 0, W - 1, WATER);
  fill(g, H - 1, 0, H - 1, W - 1, WATER);
  vLine(g, 0, 0, H - 1, WATER);
  vLine(g, W - 1, 0, H - 1, WATER);

  // Tree clusters in corners
  fill(g, 1, 1, 3, 3, TREE);
  fill(g, 1, 16, 3, 18, TREE);
  fill(g, 11, 1, 13, 3, TREE);
  fill(g, 11, 16, 13, 18, TREE);

  // Central grove
  fill(g, 5, 9, 7, 10, TREE);

  // Stone ruins
  fill(g, 4, 5, 5, 6, WALL);
  fill(g, 4, 13, 5, 14, WALL);

  // Flower fields (passable decoration)
  fill(g, 3, 7, 3, 11, FLOWER);
  fill(g, 9, 4, 9, 7, FLOWER);
  fill(g, 10, 12, 10, 15, FLOWER);

  return [{
    id: '1-1',
    theme: 'magical island',
    size: [W, H],
    tiles: g,
    spawns: [
      { entity: 'HERO',         x: 5,  y: 5  },
      { entity: 'VILLAGER',     x: 10, y: 3  },
      { entity: 'FOREST_SPRITE', x: 15, y: 5 },
      { entity: 'FOREST_SPRITE', x: 14, y: 10 },
      { entity: 'STONE_GOLEM', x: 3,  y: 10 },
      { entity: 'WIZARD',       x: 10, y: 12 },
      { entity: 'HEART',        x: 8,  y: 3  },
      { entity: 'HEART',        x: 7,  y: 9  },
      { entity: 'HEART',        x: 15, y: 8  },
      { entity: 'HEART',        x: 5,  y: 12 },
      { entity: 'HEART',        x: 12, y: 6  },
    ],
    goal: { kind: 'entity', entityId: 'WIZARD' },
  }];
}

// ─── sewer-bot (action-platformer) ───────────────────────────────────────────

const SEWER_BOT_GDD = {
  title: 'Sewer Bot',
  genre: 'action-platformer',
  tagline: 'A scrappy maintenance robot navigates toxic sewers recharging on power cells while fighting mechanical vermin',
  loop: 'Platform through a toxic sewer complex, blast mechanical vermin with your arm cannon, collect 5 power cells to recharge, and defeat the corrupted AI mainframe guarding the exit.',
  winCondition: 'window.__gameState.batteriesCollected >= 5',
  loseCondition: 'window.__gameState.playerHp <= 0',
  controls: {
    movement: 'platformer',
    actions: [
      { key: 'SPACE', name: 'Jump', description: 'Jump with coyote-time grace' },
      { key: 'Z', name: 'Shoot', description: 'Fire horizontal projectile from arm cannon' },
    ],
  },
  entities: [
    {
      id: 'VOLT_BOT', kind: 'player',
      color: 'silver-white metallic',
      desc: 'Scrappy maintenance robot with silver-white metallic chassis, blue visor lens and glowing cyan power core on chest',
      states: ['idle', 'walk', 'jump', 'cast', 'block'], speed: 160, hp: 5,
    },
    {
      id: 'RAT_DRONE', kind: 'enemy',
      color: 'rust brown steampunk',
      desc: 'Mechanical steampunk rat with rust-brown chassis, glowing red eyes and rotating brass gear wheels on flanks',
      states: ['idle', 'walk'], speed: 65, hp: 2,
    },
    {
      id: 'SLUDGE_BLOB', kind: 'enemy',
      color: 'phosphorescent green',
      desc: 'Phosphorescent green toxic slime creature with faintly visible circuit-board patterns inside its translucent body',
      states: ['idle', 'walk'], speed: 35, hp: 3,
    },
    {
      id: 'PIPE_SPIDER', kind: 'enemy',
      color: 'copper plated',
      desc: 'Six-legged mechanical spider with copper plating, spinning drill-tip head and amber optical sensors',
      states: ['idle', 'walk'], speed: 55, hp: 2,
    },
    {
      id: 'BATTERY', kind: 'pickup',
      color: 'yellow cylindrical',
      desc: 'Yellow cylindrical power cell with a lightning bolt symbol on the label and glowing golden terminals at both ends',
      states: ['idle'], speed: 0, hp: 0,
    },
    {
      id: 'SHIELD_PACK', kind: 'pickup',
      color: 'blue hexagonal',
      desc: 'Blue hexagonal energy shield pack with glowing circuit tracery lines across its surface',
      states: ['idle'], speed: 0, hp: 0,
    },
    {
      id: 'CORE_MAINFRAME', kind: 'boss',
      color: 'dark corrupted metal',
      desc: 'Massive corrupted AI mainframe unit with cracked monitor screens displaying glitch artifacts, sparking exposed circuits and four heavy mechanical arms extending outward',
      states: ['idle', 'walk', 'cast'], speed: 40, hp: 10,
    },
  ],
  tilesetPalette: [
    { id: 'SKY',    color: '#FF00FF', passable: true  },
    { id: 'PIPE',   color: '#00CCCC', passable: false, desc: 'industrial sewer pipe platform tile, thick cyan-colored metal pipe cross-section viewed from the side, circular pipe with visible rivets, rust stains and verdigris patina, sci-fi maintenance robot aesthetic' },
    { id: 'FLOOR',  color: '#2A2A3A', passable: false, desc: 'dark grimy concrete sewer tunnel floor tile, rough worn surface with grime buildup, moisture stains, hairline cracks and algae growth' },
    { id: 'ACID',   color: '#22FF44', passable: true,  desc: 'toxic green acid pool hazard tile, bubbling luminescent green chemical liquid with phosphorescent glow and rising vapor wisps, danger hazard' },
    { id: 'LADDER', color: '#885522', passable: true,  desc: 'rusty iron maintenance ladder tile, corroded brown-orange metal rungs with visible bolt holes and paint flaking, industrial sewer maintenance access' },
  ],
  levelHints: { size: [22, 32], count: 1, themes: ['toxic sewer depths'] },
};

function makeSewerBotLevels() {
  const W = 22, H = 32;
  const [SKY, PIPE, FLOOR, ACID, LADDER] = [0, 1, 2, 3, 4];
  const g = grid(H, W, SKY);

  // ── Outer shell ──────────────────────────────────────────────────────────
  hLine(g, 0,      0, W - 1, PIPE);   // ceiling
  fill(g, H - 2, 0, H - 1, W - 1, FLOOR); // floor (2 rows thick)
  vLine(g, 0,      0, H - 1, PIPE);   // left wall
  vLine(g, W - 1,  0, H - 1, PIPE);   // right wall

  // ── Tier 1 platforms (bottom zone, rows 24-26) ───────────────────────────
  // Short L-shaped platform left
  hLine(g, 25, 2, 6, PIPE);
  g[24][6] = PIPE;
  // Mid platform (5 tiles)
  hLine(g, 25, 10, 14, PIPE);
  // Right platform corner shape
  hLine(g, 25, 17, 20, PIPE);
  g[24][17] = PIPE;

  // ── Acid pools at floor level (row 28, in gaps) ──────────────────────────
  hLine(g, 28, 7,  9,  ACID);  // pool 1
  hLine(g, 28, 15, 16, ACID); // pool 2
  hLine(g, 28, 3,  4,  ACID);  // pool 3

  // ── Tier 2 platforms (rows 20-21) ────────────────────────────────────────
  hLine(g, 20, 1,  5,  PIPE);
  hLine(g, 20, 8,  12, PIPE);
  // L-corner on right
  hLine(g, 20, 15, 19, PIPE);
  g[19][15] = PIPE;

  // ── Ladders connecting tier 1 → tier 2 ───────────────────────────────────
  vLine(g, 5,  21, 24, LADDER);  // ladder left side
  vLine(g, 13, 21, 24, LADDER); // ladder mid
  vLine(g, 18, 21, 24, LADDER); // ladder right

  // ── Acid pool mid-level ───────────────────────────────────────────────────
  hLine(g, 23, 7,  8,  ACID);

  // ── Tier 3 platforms (rows 15-16) ────────────────────────────────────────
  hLine(g, 15, 3,  7,  PIPE);
  hLine(g, 15, 11, 15, PIPE);
  g[14][11] = PIPE;  // L-corner
  hLine(g, 15, 17, 20, PIPE);

  // ── Ladders connecting tier 2 → tier 3 ───────────────────────────────────
  vLine(g, 3,  16, 19, LADDER);
  vLine(g, 16, 16, 19, LADDER);

  // ── Tier 4 platforms (rows 10-11) ────────────────────────────────────────
  hLine(g, 10, 1,  4,  PIPE);
  hLine(g, 10, 7,  12, PIPE);  // longer central platform
  g[9][7]  = PIPE;             // L-corner left
  hLine(g, 10, 16, 20, PIPE);

  // ── Ladders connecting tier 3 → tier 4 ───────────────────────────────────
  vLine(g, 8,  11, 14, LADDER);
  vLine(g, 19, 11, 14, LADDER);

  // ── Tier 5 / boss area (rows 3-5) ────────────────────────────────────────
  // Wide platform for boss fight
  hLine(g, 5,  3, 18, PIPE);
  g[4][3]  = PIPE;
  g[4][18] = PIPE;

  // ── Ladder to boss platform ───────────────────────────────────────────────
  vLine(g, 10, 6, 9, LADDER);

  return [{
    id: '1-1',
    theme: 'toxic sewer depths',
    size: [W, H],
    tiles: g,
    spawns: [
      // Player
      { entity: 'VOLT_BOT',      x: 5,  y: 29 },
      // Enemies
      { entity: 'RAT_DRONE',     x: 12, y: 24 },
      { entity: 'RAT_DRONE',     x: 17, y: 24 },
      { entity: 'SLUDGE_BLOB',   x: 9,  y: 19 },
      { entity: 'PIPE_SPIDER',   x: 14, y: 14 },
      { entity: 'CORE_MAINFRAME', x: 11, y: 2  },
      // Batteries (5 to win)
      { entity: 'BATTERY',       x: 13, y: 24 },
      { entity: 'BATTERY',       x: 4,  y: 19 },
      { entity: 'BATTERY',       x: 18, y: 14 },
      { entity: 'BATTERY',       x: 9,  y: 9  },
      { entity: 'BATTERY',       x: 16, y: 9  },
      // Shield packs
      { entity: 'SHIELD_PACK',   x: 7,  y: 24 },
      { entity: 'SHIELD_PACK',   x: 12, y: 14 },
    ],
    goal: { kind: 'entity', entityId: 'CORE_MAINFRAME' },
  }];
}

// ─── registry ────────────────────────────────────────────────────────────────

const GAMES = {
  'dungeon-knight': { gdd: DUNGEON_KNIGHT_GDD, makeLevels: makeDungeonKnightLevels },
  'dragon-brawl':   { gdd: DRAGON_BRAWL_GDD,  makeLevels: makeDragonBrawlLevels  },
  'island-quest':   { gdd: ISLAND_QUEST_GDD,  makeLevels: makeIslandQuestLevels  },
  'sewer-bot':      { gdd: SEWER_BOT_GDD,     makeLevels: makeSewerBotLevels     },
};

// ─── bg-artist runner ────────────────────────────────────────────────────────

function runBgScript(scriptPath, projectDir, quality) {
  return new Promise((res, rej) => {
    const proc = spawn('node', [scriptPath, projectDir, '--quality', quality], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => process.stderr.write(d));
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('error', rej);
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`bg-artist exit ${code}`))));
  });
}

// ─── main ────────────────────────────────────────────────────────────────────

const BG_GENRES = new Set(['platformer', 'action-platformer', 'shoot-em-up', 'twin-stick-shooter', 'dungeon-crawler', 'beat-em-up']);

async function main() {
  const gameName = process.argv[2];
  if (!gameName || !GAMES[gameName]) {
    console.error(`Usage: node scripts/gen_game.mjs ${Object.keys(GAMES).join('|')}`);
    process.exit(1);
  }

  const { gdd, makeLevels } = GAMES[gameName];
  const projectDir = resolve(ROOT, 'examples', gameName);
  const assetsDir = resolve(projectDir, 'public', 'assets');
  const dataDir = resolve(projectDir, 'public', 'data');
  const log = {
    info:    (m) => console.log(`  ℹ ${m}`),
    warn:    (m) => console.warn(`  ⚠ ${m}`),
    success: (m) => console.log(`  ✓ ${m}`),
    verbose: false,
  };

  await mkdir(assetsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  // 1 ── Write game-state.json (bg-artist needs it to read genre)
  const state = {
    version: 1, name: gameName, prompt: gdd.tagline, genre: gdd.genre,
    createdAt: new Date().toISOString(), gdd,
    levels: [], assets: { sprites: [], tiles: null },
    code: { entryPoint: 'src/main.js', scenes: ['Boot', 'Preload', 'Game'] }, qa: [],
  };
  await writeFile(resolve(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

  // 2 ── Sprites (GPT Image 2 via fal.ai)
  console.log(`\n[${gameName}] → sprites (GPT Image 2)...`);
  const spritesResult = await generateSprites({
    entities: gdd.entities,
    outDir: assetsDir,
    relDir: 'assets',
    style: `retro 8-bit pixel-art ${gdd.genre} game, ${gdd.tagline}`,
    quality: 'low',
    cwd: projectDir,
    log,
  });
  const spritesMeta = spritesResult.sprites;

  // 3 ── Tileset (GPT Image 2, one call per tile type)
  console.log(`[${gameName}] → tileset (GPT Image 2)...`);
  const tileset = await generateTilesetGPT({
    palette: gdd.tilesetPalette,
    outPath: join(assetsDir, 'tiles.png'),
    tileSize: 32,
    genre: gdd.genre,
    tagline: gdd.tagline,
    quality: 'low',
    log: (msg) => console.log(msg),
  });

  // 4 ── Background (GPT Image 2 via bg-artist)
  let bgMeta = null;
  if (BG_GENRES.has(gdd.genre)) {
    console.log(`[${gameName}] → background (GPT Image 2)...`);
    const bgScript = resolve(ROOT, 'skills/bg-artist/scripts/generate_bg.mjs');
    try {
      await runBgScript(bgScript, projectDir, 'low');
      const tmp = JSON.parse(await readFile(join(assetsDir, 'manifest.json'), 'utf8'));
      bgMeta = tmp.bg ?? null;
      console.log(`  ✓ bg: ${bgMeta?.theme}`);
    } catch (err) {
      console.warn(`  ⚠ bg-artist failed: ${err.message}`);
    }
  }

  // 5 ── Write final manifest
  const manifest = {
    sprites: spritesMeta.map((s, i) => ({ ...s, textureKey: `entities-${i + 1}` })),
    tiles: {
      relSheet: 'assets/tiles.png',
      tileSize: tileset.tileSize,
      ids: tileset.ids,
      passable: gdd.tilesetPalette.map((t) => !!t.passable),
    },
    bg: bgMeta,
  };
  await writeFile(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 6 ── Levels
  const levels = makeLevels();
  await writeFile(join(dataDir, 'levels.json'), JSON.stringify(levels, null, 2));

  // 7 ── Update game-state
  state.levels = levels;
  state.assets = { sprites: manifest.sprites, tiles: manifest.tiles, bg: bgMeta };
  await writeFile(resolve(projectDir, 'game-state.json'), JSON.stringify(state, null, 2) + '\n');

  console.log(`\n✅ ${gameName} assets ready!\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
