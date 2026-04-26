# Phaser 3 recipes for codesmith

Copy-pasteable patterns. Pick whichever fits the GDD's `genre` + `controls.movement`.

## 4-direction top-down movement

```js
update() {
  if (!this.player || this.gameOver) return;
  const speed = 80;
  const b = this.player.body;
  b.setVelocity(0);
  const left  = this.cursors.left.isDown  || this.keys.A.isDown;
  const right = this.cursors.right.isDown || this.keys.D.isDown;
  const up    = this.cursors.up.isDown    || this.keys.W.isDown;
  const down  = this.cursors.down.isDown  || this.keys.S.isDown;
  if (left)  b.setVelocityX(-speed);
  if (right) b.setVelocityX( speed);
  if (up)    b.setVelocityY(-speed);
  if (down)  b.setVelocityY( speed);
  if (b.velocity.x !== 0 || b.velocity.y !== 0) {
    b.velocity.normalize().scale(speed);   // diagonal speed = orthogonal speed
    this.player.play('PLAYER-walk', true);
  } else {
    this.player.play('PLAYER-idle', true);
  }
}
```

## Platformer — gravity + jump

```js
create() {
  this.physics.world.gravity.set(0, 600);
  // ... rest of create
}

update() {
  if (!this.player || this.gameOver) return;
  const speed = 120;
  const b = this.player.body;
  const left  = this.cursors.left.isDown  || this.keys.A.isDown;
  const right = this.cursors.right.isDown || this.keys.D.isDown;
  const jumpPressed =
    Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
    Phaser.Input.Keyboard.JustDown(this.keys.W) ||
    Phaser.Input.Keyboard.JustDown(this.keys.SPACE);

  if (left)       b.setVelocityX(-speed);
  else if (right) b.setVelocityX( speed);
  else            b.setVelocityX(0);

  if (jumpPressed && b.blocked.down) b.setVelocityY(-330);

  if (!b.blocked.down)             this.player.play('PLAYER-jump', true);
  else if (b.velocity.x !== 0)     this.player.play('PLAYER-walk', true);
  else                              this.player.play('PLAYER-idle', true);
}
```

## Simple wandering enemy

```js
// On spawn:
e.dirX = Phaser.Math.Between(0, 1) ? 1 : -1;
e.dirY = Phaser.Math.Between(0, 1) ? 1 : -1;
e.setBounce(1, 1);

// In update():
for (const enemy of this.enemies.getChildren()) {
  enemy.body.setVelocity(enemy.dirX * enemy.speed, enemy.dirY * enemy.speed);
  if (enemy.body.blocked.left || enemy.body.blocked.right) enemy.dirX *= -1;
  if (enemy.body.blocked.up   || enemy.body.blocked.down)  enemy.dirY *= -1;
}
```

## Attack with a hitbox circle

```js
attack() {
  if (this.attacking) return;
  this.attacking = true;
  this.player.play('PLAYER-attack', true);
  const r = 18;
  for (const enemy of this.enemies.getChildren()) {
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < r) {
      enemy.destroy();
    }
  }
  this.time.delayedCall(220, () => {
    this.attacking = false;
    this.player.play('PLAYER-idle', true);
  });
}

// Trigger from update():
if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.attack();
```

## Projectile firing with cooldown

```js
fireBullet() {
  const sheet = this.findSheet('BULLET');
  const b = this.bullets.create(this.player.x, this.player.y - 8, sheet.tex, sheet.rowIdx * sheet.cols);
  b.setDisplaySize(8, 8);
  b.body.setSize(6, 6);
  b.body.setVelocityY(-300);
  b.play('BULLET-idle');
}

// In update():
if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && time - this.lastFire > 200) {
  this.fireBullet();
  this.lastFire = time;
}

// Cull off-screen (every update):
for (const bullet of this.bullets.getChildren()) {
  if (bullet.y < -32) bullet.destroy();
}
```

## i-frames pattern (post-hit invulnerability)

