---
name: action-platformer
description: Generates side-scrolling action platformers (Shovel Knight / Metroidvania style) with gravity, jump with coyote-time, hazard tiles, atmospheric dungeon/cave backgrounds, and a rich HUD. Use when the description involves jumping between platforms, dungeon exploration, or gravity-based traversal with combat.
---

# Action Platformer

Gravity-driven side-scroller. Think Shovel Knight, Cave Story, early Castlevania. The key visual signature is a rich multi-layer dungeon/forest background combined with detailed character sprites and environmental hazards.

## When to use

- "Make a platformer with dungeons / caves / dark atmosphere"
- "Shovel Knight / Metroidvania style game"
- "Side-scrolling platform game with combat"

## Genre settings

```jsonc
{
  "genre": "action-platformer",
  "controls": {
    "movement": "platformer",
    "actions": [
      { "key": "SPACE", "name": "jump",   "description": "Jump; coyote-time for 80ms after leaving platform" },
      { "key": "Z",     "name": "attack", "description": "Swing sword forward" }
    ]
  }
}
```

## Tileset palette

Use the **transparent-SKY trick**: make the first tile SKY (passable, transparent — chroma-key to alpha so the bg-artist parallax shows through).

```jsonc
[
  { "id": "SKY",   "color": "#FF00FF", "passable": true  },
  { "id": "BRICK", "color": "#3a3050", "passable": false },
  { "id": "DIRT",  "color": "#5a4030", "passable": false },
  { "id": "SPIKE", "color": "#808080", "passable": true  },
  { "id": "CHEST", "color": "#c8a020", "passable": true  }
]
```

Level layout: tall vertical world (20-24 wide, 28-36 tall). Platforms at varied heights. Spike hazards on some floors. Secret alcoves. Camera follows player in both axes.

## Background (REQUIRED)

Always use `bg-artist` with `--theme dungeon` or `--theme outdoor-night`. Apply `scrollFactor: 0.25`. The dark, atmospheric bg is essential for the visual identity of this genre.

## Entity design

```jsonc
[
  { "id": "HERO",   "kind": "player", "color": "teal-mint", "desc": "Small adventurer with short hair, tunic, and boots", "states": ["idle","walk","jump"], "speed": 120, "hp": 4 },
  { "id": "GOBLIN", "kind": "enemy",  "color": "dark-green", "desc": "Small round goblin with pointy ears and big eyes",  "states": ["idle","walk"],        "speed": 50,  "hp": 1 },
  { "id": "ORB",    "kind": "pickup", "color": "glowing-cyan","desc": "Floating magic orb with inner glow",               "states": ["idle"],               "speed": 0,   "hp": 0 },
  { "id": "CHEST",  "kind": "pickup", "color": "gold-brown",  "desc": "Treasure chest",                                   "states": ["idle"],               "speed": 0,   "hp": 0 }
]
```

## Codesmith — Game.js patterns

### Physics setup

```js
// In create():
this.physics.world.gravity.y = 520;
this.player.setCollideWorldBounds(true);
this.player.body.setMaxVelocityY(600);

// Coyote time
this.coyoteTimer = 0;
const COYOTE_MS = 80;
```

### Jump with coyote time

```js
// In update():
const onGround = this.player.body.blocked.down;
if (onGround) this.coyoteTimer = COYOTE_MS;
else this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);

if (jumpJustDown && this.coyoteTimer > 0 && !this.isJumping) {
  this.player.body.setVelocityY(-380);
  this.coyoteTimer = 0;
  this.isJumping = true;
}
if (onGround) this.isJumping = false;

// Variable height: release jump early to cut arc
if (!jumpDown && this.player.body.velocity.y < -100) {
  this.player.body.setVelocityY(this.player.body.velocity.y * 0.88);
}
```

### Spike hazard tile

```js
// In create() after layer setup:
// Tile index for SPIKE
const spikeIdx = manifest.tiles.ids.indexOf('SPIKE');
if (spikeIdx >= 0) {
  layer.setTileIndexCallback(spikeIdx, () => {
    if (this.iframes) return;
    this._hurtPlayer(1);
  }, this);
}

_hurtPlayer(dmg) {
  if (this.iframes || this.gameOver) return;
  this.playerHp = Math.max(0, this.playerHp - dmg);
  this.iframes = true;
  this.player.setTint(0xff4444);
  this.cameras.main.shake(120, 0.012);
  this.time.delayedCall(900, () => {
    this.iframes = false;
    this.player.clearTint();
  });
  this.updateState();
  if (this.playerHp <= 0) this.lose();
}
```

### Attack

```js
// On Z key:
_onAttack() {
  if (this.attackCooldown || this.gameOver) return;
  this.attackCooldown = true;
  this.player.setTint(0xffffff);
  // Hitbox in front of player
  const hx = this.player.x + (this.facingRight ? 28 : -28);
  for (const enemy of this.enemies) {
    if (Math.abs(enemy.x - hx) < 36 && Math.abs(enemy.y - this.player.y) < 24) {
      this._killEnemy(enemy);
    }
  }
  this.time.delayedCall(200, () => {
    this.attackCooldown = false;
    this.player.clearTint();
  });
}
```

### HUD — HP gems + score

```js
_buildHud() {
  const HP_GEM_SIZE = 7, HP_GEM_GAP = 3;
  // Draw HP as small diamond gems
  this.hpGems = [];
  for (let i = 0; i < this.MAX_HP; i++) {
    const g = this.add.graphics().setScrollFactor(0).setDepth(300);
    this._drawGem(g, 8 + i * (HP_GEM_SIZE + HP_GEM_GAP), 8, HP_GEM_SIZE, 0x44ddff);
    this.hpGems.push(g);
  }
  this.scoreText = this.add.text(this.scale.width - 6, 6, 'SCORE 0', {
    fontSize: '7px', color: '#ffffff', fontFamily: 'monospace',
    stroke: '#000', strokeThickness: 2,
  }).setScrollFactor(0).setDepth(300).setOrigin(1, 0);
}

_drawGem(g, x, y, sz, color) {
  g.clear();
  g.fillStyle(color, 1);
  g.fillTriangle(x + sz/2, y, x, y + sz/2, x + sz, y + sz/2);
  g.fillTriangle(x, y + sz/2, x + sz/2, y + sz, x + sz, y + sz/2);
}

_redrawHud() {
  for (let i = 0; i < this.hpGems.length; i++)
    this._drawGem(this.hpGems[i], 8 + i * 10, 8, 7, i < this.playerHp ? 0x44ddff : 0x223344);
  this.scoreText.setText('SCORE ' + this.score);
}
```

## Visual notes

- **Atmospheric parallax**: bg scrollFactor 0.25 makes dungeon walls drift slowly — critical for depth perception.
- **Player light**: optionally add a `this.add.pointlight(player.x, player.y, 0x88ffcc, 120, 0.06)` that follows the player for dungeon ambience.
- **Spike tile visual**: SPIKE tiles should be rendered by the tileset, but optionally draw small triangles using graphics for extra visual clarity.
- **Jump animation**: Use `HERO-jump` frame (if available) when `body.velocity.y < 0`, else idle/walk.
- **Respawn**: On lose, restart scene with `this.scene.restart({ levelIndex: 0 })` after a 1.5s delay.
