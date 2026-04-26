---
name: bg-artist
description: Generates a parallax background image (sky, hills, cave interior, space, etc.) for a Phaser game using GPT Image 2 (gpt-image-2). The Phaser runtime treats this as an optional layer that scrolls slower than the world, providing depth without consuming gameplay collision. Use after game-designer if the genre benefits from a scenic backdrop.
---

# Background Artist

Generates a single PNG that the Phaser runtime renders behind the tilemap with a `scrollFactor < 1` for parallax. Pure deterministic helper plus one GPT Image 2 call.

## When to use

After `game-designer` produces a GDD. Whenever the genre + theme benefit from a backdrop:
- platformer / action-platformer / dungeon-crawler / shoot-em-up: yes (sky, cave, space)
- beat-em-up: yes — layered street/park/forest background is essential for visual quality
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
| platformer / action-platformer | outdoor-day | Soft pastel sky, fluffy clouds, distant green rolling hills silhouetted in 3 depth layers |
| platformer / action-platformer | outdoor-night | Deep blue night sky, large full moon, mountain range silhouetted in 2 layers, scattered stars |
| action-platformer | dungeon | Dark damp stone dungeon interior, crumbling brick walls receding into shadows, faint torch glow on side walls, no characters |
| dungeon-crawler | cave | Rough cave walls with stalactites, faint bioluminescent moss patches, distant dark tunnel, atmospheric blue-green tint |
| shoot-em-up | space | Deep blue-black space, star field with 3 brightness levels, 1-2 colourful distant nebulae, no planets in foreground |
| beat-em-up | forest-park | 3 depth layers: far = muted blue-grey sky + canopy silhouettes; mid = orange-brown tree trunks + fence; near = dirt ground strip. NES Double Dragon color palette. No characters or UI. |
| beat-em-up | city-street | Far = dark grey building facades with lit windows; mid = parked cars / dumpsters silhouetted; near = sidewalk strip. Urban night palette. |
| beat-em-up | warehouse | Industrial brick walls with high windows; dim overhead light pools; stacked crates silhouetted in mid distance. |
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
