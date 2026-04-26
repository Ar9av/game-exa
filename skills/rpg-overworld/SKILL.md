---
name: rpg-overworld
description: Generates top-down RPG overworld games with NPC dialogue, 4-directional movement, y-depth sorting, and collectible quests. Extends the standard gamewright pipeline with rpg-specific codesmith patterns. Use when the description involves exploration, talking to NPCs, quests, or RPG-style overworld traversal.
---

# RPG Overworld

Generates Pokémon/Zelda-style top-down RPG overworld games. Layered on top of the standard pipeline — game-designer, world-architect, and codesmith all follow the usual contracts, with RPG-specific extensions defined here.

## When to use

- "Make an RPG village where…"
- "Create a top-down RPG with NPCs and dialogue"
- "Exploration game where you collect items and talk to characters"
- Any game involving overworld traversal, NPC interactions, or quest-style collect-all goals

## Genre tag

Set `gdd.genre` to `"top-down-rpg"` in the GDD. The pipeline handles it identically to `"top-down-adventure"` except for the extra codesmith patterns described below.

## World Architect — RPG tileset palette

Use 5–6 tile types that create a believable overworld:

```jsonc
[
  { "id": "GRASS",      "color": "#3a8a3a", "passable": true  },
  { "id": "PATH",       "color": "#c4a05a", "passable": true  },
  { "id": "WATER",      "color": "#3a6bc4", "passable": false },
  { "id": "STONE_WALL", "color": "#5e5e6e", "passable": false },
  { "id": "FLOWER",     "color": "#3a8a3a", "passable": true  },
  { "id": "TREE",       "color": "#1e5e1e", "passable": false }
]
```

Level design guidelines:
- Outer border: all impassable tiles (STONE_WALL or TREE)
- Central navigable area with PATH for visual guidance
- Water feature (pond/river) inside a reachable zone
- Trees and decorative clusters near borders
- Size: 18–24 tiles wide × 14–18 tall

## Entity design

Entity set must include:
- `HERO` (kind=player): blue or green, states=[idle,walk], speed=80
- 2–3 `NPC` entities (kind=npc): distinct colors, states=[idle], no speed
- 1–2 `CRYSTAL`/`ORB`/`KEY` pickups (kind=pickup): bright cyan/gold, states=[idle]

## Codesmith — RPG patterns

The `Game.js` for RPG overworld MUST implement these features:

### 1. DialogBox class (inline in Game.js)

```js
class DialogBox {
  constructor(scene) {
    const W = scene.scale.width, H = scene.scale.height;
    const BH = 82, BY = H - BH - 4;
    this.bg = scene.add.graphics().setScrollFactor(0).setDepth(200).setVisible(false);
    // draw bg panel in show()
    this.nameLabel = scene.add.text(14, BY+7, '', { fontSize:'8px', color:'#ffd84a', fontFamily:'monospace' })
      .setScrollFactor(0).setDepth(201).setVisible(false);
    this.bodyText = scene.add.text(14, BY+22, '', { fontSize:'7px', color:'#eeeeee', fontFamily:'monospace', wordWrap:{width:W-28} })
      .setScrollFactor(0).setDepth(201).setVisible(false);
    this.active = false;
    this.typing = false;
    // ...full typewriter implementation
  }
  show(name, lines) { /* typewriter line-by-line */ }
  advance()         { /* skip-to-end or next-line */ }
  hide()            { /* hide all elements */ }
}
```

### 2. 4-directional movement with X flip

```js
update() {
  const b = this.player.body;
  b.setVelocity(0);
  if (!this.dialogBox.active) {
    const left  = this.cursors.left.isDown  || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    if (left)  { b.setVelocityX(-speed); this.player.setFlipX(true); }
    if (right) { b.setVelocityX( speed); this.player.setFlipX(false); }
    // up/down + normalize diagonal
    if (b.velocity.length() > 0) {
      b.velocity.normalize().scale(speed);
      this.player.play('HERO-walk', true);
    } else {
      this.player.play('HERO-idle', true);
    }
  }
}
```

### 3. Y-depth sorting

```js
update() {
  // call every frame — entities at lower Y are drawn behind entities at higher Y
  this.player.setDepth(this.player.y + 2);
  for (const npc of this.npcs) npc.setDepth(npc.y + 2);
}
```

### 4. NPC proximity + "!" indicator

```js
create() {
  npc.indicator = this.add.text(px, py - tileSize*0.85, '!', {
    fontSize:'11px', color:'#ffe000', stroke:'#000', strokeThickness:3,
  }).setOrigin(0.5,1).setDepth(500).setVisible(false);
  this.tweens.add({ targets: npc.indicator, y:'-=4', duration:520, yoyo:true, repeat:-1 });
}
update() {
  let nearest = null, nearDist = 54;
  for (const npc of this.npcs) {
    npc.indicator.setVisible(false);
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
    if (d < nearDist && !this.dialogBox.active) { nearest=npc; nearDist=d; }
  }
  if (nearest) nearest.indicator.setVisible(true);
}
```

### 5. Crystal pickups with glow + burst

```js
// on create:
if (c.postFX) c.postFX.addGlow(0x44ddff, 5, 0, false, 0.1, 14);
this.tweens.add({ targets:c, y:c.y-5, duration:950, yoyo:true, repeat:-1 });

// on collect:
for (let i=0; i<8; i++) {
  const p = this.add.rectangle(crystal.x, crystal.y, 2, 2, 0x44ddff).setDepth(80);
  const a = (i/8)*Math.PI*2;
  this.tweens.add({ targets:p, x:p.x+Math.cos(a)*18, y:p.y+Math.sin(a)*18, alpha:0, duration:320, onComplete:()=>p.destroy() });
}
```

### 6. Win condition

Standard: `winCondition: "window.__gameState.crystalsCollected >= N"` where N = total pickups in level.

### 7. Blocking movement during dialogue

Movement input MUST be skipped while `this.dialogBox.active === true`.

## Gap checker considerations

- Genre `top-down-rpg` passes static_check with zero errors if:
  - All spawns are on passable tiles
  - All pickups + NPCs are BFS-reachable from player spawn
  - Outer border is fully impassable
- The dynamic fuzzer will report "no-win-progress" for collect-all games (expected — random input can't intentionally collect items). Treat this as a warning, not a failure.

## Example

See `examples/crystal-village/` — a village RPG where the hero collects 5 scattered crystals by exploring a 20×16 map with 3 NPCs, a water pond, trees, flowers, and cobblestone paths.

Gap-check result: `static: ✅ 0 errors | dynamic: ✅ boots, player moves, crystals glow`

## References

- `references/rpg-recipes.md` — dialogue system, NPC indicators, y-sort, crystal effects
- Colyseus multiplayer patterns: https://docs.colyseus.io/ (for multi-player extensions)
