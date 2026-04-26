import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this.orbsCollected = 0;
    this.playerHp = 3;
    this.gameOver = false;
    this.attackCooldown = false;
    this.iframes = false;
  }

  create() {
    const levels = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level = levels[this.levelIndex];
    const palette = manifest.tiles;
    const tileSize = palette.tileSize;

    this.sf = tileSize / 16;
    this.tileSize = tileSize;
    const worldW = level.size[0] * tileSize;
    const worldH = level.size[1] * tileSize;

    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    const impassableIndices = palette.passable
      .map((p, i) => p ? -1 : i)
      .filter((i) => i >= 0);
    layer.setCollision(impassableIndices);
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.physics.world.setBounds(0, 0, worldW, worldH);

    const findSheet = (entityId) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(entityId);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    this.enemies = this.physics.add.group();
    this.orbs = this.physics.add.group();

    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sheet = findSheet(sp.entity);
      if (!sheet) continue;

      if (sp.entity === 'WIZARD') {
        this.player = this.physics.add.sprite(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        this.player.setCollideWorldBounds(true);
        this.player.setDisplaySize(tileSize * 1.4, tileSize * 1.4);
        this.player.body.setSize(tileSize * 0.7, tileSize * 0.7);
        this.player.body.setOffset(this.player.width * 0.15, this.player.height * 0.15);
        this.player.play('WIZARD-idle');
      } else if (sp.entity === 'SKELETON') {
        const e = this.enemies.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        e.entityId = 'SKELETON';
        e.hp = 1;
        e.dirX = Phaser.Math.Between(0, 1) ? 1 : -1;
        e.dirY = Phaser.Math.Between(0, 1) ? 1 : -1;
        e.speed = 35;
        e.setCollideWorldBounds(true);
        e.setDisplaySize(tileSize * 1.3, tileSize * 1.3);
        e.body.setSize(tileSize * 0.6, tileSize * 0.6);
        e.body.setOffset(e.width * 0.2, e.height * 0.2);
        e.play('SKELETON-idle');
      } else if (sp.entity === 'ORB') {
        const o = this.orbs.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        o.entityId = 'ORB';
        o.play('ORB-idle');
        o.setDisplaySize(tileSize * 0.7, tileSize * 0.7);
        o.body.setSize(tileSize * 0.6, tileSize * 0.6);
      }
    }

    this.physics.add.collider(this.player, layer);
    this.physics.add.collider(this.enemies, layer);

    this.physics.add.overlap(this.player, this.orbs, (_p, orb) => {
      this.collectOrb(orb);
    });

    this.physics.add.overlap(this.player, this.enemies, (_p, _enemy) => {
      this.takeDamage();
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.roundPixels = true;

    this.hud = this.add.text(4, 4, '', { fontSize: '8px', color: '#ffffff', backgroundColor: '#000000' })
      .setScrollFactor(0).setDepth(100);

    this.updateState();
    this.events.emit('scene-ready');
  }

  collectOrb(orb) {
    if (!orb.active) return;
    orb.destroy();
    this.orbsCollected++;
    this.updateState();
    if (this.orbsCollected >= 3) this.win();
  }

  takeDamage() {
    if (this.iframes || this.gameOver) return;
    this.iframes = true;
    this.playerHp--;
    this.cameras.main.shake(140, 0.008);
    this.player.setTint(0xff5555);
    this.tweens.add({
      targets: this.player, alpha: 0.3, duration: 80, yoyo: true, repeat: 6,
      onComplete: () => { this.player.setAlpha(1); this.player.clearTint(); },
    });
    this.time.delayedCall(700, () => { this.iframes = false; });
    this.updateState();
    if (this.playerHp <= 0) this.lose();
  }

  doAttack() {
    if (this.attackCooldown || this.gameOver) return;
    this.attackCooldown = true;

    const radius = 64;
    const px = this.player.x;
    const py = this.player.y;

    // Visual flash circle
    const circle = this.add.graphics();
    circle.lineStyle(2, 0x00ffcc, 1);
    circle.fillStyle(0x00ffcc, 0.25);
    circle.strokeCircle(0, 0, radius);
    circle.fillCircle(0, 0, radius);
    circle.x = px;
    circle.y = py;
    circle.setDepth(50);

    this.tweens.add({
      targets: circle, alpha: 0, duration: 300,
      onComplete: () => circle.destroy(),
    });

    // Damage enemies in radius
    for (const enemy of this.enemies.getChildren().slice()) {
      if (Phaser.Math.Distance.Between(px, py, enemy.x, enemy.y) < radius) {
        // Flash the enemy white then destroy
        enemy.setTint(0xffffff);
        this.time.delayedCall(80, () => {
          if (enemy.active) enemy.destroy();
          this.updateState();
        });
      }
    }

    this.time.delayedCall(600, () => { this.attackCooldown = false; });
  }

  update(_time, _delta) {
    if (!this.player || this.gameOver) return;

    const speed = 90 * this.sf;
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
      this.player.play('WIZARD-walk', true);
    } else {
      this.player.play('WIZARD-idle', true);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.doAttack();

    // Skeleton patrol AI
    for (const enemy of this.enemies.getChildren()) {
      enemy.body.setVelocity(enemy.dirX * enemy.speed, enemy.dirY * enemy.speed);
      if (enemy.body.blocked.left || enemy.body.blocked.right) enemy.dirX *= -1;
      if (enemy.body.blocked.up || enemy.body.blocked.down) enemy.dirY *= -1;
    }

    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.orbsCollected >= 3 ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      playerHp: this.playerHp,
      orbsCollected: this.orbsCollected,
      enemiesAlive: this.enemies ? this.enemies.countActive() : 0,
    };
    if (this.hud) this.hud.setText(`HP ${this.playerHp}  ORBS ${this.orbsCollected}/3`);
  }

  win() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-won');
    const text = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'VICTORY!',
      { fontSize: '28px', color: '#ffdd00', stroke: '#000000', strokeThickness: 4 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 + 36,
      'Press R to restart',
      { fontSize: '12px', color: '#ffffff' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.input.keyboard.once('keydown-R', () => {
      this.scene.restart({ levelIndex: 0 });
    });
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-lost');
    this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'DEFEATED',
      { fontSize: '28px', color: '#ff4444', stroke: '#000000', strokeThickness: 4 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 + 36,
      'Press R to restart',
      { fontSize: '12px', color: '#ffffff' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.input.keyboard.once('keydown-R', () => {
      this.scene.restart({ levelIndex: 0 });
    });
  }
}
