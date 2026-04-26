// Hand-crafted "agent outputs" for Slime Slayer (top-down adventure).
// Used to drive the deterministic half of the pipeline without an LLM key.

export const GDD = {
  title: 'Slime Slayer',
  genre: 'top-down-adventure',
  tagline: 'A pixel knight collects gems while dodging slimes.',
  loop: 'Walk, swing sword to defeat slimes, collect gems, reach gem count to win.',
  winCondition: 'window.__gameState.gemsCollected >= 3',
  loseCondition: 'window.__gameState.playerHp <= 0',
  controls: {
    movement: '4-direction',
    actions: [
      { key: 'SPACE', name: 'attack', description: 'Swing sword' },
    ],
  },
  entities: [
    { id: 'KNIGHT', kind: 'player', color: 'blue',  desc: 'A small blue knight with a silver sword', states: ['idle', 'walk', 'attack', 'hurt'], speed: 80, hp: 3 },
    { id: 'SLIME',  kind: 'enemy',  color: 'green', desc: 'A round green slime with a wobble',       states: ['idle', 'walk', 'hurt'],            speed: 30, hp: 1 },
    { id: 'GEM',    kind: 'pickup', color: 'yellow',desc: 'A bright yellow gem with sparkles',       states: ['idle'],                            speed: 0,  hp: 0 },
  ],
  tilesetPalette: [
    { id: 'GRASS', color: '#3a8a3a', passable: true  },
    { id: 'DIRT',  color: '#7a5a30', passable: true  },
    { id: 'STONE', color: '#606060', passable: false },
    { id: 'TREE',  color: '#1a5a1a', passable: false },
  ],
  levelHints: { size: [16, 12], count: 1, themes: ['forest'] },
};

const _ = 0; // grass
const D = 1; // dirt
const W = 2; // stone wall
const T = 3; // tree

export const LEVELS = [
  {
    id: '1-1',
    theme: 'forest',
    size: [16, 12],
    tiles: [
      [W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W],
      [W,_,_,_,_,_,T,_,_,_,_,_,_,_,_,W],
      [W,_,D,D,_,_,_,_,_,T,_,_,D,D,_,W],
      [W,_,D,_,_,_,T,_,_,_,_,_,D,_,_,W],
      [W,_,_,_,_,_,_,_,_,_,_,_,_,_,_,W],
      [W,_,_,T,_,_,_,_,_,_,_,T,_,_,_,W],
      [W,_,_,_,_,_,_,_,_,_,_,_,_,_,_,W],
      [W,_,D,_,_,T,_,_,_,_,_,_,_,D,_,W],
      [W,_,D,_,_,_,_,_,_,T,_,_,_,D,_,W],
      [W,_,_,_,_,_,_,_,_,_,_,_,_,_,_,W],
      [W,_,_,_,_,T,_,_,_,_,_,_,_,_,_,W],
      [W,W,W,W,W,W,W,W,W,W,W,W,W,W,W,W],
    ],
    spawns: [
      { entity: 'KNIGHT', x: 2, y: 2 },
      { entity: 'SLIME',  x: 8, y: 4 },
      { entity: 'SLIME',  x: 4, y: 7 },
      { entity: 'SLIME',  x: 12, y: 9 },
      { entity: 'GEM',    x: 13, y: 2 },
      { entity: 'GEM',    x: 7,  y: 6 },
      { entity: 'GEM',    x: 2,  y: 10 },
    ],
    goal: { kind: 'tile' }, // win = collect 3 gems (computed by Game.js)
  },
];