```js
this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => {
  if (this.iframes) return;
  this.iframes = true;
  this.playerHp--;
  this.player.play('PLAYER-hurt', true);
  this.cameras.main.shake(120, 0.005);
  this.time.delayedCall(500, () => {
    this.iframes = false;
    if (this.playerHp > 0) this.player.play('PLAYER-idle', true);
  });
  this.updateState();
  if (this.playerHp <= 0) this.lose();
});
```

## Win/lose overlays

```js
win() {
  this.gameOver = true; this.won = true;
  this.updateState();
  this.events.emit('game-won');
  this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'YOU WIN',
    { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
}
```

## Camera shake on damage

```js
this.cameras.main.shake(120 /* ms */, 0.005 /* intensity */);
```

## HUD that follows the camera

```js
this.hud = this.add.text(4, 4, '', { fontSize: '8px', color: '#fff', backgroundColor: '#000' })
  .setScrollFactor(0)   // don't scroll with world
  .setDepth(100);       // draw on top of game

// In updateState():
if (this.hud) this.hud.setText(`HP ${this.playerHp}  ${this.metric}/${this.target}`);
```

## Polish patterns (cheap visual wins)

**Idle bob** — gentle vertical breath on grounded, stationary entities:
```js
this.idleBob = this.tweens.add({
  targets: this.player, y: '+=1', duration: 350, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', paused: true,
});
// pause/resume in update() based on body.blocked.down && b.velocity.x === 0
```

**Coin spin illusion** — scaleX yoyo + small bob:
```js
this.tweens.add({ targets: c, scaleX: { from: 1, to: -1 }, duration: 600, yoyo: true, repeat: -1 });
this.tweens.add({ targets: c, y: c.y - 3, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
```

**Squash on jump takeoff**:
```js
this.tweens.add({ targets: this.player, scaleY: 0.85, scaleX: 1.15, duration: 90, yoyo: true });
```

**Pickup pop + particle burst** (small rectangles spreading outward):
```js
this.tweens.add({ targets: pickup, scale: pickup.scale * 1.8, alpha: 0, duration: 180, onComplete: () => pickup.destroy() });
for (let i = 0; i < 6; i++) {
  const p = this.add.rectangle(pickup.x, pickup.y, 2, 2, 0xffd84a).setDepth(50);
  const ang = (i / 6) * Math.PI * 2;
  this.tweens.add({ targets: p, x: p.x + Math.cos(ang) * 14, y: p.y + Math.sin(ang) * 14, alpha: 0, duration: 280, onComplete: () => p.destroy() });
}
```

**Hurt feedback** — tint flash + alpha blink during i-frames + camera shake:
```js
this.cameras.main.shake(140, 0.008);
this.player.setTint(0xff5555);
this.tweens.add({ targets: this.player, alpha: 0.3, duration: 80, yoyo: true, repeat: 6,
  onComplete: () => { this.player.setAlpha(1); this.player.clearTint(); } });
```

**Win celebration** — flash + scale-in text + radial particle burst:
```js
this.cameras.main.flash(280, 100, 220, 100);
const t = this.add.text(cx, cy, 'YOU WIN!', { fontSize:'32px', color:'#fff7c4', stroke:'#000', strokeThickness:4 })
  .setOrigin(0.5).setScrollFactor(0).setDepth(200).setScale(0);
this.tweens.add({ targets: t, scale: 1, duration: 360, ease: 'Back.easeOut' });
```

**Camera zoom for chunky feel**:
```js
this.cameras.main.setZoom(2);
this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
```

**Restart on R** — bind once, scene.restart wipes state cleanly:
```js
this.input.keyboard.once('keydown-R', () => this.scene.restart());
```

## Pixel-perfect rendering (already in template config, but reaffirm)

```js
// In config.js (already set):
{ pixelArt: true, roundPixels: true, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } }

// In create():
this.cameras.main.roundPixels = true;
```
