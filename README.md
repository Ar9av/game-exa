# gameforge

A pluggable skill pack that lets any coding agent (Claude Code, Cursor, Antigravity, Cline, Aider, …) turn a one-line description into a runnable Phaser 3 game.

Eight cooperating skills — `gameforge` (orchestrator), `game-designer`, `world-architect`, `sprite-artist`, `tile-artist`, `codesmith`, `playtester`, `refiner` — coordinate a deterministic-where-possible / LLM-where-necessary pipeline that produces a Game Design Document, tile-based levels, sprite sheets, gameplay code, and a headless QA loop with screenshot regression.

## How it works

```
description ─▶ game-designer ─▶ world-architect ─▶ sprite-artist ┐
                                                  tile-artist    ├─▶ codesmith ─▶ playtester ─▶ refiner ─▶ playtester
                                                                  ┘                                ▲
                                                                                                   │ (max 3 retries)
```

- **LLM stages** (`game-designer`, `world-architect`, `codesmith`, `refiner`) are plain SKILL.md instruction docs. The host coding agent supplies the LLM reasoning.
- **Deterministic stages** (`sprite-artist`, `tile-artist`, `playtester`) ship as Node scripts under each skill's `scripts/` directory. They take JSON in, produce assets / reports out, never call an LLM.
- **State** lives in a single `game-state.json` at the project root; every stage reads/writes it. Per-asset projections (`public/assets/manifest.json`, `public/data/levels.json`) are derived from state and consumed by the Phaser runtime.

There are no embedded LLM API calls in the SKILL.md files — your coding agent does the reasoning using its own tools. The repository also bundles an optional CLI (`bin/gameforge.mjs`) that calls Claude directly via `@anthropic-ai/sdk`, for non-agent users.

## Install

```bash
git clone https://github.com/Ar9av/gameforge.git ~/gameforge
cd ~/gameforge
npm install

# Symlink skills into your host's skill directory (Claude Code, Cursor, etc.)
mkdir -p ~/.claude/skills
ln -sf ~/gameforge/skills/* ~/.claude/skills/

# (Optional) Install Playwright's Chromium if you don't have system Chrome
npx playwright install chromium
```

## Usage

### Path A — host agent driven (the skill-pack way)

In your coding agent (Claude Code, Cursor, etc.), with the skills symlinked, just say:

> *"Make me a game where a robot navigates a sewer collecting batteries."*

The agent reads `gameforge`'s SKILL.md, follows the pipeline, invokes the sub-skills, runs the deterministic scripts (`init_project.mjs`, `generate_sheets.mjs`, `paint_tiles.mjs`, `run_qa.mjs`, …), and reports success.

### Path B — embedded CLI (no host agent required)

```bash
# Set ANTHROPIC_API_KEY (or put it in ~/.all-skills/.env)
export ANTHROPIC_API_KEY=sk-ant-...

# Set FAL_KEY for image-generation sprites (or use --placeholder-sprites)
export FAL_KEY=...

# Scaffold + generate
gameforge init my-game
cd my-game
gameforge generate "A pixel knight collects gems while dodging slimes"

# Or skip image-gen and use procedural sprites for fast iteration
gameforge generate "..." --placeholder-sprites

# Run it
gameforge dev                    # vite dev server on :5173

# Run the QA harness
gameforge qa
gameforge qa --update-baselines  # refresh after intentional changes

# Refine: feed last QA failures to the refiner agent
gameforge refine
```

Global flags: `--json` (NDJSON on stdout), `--cwd`, `-y/--yes`, `-v/--verbose`. Exit codes: `0` ok, `2` usage, `3` config, `4` network, `5` QA failed, `130` SIGINT.

## Skills

Each skill has a `SKILL.md` (instructions) plus `references/` (schemas, recipes, cookbooks) and/or `scripts/` (deterministic helpers).

