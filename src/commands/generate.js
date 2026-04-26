import { resolve, join, dirname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadState, saveState } from '../lib/state.js';
import { designGame } from '../agents/designer.js';
import { architectLevels } from '../agents/architect.js';
import { writeGameCode } from '../agents/codesmith.js';
import { generateSprites, generateSpritesProcedural, generateTileset } from '../lib/sprites.js';
import { ensureValue, prompts as p } from '../lib/interactive.js';
import { CliError, EX } from '../lib/errors.js';

export async function generateCommand(description, opts, ctx) {
  const log = ctx.log;
  const projectDir = ctx.cwd;
  const state = await loadState(projectDir);

  const desc = await ensureValue(description, {
    name: 'game description',
    opts,
    prompt: () => p.text({ message: 'Describe the game in one or two sentences:', placeholder: 'A pixel knight explores a dark cave fighting slimes' }),
  });
  state.prompt = desc;
  state.genre = opts.genre ?? state.genre;

  // 1. Designer
  log.emit('agent.designer.start');
  const { gdd } = await designGame({ description: desc, genreHint: state.genre, log });
  state.gdd = gdd;
  state.genre = gdd.genre;
  await saveState(projectDir, state);
  log.emit('agent.designer.done', { title: gdd.title, genre: gdd.genre, entities: gdd.entities.length });

  // 2. Architect
  log.emit('agent.architect.start');
  const { levels } = await architectLevels({ gdd, log });
  state.levels = levels;
  await saveState(projectDir, state);
  log.emit('agent.architect.done', { levels: levels.length });

  // 3. Sprites (deterministic)
  log.emit('asset.sprites.start');
  const assetsDir = resolve(projectDir, 'public', 'assets');
  const dataDir = resolve(projectDir, 'public', 'data');
  await mkdir(assetsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  let spritesResult;
  if (opts.skipSprites) {
    log.warn('--skip-sprites: assuming public/assets/entities*.png already exist');
    spritesResult = { sprites: await deriveSpriteMeta(gdd, assetsDir) };
  } else if (opts.placeholderSprites) {
    spritesResult = await generateSpritesProcedural({
      entities: gdd.entities,
      outDir: assetsDir,
      relDir: 'assets',
      log,
    });
  } else {
    spritesResult = await generateSprites({
      entities: gdd.entities,
      outDir: assetsDir,
      relDir: 'assets',
      style: `retro 8-bit pixel-art ${gdd.genre} game, ${gdd.tagline}`,
      quality: opts.quality ?? 'low',
      cwd: projectDir,
      log,
    });
  }
  const spritesMeta = spritesResult.sprites;
  log.emit('asset.sprites.done', { sheets: spritesMeta.length });

  // 4. Tileset (procedural for v1)
  log.emit('asset.tiles.start');
  const tileset = await generateTileset({
    palette: gdd.tilesetPalette,
    outPath: join(assetsDir, 'tiles.png'),
    tileSize: 16,
  });
  log.emit('asset.tiles.done');

  // 5. Manifest + level data
  const manifest = {
    sprites: spritesMeta.map((s, i) => ({
      ...s,
      textureKey: `entities-${i + 1}`,
    })),
    tiles: {
      relSheet: 'assets/tiles.png',
      tileSize: tileset.tileSize,
      ids: tileset.ids,
      passable: gdd.tilesetPalette.map((t) => !!t.passable),
    },
  };
  await writeFile(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(dataDir, 'levels.json'), JSON.stringify(levels, null, 2));
  state.assets = { sprites: manifest.sprites, tiles: manifest.tiles };
  await saveState(projectDir, state);

  // 6. Code synthesis
  log.emit('agent.codesmith.start');
  const { files } = await writeGameCode({ gdd, levels, manifest, log });
  for (const f of files) {
    if (!f.path.startsWith('src/')) {
      throw new CliError(`codesmith tried to write outside src/: ${f.path}`, EX.GENERIC);
    }
    const abs = resolve(projectDir, f.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content);
  }
  log.emit('agent.codesmith.done', { files: files.length });

  await saveState(projectDir, state);
  log.result({ title: gdd.title, genre: gdd.genre, files: files.map((f) => f.path) });
  if (!ctx.json) {
    log.success(`generated ${gdd.title} (${gdd.genre})`);
    log.info('next: gameforge dev   # then open the URL — or: gameforge qa');
  }
}

async function deriveSpriteMeta(gdd, assetsDir) {
  // Match the chunking the sprite-sheet generator used.
  const ROWS_PER_SHEET = 9;
  const sheets = [];
  for (let i = 0; i < gdd.entities.length; i += ROWS_PER_SHEET) {
    const group = gdd.entities.slice(i, i + ROWS_PER_SHEET);
    const cols = mergedStates(group);
    const sheetName = gdd.entities.length <= ROWS_PER_SHEET ? 'entities.png' : `entities-${Math.floor(i / ROWS_PER_SHEET) + 1}.png`;
    sheets.push({
      relSheet: `assets/${sheetName}`,
      rows: group.map((e) => e.id),
      cols,
      cell: 160, // matches sprite-sheet skill default; sheets are downscaled by Phaser via FIT
      bg: 'magenta',
    });
  }
  return sheets;
}

function mergedStates(entities) {
  const set = new Set();
  for (const e of entities) for (const s of (e.states ?? ['idle', 'walk', 'attack', 'hurt'])) set.add(s);
  if (set.size === 0) return ['idle', 'walk', 'attack', 'hurt'];
  const order = ['idle', 'walk', 'attack', 'hurt', 'run', 'jump', 'cast', 'block', 'death', 'victory'];
  const ordered = order.filter((s) => set.has(s));
  for (const s of [...set].sort()) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
}
