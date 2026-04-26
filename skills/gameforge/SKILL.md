---
name: gameforge
description: Orchestrator skill that turns a one-line description into a runnable Phaser 3 game. Coordinates seven sub-skills (game-designer, world-architect, sprite-artist, tile-artist, codesmith, playtester, refiner) into a deterministic-where-possible, LLM-where-necessary pipeline. Use when the user wants to generate, refine, or test a 2D HTML5 game from natural language.
---

# Gameforge — Game Generation Orchestrator

Drives the full game-creation pipeline. The host agent (you) is the one calling LLM-bearing sub-skills; this skill describes the pipeline shape, the shared state file, validation gates, and halt conditions.

## When to use

- "Make me a game where …"
- "Generate a Phaser game called …"
- "Refine the QA failures from the last run"
- Any request involving an 8-bit / pixel-art / 2D HTML5 game described in natural language

## Pipeline

```
description ─▶ game-designer ─▶ world-architect ─▶ sprite-artist ┐
                                                  tile-artist    ├─▶ codesmith ─▶ playtester ─▶ refiner ─▶ playtester
                                                                  ┘                                ▲
                                                                                                   │ (bounded retry, max 3)
```

1. **game-designer** turns prompt → `gdd.json` (GDD JSON).
2. **world-architect** turns GDD → `levels.json` (tile-based level layouts).
3. **sprite-artist** turns GDD entities → sprite sheets + manifest (run in parallel with tile-artist).
4. **tile-artist** turns GDD tile palette → `tiles.png` + tile metadata.
5. **codesmith** turns GDD + levels + manifest → `src/scenes/Game.js` (and optional helpers).
6. **playtester** boots the game, runs scenarios, captures screenshots, diffs against baselines, returns structured failures.
7. **refiner** consumes failures + current source → patched files. Loop back to playtester. Cap at 3 iterations.

Stages 3 and 4 are deterministic helpers (no LLM). Stages 1, 2, 5, 7 are LLM-driven via host-agent reasoning. Stage 6 is deterministic.

## Shared state — `game-state.json`

Single source of truth at the project root. Every sub-skill reads/writes it. Schema:

```jsonc
{
  "version": 1,
  "name": "<project-name>",
  "prompt": "<original user description>",
  "genre": "top-down-adventure | platformer | shoot-em-up | puzzle | dungeon-crawler",
  "createdAt": "<ISO timestamp>",
  "gdd":     <output from game-designer or null>,
  "levels":  [<output from world-architect>],
  "assets": {
    "sprites": [<manifest entries from sprite-artist>],
    "tiles":   <manifest from tile-artist or null>
  },
  "code":  { "entryPoint": "src/main.js", "scenes": ["Boot","Preload","Game"] },
  "qa":    [<last 5 reports from playtester>]
}
```

Validate with `scripts/validate_state.mjs <project-dir>` after every mutation. Reject any change that breaks the schema.

## Project layout (per generated game)

```
<project>/
├── game-state.json           # shared state
├── package.json              # phaser + vite
├── vite.config.mjs
├── index.html
├── public/
│   ├── assets/
│   │   ├── entities.png      # from sprite-artist (one or more)
│   │   ├── tiles.png         # from tile-artist
│   │   └── manifest.json     # row/col labels per sheet
│   └── data/
│       └── levels.json       # from world-architect
└── src/
    ├── main.js               # Phaser bootstrap (template, never edit)
    ├── config.js             # game config: pixelArt, FIT, RND seed
    └── scenes/
        ├── Boot.js           # template, never edit
        ├── Preload.js        # builds anims from manifest, never edit
        └── Game.js           # codesmith-written
```

`Boot.js` and `Preload.js` are **fixed across every game** — they read manifest.json, build animations as `<ENTITY_ID>-<state>` (lowercased state), and stash levels + manifest on `this.registry`. Codesmith's Game.js consumes by name only.

## Animation key convention

Every animation is `<ENTITY_ID>-<state-lowercase>`, e.g. `KNIGHT-walk`, `SLIME-hurt`, `BULLET-idle`. Frame index = `row * cols + col`, where row is the entity's index in the sheet's `rows[]` and col is the state's index in the sheet's `cols[]`. Codesmith MUST look these up via the manifest, never hard-code.

## Workflow when invoked

### Path A — fresh project from a description

1. Ask user for project name (or accept arg). Run `scripts/init_project.mjs <name>` to scaffold.
2. Invoke **game-designer** with the user's description. Save GDD into `game-state.json`. Validate.
3. Invoke **world-architect** with the GDD. Save levels. Validate.
4. Invoke **sprite-artist** (with `--placeholder` for fast/free iteration, or full FAL mode). Writes sheets + updates manifest.
5. Invoke **tile-artist** with the palette. Writes `tiles.png` + manifest.
6. Write `public/assets/manifest.json` and `public/data/levels.json` from state.
7. Invoke **codesmith** with GDD + levels + manifest. Writes `src/scenes/Game.js` (and optional helpers under `src/`).
8. Invoke **playtester**. If failures, invoke **refiner**. Loop max 3.
9. Report final status: passed / failed / partial. If passed, tell user to `cd <project> && npm run dev`.

### Path B — refine an existing project

1. Read `game-state.json` and the latest QA report (`qa/qa-report.json`).
2. If `passed === true`, stop.
3. Invoke **refiner** with failures + current source files. Apply edits.
4. Invoke **playtester**. Loop until passed or 3 iterations.

## Halt conditions

- **Schema validation failure** at any stage → halt, surface to user with the validation error. Do not loop.
- **3 refiner iterations without pass** → halt, surface failures. Do not silently mark complete.
- **`ANTHROPIC_API_KEY` missing** when invoking an LLM sub-skill via the embedded CLI mode → fall back to host-agent (you) doing the LLM call.
- **`FAL_KEY` missing** when sprite-artist needs an image generation → fall back to procedural sprites.
- **User cancels** (SIGINT) → exit 130.

## Embedded CLI mode

For non-agent users, this skill bundles a CLI:

```bash
gameforge init <name>                     # Path A scaffolding
gameforge generate "<description>"        # Path A pipeline
gameforge qa                              # playtester only
gameforge refine                          # Path B
gameforge dev                             # vite dev server
gameforge build                           # production bundle
```

Global flags: `--json` (NDJSON on stdout), `--cwd`, `-y / --yes`, `-v / --verbose`. Exit codes: `0` ok, `2` usage, `3` config, `4` network, `5` QA failed, `130` SIGINT.

## References

- `references/pipeline.md` — detailed stage interfaces and data flow
- `references/state-schema.md` — full JSON schema with examples
- `references/phaser-cookbook.md` — Phaser 3 patterns the codesmith MUST follow

## Scripts

- `scripts/init_project.mjs <name> [--dir path]` — scaffold from `templates/phaser-game/`
- `scripts/validate_state.mjs <project-dir>` — schema check + invariant verification
- `scripts/run_pipeline.mjs <project-dir>` — invoke embedded CLI pipeline (only if `ANTHROPIC_API_KEY` set)