| Skill | Role | LLM? | Scripts |
|---|---|---|---|
| `gameforge` | Orchestrator: drives the pipeline, manages state, handles halt conditions | no (delegates) | `init_project.mjs`, `validate_state.mjs` |
| `game-designer` | Prompt → GDD JSON | yes | `validate_gdd.mjs` |
| `world-architect` | GDD → level layouts | yes | `validate_levels.mjs` |
| `sprite-artist` | Entities → sprite sheets + manifest. fal.ai GPT-Image-2 by default; procedural fallback. | indirect (image model) | `generate_sheets.mjs`, `chroma_key.mjs` |
| `tile-artist` | Palette → tileset PNG | no | `paint_tiles.mjs` |
| `codesmith` | GDD + manifest → `src/scenes/Game.js` | yes | `write_files.mjs`, `validate_code.mjs` |
| `playtester` | Headless Playwright + pixelmatch screenshot diff | no | `run_qa.mjs`, `boot_check.mjs` |
| `refiner` | Failures → patched files | yes | `collect_files.mjs`, `apply_fixes.mjs` |

## Validated genres

| Genre | Mechanics tested | QA scenarios |
|---|---|---|
| Top-down adventure | 4-direction, attack, pickups, HP | boot, walk-right, walk-down, attack |
| Platformer | Per-scene gravity, JustDown jump, blocked-down detection | boot, walk-right, jump |
| Shoot-em-up | Projectiles, timed enemy spawn, kill-count win | boot, walk-right, walk-down, attack |

All three pass at 60 fps with zero console errors on a fresh clone.

## Project layout (this repo)

```
gameforge/
├── README.md
├── package.json                # framework deps (sdk, playwright, sharp, …)
├── bin/gameforge.mjs           # optional CLI shebang
├── src/                        # CLI implementation + shared lib
│   ├── cli.js
│   ├── commands/               # init, generate, qa, refine, dev, build
│   ├── agents/                 # LLM call sites (used only by Path B)
│   ├── lib/                    # state, sprites, server, anthropic, log, errors, template
│   └── qa/                     # harness, scenarios, runner
├── skills/                     # the skill pack (Path A)
│   ├── gameforge/{SKILL.md, references/, scripts/}
│   ├── game-designer/...
│   ├── world-architect/...
│   ├── sprite-artist/...
│   ├── tile-artist/...
│   ├── codesmith/...
│   ├── playtester/...
│   └── refiner/...
├── templates/phaser-game/      # per-game starter (Phaser 3 + Vite + ESM)
├── examples/                   # generated sample games
├── test/                       # smoke + fixture-based E2E
└── docs/
    ├── architecture.md
    └── coding-agent-integration.md
```

## Project layout (per generated game)

```
my-game/
├── game-state.json             # shared state — single source of truth
├── package.json                # phaser + vite
├── vite.config.mjs
├── index.html
├── public/
│   ├── assets/
│   │   ├── entities.png        # sprite-artist output
│   │   ├── tiles.png           # tile-artist output
│   │   └── manifest.json       # row/col labels + cell size
│   └── data/
│       └── levels.json         # world-architect output
├── src/
│   ├── main.js                 # Phaser bootstrap (template, never edit)
│   ├── config.js               # game config: pixelArt, FIT, RND seed
│   └── scenes/
│       ├── Boot.js             # template, never edit
│       ├── Preload.js          # builds anims from manifest, never edit
│       └── Game.js             # codesmith-written
└── qa/
    ├── __baselines__/<scenario>.png
    ├── __actual__/<scenario>.png       (gitignored)
    ├── __diffs__/<scenario>.png        (gitignored)
    └── qa-report.json
```

## Optional integrations

- **`~/.all-skills/sprite-sheet/`** — external skill that calls fal.ai GPT-Image-2. Used by `sprite-artist` in image-gen mode. Skip with `--placeholder-sprites` for procedural fallback.
- **`ANTHROPIC_API_KEY`** — required for the embedded CLI's `generate` and `refine` commands. Path A doesn't need it (host agent supplies the model).
- **System Chrome** — used by Playwright via `channel: 'chrome'` to skip the 170MB Chromium download. Falls back to bundled if unavailable.

## Credits

The multi-agent pipeline structure (specification → planning → architecture → implementation → integration → testing/refinement, with feedback loops) is inspired by the **OpenGame** paper, *OpenGame: Open Agentic Coding for Games* — https://arxiv.org/abs/2604.18394.

The skill-pack structure is patterned after [PaperOrchestra](https://github.com/Ar9av/PaperOrchestra) (the inverse of "embed an LLM in your tool"; instead, ship instructions + deterministic helpers and let the host agent do the LLM work).

Built on Phaser 3 (https://phaser.io), Playwright, pixelmatch, sharp, commander, @clack/prompts, consola, and the Anthropic SDK.

## License

MIT
