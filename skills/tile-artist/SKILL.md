---
name: tile-artist
description: Generates a tileset PNG from the GDD's tilesetPalette. Two modes: (1) GPT Image 2 (gpt-image-2) for real pixel-art tiles, (2) procedural flat-color cells for prototyping. Writes the tile metadata into manifest.json. Use after game-designer has produced a tile palette.
---

# Tile Artist

Generates `tiles.png` and tile metadata. Two modes: GPT Image 2 for real pixel-art tiles, or procedural flat-color cells.

## Two modes

| Mode | Trigger | Cost | Output |
|---|---|---|---|
| **GPT Image 2** | `scripts/generate_tiles_gpt.mjs` (preferred when `FAL_KEY` or `OPENAI_API_KEY` is set) | ~$0.01-0.05 at `low` quality | Real pixel-art tiles (grass-on-dirt, stone bricks, etc.) |
| **Procedural** | `scripts/paint_tiles.mjs` (default fallback) | Free | Flat-colored cells with a subtle 1-pixel border |

Both produce identical manifest entries, so downstream Preload is unaware which was used.

## When to use

After `game-designer` produces a GDD with `tilesetPalette`. Runs in parallel with sprite-artist.

## Output

- `public/assets/tiles.png` — a horizontal strip of `tileSize × tileSize` cells, one per palette entry.
- Manifest entry merged into `public/assets/manifest.json` under `tiles`:

```jsonc
{
  "tiles": {
    "relSheet": "assets/tiles.png",
    "tileSize": 16,
    "ids":      ["<TILE_ID>", ...],
    "passable": [<bool>, ...]
  }
}
```

The order of `ids[]` matches palette order; tile index `i` in any level's `tiles[][]` indexes into this array.

## Process

1. Read `gdd.tilesetPalette` from state.
2. For each entry, paint a `tileSize × tileSize` square in the entry's color, with the outermost pixel ring darkened to ~70% brightness for visible cell boundaries.
3. Stitch horizontally into a single PNG.
4. Write metadata into `manifest.tiles`.

## Defaults

- `tileSize`: 16 px (matches level coordinate system).
- Border darken factor: 0.7 (subtle but visible against the body color).
- Output format: PNG, RGBA.

## Scripts

- `scripts/paint_tiles.mjs <project-dir> [--tile-size 16]` — procedural flat-color strip. No external dependencies.
- `scripts/generate_tiles_gpt.mjs <project-dir> [--quality low|medium|high]` — calls **GPT Image 2** (`gpt-image-2`) via fal.ai or OpenAI for a 2×2 tile grid. Auto-detects passable tiles (those become magenta cells that get chroma-keyed to alpha so a background image can show through). Supports 2-4 tile palettes; for larger palettes use the procedural script.

## Dependencies

- `sharp` — raw RGBA buffer → PNG, downscale, chroma-key.
- For GPT Image 2 mode: `FAL_KEY` (preferred, in `~/.all-skills/.env` or env) or `OPENAI_API_KEY` (env).

## Why generated tiles look better than procedural

Procedural is fast and reliable but obviously synthetic — flat green for grass, flat brown for dirt. GPT Image 2 produces texture variation (grass blades, dirt speckles, brick mortar lines) that reads as real pixel art when scaled to 32×32. Combined with a parallax background from `bg-artist`, the visual quality jumps from "tech demo" to "actual game".

## Transparent SKY trick

For genres that benefit from a parallax sky (platformer, shoot-em-up), the first palette entry is typically `passable: true` (e.g. `SKY`). The GPT Image 2 prompt explicitly leaves that cell as magenta, which the post-process strips to alpha. The Phaser tilemap then renders the sky tile transparent, and the `bg-artist`'s background image shows through. Result: real depth, single texture, no extra layers.
