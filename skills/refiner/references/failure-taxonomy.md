# Failure taxonomy

The playtester emits structured failures the refiner reads. This is the canonical list — every new failure kind goes here with a recipe.

## `boot-timeout`

**Symptom**: `window.__gameReady` never became true within 15s.
**Likely causes**: missing `events.emit('scene-ready')`, asset 404, runtime exception during preload.
**Fix recipe**:
1. Add `this.events.emit('scene-ready')` at the very end of `create()`.
2. Verify asset paths in manifest match files on disk.
3. Check the page's console errors for an exception that aborted preload.

## `exception`

**Symptom**: Uncaught JS exception in the page.
**Fix recipe**: Read the message, locate the file/line, fix the bug. Common: typo in animation key, accessing `.body` of an undefined sprite, missing `import`.

## `console-error`

**Symptom**: Console message at `error` level.
**Filter**: 404s for favicon, vite HMR connecting messages, and resource-load 404s are filtered upstream.
**Fix recipe**: For `Animation key '<X>' is missing`, cross-check the manifest. For `Cannot read property of undefined`, add a defensive check or fix the data flow.

## `screenshot-diff`

**Symptom**: Pixel-ratio difference > 5% vs baseline.
**Fix recipe**:
1. Inspect `qa/__diffs__/<scenario>.png` to see what changed.
2. If the change is intentional (e.g. you rebuilt sprites), rerun with `--update-baselines`.
3. If unintentional, inspect the actual rendering for regressions: missing layer, wrong tileset, sprite displaced, etc.

## `low-fps`

**Symptom**: `actualFps < 25`.
**Fix recipe**:
1. Cull off-screen objects. Bullets and particles especially must `.destroy()` when out of bounds.
2. Reduce active animation count. Static pickups can use single-frame animations or no animation.
3. Check for runaway groups (creating sprites in `update()` without limits).

## `blank-canvas`

**Symptom**: Center pixel of the WebGL canvas is fully black + transparent.
**Fix recipe**: Tilemap layer not created or not visible. Check `pixelArt: true` in config; check layer's depth; check camera bounds.

## `no-movement` (walk-right/walk-down)

**Symptom**: Player position didn't change after holding direction key.
**Fix recipe**:
1. Verify spawn is on a passable tile. Check `level.tiles[spawn.y][spawn.x]` and `palette[that].passable === true`.
2. Verify physics body is set up: `this.physics.add.sprite(...)` (not `this.add.sprite`).
3. Verify input wiring: `cursors`, `keys.A`, etc.
4. Verify body size doesn't extend into walls (use `0.6-0.7` of tile size).
5. Check world bounds aren't blocking — `setCollideWorldBounds(true)` should not prevent ground-level movement.

## `no-jump`

**Symptom**: Space pressed but player didn't move up.
**Fix recipe** (in priority order):
1. **Use `Phaser.Input.Keyboard.JustDown(SPACE)` not `SPACE.isDown`** — single keypresses can be sub-frame.
2. Verify gravity is set: `this.physics.world.gravity.set(0, 600)` in `create()`.
3. Verify `body.blocked.down` is true at rest (player must be on solid tile).
4. Verify jump velocity is high enough vs gravity: `setVelocityY(-330)` with gravity 600 gives a jump of ~90 px.

## `scenario-crash`

**Symptom**: The scenario itself threw (not the game).
**Fix recipe**: Usually means a Playwright API call failed or a `page.evaluate(() => …)` script errored. Check the message; this is typically a harness bug not a game bug.

## Bounded retries

After **3 refiner iterations** without `passed: true`, the orchestrator halts and surfaces the persistent failures. Don't loop indefinitely — surface and let the user decide.
