import Phaser from 'phaser';

const PLAYER_SPEED  = 110;
const ATK_RANGE     = 48;
const ATK_COOLDOWN  = 350;
const ATK_DURATION  = 200;
const PLAYER_HP     = 6;
const HEARTS_TO_WIN = 5;

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

    // Tilemap
    const map = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    this._tileLayer = map.createLayer(0, tileset, 0, 0);

    const impassable = manifest.tiles.passable.map((p, i) => p ? null : i).filter(v => v !== null);
    this._tileLayer.setCollision(impassable);

    // Physics (top-down — no gravity)
    this.physics.world.gravity.y = 0;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // Sprite texture map
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));

    // Player
    const pSp = lvl.spawns.find(s => s.entity === 'HERO');
    const pSz = ts * 1.25;
    this.player = this.physics.add.sprite(
      (pSp?.x ?? 5) * ts + ts / 2,
      (pSp?.y ?? 5) * ts + ts / 2,
      texMap.HERO ?? 'entities-1'
    );
    this.player.setDisplaySize(pSz, pSz);
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(pSz * 0.45, pSz * 0.45, true);
    this.player.setDepth(10);
    this.physics.add.collider(this.player, this._tileLayer);

    // Enemies
    this._enemies = this.physics.add.group();
    this._spawnEntities(lvl, manifest, ts, texMap);
    this.physics.add.collider(this._enemies, this._tileLayer);
    this.physics.add.collider(this._enemies, this._enemies);

    // Hearts (pickups)
    this._hearts = this.physics.add.staticGroup();
    for (const sp of lvl.spawns) {
      if (sp.entity !== 'HEART') continue;
      const h = this._hearts.create(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2,
        texMap.HEART ?? 'entities-1'
      );
      h.setDisplaySize(ts * 0.7, ts * 0.7);
      if (this.anims.exists('HEART-idle')) h.play('HEART-idle', true);
      h.setDepth(5);
    }
    this.physics.add.overlap(this.player, this._hearts, (_p, h) => {
      h.destroy();
      this.heartsCollected++;
      this.score += 250;
      this._refreshHud();
      if (this.heartsCollected >= HEARTS_TO_WIN) this._win();
    });

    // Camera
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player);

    // Input
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.wasd     = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // State
    this.playerHp       = PLAYER_HP;
    this.heartsCollected = 0;
    this.score          = 0;
    this._iframes       = 0;
    this._facingDir     = 'down';
    this._atkCd         = 0;
    this._atkActive     = false;
    this._over          = false;
    this._won           = false;
    this._canRestart    = false;

    this._buildHud();

    window.__gameState = {
      phase: 'playing', playerX: 0, playerY: 0,
      playerHp: PLAYER_HP, score: 0, heartsCollected: 0,
    };
    this.events.emit('scene-ready');
  }

  _spawnEntities(lvl, manifest, ts, texMap) {
    const defs = {
      FOREST_SPRITE: { hp: 2, speed: 70 },
      STONE_GOLEM:   { hp: 5, speed: 35 },
      WIZARD:        { hp: 12, speed: 50 },
    };
    for (const sp of lvl.spawns) {
      if (!defs[sp.entity]) continue;
      const { hp, speed } = defs[sp.entity];
      const sz = ts * (sp.entity === 'WIZARD' ? 1.5 : 1.2);
      const e = this.physics.add.sprite(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2,
        texMap[sp.entity] ?? 'entities-1'
      );
      e.setDisplaySize(sz, sz);
      e.body.setSize(sz * 0.45, sz * 0.45, true);
      e.setCollideWorldBounds(true);
      e.setData({ id: sp.entity, hp, speed, wander: 0, dir: 0 });
      if (this.anims.exists(`${sp.entity}-idle`)) e.play(`${sp.entity}-idle`, true);
      e.setDepth(9);
      this._enemies.add(e);
    }
  }

  _buildHud() {
    const s = { fontSize: '13px', fill: '#fff', stroke: '#000', strokeThickness: 3 };
    this._hpTxt     = this.add.text(8, 8,  '', s).setScrollFactor(0).setDepth(300);
    this._heartTxt  = this.add.text(8, 26, '', s).setScrollFactor(0).setDepth(300);
    this._scoreTxt  = this.add.text(8, 44, '', s).setScrollFactor(0).setDepth(300);
    this._refreshHud();
  }

  _refreshHud() {
    const h = Math.max(0, this.playerHp);
    this._hpTxt.setText('HP: ' + '♥'.repeat(h) + '♡'.repeat(Math.max(0, PLAYER_HP - h)));
    this._heartTxt.setText(`Crystals: ${this.heartsCollected}/${HEARTS_TO_WIN}`);
    this._scoreTxt.setText(`Score: ${this.score}`);
  }

  _hurtPlayer(dmg) {
    if (this._iframes > 0) return;
    this.playerHp -= dmg;
    this._iframes = 70;
    this.player.setTint(0xff6666);
    this.cameras.main.shake(100, 0.007);
    this._refreshHud();
    if (this.playerHp <= 0) this._lose();
  }

  _win() {
    if (this._won) return;
    this._won = true;
    this._overlay('ISLAND SAVED!', 0x003300);
    window.__gameState = { ...window.__gameState, phase: 'win' };
  }

  _lose() {
    if (this._over) return;
    this._over = true;
    this._overlay('GAME OVER', 0x330000);
    window.__gameState = { ...window.__gameState, phase: 'lose' };
  }

  _overlay(msg, _bg) {
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setScrollFactor(0).setDepth(400);
    this.add.text(W / 2, H / 2 - 22, msg, {
      fontSize: '30px', fill: '#fff', stroke: '#000', strokeThickness: 4,
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

    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;

    // 8-direction movement — normalize diagonal
    let vx = 0, vy = 0;
    if (left)  vx -= 1;
    if (right) vx += 1;
    if (up)    vy -= 1;
    if (down)  vy += 1;
    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * PLAYER_SPEED;
      vy = (vy / len) * PLAYER_SPEED;
    }
    this.player.body.setVelocity(vx, vy);

    // Facing direction
    if      (right) this._facingDir = 'right';
    else if (left)  this._facingDir = 'left';
    else if (up)    this._facingDir = 'up';
    else if (down)  this._facingDir = 'down';

    if (vx < 0) this.player.setFlipX(true);
    else if (vx > 0) this.player.setFlipX(false);

    // Attack
    this._atkCd = Math.max(0, this._atkCd - delta);
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && this._atkCd <= 0) this._attack();

    // Animation
    if (!this._atkActive) {
      if (vx !== 0 || vy !== 0) { if (this.anims.exists('HERO-walk')) this.player.play('HERO-walk', true); }
      else                      { if (this.anims.exists('HERO-idle')) this.player.play('HERO-idle', true); }
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
      heartsCollected: this.heartsCollected,
    };
  }

  _attack() {
    this._atkCd = ATK_COOLDOWN;
    this._atkActive = true;
    if (this.anims.exists('HERO-walk')) this.player.play('HERO-walk', true);
    this.player.setTint(0xffffff);

    const dirVec = { right: [1,0], left: [-1,0], up: [0,-1], down: [0,1] }[this._facingDir];
    const ax = this.player.x + dirVec[0] * ATK_RANGE;
    const ay = this.player.y + dirVec[1] * ATK_RANGE;

    this._enemies.getChildren().forEach(e => {
      if (!e.active) return;
      if (Math.abs(e.x - ax) < ATK_RANGE && Math.abs(e.y - ay) < ATK_RANGE) this._hitEnemy(e);
    });

    this.time.delayedCall(ATK_DURATION, () => {
      this._atkActive = false;
      this.player.clearTint();
    });
  }

  _hitEnemy(e) {
    const hp = e.getData('hp') - 1;
    e.setData('hp', hp);
    e.setTint(0xff4444);
    this.score += 150;
    this._refreshHud();
    this.time.delayedCall(180, () => { if (e.active) e.clearTint(); });
    if (hp <= 0) {
      this.score += 300;
      this._refreshHud();
      this.tweens.add({ targets: e, alpha: 0, y: e.y - 20, duration: 260, onComplete: () => e.destroy() });
    } else {
      // Knockback
      const kx = Math.sign(e.x - this.player.x);
      const ky = Math.sign(e.y - this.player.y);
      e.body.setVelocity(kx * 180, ky * 180);
      this.time.delayedCall(150, () => { if (e.active) e.body.setVelocity(0, 0); });
    }
  }

  _tickEnemy(e, dt) {
    if (!e.active || !e.body) return;
    const id    = e.getData('id');
    const speed = e.getData('speed') ?? 60;
    const dx    = this.player.x - e.x;
    const dy    = this.player.y - e.y;
    const dist  = Math.sqrt(dx * dx + dy * dy);

    if (dist < 200) {
      // Chase
      const nx = dx / dist, ny = dy / dist;
      e.body.setVelocity(nx * speed, ny * speed);
      e.setFlipX(dx < 0);
      if (this.anims.exists(`${id}-walk`)) e.play(`${id}-walk`, true);
    } else {
      // Wander
      let wt = e.getData('wander') - dt;
      if (wt <= 0) {
        const angle = Math.random() * Math.PI * 2;
        e.setData('dir', { x: Math.cos(angle), y: Math.sin(angle) });
        wt = Phaser.Math.Between(800, 2000);
      }
      e.setData('wander', wt);
      const dir = e.getData('dir') ?? { x: 0, y: 0 };
      e.body.setVelocity(dir.x * speed * 0.4, dir.y * speed * 0.4);
      if (this.anims.exists(`${id}-idle`)) e.play(`${id}-idle`, true);
    }

    // Wizard shoots cast animation when nearby
    if (id === 'WIZARD' && dist < 120) {
      if (this.anims.exists('WIZARD-cast')) e.play('WIZARD-cast', true);
    }
  }
}
