# Coding-agent integration

Two ways to run gameforge: **host-agent mode** (read SKILL.md, drive the pipeline) and **embedded CLI mode** (the bundled `gameforge` command does the LLM calls itself).

## Host-agent mode (recommended)

Works with any agent that supports skills/instructions: Claude Code, Cursor, Antigravity, Cline, Aider, etc.

### Install

```bash
git clone https://github.com/Ar9av/gameforge.git ~/gameforge
cd ~/gameforge && npm install
mkdir -p ~/.claude/skills            # or ~/.cursor/skills, ~/.cline/skills, etc.
ln -sf ~/gameforge/skills/* ~/.claude/skills/
```

### Trigger

Tell the agent: *"Make me a game where …"*

The agent loads `skills/gameforge/SKILL.md`, follows the pipeline, and runs deterministic scripts where instructed:

| Stage | Action the host takes |
|---|---|
| init | Run `node ~/gameforge/skills/gameforge/scripts/init_project.mjs <name>` |
| game-designer | Read `skills/game-designer/SKILL.md` + `references/gdd-schema.json`. Produce GDD via own LLM. Validate with `validate_gdd.mjs`. Write to `game-state.json`. |
| world-architect | Read `skills/world-architect/SKILL.md`. Produce levels. Validate. Write to state. |
| sprite-artist | Run `node skills/sprite-artist/scripts/generate_sheets.mjs <project> [--placeholder]`. |
| tile-artist | Run `node skills/tile-artist/scripts/paint_tiles.mjs <project>`. |
| codesmith | Read `skills/codesmith/SKILL.md` + `references/scene-contract.md` + `phaser-recipes.md`. Produce file content. Run `validate_code.mjs`. Write via `write_files.mjs`. |
| playtester | Run `node skills/playtester/scripts/run_qa.mjs <project>`. Read `qa/qa-report.json`. |
| refiner | Run `collect_files.mjs <project>` to read source. Produce edits. Apply via `apply_fixes.mjs`. Loop max 3. |

Each script outputs JSON on stdout, logs on stderr, and uses standard exit codes. The host can pipe JSON through its own LLM context.

### Why this works without API keys

The skills/SKILL.md files are pure instructions. The host agent's existing LLM (whatever it is — Claude, GPT-5, Gemini, Llama-3) does the reasoning. Only the deterministic helpers (sprites, tiles, QA) need to run; they're stdlib Node + sharp + Playwright.

## Embedded CLI mode

For users who want to invoke the pipeline without an agent in the loop:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
gameforge init my-game
cd my-game
gameforge generate "<description>"
gameforge qa
gameforge refine
```

This calls Claude (Anthropic SDK) directly. The system prompts come from `src/agents/*.js`, which mirror the SKILL.md files. Same pipeline, same deterministic helpers — just batched into one process.

## NDJSON event stream (--json)

Both modes can emit a structured event stream:

```bash
gameforge --json generate "..."
```

Each line is a `{ event, ts, data }` object. Useful for:
- CI pipelines that parse step-by-step status
- Agent loops that want to interleave with their own logging
- Debug traces

Events:

```jsonc
{ "event": "init.start",            "data": { "name": "my-game" } }
{ "event": "init.done",             "data": { "dir": "..." } }
{ "event": "agent.designer.start" }
{ "event": "agent.designer.done",   "data": { "title": "...", "entities": 3 } }
{ "event": "agent.architect.done",  "data": { "levels": 1 } }
{ "event": "asset.sprites.start" }
{ "event": "asset.sprites.done",    "data": { "sheets": 1 } }
{ "event": "asset.tiles.done" }
{ "event": "agent.codesmith.done",  "data": { "files": 1 } }
{ "event": "qa.dev-server.ready",   "data": { "url": "..." } }
{ "event": "qa.run.done",           "data": { "passed": true, "failures": 0 } }
{ "event": "result",                "data": { "title": "...", "files": [...] } }
```

## Config

User-level config lives at `$XDG_CONFIG_HOME/gameforge/config.json` (or `~/.config/gameforge/config.json`). Loaded by `cosmiconfig` — also picks up `gameforge.config.{js,ts,json}` in the project root, or a `"gameforge"` key in the project's `package.json`.

## Verifying the install

```bash
# 1. Smoke check the template + harness
node ~/gameforge/test/smoke-boot.mjs

# 2. Run all three genre fixtures end-to-end (deterministic, no LLM)
node ~/gameforge/test/run-fixture.mjs slime-slayer 5180
node ~/gameforge/test/run-fixture.mjs pixel-pete   5181
node ~/gameforge/test/run-fixture.mjs star-defender 5182
```

All should print `"failures": []` and exit `0`.