// Hand-written Game.js mirroring what codesmith should produce.
export const GAME_JS = `import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
    this.tilePx = 16;
    this.gemsCollected = 0;
    this.playerHp = 3;
    this.gameOver = false;
  }

  create() {
    const levels = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level = levels[this.levelIndex];
    const palette = manifest.tiles;
    const tileSize = palette.tileSize;

    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    const impassableIndices = palette.passable
      .map((p, i) => p ? -1 : i)
      .filter((i) => i >= 0);
    layer.setCollision(impassableIndices);
    this.cameras.main.setBounds(0, 0, level.size[0] * tileSize, level.size[1] * tileSize);

    const findSheet = (entityId) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(entityId);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    this.enemies = this.physics.add.group();
    this.gems = this.physics.add.group();

    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sheet = findSheet(sp.entity);
      if (!sheet) continue;
      if (sp.entity === 'KNIGHT') {
        this.player = this.physics.add.sprite(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        this.player.setCollideWorldBounds(true);
        this.player.body.setSize(this.player.width * 0.6, this.player.height * 0.6);
        this.player.body.setOffset(this.player.width * 0.2, this.player.height * 0.3);
        this.player.play(sp.entity + '-idle');
        this.player.setDisplaySize(tileSize, tileSize);
        this.player.body.setSize(tileSize * 0.7, tileSize * 0.7);
        this.player.body.setOffset(this.player.width * 0.15, this.player.height * 0.15);
      } else if (sp.entity === 'SLIME') {
        const e = this.enemies.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        e.entityId = 'SLIME';
        e.hp = 1;
        e.dirX = Phaser.Math.Between(0, 1) ? 1 : -1;
        e.dirY = Phaser.Math.Between(0, 1) ? 1 : -1;
        e.speed = 30;
        e.setCollideWorldBounds(true);
        e.setBounce(1);
        e.body.setSize(this.textures.get(sheet.tex).getSourceImage().height / 9 * 0.8, this.textures.get(sheet.tex).getSourceImage().height / 9 * 0.8);
        e.play(sp.entity + '-idle');
        e.setDisplaySize(tileSize, tileSize);
      } else if (sp.entity === 'GEM') {
        const g = this.gems.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
        g.entityId = 'GEM';
        g.play(sp.entity + '-idle');
        g.setDisplaySize(tileSize * 0.7, tileSize * 0.7);
        g.body.setSize(tileSize * 0.6, tileSize * 0.6);
      }
    }

    this.physics.add.collider(this.player, layer);
    this.physics.add.collider(this.enemies, layer);
    this.physics.add.overlap(this.player, this.gems, (_p, gem) => {
      gem.destroy();
      this.gemsCollected++;
      this.updateState();
      if (this.gemsCollected >= 3) this.win();
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => {
      if (this.iframes) return;
      this.iframes = true;
      this.playerHp--;
      this.player.play('KNIGHT-hurt', true);
      this.cameras.main.shake(120, 0.005);
      this.time.delayedCall(500, () => {
        this.iframes = false;
        if (this.playerHp > 0) this.player.play('KNIGHT-idle', true);
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

  update(_time, _delta) {
    if (!this.player || this.gameOver) return;
    const speed = 80;
    const b = this.player.body;
    b.setVelocity(0);
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;
    if (left) b.setVelocityX(-speed);
    if (right) b.setVelocityX(speed);
    if (up) b.setVelocityY(-speed);
    if (down) b.setVelocityY(speed);
    if (b.velocity.x !== 0 || b.velocity.y !== 0) {
      b.velocity.normalize().scale(speed);
      if (!this.attacking) this.player.play('KNIGHT-walk', true);
    } else if (!this.attacking) {
      this.player.play('KNIGHT-idle', true);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.attack();

    for (const enemy of this.enemies.getChildren()) {
      enemy.body.setVelocity(enemy.dirX * enemy.speed, enemy.dirY * enemy.speed);
      if (enemy.body.blocked.left || enemy.body.blocked.right) enemy.dirX *= -1;
      if (enemy.body.blocked.up || enemy.body.blocked.down) enemy.dirY *= -1;
    }

    this.updateState();
  }

  attack() {
    if (this.attacking) return;
    this.attacking = true;
    this.player.play('KNIGHT-attack', true);
    const r = 18;
    for (const enemy of this.enemies.getChildren()) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < r) {
        enemy.destroy();
      }
    }
    this.time.delayedCall(220, () => {
      this.attacking = false;
      this.player.play('KNIGHT-idle', true);
    });
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.gemsCollected >= 3 ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      playerHp: this.playerHp,
      gemsCollected: this.gemsCollected,
      enemiesAlive: this.enemies ? this.enemies.countActive() : 0,
    };
    if (this.hud) this.hud.setText(\`HP \${this.playerHp}  GEMS \${this.gemsCollected}/3\`);
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
