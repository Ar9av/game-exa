import Phaser from 'phaser';

const PLAYER_SPEED   = 200;
const BULLET_SPEED   = 520;
const FIRE_RATE_MS   = 160;
const PLAYER_HP      = 5;
const ENEMIES_TO_WIN = 30;
const INVULN_MS      = 1400;
const BOMB_CHARGES   = 2;

const C_CYAN   = 0x00f5ff;
const C_PINK   = 0xff2daa;
const C_ORANGE = 0xff8c00;
const C_YELLOW = 0xffe600;
const C_WHITE  = 0xffffff;
const C_RED    = 0xff2255;

const WAVE_CONFIGS = [
  { fighters: 4, bombers: 0, speed: 1.0 },
  { fighters: 5, bombers: 1, speed: 1.1 },
  { fighters: 6, bombers: 2, speed: 1.2 },
  { fighters: 5, bombers: 3, speed: 1.3 },
  { fighters: 8, bombers: 3, speed: 1.5 },
];

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex       = data?.levelIndex ?? 0;
    this.playerHp         = PLAYER_HP;
    this.score            = 0;
    this.enemiesDestroyed = 0;
    this._combo           = 0;
    this._comboTimer      = null;
    this._fireTimer       = 0;
    this._invulnTimer     = 0;
    this._bombCharges     = BOMB_CHARGES;
    this._waveIndex       = 0;
    this._gameOver        = false;
    this._won             = false;
    this._canRestart      = false;
    this._trailPositions  = [];
    this._stars           = [];
    this._enemyFireTimers = new Map();
  }

  create() {
    const manifest = this.registry.get('manifest');
    const levels   = this.registry.get('levels');
    const lvl      = levels[this.levelIndex] ?? levels[0];
    const ts       = manifest.tiles.tileSize;
    const [mapW, mapH] = lvl.size;
    const worldW   = mapW * ts;
    const worldH   = mapH * ts;

    this.physics.world.gravity.y = 0;
    this.cameras.main.roundPixels = true;
    // Constrain to viewport so player can't wander off-screen
    const viewW = this.scale.width, viewH = this.scale.height;
    this.physics.world.setBounds(0, 0, viewW, viewH);

    // Tilemap — space background
    const map     = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    this._tileLayer = map.createLayer(0, tileset, 0, 0);
    this._tileLayer.setDepth(-10);

    // Build texture map
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));

    // Procedural starfield
    this._buildStarfield(worldW, worldH);

    // Fixed camera (shmup — no follow)
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setScroll(0, 0);

    // Cell size from manifest — used to compute correct scale (avoids tween bug)
    this._cellSize = manifest.sprites[0]?.cell ?? 64;

    // Player — 44px display, scale computed against actual cell size
    const playerPx = 44;
    const pSp = lvl.spawns.find(s => s.entity === 'SHIP');
    this.player = this.physics.add.sprite(
      (pSp?.x ?? 8) * ts + ts / 2,
      (pSp?.y ?? 9) * ts + ts / 2,
      texMap.SHIP ?? 'entities-1'
    );
    this.player.setScale(playerPx / this._cellSize);
    this.player.body.setSize(playerPx * 0.55, playerPx * 0.55, true);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(20);
    this.player.setTint(C_CYAN);

    // Groups
    this._bullets      = this.physics.add.group();
    this._enemyBullets = this.physics.add.group();
    this._enemies      = this.physics.add.group();
    this._gems         = this.physics.add.group();

    this.physics.add.overlap(this._bullets,      this._enemies,      (b, e) => this._bulletHitEnemy(b, e));
    this.physics.add.overlap(this.player,        this._enemies,      (p, e) => this._playerHitEnemy(p, e));
    this.physics.add.overlap(this.player,        this._enemyBullets, (p, b) => this._playerHitBullet(p, b));
    this.physics.add.overlap(this.player,        this._gems,         (p, g) => this._collectGem(p, g));

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd    = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
    this.zKey    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.xKey    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.rKey    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    this._buildHud(texMap, ts);

    this.time.delayedCall(700, () => this._spawnWave());

    window.__gameState = {
      phase: 'playing', playerX: this.player.x, playerY: this.player.y,
      playerHp: this.playerHp, enemiesDestroyed: 0, score: 0,
    };
    this.events.emit('scene-ready');
  }

  // ── Starfield ────────────────────────────────────────────────────────────────

  _buildStarfield(worldW, worldH) {
    const layers = [
      { count: 40, speed: 28,  size: 1,   alpha: 0.4  },
      { count: 30, speed: 55,  size: 1.5, alpha: 0.65 },
      { count: 20, speed: 90,  size: 2.2, alpha: 0.9  },
    ];
    for (const l of layers) {
      for (let i = 0; i < l.count; i++) {
        const g = this.add.graphics().setDepth(-5);
        g.fillStyle(C_WHITE, l.alpha);
        g.fillRect(0, 0, l.size, l.size);
        g.setPosition(Phaser.Math.RND.between(0, worldW), Phaser.Math.RND.between(0, worldH));
        this._stars.push({ g, speed: l.speed, worldH, worldW });
      }
    }
  }

  _tickStarfield(delta) {
    for (const s of this._stars) {
      s.g.y += s.speed * (delta / 1000);
      if (s.g.y > s.worldH) {
        s.g.y = 0;
        s.g.x = Phaser.Math.RND.between(0, s.worldW);
      }
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────

  _buildHud(texMap, ts) {
    const W = this.scale.width;

    this.add.rectangle(4, 4, 36, 36, 0x000000, 0.8).setOrigin(0).setScrollFactor(0).setDepth(300);
    this.add.rectangle(5, 5, 34, 34, C_CYAN, 0.15).setOrigin(0).setScrollFactor(0).setDepth(301);
    this.add.sprite(22, 22, texMap.SHIP ?? 'entities-1')
      .setScale(26 / this._cellSize).setScrollFactor(0).setDepth(302).setTint(C_CYAN);

    this._shieldSegs = [];
    for (let i = 0; i < PLAYER_HP; i++) {
      const seg = this.add.rectangle(46 + i * 14, 8, 11, 8, C_CYAN).setOrigin(0).setScrollFactor(0).setDepth(302);
      this._shieldSegs.push(seg);
    }

    this._scoreTxt = this.add.text(W - 6, 4, 'SCORE\n000000', {
      fontSize: '11px', fill: '#ffe600', stroke: '#000', strokeThickness: 2, align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(302);

    this._waveTxt = this.add.text(W / 2, 4, 'WAVE 1', {
      fontSize: '11px', fill: '#00f5ff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(302);

    this._bombTxt = this.add.text(46, 22, `BOMB ×${this._bombCharges}`, {
      fontSize: '9px', fill: '#ff8c00', stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(302);
  }

  _refreshHud() {
    this._shieldSegs.forEach((s, i) => {
      s.setVisible(i < this.playerHp);
      s.setFillStyle(this.playerHp <= 2 ? C_RED : C_CYAN);
    });
    this._scoreTxt.setText(`SCORE\n${String(this.score).padStart(6, '0')}`);
    this._waveTxt.setText(`WAVE ${this._waveIndex + 1}`);
    this._bombTxt.setText(`BOMB ×${this._bombCharges}`);
  }

  // ── Wave spawning ─────────────────────────────────────────────────────────────

  _spawnWave() {
    if (this._gameOver) return;
    const cfg = WAVE_CONFIGS[Math.min(this._waveIndex, WAVE_CONFIGS.length - 1)];
    const manifest = this.registry.get('manifest');
    const ts = manifest.tiles.tileSize;
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));
    const W = this.scale.width;

    this._showWaveBanner(`WAVE ${this._waveIndex + 1}`);
    this._refreshHud();

    this._vFormation(cfg.fighters, W).forEach(({ x, y }, i) => {
      this.time.delayedCall(i * 90, () => this._spawnEnemy(x, y, 'FIGHTER', texMap, ts, cfg.speed));
    });
    this._gridFormation(cfg.bombers, W).forEach(({ x, y }, i) => {
      this.time.delayedCall(200 + i * 130, () => this._spawnEnemy(x, y, 'BOMBER', texMap, ts, cfg.speed));
    });
  }

  _vFormation(n, W) {
    return Array.from({ length: n }, (_, i) => ({
      x: W / 2 + (i % 2 === 0 ? 1 : -1) * (50 + Math.floor(i / 2) * 40),
      y: -30 - Math.floor(i / 2) * 18,
    }));
  }

  _gridFormation(n, W) {
    const cols = Math.min(n, 3);
    return Array.from({ length: n }, (_, i) => ({
      x: W / 2 - (cols - 1) * 44 + (i % cols) * 88,
      y: -65 - Math.floor(i / cols) * 42,
    }));
  }

  _spawnEnemy(x, y, type, texMap, ts, speedMult) {
    if (this._gameOver) return;
    const isBomber = type === 'BOMBER';
    // Fighter = 58px wide, Bomber = 80px wide — feels right at 480px viewport
    const displayPx    = isBomber ? 80 : 58;
    const targetScale  = displayPx / this._cellSize;
    const e = this.physics.add.sprite(x, y, texMap[type] ?? 'entities-1');
    e.body.setSize(displayPx * 0.55, displayPx * 0.55, true);
    e.setDepth(15);
    e.setData({ type, hp: isBomber ? 3 : 1, speedMult });
    // No tint — let GPT Image 2 natural colors show through
    e.setAlpha(0).setScale(targetScale * 0.15);

    // Materialize — tween to correct targetScale, NOT 1 (which would be full 256px)
    this.tweens.add({ targets: e, alpha: 1, scaleX: targetScale, scaleY: targetScale, duration: 220, ease: 'Back.Out' });

    // Fly to formation y then start AI
    const settleY = Phaser.Math.Between(40, 110);
    this.tweens.add({
      targets: e, y: settleY, duration: 600, ease: 'Sine.Out',
      onComplete: () => { if (e.active) this._startEnemyAI(e, speedMult); },
    });

    this._enemies.add(e);

    if (isBomber) {
      const timer = this.time.addEvent({
        delay: Phaser.Math.Between(1400, 2600), loop: true,
        callback: () => { if (e.active) this._enemyShoot(e); },
      });
      this._enemyFireTimers.set(e, timer);
    }
  }

  _startEnemyAI(e, speedMult) {
    if (!e.active || !e.body) return;
    const isBomber = e.getData('type') === 'BOMBER';
    const baseSpeed = isBomber ? 50 : 88;
    const period = Phaser.Math.Between(1400, 2200);
    let elapsed = 0;

    e.setData('aiUpdate', (delta) => {
      if (!e.active || !e.body) return;
      elapsed += delta;
      const vy = baseSpeed * speedMult;
      const vx = Math.sin((elapsed / period) * Math.PI * 2) * 80 * speedMult;
      e.body.setVelocity(vx, vy);
      if (vx < 0) e.setFlipX(true);
      else if (vx > 0) e.setFlipX(false);
      if (e.y > this.scale.height + 40) {
        e.y = -30;
        e.x = Phaser.Math.Between(40, this.scale.width - 40);
        elapsed = 0;
      }
    });
  }

  // ── Shooting ─────────────────────────────────────────────────────────────────

  _fireBullet() {
    // Use rectangle — cleaner and avoids entity-sprite rendering artifacts
    const b = this.add.rectangle(this.player.x, this.player.y - 18, 5, 16, 0xaaffff).setDepth(18);
    this.physics.add.existing(b);
    b.body.setVelocity(0, -BULLET_SPEED);
    b.body.allowGravity = false;
    b.body.setSize(5, 16);
    this._bullets.add(b);

    // Muzzle flash
    const fl = this.add.circle(this.player.x, this.player.y - 22, 5, C_CYAN, 0.9).setDepth(25);
    this.tweens.add({ targets: fl, scaleX: 3, scaleY: 3, alpha: 0, duration: 70, onComplete: () => fl.destroy() });
  }

  _enemyShoot(e) {
    if (!e.active || !this.player.active) return;
    const dx = this.player.x - e.x, dy = this.player.y - e.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = 135;
    const b = this.add.rectangle(e.x, e.y + 10, 5, 10, C_PINK, 1).setDepth(17);
    this.physics.add.existing(b);
    b.body.setVelocity((dx / len) * spd, (dy / len) * spd);
    b.body.allowGravity = false;
    this._enemyBullets.add(b);

    // Flash on bomber shoot
    const fl = this.add.circle(e.x, e.y + 8, 4, C_PINK, 0.8).setDepth(20);
    this.tweens.add({ targets: fl, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 90, onComplete: () => fl.destroy() });
  }

  _bombBlast() {
    if (this._bombCharges <= 0 || this._gameOver) return;
    this._bombCharges--;
    this._refreshHud();
    const { width: W, height: H } = this.scale;
    const ring = this.add.circle(W / 2, H / 2, 10, C_CYAN, 0.7).setScrollFactor(0).setDepth(490);
    this.tweens.add({ targets: ring, scaleX: 28, scaleY: 28, alpha: 0, duration: 520 });
    const fl = this.add.rectangle(W / 2, H / 2, W, H, C_WHITE, 0.75).setScrollFactor(0).setDepth(491);
    this.tweens.add({ targets: fl, alpha: 0, duration: 280, onComplete: () => fl.destroy() });
    this.cameras.main.shake(220, 0.02);
    for (const e of [...this._enemies.getChildren()]) this._explodeEnemy(e, true);
    for (const b of [...this._enemyBullets.getChildren()]) b.destroy();
  }

  // ── Collisions ────────────────────────────────────────────────────────────────

  _bulletHitEnemy(bullet, enemy) {
    bullet.destroy();
    const hp = (enemy.getData('hp') ?? 1) - 1;
    enemy.setData('hp', hp);
    this._hitFlash(enemy);
    if (hp <= 0) this._explodeEnemy(enemy);
  }

  _playerHitEnemy(player, enemy) {
    if (this._invulnTimer > 0) return;
    enemy.destroy();
    this._damagePlayer();
  }

  _playerHitBullet(player, bullet) {
    if (this._invulnTimer > 0) return;
    bullet.destroy();
    this._damagePlayer();
  }

  _collectGem(player, gem) {
    gem.destroy();
    const bonus = 500 * (1 + Math.floor(this._combo / 3));
    this.score += bonus;
    this._refreshHud();
    this._scorePopup(gem.x, gem.y, `+${bonus}`, C_YELLOW);
    this._pickupSparkle(gem.x, gem.y);
  }

  // ── Damage ────────────────────────────────────────────────────────────────────

  _damagePlayer() {
    this.playerHp = Math.max(0, this.playerHp - 1);
    this._invulnTimer = INVULN_MS;
    this._combo = 0;
    this._refreshHud();
    this._screenFlash(C_RED, 0.38);
    this.cameras.main.shake(190, 0.018);
    if (this.playerHp <= 0) this._triggerGameOver(false);
  }

  _explodeEnemy(enemy, silent = false) {
    if (!enemy.active) return;
    const x = enemy.x, y = enemy.y;
    const isBomber = enemy.getData('type') === 'BOMBER';
    const color    = isBomber ? C_ORANGE : C_PINK;

    const timer = this._enemyFireTimers.get(enemy);
    if (timer) { timer.remove(); this._enemyFireTimers.delete(enemy); }
    enemy.destroy();

    this.enemiesDestroyed++;
    this.score += isBomber ? 300 : 100;

    this._bigExplosion(x, y, color, isBomber ? 1.5 : 1.0);

    if (!silent) {
      this._comboKill(x, y);
      this.cameras.main.shake(isBomber ? 110 : 55, isBomber ? 0.013 : 0.007);
      this._screenFlash(color, isBomber ? 0.18 : 0.1);
      if (Phaser.Math.RND.frac() < 0.22) this._dropGem(x, y);
    }

    this._refreshHud();

    if (this._enemies.countActive() === 0) {
      this.time.delayedCall(900, () => this._onWaveClear());
    }
    if (this.enemiesDestroyed >= ENEMIES_TO_WIN) {
      this.time.delayedCall(600, () => this._triggerGameOver(true));
    }
  }

  _hitFlash(e) {
    e.setTint(C_WHITE);
    this.time.delayedCall(80, () => { if (e.active) e.clearTint(); });
  }

  // ── Visual FX ─────────────────────────────────────────────────────────────────

  _bigExplosion(x, y, color, scale = 1.0) {
    const ring = this.add.circle(x, y, 6 * scale, color, 0.85).setDepth(55);
    this.tweens.add({ targets: ring, scaleX: 9 * scale, scaleY: 9 * scale, alpha: 0, duration: 360, onComplete: () => ring.destroy() });

    const core = this.add.circle(x, y, 4 * scale, C_WHITE, 1).setDepth(56);
    this.tweens.add({ targets: core, scaleX: 5 * scale, scaleY: 5 * scale, alpha: 0, duration: 160, onComplete: () => core.destroy() });

    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10 + Phaser.Math.RND.frac() * 0.3;
      const dist  = (32 + Phaser.Math.RND.between(0, 22)) * scale;
      const sz    = Phaser.Math.RND.between(3, 6) * scale;
      const p = this.add.rectangle(x, y, sz, sz, i % 2 === 0 ? color : C_WHITE).setDepth(57);
      this.tweens.add({
        targets: p, x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist,
        scaleX: 0.1, scaleY: 0.1, alpha: 0,
        duration: 380 + Phaser.Math.RND.between(0, 80),
        onComplete: () => p.destroy(),
      });
    }

    for (let i = 0; i < 4; i++) {
      const angle = Phaser.Math.RND.frac() * Math.PI * 2;
      const streak = this.add.rectangle(x, y, 2, 12 * scale, color, 0.7).setDepth(54).setRotation(angle);
      this.tweens.add({
        targets: streak, x: x + Math.cos(angle) * 50 * scale, y: y + Math.sin(angle) * 50 * scale,
        alpha: 0, scaleX: 0, duration: 440, onComplete: () => streak.destroy(),
      });
    }
  }

  _screenFlash(color, alpha = 0.2) {
    const { width: W, height: H } = this.scale;
    const fl = this.add.rectangle(W / 2, H / 2, W, H, color, alpha).setScrollFactor(0).setDepth(495);
    this.tweens.add({ targets: fl, alpha: 0, duration: 160, onComplete: () => fl.destroy() });
  }

  _pickupSparkle(x, y) {
    const c = this.add.circle(x, y, 2, C_YELLOW, 0.9).setDepth(60);
    this.tweens.add({ targets: c, scaleX: 14, scaleY: 14, alpha: 0, duration: 240, onComplete: () => c.destroy() });
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const p = this.add.rectangle(x, y, 4, 4, C_YELLOW).setDepth(61);
      this.tweens.add({ targets: p, x: x + Math.cos(angle) * 28, y: y + Math.sin(angle) * 28, alpha: 0, duration: 260, onComplete: () => p.destroy() });
    }
  }

  _dropGem(x, y) {
    const manifest = this.registry.get('manifest');
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));
    const ts = manifest.tiles.tileSize;
    const gem = this.physics.add.sprite(x, y, texMap.GEM ?? 'entities-1');
    gem.setScale(22 / this._cellSize).setDepth(14);
    gem.body.setVelocity(Phaser.Math.Between(-40, 40), Phaser.Math.Between(30, 80));
    gem.body.allowGravity = false;
    this._gems.add(gem);
    this.time.delayedCall(600, () => { if (gem.active && gem.body) gem.body.setVelocity(0, 0); });
  }

  _comboKill(x, y) {
    this._combo++;
    clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => { this._combo = 0; }, 1800);
    this.score += this._combo >= 2 ? 100 * this._combo : 0;
    if (this._combo >= 2) {
      const comboColors = ['#ffdd00', '#ff8800', '#ff4400', '#ff00cc', '#cc00ff', '#00ffff'];
      const colStr = comboColors[Math.min(this._combo - 2, comboColors.length - 1)];
      const size = Math.min(11 + this._combo * 2, 26);
      const txt = this.add.text(x, y - 8, `×${this._combo}`, {
        fontSize: `${size}px`, fill: colStr, stroke: '#000', strokeThickness: 3, fontStyle: 'bold',
      }).setDepth(80).setOrigin(0.5);
      this.tweens.add({ targets: txt, y: txt.y - 46, alpha: 0, duration: 720, onComplete: () => txt.destroy() });
    }
  }

  _scorePopup(x, y, text, color) {
    const colStr = `#${color.toString(16).padStart(6, '0')}`;
    const txt = this.add.text(x, y, text, { fontSize: '11px', fill: colStr, stroke: '#000', strokeThickness: 2 }).setDepth(79).setOrigin(0.5);
    this.tweens.add({ targets: txt, y: txt.y - 32, alpha: 0, duration: 580, onComplete: () => txt.destroy() });
  }

  _showWaveBanner(label) {
    const { width: W, height: H } = this.scale;
    const bg  = this.add.rectangle(W / 2, H / 2, W, 38, 0x000000, 0.78).setScrollFactor(0).setDepth(400);
    const txt = this.add.text(W / 2, H / 2, label, {
      fontSize: '22px', fill: '#00f5ff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    bg.setAlpha(0); txt.setAlpha(0);
    this.tweens.add({
      targets: [bg, txt], alpha: 1, duration: 200, hold: 900,
      onComplete: () => this.tweens.add({ targets: [bg, txt], alpha: 0, duration: 300, onComplete: () => { bg.destroy(); txt.destroy(); } }),
    });
  }

  // ── Wave clear ────────────────────────────────────────────────────────────────

  _onWaveClear() {
    if (this._gameOver || this.enemiesDestroyed >= ENEMIES_TO_WIN) return;
    this._waveIndex++;
    this._spawnWave();
  }

  // ── Player trail ─────────────────────────────────────────────────────────────

  _updateTrail() {
    this._trailPositions.unshift({ x: this.player.x, y: this.player.y });
    if (this._trailPositions.length > 7) this._trailPositions.pop();
  }

  _drawTrail() {
    if (!this._trailGraphics) this._trailGraphics = this.add.graphics().setDepth(19);
    else this._trailGraphics.clear();
    for (let i = 0; i < this._trailPositions.length; i++) {
      const t = this._trailPositions[i];
      const a = (1 - i / this._trailPositions.length) * 0.5;
      const sz = Math.max(3 - i * 0.35, 0.5);
      this._trailGraphics.fillStyle(C_CYAN, a);
      this._trailGraphics.fillCircle(t.x, t.y + 9, sz);
    }
  }

  // ── Game over ─────────────────────────────────────────────────────────────────

  _triggerGameOver(won) {
    if (this._gameOver) return;
    this._gameOver = true;
    this._won = won;
    this.player.body.setVelocity(0, 0);
    const { width: W, height: H } = this.scale;

    if (!won) {
      this._bigExplosion(this.player.x, this.player.y, C_CYAN, 2.5);
      this.player.setVisible(false);
      this.cameras.main.shake(420, 0.028);
    }

    this.time.delayedCall(won ? 400 : 750, () => {
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setScrollFactor(0).setDepth(600);
      this.add.text(W / 2, H / 2 - 30, won ? 'SECTOR CLEARED!' : 'SHIP DESTROYED', {
        fontSize: '26px', fill: won ? '#00f5ff' : '#ff2255', stroke: '#000', strokeThickness: 5,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
      this.add.text(W / 2, H / 2 + 8, `SCORE  ${String(this.score).padStart(6, '0')}`, {
        fontSize: '14px', fill: '#ffe600', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
      this.add.text(W / 2, H / 2 + 34, 'Press R to play again', {
        fontSize: '11px', fill: '#aaaaaa',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(601);

      if (won) this._winConfetti();
      this.time.delayedCall(800, () => { this._canRestart = true; });
    });

    window.__gameState = { ...window.__gameState, phase: won ? 'won' : 'lost' };
  }

  _winConfetti() {
    const { width: W, height: H } = this.scale;
    const cols = [C_CYAN, C_PINK, C_ORANGE, C_YELLOW, C_WHITE];
    for (let i = 0; i < 60; i++) {
      const p = this.add.rectangle(
        Phaser.Math.RND.between(0, W), -10,
        Phaser.Math.RND.between(4, 8), Phaser.Math.RND.between(4, 8),
        Phaser.Math.RND.pick(cols)
      ).setScrollFactor(0).setDepth(602);
      this.tweens.add({
        targets: p, y: H + 20,
        x: p.x + Phaser.Math.RND.between(-60, 60),
        rotation: Phaser.Math.RND.frac() * Math.PI * 4,
        duration: Phaser.Math.RND.between(1000, 2200),
        delay: Phaser.Math.RND.between(0, 800),
        onComplete: () => p.destroy(),
      });
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────────

  update(t, delta) {
    if (this._gameOver) {
      this._tickStarfield(delta);
      if (this._canRestart && Phaser.Input.Keyboard.JustDown(this.rKey)) {
        this.scene.restart({ levelIndex: 0 });
      }
      return;
    }

    this._tickStarfield(delta);

    if (this._invulnTimer > 0) {
      this._invulnTimer -= delta;
      this.player.setAlpha(Math.floor(t / 80) % 2 === 0 ? 1 : 0.28);
    } else {
      this.player.setAlpha(1);
    }

    // Movement
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;

    let vx = 0, vy = 0;
    if (left)  vx -= PLAYER_SPEED;
    if (right) vx += PLAYER_SPEED;
    if (up)    vy -= PLAYER_SPEED;
    if (down)  vy += PLAYER_SPEED;
    if (vx && vy) { const f = PLAYER_SPEED / Math.SQRT2; vx = Math.sign(vx) * f; vy = Math.sign(vy) * f; }
    this.player.body.setVelocity(vx, vy);

    this._updateTrail();
    this._drawTrail();

    // Auto-fire
    this._fireTimer -= delta;
    if (this.zKey.isDown && this._fireTimer <= 0) {
      this._fireBullet();
      this._fireTimer = FIRE_RATE_MS;
    }

    // Bomb
    if (Phaser.Input.Keyboard.JustDown(this.xKey)) this._bombBlast();

    // Cull bullets
    for (const b of this._bullets.getChildren()) if (b.y < -20) b.destroy();
    for (const b of this._enemyBullets.getChildren()) {
      if (b.y > this.scale.height + 20 || b.y < -20 || b.x < -20 || b.x > this.scale.width + 20) b.destroy();
    }

    // Enemy AI
    for (const e of this._enemies.getChildren()) {
      const fn = e.getData('aiUpdate');
      if (fn) fn(delta);
    }

    window.__gameState = {
      phase: 'playing',
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
      playerHp: this.playerHp,
      enemiesDestroyed: this.enemiesDestroyed,
      score: this.score,
    };
  }
}
