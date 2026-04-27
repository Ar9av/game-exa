# game-creation-agent

An AI agent skill pack — give any coding agent a one-line prompt and get a complete, playable **Phaser 3** game back. GPT Image 2 sprites, multi-genre game code, and a gap-checker that validates every level before calling it done.

## Example games

Six complete games built with real **GPT Image 2** sprites and backgrounds. Screenshots taken live from headless Chromium:

| Game | Genre | Screenshot |
|------|-------|-----------|
| **Dungeon Knight** — Armored knight scales a spike-filled dungeon slashing skeletons and collecting golden orbs | Action-platformer | ![dungeon-knight](examples/screenshots/dungeon-knight.png) |
| **Dragon Brawl** — Street fighter battles through waves of gang members in gritty urban alleys | Beat-em-up | ![dragon-brawl](examples/screenshots/dragon-brawl.png) |
| **Island Quest** — Young hero explores a magical island collecting heart crystals to restore the sacred shrine | Top-down adventure | ![island-quest](examples/screenshots/island-quest.png) |
| **Sewer Bot** — Scrappy maintenance robot navigates toxic sewers collecting power cells while battling mechanical vermin | Action-platformer (NES) | ![sewer-bot](examples/screenshots/sewer-bot.png) |
| **Pixel Town** — Trainer explores a Pokémon-inspired village, talking to locals and finding five hidden treasure chests | Top-down RPG | ![pixel-town](examples/screenshots/pixel-town.png) |
| **Nova Blitz** — Pilot a neon cyan starfighter through waves of massive alien ships, build combos and drop screen-clearing nova bombs | Neon shoot-em-up | ![nova-blitz](examples/screenshots/nova-blitz.gif) |

Each example ships with full source, GPT Image 2 sprite sheets, level data, and `game-state.json`:

```bash
cd examples/dungeon-knight   # or dragon-brawl / island-quest / sewer-bot / pixel-town
npm install
npm run dev                  # opens http://127.0.0.1:5173
```

## How it works

```
description ─▶ game-designer ─▶ world-architect ─▶ sprite-artist ┐
                                                  tile-artist    ├─▶ codesmith ─▶ playtester ─▶ refiner ─▶ playtester
                                                  bg-artist      ┘                                ▲
                                                                                                   │ (max 3 retries)
```

- **LLM stages** (`game-designer`, `world-architect`, `codesmith`, `refiner`) are plain SKILL.md instruction docs — your coding agent does the reasoning. No separate Anthropic API key needed; the agent you're already running handles it.
- **Asset stages** (`sprite-artist`, `tile-artist`, `bg-artist`) drive **GPT Image 2** for real pixel-art, with deterministic procedural fallbacks.
- **Deterministic stages** (`playtester`, `gap-checker`) are Node scripts — no LLM, no flakiness.
- **State** lives in `game-state.json`; every stage reads/writes it.

## Install

```bash
git clone https://github.com/Ar9av/gameforge.git ~/game-creation-agent
cd ~/game-creation-agent
npm install

# Symlink skills into your host's skill directory (Claude Code, Cursor, etc.)
mkdir -p ~/.claude/skills
ln -sf ~/game-creation-agent/skills/* ~/.claude/skills/

# (Optional) Install Playwright's Chromium for QA screenshots
npx playwright install chromium
```

## Usage

In your coding agent (Claude Code, Cursor, etc.), with the skills symlinked:

> *"Make me a game where a robot navigates a sewer collecting batteries."*

The agent reads the orchestrator SKILL.md, follows the pipeline, invokes the sub-skills, runs the deterministic scripts, and reports success.

### Regenerate example assets

Requires only `FAL_KEY` (for GPT Image 2). No Anthropic API key needed:

```bash
node --env-file=~/.all-skills/.env scripts/gen_game.mjs dungeon-knight
node --env-file=~/.all-skills/.env scripts/gen_game.mjs dragon-brawl
node --env-file=~/.all-skills/.env scripts/gen_game.mjs island-quest
node --env-file=~/.all-skills/.env scripts/gen_game.mjs sewer-bot
node --env-file=~/.all-skills/.env scripts/gen_game.mjs pixel-town
```

Change `'low'` to `'medium'` or `'high'` in the script for higher-quality sprites.

## Skills

