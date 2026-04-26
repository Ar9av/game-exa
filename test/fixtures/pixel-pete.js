// Hand-crafted "agent outputs" for Pixel Pete (platformer).
// Exercises gravity, jumping, and platform collision.

export const GDD = {
  title: 'Pixel Pete',
  genre: 'platformer',
  tagline: 'A jumpy hero collecting coins through floating platforms.',
  loop: 'Run right, jump over gaps, dodge bats, collect 5 coins to win.',
  winCondition: 'window.__gameState.coinsCollected >= 5',
  loseCondition: 'window.__gameState.playerHp <= 0 || window.__gameState.playerY > 400',
  controls: {
    movement: 'platformer',
    actions: [
      { key: 'SPACE', name: 'jump', description: 'Jump' },
    ],
  },
  entities: [
    { id: 'PETE', kind: 'player', color: 'red',    desc: 'Red-hatted pixel runner', states: ['idle', 'walk', 'jump', 'hurt'], speed: 120, hp: 3 },
    { id: 'BAT',  kind: 'enemy',  color: 'purple', desc: 'A flying purple bat',    states: ['idle', 'walk', 'hurt'],         speed: 50,  hp: 1 },
    { id: 'COIN', kind: 'pickup', color: 'gold',   desc: 'A spinning gold coin',   states: ['idle'],                          speed: 0,   hp: 0 },
  ],
  tilesetPalette: [
    { id: 'SKY',       color: '#7090d0', passable: true  },
    { id: 'GRASS_TOP', color: '#3a8a3a', passable: false },
    { id: 'DIRT',      color: '#7a5a30', passable: false },
    { id: 'STONE',     color: '#606060', passable: false },
  ],
  levelHints: { size: [22, 12], count: 1, themes: ['outdoor'] },
};

const _ = 0; // sky
const G = 1; // grass top
const D = 2; // dirt
const S = 3; // stone

