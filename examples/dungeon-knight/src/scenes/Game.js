import Phaser from 'phaser';

const PLAYER_SPEED = 160;
const JUMP_VY = -380;
const COYOTE_MS = 80;
const ATTACK_COOLDOWN = 400;
const ATK_RX = 38;
const ATK_RY = 28;
const PLAYER_HP = 5;
const ORBS_TO_WIN = 5;

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

    // Parallax background
    if (manifest.bg) {
      this.add.image(0, 0, 'bg')
        .setOrigin(0, 0).setDepth(-200)
        .setDisplaySize(worldW, worldH)
        .setScrollFactor(manifest.bg.scrollFactor ?? 0.25);
    }

    // Tilemap
    const map = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    this._tileLayer = map.createLayer(0, tileset, 0, 0);

    const impassable = manifest.tiles.passable.map((p, i) => p ? null : i).filter(v => v !== null);
    this._tileLayer.setCollision(impassable);

    const skyIdx = manifest.tiles.ids.indexOf('SKY');
    if (skyIdx >= 0) {
      this._tileLayer.forEachTile(t => { if (t.index === skyIdx) t.setAlpha(0); });
    }
    this._spikeIdx = manifest.tiles.ids.indexOf('SPIKE');

    // Physics
    this.physics.world.gravity.y = 520;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // Player
    const pSp = lvl.spawns.find(s => s.entity === 'KNIGHT');
    const pSz = ts * 1.4;
    this.player = this.physics.add.sprite(
      (pSp?.x ?? 3) * ts + ts / 2,
      (pSp?.y ?? 29) * ts,
      'entities-1'
    );
    this.player.setDisplaySize(pSz, pSz);
    this.player.setCollideWorldBounds(true);
    this.player.body.setMaxVelocityY(600);
    this.player.body.setSize(pSz * 0.5, pSz * 0.72, true);
    this.player.setDepth(10);
    this.physics.add.collider(this.player, this._tileLayer);

    // Enemies
    this._enemies = this.physics.add.group();
    this._spawnEnemies(lvl, manifest, ts);
    this.physics.add.collider(this._enemies, this._tileLayer);

    // ORBs
    this._orbs = this.physics.add.staticGroup();
    for (const sp of lvl.spawns) {
      if (sp.entity !== 'ORB') continue;
      const orb = this._orbs.create(sp.x * ts + ts / 2, sp.y * ts + ts / 2, 'entities-1');
      orb.setDisplaySize(ts * 0.75, ts * 0.75);
      if (this.anims.exists('ORB-idle')) orb.play('ORB-idle', true);
      orb.setDepth(5);
    }
    this.physics.add.overlap(this.player, this._orbs, (_p, orb) => {
      orb.destroy();
      this.orbsCollected++;
      this.score += 200;
      this._refreshHud();
      if (this.orbsCollected >= ORBS_TO_WIN) this._win();
    });

    // Camera
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.zKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Game state
    this.playerHp      = PLAYER_HP;
    this.orbsCollected = 0;
    this.score         = 0;
    this._iframes      = 0;
    this._coyote       = 0;
    this._isJumping    = false;
    this._facingRight  = true;
    this._atkCd        = 0;
    this._atkActive    = false;
    this._over         = false;
    this._won          = false;
    this._canRestart   = false;

    this._buildHud();

    window.__gameState = {
      phase: 'playing', playerX: 0, playerY: 0,
      playerHp: PLAYER_HP, score: 0, orbsCollected: 0,
    };
    this.events.emit('scene-ready');
  }

  _spawnEnemies(lvl, manifest, ts) {
    const defs = {
      SKELETON:    { hp: 2, speed: 60 },
      SLIME:       { hp: 1, speed: 40 },
      GHOST:       { hp: 1, speed: 75 },
      DARK_KNIGHT: { hp: 10, speed: 50 },
    };
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));

    for (const sp of lvl.spawns) {
      if (!defs[sp.entity]) continue;
      const { hp, speed } = defs[sp.entity];
      const isBoss = sp.entity === 'DARK_KNIGHT';
      const sz = ts * (isBoss ? 1.9 : 1.15);
      const e = this.physics.add.sprite(
        sp.x * ts + ts / 2, sp.y * ts,
        texMap[sp.entity] ?? 'entities-1'
      );
      e.setDisplaySize(sz, sz);
      e.body.setSize(sz * 0.5, sz * 0.68, true);
      e.setCollideWorldBounds(true);
      e.body.setMaxVelocityY(600);
      e.setData({ id: sp.entity, hp, speed, dir: 1, wander: 0 });
      if (this.anims.exists(`${sp.entity}-idle`)) e.play(`${sp.entity}-idle`, true);
      e.setDepth(isBoss ? 12 : 9);
      this._enemies.add(e);
    }
  }

  _buildHud() {
    const s = { fontSize: '13px', fill: '#fff', stroke: '#000', strokeThickness: 3 };
    this._hpTxt    = this.add.text(8, 8,  '', s).setScrollFactor(0).setDepth(300);
    this._orbTxt   = this.add.text(8, 26, '', s).setScrollFactor(0).setDepth(300);
    this._scoreTxt = this.add.text(8, 44, '', s).setScrollFactor(0).setDepth(300);
    this._refreshHud();
  }

  _refreshHud() {
    const h = Math.max(0, this.playerHp);
    this._hpTxt.setText('HP: ' + '♥'.repeat(h) + '♡'.repeat(Math.max(0, PLAYER_HP - h)));
    this._orbTxt.setText(`Orbs: ${this.orbsCollected}/${ORBS_TO_WIN}`);
    this._scoreTxt.setText(`Score: ${this.score}`);
  }

  _hurtPlayer(dmg) {
    if (this._iframes > 0) return;
    this.playerHp -= dmg;
    this._iframes = 80;
    this.player.setTint(0xff6666);
    this.cameras.main.shake(120, 0.007);
    this._refreshHud();
    if (this.playerHp <= 0) this._lose();
  }

  _win() {
    if (this._won) return;
    this._won = true;
    this._overlay('YOU WIN!', 0x003300);
    window.__gameState = { ...window.__gameState, phase: 'win' };
  }

  _lose() {
    if (this._over) return;
    this._over = true;
    this._overlay('GAME OVER', 0x330000);
    window.__gameState = { ...window.__gameState, phase: 'lose' };
  }

  _overlay(msg, bgColor) {
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setScrollFactor(0).setDepth(400);
    this.add.text(W / 2, H / 2 - 22, msg, {
      fontSize: '32px', fill: '#fff', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.add.text(W / 2, H / 2 + 20, 'Press R to restart', { fontSize: '14px', fill: '#bbb' })
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

    const onGround = this.player.body.blocked.down;
    const left     = this.cursors.left.isDown;
    const right    = this.cursors.right.isDown;
    const jumpJD   = Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
                     Phaser.Input.Keyboard.JustDown(this.cursors.space);

    // Coyote time
    if (onGround) { this._coyote = COYOTE_MS; this._isJumping = false; }
    else          { this._coyote = Math.max(0, this._coyote - delta); }

    // Movement
    if (left)       { this.player.body.setVelocityX(-PLAYER_SPEED); this._facingRight = false; this.player.setFlipX(true); }
    else if (right) { this.player.body.setVelocityX(PLAYER_SPEED);  this._facingRight = true;  this.player.setFlipX(false); }
    else            { this.player.body.setVelocityX(0); }

    // Jump (with coyote time)
    if (jumpJD && this._coyote > 0 && !this._isJumping) {
      this.player.body.setVelocityY(JUMP_VY);
      this._coyote = 0;
      this._isJumping = true;
    }
    // Variable jump height
    if (!(this.cursors.up.isDown || this.cursors.space.isDown) && this.player.body.velocity.y < -80) {
      this.player.body.setVelocityY(this.player.body.velocity.y * 0.88);
    }

    // Attack
    this._atkCd = Math.max(0, this._atkCd - delta);
    if (Phaser.Input.Keyboard.JustDown(this.zKey) && this._atkCd <= 0) this._attack();

    // Spike overlap check
    if (this._spikeIdx >= 0) {
      const spTiles = this._tileLayer.getTilesWithinWorldXY(
        this.player.x - 10, this.player.y - 6, 20, 14
      );
      if (spTiles && spTiles.some(t => t.index === this._spikeIdx)) {
        if (!this._iframes) this._hurtPlayer(1);
      }
    }

    // Animation
    if (!this._atkActive) {
      if (!onGround)         this.player.play('KNIGHT-jump', true);
      else if (left || right) this.player.play('KNIGHT-walk', true);
      else                   this.player.play('KNIGHT-idle', true);
    }

    // Iframes blink
    if (this._iframes > 0) {
      this._iframes--;
      this.player.setAlpha(Math.floor(this._iframes / 5) % 2 === 0 ? 1 : 0.35);
      if (this._iframes === 0) { this.player.setAlpha(1); this.player.clearTint(); }
    }

    // Enemies
    this._enemies.getChildren().forEach(e => this._tickEnemy(e, delta));

    // Enemy contact damage
    this._enemies.getChildren().forEach(e => {
      if (!e.active || this._atkActive) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), e.getBounds())) {
        if (!this._iframes) this._hurtPlayer(1);
      }
    });

    window.__gameState = {
      phase: 'playing',
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
      playerHp: this.playerHp,
      score: this.score,
      orbsCollected: this.orbsCollected,
    };
  }

  _attack() {
    this._atkCd = ATTACK_COOLDOWN;
    this._atkActive = true;
    if (this.anims.exists('KNIGHT-cast')) this.player.play('KNIGHT-cast', true);
    this.player.setTint(0xffddaa);

    const ax = this.player.x + (this._facingRight ? ATK_RX : -ATK_RX);
    const ay = this.player.y;
    this._enemies.getChildren().forEach(e => {
      if (!e.active) return;
      if (Math.abs(e.x - ax) < ATK_RX && Math.abs(e.y - ay) < ATK_RY) this._hitEnemy(e);
    });

    this.time.delayedCall(220, () => {
      this._atkActive = false;
      this.player.clearTint();
    });
  }

  _hitEnemy(e) {
    const hp = e.getData('hp') - 1;
    e.setData('hp', hp);
    e.setTint(0xff4444);
    this.score += 100;
    this._refreshHud();
    this.time.delayedCall(180, () => { if (e.active) e.clearTint(); });
    if (hp <= 0) {
      this.score += 300;
      this._refreshHud();
      this.tweens.add({ targets: e, alpha: 0, y: e.y - 28, duration: 280, onComplete: () => e.destroy() });
    } else {
      e.body.setVelocityX(this._facingRight ? 200 : -200);
    }
  }

  _tickEnemy(e, dt) {
    if (!e.active || !e.body) return;
    const id    = e.getData('id');
    const speed = e.getData('speed') ?? 60;
    const dx    = this.player.x - e.x;

    if (id === 'GHOST') {
      e.body.setAllowGravity(false);
      const dy = this.player.y - e.y;
      e.body.setVelocityX(dx > 0 ? speed : -speed);
      e.body.setVelocityY(Math.sign(dy) * speed * 0.55);
      e.setFlipX(dx < 0);
      if (this.anims.exists(`${id}-walk`)) e.play(`${id}-walk`, true);
      return;
    }

    if (Math.abs(dx) < 220) {
      e.body.setVelocityX(dx > 0 ? speed : -speed);
      e.setFlipX(dx < 0);
      if (this.anims.exists(`${id}-walk`)) e.play(`${id}-walk`, true);
    } else {
      let wt = e.getData('wander') - dt;
      if (wt <= 0) { e.setData('dir', Phaser.Math.Between(0, 1) ? 1 : -1); wt = Phaser.Math.Between(900, 2200); }
      e.setData('wander', wt);
      const dir = e.getData('dir');
      e.body.setVelocityX(dir * speed * 0.5);
      e.setFlipX(dir < 0);
      if (this.anims.exists(`${id}-idle`)) e.play(`${id}-idle`, true);
    }

    if (id === 'DARK_KNIGHT' && Math.abs(dx) < 300) {
      e.body.setVelocityX(dx > 0 ? speed * 1.5 : -speed * 1.5);
    }
  }
}
