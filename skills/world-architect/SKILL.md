---
name: world-architect
description: Designs tile-based levels for a Phaser game using only the tile IDs and entity IDs from the GDD. Outputs a JSON array of level objects (tilemap + spawns + goal). Use after game-designer has produced a valid GDD and the orchestrator needs level data.
---

# World Architect

Builds levels for the Phaser tilemap loader. Inputs a GDD, outputs a JSON array of levels.

## When to use

After `game-designer` produces a valid GDD. The orchestrator passes the GDD; you produce `levels.json`.

## Output contract

Single JSON array. Each element:

```jsonc
{
  "id":     "<e.g. '1-1'>",
  "theme":  "<matches gdd.levelHints.themes[i]>",
  "size":   [<width>, <height>],         // tiles, must match levelHints.size
  "tiles":  number[][],                   // 2D array of palette indices, [row][col]
  "spawns": [
    { "entity": "<ENTITY_ID>", "x": <col>, "y": <row>, "facing"?: "up"|"down"|"left"|"right" }
  ],
  "goal":   { "kind": "tile" | "entity", "x"?: <col>, "y"?: <row>, "entityId"?: "<ID>" }
}
```

## Hard constraints

- `tiles[][]` dimensions match `size`. Outer rings are impassable tiles.
- All tile values are integer indices into `gdd.tilesetPalette` (0-based).
- Exactly one player spawn per level, on a passable tile, not overlapping any other spawn.
- All other spawns on passable tiles.
- Coordinates: `(x = column, y = row)`, origin top-left.
- **Platformer**: bottom row solid (impassable). Player one tile above the floor. Sprinkle 2-4 floating platforms.
- **Top-down**: open rooms with wall obstacles. Corridors ≥ 2 tiles wide.
- 2-6 enemies per level.
- `goal`: if `kind === "tile"`, must be reachable from spawn; if `kind === "entity"`, that entity must be in `spawns`.

## Process

1. Read the GDD from `game-state.json`.
2. For each `levelHints.themes[i]` (or `count` if no themes), build one level.
3. Start with the impassable border, then carve out walkable interior, then place obstacles, then place spawns, then place goal.
4. Run `scripts/validate_levels.mjs <levels-file> <gdd-file>` before returning.
5. Save to `game-state.json` under `levels`, also write `public/data/levels.json`.

## Validation rules (encoded in `scripts/validate_levels.mjs`)

- `tiles.length === size[1]` and every row's length === `size[0]`.
- Every tile value in `[0, palette.length)`.
- Exactly one player spawn per level, on a passable tile.
- All spawn coordinates within bounds and on passable tiles.
- Border ring is impassable.
- For platformer: `tiles[height-1][*]` all impassable.

## Examples

See `references/level-examples.md` for a 16×12 top-down level and a 22×12 platformer level (used by the playtester fixtures).

## Scripts

- `scripts/validate_levels.mjs <levels-file> <gdd-file>` — fails non-zero with reason if invalid.

## References

- `references/level-schema.json` — JSON Schema.
- `references/level-examples.md` — one level per genre with annotation.
