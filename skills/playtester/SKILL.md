---
name: playtester
description: Boots a generated Phaser game in headless Chromium (Playwright), drives input scenarios, captures canvas screenshots, diffs against baselines (pixelmatch), and emits a structured QA report with typed failures. Pure deterministic — no LLM. Use after codesmith writes Game.js, before refiner.
---

# Playtester

Headless QA harness. Boots, drives, captures, diffs, asserts. Emits structured failures the refiner can act on.

## When to use

After every codesmith / refiner write. Always before declaring a game complete.

## Output contract — `qa/qa-report.json`

```jsonc
{
  "ts": "<ISO>",
  "url": "<dev server url>",
  "passed": <bool>,
  "scenarios": [
    {
      "scenario": "boot",
      "observations": { "blank": false, "fps": 60, "booted": true, "activeScenes": ["Game"], "gameState": {...} },
      "diff": { "status": "pass" | "fail" | "recorded", "ratio": <0..1>, "mismatched": <int> }
    }
  ],
  "failures": [
    { "scenario": "<name>", "kind": "<failure-kind>", "message": "<human-readable>" }
  ]
}
```

Failure kinds: `boot-timeout`, `exception`, `console-error`, `screenshot-diff`, `low-fps`, `blank-canvas`, `no-movement`, `no-jump`, `scenario-crash`.

## Default scenarios

| Name | Inputs | Asserts | Applies to |
|---|---|---|---|
| `boot` | (waits 60 frames) | Game scene active, fps ≥ 25, canvas non-blank, no errors | always |
| `walk-right` | hold `ArrowRight` 600ms | playerX delta > 0 | always |
| `walk-down` | hold `ArrowDown` 600ms | playerY delta > 0 | non-platformer |
| `jump` | press `Space` (held 50ms) | playerY drops then recovers | platformer |
| `attack` | press `Space` (held 50ms) | no exceptions | when GDD has attack/fire/shoot action |

`appliesTo(gdd)` filter on each scenario picks the relevant subset for the genre.

## Screenshot diff

- Engine: Playwright `page.locator('canvas').screenshot()` → pixelmatch
- Threshold: `0.1` YIQ delta per pixel; 5% pixel-ratio cap
- Baselines: `qa/__baselines__/<scenario>.png`. First run with no baseline → `recorded` (counts as pass).
- Update baselines: `--update-baselines` overwrites and returns `recorded`.

## Process

1. Read `game-state.json` to get GDD (for scenario filtering).
2. Spawn dev server (`vite`) on a free port; wait for `Local: http://...` (ANSI-stripped).
3. Launch headless Chromium (system Chrome via `channel: 'chrome'`, fallback to bundled).
4. `goto(url)`. Wait for `window.__gameReady === true && Game scene status === 5`.
5. Focus canvas (Phaser keyboard target).
6. For each applicable scenario: register error listeners, run, snapshot, diff, run assertions.
7. Write `qa/qa-report.json`.
8. Append report to `state.qa[]` (keep last 5).
9. Kill dev server.
10. Exit code: `0` if `passed`, else `5`.

## Filtering noise

Console messages matching `/Failed to load resource:.*404|favicon\.ico|\[vite\]/` are NOT counted as errors (browser noise unrelated to game logic).

## Custom scenarios

To add a scenario, append to `references/scenarios.md` and register in the runner. Scenario shape:

```js
{
  name: '<id>',
  description: '<one line>',
  appliesTo: (gdd) => bool,           // optional
  async run({ page, log }) {
    // do stuff with page.keyboard, page.mouse, page.evaluate
    return { observations: {...}, screenshot?: <Buffer> };
  }
}
```

## VLM intent alignment pass

After the pixelmatch scenarios pass, run a second QA pass that uses Claude Haiku to judge whether the screenshot visually matches the original description:

```bash
node scripts/intent_qa.mjs <project-dir>
# Uses the boot scenario baseline screenshot by default.
# Requires ANTHROPIC_API_KEY in env.
```

Returns a score 0–10. Threshold: ≥ 6 = pass. Issues found by the VLM are appended to `qa/qa-report.json` as `intent-mismatch` failures for the refiner to act on.

The VLM checks: genre feel, player visibility, world rendering, entity presence. It does NOT check mechanics — only visual intent.

Integrate into the full pipeline:
```bash
node scripts/run_qa.mjs <project-dir> && node scripts/intent_qa.mjs <project-dir>
```

## Scripts

- `scripts/run_qa.mjs <project-dir> [--url URL] [--update-baselines]` — the full runner.
- `scripts/boot_check.mjs <project-dir> [--port N]` — minimal smoke (just `boot` scenario).
- `scripts/diff_one.mjs <baseline.png> <actual.png> [--out diff.png]` — ad-hoc diff utility.
- `scripts/intent_qa.mjs <project-dir> [--screenshot path]` — VLM intent alignment pass.

## References

- `references/scenarios.md` — full scenario catalog with code samples.
- `references/baseline-workflow.md` — when to update baselines, what's in them, gitignore conventions.
- `references/known-noise.md` — patterns of browser console noise we filter.

## Dependencies

- `playwright` — browser automation (uses system Chrome via `channel: 'chrome'` to skip 170MB Chromium download).
- `pixelmatch` + `pngjs` — pure-JS diff.
- Generated game must have `phaser` + `vite` installed (handled by `scripts/init_project.mjs`).
