import Phaser from 'phaser';

const PLAYER_SPEED  = 90;
const NPC_SPEED     = 28;
const TALK_RANGE    = 44;
const CHESTS_TO_WIN = 5;

// Built-in fallback dialogue — used when npc-dialogue.json is unavailable
const FALLBACK_DIALOGUE = {
  NPC_GIRL:  [
    'Welcome to Verdant Town!\nI heard treasure is hidden all over!',
    'The flowers here bloom every season.\nIsn\'t it lovely?',
  ],
  NPC_BOY:   [
    'Hey! Are you collecting\nthe town\'s hidden chests?',
    'I found one near the big\nbuilding to the south!',
  ],
  NPC_ELDER: [
    'Ah, a traveller! This town has\nfive legendary treasure chests.',
    'Legend says whoever finds them all\nwill be blessed with great fortune.',
  ],
};

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this._npcDialogue = FALLBACK_DIALOGUE;
  }

  preload() {
    // Load personality-driven dialogue generated at build time (optional)
    this.load.json('npc-dialogue', 'data/npc-dialogue.json');
  }

  create() {
    // Swap in generated dialogue if available
    const generated = this.cache.json.get('npc-dialogue');
    if (generated && Object.keys(generated).length > 0) {
      this._npcDialogue = generated;
    }
    const manifest = this.registry.get('manifest');
    const levels   = this.registry.get('levels');
    const lvl      = levels[this.levelIndex] ?? levels[0];
    const ts       = manifest.tiles.tileSize;
    const [mapW, mapH] = lvl.size;
    const worldW   = mapW * ts;
    const worldH   = mapH * ts;

    this.cameras.main.roundPixels = true;
    this.physics.world.gravity.y = 0;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // Tilemap
    const map = this.make.tilemap({ data: lvl.tiles, tileWidth: ts, tileHeight: ts });
    const tileset = map.addTilesetImage('tileset', 'tiles', ts, ts, 0, 0);
    this._tileLayer = map.createLayer(0, tileset, 0, 0);

    const impassable = manifest.tiles.passable.map((p, i) => p ? null : i).filter(v => v !== null);
    this._tileLayer.setCollision(impassable);

    // Texture map
    const texMap = {};
    manifest.sprites.forEach((sh, i) => sh.rows.forEach(r => { texMap[r] = `entities-${i + 1}`; }));

    // Player
    const pSp = lvl.spawns.find(s => s.entity === 'TRAINER');
    const pSz = ts * 1.1;
    this.player = this.physics.add.sprite(
      (pSp?.x ?? 12) * ts + ts / 2,
      (pSp?.y ?? 10) * ts + ts / 2,
      texMap.TRAINER ?? 'entities-1'
    );
    this.player.setDisplaySize(pSz, pSz);
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(pSz * 0.45, pSz * 0.45, true);
    this.player.setDepth(10);
    this.physics.add.collider(this.player, this._tileLayer);

    // NPCs
    this._npcs = this.physics.add.group();
    const npcDefs = ['NPC_GIRL', 'NPC_BOY', 'NPC_ELDER'];
    for (const sp of lvl.spawns) {
      if (!npcDefs.includes(sp.entity)) continue;
      const npc = this.physics.add.sprite(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2,
        texMap[sp.entity] ?? 'entities-1'
      );
      npc.setDisplaySize(ts * 1.05, ts * 1.05);
      npc.body.setSize(ts * 0.4, ts * 0.4, true);
      npc.setCollideWorldBounds(true);
      npc.setData({ id: sp.entity, wander: 0, dir: { x: 0, y: 0 }, dialogueIdx: 0 });
      npc.setDepth(9);
      if (this.anims.exists(`${sp.entity}-idle`)) npc.play(`${sp.entity}-idle`, true);
      this._npcs.add(npc);
    }
    this.physics.add.collider(this._npcs, this._tileLayer);
    this.physics.add.collider(this._npcs, this._npcs);
    this.physics.add.collider(this.player, this._npcs);

    // Chests
    this._chests = this.physics.add.staticGroup();
    for (const sp of lvl.spawns) {
      if (sp.entity !== 'CHEST') continue;
      const c = this._chests.create(
        sp.x * ts + ts / 2, sp.y * ts + ts / 2,
        texMap.CHEST ?? 'entities-1'
      );
      c.setDisplaySize(ts * 0.7, ts * 0.7).setDepth(5);
    }
    this.physics.add.overlap(this.player, this._chests, (_p, c) => {
      this._collectChest(c);
    });

    // Camera
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // Input
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.wasd     = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // State
    this.chestsFound  = 0;
    this._facingDir   = 'down';
    this._over        = false;
    this._won         = false;
    this._canRestart  = false;
    this._dialogueOpen = false;
    this._dialogueBox  = null;

    this._buildHud(manifest, texMap, ts);

    window.__gameState = { phase: 'playing', playerX: 0, playerY: 0, chestsFound: 0 };
    this.events.emit('scene-ready');
  }

  _buildHud(manifest, texMap, ts) {
    const W = this.scale.width;
    // Portrait box
    const portrait = this.add.sprite(22, 22, texMap.TRAINER ?? 'entities-1')
      .setDisplaySize(28, 28).setScrollFactor(0).setDepth(302);
    this.add.rectangle(4, 4, 36, 36, 0x000000).setOrigin(0).setScrollFactor(0).setDepth(300);
    this.add.rectangle(5, 5, 34, 34, 0x225522).setOrigin(0).setScrollFactor(0).setDepth(301);

    // Chest counter
    const s = { fontSize: '12px', fill: '#fff', stroke: '#000', strokeThickness: 3 };
    this._chestTxt = this.add.text(46, 8, `CHESTS  0/${CHESTS_TO_WIN}`, s).setScrollFactor(0).setDepth(302);
    // Title top-center
    this.add.text(W / 2, 8, 'VERDANT TOWN', {
      fontSize: '11px', fill: '#ffee88', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(302);
  }

  _refreshHud() {
    this._chestTxt.setText(`CHESTS  ${this.chestsFound}/${CHESTS_TO_WIN}`);
  }

  _collectChest(c) {
    c.destroy();
    this.chestsFound++;
    this._refreshHud();
    this._pickupSparkle(c.x, c.y);
    if (this.chestsFound >= CHESTS_TO_WIN) this._win();
  }

  _pickupSparkle(x, y) {
    const circle = this.add.circle(x, y, 1, 0xffee44, 0.9).setDepth(60);
    this.tweens.add({ targets: circle, scaleX: 16, scaleY: 16, alpha: 0, duration: 300, onComplete: () => circle.destroy() });
    for (let i = 0; i < 5; i++) {
      const g = this.add.graphics().setDepth(61);
      g.fillStyle(0xffee44, 1).fillRect(0, 0, 4, 4).setPosition(x, y);
      const angle = (Math.PI * 2 * i) / 5;
      this.tweens.add({ targets: g, x: x + Math.cos(angle) * 22, y: y + Math.sin(angle) * 22, alpha: 0, duration: 260, onComplete: () => g.destroy() });
    }
  }

  _win() {
    if (this._won) return;
    this._won = true;
    const { width: W, height: H } = this.scale;
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setScrollFactor(0).setDepth(400);
    this.add.text(W / 2, H / 2 - 24, 'TOWN EXPLORED!', {
      fontSize: '28px', fill: '#ffee44', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.add.text(W / 2, H / 2 + 16, 'All 5 chests found!', {
      fontSize: '14px', fill: '#aaffaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.add.text(W / 2, H / 2 + 42, 'Press R to play again', {
      fontSize: '12px', fill: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.time.delayedCall(1000, () => { this._canRestart = true; });
    window.__gameState = { ...window.__gameState, phase: 'win' };
  }

  _tryTalk() {
    if (this._dialogueOpen) {
      this._closeDialogue();
      return;
    }
    let closest = null, closestDist = TALK_RANGE;
    for (const npc of this._npcs.getChildren()) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (d < closestDist) { closestDist = d; closest = npc; }
    }
    if (closest) this._openDialogue(closest);
  }

  _openDialogue(npc) {
    const id = npc.getData('id');
    const lines = this._npcDialogue[id] ?? FALLBACK_DIALOGUE[id] ?? ['...'];
    const idx = npc.getData('dialogueIdx') ?? 0;
    const text = lines[idx % lines.length];
    npc.setData('dialogueIdx', idx + 1);

    const { width: W, height: H } = this.scale;
    const box  = this.add.rectangle(W / 2, H - 52, W - 16, 80, 0xffffff, 0.95)
      .setStrokeStyle(2, 0x225522).setScrollFactor(0).setDepth(500);
    // NPC name tag
    const nameTag = this.add.text(12, H - 86, id.replace('NPC_', ''), {
      fontSize: '10px', fill: '#fff', backgroundColor: '#225522', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(501);
    const txt = this.add.text(14, H - 84, text, {
      fontSize: '12px', fill: '#111111', wordWrap: { width: W - 32 },
    }).setScrollFactor(0).setDepth(501);
    const hint = this.add.text(W - 12, H - 18, '▼ SPACE', {
      fontSize: '9px', fill: '#888',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(501);

    this._dialogueOpen = true;
    this._dialogueBox = { box, txt, nameTag, hint };
  }

  _closeDialogue() {
    if (!this._dialogueBox) return;
    const { box, txt, nameTag, hint } = this._dialogueBox;
    box.destroy(); txt.destroy(); nameTag.destroy(); hint.destroy();
    this._dialogueBox = null;
    this._dialogueOpen = false;
  }

  update(_t, delta) {
    if (this._won) {
      if (this._canRestart && Phaser.Input.Keyboard.JustDown(this.rKey)) {
        this.scene.restart({ levelIndex: 0 });
      }
      return;
    }

    // SPACE = talk / close dialogue
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) this._tryTalk();

    // Block movement while dialogue is open
    if (this._dialogueOpen) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;

    // 4-direction movement (Pokemon-style — no diagonal)
    let vx = 0, vy = 0;
    if      (left)  { vx = -PLAYER_SPEED; this._facingDir = 'left'; }
    else if (right) { vx =  PLAYER_SPEED; this._facingDir = 'right'; }
    else if (up)    { vy = -PLAYER_SPEED; this._facingDir = 'up'; }
    else if (down)  { vy =  PLAYER_SPEED; this._facingDir = 'down'; }

    this.player.body.setVelocity(vx, vy);

    if (vx < 0) this.player.setFlipX(true);
    else if (vx > 0) this.player.setFlipX(false);

    // Player animation
    const moving = vx !== 0 || vy !== 0;
    if (moving) { if (this.anims.exists('TRAINER-walk')) this.player.play('TRAINER-walk', true); }
    else        { if (this.anims.exists('TRAINER-idle')) this.player.play('TRAINER-idle', true); }

    // Depth-sort player
    this.player.setDepth(10 + this.player.y * 0.001);

    // NPC AI
    for (const npc of this._npcs.getChildren()) this._tickNpc(npc, delta);

    window.__gameState = {
      phase: 'playing',
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
      chestsFound: this.chestsFound,
    };
  }

  _tickNpc(npc, dt) {
    if (!npc.active || !npc.body) return;
    const id    = npc.getData('id');
    const speed = NPC_SPEED;

    // Wander randomly
    let wt = npc.getData('wander') - dt;
    if (wt <= 0) {
      const dirs = [{x:0,y:0},{x:0,y:0},{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      npc.setData('dir', d);
      wt = Phaser.Math.Between(1000, 2500);
    }
    npc.setData('wander', wt);
    const dir = npc.getData('dir') ?? { x: 0, y: 0 };
    npc.body.setVelocity(dir.x * speed, dir.y * speed);
    if (dir.x < 0) npc.setFlipX(true);
    else if (dir.x > 0) npc.setFlipX(false);

    const moving = dir.x !== 0 || dir.y !== 0;
    if (moving) { if (this.anims.exists(`${id}-walk`)) npc.play(`${id}-walk`, true); }
    else        { if (this.anims.exists(`${id}-idle`)) npc.play(`${id}-idle`, true); }

    npc.setDepth(9 + npc.y * 0.001);
  }
}
