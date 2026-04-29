---
name: physics-debug-validator
description: Boots the generated game in headless Chromium with physics debug mode enabled, captures screenshots of all physics bodies, and emits a structured report of hitbox positions vs sprite positions. Use this to catch invisible hitbox misalignment bugs that only appear visually. Run in parallel with the other QA checks.
---

# Physics Debug Validator — Hitbox Alignment

The single most invisible class of AI-generated game bugs: physics bodies that are offset, undersized, or oversized relative to their visual sprites. The player gets hit by an attack that visually missed, or falls through a platform that looks solid. This validator catches all of it.

## When to use

In parallel with `dynamic_check.mjs` and `run_qa.mjs` during the parallel-qa-orchestra pass. Also run standalone when the user reports "hitboxes feel wrong" or "invisible collision."

## Method

1. Boot the game in Playwright with a JS init script that enables `physics.arcade.debug = true` on the live Phaser game object (no source-file modification needed).
2. Wait for `window.__gameReady`.
3. Capture a canvas screenshot — physics debug mode draws colored rectangles around every body.
4. Also capture body metadata via `page.evaluate()` reading `window.__game.physics.world.bodies.entries`.
5. Emit a JSON report with body positions, sizes, and their paired sprite positions.
6. The host agent (or Claude vision) reviews the screenshot to flag misaligned bodies.

## Output contract

```jsonc
{
  "ok": true,
  "screenshotPath": "qa/physics-debug.png",
  "bodies": [
    {
      "label": "KNIGHT",
      "bodyX": 160, "bodyY": 288, "bodyW": 22, "bodyH": 27,
      "spriteX": 160, "spriteY": 288, "spriteW": 32, "spriteH": 32,
      "offsetX": 0, "offsetY": 0,
      "aligned": true
    },
    {
      "label": "SLIME",
      "bodyX": 480, "bodyY": 144, "bodyW": 32, "bodyH": 32,
      "spriteX": 480, "spriteY": 132, "spriteW": 32, "spriteH": 32,
      "offsetY": 12,
      "aligned": false,
      "issue": "body Y offset 12px below sprite top — may clip floor tile"
    }
  ],
  "misalignedCount": 1
}
```

`ok = true` means the script ran successfully (not necessarily zero issues — the host agent reviews body data to determine severity).

## Physics debug injection (no source modification)

The script uses `page.addInitScript()` to patch the Phaser Game constructor before it runs:

```js
await page.addInitScript(() => {
  const _Game = window.Phaser?.Game;
  // Patch applied after Phaser loads via window.__patchPhysicsDebug flag
  window.__patchPhysicsDebug = true;
});
// After gameReady, toggle debug on live game:
await page.evaluate(() => {
  if (window.__game?.physics?.world) {
    window.__game.physics.world.drawDebug = true;
    window.__game.physics.world.debugGraphic?.clear?.();
  }
});
```

## Known limitations

- Debug rectangles are rendered on a graphics layer; they may not perfectly align with the Phaser camera if the camera is scrolled. The script waits for the player to settle at spawn before screenshotting.
- Kinematic bodies (sensors, fixed) show in a different color (typically cyan vs green for dynamic).
- The host agent should look for bodies where the colored rectangle is significantly (> 20%) outside the visible sprite boundary.

## Process

1. Run `scripts/validate_physics.mjs <project-dir> [--port N]`
2. Script starts vite dev server on the given port (default: auto-find free port).
3. Playwright boots game, injects debug, screenshots.
4. Script writes `qa/physics-debug.png` + `qa/physics-bodies.json`.
5. Host agent reviews both artifacts. Misaligned bodies are fed to refiner as `hitbox-misaligned` failures.

## Scripts

- `scripts/validate_physics.mjs <project-dir> [--port N]` — boots, injects debug, screenshots, emits body report.
