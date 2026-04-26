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

## Visual quality target

The procedural generator targets **NES / early GBA pixel art quality** — the visual bar set by Double Dragon, Shovel Knight, and Link's Awakening:
- **Characters**: ellipse-based heads, distinct clothing layers (tunic, belt, boots), visible arms with hands, walk cycle with ±2 px leg offset between frames.
- **Outlines**: 1-pixel dark border around entire sprite silhouette using the two-pass rule below.
- **Cell size**: 48 px (gives enough pixels for readable faces, clothing detail, accessories).
- **Palette discipline**: 4-8 colors per character — highlight, midtone, shadow, outline + 1-2 accent colors.
- **Transparent backgrounds**: sprite buffers init to `alpha=0`; only drawn pixels get `alpha=255`. The two-pass outline rule below keeps backgrounds clean.

## Two-pass outline rule (CRITICAL)

**Never** draw outline pixels in-place during the same buffer scan that reads opaque pixels — each newly-opaque outline pixel triggers another outline pixel on the next iteration, cascading a dark flood-fill across the entire right/bottom of the cell.

```js
// CORRECT — collect first, draw second:
function addOutline(buf, W, x0, y0, sz, oR, oG, oB) {
  const toFill = [];
  for (let y = y0; y < y0 + sz; y++)
    for (let x = x0; x < x0 + sz; x++) {
      if (buf[(y * W + x) * 4 + 3] < 200) continue;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx >= x0 + sz || ny < y0 || ny >= y0 + sz) continue; // clamp to cell
        if (buf[(ny * W + nx) * 4 + 3] < 200) toFill.push(nx, ny);
      }
    }
  for (let i = 0; i < toFill.length; i += 2)
    pix(buf, W, toFill[i], toFill[i + 1], oR, oG, oB);
}
```

Call `addOutline()` once per cell, **after** all other pixels are drawn.

## Procedural mode details

- Cell size: **48 px** (Phaser scales to display size via `setDisplaySize` — cell size doesn't change hitboxes).
- Per (entity, state):
  - Body color from entity's `color` (named-color phrase → hex via lookup, falls back to gray).
  - Humanoid characters: ellipse head, rectangular torso, arm + leg pairs. Idle = symmetric. Walk = ±2 px leg X offset between the two walk frames.
  - Non-humanoid enemies: shape appropriate to description (blob, quadruped, flying creature).
  - Eyes for player/enemy/boss/npc kinds.
  - Call `addOutline()` once per cell, after all pixels are drawn, using the two-pass approach above.
  - Outline color: darkest shade of character's primary color (not pure black — e.g. dark brown for a tan character).

## Scripts

- `scripts/generate_sheets.mjs <project-dir> [--placeholder] [--quality=low|medium|high]`
- `scripts/chroma_key.mjs <png-file>` — magenta → alpha post-processor (used internally and exposed for ad-hoc use).

## References

- `references/gpt-image-2.md` — GPT Image 2 endpoint, request body, constraints, content-filter notes, provider options (fal.ai default + OpenAI direct).

## Dependencies

- `sharp` — image post-processing (npm dep).
- External (optional, for full-fidelity prompt template): `~/.all-skills/sprite-sheet/` skill provides one battle-tested wrapper. The skill's GPT Image 2 mode also runs without it via the bundled direct-call script.
