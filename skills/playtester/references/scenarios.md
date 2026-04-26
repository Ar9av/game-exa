# Playtester scenarios

Each scenario is a `{ name, description, run, appliesTo? }` object registered in `src/qa/scenarios.js`. The runner picks applicable scenarios for the GDD's genre and runs them in order.

## Default scenarios

### `boot`
- **Inputs**: none
- **Asserts**: scene-ready fired, fps ≥ 25, canvas non-blank, no console errors
- **Screenshot**: yes, after 60 frames of warmup
- **Applies to**: every genre

### `walk-right`
- **Inputs**: hold ArrowRight 600ms
- **Asserts**: `playerX` strictly greater after than before
- **Screenshot**: yes
- **Applies to**: every genre

### `walk-down`
- **Inputs**: hold ArrowDown 600ms
- **Asserts**: `playerY` strictly greater after than before
- **Screenshot**: no (movement-only check)
- **Applies to**: non-platformer (`gdd.controls.movement !== 'platformer'`)

### `jump`
- **Inputs**: press Space (held 50ms)
- **Asserts**: `playerY` lower at apex (150ms after press) than before
- **Applies to**: platformer (`gdd.controls.movement === 'platformer'`)

### `attack`
- **Inputs**: press Space
- **Asserts**: no exceptions raised
- **Applies to**: GDDs with an action whose name matches `/attack|fire|shoot/i`

## Adding a scenario

```js
// src/qa/scenarios.js
{
  name: 'reach-edge',
  description: 'Hold Right for 3 seconds, expect player.x > level.width - tileSize.',
  appliesTo: (gdd) => gdd.genre === 'platformer',
  async run({ page }) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowRight');
    const obs = await page.evaluate(() => window.__gameState);
    return { observations: { playerX: obs.playerX } };
  }
}
```

Add a matching assertion in `src/qa/runner.js`:

```js
if (sc.name === 'reach-edge' && (o.playerX ?? 0) < EXPECTED) {
  failures.push({ scenario: sc.name, kind: 'no-edge-reach', message: `playerX=${o.playerX}` });
}
```

## Why hold 50ms minimum

Phaser's update loop runs at ~16ms. Playwright's `keyboard.press(key)` is sub-millisecond — the keydown/keyup pair completes between two Phaser ticks, and `key.isDown` polling never sees `true`. Holding for 50ms covers 3 update frames; `JustDown` registers reliably at any hold duration, but `isDown` only registers when held ≥ ~16ms.

## Screenshot diff settings

- **Engine**: pixelmatch via `runQA`
- **Threshold**: 0.1 YIQ delta per pixel (anti-alias tolerant)
- **Pixel-ratio cap**: 5% of total pixels
- **Baseline path**: `qa/__baselines__/<scenario>.png`
- **Update**: `--update-baselines` overwrites; first-run with no baseline records.

## Determinism notes

The Phaser config has `seed: ['gameforge']`, which makes `Phaser.Math.RND.*` reproducible. Free-running animations and physics with `forceSetTimeOut: false` introduce tiny per-pixel variance (~0.3% of pixels typical) which is well under the 5% cap. Higher-fidelity baselines would require pausing the game (`game.loop.sleep()`) before snapshotting; that's available in `harness.js#freezeGame` if needed.
