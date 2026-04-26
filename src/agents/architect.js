import { jsonCall } from '../lib/anthropic.js';

const SYSTEM = `You are a level architect for an automated 8-bit game generator.
You design tile-based levels using ONLY the tile IDs and entity IDs provided.
Output must be a single JSON array of level objects.

Schema:

[
  {
    "id": string,                          // e.g. "1-1"
    "theme": string,                       // matches GDD levelHints.themes
    "size": [number, number],              // [width, height] in tiles
    "tiles": number[][],                   // 2D array of tile palette indices (0-based, into GDD tilesetPalette)
    "spawns": [
      { "entity": string, "x": number, "y": number, "facing"?: "up"|"down"|"left"|"right" }
    ],
    "goal": { "kind": "tile" | "entity", "x"?: number, "y"?: number, "entityId"?: string }
  }
]

Hard constraints:
- The tiles[][] dimensions must match size.
- All tile values are integer indices into tilesetPalette (0..palette.length-1).
- The border (outermost ring) of every level must be impassable tiles.
- Every level must have exactly one spawn for the player entity.
- Player spawn must be on a passable tile (palette[tiles[y][x]].passable === true).
- Enemy/pickup spawns must also be on passable tiles, not overlapping the player.
- For platformer genre: bottom row should be solid (impassable); place player one tile above the floor; include scattered floating platforms.
- For top-down genre: open rooms with wall obstacles; corridors at least 2 tiles wide.
- Number of enemies per level: 2-6.
- Coordinates use (x=column, y=row), origin top-left.
- Goal: if kind="tile", must be a passable tile reachable from spawn; if kind="entity", that entity must be in spawns.

Return ONLY the JSON array.`;

export async function architectLevels({ gdd, log }) {
  log?.info?.('agent: architect');
  const tilePaletteList = gdd.tilesetPalette.map((t, i) => `  ${i}: ${t.id} (${t.passable ? 'passable' : 'WALL'}, ${t.color})`).join('\n');
  const entityList = gdd.entities.map((e) => `  - ${e.id} (${e.kind})`).join('\n');
  const themes = gdd.levelHints.themes ?? ['default'];
  const count = gdd.levelHints.count ?? 1;

  const user = `Game: ${gdd.title} (${gdd.genre})
Win condition: ${gdd.winCondition}

Tile palette (use these indices in tiles[][]):
${tilePaletteList}

Entities (use these IDs in spawns):
${entityList}

Build ${count} level(s) of size ${gdd.levelHints.size[0]}×${gdd.levelHints.size[1]} tiles.
Themes (one per level): ${themes.join(', ')}

Output the JSON array now.`;

  const { json, usage } = await jsonCall({
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  validate(json, gdd);
  log?.success?.(`architect: ${json.length} level(s), ${json[0].size.join('×')} tiles`);
  return { levels: json, usage };
}

function validate(levels, gdd) {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error('No levels produced');
  const palette = gdd.tilesetPalette;
  const playerId = gdd.entities.find((e) => e.kind === 'player')?.id;
  const validEntityIds = new Set(gdd.entities.map((e) => e.id));
  for (const lvl of levels) {
    const [w, h] = lvl.size;
    if (lvl.tiles.length !== h) throw new Error(`Level ${lvl.id}: tiles height ${lvl.tiles.length} != ${h}`);
    for (let y = 0; y < h; y++) {
      if (lvl.tiles[y].length !== w) throw new Error(`Level ${lvl.id}: tiles row ${y} width ${lvl.tiles[y].length} != ${w}`);
      for (let x = 0; x < w; x++) {
        const v = lvl.tiles[y][x];
        if (!Number.isInteger(v) || v < 0 || v >= palette.length) {
          throw new Error(`Level ${lvl.id}: tile (${x},${y}) = ${v} out of palette range`);
        }
      }
    }
    const playerSpawns = lvl.spawns.filter((s) => s.entity === playerId);
    if (playerSpawns.length !== 1) throw new Error(`Level ${lvl.id}: must have exactly 1 player spawn, has ${playerSpawns.length}`);
    for (const s of lvl.spawns) {
      if (!validEntityIds.has(s.entity)) throw new Error(`Level ${lvl.id}: unknown entity ${s.entity}`);
      if (s.x < 0 || s.x >= w || s.y < 0 || s.y >= h) {
        throw new Error(`Level ${lvl.id}: spawn ${s.entity} (${s.x},${s.y}) out of bounds`);
      }
      const tile = palette[lvl.tiles[s.y][s.x]];
      if (!tile.passable) throw new Error(`Level ${lvl.id}: spawn ${s.entity} on impassable tile`);
    }
  }
}
