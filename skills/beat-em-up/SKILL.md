---
name: beat-em-up
description: Generates side-scrolling beat-em-up games (Double Dragon / Final Fight style) with pseudo-3D Y-depth movement, punch/kick combat, enemy AI, score HUD, and layered parallax backgrounds. Provides codesmith patterns for the genre. Use when the description involves street brawling, beat-em-up, fighting through waves of enemies.
---

# Beat-Em-Up

Classic side-scrolling brawler. Characters occupy a pseudo-3D "lane" — X is left/right, Y is depth into the screen. Y-position determines render depth (y-sort) and what counts as the same "row" for melee contact.

## When to use

- "Make a beat-em-up / brawler / street fighter"
- "Game where I fight through waves of enemies"
- "Double Dragon / Final Fight / River City Ransom style game"

## Genre settings

```jsonc
{
  "genre": "beat-em-up",
  "controls": {
    "movement": "4-direction",
    "actions": [
      { "key": "SPACE", "name": "attack", "description": "Punch nearby enemies" },
      { "key": "Z",     "name": "jump",   "description": "Jump over obstacles" }
    ]
  }
}
```

## Tileset palette

```jsonc
[
  { "id": "GROUND",  "color": "#8b5e3c", "passable": true  },
  { "id": "WALL",    "color": "#4a3020", "passable": false },
  { "id": "SHADOW",  "color": "#6b4a2a", "passable": true  },
  { "id": "PROP",    "color": "#7a6040", "passable": false }
]
```

Level layout: wide horizontal strip (30-40 tiles wide, 12-14 tiles tall). Ground fills rows 6-12. Wall tiles border top and bottom. Camera scrolls rightward only as player advances. Player cannot scroll camera back left.

## Entity design

```jsonc
[
  { "id": "BRAWLER", "kind": "player", "color": "teal-blue", "desc": "Muscular hero in leather jacket and jeans", "states": ["idle","walk"], "speed": 90, "hp": 5 },
  { "id": "THUG",    "kind": "enemy",  "color": "dark-grey",  "desc": "Street thug in torn shirt and sunglasses", "states": ["idle","walk"], "speed": 55, "hp": 2 },
  { "id": "BOSS",    "kind": "boss",   "color": "red-black",  "desc": "Large gang leader in red jacket",          "states": ["idle","walk"], "speed": 40, "hp": 8 }
]
```

## Background (REQUIRED for this genre)

Always invoke `bg-artist` with `--theme forest-park` or `--theme city-street` or `--theme warehouse` depending on the level theme. The layered background is what makes the genre look correct.

- `scrollFactor: 0.4` for mid-layer (trunks/buildings)
- `scrollFactor: 0.2` for far layer (sky/canopy)

## Codesmith — Game.js patterns

### Core constants

```js
const FLOOR_Y_MIN = 160;   // topmost Y the player can walk (world coords)
const FLOOR_Y_MAX = 280;   // bottommost Y
const ATTACK_RANGE_X = 48; // horizontal punch range
const ATTACK_RANGE_Y = 20; // vertical (depth) punch range
const ATTACK_DURATION = 220; // ms the hitbox is active
const SCROLL_LOCK_X = 100; // camera left-lock so player can't scroll back
```

### Pseudo-3D movement

```js
// In update(): player moves in X and Y, clamped to floor band
const speed = 90;
b.setVelocity(0, 0);
if (left)  b.setVelocityX(-speed);
if (right) b.setVelocityX(+speed);
if (up)    b.setVelocityY(-speed * 0.6); // Y feels "deeper" so scale
if (down)  b.setVelocityY(+speed * 0.6);

// Clamp to floor band
this.player.y = Phaser.Math.Clamp(this.player.y, FLOOR_Y_MIN, FLOOR_Y_MAX);

// Y-sort depth (higher Y = drawn in front)
this.player.setDepth(this.player.y);
for (const e of this.enemies) e.setDepth(e.y);

// Camera scrolls rightward only (one-way lock)
const camX = Math.max(this.cameras.main.scrollX, this.player.x - this.scale.width * 0.4);
this.cameras.main.setScroll(camX, 0);
```

### Attack system

```js
// In create():
this.attacking = false;
this.attackBox = this.add.rectangle(0, 0, ATTACK_RANGE_X, ATTACK_RANGE_Y * 2, 0xffff00, 0).setDepth(999);

// On SPACE keydown:
_onAttack() {
  if (this.attacking || this.gameOver) return;
  this.attacking = true;
  // Flash tint on player to indicate attack frame
  this.player.setTint(0xffddaa);
  this.time.delayedCall(ATTACK_DURATION, () => {
    this.attacking = false;
    this.player.clearTint();
  });
}

// In update(): check hitbox against enemies while attacking
if (this.attacking) {
  const px = this.player.x + (this.facingRight ? ATTACK_RANGE_X * 0.5 : -ATTACK_RANGE_X * 0.5);
  for (const enemy of this.enemies) {
    if (enemy.hp <= 0) continue;
    if (Math.abs(enemy.x - px) < ATTACK_RANGE_X &&
        Math.abs(enemy.y - this.player.y) < ATTACK_RANGE_Y) {
      this._hitEnemy(enemy);
    }
  }
}

_hitEnemy(enemy) {
  if (enemy.hitCooldown) return;
  enemy.hp--;
  enemy.hitCooldown = true;
  enemy.setTint(0xff4444);
  this.cameras.main.shake(80, 0.005);
  this.score += 100;
  this.time.delayedCall(300, () => {
    enemy.hitCooldown = false;
    enemy.clearTint();
  });
  if (enemy.hp <= 0) this._killEnemy(enemy);
}

_killEnemy(enemy) {
  this.enemiesDefeated++;
  this.tweens.add({ targets: enemy, alpha: 0, y: enemy.y - 20, duration: 400,
    onComplete: () => { enemy.indicator?.destroy(); enemy.destroy(); }});
  this.enemies = this.enemies.filter(e => e !== enemy);
  this.updateState();
  if (this.enemiesDefeated >= this.WIN_ENEMIES) this.win();
}
```

