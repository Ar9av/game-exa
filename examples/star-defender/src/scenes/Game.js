import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this.asteroidsDestroyed = 0;
    this.playerHp = 3;
    this.gameOver = false;
    this.lastSpawn = 0;
    this.lastFire = 0;
  }

  create() {
    const levels = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level = levels[this.levelIndex];
    const palette = manifest.tiles;
    const tileSize = palette.tileSize;
    this.sf = tileSize / 16;
    this.tileSize = tileSize;

    this.worldW = level.size[0] * tileSize;
    this.worldH = level.size[1] * tileSize;

    if (this.textures.exists('bg')) {
      const bg = this.add.image(this.worldW / 2, this.worldH / 2, 'bg').setDepth(-100);
      bg.setDisplaySize(this.worldW, this.worldH);
      bg.setScrollFactor(manifest.bg?.scrollFactor ?? 0.3);
    }

    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    map.createLayer(0, tileset, 0, 0);

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.physics.world.setBounds(0, 0, this.worldW, this.worldH);

    const findSheet = (entityId) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(entityId);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    this.findSheet = findSheet;
    this.bullets = this.physics.add.group({ allowGravity: false });
    this.asteroids = this.physics.add.group({ allowGravity: false });

    const playerSpawn = level.spawns.find((s) => s.entity === 'SHIP');
    const ps = findSheet('SHIP');
    this.player = this.physics.add.sprite(
      playerSpawn.x * tileSize + tileSize / 2,
      playerSpawn.y * tileSize + tileSize / 2,
      ps.tex,
      ps.rowIdx * ps.cols,
    );
    this.player.setCollideWorldBounds(true);
    this.player.setDisplaySize(tileSize * 1.4, tileSize * 1.4);
    this.player.body.setSize(this.player.width * 0.55, this.player.height * 0.55);
    this.player.body.setOffset(this.player.width * 0.225, this.player.height * 0.225);
    this.player.play('SHIP-idle');

    this.physics.add.overlap(this.bullets, this.asteroids, (bullet, asteroid) => {
      bullet.destroy();
      asteroid.destroy();
      this.asteroidsDestroyed++;
      this.updateState();
      if (this.asteroidsDestroyed >= 10) this.win();
    });

    this.physics.add.overlap(this.player, this.asteroids, (_p, asteroid) => {
      if (this.iframes) return;
      this.iframes = true;
      this.playerHp--;
      asteroid.destroy();
      this.cameras.main.shake(140, 0.008);
      this.player.setTint(0xff5555);
      this.tweens.add({ targets: this.player, alpha: 0.3, duration: 80, yoyo: true, repeat: 6,
        onComplete: () => { this.player.setAlpha(1); this.player.clearTint(); } });
      this.time.delayedCall(700, () => { this.iframes = false; });
      this.updateState();
      if (this.playerHp <= 0) this.lose();
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    // Auto-fire every 300ms while player is moving (helps fuzzer too)
    this.autoFireTimer = this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => {
        if (!this.player || this.gameOver) return;
        const b = this.player.body;
        if (b && (b.velocity.x !== 0 || b.velocity.y !== 0)) this.fireBullet();
      },
    });

    this.hud = this.add.text(4, 4, '', { fontSize: '8px', color: '#ffffff', backgroundColor: '#000000' }).setScrollFactor(0).setDepth(100);
    this.updateState();
    this.events.emit('scene-ready');
  }

  spawnAsteroid() {
    const tileSize = this.registry.get('manifest').tiles.tileSize;
    const sheet = this.findSheet('ASTEROID');
    if (!sheet) return;
    const x = Phaser.Math.Between(tileSize, this.worldW - tileSize);
    const a = this.asteroids.create(x, -tileSize, sheet.tex, sheet.rowIdx * sheet.cols);
    a.setDisplaySize(tileSize * 1.3, tileSize * 1.3);
    a.body.setSize(a.width * 0.55, a.height * 0.55);
    a.body.setOffset(a.width * 0.225, a.height * 0.225);
    a.body.setVelocityY(60 * this.sf);
    a.play('ASTEROID-idle');
  }

  fireBullet() {
    const tileSize = this.registry.get('manifest').tiles.tileSize;
    const sheet = this.findSheet('BULLET');
    if (!sheet) return;
    const b = this.bullets.create(this.player.x, this.player.y - tileSize / 2, sheet.tex, sheet.rowIdx * sheet.cols);
    b.setDisplaySize(tileSize * 0.6, tileSize * 0.6);
    b.body.setSize(b.width * 0.5, b.height * 0.5);
    b.body.setOffset(b.width * 0.25, b.height * 0.25);
    b.body.setVelocityY(-300 * this.sf);
    b.play('BULLET-idle');
  }

  update(time) {
    if (!this.player || this.gameOver) return;
    const speed = 140 * this.sf;
    const b = this.player.body;
    b.setVelocity(0);
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;
    if (left) b.setVelocityX(-speed);
    if (right) b.setVelocityX(speed);
    if (up) b.setVelocityY(-speed);
    if (down) b.setVelocityY(speed);
    if (b.velocity.x !== 0 || b.velocity.y !== 0) {
      b.velocity.normalize().scale(speed);
      this.player.play('SHIP-walk', true);
    } else if (!this.iframes) {
      this.player.play('SHIP-idle', true);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && time - this.lastFire > 200) {
      this.fireBullet();
      this.lastFire = time;
    }

    if (time - this.lastSpawn > 800) {
      this.spawnAsteroid();
      this.lastSpawn = time;
    }

    // Cull bullets and asteroids that left the world.
    for (const bullet of this.bullets.getChildren()) {
      if (bullet.y < -32) bullet.destroy();
    }
    for (const asteroid of this.asteroids.getChildren()) {
      if (asteroid.y > this.worldH + 32) asteroid.destroy();
    }

    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.asteroidsDestroyed >= 10 ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      playerHp: this.playerHp,
      asteroidsDestroyed: this.asteroidsDestroyed,
      enemiesAlive: this.asteroids ? this.asteroids.countActive() : 0,
    };
    if (this.hud) this.hud.setText(`HP ${this.playerHp}  KILLS ${this.asteroidsDestroyed}/10`);
  }

  win() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-won');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'YOU WIN', { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-lost');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'GAME OVER', { fontSize: '24px', color: '#f44' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }
}
