---
name: mobile-compat-checker
description: Checks 5 mobile-compatibility properties in the generated game (roundPixels, image-rendering CSS, devicePixelRatio, touch input, AudioContext unlock) and patches any missing items. Run after codesmith, before playtester.
---

# Mobile Compat Checker — 5-Item Lint

Generated games are desktop-only by default. This skill checks and patches 5 properties that make or break mobile playability. Each item is a 1-2 line change; the refiner is overkill for these.

## When to use

After codesmith, before playtester. Re-run after any refiner pass that touches config.js or index.html.

## The 5 checks

### 1. `roundPixels: true` in Phaser config (`src/config.js`)
Without it, sub-pixel rendering blurs pixel art on Retina displays.

```js
// config.js should contain:
roundPixels: true,
```

### 2. `image-rendering: pixelated` on `<canvas>` (`index.html`)
Without it, the browser bilinear-filters the upscaled canvas, making pixel art look blurry even when the canvas is sharp.

```css
/* index.html should contain: */
canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
```

### 3. `devicePixelRatio` canvas sizing (`src/config.js` or `index.html`)
Without it, games render at CSS resolution instead of physical pixels, halving effective sharpness on Retina.

```js
// config.js should contain:
zoom: Math.floor(Math.min(window.innerWidth, window.innerHeight) / 240) || 1,
// or explicit devicePixelRatio scaling
```

### 4. Touch / virtual d-pad input (`src/scenes/Game.js`)
Without it, mobile players have no control at all. Minimum: four directional buttons and one action button.

Acceptable patterns:
- `this.input.addPointer(2)` (multi-touch)
- `this.add.zone(...)` based virtual d-pad
- `this.input.on('pointerdown', ...)` with directional zones

### 5. `AudioContext` unlock on user gesture
Safari iOS suspends `AudioContext` until a tap or keydown event. Any audio that auto-plays on create() will fail silently.

Acceptable patterns:
- `AudioManager.init(this)` from the audio-composer skill (handles this)
- `this.input.once('pointerdown', () => audioCtx.resume())`
- Any call to `.resume()` inside a pointer/keyboard event handler

## Output contract

```jsonc
{
  "ok": false,
  "checks": [
    { "id": "roundPixels",          "pass": true,  "file": "src/config.js" },
    { "id": "image-rendering",      "pass": false, "file": "index.html",    "fix": "add canvas CSS" },
    { "id": "devicePixelRatio",     "pass": true,  "file": "src/config.js" },
    { "id": "touch-input",          "pass": false, "file": "src/scenes/Game.js", "fix": "add virtual d-pad" },
    { "id": "audio-context-unlock", "pass": true,  "file": "src/audio/AudioManager.js" }
  ],
  "failCount": 2
}
```

## Auto-patch mode (`--fix`)

Patches checks 1, 2, and 3 automatically (mechanical text changes). Checks 4 and 5 are flagged for codesmith / refiner since they require game-aware positioning.

- Check 2 fix: appends `canvas { image-rendering: pixelated; image-rendering: crisp-edges; }` to the `<style>` block in index.html.
- Check 1 fix: adds `roundPixels: true,` after `pixelArt: true,` in config.js.
- Check 3 fix: wraps canvas `width`/`height` with `Math.floor(... * (window.devicePixelRatio || 1))` and adds CSS size properties.

## Process

1. Run `scripts/check_mobile.mjs <project-dir>` after codesmith.
2. With `--fix`: auto-patches checks 1, 2, 3; reports 4 and 5 as manual items.
3. Feed check 4 and 5 failures to refiner as `mobile-missing-touch` and `mobile-no-audio-unlock`.

## Scripts

- `scripts/check_mobile.mjs <project-dir> [--fix]` — lint and optionally patch.
