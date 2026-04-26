# Pipeline reference

End-to-end data flow through the seven sub-skills.

```
                                                    ┌─────────────┐
            user prompt ─────────────────────────▶  │ orchestrator│
                                                    │ (gameforge) │
                                                    └──┬──────────┘
                                                       │
                ┌──────────────────────────────────────┼──────────────────────────────┐
                ▼                                      ▼                              ▼
      ┌──────────────────┐                  ┌──────────────────┐          ┌──────────────────┐
      │  game-designer   │                  │  sprite-artist   │          │   tile-artist    │
      │  prompt → GDD    │                  │  GDD → sheets    │          │  GDD → tiles     │
      └──────────┬───────┘                  └──────────┬───────┘          └────────┬─────────┘
                 │                                     │                           │
                 ▼                                     │                           │
      ┌──────────────────┐                            │                           │
      │  world-architect │                            │                           │
      │  GDD → levels    │                            │                           │
      └──────────┬───────┘                            ▼                           ▼
                 │                          ┌────────────────────────────────────────┐
                 ▼                          │            manifest.json                │
      ┌──────────────────┐                  └────────────────────┬───────────────────┘
      │       state       │  ◀─────────────  game-state.json     │
      │       file        │                                       │
      └──────────┬────────┘                                       │
                 │                                                 │
                 ▼                                                 │
      ┌──────────────────┐                                         │
      │   codesmith      │  ◀──────────── reads manifest + state  ─┘
      │  state → Game.js │
      └──────────┬───────┘
                 │
                 ▼
      ┌──────────────────┐
      │   playtester     │  ───▶  qa-report.json
      │  game → report   │
      └──────────┬───────┘
                 │
              passed?
                 │
            no   ▼   yes
      ┌──────────────────┐
      │     refiner      │  ───▶  patched files  ───▶  back to playtester (max 3 loops)
      │  failures → fix  │
      └──────────────────┘
```

## Stage interfaces

| Stage | Input | Output | LLM | Determinism |
|---|---|---|---|---|
| game-designer | `prompt`, optional genre hint | `gdd.json` | yes | depends on model |
| world-architect | `gdd` | `levels[]` | yes | depends on model |
| sprite-artist (image-gen) | `gdd.entities` | sprite PNG sheets + manifest entries | indirect (model paints) | low |
| sprite-artist (procedural) | `gdd.entities` | placeholder PNGs + manifest | no | full |
| tile-artist | `gdd.tilesetPalette` | `tiles.png` + tile metadata | no | full |
| codesmith | `gdd`, `levels`, `manifest` | `src/scenes/Game.js` (+ helpers) | yes | depends on model |
| playtester | runnable game | `qa-report.json` | no | full |
| refiner | `failures`, source files | replacement files | yes | depends on model |

## Concurrency

- **sprite-artist + tile-artist** can run in parallel (independent inputs).
- All other stages are serial in v0. The state file is the synchronization barrier.

## When to halt

| Condition | Action |
|---|---|
| Schema validation fails | Halt, surface the validation error |
| LLM returns non-JSON or invalid JSON | Retry once with a stricter "JSON only" reminder; on second failure, halt |
| `playtester` 3rd retry still failing | Halt, surface persistent failures |
| User SIGINT | Exit 130, leave state file in last-known-good state |

## Why this ordering

- **Designer first** because every other stage references the GDD.
- **Architect before code** because Game.js depends on level shape (player spawn, world bounds, etc.).
- **Asset stages parallel** because Game.js needs both the sprite manifest and the tile manifest.
- **Codesmith after assets** because code references manifest by name; can't write a sprite spawn without knowing which sheet it's in.
- **Playtester after code** because there's nothing to test before that.
- **Refiner last** because it consumes failures, which only exist after playtester ran.
