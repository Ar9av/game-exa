import Phaser from 'phaser';

const W = 800, H = 600;
const GRID_SIZE = 40;
const ENEMY_COLORS = { wanderer: 0xff8800, chaser: 0xff2222, splitter: 0xffee00, sentry: 0xff00ff };

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init() {
    this.score = 0;
    this.lives = 3;
    this.multiplier = 1;
    this.killStreak = 0;
    this.wave = 0;
    this.totalKills = 0;
    this.gameOver = false;
    this.playerSpeed = 220;
    this.bombs = 2;
    this.lastKillTime = 0;
    this.iframes = true;   // spawn invulnerability cleared after 1.5s in create()
    this.playerAngle = 0;
  }

  create() {
    // ─── Grid background (static render texture — no per-frame redraw) ────────
    this.gridGraphics = this.add.graphics();
    this.drawGrid();
    // Pulse alpha via tween instead of redrawing every frame
    this.tweens.add({
      targets: this.gridGraphics,
      alpha: { from: 0.5, to: 0.9 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ─── Bullet texture (must be created before player ship tex uses renderTexture) ──
    this._createBulletTexture();

    // ─── Player ship ──────────────────────────────────────────────────────────
    // Draw ship as a RenderTexture then save as a texture key
    if (!this.textures.exists('player-ship')) {
      const shipRt = this.make.renderTexture({ width: 32, height: 32, add: false });
      const shipGfx = this.add.graphics();
      shipGfx.fillStyle(0x00ffff, 1);
      shipGfx.fillTriangle(16, 0, 28, 28, 4, 28);
      shipGfx.fillStyle(0x004444, 0.6);
      shipGfx.fillTriangle(16, 8, 22, 24, 10, 24);
      shipRt.draw(shipGfx, 0, 0);
      shipRt.saveTexture('player-ship');
      shipGfx.destroy();
      shipRt.destroy();
    }

    this.player = this.physics.add.sprite(W / 2, H / 2, 'player-ship');
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85);
    this.player.postFX.addGlow(0x00ffff, 8, 0, false, 0.1, 16);

    // ─── Bullet group ─────────────────────────────────────────────────────────
    this.bullets = this.physics.add.group({ maxSize: 60, runChildUpdate: true });

    // ─── Enemy group ──────────────────────────────────────────────────────────
    this.enemies = this.physics.add.group();

    // ─── Particles (thruster — created AFTER this.player exists) ──────────────
    this.thrusterEmitter = this.add.particles(0, 0, 'bullet-tex', {
      speed: { min: 20, max: 60 },
      angle: { min: 160, max: 200 },
      scale: { start: 0.6, end: 0 },
      lifespan: { min: 80, max: 160 },
      blendMode: 'ADD',
      tint: [0x00ffff, 0x0088ff],
      frequency: 25,
      follow: this.player,
      followOffset: { x: 0, y: 12 },
    });

    // ─── Input ────────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D,SPACE,R,X');

    // ─── HUD ──────────────────────────────────────────────────────────────────
    const hudStyle = { fontFamily: 'monospace', fontSize: '14px', color: '#00ffcc', stroke: '#000', strokeThickness: 3 };
    this.scoreText = this.add.text(12, 8, 'SCORE: 0', hudStyle).setDepth(100);
    this.livesText = this.add.text(12, 26, '♦ ♦ ♦', { ...hudStyle, color: '#ff4444' }).setDepth(100);
    this.waveText  = this.add.text(W / 2, 8, 'WAVE 1', { ...hudStyle, fontSize: '18px', color: '#ffee00' }).setOrigin(0.5, 0).setDepth(100);
    this.multText  = this.add.text(W - 12, 8, '×1', { ...hudStyle, fontSize: '18px', color: '#ff8800' }).setOrigin(1, 0).setDepth(100);
    this.bombText  = this.add.text(12, H - 24, '💣 2', { ...hudStyle, color: '#ffffff' }).setDepth(100);

    // ─── High score display ───────────────────────────────────────────────────
    this.highScore = parseInt(localStorage.getItem('vb-highscore') || '0', 10);
    this.hiText = this.add.text(W - 12, 26, `HI: ${this.highScore}`, { ...hudStyle, color: '#aaaaff' }).setOrigin(1, 0).setDepth(100);

    // Physics world bounds
    this.physics.world.setBounds(0, 0, W, H);
    this.cameras.main.setBounds(0, 0, W, H);

    // ─── Collisions (set up AFTER both groups exist) ───────────────────────────
    this.setupCollisions();

    // ─── Fire timer ───────────────────────────────────────────────────────────
    this.fireTimer = this.time.addEvent({ delay: 120, loop: true, callback: this.fireIfMoving, callbackScope: this });

    // ─── Multiplier reset timer ───────────────────────────────────────────────
    this.time.addEvent({ delay: 100, loop: true, callback: this.checkMultReset, callbackScope: this });

    // Clear spawn invulnerability after 2s (wave starts at 600ms, so player gets time to move)
    this.time.delayedCall(2000, () => { this.iframes = false; });

    // Start wave 1
    this.time.delayedCall(600, () => this.startWave());

    this.updateState();
    this.events.emit('scene-ready');
    window.__gameReady = true;
  }

  // ─── Draw grid background (called once in create) ──────────────────────────
  drawGrid() {
    this.gridGraphics.lineStyle(1, 0x001144, 0.8);
    for (let x = 0; x <= W; x += GRID_SIZE) this.gridGraphics.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += GRID_SIZE) this.gridGraphics.lineBetween(0, y, W, y);
    this.gridGraphics.lineStyle(1, 0x0033aa, 0.6);
    this.gridGraphics.lineBetween(W / 2, 0, W / 2, H);
    this.gridGraphics.lineBetween(0, H / 2, W, H / 2);
  }

  // ─── Bullet texture ────────────────────────────────────────────────────────
  _createBulletTexture() {
    if (!this.textures.exists('bullet-tex')) {
      const rt = this.make.renderTexture({ width: 8, height: 8, add: false });
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 3);
      rt.draw(g, 0, 0);
      rt.saveTexture('bullet-tex');
      g.destroy();
      rt.destroy();
    }
  }

  // ─── Spawn wave ────────────────────────────────────────────────────────────
  startWave() {
    this.wave++;
    const count = 5 + this.wave * 3;
    const waveFlash = this.add.text(W / 2, H / 2, `WAVE ${this.wave}`, {
      fontFamily: 'monospace', fontSize: '48px', color: '#ffee00', stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(200).setAlpha(0);
    this.tweens.add({
      targets: waveFlash,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.5, to: 1.2 },
      duration: 400,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 600,
      onComplete: () => waveFlash.destroy(),
    });
    this.waveText.setText(`WAVE ${this.wave}`);

    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 200, () => {
        const types = ['wanderer', 'chaser', 'splitter', 'sentry'];
        const weights = this.wave < 3 ? [4, 2, 1, 0] : [2, 3, 2, 1];
        const type = this.weightedRandom(types, weights);
        this.spawnEnemy(type);
      });
    }
  }

  weightedRandom(arr, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[0];
  }

  // ─── Spawn one enemy ───────────────────────────────────────────────────────
  spawnEnemy(type) {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0)      { x = Math.random() * W; y = -30; }
    else if (side === 1) { x = W + 30; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + 30; }
    else                 { x = -30; y = Math.random() * H; }

    const color = ENEMY_COLORS[type];
    const size = type === 'sentry' ? 20 : type === 'chaser' ? 14 : 16;

    const texKey = `enemy-${type}`;
    if (!this.textures.exists(texKey)) {
      const dim = size * 2;
      const rt = this.make.renderTexture({ width: dim, height: dim, add: false });
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      if (type === 'wanderer') {
        g.fillCircle(size, size, size - 2);
        g.fillStyle(0x000000, 0.5);
        g.fillCircle(size, size, size / 2);
      } else if (type === 'chaser') {
        g.fillTriangle(size, 2, dim - 2, dim - 2, 2, dim - 2);
      } else if (type === 'splitter') {
        g.fillRect(4, 4, dim - 8, dim - 8);
        g.fillStyle(0x000000, 0.4);
        g.fillRect(size - 4, size - 4, 8, 8);
      } else if (type === 'sentry') {
        g.fillRect(2, 2, dim - 4, dim - 4);
        g.fillStyle(0x000000, 0.5);
        g.fillRect(size - 6, size - 6, 12, 12);
        g.fillStyle(color, 1);
        g.fillCircle(size, 2, 3);
      }
      rt.draw(g, 0, 0);
      rt.saveTexture(texKey);
      g.destroy();
      rt.destroy();
    }

    const e = this.enemies.create(x, y, texKey);
    e.enemyType = type;
    e.hp = type === 'sentry' ? 3 : type === 'splitter' ? 2 : 1;
    e.color = color;
    e.speed = type === 'chaser' ? 130 + this.wave * 8 : type === 'wanderer' ? 70 : type === 'sentry' ? 55 : 100;
    e.orbitAngle = Math.random() * Math.PI * 2;
    e.orbitCenter = type === 'sentry' ? new Phaser.Math.Vector2(x, y) : null;
    e.wanderAngle = Math.random() * Math.PI * 2;
    e.lastShot = 0;
    e.setCollideWorldBounds(true);
    e.setBounce(1);
    e.postFX.addGlow(color, 6, 0, false, 0.1, 10);
    if (e.body) e.body.setSize(size * 1.4, size * 1.4);

    // Give initial velocity toward center
    const vel = new Phaser.Math.Vector2(W / 2 - x, H / 2 - y).normalize().scale(e.speed);
    e.setVelocity(vel.x, vel.y);
  }

  // ─── Fire bullet ──────────────────────────────────────────────────────────
  fireIfMoving() {
    if (!this.player || !this.player.active || this.gameOver) return;
    const b = this.player.body;
    if (!b) return;
    const speed = Math.sqrt(b.velocity.x ** 2 + b.velocity.y ** 2);
    if (speed < 30) return;
    const angle = Math.atan2(b.velocity.y, b.velocity.x);
    this.spawnBullet(this.player.x, this.player.y, angle);
  }

  spawnBullet(x, y, angle) {
    let bullet = this.bullets.get();
    if (!bullet) return;
    bullet.setActive(true).setVisible(true).setTexture('bullet-tex');
    bullet.setPosition(x, y);
    if (bullet.postFX) bullet.postFX.clear();
    bullet.postFX.addGlow(0x00ffff, 4);
    bullet.setTint(0x00ffff);
    const speed = 520;
    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    bullet.lifespan = 900;
    bullet.update = (_, delta) => {
      bullet.lifespan -= delta;
      if (bullet.lifespan <= 0) {
        bullet.setActive(false).setVisible(false);
        if (bullet.body) bullet.body.reset(0, 0);
      }
    };
  }

  // ─── BOMB ─────────────────────────────────────────────────────────────────
  useBomb() {
    if (this.bombs <= 0 || this.gameOver) return;
    this.bombs--;
    this.bombText.setText(`💣 ${this.bombs}`);
    this.cameras.main.flash(300, 255, 200, 0);
    this.cameras.main.shake(400, 0.02);
    // Kill all enemies
    this.enemies.getChildren().slice().forEach((e) => {
      this.killEnemy(e, true);
    });
    // Expanding ring visual
    const ring = this.add.graphics();
    ring.lineStyle(6, 0xffee00, 1);
    ring.strokeCircle(this.player.x, this.player.y, 20);
    ring.setDepth(150);
    this.tweens.add({
      targets: ring,
      scaleX: 20, scaleY: 20, alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  // ─── Kill enemy ───────────────────────────────────────────────────────────
  killEnemy(enemy, isBomb = false) {
    if (!enemy.active) return;
    this.explode(enemy.x, enemy.y, enemy.color);

    // Splitter mechanic — split into 2 smaller versions
    if (enemy.enemyType === 'splitter' && enemy.hp <= 1 && !isBomb) {
      for (let i = 0; i < 2; i++) {
        const ex = enemy.x + Phaser.Math.Between(-20, 20);
        const ey = enemy.y + Phaser.Math.Between(-20, 20);
        const e2 = this.enemies.create(ex, ey, 'enemy-splitter');
        e2.enemyType = 'splitter-small';
        e2.hp = 1;
        e2.color = 0xffaa00;
        e2.speed = 140;
        e2.orbitCenter = null;
        e2.wanderAngle = Math.random() * Math.PI * 2;
        e2.lastShot = 0;
        e2.setScale(0.6);
        e2.setCollideWorldBounds(true).setBounce(1);
        e2.setVelocity(Phaser.Math.Between(-100, 100), Phaser.Math.Between(-100, 100));
        e2.postFX.addGlow(0xffaa00, 4);
        if (e2.body) e2.body.setSize(18, 18);
      }
    }

    enemy.destroy();
    this.totalKills++;

    const basePoints = enemy.enemyType === 'sentry' ? 300 : enemy.enemyType === 'splitter' ? 200 : 100;
    const points = Math.round(basePoints * this.multiplier);
    this.score += points;
    this.multiplier = Math.min(8, this.multiplier + 0.5);
    this.lastKillTime = this.time.now;
    this.scoreText.setText(`SCORE: ${this.score}`);
    this.multText.setText(`×${this.multiplier.toFixed(1)}`);

    // Update high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('vb-highscore', String(this.highScore));
      this.hiText.setText(`HI: ${this.highScore}`);
    }

    // Floating score popup
    const pop = this.add.text(enemy.x, enemy.y, `+${points}`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffee00',
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: pop,
      y: pop.y - 40,
      alpha: 0,
      duration: 800,
      onComplete: () => pop.destroy(),
    });

    // Check wave completion
    if (this.totalKills > 0 && this.totalKills % 10 === 0 && this.enemies.countActive() === 0) {
      if (this.totalKills >= 100) {
        this.win();
        return;
      }
      this.time.delayedCall(1500, () => this.startWave());
    }
  }

  // ─── Explosion particles ──────────────────────────────────────────────────
  explode(x, y, color) {
    const key = `exp-${color}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      g.fillCircle(5, 5, 4);
      const rt = this.make.renderTexture({ width: 10, height: 10, add: false });
      rt.draw(g, 0, 0);
      rt.saveTexture(key);
      g.destroy();
      rt.destroy();
    }

    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = this.physics.add.image(x, y, key);
      const angle = (i / count) * Math.PI * 2;
      const speed = Phaser.Math.Between(80, 200);
      p.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      p.setTint(color);
      p.setAlpha(1);
      p.setScale(Phaser.Math.FloatBetween(0.5, 1.2));
      if (p.body) {
        p.body.setDamping(true);
        p.body.setDrag(0.88);
      }
      this.tweens.add({
        targets: p,
        alpha: 0,
        duration: Phaser.Math.Between(250, 550),
        onComplete: () => { if (p && p.active) p.destroy(); },
      });
    }

    // Flash ring
    const ring = this.add.graphics();
    ring.lineStyle(3, color, 0.9);
    ring.strokeCircle(x, y, 10);
    ring.setDepth(50);
    this.tweens.add({
      targets: ring,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy(),
    });
  }

  // ─── Multiplier reset ──────────────────────────────────────────────────────
  checkMultReset() {
    if (this.gameOver) return;
    if (this.multiplier > 1 && (this.time.now - this.lastKillTime) > 3000) {
      this.multiplier = 1;
      this.multText.setText('×1');
    }
  }

  // ─── Enemy AI ─────────────────────────────────────────────────────────────
  updateEnemies(delta) {
    if (!this.player || !this.player.active) return;
    const px = this.player.x, py = this.player.y;

    this.enemies.getChildren().forEach((e) => {
      if (!e.active || !e.body) return;

      switch (e.enemyType) {
        case 'wanderer': {
          e.wanderAngle += (Math.random() - 0.5) * 0.08;
          e.setVelocity(Math.cos(e.wanderAngle) * e.speed, Math.sin(e.wanderAngle) * e.speed);
          break;
        }
        case 'chaser': {
          const cx = px - e.x, cy = py - e.y;
          const dist = Math.sqrt(cx * cx + cy * cy);
          if (dist > 1) e.setVelocity(cx / dist * e.speed, cy / dist * e.speed);
          break;
        }
        case 'sentry': {
          if (!e.orbitCenter) e.orbitCenter = new Phaser.Math.Vector2(e.x, e.y);
          e.orbitAngle += 0.025;
          const ox = e.orbitCenter.x + Math.cos(e.orbitAngle) * 80;
          const oy = e.orbitCenter.y + Math.sin(e.orbitAngle) * 80;
          // Drift orbit center slowly toward player
          e.orbitCenter.x += (px - e.orbitCenter.x) * 0.001;
          e.orbitCenter.y += (py - e.orbitCenter.y) * 0.001;
          const sv = new Phaser.Math.Vector2(ox - e.x, oy - e.y).normalize().scale(e.speed);
          e.setVelocity(sv.x, sv.y);
          // Fire at player every 2s
          if (this.time.now - e.lastShot > 2000) {
            e.lastShot = this.time.now;
            const a = Math.atan2(py - e.y, px - e.x);
            this.spawnEnemyBullet(e.x, e.y, a, 0xff00ff);
          }
          break;
        }
        case 'splitter':
        case 'splitter-small': {
          // Bounce off walls via physics + slight player-seek
          const bx = px - e.x, by = py - e.y;
          const bd = Math.sqrt(bx * bx + by * by);
          if (bd > 1 && bd < 200) {
            e.setVelocity(
              e.body.velocity.x + bx / bd * 15,
              e.body.velocity.y + by / bd * 15,
            );
          }
          const spd = Math.sqrt(e.body.velocity.x ** 2 + e.body.velocity.y ** 2);
          if (spd > e.speed) {
            e.setVelocity(e.body.velocity.x / spd * e.speed, e.body.velocity.y / spd * e.speed);
          }
          break;
        }
      }

      // Rotate sprite to face velocity
      if (e.body && (e.body.velocity.x !== 0 || e.body.velocity.y !== 0)) {
        e.setRotation(Math.atan2(e.body.velocity.y, e.body.velocity.x) + Math.PI / 2);
      }
    });
  }

  spawnEnemyBullet(x, y, angle, color) {
    const key = `ebullet-${color}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(color, 1);
      g.fillCircle(5, 5, 4);
      const rt = this.make.renderTexture({ width: 10, height: 10, add: false });
      rt.draw(g, 0, 0);
      rt.saveTexture(key);
      g.destroy();
      rt.destroy();
    }

    const b = this.physics.add.image(x, y, key);
    b.setTint(color);
    b.isEnemyBullet = true;
    b.postFX.addGlow(color, 5);
    b.setVelocity(Math.cos(angle) * 280, Math.sin(angle) * 280);

    this.time.delayedCall(2500, () => {
      if (b && b.active) b.destroy();
    });

    // Overlap check with player
    this.physics.add.overlap(b, this.player, () => {
      if (!b.active) return;
      b.destroy();
      this.takeDamage();
    });
  }

  // ─── Take damage ──────────────────────────────────────────────────────────
  takeDamage() {
    if (this.iframes || this.gameOver) return;
    this.iframes = true;
    this.lives--;
    const hearts = this.lives > 0 ? ('♦ '.repeat(this.lives)).trim() : ' ';
    this.livesText.setText(hearts);
    this.cameras.main.shake(300, 0.018);
    this.cameras.main.flash(200, 255, 0, 0);
    // Red grid flash
    this.tweens.add({ targets: this.gridGraphics, alpha: 0.3, duration: 80, yoyo: true });
    if (this.player && this.player.active) {
      this.player.setTint(0xff4444);
      this.tweens.add({
        targets: this.player, alpha: 0.4, duration: 100, yoyo: true, repeat: 5,
        onComplete: () => {
          if (this.player && this.player.active) {
            this.player.setAlpha(1);
            this.player.clearTint();
          }
        },
      });
    }
    this.time.delayedCall(1200, () => { this.iframes = false; });
    this.updateState();
    if (this.lives <= 0) this.lose();
  }

  // ─── Collisions ───────────────────────────────────────────────────────────
  setupCollisions() {
    // Bullet vs enemy
    this.physics.add.overlap(this.bullets, this.enemies, (bullet, enemy) => {
      if (!bullet.active || !enemy.active) return;
      bullet.setActive(false).setVisible(false);
      if (bullet.body) bullet.body.reset(0, 0);
      enemy.hp--;
      if (enemy.hp <= 0) {
        this.killEnemy(enemy);
      } else {
        // Hit flash
        this.tweens.add({ targets: enemy, alpha: 0.4, duration: 60, yoyo: true });
      }
    });

    // Player vs enemy body
    this.physics.add.overlap(this.player, this.enemies, () => this.takeDamage());
  }

  // ─── Win/Lose ─────────────────────────────────────────────────────────────
  win() {
    this.gameOver = true;
    this.updateState();
    this.cameras.main.flash(500, 0, 255, 180);

    const t = this.add.text(W / 2, H / 2, 'VOID CLEARED', {
      fontFamily: 'monospace', fontSize: '48px', color: '#00ffcc', stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(300).setScale(0);
    this.tweens.add({ targets: t, scale: 1, duration: 500, ease: 'Back.easeOut' });

    const scoreLabel = this.add.text(W / 2, H / 2 + 54, `FINAL SCORE: ${this.score}`, {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffee00',
    }).setOrigin(0.5).setDepth(300).setAlpha(0);
    this.tweens.add({ targets: scoreLabel, alpha: 1, duration: 400, delay: 500 });

    this.add.text(W / 2, H / 2 + 86, 'Press R to play again', {
      fontFamily: 'monospace', fontSize: '14px', color: '#888',
    }).setOrigin(0.5).setDepth(300);

    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    if (this.thrusterEmitter) this.thrusterEmitter.stop();

    if (this.player && this.player.active) {
      this.explode(this.player.x, this.player.y, 0x00ffff);
      this.explode(this.player.x, this.player.y, 0xffffff);
      this.player.destroy();
    }

    this.cameras.main.shake(500, 0.025);
    this.cameras.main.fade(800, 100, 0, 0);

    this.time.delayedCall(900, () => {
      this.cameras.main.resetFX();
      this.add.text(W / 2, H / 2, 'GAME OVER', {
        fontFamily: 'monospace', fontSize: '52px', color: '#ff2222', stroke: '#000', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(300);

      this.add.text(W / 2, H / 2 + 58, `SCORE: ${this.score}  |  WAVE: ${this.wave}`, {
        fontFamily: 'monospace', fontSize: '18px', color: '#ffee00',
      }).setOrigin(0.5).setDepth(300);

      this.add.text(W / 2, H / 2 + 88, 'Press R to retry', {
        fontFamily: 'monospace', fontSize: '14px', color: '#888',
      }).setOrigin(0.5).setDepth(300);

      this.input.keyboard.once('keydown-R', () => this.scene.restart());
    });
  }

  // ─── State ────────────────────────────────────────────────────────────────
  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.lives <= 0 ? 'lost' : 'won') : 'playing',
      playerX: this.player?.x ?? 0,
      playerY: this.player?.y ?? 0,
      playerHp: this.lives,
      score: this.score,
      wave: this.wave,
      enemiesAlive: this.enemies?.countActive() ?? 0,
    };
  }

  // ─── Main loop ────────────────────────────────────────────────────────────
  update(time, delta) {
    if (this.gameOver) return;
    if (!this.player?.active) return;


    const speed = this.playerSpeed;
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.wasd.A.isDown) vx = -speed;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx =  speed;
    if (this.cursors.up.isDown    || this.wasd.W.isDown) vy = -speed;
    if (this.cursors.down.isDown  || this.wasd.S.isDown) vy =  speed;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    this.player.setVelocity(vx, vy);

    // Rotate player to face movement direction
    if (vx !== 0 || vy !== 0) {
      this.playerAngle = Math.atan2(vy, vx) + Math.PI / 2;
    }
    this.player.setRotation(this.playerAngle);

    // Bomb
    if (Phaser.Input.Keyboard.JustDown(this.wasd.X) ||
        Phaser.Input.Keyboard.JustDown(this.cursors.space)) {
      this.useBomb();
    }

    this.updateEnemies(delta);
    this.updateState();
  }
}
