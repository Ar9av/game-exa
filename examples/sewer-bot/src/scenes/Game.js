import Phaser from 'phaser';

// ─── Constants ────────────────────────────────────────────────────────────────
const PLAYER_SPEED    = 160;
const JUMP_VY         = -390;
const COYOTE_MS       = 80;
const PLAYER_HP       = 5;
const PLAYER_MAX_HP   = 5;
const BATTERIES_TO_WIN = 5;
const SHOOT_COOLDOWN  = 300;
const MAX_BULLETS     = 3;
const BULLET_SPEED    = 340;
const SHIELD_DURATION = 4000; // ms

const ATK_RX = 36;
const ATK_RY = 24;

// Tile indices (must match tilesetPalette order)
const T_SKY    = 0;
const T_PIPE   = 1;
const T_FLOOR  = 2;
const T_ACID   = 3;
const T_LADDER = 4;

// Entity HP / speed table
const ENEMY_DEFS = {
  RAT_DRONE:     { hp: 2, speed: 65,  dmg: 1, size: 1.15 },
  SLUDGE_BLOB:   { hp: 3, speed: 35,  dmg: 2, size: 1.2  },
  PIPE_SPIDER:   { hp: 2, speed: 55,  dmg: 1, size: 1.1  },
  CORE_MAINFRAME:{ hp: 10, speed: 0,  dmg: 2, size: 2.4,  isBoss: true },
};

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
  }

  // ─── create ───────────────────────────────────────────────────────────────
  create() {
    const manifest = this.registry.get('manifest');
    const levels   = this.registry.get('levels');
    const lvl      = levels[this.levelIndex] ?? levels[0];
    const ts       = manifest.tiles.tileSize;
    const [mapW, mapH] = lvl.size;
    const worldW   = mapW * ts;
    const worldH   = mapH * ts;
    this._ts       = ts;
    this._manifest = manifest;

    this.cameras.main.roundPixels = true;

    // ── 3-layer parallax backgrounds ────────────────────────────────────────
    const bgLayer1 = this.add.graphics().setDepth(-198).setScrollFactor(0.05);
    bgLayer1.fillStyle(0x050a10); bgLayer1.fillRect(0, 0, worldW, worldH);

    const bgLayer2 = this.add.graphics().setDepth(-197).setScrollFactor(0.15);
    bgLayer2.fillStyle(0x0a1520); bgLayer2.fillRect(0, 0, worldW, worldH);
    // Draw distant pipe silhouettes in layer 2
    for (let px = 0; px < worldW; px += 96) {
      bgLayer2.fillStyle(0x082018);
      bgLayer2.fillRect(px, 0, 14, worldH);
    }

    const bgLayer3 = this.add.graphics().setDepth(-196).setScrollFactor(0.35);
    bgLayer3.fillStyle(0x0f1f18); bgLayer3.fillRect(0, 0, worldW, worldH);

    if (manifest.bg) {
      this.add.image(0, 0, 'bg')
        .setOrigin(0, 0).setDepth(-195)
        .setDisplaySize(worldW, worldH)
        .setScrollFactor(manifest.bg.scrollFactor ?? 0.25);
    }

    // ── Tilemap ──────────────────────────────────────────────────────────────
    const map = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    this._tileLayer = map.createLayer(0, tileset, 0, 0);

    // Set collision on PIPE and FLOOR only
    this._tileLayer.setCollision([T_PIPE, T_FLOOR]);

    // Make SKY tiles transparent
    this._tileLayer.forEachTile(t => { if (t.index === T_SKY) t.setAlpha(0); });
    // Make LADDER tiles semi-transparent (visual)
    this._tileLayer.forEachTile(t => { if (t.index === T_LADDER) t.setAlpha(0.65); });

    // Physics world
    this.physics.world.gravity.y = 520;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // ── Texture key map (entity → spritesheet key) ─────────────────────────
    this._texMap = {};
    manifest.sprites.forEach((sh, i) => {
      sh.rows.forEach(r => { this._texMap[r] = `entities-${i + 1}`; });
    });
    const texFor = (id) => this._texMap[id] ?? 'entities-1';

    // ── Player ────────────────────────────────────────────────────────────────
    const pSp   = lvl.spawns.find(s => s.entity === 'VOLT_BOT');
    const pSz   = ts * 1.4;
    this.player = this.physics.add.sprite(
      (pSp?.x ?? 5) * ts + ts / 2,
      (pSp?.y ?? 29) * ts,
      texFor('VOLT_BOT')
    );
    this.player.setDisplaySize(pSz, pSz);
    this.player.setCollideWorldBounds(true);
    this.player.body.setMaxVelocityY(600);
    this.player.body.setSize(pSz * 0.48, pSz * 0.72, true);
    this.player.setDepth(10);
    this.physics.add.collider(this.player, this._tileLayer);
    if (this.anims.exists('VOLT_BOT-idle')) this.player.play('VOLT_BOT-idle', true);

    // ── Enemies ───────────────────────────────────────────────────────────────
    this._enemies = this.physics.add.group();
    this._spawnEnemies(lvl, texFor, ts);
    this.physics.add.collider(this._enemies, this._tileLayer);

    // ── Bullets (player) ─────────────────────────────────────────────────────
    this._bulletGroup = this.physics.add.group();
    this._shootCd     = 0;

    // ── Boss projectiles ──────────────────────────────────────────────────────
    this._bossProjectiles = this.physics.add.group();
    this._bossShootTimer  = 0;
    this._bossPhase       = 1;

    // ── Bullet vs enemy overlap ───────────────────────────────────────────────
    this.physics.add.overlap(this._bulletGroup, this._enemies, (bullet, enemy) => {
      bullet.destroy();
      this._hitEnemy(enemy, 1);
    });

    // ── Bullet vs boss projectile (cancel each other) ─────────────────────────
    this.physics.add.overlap(this._bulletGroup, this._bossProjectiles, (b, bp) => {
      b.destroy(); bp.destroy();
    });

    // ── Batteries ────────────────────────────────────────────────────────────
    this._batteries = this.physics.add.staticGroup();
    for (const sp of lvl.spawns) {
      if (sp.entity !== 'BATTERY') continue;
      const bat = this._batteries.create(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2, texFor('BATTERY')
      );
      bat.setDisplaySize(ts * 0.7, ts * 0.7);
      if (this.anims.exists('BATTERY-idle')) bat.play('BATTERY-idle', true);
      bat.setDepth(5);
    }
    this.physics.add.overlap(this.player, this._batteries, (_p, bat) => {
      this._pickupSparkle(bat.x, bat.y);
      bat.destroy();
      this.batteriesCollected++;
      this.score += 500;
      this._refreshHud();
      if (this.batteriesCollected >= BATTERIES_TO_WIN) this._win();
    });

    // ── Shield packs ─────────────────────────────────────────────────────────
    this._shields = this.physics.add.staticGroup();
    for (const sp of lvl.spawns) {
      if (sp.entity !== 'SHIELD_PACK') continue;
      const sh = this._shields.create(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2, texFor('SHIELD_PACK')
      );
      sh.setDisplaySize(ts * 0.7, ts * 0.7);
      if (this.anims.exists('SHIELD_PACK-idle')) sh.play('SHIELD_PACK-idle', true);
      sh.setDepth(5);
    }
    this.physics.add.overlap(this.player, this._shields, (_p, sh) => {
      this._pickupSparkle(sh.x, sh.y);
      sh.destroy();
      this._activateShield();
    });

    // ── Camera ───────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player);

    // ── Input ─────────────────────────────────────────────────────────────────
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.zKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.rKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // ── Game state variables ──────────────────────────────────────────────────
    this.playerHp          = PLAYER_HP;
    this.batteriesCollected = 0;
    this.score             = 0;
    this._iframes          = 0;
    this._coyote           = 0;
    this._isJumping        = false;
    this._facingRight      = true;
    this._shootCd          = 0;
    this._over             = false;
    this._won              = false;
    this._canRestart       = false;
    this._shielded         = false;
    this._shieldTimer      = 0;
    this._lives            = 3;

    // ── HUD ───────────────────────────────────────────────────────────────────
    this._buildHud(texFor('VOLT_BOT'));

    window.__gameState = {
      phase: 'playing', playerX: 0, playerY: 0,
      playerHp: PLAYER_HP, score: 0, batteriesCollected: 0,
    };

    this.events.emit('scene-ready');
  }

  // ─── Enemy spawning ───────────────────────────────────────────────────────
  _spawnEnemies(lvl, texFor, ts) {
    for (const sp of lvl.spawns) {
      const def = ENEMY_DEFS[sp.entity];
      if (!def) continue;
      const sz  = ts * def.size;
      const e   = this.physics.add.sprite(
        sp.x * ts + ts / 2,
        sp.y * ts,
        texFor(sp.entity)
      );
      e.setDisplaySize(sz, sz);
      e.body.setSize(sz * 0.5, sz * 0.7, true);
      e.setCollideWorldBounds(true);
      e.body.setMaxVelocityY(def.isBoss ? 0 : 600);
      if (def.isBoss) e.body.setAllowGravity(false);
      e.setData({ id: sp.entity, hp: def.hp, speed: def.speed, dmg: def.dmg,
                  dir: 1, wander: 0, attackCd: 0, isBoss: !!def.isBoss,
                  dropState: false, dropY: sp.y * ts });
      if (this.anims.exists(`${sp.entity}-idle`)) e.play(`${sp.entity}-idle`, true);
      e.setDepth(def.isBoss ? 12 : 9);
      this._enemies.add(e);
    }
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────
  _buildHud(playerTexKey) {
    const { width: scW } = this.scale;
    const txtStyle = { fontSize: '11px', fill: '#ffffff', stroke: '#000000', strokeThickness: 3 };
    const yel      = { fontSize: '11px', fill: '#ffff00', stroke: '#000000', strokeThickness: 3 };
    const cyan     = { fontSize: '10px', fill: '#88ffff', stroke: '#000000', strokeThickness: 2 };

    // Portrait box
    this._portraitGfx = this.add.graphics().setScrollFactor(0).setDepth(302);
    this._portraitGfx.lineStyle(2, 0xffffff, 1);
    this._portraitGfx.strokeRect(4, 4, 28, 28);
    this._portraitSprite = this.add.sprite(18, 18, playerTexKey)
      .setScrollFactor(0).setDepth(303).setDisplaySize(24, 24);
    if (this.anims.exists('VOLT_BOT-idle')) this._portraitSprite.play('VOLT_BOT-idle', true);

    // HP label
    this.add.text(36, 4, 'HP', txtStyle).setScrollFactor(0).setDepth(302);

    // HP bar (Graphics, redrawn on change)
    this._hpBarGfx = this.add.graphics().setScrollFactor(0).setDepth(302);

    // Lives
    this._livesTxt = this.add.text(8, 34, `\xd7${this._lives}`, txtStyle)
      .setScrollFactor(0).setDepth(302);

    // Score
    this.add.text(scW - 8, 6, 'SCORE', yel).setOrigin(1, 0).setScrollFactor(0).setDepth(302);
    this._scoreTxt = this.add.text(scW - 8, 18, '000000', yel)
      .setOrigin(1, 0).setScrollFactor(0).setDepth(302);

    // Battery counter
    this._batTxt = this.add.text(scW - 8, 32, `CELL 0/${BATTERIES_TO_WIN}`,
      { fontSize: '10px', fill: '#ffffaa', stroke: '#000', strokeThickness: 2 })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(302);

    // Level indicator
    this.add.text(scW / 2, 4, 'SEWER BOT', cyan)
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(302);

    // Shield indicator (hidden by default)
    this._shieldTxt = this.add.text(scW / 2, 16, 'SHIELD', {
      fontSize: '10px', fill: '#00ffff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(302).setVisible(false);

    this._drawHpBar();
  }

  _drawHpBar() {
    const g = this._hpBarGfx;
    g.clear();
    for (let i = 0; i < PLAYER_MAX_HP; i++) {
      g.fillStyle(i < this.playerHp ? (this._shielded ? 0x00ccff : 0xcc0000) : 0x440000);
      g.fillRect(48 + i * 12, 10, 10, 6);
    }
  }

  _refreshHud() {
    this._drawHpBar();
    this._scoreTxt.setText(String(this.score).padStart(6, '0'));
    this._batTxt.setText(`CELL ${this.batteriesCollected}/${BATTERIES_TO_WIN}`);
    this._livesTxt.setText(`\xd7${this._lives}`);
  }

  // ─── Shield pickup ────────────────────────────────────────────────────────
  _activateShield() {
    this._shielded     = true;
    this._shieldTimer  = SHIELD_DURATION;
    this.player.setTint(0x00ffff);
    this._shieldTxt.setVisible(true);
    // Temporarily add 2 HP (capped at max + 2)
    this.playerHp = Math.min(this.playerHp + 2, PLAYER_MAX_HP + 2);
    this._drawHpBar();
  }

  _tickShield(delta) {
    if (!this._shielded) return;
    this._shieldTimer -= delta;
    if (this._shieldTimer <= 0) {
      this._shielded = false;
      this.player.clearTint();
      this._shieldTxt.setVisible(false);
      // Clamp hp back to max
      this.playerHp = Math.min(this.playerHp, PLAYER_MAX_HP);
      this._drawHpBar();
    }
  }

  // ─── Bullet firing ────────────────────────────────────────────────────────
  _fireBullet() {
    if (this._shootCd > 0) return;
    if (this._bulletGroup.getLength() >= MAX_BULLETS) return;

    const bx = this.player.x + (this._facingRight ? 22 : -22);
    const by = this.player.y - 4;
    const b  = this.physics.add.image(bx, by, null);
    b.setDisplaySize(10, 4);
    // Draw the bullet as a graphics rect (cyan bolt)
    const gfx = this.add.graphics().setDepth(20);
    gfx.fillStyle(0x00ffff);
    gfx.fillRect(-5, -2, 10, 4);
    gfx.x = bx; gfx.y = by;
    b.setData('gfx', gfx);
    b.body.setAllowGravity(false);
    b.body.setVelocityX(this._facingRight ? BULLET_SPEED : -BULLET_SPEED);
    b.setDepth(20);
    b.setVisible(false); // only the graphics object shows
    this._bulletGroup.add(b);

    this._shootCd = SHOOT_COOLDOWN;
    if (this.anims.exists('VOLT_BOT-cast')) {
      this.player.play('VOLT_BOT-cast', true);
      this.time.delayedCall(200, () => {
        if (this.player.active && !this._isJumping) this.player.play('VOLT_BOT-idle', true);
      });
    }
  }

  _tickBullets(delta) {
    this._shootCd = Math.max(0, this._shootCd - delta);
    this._bulletGroup.getChildren().slice().forEach(b => {
      if (!b.active) return;
      const gfx = b.getData('gfx');
      if (gfx) { gfx.x = b.x; gfx.y = b.y; }
      // Destroy if out of world bounds
      const cam = this.cameras.main;
      if (b.x < cam.scrollX - 20 || b.x > cam.scrollX + this.scale.width + 20) {
        if (gfx) gfx.destroy();
        b.destroy();
      }
    });
  }

  // ─── Boss fight ───────────────────────────────────────────────────────────
  _tickBoss(boss, delta) {
    if (!boss.active || !boss.body) return;
    const hp = boss.getData('hp');
    this._bossPhase = hp <= 5 ? 2 : 1;

    // Boss fires projectiles downward
    this._bossShootTimer -= delta;
    if (this._bossShootTimer <= 0) {
      this._bossShootTimer = this._bossPhase === 1 ? 1800 : 1000;
      this._fireBossPattern(boss);
    }

    // Animate boss
    if (this.anims.exists('CORE_MAINFRAME-cast') && this._bossShootTimer < 300)
      boss.play('CORE_MAINFRAME-cast', true);
    else if (this.anims.exists('CORE_MAINFRAME-idle'))
      boss.play('CORE_MAINFRAME-idle', true);
  }

  _fireBossPattern(boss) {
    const angles = this._bossPhase === 1
      ? [Math.PI / 2, Math.PI / 2 - 0.3, Math.PI / 2 + 0.3]
      : [Math.PI / 2, Math.PI / 2 - 0.45, Math.PI / 2 + 0.45, Math.PI / 2 - 0.22, Math.PI / 2 + 0.22];
    for (const angle of angles) {
      const bp = this.add.rectangle(boss.x, boss.y + 20, 8, 8, 0xff3300);
      this.physics.add.existing(bp);
      bp.body.setAllowGravity(false);
      bp.body.setVelocity(Math.cos(angle) * 130, Math.sin(angle) * 130);
      bp.setDepth(15);
      this._bossProjectiles.add(bp);
      // Auto-destroy after 4s
      this.time.delayedCall(4000, () => { if (bp.active) bp.destroy(); });
    }
  }

  _tickBossProjectiles() {
    // Player vs boss projectile overlap
    this._bossProjectiles.getChildren().slice().forEach(bp => {
      if (!bp.active) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), bp.getBounds())) {
        bp.destroy();
        this._hurtPlayer(this._bossPhase === 2 ? 2 : 1);
      }
    });
  }

  // ─── Enemy AI ────────────────────────────────────────────────────────────
  _tickEnemy(e, delta) {
    if (!e.active || !e.body) return;
    const id    = e.getData('id');
    const isBoss = e.getData('isBoss');
    const speed = e.getData('speed');
    const dmg   = e.getData('dmg');
    const dx    = this.player.x - e.x;
    const dy    = this.player.y - e.y;
    const dist  = Math.sqrt(dx * dx + dy * dy);
    const ts    = this._ts;

    if (isBoss) {
      this._tickBoss(e, delta);
      return;
    }

    // PIPE_SPIDER: drop from ceiling/platforms if player is below
    if (id === 'PIPE_SPIDER') {
      const dropping = e.getData('dropState');
      if (!dropping && dy > 0 && Math.abs(dx) < 80 && !e.body.blocked.down) {
        e.setData('dropState', true);
        e.body.setAllowGravity(true);
        e.body.setVelocityY(180);
      }
      if (dropping && e.body.blocked.down) {
        e.setData('dropState', false);
      }
      if (!dropping) {
        // Patrol on ceiling
        let dir = e.getData('dir') ?? 1;
        const aheadX  = e.x + dir * (ts * 0.8);
        const aheadTile = this._tileLayer.getTileAtWorldXY(aheadX, e.y - ts * 0.5);
        if (!aheadTile || this._manifest.tiles.passable[aheadTile.index]) dir *= -1;
        e.setData('dir', dir);
        e.body.setVelocityX(dir * speed * 0.5);
        e.setFlipX(dir < 0);
        e.body.setAllowGravity(false);
        return;
      }
    }

    // SLUDGE_BLOB: slow, always chases
    if (id === 'SLUDGE_BLOB') {
      e.body.setVelocityX(dx > 0 ? speed : -speed);
      e.setFlipX(dx < 0);
      if (this.anims.exists('SLUDGE_BLOB-walk')) e.play('SLUDGE_BLOB-walk', true);
      return;
    }

    // RAT_DRONE + others: chase when close, patrol otherwise with edge detection
    const chasing = dist < 220;
    let dir = e.getData('dir') ?? 1;
    let moveDir = chasing ? Math.sign(dx) : dir;

    // Platform edge / wall detection (prevent walking off)
    if (!chasing) {
      const aheadX    = e.x + moveDir * (ts * 0.9);
      const belowY    = e.y + ts;
      const aheadTile = this._tileLayer.getTileAtWorldXY(aheadX, e.y);
      const floorTile = this._tileLayer.getTileAtWorldXY(aheadX, belowY);
      const wallAhead = aheadTile && !this._manifest.tiles.passable[aheadTile.index];
      const noFloor   = !floorTile || this._manifest.tiles.passable[floorTile.index];
      if (wallAhead || noFloor) {
        moveDir *= -1;
        dir      = moveDir;
      }
    }
    e.setData('dir', dir);

    e.body.setVelocityX(moveDir * speed);
    e.setFlipX(moveDir < 0);

    let wt = e.getData('wander') - delta;
    if (!chasing) {
      if (wt <= 0) { e.setData('dir', Phaser.Math.Between(0, 1) ? 1 : -1); wt = Phaser.Math.Between(900, 2200); }
      e.setData('wander', wt);
    }

    const anim = chasing ? `${id}-walk` : `${id}-idle`;
    if (this.anims.exists(anim)) e.play(anim, true);
    else if (this.anims.exists(`${id}-walk`)) e.play(`${id}-walk`, true);

    // Contact attack
    if (dist < 28) {
      let acd = e.getData('attackCd') - delta;
      if (acd <= 0) {
        e.setData('attackCd', 900);
        this._hurtPlayer(dmg);
      } else {
        e.setData('attackCd', acd);
      }
    }
  }

  // ─── Hit particles ────────────────────────────────────────────────────────
  _emitHitParticles(x, y, color) {
    const count = Phaser.Math.Between(4, 6);
    for (let i = 0; i < count; i++) {
      const g   = this.add.graphics().setDepth(50);
      const sz  = Phaser.Math.Between(3, 5);
      g.fillStyle(color ?? 0xff4400);
      g.fillRect(-sz / 2, -sz / 2, sz, sz);
      g.x = x; g.y = y;
      const angle = (i / count) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.4, 0.4);
      const dist  = Phaser.Math.Between(18, 36);
      this.tweens.add({
        targets: g,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: Phaser.Math.Between(220, 380),
        ease: 'Power2',
        onComplete: () => g.destroy(),
      });
    }
  }

  // ─── Pickup sparkle ───────────────────────────────────────────────────────
  _pickupSparkle(x, y) {
    const g = this.add.graphics().setDepth(60);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(0, 0, 1);
    g.x = x; g.y = y;
    this.tweens.add({
      targets: g, scaleX: 20, scaleY: 20, alpha: 0,
      duration: 220, ease: 'Power2',
      onComplete: () => g.destroy(),
    });
  }

  // ─── Enemy death animation ────────────────────────────────────────────────
  _killEnemy(e) {
    if (!e.active) return;
    this._emitHitParticles(e.x, e.y, 0xff2200);
    let flashes = 0;
    const flash = () => {
      if (!e.active) return;
      e.setTint(0xffffff);
      this.time.delayedCall(60, () => {
        if (!e.active) return;
        e.clearTint();
        flashes++;
        if (flashes < 3) {
          this.time.delayedCall(60, flash);
        } else {
          if (e.body) {
            e.body.setAllowGravity(true);
            e.body.setVelocityY(200);
          }
          this.tweens.add({
            targets: e, alpha: 0, duration: 400,
            onComplete: () => { if (e.active) e.destroy(); },
          });
        }
      });
    };
    flash();
  }

  // ─── Screen flash on player hurt ─────────────────────────────────────────
  _screenFlash() {
    const { width: W, height: H } = this.scale;
    const fl = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0.4)
      .setScrollFactor(0).setDepth(350);
    this.tweens.add({ targets: fl, alpha: 0, duration: 200, onComplete: () => fl.destroy() });
  }

  // ─── Hurt player ─────────────────────────────────────────────────────────
  _hurtPlayer(dmg) {
    if (this._iframes > 0 || this._over || this._won) return;
    if (this._shielded) {
      this.cameras.main.shake(60, 0.004);
      return; // shield absorbs hit
    }
    this.playerHp -= dmg;
    this._iframes  = 90;
    this.player.setTint(0xff6666);
    this.cameras.main.shake(130, 0.008);
    this._screenFlash();
    this._refreshHud();
    if (this.playerHp <= 0) this._lose();
  }

  // ─── Hit enemy (from bullet or melee) ────────────────────────────────────
  _hitEnemy(e, dmg) {
    if (!e.active) return;
    const hp = e.getData('hp') - dmg;
    e.setData('hp', hp);
    e.setTint(0xff4444);
    this.score += 100;
    this._emitHitParticles(e.x, e.y, 0xff8800);
    this._refreshHud();
    this.time.delayedCall(180, () => { if (e.active) e.clearTint(); });
    if (hp <= 0) {
      const isBoss = e.getData('isBoss');
      this.score += isBoss ? 2000 : 300;
      this._refreshHud();
      this._killEnemy(e);
      if (isBoss) {
        this.time.delayedCall(600, () => this._win());
      }
    } else {
      // Knockback only for non-boss
      if (!e.getData('isBoss') && e.body) {
        e.body.setVelocityX(this._facingRight ? 180 : -180);
      }
    }
  }

  // ─── Acid tile check ─────────────────────────────────────────────────────
  _checkAcid() {
    const tiles = this._tileLayer.getTilesWithinWorldXY(
      this.player.x - 10, this.player.y + 10, 20, 6
    );
    if (tiles && tiles.some(t => t.index === T_ACID)) {
      if (!this._iframes) this._hurtPlayer(1);
    }
  }

  // ─── Win / Lose ───────────────────────────────────────────────────────────
  _win() {
    if (this._won) return;
    this._won = true;
    window.__gameState = { ...window.__gameState, phase: 'win' };
    this._overlay('YOU WIN!', 'Press R to restart');
  }

  _lose() {
    if (this._over) return;
    this._over = true;
    window.__gameState = { ...window.__gameState, phase: 'lose' };
    this._overlay('GAME OVER', 'Press R to restart');
  }

  _overlay(msg, sub) {
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(400);
    const txt = this.add.text(W / 2, H / 2 - 28, msg, {
      fontSize: '36px', fill: '#ffffff', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401).setScale(0.5);
    this.tweens.add({ targets: txt, scaleX: 1, scaleY: 1, duration: 350, ease: 'Back.Out' });

    const subTxt = this.add.text(W / 2, H / 2 + 22, sub, {
      fontSize: '14px', fill: '#ffff88', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.tweens.add({ targets: subTxt, alpha: 0.2, yoyo: true, repeat: -1, duration: 500 });

    this.time.delayedCall(1000, () => { this._canRestart = true; });
  }

  // ─── update ───────────────────────────────────────────────────────────────
  update(_t, delta) {
    if (this._over || this._won) {
      if (this._canRestart && Phaser.Input.Keyboard.JustDown(this.rKey)) {
        // Clean up bullet graphics before restart
        this._bulletGroup.getChildren().forEach(b => {
          const g = b.getData('gfx'); if (g) g.destroy();
        });
        this.scene.restart({ levelIndex: 0 });
      }
      return;
    }

    const onGround   = this.player.body.blocked.down;
    const left       = this.cursors.left.isDown;
    const right      = this.cursors.right.isDown;
    const jumpJD     = Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
                       Phaser.Input.Keyboard.JustDown(this.cursors.space);
    const shootJD    = Phaser.Input.Keyboard.JustDown(this.zKey);

    // ── Coyote time ────────────────────────────────────────────────────────
    if (onGround) { this._coyote = COYOTE_MS; this._isJumping = false; }
    else          { this._coyote = Math.max(0, this._coyote - delta); }

    // ── Horizontal movement ────────────────────────────────────────────────
    if (left)       { this.player.body.setVelocityX(-PLAYER_SPEED); this._facingRight = false; this.player.setFlipX(true); }
    else if (right) { this.player.body.setVelocityX(PLAYER_SPEED);  this._facingRight = true;  this.player.setFlipX(false); }
    else            { this.player.body.setVelocityX(0); }

    // ── Jump ───────────────────────────────────────────────────────────────
    if (jumpJD && this._coyote > 0 && !this._isJumping) {
      this.player.body.setVelocityY(JUMP_VY);
      this._coyote    = 0;
      this._isJumping = true;
    }
    // Variable jump height
    const jumpHeld = this.cursors.up.isDown || this.cursors.space.isDown;
    if (!jumpHeld && this.player.body.velocity.y < -80) {
      this.player.body.setVelocityY(this.player.body.velocity.y * 0.88);
    }

    // ── Shoot ──────────────────────────────────────────────────────────────
    if (shootJD) this._fireBullet();

    // ── Bullet tick ────────────────────────────────────────────────────────
    this._tickBullets(delta);

    // ── Acid check ─────────────────────────────────────────────────────────
    this._checkAcid();

    // ── Shield tick ────────────────────────────────────────────────────────
    this._tickShield(delta);

    // ── Player animation ───────────────────────────────────────────────────
    if (!onGround && this.anims.exists('VOLT_BOT-jump'))
      this.player.play('VOLT_BOT-jump', true);
    else if ((left || right) && this.anims.exists('VOLT_BOT-walk'))
      this.player.play('VOLT_BOT-walk', true);
    else if (this.anims.exists('VOLT_BOT-idle'))
      this.player.play('VOLT_BOT-idle', true);

    // ── Iframes blink ──────────────────────────────────────────────────────
    if (this._iframes > 0) {
      this._iframes--;
      this.player.setAlpha(Math.floor(this._iframes / 5) % 2 === 0 ? 1 : 0.3);
      if (this._iframes === 0) {
        this.player.setAlpha(1);
        if (!this._shielded) this.player.clearTint();
      }
    }

    // ── Enemy ticks ────────────────────────────────────────────────────────
    this._enemies.getChildren().forEach(e => this._tickEnemy(e, delta));

    // ── Boss projectile collision ──────────────────────────────────────────
    this._tickBossProjectiles();

    // ── Update window game state ───────────────────────────────────────────
    window.__gameState = {
      phase: 'playing',
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
      playerHp: this.playerHp,
      score: this.score,
      batteriesCollected: this.batteriesCollected,
    };
  }
}
