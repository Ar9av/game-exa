import { jsonCall } from '../lib/anthropic.js';

const SYSTEM = `You are a game designer for an automated 8-bit game generator.
Your output drives sprite generation, level layout, and code synthesis, so it
must be concrete, internally consistent, and machine-readable.

Output ONLY a single JSON object matching this schema:

{
  "title": string,                          // short game title (1-4 words)
  "genre": "top-down-adventure" | "platformer" | "twin-stick-shooter" | "puzzle" | "shoot-em-up" | "dungeon-crawler",
  "tagline": string,                        // one-sentence pitch
  "loop": string,                           // 1-3 sentences describing the core gameplay loop
  "winCondition": string,                   // concrete, observable in headless test (e.g. "player reaches tile (10,5)")
  "loseCondition": string,                  // concrete (e.g. "player health <= 0", or "none" for endless)
  "controls": {
    "movement": "8-direction" | "4-direction" | "platformer" | "twin-stick",
    "actions": [{ "key": string, "name": string, "description": string }]
  },
  "entities": [
    {
      "id": string,                         // SCREAMING_SNAKE_CASE, used as sprite row label
      "kind": "player" | "enemy" | "npc" | "pickup" | "projectile" | "boss",
      "color": string,                      // short color phrase, e.g. "muted purple-green"
      "desc": string,                       // 1-line visual description, vivid and specific
      "states": string[],                   // animation states present, e.g. ["idle","walk","attack","hurt"]
      "speed": number,                      // pixels/sec, 0 for static
      "hp": number                          // hit points, 1 for one-shot, 0 for invulnerable/static
    }
  ],
  "tilesetPalette": [
    {
      "id": string,                         // SCREAMING_SNAKE_CASE
      "color": string,                      // hex like "#3a8a3a"
      "passable": boolean                   // true = walkable, false = collision
    }
  ],
  "levelHints": {
    "size": [number, number],               // [tilesWide, tilesTall], each between 8 and 40
    "count": number,                        // number of levels, 1-3 for v1
    "themes": string[]                      // one theme per level, e.g. ["forest", "cave"]
  }
}

Constraints:
- Exactly ONE entity with kind=player.
- Entities total: 4-9 (sprite sheet limit). Combine variants if needed.
- Tileset palette: 3-6 entries. First entry should be the dominant passable floor.
- All entity 'states' must include "idle". If kind is "player" or "enemy" or "boss", also include "walk".
- winCondition and loseCondition must be testable from observing game state without human judgment.
- For platformer genre: include gravity-friendly tiles (floor, wall) and a goal entity or goal tile.
- For top-down: orthogonal layout, walls block movement.
- Do not include music, audio, or anything not visual.

Return ONLY the JSON, no prose, no fences.`;

export async function designGame({ description, genreHint, log }) {
  log?.info?.('agent: designer');
  const userMsg = `Game description: """${description}"""\n${genreHint ? `Preferred genre: ${genreHint}\n` : ''}Output the JSON now.`;
  const { json, usage } = await jsonCall({
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  validate(json);
  log?.success?.(`designer: ${json.title} (${json.genre}) — ${json.entities.length} entities, ${json.tilesetPalette.length} tiles`);
  return { gdd: json, usage };
}

function validate(g) {
  if (!g.title || !g.genre) throw new Error('GDD missing title/genre');
  if (!Array.isArray(g.entities) || g.entities.length === 0) throw new Error('GDD has no entities');
  const players = g.entities.filter((e) => e.kind === 'player');
  if (players.length !== 1) throw new Error(`GDD must have exactly 1 player, found ${players.length}`);
  if (!Array.isArray(g.tilesetPalette) || g.tilesetPalette.length < 2) throw new Error('GDD needs ≥ 2 tile types');
  for (const e of g.entities) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(e.id)) throw new Error(`Entity id not SCREAMING_SNAKE_CASE: ${e.id}`);
    if (!Array.isArray(e.states) || !e.states.includes('idle')) throw new Error(`Entity ${e.id} missing 'idle' state`);
  }
  if (!g.levelHints || !Array.isArray(g.levelHints.size)) throw new Error('GDD missing levelHints.size');
}
