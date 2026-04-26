# GPT Image 2 — pixel-art generation reference

The framework uses **GPT Image 2** (`gpt-image-2`) — OpenAI's state-of-the-art image generation model — for all sprite, tile, and background generation. Two providers are supported:

| Provider | Endpoint | Auth | Notes |
|---|---|---|---|
| **fal.ai** (default) | `https://fal.run/openai/gpt-image-2` | `Authorization: Key ${FAL_KEY}` | What this skill calls today via `~/.all-skills/sprite-sheet/`. |
| **OpenAI** (direct) | `https://api.openai.com/v1/images/generations` | `Authorization: Bearer ${OPENAI_API_KEY}` | Drop-in replacement; same model, slightly different request shape. |

The framework always uses `gpt-image-2` regardless of provider. Default `quality: low` for prototyping; bump to `medium` / `high` only when explicitly asked or for final art.

## Request body (fal.ai shape)

```json
{
  "prompt": "<long instruction with grid layout, row/col labels, style>",
  "image_size": { "width": 832, "height": 832 },
  "quality": "low" | "medium" | "high",
  "num_images": 1,
  "output_format": "png"
}
```

## Request body (OpenAI direct)

```json
{
  "model": "gpt-image-2",
  "prompt": "<same prompt body>",
  "size": "832x832",
  "quality": "low",
  "n": 1
}
```

Both return base64 or a URL (depending on provider/options) that the skill downloads and post-processes.

## Image size constraints

| Rule | Value |
|---|---|
| Multiples | width and height each multiple of 16 |
| Aspect ratio | `max(w,h) / min(w,h) ≤ 3.0` |
| Min pixels | `w * h ≥ 655_360` (~0.64 MP) |
| Max pixels | `w * h ≤ 8_294_400` (~8 MP) |

Auto-pick `cellPx` to satisfy. For ≤9 rows × 4 cols, cellPx 160 → image 640×1440 works.

## Quality

| Value | Cost (relative) | Use case |
|---|---|---|
| `low` | 1× | **default** — prototyping, framework iteration, every initial generation |
| `medium` | ~3× | second pass after the user accepts the layout |
| `high` | ~6× | final hero art, only on explicit request |

## Magenta backgrounds

Sprite/tile sheets ship with `bg=#FF00FF` magenta around the figures. Black backgrounds erase legitimately-dark sprite pixels (the chroma threshold `R,G,B<30` produces false positives). Magenta is unambiguous — `R>200 && G<80 && B>200` only matches the chroma key, never the sprite. Post-process via `sharp` once after download; ship transparent PNGs to Phaser.

Backgrounds (sky / level art with no transparent regions) skip the magenta key and ship full-opaque.

## Content filter

GPT Image 2 has a strict content filter. Words to avoid in prompts that have tripped it during framework iteration:

- "pained grimace", "shocked expression", "hit-flash glow" (HURT state default)
- "weapon extended", "lunging" (ATTACK state default)
- Any direct combat/violence vocabulary

The `sprite-artist` script's default state descriptions for `idle / walk / jump / cast / block / victory` are filter-safe. For damaged/attack states, prefer visual-effect-only feedback (camera shake, tint flash, alpha blink) over a dedicated sprite frame.

## Prompt template skeleton (rows × cols sprite sheet)

```
A pixel art sprite sheet on a solid bright magenta background, color #FF00FF.

The image is exactly <W> by <H> pixels, arranged as a <COLS>-column by <ROWS>-row grid of equal <cellPx> by <cellPx> cells.

Row 1: <SUBJECT_1 description>, three frames showing <state 1>, <state 2>, <state 3>.
Row 2: <SUBJECT_2 description>, three frames showing ...
...

Columns left to right: <state-1-label>, <state-2-label>, <state-3-label>.

Style rules:
- Chunky 8-bit pixel art with limited palette per character.
- No anti-aliasing on outlines.
- Strict grid alignment, no bleed between cells.
- No text, no numbers, no labels.
- Background must be exactly #FF00FF magenta everywhere outside the characters.
```

This bland phrasing has consistently passed the GPT Image 2 filter where the more dramatic upstream `~/.all-skills/sprite-sheet/` prompt template trips it.

## Common errors

| Code | Cause | Fix |
|---|---|---|
| 400 | dimension not multiple of 16 | round up |
| 400 | pixel count out of range | bump `cellPx` |
| 400 | aspect ratio > 3 | reduce rows or add cols (use a 2×2 grid for 4 items, not 1×4) |
| 401 | bad key | check `FAL_KEY` / `OPENAI_API_KEY` format |
| 422 | content_policy_violation | rewrite the prompt with neutral language |

## Why we ship via fal.ai by default

Our `~/.all-skills/sprite-sheet/` skill already wraps the fal.ai endpoint with proper magenta-background handling and grid-aware prompt construction, so the existing path is stable and reusable. Users who prefer to call OpenAI directly can swap `Authorization: Key ${FAL_KEY}` for `Authorization: Bearer ${OPENAI_API_KEY}` against `https://api.openai.com/v1/images/generations` and adjust the request shape — the same `gpt-image-2` model serves both.
