---
name: iso-living-world
description: Generates living isometric pixel-art world "games" — ambient explorable cities/villages with a movable player, wandering NPCs with speech bubbles, ambient traffic, and district-based world layout. No win condition; the world itself is the product. Use when the description involves a living city, ambient world, "world like the Anthropic SF pixel map", explorable diorama, or a town that runs itself.
---

# Iso Living World

Generates ambient isometric worlds (SimCity-diorama feel, not a quest game). Reference implementation: `examples/pixel-city` — vanilla canvas, no Phaser dependency, because the whole runtime is one draw loop and Phaser's scene machinery adds nothing here. If multiplayer or game mechanics get layered on later, port into the standard phaser-game template; the math below is engine-agnostic.

## Genre tag

Set `gdd.genre` to `"iso-living-world"`. `winCondition`/`loseCondition` are `"false"` — playtester/QA stages should verify liveliness invariants instead (NPCs pathing, bubbles appearing, no overlap glitches).

## Engine contracts (see examples/pixel-city/main.js)

- Projection 2:1 dimetric: `sx=(gx-gy)*TW/2; sy=(gx+gy)*TH/2` with TW=64, TH=32.
- Painter's algorithm: one flat list of props + entities sorted by `gridX+gridY` (entities use interpolated float positions). Never z-layers.
- Sprites anchor bottom-center to the tile's bottom corner (`cy + TH/2`); width fixed per type, height from image aspect.
- Movement: entities hold float grid coords, walk node-to-node over BFS paths; the player chains one-tile steps *within a frame* using leftover time budget (returning unspent budget from the stepper) — otherwise motion stutters at every tile boundary.
- **Occlusion fade**: buildings with depth > player whose screen rect covers the player lerp to alpha 0.3. Mandatory in any world with tall buildings.

## World-architect rules for this genre

Learned by comparing against the reference SF illustration — these are what make it read as "alive and hand-composed" instead of procedural mush:

1. **Proportion**: person ≈ one building story (~46px vs ~120px 3-story house); ordinary towers ≤ 2.2× house height; landmarks may exceed.
2. **Frontage packing**: buildings fill cells 4-adjacent to roads (p≈0.85 residential, ≈0.6 downtown); block interiors stay open for trees.
3. **Boulevards 2 tiles wide**, sidewalk strips on outer edges only, crosswalk stripes where lanes meet a perpendicular road, street lamps every 4th sidewalk tile.
4. **Districts**: residential rows, a downtown corner, a park block, a water corner. Deterministic seeded RNG (mulberry32) so the world is stable.
5. **Singleton landmarks** placed by hand after generation (clear the cell, pin the landmark): one pyramid tower downtown, one clock tower in the park. Landmarks are what stop "every building looks the same".
6. **Variety = few sprites × hue-rotate**: houses take the full painted-ladies rainbow (`hue-rotate(±150deg)`), brick types drift ±20°, characters ±30° (bigger turns skin green). One car sprite → a whole traffic palette.
7. **Ambient motion everywhere**: wandering NPCs (idle → BFS to random road cell → walk), emoji bubbles on idle, cars shuttling the boulevards. Liveliness comes from motion density, not asset count.

## Asset generation

`examples/pixel-city` uses meshroom.top (`POST /api/v1/generate`); the standard GPT Image 2 sprite-artist also works — the prompt templates transfer verbatim:

- Props: `mode:"image"` + rigid template — *"isometric pixel art, 2:1 dimetric projection, 45 degree top-down game view, single object only, centered, isolated on plain pure white background, no ground, clean 1px outlines, muted cozy city-builder palette, {SUBJECT}"*.
- Characters: `mode:"animation"`, pixel-art, frameCount 4, walk, transparent background → arrives as a horizontal strip, side view facing right (flip via `ctx.scale(-1,1)`).
- **Backgrounds are never actually transparent**: PNGs come back RGB with a checkerboard or white baked in. Strip with `scripts/deckerboard.py` (edge flood-fill over light desaturated pixels; interior whites survive). Poll/download with `scripts/poll_gen.py` (their status JSON needs `json.JSONDecoder(strict=False)` — raw control chars).
- A complete city needs surprisingly few generations: 2 characters + ~8 props (3 house shapes, shop, cafe, tower, tree, car) + 2 landmarks.
