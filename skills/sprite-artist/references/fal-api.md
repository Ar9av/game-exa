# fal.ai GPT-Image-2 quick reference

Used by `sprite-artist` in image-generation mode. Wraps the existing `~/.all-skills/sprite-sheet/` skill which calls this endpoint.

## Endpoint

```
POST https://fal.run/openai/gpt-image-2
Authorization: Key ${FAL_KEY}
Content-Type: application/json
```

## Request body

```json
{
  "prompt": "<long instruction with grid layout, row/col labels, style>",
  "image_size": { "width": 640, "height": 1440 },
  "quality": "low" | "medium" | "high",
  "num_images": 1,
  "output_format": "png"
}
```

## `image_size` constraints

| Rule | Constraint |
|---|---|
| Multiples | `width % 16 === 0 && height % 16 === 0` |
| Aspect ratio | `max(w,h) / min(w,h) <= 3.0` |
| Min pixels | `w * h >= 655_360` (~0.64MP) |
| Max pixels | `w * h <= 8_294_400` (~8MP) |

If grid violates → bump `cellPx` until satisfied. Default `cellPx = 160` works for ≤9 rows × 4 cols.

## `quality` cost

| Value | Cost (relative) | Use case |
|---|---|---|
| `low` | 1× | prototyping, QA iteration |
| `medium` | 3× | production assets |
| `high` | 6× | final hero art |

`sprite-artist` defaults to `low`. Override per call with `--quality medium`.

## Response

```json
{ "images": [{ "url": "https://..." }] }
```

The skill downloads the URL into `public/assets/<sheet>.png`, then runs the chroma key.

## Common errors

| Code | Cause | Fix |
|---|---|---|
| 400 | dimension not multiple of 16 | round up to 16 |
| 400 | pixel count out of range | bump cellPx |
| 400 | aspect ratio > 3 | reduce rows or add cols |
| 401 | bad FAL_KEY format | format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:<32 hex chars>` |

## Why magenta backgrounds

Black backgrounds erase legitimately-dark sprite pixels (the chroma-key threshold `R,G,B<30` produces false positives). Magenta `#FF00FF` is unambiguous — `R>200 && G<80 && B>200` only matches the chroma key, never the sprite. Post-process via `sharp` once after download; ship transparent PNGs to Phaser.

## Prompt template skeleton

```
A complete pixel-art sprite sheet for a <STYLE> game. Pure solid bright magenta background (#FF00FF) — every pixel outside sprite characters must be exactly #FF00FF.

The image is exactly <W>×<H> pixels arranged as a <COLS>-column × <ROWS>-row grid of equal cells (each cell is <cellPx>×<cellPx> pixels).

COLUMNS — <COLS> animation states, left to right:
  Column 1 (IDLE):    Neutral standing pose, slight downward bob, eyes open, arms at sides.
  Column 2 (WALK):    Mid-stride stepping pose, body leaning slightly forward, one limb extended.
  Column 3 (ATTACK):  Aggressive lunging pose, mouth wide or weapon extended.
  Column 4 (HURT):    Recoiling pose, body tilted back, pained grimace, hit-flash glow.

ROWS — <N> distinct subjects, top to bottom:
  Row 1 — KNIGHT (blue): A small blue knight with a silver sword.
  Row 2 — SLIME (green): A round green slime that wobbles.
  ...

Global style rules:
- Consistent retro pixel-art across the entire sheet (chunky outlines, limited palette per character, no anti-aliasing)
- Each subject has its own vivid recognizable color scheme, consistent across all <COLS> states
- All sprites centered in their cell with a few pixels of magenta breathing room
- Strict grid alignment, no overflow or bleed between cells
- No text, numbers, labels, UI chrome, or watermarks
- Background MUST be exactly #FF00FF — no gradients, no shadows, no anti-aliased edges bleeding
```
