# `game-state.json` schema

Single source of truth at the project root. Every skill reads/writes it.

## Shape

```jsonc
{
  "version": 1,                            // schema version, bumped on breaking changes
  "name": "<project-name>",                // matches the project directory
  "prompt": "<original user description>",
  "genre": "top-down-adventure" | "platformer" | "twin-stick-shooter" | "puzzle" | "shoot-em-up" | "dungeon-crawler" | null,
  "createdAt": "<ISO timestamp>",

  "gdd": <output of game-designer or null>,        // see skills/game-designer/references/gdd-schema.json
  "levels": [<output of world-architect>],          // see skills/world-architect/references/level-schema.json

  "assets": {
    "sprites": [
      {
        "sheet":      "<absolute path>",
        "relSheet":   "assets/entities.png",
        "rows":       ["KNIGHT", "SLIME", "GEM"],
        "cols":       ["idle", "walk", "attack", "hurt"],
        "cell":       32,
        "bg":         "magenta" | "transparent",
        "textureKey": "entities-1"
      }
    ],
    "tiles": {
      "relSheet": "assets/tiles.png",
      "tileSize": 16,
      "ids":      ["GRASS", "DIRT", "STONE", "TREE"],
      "passable": [true, true, false, false]
    }
  },

  "code": {
    "entryPoint": "src/main.js",
    "scenes":     ["Boot", "Preload", "Game"]
  },

  "qa": [
    {
      "ts":        "<ISO>",
      "url":       "http://127.0.0.1:5173",
      "passed":    false,
      "scenarios": [...],
      "failures":  [...]
    }
    // ... last 5 reports
  ]
}
```

## Mutation rules

- **Always** read → mutate → write atomically. Use `saveState(projectDir, state)` from `src/lib/state.js`.
- **Never** delete `gdd` once set (refiner needs it). To invalidate, set `qa[]` to empty and re-run.
- `qa[]` is bounded to last 5 entries.
- `version` is set by `emptyState()`; do not change manually unless writing a migration.

## Invariants

- If `gdd` is set, exactly one entity with `kind === "player"`.
- If `levels` is non-empty, every level's spawns reference a valid entity ID from `gdd.entities`.
- If `assets.sprites` is non-empty, every entity in `gdd.entities` is in some sheet's `rows`.
- If `assets.tiles` is set, `tiles.ids.length === gdd.tilesetPalette.length` and `tiles.passable[i] === gdd.tilesetPalette[i].passable`.

These are checked by `skills/gameforge/scripts/validate_state.mjs <project-dir>`.

## Why a single file

Splitting state across multiple files (gdd.json, levels.json, manifest.json, etc.) creates consistency hazards: one stage updates one file, another stage reads stale companion data. The single state file is the authoritative source; the per-asset files (`public/assets/manifest.json`, `public/data/levels.json`) are *projections* derived from it, written at the end of each stage. The Phaser runtime only loads the projections, never the state file itself.
