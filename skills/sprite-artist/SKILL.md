---
name: sprite-artist
description: Generates pixel-art sprite sheets for a game's entities and emits a manifest (row=entity, col=animation state). Wraps an external image-generation skill (fal.ai GPT-Image-2 by default) with deterministic post-processing (magenta chroma key → alpha). Falls back to procedural placeholder sprites when no API key is available. Use after game-designer has produced entities.
---

# Sprite Artist

Turns GDD entities into Phaser-ready sprite sheets and a manifest the codesmith consumes by name.

## When to use

After `game-designer` produces a GDD. The orchestrator passes the entities array; you produce sheets + manifest.

## Two modes

| Mode | Trigger | Cost | Output |
|---|---|---|---|
| **Image-generation** | `FAL_KEY` set, `--placeholder` not passed | ~$0.01-0.05 per sheet | Vivid pixel-art sprites |
| **Procedural fallback** | No `FAL_KEY`, or `--placeholder` flag | Free | Flat-color placeholder cells |

Both modes produce identical manifests, so downstream stages don't care which was used.

## Manifest contract

Each sheet entry:

```jsonc
{
  "sheet":      "<absolute path>",
  "relSheet":   "assets/<filename>.png",   // relative to project root, used in Phaser load
  "rows":       ["<ENTITY_ID>", ...],       // top-to-bottom
  "cols":       ["idle","walk","attack","hurt"], // left-to-right
  "cell":       <pixel size of one cell>,
  "bg":         "magenta" | "transparent",
  "textureKey": "entities-<N>"             // Phaser texture key
}
```

The complete manifest:
```jsonc
{
  "sprites": [<entry>, ...],
  "tiles": <set by tile-artist>
}
```

## Process

1. Read GDD entities from `game-state.json`.
2. Decide states-per-sheet: union of `entity.states` across all entities, ordered as `[idle, walk, attack, hurt, run, jump, cast, block, death, victory]` then alphabetical for any extras.
3. Batch entities into sheets of **≤ 9 rows** each.
4. For each batch:
   a. Image-gen mode: shell out to `~/.all-skills/sprite-sheet/scripts/generate.mjs` with `--bg magenta`. Then run chroma-key (magenta → alpha) via sharp.
   b. Procedural mode: paint a `cellPx × cellPx` colored cell per (row, col) with state-specific tint/silhouette.
5. Append entries to `manifest.sprites`.
6. Write `public/assets/manifest.json` (will be merged with tile-artist output later).
7. Update `game-state.json` `assets.sprites`.

## Image-generation mode details

- Uses fal.ai GPT-Image-2 endpoint (see `references/fal-api.md`).
- Default quality `low` (cheapest). Bumpable to `medium`/`high` via `--quality` flag.
- Background MUST be magenta (`#FF00FF`) — better chroma key fidelity than black against dark sprites.
- Image dimensions must satisfy: multiples of 16; ratio ≤ 3:1; total px ∈ [655360, 8294400]. Auto-pick `cellPx` to satisfy.
- After generation, post-process: every pixel where `R>200 && G<80 && B>200` → `alpha=0`. Done with `sharp`.

## Procedural mode details

- Cell size: 32px (small, fast, Phaser scales via FIT).
- Per (entity, state):
  - Body color from entity's `color` (named-color phrase → hex via lookup, falls back to gray).
  - State silhouette: idle = centered; walk = offset; attack = wider; hurt = squashed darker; jump = lifted; death = collapsed.
  - Eyes for player/enemy/boss/npc kinds. Outline border in darker shade.

## Scripts

- `scripts/generate_sheets.mjs <project-dir> [--placeholder] [--quality=low|medium|high]`
- `scripts/chroma_key.mjs <png-file>` — magenta → alpha post-processor (used internally and exposed for ad-hoc use).

## References

- `references/fal-api.md` — fal.ai GPT-Image-2 endpoint, request body, constraints, error codes.
- `references/chroma-key.md` — magenta vs black background trade-offs and pixel-replacement logic.
- `references/prompt-template.md` — the prompt structure used in image-gen mode (rows × cols layout instructions).

## Dependencies

- `sharp` — image post-processing (npm dep).
- External: `~/.all-skills/sprite-sheet/` skill must be installed for image-gen mode (procedural mode has no external deps).
