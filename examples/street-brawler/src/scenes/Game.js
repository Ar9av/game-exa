const FLOOR_Y_MIN  = 185;
const FLOOR_Y_MAX  = 315;
const PLAYER_SPEED = 90;
const ATTACK_RANGE_X = 50;
const ATTACK_RANGE_Y = 24;
const ATTACK_DURATION = 220;
const WIN_ENEMIES  = 12;

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex    = data.levelIndex ?? 0;
    this.playerHp      = 5;
    this.MAX_HP        = 5;
    this.score         = 0;
    this.enemiesDefeated = 0;
    this.gameOver      = false;
    this.won           = false;
    this.facingRight   = true;
    this.attacking     = false;
    this.attackCooldown= false;
    this.iframes       = false;
    this.jumpTimer     = 0;
    this.enemies       = [];
    this.shadows       = [];
  }

  create() {
    const manifest = this.registry.get('manifest') ?? {};
    const levelsData = this.registry.get('levels') ?? {};
    const level = (levelsData.levels ?? [])[this.levelIndex] ?? levelsData.levels?.[0];

    if (!level) { console.error('No level data'); return; }

    const TILE_SZ  = manifest.tiles?.tileSize ?? 32;
    const mapCols  = level.size[0];
    const mapRows  = level.size[1];
    const worldW   = mapCols * TILE_SZ;
    const worldH   = mapRows * TILE_SZ;

    this.worldW = worldW;
    this.worldH = worldH;

    // Background drawn procedurally (city-night sky)
    if (manifest.bg) {
      const bg = this.add.image(0, 0, 'bg').setOrigin(0, 0).setDepth(-200);
      bg.setDisplaySize(worldW, this.scale.height);
      bg.setScrollFactor(0.2);
    } else {
      this._buildCityBg(worldW);
    }

    // Tilemap (visual only — no physics colliders)
    if (manifest.tiles) {
      const map = this.make.tilemap({ data: level.tiles, tileWidth: TILE_SZ, tileHeight: TILE_SZ });
      const tileset = map.addTilesetImage('tiles', 'tiles', TILE_SZ, TILE_SZ, 0, 0);
      this._tileLayer = map.createLayer(0, tileset, 0, 0);
      this._tileLayer.setDepth(-10);
    }

    // Player
    const sh = this._findSheet('BRAWLER', manifest);
    if (sh) {
      this.player = this.add.sprite(80, 250, sh.tex, sh.rowIdx * sh.cols);
      this.player.setDisplaySize(40, 52);
      this.player.play('BRAWLER-idle');
    } else {
      this.player = this.add.rectangle(80, 250, 20, 40, 0x00b4cc);
    }
    this.player.setDepth(this.player.y);

    // Shadow under player
    this.playerShadow = this.add.ellipse(this.player.x, FLOOR_Y_MAX + 6, 28, 8, 0x000000, 0.5);
    this.playerShadow.setDepth(FLOOR_Y_MAX + 1);

    // Input
    this._cursors = this.input.keyboard.createCursorKeys();
    this._wasd = {
      up:    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this._attackKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this._jumpKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    this.input.keyboard.on('keydown-SPACE', () => this._onAttack());
    this.input.keyboard.on('keydown-Z',     () => this._onJump());

    // Camera
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor('#0a0a14');

    // HUD
    this._buildHud();

    // Enemy spawner
    this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (this.enemies.length < 4 && !this.gameOver) this._spawnEnemy(manifest);
      },
    });

    // Spawn first 2 enemies immediately
    this.time.delayedCall(500, () => {
      if (!this.gameOver) this._spawnEnemy(manifest);
    });
    this.time.delayedCall(1200, () => {
      if (!this.gameOver) this._spawnEnemy(manifest);
    });

    this.updateState();
    this.events.emit('scene-ready');
  }

  // ─── City background (procedural) ────────────────────────────────────────

  _buildCityBg(worldW) {
    const H = this.scale.height;

    // Sky gradient
    const sky = this.add.graphics().setDepth(-200).setScrollFactor(0.15);
    sky.fillGradientStyle(0x0a0a22, 0x0a0a22, 0x12123a, 0x12123a, 1);
    sky.fillRect(0, 0, worldW, H * 0.7);

    // Buildings far layer (scroll 0.2)
    const bFar = this.add.graphics().setDepth(-190).setScrollFactor(0.2);
    const buildingDataFar = [
      [0,   140, 80,  H],
      [90,  160, 70,  H],
      [170, 100, 90,  H],
      [270, 150, 60,  H],
      [340, 120, 80,  H],
      [430, 170, 70,  H],
      [510, 110, 100, H],
      [620, 145, 75,  H],
      [710, 130, 65,  H],
      [785, 155, 85,  H],
      [880, 120, 70,  H],
      [960, 160, 90,  H],
    ];
    for (const [bx, by, bw, bh] of buildingDataFar) {
      for (let rx = 0; rx < worldW; rx += 1000) {
        bFar.fillStyle(0x111128, 1);
        bFar.fillRect(rx + bx, by, bw, bh - by);
        // Windows
        for (let wy = by + 10; wy < bh - 30; wy += 18) {
          for (let wx = rx + bx + 8; wx < rx + bx + bw - 8; wx += 16) {
            if ((wx + wy) % 3 !== 0) {
              bFar.fillStyle(Math.random() > 0.3 ? 0xffcc66 : 0x444466, 1);
              bFar.fillRect(wx, wy, 8, 10);
            }
          }
        }
      }
    }

    // Buildings mid layer (scroll 0.4)
    const bMid = this.add.graphics().setDepth(-180).setScrollFactor(0.4);
    const buildingDataMid = [
      [0,   180, 100, H],
      [110, 200, 80,  H],
      [200, 160, 110, H],
      [320, 190, 90,  H],
      [420, 170, 85,  H],
      [515, 195, 95,  H],
      [620, 180, 100, H],
      [730, 165, 80,  H],
      [820, 190, 110, H],
      [940, 175, 90,  H],
    ];
    for (const [bx, by, bw, bh] of buildingDataMid) {
      for (let rx = 0; rx < worldW; rx += 1060) {
        bMid.fillStyle(0x1a1a30, 1);
        bMid.fillRect(rx + bx, by, bw, bh - by);
        for (let wy = by + 8; wy < bh - 25; wy += 20) {
          for (let wx = rx + bx + 6; wx < rx + bx + bw - 6; wx += 18) {
            if ((wx * 3 + wy) % 5 !== 0) {
              bMid.fillStyle(Math.random() > 0.25 ? 0xffaa44 : 0x334455, 1);
              bMid.fillRect(wx, wy, 10, 12);
            }
          }
        }
      }
    }

    // Awning strips above floor (scroll 1.0 = world-locked)
    const awning = this.add.graphics().setDepth(-5);
    for (let ax = 0; ax < worldW; ax += 120) {
      const aColor = [0x882222, 0x226688, 0x885522, 0x226622][Math.floor(ax / 120) % 4];
      awning.fillStyle(aColor, 1);
      awning.fillRect(ax, FLOOR_Y_MIN - 32, 90, 12);
      // Awning stripes
      for (let si = 0; si < 90; si += 15) {
        awning.fillStyle(0xffffff, 0.15);
        awning.fillRect(ax + si, FLOOR_Y_MIN - 32, 8, 12);
      }
    }

    // Streetlights (world-locked)
    const lights = this.add.graphics().setDepth(-4);
    for (let lx = 80; lx < worldW; lx += 160) {
      lights.fillStyle(0x445566, 1);
      lights.fillRect(lx, FLOOR_Y_MIN - 90, 4, 90);
      lights.fillStyle(0x667788, 1);
      lights.fillRect(lx - 10, FLOOR_Y_MIN - 90, 24, 5);
      // Light glow
      lights.fillStyle(0xffee88, 0.9);
      lights.fillCircle(lx + 2, FLOOR_Y_MIN - 90, 5);
      lights.fillStyle(0xffee88, 0.15);
      lights.fillCircle(lx + 2, FLOOR_Y_MIN - 85, 20);
    }
  }

  // ─── Entity lookup ────────────────────────────────────────────────────────

  _findSheet(entityId, manifest) {
    for (const s of manifest.sprites ?? []) {
      const rowIdx = s.rows.indexOf(entityId);
      if (rowIdx >= 0) return { tex: s.textureKey, rowIdx, cols: s.cols.length };
    }
    return null;
  }

  // ─── Enemy spawning ───────────────────────────────────────────────────────

  _spawnEnemy(manifest) {
    const totalSpawned = this.enemiesDefeated + this.enemies.length;
    const isBoss = totalSpawned >= WIN_ENEMIES - 2 && this.enemies.every(e => !e.isBoss);
    const id = isBoss ? 'BOSS' : 'THUG';

    const side = Math.random() < 0.5 ? -1 : 1;
    const spawnX = Phaser.Math.Clamp(
      this.player.x + side * (this.scale.width * 0.55 + 40),
      60, this.worldW - 60
    );
    const spawnY = Phaser.Math.Between(FLOOR_Y_MIN + 20, FLOOR_Y_MAX - 20);

    const sh = this._findSheet(id, manifest);
    let enemy;
    if (sh) {
      enemy = this.add.sprite(spawnX, spawnY, sh.tex, sh.rowIdx * sh.cols);
      enemy.setDisplaySize(isBoss ? 52 : 38, isBoss ? 62 : 50);
      enemy.play(`${id}-idle`);
    } else {
      const color = isBoss ? 0xcc2222 : 0x666666;
      enemy = this.add.rectangle(spawnX, spawnY, isBoss ? 26 : 20, isBoss ? 40 : 34, color);
    }

    enemy.hp       = isBoss ? 8 : 2;
    enemy.maxHp    = enemy.hp;
    enemy.isBoss   = isBoss;
    enemy.hitCooldown = false;
    enemy.attackTimer = false;
    enemy.animId   = id;
    enemy.sheetInfo = sh;

    // HP bar above enemy
    const bar = this.add.graphics().setDepth(enemy.y + 1);
    enemy.hpBar = bar;
    this._drawEnemyHpBar(enemy);

    // Shadow
    const eshadow = this.add.ellipse(spawnX, FLOOR_Y_MAX + 6, isBoss ? 36 : 24, 8, 0x000000, 0.4);
    eshadow.setDepth(FLOOR_Y_MAX + 1);
    enemy.shadow = eshadow;

    enemy.setDepth(spawnY);
    this.enemies.push(enemy);
  }

  _drawEnemyHpBar(enemy) {
    const bar = enemy.hpBar;
    if (!bar) return;
    bar.clear();
    const bw = 28;
    bar.fillStyle(0x333333, 1);
    bar.fillRect(enemy.x - bw/2, enemy.y - 36, bw, 4);
    bar.fillStyle(enemy.isBoss ? 0xff3333 : 0xffaa00, 1);
    bar.fillRect(enemy.x - bw/2, enemy.y - 36, Math.round(bw * (enemy.hp / enemy.maxHp)), 4);
    bar.setDepth(enemy.y + 2);
  }

  // ─── Attack ───────────────────────────────────────────────────────────────

  _onAttack() {
    if (this.attackCooldown || this.gameOver) return;
    this.attackCooldown = true;
    this.attacking      = true;

    if (this.player.setTint) this.player.setTint(0xffddaa);

    // Punch hit check
    const hx = this.player.x + (this.facingRight ? ATTACK_RANGE_X * 0.5 : -ATTACK_RANGE_X * 0.5);
    for (const enemy of [...this.enemies]) {
      if (enemy.hp <= 0) continue;
      if (Math.abs(enemy.x - hx) < ATTACK_RANGE_X &&
          Math.abs(enemy.y - this.player.y) < ATTACK_RANGE_Y) {
        this._hitEnemy(enemy);
      }
    }

    // Flash attack arc graphic
    const arcX = this.player.x + (this.facingRight ? 30 : -30);
    const arcG = this.add.graphics().setDepth(500);
    arcG.fillStyle(0xffffff, 0.6);
    arcG.fillCircle(arcX, this.player.y - 5, 14);
    this.tweens.add({ targets: arcG, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 150,
      onComplete: () => arcG.destroy() });

    this.time.delayedCall(ATTACK_DURATION, () => {
      this.attackCooldown = false;
      this.attacking      = false;
      if (this.player.clearTint) this.player.clearTint();
    });
  }

  _hitEnemy(enemy) {
    if (enemy.hitCooldown) return;
    enemy.hitCooldown = true;
    enemy.hp -= 1;

    if (enemy.setTint) enemy.setTint(0xff4444);

    // Knockback
    const dir = enemy.x > this.player.x ? 1 : -1;
    const origX = enemy.x;
    this.tweens.add({
      targets: enemy,
      x: origX + dir * 18,
      duration: 80,
      yoyo: true,
      onComplete: () => {
        if (enemy.setTint) {
          this.time.delayedCall(200, () => {
            if (enemy.clearTint) enemy.clearTint();
            enemy.hitCooldown = false;
          });
        } else {
          enemy.hitCooldown = false;
        }
      },
    });

    this.cameras.main.shake(80, 0.006);
    this.score += enemy.isBoss ? 300 : 100;
    this._drawEnemyHpBar(enemy);
    this.updateState();

    if (enemy.hp <= 0) this._killEnemy(enemy);
  }

  _killEnemy(enemy) {
    this.enemiesDefeated++;
    this.tweens.add({
      targets: [enemy, enemy.hpBar, enemy.shadow],
      alpha: 0,
      y: enemy.y - 24,
      duration: 350,
      onComplete: () => {
        enemy.hpBar?.destroy();
        enemy.shadow?.destroy();
        enemy.destroy();
      },
    });
    this.enemies = this.enemies.filter(e => e !== enemy);

    // Score pop text
    const pop = this.add.text(enemy.x, enemy.y - 20, `+${enemy.isBoss ? 300 : 100}`, {
      fontSize: '8px', color: '#ffcc00', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setDepth(600);
    this.tweens.add({ targets: pop, y: pop.y - 30, alpha: 0, duration: 700,
      onComplete: () => pop.destroy() });

    this.updateState();
    if (this.enemiesDefeated >= WIN_ENEMIES) {
      this.time.delayedCall(600, () => this.win());
    }
  }

  _enemyHitPlayer() {
    if (this.iframes || this.gameOver) return;
    this.playerHp = Math.max(0, this.playerHp - 1);
    this.iframes  = true;
    if (this.player.setTint) this.player.setTint(0xff4444);
    this.cameras.main.shake(100, 0.01);
    this.time.delayedCall(900, () => {
      this.iframes = false;
      if (this.player.clearTint) this.player.clearTint();
    });
    this.updateState();
    if (this.playerHp <= 0) this.lose();
  }

  // ─── Jump (visual bounce only) ────────────────────────────────────────────

  _onJump() {
    if (this.jumpTimer > 0 || this.gameOver) return;
    this.jumpTimer = 400;
    const origY = this.player.y;
    this.tweens.add({
      targets: this.player,
      y: origY - 40,
      duration: 200,
      ease: 'Sine.easeOut',
      yoyo: true,
      onComplete: () => { this.player.y = origY; },
    });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  update(time, delta) {
    if (this.gameOver) return;

    const cursors = this._cursors;
    const wasd    = this._wasd;
    const left  = cursors.left.isDown  || wasd.left.isDown;
    const right = cursors.right.isDown || wasd.right.isDown;
    const up    = cursors.up.isDown    || wasd.up.isDown;
    const down  = cursors.down.isDown  || wasd.down.isDown;

    const spd = PLAYER_SPEED * (delta / 1000);
    if (left)  { this.player.x -= spd; this.facingRight = false; }
    if (right) { this.player.x += spd; this.facingRight = true; }
    if (up)    this.player.y -= spd * 0.6;
    if (down)  this.player.y += spd * 0.6;

    this.player.x = Phaser.Math.Clamp(this.player.x, 30, this.worldW - 30);
    this.player.y = Phaser.Math.Clamp(this.player.y, FLOOR_Y_MIN, FLOOR_Y_MAX);

    if (this.player.setFlipX) this.player.setFlipX(!this.facingRight);
    if (this.player.setDepth) this.player.setDepth(this.player.y);

    // Player animation
    if (this.player.play) {
      const moving = left || right || up || down;
      if (moving) this.player.play('BRAWLER-walk', true);
      else        this.player.play('BRAWLER-idle', true);
    }

    // Player shadow
    if (this.playerShadow) {
      this.playerShadow.x = this.player.x;
      const depthFrac = (this.player.y - FLOOR_Y_MIN) / (FLOOR_Y_MAX - FLOOR_Y_MIN);
      this.playerShadow.scaleX = 0.6 + depthFrac * 0.8;
      this.playerShadow.alpha  = 0.25 + depthFrac * 0.35;
    }

    // Jump timer
    if (this.jumpTimer > 0) this.jumpTimer -= delta;

    // Enemy AI
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;

      const dx  = this.player.x - enemy.x;
      const dy  = this.player.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      const espd = (enemy.isBoss ? 45 : 60) * (delta / 1000);

      if (dist > 10) {
        enemy.x += (dx / dist) * espd;
        enemy.y += (dy / dist) * espd * 0.6;
        enemy.y  = Phaser.Math.Clamp(enemy.y, FLOOR_Y_MIN, FLOOR_Y_MAX);
        if (enemy.setFlipX) enemy.setFlipX(dx < 0);
        if (enemy.play) enemy.play(`${enemy.animId}-walk`, true);
        enemy.setDepth(enemy.y);
      } else {
        if (enemy.play) enemy.play(`${enemy.animId}-idle`, true);
        if (!enemy.attackTimer) {
          enemy.attackTimer = true;
          const delay = enemy.isBoss ? 600 : 900;
          this.time.delayedCall(delay, () => {
            enemy.attackTimer = false;
            if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) < 45) {
              this._enemyHitPlayer();
            }
          });
        }
      }

      // Update shadow and hp bar positions
      if (enemy.shadow) {
        enemy.shadow.x = enemy.x;
        const ef = (enemy.y - FLOOR_Y_MIN) / (FLOOR_Y_MAX - FLOOR_Y_MIN);
        enemy.shadow.scaleX = 0.5 + ef * 0.7;
        enemy.shadow.alpha  = 0.2 + ef * 0.3;
      }
      this._drawEnemyHpBar(enemy);
    }

    // One-way camera scroll (only moves right)
    const targetCamX = this.player.x - this.scale.width * 0.4;
    const newCamX    = Math.max(this.cameras.main.scrollX, targetCamX);
    this.cameras.main.setScroll(newCamX, 0);
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────

  _buildHud() {
    const W = this.scale.width;

    this.hudBg = this.add.graphics().setScrollFactor(0).setDepth(300);
    this.hudBg.fillStyle(0x000000, 0.85);
    this.hudBg.fillRect(0, 0, W, 38);
    this.hudBg.lineStyle(1, 0x444444, 1);
    this.hudBg.lineBetween(0, 38, W, 38);

    // HP track
    this.hpTrack = this.add.graphics().setScrollFactor(0).setDepth(301);
    this.hpTrack.fillStyle(0x222222, 1);
    this.hpTrack.fillRect(36, 10, 110, 10);

    // HP bar fill
    this.hpBar = this.add.graphics().setScrollFactor(0).setDepth(302);

    // HP icon (fist shape)
    const hpIcon = this.add.graphics().setScrollFactor(0).setDepth(302);
    hpIcon.fillStyle(0xffcc00, 1);
    hpIcon.fillCircle(20, 15, 8);
    hpIcon.fillStyle(0xff8800, 1);
    hpIcon.fillRect(16, 18, 8, 5);

    // Player label
    this.add.text(36, 22, 'HP', {
      fontSize: '6px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(302);

    // Score
    this.scoreText = this.add.text(W - 8, 8, 'SCORE  000000', {
      fontSize: '8px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(302).setOrigin(1, 0);

    // Enemy counter
    this.enemyCountText = this.add.text(W / 2, 8, '0 / 12', {
      fontSize: '8px', color: '#ffaa00', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(302).setOrigin(0.5, 0);

    const label = this.add.text(W / 2, 20, 'ENEMIES', {
      fontSize: '6px', color: '#888888', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(302).setOrigin(0.5, 0);

    this._redrawHud();
  }

  _redrawHud() {
    const pct = Math.max(0, this.playerHp / this.MAX_HP);
    this.hpBar.clear();
    const barColor = pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xffaa00 : 0xcc2222;
    this.hpBar.fillStyle(barColor, 1);
    this.hpBar.fillRect(36, 10, Math.round(110 * pct), 10);

    this.scoreText?.setText('SCORE  ' + String(this.score).padStart(6, '0'));
    this.enemyCountText?.setText(`${this.enemiesDefeated} / ${WIN_ENEMIES}`);
  }

  // ─── Win / Lose ───────────────────────────────────────────────────────────

  win() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.won      = true;
    this.updateState();

    const W = this.scale.width, H = this.scale.height;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(400);
    panel.fillStyle(0x000000, 0.7);
    panel.fillRect(0, 0, W, H);

    this.add.text(W / 2, H / 2 - 30, 'VICTORY!', {
      fontSize: '28px', color: '#ffcc00', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 4,
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 10, `FINAL SCORE: ${String(this.score).padStart(6, '0')}`, {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 30, 'Press R to restart', {
      fontSize: '8px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.input.keyboard.once('keydown-R', () => this.scene.restart({ levelIndex: 0 }));
  }

  lose() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.updateState();

    const W = this.scale.width, H = this.scale.height;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(400);
    panel.fillStyle(0x000000, 0.7);
    panel.fillRect(0, 0, W, H);

    this.add.text(W / 2, H / 2 - 30, 'GAME OVER', {
      fontSize: '28px', color: '#cc2222', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 4,
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 10, `SCORE: ${String(this.score).padStart(6, '0')}`, {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.add.text(W / 2, H / 2 + 30, 'Press R to restart', {
      fontSize: '8px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(401).setOrigin(0.5);

    this.time.delayedCall(1500, () => {
      this.input.keyboard.once('keydown-R', () => this.scene.restart({ levelIndex: 0 }));
    });
  }

  updateState() {
    window.__gameState = {
      phase:           this.gameOver ? (this.won ? 'won' : 'lost') : 'playing',
      playerX:         this.player?.x ?? 0,
      playerY:         this.player?.y ?? 0,
      playerHp:        this.playerHp,
      score:           this.score,
      enemiesDefeated: this.enemiesDefeated,
    };
    this._redrawHud();
  }
}
