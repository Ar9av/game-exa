---
name: bg-artist
description: Generates a parallax background image (sky, hills, cave interior, space, etc.) for a Phaser game using GPT Image 2 (gpt-image-2). The Phaser runtime treats this as an optional layer that scrolls slower than the world, providing depth without consuming gameplay collision. Use after game-designer if the genre benefits from a scenic backdrop.
---

# Background Artist

Generates a single PNG that the Phaser runtime renders behind the tilemap with a `scrollFactor < 1` for parallax. Pure deterministic helper plus one GPT Image 2 call.

## When to use

After `game-designer` produces a GDD. Whenever the genre + theme benefit from a backdrop:
- platformer / dungeon-crawler / shoot-em-up: yes (sky, cave, space)
- top-down-adventure: usually no (the tilemap fills the view)
- puzzle / abstract: optional

The orchestrator decides; the skill exposes the deterministic call.

## Output

- `public/assets/bg.png` — single image, no transparency
- Manifest field merged into `public/assets/manifest.json`:

```jsonc
{
  "bg": {
    "relPath":      "assets/bg.png",
    "scrollFactor": 0.3                       // 0 = locked to camera, 1 = locked to world; ~0.2-0.4 = subtle parallax
  }
}
```

The Phaser template's `Preload` scene loads `bg` automatically when this manifest field is present. `Game.js` adds it as `add.image(...).setDepth(-100)` and applies the `scrollFactor`.

## Default themes

| Genre | Theme | Prompt skeleton |
|---|---|---|
| platformer | outdoor-day | Soft pastel sky, fluffy clouds, distant green hills in silhouette layered for depth |
| platformer | outdoor-night | Deep blue night sky, large moon, mountains silhouetted, subtle stars |
| dungeon-crawler | cave | Damp stone cave wall texture, faint torch glow, distant cracks suggesting depth |
| shoot-em-up | space | Deep dark blue-black space, scattered stars at varied brightness, 1-2 distant nebula clouds |
| top-down-adventure | (none — uses tilemap fill) | n/a |

## Process

1. Read `gdd.genre` and `levelHints.themes[0]` from `game-state.json`.
2. Pick a prompt template (above) and fill in the theme.
3. POST to GPT Image 2 with `quality: low`, dimensions ~1280×768 (16:10, well within FAL/OpenAI constraints).
4. Downscale to ~480×288 with sharp using `kernel: 'nearest'` to preserve pixel-art crispness.
5. Save to `public/assets/bg.png`.
6. Merge `bg` field into `manifest.json`.
7. Update `game-state.json` `assets.bg` reference.

## Hard rules for prompts

- Always 8-bit pixel art style, chunky pixels, no anti-aliasing.
- No characters, no foreground objects, no text, no UI, no borders. The bg is a backdrop only.
- Vivid clean colors that complement the player sprite without competing.
- Aspect ratio close to 16:10 or 16:9; avoids the 3:1 cap.

## Scripts

- `scripts/generate_bg.mjs <project-dir> [--theme outdoor-day|outdoor-night|cave|space] [--quality low|medium|high]`

## References

- `references/themes.md` — full per-theme prompt templates
- `../sprite-artist/references/gpt-image-2.md` — endpoint/auth/constraints (shared with sprite-artist)

## Why parallax instead of a static fill

A `scrollFactor: 0` background is fine but feels "stuck on" to the camera. `0.2-0.4` makes the world feel deeper as the camera moves — clouds appear to drift relative to terrain — for free. The trade-off: with very large levels the bg image has to tile or stretch; we stretch via `setDisplaySize(worldW, worldH)` which works well for short levels and acceptably for longer ones.
