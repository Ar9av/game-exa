---
name: tile-artist
description: Generates a tileset PNG from the GDD's tilesetPalette. Default mode calls GPT Image 2 once per tile type (512×512 → 32×32) for real pixel-art textures. Falls back to procedural flat-color cells if FAL_KEY is absent. Writes tile metadata into manifest.json. Use after game-designer has produced a tile palette.
---

# Tile Artist

Generates `tiles.png` and tile metadata. GPT Image 2 is the default — one API call per non-SKY tile, each generated at 512×512 then downscaled to 32×32. Falls back to procedural flat-color cells when `FAL_KEY` is unavailable.

## Two modes

| Mode | When | Cost | Output |
|---|---|---|---|
| **GPT Image 2** (default) | `FAL_KEY` present | ~$0.01–0.05 per tile at `low` quality | Real pixel-art textures (cobblestone, brick mortar, grass blades, etc.) |
| **Procedural fallback** | No API key | Free | Flat-colored cells with a subtle 1-pixel darker border |

Both produce identical manifest entries — downstream Preload and Game.js are unaware which was used.

## When to use

After `game-designer` produces a GDD with `tilesetPalette`. Runs in parallel with `sprite-artist` and `bg-artist`.

## GDD palette format

Each entry in `gdd.tilesetPalette`:

```jsonc
{
  "id": "STONE",          // used as tile key in levels and manifest.ids
  "color": "#607070",     // fallback color if GPT call fails
  "passable": false,      // false = solid collision, true = walk-through
  "desc": "gray cobblestone dungeon floor, beveled stone blocks with mortar cracks"
  // ↑ optional but strongly recommended — used as the GPT Image 2 prompt
}
```

If `desc` is omitted, the skill falls back to a built-in description map keyed on `id` (covers common ids: STONE, BRICK, SPIKE, LADDER, PIPE, FLOOR, ACID, GROUND, WALL, PROP, GRASS, WATER, FLOWER, TREE). If the id is not in the map, it constructs a generic prompt from the id and color.

## How GPT generation works

For each palette entry (skipping `SKY` / `#FF00FF` tiles):

1. Build a prompt: `"Pixel art game tile, flat seamlessly tileable surface texture: {desc}. {genre} game aesthetic. Seamlessly tileable, 16-bit retro pixel art, chunky well-defined pixels, clean sharp edges. No text, no characters, no HUD elements, no border frame."`
2. Call `fal.run/openai/gpt-image-2` at `image_size: { width: 512, height: 512 }`, `quality: low` (configurable).
3. Downscale the 512×512 result to `tileSize × tileSize` (default 32) using `sharp`.
4. Copy into position `i * tileSize` in the horizontal output strip.
5. If the call fails, paint the solid `color` value for that tile (no crash).

SKY tiles are filled with solid magenta (`#FF00FF`) — Game.js hides them via `setAlpha(0)` so the parallax background shows through.

## Output

- `public/assets/tiles.png` — horizontal strip: `(tileSize × numTiles) × tileSize` pixels, one tile per palette entry.
- Manifest entry under `tiles`:

```jsonc
{
  "tiles": {
    "relSheet": "assets/tiles.png",
    "tileSize": 32,
    "ids":      ["SKY", "STONE", "BRICK", "SPIKE", "LADDER"],
    "passable": [true, false, false, true, true]
  }
}
```

`ids[i]` and `passable[i]` both correspond to tile index `i` in any level's `tiles[][]` array.

## Implementation

The core function is `generateTilesetGPT()` in `src/lib/sprites.js`. It is called by `scripts/gen_game.mjs` for all example games. For agent-driven pipeline use, invoke it from `codesmith` or a custom orchestration script:

```js
import { generateTilesetGPT } from '../src/lib/sprites.js';

const tileset = await generateTilesetGPT({
  palette:  gdd.tilesetPalette,   // array of { id, color, passable, desc? }
  outPath:  'public/assets/tiles.png',
  tileSize: 32,
  genre:    gdd.genre,            // added to each tile prompt for style coherence
  tagline:  gdd.tagline,          // added to each tile prompt
  quality:  'low',                // low | medium | high
  log:      console.log,
});
// → { sheet, tileSize, ids }
```

Fallback scripts (kept for reference / standalone use):
- `scripts/paint_tiles.mjs <project-dir>` — procedural flat-color strip, no API key needed.
- `scripts/generate_tiles_gpt.mjs <project-dir> [--quality low]` — thin CLI wrapper around `generateTilesetGPT`.

## Dependencies

- `sharp` — raw RGBA buffer → PNG, resize.
- `FAL_KEY` in env or `~/.all-skills/.env` — for GPT Image 2 calls. Falls back gracefully if missing.

## Why GPT tiles look better than procedural

Procedural tiles are obviously synthetic — flat green for grass, flat brown for dirt. GPT Image 2 produces texture variation: grass blades, dirt speckles, brick mortar lines, pipe rivets. At 32×32 the detail reads clearly. Combined with `bg-artist`'s parallax background, the visual quality jumps from "tech demo" to "real game".

## Transparent SKY trick

For platformers and action games, the first palette entry is `{ id: "SKY", color: "#FF00FF", passable: true }`. The tile artist fills it with solid magenta. In Game.js:

```js
const skyIdx = manifest.tiles.ids.indexOf('SKY');
if (skyIdx >= 0) {
  this._tileLayer.forEachTile(t => { if (t.index === skyIdx) t.setAlpha(0); });
}
```

This makes the sky tile invisible, letting the `bg-artist` background show through — no extra draw calls, no extra texture.
