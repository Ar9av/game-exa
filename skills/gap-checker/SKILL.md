---
name: gap-checker
description: Validates that a generated game is actually playable — not just that it boots. Static analysis flags unreachable goals, oversized gaps, broken borders, and isolated regions in level data. Dynamic analysis fuzzes inputs in headless browser to detect stuck states, unreachable win conditions, and physics anomalies. Visual analysis captures screenshots for VLM (vision) review. Use after codesmith writes Game.js and playtester confirms the smoke scenarios pass.
---

# Gap Checker — Playability Validation

`playtester` checks "does it boot and respond to input." `gap-checker` checks "is the game *actually playable*" — can the player reach the goal, are there dead-end regions, do platformer jumps actually clear the gaps the architect drew?

Patterned after the **OpenGame-Bench** evaluation pipeline (Build Health + Visual Usability + Intent Alignment via headless execution + VLM judging). Static analysis covers Build Health for level structure; dynamic + visual cover Visual Usability and Intent Alignment.

## When to use

After `codesmith` and `playtester`. Always before declaring a game complete. The orchestrator should treat gap-checker failures as ordinary refinement targets, just like playtester failures — feed them to `level-fixer` (for level/world issues) or `refiner` (for code issues), iterate up to 3 times.

## Three layers

### 1. Static (`scripts/static_check.mjs`)

Pure JS, no browser. Walks `levels.json` + `gdd.json`:

| Check | What it catches |
|---|---|
| **BFS reachability** | Pickups / goals on tiles disconnected from the player's spawn region |
| **Border integrity** | Holes in the impassable outer ring → player walks off the world |
| **Standable spawns** | Platformer entities spawning in mid-air (tile below not impassable) |
| **Jump-arc gaps** | Platformer gaps wider than `2v/g × hSpeed` (max horizontal jump distance) |
| **Goal alignment** | `gdd.winCondition` references a counter the player can actually fill (every required pickup is reachable) |
| **Lethal-pit warning** | Bottomless gaps in platformers without recovery → flagged for level-fixer |
| **Spawn collision** | Two entities spawning on the same tile |

Output: structured issues per level.

```jsonc
[
  { "kind": "unreachable-pickup", "level": "1-1", "entity": "GEM", "x": 13, "y": 2, "fix": "move to (13, 9)" },
  { "kind": "gap-too-wide", "level": "1-1", "y": 8, "x1": 4, "x2": 11, "width": 7, "max": 5 },
  { "kind": "border-hole", "level": "1-1", "x": 12, "y": 0 },
  ...
]
```

### 2. Dynamic (`scripts/dynamic_check.mjs`)

Spawns the dev server, drives the game with a 30-second smart fuzzer in headless Chromium:

- Issues randomized inputs (left/right held in 200-500ms bursts, jump every 0.5-2s, action key occasionally).
- Records position, velocity, HP, win-counter every frame.
- Detects:
  - **Stuck**: position delta < 4px for 3 consecutive seconds despite input.
  - **Spawn-trap**: player took damage in first second.
  - **No-progress**: win-counter (e.g. `coinsCollected`) didn't increment in 30s of fuzzing.
  - **Out-of-bounds**: player y > worldH or x out of bounds (broken physics or fall-pit).
  - **NaN/inf state**: any numeric field in `__gameState` is NaN.
- Captures screenshots at t=0s, t=10s, t=20s, t=30s for visual review.

Output: same issue shape as static, plus screenshot paths.

### 3. Visual (host agent / VLM judge)

The host agent (you, Claude) uses its own vision capability on the captured screenshots to detect:

- Sprites rendered off-grid / clipping into walls
- Tilemap rendering glitches (missing tiles, wrong tile in slot)
- HUD obscuring gameplay area
- Background color clashes / unreadable contrast
- Camera framing — player too small, world too cropped
- Entity sprites flipped wrong direction
- Visual elements that look "broken" but pass static checks

The framework provides screenshots and the GDD/manifest; the host emits a list of issues in the same shape as static/dynamic so they feed into the same fixer pipeline.

## Process

1. Run `static_check.mjs <project-dir>` → if any issues, hand to `level-fixer` (level data) or surface (code).
2. Run `dynamic_check.mjs <project-dir>` → 30-60s, returns issues + screenshots.
3. (Optional, host-agent driven) Review screenshots, append visual issues.
4. Apply fixes via `level-fixer` (for level data) or `refiner` (for code).
5. Re-run static + dynamic.
6. If all pass: declare playable. Otherwise, iterate up to 3 times.

## Scripts

- `scripts/static_check.mjs <project-dir>` — fast static analysis, no browser.
- `scripts/dynamic_check.mjs <project-dir> [--port N] [--seconds 30]` — Playwright fuzzer + screenshots.
- `scripts/judge_visuals.mjs <project-dir>` — convenience: takes a fresh set of screenshots + emits a JSON summary the host agent can read.

## References

- `references/issue-taxonomy.md` — full list of issue kinds with examples and fix recipes.
- `references/jump-arc-math.md` — how `gap-too-wide` is computed (gravity / jump velocity / horizontal speed → max distance).
