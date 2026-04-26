---
name: gameforge
description: Orchestrator skill that turns a one-line description into a runnable Phaser 3 game. Coordinates eight sub-skills (game-designer, world-architect, sprite-artist, tile-artist, bg-artist, codesmith, playtester, refiner) into a deterministic-where-possible, LLM-where-necessary pipeline. Image generation uses GPT Image 2 (gpt-image-2) at low quality by default. Use when the user wants to generate, refine, or test a 2D HTML5 game from natural language.
---

# Gameforge — Game Generation Orchestrator

Drives the full game-creation pipeline. The host agent (you) is the one calling LLM-bearing sub-skills; this skill describes the pipeline shape, the shared state file, validation gates, and halt conditions. All image generation goes through **GPT Image 2** (`gpt-image-2`) at `quality: low` by default.

## When to use

- "Make me a game where …"
- "Generate a Phaser game called …"
- "Refine the QA failures from the last run"
- Any request involving an 8-bit / pixel-art / 2D HTML5 game described in natural language

## Pipeline

```
description ─▶ game-designer ─▶ world-architect ─▶ sprite-artist ┐
                                                  tile-artist    ├─▶ codesmith ─▶ playtester ─▶ refiner ─▶ playtester
                                                  bg-artist      ┘                                ▲
                                                                                                   │ (bounded retry, max 3)
```

1. **game-designer** turns prompt → `gdd.json` (GDD JSON).
2. **world-architect** turns GDD → `levels.json` (tile-based level layouts).
3. **sprite-artist** turns GDD entities → sprite sheets + manifest. Uses **GPT Image 2** (`gpt-image-2`) by default at `quality: low`.
4. **tile-artist** turns GDD tile palette → `tiles.png` + tile metadata. GPT Image 2 mode produces real pixel-art tiles; procedural mode is the free fallback.
5. **bg-artist** generates a parallax background image (sky, cave, space, forest, etc.) via GPT Image 2. Optional — skipped for genres that don't benefit (top-down-adventure, abstract puzzle).
6. **codesmith** turns GDD + levels + manifest → `src/scenes/Game.js` (and optional helpers).
7. **playtester** boots the game, runs scenarios, captures screenshots, diffs against baselines, returns structured failures.
8. **refiner** consumes failures + current source → patched files. Loop back to playtester. Cap at 3 iterations.

Stages 3, 4, 5 are deterministic helpers (image generation is delegated to the model; the skill's logic — chunking, dimensions, chroma-key, manifest write — is pure). Stages 1, 2, 6, 8 are LLM-driven via host-agent reasoning. Stage 7 is deterministic.

Stages 3, 4, 5 can run in parallel (independent inputs).

## Shared state — `game-state.json`

Single source of truth at the project root. Every sub-skill reads/writes it. Schema:

```jsonc
{
  "version": 1,
  "name": "<project-name>",
  "prompt": "<original user description>",
  "genre": "top-down-adventure | platformer | shoot-em-up | puzzle | dungeon-crawler | top-down-rpg",
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
4. In parallel:
   - Invoke **sprite-artist** (default: GPT Image 2 at `quality: low`; `--placeholder` for free iteration).
   - Invoke **tile-artist** (`generate_tiles_gpt.mjs` for real pixel-art tiles, or `paint_tiles.mjs` for procedural).
   - Invoke **bg-artist** (`generate_bg.mjs --theme <theme>`). Skip when genre is top-down-adventure or abstract puzzle.
5. Write `public/assets/manifest.json` and `public/data/levels.json` from state (the asset skills merge into the manifest as they go).
6. Invoke **codesmith** with GDD + levels + manifest. Writes `src/scenes/Game.js` (and optional helpers under `src/`). Codesmith reads `manifest.bg` and adds the parallax-background pattern when present.
7. Invoke **playtester**. If failures, invoke **refiner**. Loop max 3.
8. Report final status: passed / failed / partial. If passed, tell user to `cd <project> && npm run dev`.

### Refine an existing project

1. Read `game-state.json` and the latest QA report (`qa/qa-report.json`).
2. If `passed === true`, stop.
3. Invoke **refiner** with failures + current source files. Apply edits.
4. Invoke **playtester**. Loop until passed or 3 iterations.

## Halt conditions

- **Schema validation failure** at any stage → halt, surface to user with the validation error. Do not loop.
- **3 refiner iterations without pass** → halt, surface failures. Do not silently mark complete.
- **`FAL_KEY` and `OPENAI_API_KEY` both missing** when an asset skill wants GPT Image 2 → fall back to procedural sprites/tiles and skip bg-artist.
- **User cancels** (SIGINT) → exit 130.

## Optional: multiplayer

Add multiplayer to any generated game via the **multiplayer** skill:

```bash
# After game is generated and running:
node skills/multiplayer/scripts/init_server.mjs <project-dir>   # Colyseus WebSocket server
node skills/multiplayer/scripts/patch_game.mjs <project-dir>    # patches Game.js for network sync

# Optional extras:
node skills/multiplayer/scripts/init_server.mjs <project-dir> --voice   # PeerJS voice/video
node skills/multiplayer/scripts/init_server.mjs <project-dir> --lobby   # React lobby frontend
```

Supports up to 4 players, 20 Hz tick rate, TypeScript shared schemas. See `skills/multiplayer/SKILL.md`.

## References

- `references/pipeline.md` — detailed stage interfaces and data flow
- `references/state-schema.md` — full JSON schema with examples
- `references/phaser-cookbook.md` — Phaser 3 patterns the codesmith MUST follow

## Scripts

- `scripts/init_project.mjs <name> [--dir path]` — scaffold from `templates/phaser-game/`
- `scripts/validate_state.mjs <project-dir>` — schema check + invariant verification
- `scripts/run_pipeline.mjs <project-dir>` — invoke the full pipeline (host agent drives all LLM sub-skills; no separate API key needed)