| Skill | Role | Image gen? |
|---|---|---|
| `orchestrator` | Drives pipeline, manages state | — |
| `game-designer` | Prompt → GDD JSON | — |
| `world-architect` | GDD → level layouts | — |
| `sprite-artist` | Entities → sprite sheets. **GPT Image 2** or procedural. | yes |
| `tile-artist` | Palette → tileset PNG. **GPT Image 2** or flat-color. | yes |
| `bg-artist` | Genre theme → parallax background PNG. | yes |
| `codesmith` | GDD + manifest → `src/scenes/Game.js` | — |
| `playtester` | Headless Playwright + pixelmatch screenshot diff | — |
| `refiner` | Failures → patched files | — |
| `gap-checker` | Playability validation: static BFS + dynamic fuzzer | — |
| `multiplayer` | Add Colyseus WebSocket server + client sync to any game (optional) | — |

## Validated genres

| Genre | Example | Mechanics |
|---|---|---|
| Action-platformer | dungeon-knight, sewer-bot | Gravity, coyote-time jump, variable jump height, sword slash / arm cannon, spike/acid hazard tiles, boss fight |
| Beat-em-up | dragon-brawl | Pseudo-3D Y-depth movement, y-sort, one-way camera scroll, enemy wave spawner, combo hits |
| Top-down adventure | island-quest | 8-direction normalized movement, sword knockback, chase/wander AI, tilemap collision |
| Top-down RPG | pixel-town | 4-direction movement, NPC dialogue system, wander AI, chest pickups, y-sort depth |
| Neon shoot-em-up | nova-blitz | Auto-fire, wave spawner, V-formation + bomber AI, combo multiplier, nova bomb, starfield, screen shake |

## Optional: multiplayer

Add real-time multiplayer to any generated game:

```bash
node skills/multiplayer/scripts/init_server.mjs <project-dir>   # Colyseus WebSocket server
node skills/multiplayer/scripts/patch_game.mjs <project-dir>    # patches Game.js for network sync

# Extras:
node skills/multiplayer/scripts/init_server.mjs <project-dir> --voice   # PeerJS voice/video
node skills/multiplayer/scripts/init_server.mjs <project-dir> --lobby   # React lobby frontend
```

Up to 4 players, 20 Hz tick rate, TypeScript shared schemas. See [`skills/multiplayer/SKILL.md`](skills/multiplayer/SKILL.md).

## Project layout

```
game-creation-agent/
├── README.md
├── package.json
├── scripts/
│   └── gen_game.mjs          # generate any example game (GPT Image 2 + inline GDD)
├── src/                      # shared lib (sprites, state, lib)
├── skills/                   # the skill pack
│   ├── gameforge/            # orchestrator SKILL.md
│   ├── game-designer/
│   ├── world-architect/
│   ├── sprite-artist/
│   ├── tile-artist/
│   ├── bg-artist/
│   ├── codesmith/
│   ├── playtester/
│   ├── refiner/
│   ├── gap-checker/
│   └── multiplayer/          # optional Colyseus + PeerJS + React lobby
├── templates/phaser-game/    # per-game Phaser 3 + Vite starter
└── examples/
    ├── dungeon-knight/       # action-platformer with coyote-time, boss
    ├── dragon-brawl/         # beat-em-up with pseudo-3D, wave spawner
    ├── island-quest/         # top-down adventure with 8-dir movement
    ├── sewer-bot/            # NES-quality platformer with arm cannon, boss spread
    ├── pixel-town/           # Pokémon-style top-down RPG with NPC dialogue
    ├── nova-blitz/           # neon shoot-em-up with wave AI, combos, nova bomb
    └── screenshots/          # live headless-Chromium screenshots
```

## Optional integrations

- **`FAL_KEY`** — fal.ai provider for **GPT Image 2** (`gpt-image-2`). Required for sprite/tile/bg generation.
- **`OPENAI_API_KEY`** — direct OpenAI alternative for GPT Image 2. Auto-detected if `FAL_KEY` absent.

## Credits

Inspired by the **OpenGame** paper (*OpenGame: Open Agentic Coding for Games* — https://arxiv.org/abs/2604.18394) and the skill-pack pattern from [PaperOrchestra](https://github.com/Ar9av/PaperOrchestra).

Built on Phaser 3, Playwright, sharp, and fal.ai.

## License

MIT
