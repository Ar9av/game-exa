# game-exa architecture

## Design principles

**Deterministic where possible, LLM where necessary.** The pipeline has four LLM-driven steps (designer, architect, codesmith, refiner) and three deterministic ones (sprites, tilesets, QA). The deterministic parts are pure functions of their inputs — they never need a "vibes" pass and they never burn API tokens. Iterating on the framework rarely re-invokes the LLM agents.

**Agents are functions over a shared state file.** Every command reads `game-state.json` at the project root, mutates it, and writes it back. The file is the contract between stages, between the framework and the runtime, and across reruns. There's no hidden in-memory state passed between agents.

**The Phaser runtime is dumb.** `Boot` and `Preload` are fixed across every generated game. They load `assets/manifest.json` + `data/levels.json` and build animations from row/col labels — `<ENTITY_ID>-<state>` (e.g. `KNIGHT-walk`). The codesmith-written `Game.js` only ever references things by name; row indexes are looked up at runtime via `manifest.sprites[i].rows.indexOf("KNIGHT")`. No magic numbers.

**QA failures are structured.** The runner emits objects like `{ scenario: "jump", kind: "no-jump", message: "Space pressed but jumpDelta=0" }`. The refiner agent receives the structured list, not screenshots-with-vibes. This makes refinement bounded and debuggable — and lets us assert specific framework gaps in tests.

## Why these dependencies

| Dep | Why |
|---|---|
| Phaser 3 (3.85+) | Canvas/WebGL, `pixelArt: true` flag handles all anti-aliasing concerns, FIT scale mode for any resolution, RandomDataGenerator for seeded determinism. Already had every primitive we needed. |
| Vite | Zero-config dev server with HMR, `base: './'` for portable builds. Phaser ships an official Vite template, which is the 2024+ idiom. |
| Playwright | Auto-waiting, `expect(page).toHaveScreenshot()` paradigm, cleanly handles `--use-gl=swiftshader` for headless WebGL. Picks up system Chrome via `channel: 'chrome'` to skip the 170MB bundled Chromium download on dev machines. |
| pixelmatch + pngjs | What Playwright uses internally. Pure JS, anti-alias-aware via `includeAA: false`, returns a diff image. Faster than `looks-same`, more portable than `odiff` (which ships native binaries). |
| sharp | Magenta→alpha post-processing in <100ms per sheet. Same library used to paint procedural tilesets and placeholder sprites. |
| commander | Stable, ESM-first, ~50KB, what `create-vite` and `vercel` use. yargs is heavier; cac/citty have thinner ecosystems. |
| @clack/prompts | Best-in-class TUI prompts, used by `create-astro`. ESM-only. |
| consola | Single dep replaces `chalk`+`ora`+`pino` for a CLI's needs; has a JSON reporter for `--json` mode. |
| Anthropic SDK | System-prompt caching (5min TTL) makes the per-pipeline cost cheap when designer + architect + codesmith + refiner share the same task framing. |

## QA scenario contract

Every scenario is `{ name, description, run(ctx), appliesTo? }`. `run` returns `{ observations, screenshot? }`. The runner:

1. Runs the scenario.
2. Diffs the screenshot against `qa/__baselines__/<name>.png` (pixelmatch, 0.1 YIQ threshold, 5% pixel ratio cap).
3. Fires assertions on observations: fps ≥ 25, canvas not blank, expected delta on movement scenarios.
4. Collates structured failures.

`appliesTo(gdd)` filters out irrelevant scenarios — `walk-down` is skipped for platformers, `jump` is skipped for top-down, `attack` is skipped if no action key matches `attack|fire|shoot`.

Adding a scenario is one entry in `src/qa/scenarios.js`. No code-gen change required.

## Why magenta backgrounds

**GPT Image 2** (`gpt-image-2`) emits sprites on solid backgrounds. Black backgrounds erase legitimately-dark sprite pixels (R,G,B<30 false positives). Magenta (#FF00FF) is unambiguous — `R>200 && G<80 && B>200` only matches the chroma key, never the sprite. We post-process magenta→alpha once via `sharp` and ship transparent PNGs to Phaser. Doing this at runtime in Phaser is a non-starter (per-pixel iteration on every reload).

## Failure modes the framework already handles

- **`pressKey` faster than Phaser update tick** → `pressKey` holds 50ms by default (covers 3 frames). Discovered while testing the platformer's jump scenario.
- **Vite ANSI in captured stdout** → ready-detection regex strips `\x1b[..m` before matching.
- **Stale port from previous run** → server.kill returns a promise that waits for SIGTERM, escalates to SIGKILL after 2s.
- **Favicon 404 leaking into "errors"** → harness drops console errors matching `Failed to load resource:.*404`, `favicon.ico`, `[vite]`.
- **Empty manifest at boot** → Preload tolerates `manifest.sprites = []` so the placeholder Game.js boots after `init` and before `generate`.

## What's deliberately not in v0

- Audio (no music, no SFX, no audio in the GDD schema).
- Multi-scene UI overlays (HUD is in-Game, not a separate scene).
- Save/load.
- Custom shaders.
- Mobile/touch input.
- Tile maps designed in Tiled (we use JSON 2D arrays, agent-friendly).
- Multiple parallel-running agent workers (everything is serial in v0; the QA → refiner loop is serial too).
