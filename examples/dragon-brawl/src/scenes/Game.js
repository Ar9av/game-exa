import Phaser from 'phaser';

const FLOOR_Y_MIN   = 196;
const FLOOR_Y_MAX   = 320;
const ATK_RANGE_X   = 52;
const ATK_RANGE_Y   = 26;
const ATK_DURATION  = 220;
const SPAWN_INTERVAL= 2200;
const MAX_ENEMIES   = 4;
const WIN_ENEMIES   = 12;
const PLAYER_HP     = 8;

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
  }

  create() {
    const manifest = this.registry.get('manifest');
    const levels   = this.registry.get('levels');
    const lvl      = levels[this.levelIndex] ?? levels[0];
    const ts       = manifest.tiles.tileSize;
    const [mapW, mapH] = lvl.size;
    const worldW   = mapW * ts;
    const worldH   = mapH * ts;

    this.cameras.main.roundPixels = true;

    // Background (city-night parallax)
    if (manifest.bg) {
      this.add.image(0, 0, 'bg')
        .setOrigin(0, 0).setDepth(-200)
        .setDisplaySize(worldW, worldH)
        .setScrollFactor(0);
    }

    // Tilemap (decorative only — no arcade physics for beat-em-up)
    const map = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    map.createLayer(0, tileset, 0, 0).setDepth(-100);

    // Camera: horizontal scroll only, no auto-follow
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    // Sprites texture map
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));

    // Player (plain sprite — manual movement)
    const pSp = lvl.spawns.find(s => s.entity === 'FIGHTER');
    const pX  = (pSp?.x ?? 5) * ts + ts / 2;
    const pY  = FLOOR_Y_MIN + (FLOOR_Y_MAX - FLOOR_Y_MIN) / 2;
    const pSz = 48;
    this.player = this.add.sprite(pX, pY, texMap.FIGHTER ?? 'entities-1');
    this.player.setDisplaySize(pSz, 60);
    this.player.setDepth(pY);
    if (this.anims.exists('FIGHTER-idle')) this.player.play('FIGHTER-idle', true);

    // Player shadow
    this._pShadow = this.add.ellipse(pX, pY + 28, 36, 10, 0x000000, 0.3).setDepth(pY - 1);

    // Enemies group (plain sprites)
    this._enemies = [];
    this._bossSpawned = false;

    // HUD
    this.playerHp      = PLAYER_HP;
    this.score         = 0;
    this.enemiesDefeated = 0;
    this._over  = false;
    this._won   = false;
    this._canRestart = false;
    this._facingRight = true;
    this._atkActive = false;
    this._atkCd     = 0;
    this._spawnTimer = 0;

    this._buildHud();

    // Spawn timer
    this.time.addEvent({
      delay: SPAWN_INTERVAL,
      callback: this._spawnEnemy,
      callbackScope: this,
      loop: true,
    });

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    window.__gameState = {
      phase: 'playing', playerX: 0, playerY: 0,
      playerHp: PLAYER_HP, score: 0, enemiesDefeated: 0,
    };
    this.events.emit('scene-ready');
  }

  _spawnEnemy() {
    if (this._over || this._won) return;
    if (this._enemies.length >= MAX_ENEMIES) return;
    if (this.enemiesDefeated >= WIN_ENEMIES - 1 && !this._bossSpawned) {
      this._spawnBoss();
      return;
    }
    if (this.enemiesDefeated >= WIN_ENEMIES) return;

    const manifest = this.registry.get('manifest');
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));
    const pool  = ['THUG', 'BIKER', 'ENFORCER'];
    const id    = pool[Phaser.Math.Between(0, pool.length - 1)];
    const stats = { THUG: { hp: 2, speed: 55 }, BIKER: { hp: 2, speed: 70 }, ENFORCER: { hp: 4, speed: 45 } };
    const { hp, speed } = stats[id];
    const side = Math.random() < 0.5 ? 1 : -1;
    const cam  = this.cameras.main;
    const sx   = Phaser.Math.Clamp(this.player.x + side * (cam.width * 0.65 + 40), 60, cam.scrollX + cam.width - 60);
    const sy   = Phaser.Math.Between(FLOOR_Y_MIN + 20, FLOOR_Y_MAX - 20);
    const e    = this.add.sprite(sx, sy, texMap[id] ?? 'entities-1');
    e.setDisplaySize(40, 52);
    e.setDepth(sy);
    if (this.anims.exists(`${id}-idle`)) e.play(`${id}-idle`, true);
    // shadow
    e._shadow = this.add.ellipse(sx, sy + 24, 28, 8, 0x000000, 0.3).setDepth(sy - 1);
    e._id     = id;
    e._hp     = hp;
    e._speed  = speed;
    e._atkTimer = 0;
    this._enemies.push(e);
  }

  _spawnBoss() {
    if (this._bossSpawned) return;
    this._bossSpawned = true;
    const manifest = this.registry.get('manifest');
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));
    const cam = this.cameras.main;
    const sx  = cam.scrollX + cam.width - 80;
    const sy  = FLOOR_Y_MIN + (FLOOR_Y_MAX - FLOOR_Y_MIN) / 2;
    const e   = this.add.sprite(sx, sy, texMap.BOSS_DRAGON ?? 'entities-1');
    e.setDisplaySize(64, 80);
    e.setDepth(sy);
    if (this.anims.exists('BOSS_DRAGON-idle')) e.play('BOSS_DRAGON-idle', true);
    e._shadow = this.add.ellipse(sx, sy + 38, 50, 14, 0x000000, 0.3).setDepth(sy - 1);
    e._id     = 'BOSS_DRAGON';
    e._hp     = 15;
    e._speed  = 40;
    e._atkTimer = 0;
    this._enemies.push(e);
  }

  _buildHud() {
    const s = { fontSize: '13px', fill: '#fff', stroke: '#000', strokeThickness: 3 };
    // HP bar
    this._hpTrack = this.add.rectangle(14 + 60, 14, 120, 10, 0x444444).setOrigin(0, 0.5).setScrollFactor(0).setDepth(300);
    this._hpBar   = this.add.rectangle(14 + 60, 14, 120, 10, 0x44cc44).setOrigin(0, 0.5).setScrollFactor(0).setDepth(301);
    this.add.text(14, 8, 'HP', s).setScrollFactor(0).setDepth(302);
    this._scoreTxt = this.add.text(8, 26, '', s).setScrollFactor(0).setDepth(300);
    this._killTxt  = this.add.text(8, 44, '', s).setScrollFactor(0).setDepth(300);
    this._refreshHud();
  }

  _refreshHud() {
    const pct = Math.max(0, this.playerHp / PLAYER_HP);
    this._hpBar.width = 120 * pct;
    this._hpBar.setFillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xddaa00 : 0xdd2222);
    this._scoreTxt.setText(`Score: ${String(this.score).padStart(6, '0')}`);
    this._killTxt.setText(`Enemies: ${this.enemiesDefeated} / ${WIN_ENEMIES}`);
  }

  _hurtPlayer(dmg) {
    this.playerHp -= dmg;
    this.cameras.main.shake(100, 0.01);
    this._refreshHud();
    if (this.playerHp <= 0) this._lose();
  }

  _win() {
    if (this._won) return;
    this._won = true;
    this._overlay('VICTORY!', 0x003300);
    window.__gameState = { ...window.__gameState, phase: 'win' };
  }

  _lose() {
    if (this._over) return;
    this._over = true;
    this._overlay('KO!', 0x330000);
    window.__gameState = { ...window.__gameState, phase: 'lose' };
  }

  _overlay(msg, _bg) {
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setScrollFactor(0).setDepth(400);
    this.add.text(W / 2, H / 2 - 22, msg, {
      fontSize: '40px', fill: '#fff', stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.add.text(W / 2, H / 2 + 24, 'Press R to restart', { fontSize: '14px', fill: '#bbb' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.time.delayedCall(1000, () => { this._canRestart = true; });
  }

  update(_t, delta) {
    if (this._over || this._won) {
      if (this._canRestart && Phaser.Input.Keyboard.JustDown(this.rKey)) {
        this.scene.restart({ levelIndex: 0 });
      }
      return;
    }

    const spd = 90 * (delta / 1000);
    const left  = this.cursors.left.isDown;
    const right = this.cursors.right.isDown;
    const up    = this.cursors.up.isDown;
    const down  = this.cursors.down.isDown;

    // Movement
    if (left)  { this.player.x -= spd; this._facingRight = false; }
    if (right) { this.player.x += spd; this._facingRight = true; }
    if (up)    this.player.y -= spd * 0.6;
    if (down)  this.player.y += spd * 0.6;

    this.player.x = Phaser.Math.Clamp(this.player.x, 30, this.cameras.main.scrollX + this.cameras.main.width * 2);
    this.player.y = Phaser.Math.Clamp(this.player.y, FLOOR_Y_MIN, FLOOR_Y_MAX);
    this.player.setFlipX(!this._facingRight);
    this.player.setDepth(this.player.y);

    // Player shadow update
    const depthFrac = (this.player.y - FLOOR_Y_MIN) / (FLOOR_Y_MAX - FLOOR_Y_MIN);
    this._pShadow.x = this.player.x;
    this._pShadow.y = this.player.y + 28;
    this._pShadow.scaleX = 0.6 + depthFrac * 0.7;
    this._pShadow.alpha  = 0.18 + depthFrac * 0.25;
    this._pShadow.setDepth(this.player.y - 1);

    // Animation
    if (!this._atkActive) {
      const moving = left || right || up || down;
      if (moving) { if (this.anims.exists('FIGHTER-walk')) this.player.play('FIGHTER-walk', true); }
      else        { if (this.anims.exists('FIGHTER-idle')) this.player.play('FIGHTER-idle', true); }
    }

    // Attack
    this._atkCd = Math.max(0, this._atkCd - delta);
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && this._atkCd <= 0) this._attack(delta);

    // One-way camera scroll (only moves right)
    const camX = Math.max(this.cameras.main.scrollX, this.player.x - this.cameras.main.width * 0.4);
    this.cameras.main.setScroll(camX, 0);

    // Enemy AI
    for (const e of this._enemies) this._tickEnemy(e, delta);

    window.__gameState = {
      phase: 'playing',
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
      playerHp: this.playerHp,
      score: this.score,
      enemiesDefeated: this.enemiesDefeated,
    };
  }

  _attack(delta) {
    this._atkCd = 500;
    this._atkActive = true;
    if (this.anims.exists('FIGHTER-cast')) this.player.play('FIGHTER-cast', true);
    this.player.setTint(0xffddaa);

    const hx = this.player.x + (this._facingRight ? ATK_RANGE_X : -ATK_RANGE_X);
    for (const e of this._enemies) {
      if (!e.active) continue;
      if (Math.abs(e.x - hx) < ATK_RANGE_X && Math.abs(e.y - this.player.y) < ATK_RANGE_Y) {
        this._hitEnemy(e);
      }
    }

    this.time.delayedCall(ATK_DURATION, () => {
      this._atkActive = false;
      this.player.clearTint();
    });
  }

  _hitEnemy(e) {
    e._hp--;
    e.setTint(0xff4444);
    this.cameras.main.shake(80, 0.006);
    this.score += 100;
    this._refreshHud();
    this.time.delayedCall(180, () => { if (e.active) e.clearTint(); });
    if (e._hp <= 0) {
      this.score += 200;
      this.tweens.add({
        targets: [e, e._shadow],
        alpha: 0, y: `+=${-24}`,
        duration: 280,
        onComplete: () => {
          e.destroy();
          if (e._shadow) e._shadow.destroy();
        },
      });
      this._enemies = this._enemies.filter(x => x !== e);
      this.enemiesDefeated++;
      this._refreshHud();
      if (this.enemiesDefeated >= WIN_ENEMIES) this._win();
    }
  }

  _tickEnemy(e, delta) {
    if (!e.active) return;
    const dx  = this.player.x - e.x;
    const dy  = this.player.y - e.y;
    const spd = e._speed * (delta / 1000);

    // Move toward player
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 8) {
      e.x += (dx / dist) * spd;
      e.y += (dy / dist) * spd * 0.6;
    }
    e.x = Phaser.Math.Clamp(e.x, 30, this.cameras.main.scrollX + this.cameras.main.width * 2 - 30);
    e.y = Phaser.Math.Clamp(e.y, FLOOR_Y_MIN, FLOOR_Y_MAX);
    e.setFlipX(dx < 0);
    e.setDepth(e.y);
    if (e._shadow) {
      e._shadow.x = e.x;
      e._shadow.y = e.y + (e._id === 'BOSS_DRAGON' ? 38 : 24);
      const df = (e.y - FLOOR_Y_MIN) / (FLOOR_Y_MAX - FLOOR_Y_MIN);
      e._shadow.scaleX = 0.6 + df * 0.7;
      e._shadow.alpha  = 0.18 + df * 0.25;
      e._shadow.setDepth(e.y - 1);
    }

    if (this.anims.exists(`${e._id}-walk`)) e.play(`${e._id}-walk`, true);

    // Attack player when close
    e._atkTimer = (e._atkTimer ?? 0) - delta;
    if (dist < 36 && e._atkTimer <= 0) {
      e._atkTimer = 900;
      this._hurtPlayer(e._id === 'BOSS_DRAGON' ? 2 : 1);
    }
  }
}
