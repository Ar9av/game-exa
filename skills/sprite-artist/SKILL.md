---
name: sprite-artist
description: Generates pixel-art sprite sheets for a game's entities using GPT Image 2 (gpt-image-2) and emits a manifest (row=entity, col=animation state). Always defaults to low quality; post-processes magenta to alpha via sharp. Falls back to procedural placeholder cells when no API key is available. Use after game-designer has produced entities.
---

# Sprite Artist

Turns GDD entities into Phaser-ready sprite sheets and a manifest the codesmith consumes by name. Uses **GPT Image 2** (`gpt-image-2`) — OpenAI's state-of-the-art image generation model — by default. Available via fal.ai (default provider, requires `FAL_KEY`) or directly through the OpenAI Images API (requires `OPENAI_API_KEY`).

## When to use

After `game-designer` produces a GDD. The orchestrator passes the entities array; you produce sheets + manifest.

## Two modes

| Mode | Trigger | Cost | Output |
|---|---|---|---|
| **GPT Image 2** | `FAL_KEY` or `OPENAI_API_KEY` set, `--placeholder` not passed | ~$0.01-0.05 per sheet at `low` quality | Vivid pixel-art sprites |
| **Procedural fallback** | No key, or `--placeholder` flag | Free | Flat-color placeholder cells |

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

## GPT Image 2 mode details

- Uses **GPT Image 2** (`gpt-image-2`). See `references/gpt-image-2.md` for endpoint, request shape, and provider options.
- Default provider: fal.ai (`https://fal.run/openai/gpt-image-2`). Drop-in alternative: OpenAI Images API (`https://api.openai.com/v1/images/generations`).
- **Default quality: `low`** — always start here for prototyping and framework iteration. Bump to `medium`/`high` only when explicitly asked.
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

- `references/gpt-image-2.md` — GPT Image 2 endpoint, request body, constraints, content-filter notes, provider options (fal.ai default + OpenAI direct).

## Dependencies

- `sharp` — image post-processing (npm dep).
- External (optional, for full-fidelity prompt template): `~/.all-skills/sprite-sheet/` skill provides one battle-tested wrapper. The skill's GPT Image 2 mode also runs without it via the bundled direct-call script.
