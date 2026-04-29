---
name: palette-enforcer
description: Quantizes all generated PNG assets (sprites, tiles, background) to a named 8-bit color palette to achieve visual coherence. Run after sprite-artist, tile-artist, and bg-artist, before codesmith. Writes state.style.palette so downstream skills know the chosen palette.
---

# Palette Enforcer — Visual Coherence

Applies color palette constraints to all generated PNG assets so every sprite, tile, and background shares the same enumerated color set. Without this, GPT Image 2 returns arbitrary colors and assets from the same game look like they came from different games.

## When to use

After all art generation (sprite-artist, tile-artist, bg-artist) and before codesmith. Also run if the user says "make the art more cohesive" or "unify the palette."

## Palettes available

| ID | Colors | Best for |
|---|---|---|
| `sweetie-16` | 16 | Default — friendly, any genre |
| `pico8` | 16 | Bold retro, shoot-em-ups, platformers |
| `endesga-32` | 32 | RPGs, dungeon crawlers, rich detail |
| `gameboy` | 4 | Maximum constraint, mono-theme games |
| `nes` | 16 | Classic NES aesthetic |

## Output contract

- All PNGs in `public/assets/` are overwritten in-place with palette-quantized versions.
- `game-state.json` gains `state.style.palette` with the chosen palette ID.
- Transparent pixels (alpha < 128) are preserved; only opaque pixels are quantized.
- The magenta chroma-key background (#FF00FF) is kept as-is — it's stripped later at runtime.

```jsonc
// game-state.json after running
{
  "style": {
    "palette": "sweetie-16"
  }
}
```

## Process

1. Choose palette: use `--palette <id>` arg, or auto-select based on genre:
   - `platformer` / `action-platformer` → `pico8`
   - `top-down-rpg` / `dungeon-crawler` → `endesga-32`
   - `shoot-em-up` → `pico8`
   - default → `sweetie-16`
2. Run `scripts/enforce_palette.mjs <project-dir> [--palette <id>]`
3. Script processes all PNGs found in `public/assets/` and writes them back.
4. Writes `state.style.palette` to `game-state.json`.

## Scripts

- `scripts/enforce_palette.mjs <project-dir> [--palette <id>]` — quantize all assets.

## References

- `references/palettes.json` — all palette definitions with hex color arrays.
