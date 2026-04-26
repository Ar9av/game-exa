# Background themes

Default per-theme prompt templates. Plug into `generate_bg.mjs --theme <id>`.

## `outdoor-day`

```
A wide pixel art parallax background scene, daytime outdoor.

The image is exactly 1280 by 768 pixels.

A soft pastel blue sky filling the upper two thirds of the frame. A few large fluffy white pixel-art clouds drifting at different heights. Distant rolling green hills in silhouette across the lower third, layered for depth (lighter hills in back, darker hills in front). A soft gradient horizon line where the sky meets the hills.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, vivid clean colors. No characters, no foreground objects, no text, no UI, no borders. Just the sky-and-hills scenic background.
```

## `outdoor-night`

```
A wide pixel art parallax background scene, nighttime outdoor.

The image is exactly 1280 by 768 pixels.

A deep navy-blue night sky filling the upper two thirds of the frame. A large pale yellow moon high on the right side. Scattered tiny white star pixels at varied brightness across the sky. Distant rolling mountain silhouettes in dark blue-purple across the lower third, layered for depth.

8-bit retro pixel art style, chunky pixels, no anti-aliasing. No characters, no foreground objects, no text, no UI, no borders. Just the sky-and-mountains scenic background.
```

## `cave`

```
A wide pixel art parallax background scene, underground cave interior.

The image is exactly 1280 by 768 pixels.

A dark damp stone cave wall texture filling the entire frame. Subtle vertical streaks suggesting natural rock striations. A faint warm torch glow in the upper-left, fading into deeper shadow toward the right. A few cracks and small alcoves in the rock face suggesting depth.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, dim moody palette of dark grays, browns, and a hint of warm orange near the glow. No characters, no foreground objects, no text, no UI, no borders.
```

## `space`

```
A wide pixel art parallax background scene, outer space.

The image is exactly 1280 by 768 pixels.

A deep dark navy and black space backdrop. Scattered tiny star pixels at three different brightness levels distributed across the frame. One or two large soft nebula clouds in distant purples and blues, blurry and diffuse. A small distant planet silhouette on one side.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, palette of deep blues, purples, blacks, and bright white stars. No characters, no foreground objects, no text, no UI, no borders.
```

## `forest`

```
A wide pixel art parallax background scene, dense forest depths.

The image is exactly 1280 by 768 pixels.

A backdrop of overlapping tall pine and oak silhouettes layered for depth. Closer trees in dark forest green, mid-distance trees in muted teal-green, far trees fading into pale blue-green mist. Slivers of dim daylight filtering between trunks.

8-bit retro pixel art style, chunky pixels, no anti-aliasing, restful muted forest palette. No characters, no foreground objects, no text, no UI, no borders.
```

## Prompt rules (apply to every theme)

- Always state the exact pixel dimensions in the first sentence.
- Always include "no characters, no foreground objects, no text, no UI, no borders".
- Always specify "chunky pixels, no anti-aliasing".
- Always describe the palette deliberately (don't leave the model to guess colors).
- Avoid combat/peril vocabulary even for moody themes — GPT Image 2's content filter is sensitive.
