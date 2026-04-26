---
name: game-designer
description: Turns a free-form game description into a structured Game Design Document (GDD) JSON. Decides genre, win/lose conditions, entities, animation states, tile palette. Output drives sprite generation, level design, and code synthesis. Use when the host agent has a user prompt and needs a machine-readable game spec.
---

# Game Designer

Convert a one-line natural-language game description into a strictly-schemaed GDD JSON. The output is consumed unchanged by every downstream stage — be concrete, internally consistent, and machine-readable.

## When to use

The orchestrator (gameforge) invokes this skill once per project, immediately after `init`. The host agent provides:

- The user's description (1-3 sentences)
- Optional: preferred genre hint

## Output contract

Output ONLY a single JSON object matching this schema. No prose, no fences, no commentary.

```jsonc
{
  "title": "<short game title (1-4 words)>",
  "genre": "top-down-adventure" | "platformer" | "twin-stick-shooter" | "puzzle" | "shoot-em-up" | "dungeon-crawler",
  "tagline": "<one-sentence pitch>",
  "loop":   "<1-3 sentences describing the core gameplay loop>",
  "winCondition":  "<concrete, observable in headless test, e.g. 'window.__gameState.gemsCollected >= 3'>",
  "loseCondition": "<concrete, e.g. 'window.__gameState.playerHp <= 0', or 'none' for endless>",
  "controls": {
    "movement": "8-direction" | "4-direction" | "platformer" | "twin-stick",
    "actions":  [{ "key": "<KEY>", "name": "<verb>", "description": "<what it does>" }]
  },
  "entities": [
    {
      "id":     "<SCREAMING_SNAKE_CASE>",
      "kind":   "player" | "enemy" | "npc" | "pickup" | "projectile" | "boss",
      "color":  "<short color phrase, e.g. 'muted purple-green'>",
      "desc":   "<vivid 1-line visual description>",
      "states": ["idle", "walk", ...],
      "speed":  <pixels/sec>,
      "hp":     <hit points (0 = invuln/static, 1 = one-shot)>
    }
  ],
  "tilesetPalette": [
    { "id": "<SCREAMING_SNAKE_CASE>", "color": "<#hex>", "passable": <bool> }
  ],
  "levelHints": {
    "size":   [<tilesWide>, <tilesTall>],   // each between 8 and 40
    "count":  <number of levels, 1-3>,
    "themes": ["<theme per level>"]
  }
}
```

## Hard constraints

- Exactly **one** entity with `kind === "player"`.
- Total entities: **4-9** (sprite-sheet row limit). Combine variants if needed.
- Tileset palette: **3-6 entries**. First entry SHOULD be the dominant passable floor.
- Every entity's `states` MUST include `"idle"`. For `kind ∈ {player, enemy, boss}`, also include `"walk"`.
- `winCondition` and `loseCondition` must be testable from `window.__gameState` without human judgment.
- For **platformer**: include gravity-friendly tiles (floor, wall) and a goal entity OR goal tile.
- For **top-down**: orthogonal layout, walls block movement.
- Do not include music, audio, voice, or dialogue.

## Process

1. Read the user's prompt and any genre hint from the orchestrator.
2. Decide the genre (default to top-down-adventure for ambiguous prompts).
3. Pick a 1-4 word title that fits.
4. Choose the smallest entity set that captures the prompt (don't over-design — most jams need 4-5 entities).
5. Choose a tile palette that supports the genre (platformer needs solid floor + sky; top-down needs floor + walls + scenery).
6. Write win/lose conditions referencing `window.__gameState` fields the codesmith will populate (e.g. `gemsCollected`, `coinsCollected`, `asteroidsDestroyed`, `playerHp`).
7. Run `scripts/validate_gdd.mjs <gdd-file>` to confirm shape before returning.
8. Save to `game-state.json` under `gdd`.

## Validation rules (encoded in `scripts/validate_gdd.mjs`)

- `title` and `genre` are non-empty strings.
- `entities` is a non-empty array; exactly one with `kind === "player"`.
- Every entity id matches `/^[A-Z][A-Z0-9_]*$/`.
- Every entity's `states` includes `"idle"`.
- `tilesetPalette.length >= 2`.
- `levelHints.size` is `[w, h]` with `16 <= w,h <= 40`.

## Examples

**Prompt:** *"A pixel knight collects gems while dodging slimes."*

**GDD (excerpt):**
```json
{
  "title": "Slime Slayer",
  "genre": "top-down-adventure",
  "winCondition": "window.__gameState.gemsCollected >= 3",
  "entities": [
    { "id": "KNIGHT", "kind": "player", "color": "blue", "desc": "Small blue knight with a silver sword", "states": ["idle","walk","attack","hurt"], "speed": 80, "hp": 3 },
    { "id": "SLIME",  "kind": "enemy",  "color": "green", "desc": "Round green slime that wobbles", "states": ["idle","walk","hurt"], "speed": 30, "hp": 1 },
    { "id": "GEM",    "kind": "pickup", "color": "yellow","desc": "Bright sparkling gem", "states": ["idle"], "speed": 0, "hp": 0 }
  ]
}
```

See `references/examples.md` for a full GDD per genre.

## Scripts

- `scripts/validate_gdd.mjs <gdd-json-file>` — fails non-zero with reason if invalid.

## References

- `references/gdd-schema.json` — JSON Schema (draft-07).
- `references/examples.md` — one full GDD per supported genre.
