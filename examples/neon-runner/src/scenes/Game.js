import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this.chipsCollected = 0;
    this.playerHp = 3;
    this.gameOver = false;
  }

  create() {
    const levels = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level = levels[this.levelIndex];
    const palette = manifest.tiles;
    const tileSize = palette.tileSize;
    const sf = tileSize / 16;            // physics scale: speeds, gravity, jump scale with tileSize
    this.tileSize = tileSize;
    this.sf = sf;

    this.physics.world.gravity.set(0, 600 * sf);

    const worldW = level.size[0] * tileSize;
    const worldH = level.size[1] * tileSize;
    this.worldH = worldH;

    // Parallax background — drawn first so the tilemap renders on top.
    if (this.textures.exists('bg')) {
      const bg = this.add.image(worldW / 2, worldH / 2, 'bg').setDepth(-100);
      bg.setDisplaySize(worldW, worldH);
      const sFactor = manifest.bg?.scrollFactor ?? 0.2;
      bg.setScrollFactor(sFactor);
    }

    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    const impassableIndices = palette.passable.map((p, i) => p ? -1 : i).filter((i) => i >= 0);
    layer.setCollision(impassableIndices);
    this.layer = layer;

    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.physics.world.setBounds(0, 0, worldW, worldH + 200 * sf);

    const findSheet = (entityId) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(entityId);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    this.enemies = this.physics.add.group({ allowGravity: false });
    this.chips = this.physics.add.group({ allowGravity: false });

    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sheet = findSheet(sp.entity);
      if (!sheet) continue;

      if (sp.entity === 'RUNNER') {
        this.player = this.physics.add.sprite(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        this.player.setCollideWorldBounds(false);
        this.player.setDisplaySize(tileSize * 1.4, tileSize * 1.4);
        this.player.body.setSize(this.player.width * 0.5, this.player.height * 0.7);
        this.player.body.setOffset(this.player.width * 0.25, this.player.height * 0.2);
        this.player.play('RUNNER-idle');

      } else if (sp.entity === 'DRONE') {
        const e = this.enemies.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        e.entityId = 'DRONE';
        e.hp = 1;
        e.dirX = 1;
        e.speed = 60 * sf;
        e.setCollideWorldBounds(true);
        e.setBounce(1, 0);
        e.setDisplaySize(tileSize * 1.3, tileSize * 1.3);
        e.body.setSize(e.width * 0.55, e.height * 0.55);
        e.body.setOffset(e.width * 0.225, e.height * 0.225);
        e.body.setAllowGravity(false);
        e.play('DRONE-idle');
        // Drone hovers with vertical bob
        this.tweens.add({
          targets: e,
          y: e.y - 4,
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });

      } else if (sp.entity === 'CHIP') {
        const c = this.chips.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        c.entityId = 'CHIP';
        c.body.setAllowGravity(false);
        c.setDisplaySize(tileSize, tileSize);
        c.body.setSize(c.width * 0.5, c.height * 0.5);
        c.body.setOffset(c.width * 0.25, c.height * 0.25);
        c.play('CHIP-idle');
        // Data chip flicker effect
        this.tweens.add({
          targets: c,
          alpha: 0.6,
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        this.tweens.add({
          targets: c,
          y: c.y - 4,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    this.physics.add.collider(this.player, layer);
    this.physics.add.overlap(this.player, this.chips, (_p, chip) => {
      this.collectChip(chip);
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => {
      this.takeDamage(enemy);
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE,R');

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.roundPixels = true;
    this.cameras.main.fadeIn(400, 0, 0, 0);

    this.hud = this.add.text(8, 6, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#00ffcc',
      backgroundColor: 'rgba(0,0,20,0.8)', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.updateState();

    // Idle run-bob on player when grounded and stationary
    this.idleBob = this.tweens.add({
      targets: this.player,
      y: '+=1',
      duration: 350,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      paused: true,
    });

    this.events.emit('scene-ready');
  }

  collectChip(chip) {
    if (chip.collected) return;
    chip.collected = true;
    if (chip.body) chip.body.enable = false;
    this.tweens.killTweensOf(chip);
    // Pop effect: scale punch + fade out
    this.tweens.add({
      targets: chip,
      scale: chip.scale * 2,
      alpha: 0,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => chip.destroy(),
    });
    // Neon particle burst
    for (let i = 0; i < 8; i++) {
      const p = this.add.rectangle(chip.x, chip.y, 3, 3, 0x00ffcc).setDepth(50);
      const ang = (i / 8) * Math.PI * 2;
      this.tweens.add({
        targets: p,
        x: p.x + Math.cos(ang) * 18,
        y: p.y + Math.sin(ang) * 18,
        alpha: 0,
        duration: 350,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
    this.chipsCollected++;
    this.tweens.add({ targets: this.hud, scale: 1.2, duration: 80, yoyo: true });
    this.updateState();
    if (this.chipsCollected >= 5) this.win();
  }

  takeDamage(_enemy) {
    if (this.iframes || this.gameOver) return;
    this.iframes = true;
    this.playerHp--;
    this.player.setVelocityY(-220 * this.sf);
    this.cameras.main.shake(140, 0.008);
    // Red tint flash
    this.player.setTint(0xff0055);
    this.tweens.add({
      targets: this.player,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
      repeat: 8,
      onComplete: () => {
        this.player.setAlpha(1);
        this.player.clearTint();
      },
    });
    this.time.delayedCall(700, () => {
      this.iframes = false;
    });
    this.updateState();
    if (this.playerHp <= 0) this.lose();
  }

  update() {
    if (!this.player || this.gameOver) return;
    const speed = 130 * this.sf;
    const b = this.player.body;
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.W) ||
      Phaser.Input.Keyboard.JustDown(this.keys.SPACE);

    if (left)       { b.setVelocityX(-speed); this.player.setFlipX(true);  }
    else if (right) { b.setVelocityX( speed); this.player.setFlipX(false); }
    else            { b.setVelocityX(0); }

    if (jumpPressed && b.blocked.down) {
      b.setVelocityY(-330 * this.sf);
      this.tweens.add({ targets: this.player, scaleY: 0.85, duration: 80, yoyo: true });
    }

    if (!this.iframes) {
      if (!b.blocked.down) this.player.play('RUNNER-jump', true);
      else if (b.velocity.x !== 0) this.player.play('RUNNER-walk', true);
      else this.player.play('RUNNER-idle', true);
    }

    // Pause idle bob when not grounded/stationary
    const grounded = b.blocked.down && b.velocity.x === 0;
    if (grounded && this.idleBob.paused) this.idleBob.resume();
    else if (!grounded && !this.idleBob.paused) this.idleBob.pause();

    // Update drones — patrol left/right, bounce off world bounds
    for (const enemy of this.enemies.getChildren()) {
      enemy.body.setVelocityX(enemy.dirX * enemy.speed);
      if (enemy.body.blocked.left)  enemy.dirX =  1;
      if (enemy.body.blocked.right) enemy.dirX = -1;
    }

    // Player fell below world
    if (this.player.y > this.worldH + 60 * this.sf) this.lose();

    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.chipsCollected >= 5 ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      playerHp: this.playerHp,
      chipsCollected: this.chipsCollected,
      enemiesAlive: this.enemies ? this.enemies.countActive() : 0,
    };
    if (this.hud) this.hud.setText(`HP ${this.playerHp}  CHIPS ${this.chipsCollected}/5`);
  }

  win() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-won');
    this.cameras.main.flash(300, 0, 255, 204);
    const t = this.add.text(
      this.cameras.main.width / 2, this.cameras.main.height / 2 - 12,
      'MISSION COMPLETE',
      { fontFamily: 'monospace', fontSize: '24px', color: '#00ffcc', stroke: '#000', strokeThickness: 4 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200).setScale(0);
    this.tweens.add({ targets: t, scale: 1, duration: 400, ease: 'Back.easeOut' });
    const sub = this.add.text(
      this.cameras.main.width / 2, this.cameras.main.height / 2 + 24,
      'Press R to play again',
      { fontFamily: 'monospace', fontSize: '11px', color: '#aaffee', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, delay: 600, duration: 300 });
    // Neon burst
    for (let i = 0; i < 20; i++) {
      const p = this.add.rectangle(this.player.x, this.player.y, 3, 3, 0x00ffcc).setDepth(60);
      const ang = (i / 20) * Math.PI * 2;
      const dist = 40 + Math.random() * 50;
      this.tweens.add({
        targets: p,
        x: p.x + Math.cos(ang) * dist,
        y: p.y + Math.sin(ang) * dist - 10,
        alpha: 0,
        duration: 900,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-lost');
    this.cameras.main.shake(300, 0.015);
    this.cameras.main.fade(600, 0, 0, 0);
    this.time.delayedCall(700, () => {
      const t = this.add.text(
        this.cameras.main.width / 2, this.cameras.main.height / 2 - 12,
        'ACCESS DENIED',
        { fontFamily: 'monospace', fontSize: '28px', color: '#ff0055', stroke: '#000', strokeThickness: 4 }
      ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
      const sub = this.add.text(
        this.cameras.main.width / 2, this.cameras.main.height / 2 + 24,
        'Press R to retry',
        { fontFamily: 'monospace', fontSize: '11px', color: '#ddd', stroke: '#000', strokeThickness: 3 }
      ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    });
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }
}
