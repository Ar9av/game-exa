---
name: tile-artist
description: Paints a tileset PNG from the GDD's tilesetPalette and writes the tile metadata. Procedural and deterministic — no LLM, no image API. Each tile is a flat-colored cell with a subtle border so tile edges are visible in-game. Use after game-designer has produced a tile palette.
---

# Tile Artist

Generates `tiles.png` and tile metadata. Pure deterministic helper — invoke whenever the GDD palette changes.

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

- `scripts/paint_tiles.mjs <project-dir> [--tile-size 16]`

## Dependencies

- `sharp` — raw RGBA buffer → PNG.

## Why not call sprite-artist for tiles?

Tiles need pixel-perfect alignment with the level grid. Image-generation models drift on small constraints. Procedural painting is deterministic, ~5ms per tileset, and produces consistently legible output that works for v0. A future skill could call sprite-artist for stylized tiles once the rest of the pipeline is stable.
