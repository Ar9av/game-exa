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
  "genre": "top-down-adventure" | "platformer" | "action-platformer" | "twin-stick-shooter" | "puzzle" | "shoot-em-up" | "dungeon-crawler" | "top-down-rpg" | "beat-em-up",
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
  // NPC entities MAY include a personality block — used by gen_npc_dialogue to produce
  // rich, character-consistent dialogue at build time via Claude Haiku:
  // {
  //   "id": "NPC_ELDER", "kind": "npc", ...,
  //   "personality": {
  //     "openness": 0.6, "conscientiousness": 0.9, "extraversion": 0.4,
  //     "agreeableness": 0.8, "neuroticism": 0.1,
  //     "backstory": "One sentence about who this NPC is and why they're in this town."
  //   }
  // }
  // Values are 0.0–1.0 (Big-5 dimensions). backstory is used directly in the prompt.
  // If omitted, gen_npc_dialogue uses a generic description derived from the entity desc field.

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
- Prefer states from this filter-safe set: `idle`, `walk`, `jump`, `cast`, `block`, `victory`. Avoid `hurt` and `attack` as dedicated sprite states — GPT Image 2's content filter trips on the typical "pained grimace / lunging / weapon extended" descriptions. For damage feedback, the codesmith uses tint flash + alpha blink + camera shake (no sprite frame needed). For attack feedback, a brief swing animation can be implemented in code.
- `winCondition` and `loseCondition` must be testable from `window.__gameState` without human judgment.
- For **platformer** / **action-platformer**: include gravity-friendly tiles (floor, wall) and a goal entity OR goal tile.
- For **beat-em-up**: floor is always passable, walls are impassable on the sides only. No ceiling. Include `ENEMY` entity (kind=enemy) that walks toward player. Win = defeat N enemies.
- For **top-down**: orthogonal layout, walls block movement.
- Do not include music, audio, voice, or dialogue.

## Genre-specific guidance

### beat-em-up
Classic side-scrolling brawler (Double Dragon / Final Fight style). Characters move in both X and Y within a 2D "lane" depth illusion. Y-position determines render depth and ground-truth position on the pseudo-3D floor.
- Controls: 4-direction movement (X+Y pseudo-3D), attack on SPACE/Z
- Tiles: GROUND (passable), WALL (impassable left/right border), optional PROP tiles (bench, barrel)
- Camera follows player rightward only (one-way scroll)
- HUD: health bar drawn as graphics, score, lives/wave count
- winCondition: defeat a fixed number of enemies (e.g. `window.__gameState.enemiesDefeated >= 10`)
- Use the `beat-em-up` skill for codesmith patterns

### action-platformer
Gravity-driven side-scroller with jump, hazards, and atmospheric depth (Shovel Knight / Metroidvania style).
- Controls: left/right + jump (SPACE), optional attack (Z)
- Tiles: STONE/BRICK (impassable floor/wall), SKY (passable, transparent — bg shows through), optional HAZARD tile (spikes)
- Camera follows player in both axes; world taller than viewport
- HUD: HP bar, score, level name
- Use `bg-artist` for cave/dungeon parallax background
- winCondition: reach goal tile OR collect all keys

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