### Enemy AI

```js
// In create(): spawn enemies on a timer
this.time.addEvent({
  delay: 2200,
  loop: true,
  callback: () => {
    if (this.enemies.length < 4 && !this.gameOver) this._spawnEnemy();
  }
});

_spawnEnemy() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const spawnX = this.player.x + side * (this.scale.width * 0.6 + 40);
  const spawnY = Phaser.Math.Between(FLOOR_Y_MIN + 20, FLOOR_Y_MAX - 20);
  const sh = this.findSheet('THUG');
  if (!sh) return;
  const enemy = this.add.sprite(spawnX, spawnY, sh.tex, sh.rowIdx * sh.cols);
  enemy.hp = 2;
  enemy.hitCooldown = false;
  enemy.setDisplaySize(40, 48);
  enemy.setDepth(spawnY);
  enemy.play('THUG-idle');
  this.enemies.push(enemy);
}

// In update(): enemy AI
for (const enemy of this.enemies) {
  if (enemy.hp <= 0) continue;
  const dx = this.player.x - enemy.x;
  const dy = this.player.y - enemy.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 8) {
    enemy.x += (dx / dist) * 55 * (delta / 1000);
    enemy.y += (dy / dist) * 55 * (delta / 1000);
    enemy.y = Phaser.Math.Clamp(enemy.y, FLOOR_Y_MIN, FLOOR_Y_MAX);
    enemy.setFlipX(dx < 0);
    enemy.play('THUG-walk', true);
    enemy.setDepth(enemy.y);
  } else {
    enemy.play('THUG-idle', true);
    // Enemy attacks player
    if (!enemy.attackTimer) {
      enemy.attackTimer = true;
      this.time.delayedCall(800, () => {
        enemy.attackTimer = false;
        if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) < 40)
          this._enemyHitPlayer();
      });
    }
  }
}
```

### HUD — health bar + score

```js
// In create():
_buildHud() {
  const W = this.scale.width;
  // Background panel
  this.hudBg = this.add.graphics().setScrollFactor(0).setDepth(300);
  this.hudBg.fillStyle(0x000000, 0.8);
  this.hudBg.fillRect(0, 0, W, 36);
  this.hudBg.lineStyle(1, 0x444444, 1);
  this.hudBg.lineBetween(0, 36, W, 36);

  // HP bar (red fill, gray track)
  this.hpTrack = this.add.graphics().setScrollFactor(0).setDepth(301);
  this.hpTrack.fillStyle(0x333333, 1);
  this.hpTrack.fillRect(8, 8, 120, 10);
  this.hpBar = this.add.graphics().setScrollFactor(0).setDepth(302);

  // Score
  this.scoreText = this.add.text(W - 8, 8, 'SCORE  000000', {
    fontSize: '8px', color: '#ffffff', fontFamily: 'monospace',
    stroke: '#000', strokeThickness: 2,
  }).setScrollFactor(0).setDepth(302).setOrigin(1, 0);

  // Player name label
  this.add.text(8, 20, 'PLAYER', {
    fontSize: '6px', color: '#aaaaaa', fontFamily: 'monospace',
  }).setScrollFactor(0).setDepth(302);

  this._redrawHud();
}

_redrawHud() {
  const pct = Math.max(0, this.playerHp / this.MAX_HP);
  this.hpBar.clear();
  this.hpBar.fillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xffaa00 : 0xcc2222, 1);
  this.hpBar.fillRect(8, 8, Math.round(120 * pct), 10);
  this.scoreText.setText('SCORE  ' + String(this.score).padStart(6, '0'));
}
```

### win / lose / updateState

```js
updateState() {
  window.__gameState = {
    phase:            this.gameOver ? (this.won ? 'won' : 'lost') : 'playing',
    playerX:          this.player?.x ?? 0,
    playerY:          this.player?.y ?? 0,
    playerHp:         this.playerHp,
    score:            this.score,
    enemiesDefeated:  this.enemiesDefeated,
  };
  this._redrawHud();
}
```

## Visual notes

- **No tile collision for floor** — the floor is visual only. Physics world gravity = 0 (no gravity). The Y floor band is enforced by clamping, not physics.
- **Shadow under each character** — draw a small dark ellipse at `(sprite.x, FLOOR_Y_MAX + 4)` that scales with distance from back-Y: closer to front = larger shadow. Adds huge depth for minimal code.
- **Punch flash** — set `setTint(0xffddaa)` for 220ms on the attacking character, clear after. No separate attack sprite frame needed.
- **Enemy variety** — if multiple enemy IDs exist, alternate spawning. Boss spawns after `enemiesDefeated >= WIN_ENEMIES - 2`.