export const LEVELS = [
  {
    id: '1-1',
    theme: 'outdoor',
    size: [22, 12],
    tiles: [
      [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,G,G,G,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,D,D,D,_,_,_,_,_,G,G,_,_,_,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_,_,D,D,_,_,_,_,_,_],
      [_,_,_,G,G,G,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
      [_,_,_,D,D,D,_,_,_,_,G,G,G,_,_,_,_,_,_,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,D,D,D,_,_,_,_,_,_,_,_,_],
      [G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G,G],
      [D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D,D],
    ],
    spawns: [
      { entity: 'PETE', x: 1,  y: 9 },
      { entity: 'BAT',  x: 9,  y: 4 },
      { entity: 'BAT',  x: 17, y: 7 },
      { entity: 'COIN', x: 7,  y: 3 },
      { entity: 'COIN', x: 14, y: 4 },
      { entity: 'COIN', x: 4,  y: 6 },
      { entity: 'COIN', x: 11, y: 7 },
      { entity: 'COIN', x: 19, y: 9 },
    ],
    goal: { kind: 'tile' },
  },
];

export const GAME_JS = `import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this.coinsCollected = 0;
    this.playerHp = 3;
    this.gameOver = false;
  }

  create() {
    const levels = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level = levels[this.levelIndex];
    const palette = manifest.tiles;
    const tileSize = palette.tileSize;
    const sf = tileSize / 16;
    this.tileSize = tileSize;
    this.sf = sf;

    this.physics.world.gravity.set(0, 600 * sf);

    const worldW = level.size[0] * tileSize;
    const worldH = level.size[1] * tileSize;

    if (this.textures.exists('bg')) {
      const bg = this.add.image(worldW / 2, worldH / 2, 'bg').setDepth(-100);
      bg.setDisplaySize(worldW, worldH);
      const sFactor = manifest.bg?.scrollFactor ?? 0.3;
      bg.setScrollFactor(sFactor);
    }

    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    const impassableIndices = palette.passable.map((p, i) => p ? -1 : i).filter((i) => i >= 0);
    layer.setCollision(impassableIndices);

    this.cameras.main.setBounds(0, 0, level.size[0] * tileSize, level.size[1] * tileSize);
    this.physics.world.setBounds(0, 0, level.size[0] * tileSize, level.size[1] * tileSize + 200);

    const findSheet = (entityId) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(entityId);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    this.enemies = this.physics.add.group({ allowGravity: false });
    this.coins = this.physics.add.group({ allowGravity: false });

    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sheet = findSheet(sp.entity);
      if (!sheet) continue;
      if (sp.entity === 'PETE') {
        this.player = this.physics.add.sprite(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        this.player.setCollideWorldBounds(false);
        this.player.setDisplaySize(tileSize, tileSize);
        this.player.body.setSize(tileSize * 0.6, tileSize * 0.85);
        this.player.body.setOffset(this.player.width * 0.2, this.player.height * 0.1);
        this.player.play('PETE-idle');
      } else if (sp.entity === 'BAT') {
        const e = this.enemies.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        e.entityId = 'BAT';
        e.hp = 1;
        e.dirX = -1;
        e.speed = 50;
        e.setCollideWorldBounds(true);
        e.setBounce(1, 0);
        e.setDisplaySize(tileSize, tileSize);
        e.body.setSize(tileSize * 0.7, tileSize * 0.7);
        e.play('BAT-idle');
      } else if (sp.entity === 'COIN') {
        const c = this.coins.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        c.entityId = 'COIN';
        c.body.setAllowGravity(false);
        c.setDisplaySize(tileSize * 0.7, tileSize * 0.7);
        c.body.setSize(tileSize * 0.6, tileSize * 0.6);
        c.play('COIN-idle');
      }
    }

    this.physics.add.collider(this.player, layer);
    this.physics.add.overlap(this.player, this.coins, (_p, coin) => {
      coin.destroy();
      this.coinsCollected++;
      this.updateState();
      if (this.coinsCollected >= 5) this.win();
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, _e) => {
      if (this.iframes) return;
      this.iframes = true;
      this.playerHp--;
      this.player.play('PETE-hurt', true);
      this.player.setVelocityY(-220);
      this.cameras.main.shake(120, 0.005);
      this.time.delayedCall(600, () => {
        this.iframes = false;
        if (this.playerHp > 0) this.player.play('PETE-idle', true);
      });
      this.updateState();
      if (this.playerHp <= 0) this.lose();
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.roundPixels = true;

    this.hud = this.add.text(4, 4, '', { fontSize: '8px', color: '#ffffff', backgroundColor: '#000000' }).setScrollFactor(0).setDepth(100);
    this.updateState();

    this.events.emit('scene-ready');
  }

  update() {
    if (!this.player || this.gameOver) return;
    const speed = 120;
    const b = this.player.body;
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.W) ||
      Phaser.Input.Keyboard.JustDown(this.keys.SPACE);

    if (left) b.setVelocityX(-speed);
    else if (right) b.setVelocityX(speed);
    else b.setVelocityX(0);

    if (jumpPressed && b.blocked.down) b.setVelocityY(-330);

    if (!this.iframes) {
      if (!b.blocked.down) this.player.play('PETE-jump', true);
      else if (b.velocity.x !== 0) this.player.play('PETE-walk', true);
      else this.player.play('PETE-idle', true);
    }

    for (const enemy of this.enemies.getChildren()) {
      enemy.body.setVelocityX(enemy.dirX * enemy.speed);
      if (enemy.body.blocked.left) enemy.dirX = 1;
      if (enemy.body.blocked.right) enemy.dirX = -1;
    }

    if (this.player.y > 400) this.lose();

    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.coinsCollected >= 5 ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      playerHp: this.playerHp,
      coinsCollected: this.coinsCollected,
      enemiesAlive: this.enemies ? this.enemies.countActive() : 0,
    };
    if (this.hud) this.hud.setText(\`HP \${this.playerHp}  COINS \${this.coinsCollected}/5\`);
  }

  win() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-won');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'YOU WIN', { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-lost');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'GAME OVER', { fontSize: '24px', color: '#f44' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }
}
`;
