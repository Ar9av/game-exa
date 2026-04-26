import Phaser from 'phaser';

// ── Dialogue box ─────────────────────────────────────────────────────────────
class DialogBox {
  constructor(scene) {
    this.scene = scene;
    const W = scene.scale.width, H = scene.scale.height;
    const BH = 82, BY = H - BH - 4;

    this.bg = scene.add.graphics()
      .setScrollFactor(0).setDepth(200).setVisible(false);
    this._drawBg(W, BY, BH);

    this.nameLabel = scene.add.text(14, BY + 7, '', {
      fontSize: '8px', color: '#ffd84a', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(201).setVisible(false);

    this.bodyText = scene.add.text(14, BY + 22, '', {
      fontSize: '7px', color: '#eeeeee', fontFamily: 'monospace',
      wordWrap: { width: W - 28 }, lineSpacing: 2,
    }).setScrollFactor(0).setDepth(201).setVisible(false);

    this.cursor = scene.add.text(W - 12, H - 8, '▼', {
      fontSize: '6px', color: '#aaaaff', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(201).setOrigin(1, 1).setVisible(false);
    scene.tweens.add({ targets: this.cursor, alpha: 0, duration: 420, yoyo: true, repeat: -1 });

    this.active    = false;
    this.typing    = false;
    this.allLines  = [];
    this.lineIdx   = 0;
    this.curLine   = '';
    this.charIdx   = 0;
    this.typeEvent = null;
  }

  _drawBg(W, BY, BH) {
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.84);
    this.bg.fillRoundedRect(6, BY, W - 12, BH, 6);
    this.bg.lineStyle(1, 0x6666cc, 0.85);
    this.bg.strokeRoundedRect(6, BY, W - 12, BH, 6);
  }

  show(name, lines) {
    this.allLines = Array.isArray(lines) ? [...lines] : [lines];
    this.lineIdx  = 0;
    this.active   = true;
    this.bg.setVisible(true);
    this.nameLabel.setVisible(true).setText(name);
    this.bodyText.setVisible(true);
    this.cursor.setVisible(true);
    this._typeLine(this.allLines[0]);
  }

  _typeLine(line) {
    this.curLine  = line;
    this.charIdx  = 0;
    this.typing   = true;
    this.bodyText.setText('');
    if (this.typeEvent) { this.typeEvent.remove(); this.typeEvent = null; }
    this.typeEvent = this.scene.time.addEvent({
      delay: 26, loop: true,
      callback: () => {
        if (this.charIdx < this.curLine.length) {
          this.bodyText.setText(this.curLine.substring(0, ++this.charIdx));
        } else {
          this.typing = false;
          if (this.typeEvent) { this.typeEvent.remove(); this.typeEvent = null; }
        }
      },
    });
  }

  advance() {
    if (!this.active) return;
    if (this.typing) {
      if (this.typeEvent) { this.typeEvent.remove(); this.typeEvent = null; }
      this.typing = false;
      this.bodyText.setText(this.curLine);
      return;
    }
    this.lineIdx++;
    if (this.lineIdx >= this.allLines.length) { this.hide(); }
    else { this._typeLine(this.allLines[this.lineIdx]); }
  }

  hide() {
    this.active = false;
    this.typing = false;
    if (this.typeEvent) { this.typeEvent.remove(); this.typeEvent = null; }
    this.bg.setVisible(false);
    this.nameLabel.setVisible(false);
    this.bodyText.setVisible(false);
    this.cursor.setVisible(false);
  }
}

// ── Main Scene ───────────────────────────────────────────────────────────────
export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    this.levelIndex       = data?.levelIndex ?? 0;
    this.crystalsCollected = 0;
    this.gameOver         = false;
    this.won              = false;
    this.nearNpc          = null;
  }

  create() {
    const levels   = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level    = levels[this.levelIndex];
    const tileSize = manifest.tiles.tileSize;
    const worldW   = level.size[0] * tileSize;
    const worldH   = level.size[1] * tileSize;

    // ── tilemap ─────────────────────────────────────────────────────────────
    const map     = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer   = map.createLayer(0, tileset, 0, 0);
    layer.setCollision(manifest.tiles.passable.map((p, i) => p ? -1 : i).filter(i => i >= 0));
    layer.setDepth(0);

    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.physics.world.setBounds(0, 0, worldW, worldH);

    const findSheet = (id) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(id);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    const NPC_LINES = {
      ELDER: {
        name: 'Elder Mira',
        lines: [
          'Ah — a traveler has come at last!',
          'Our village is under an ancient curse...',
          'Five crystals were scattered to the winds.',
          'Gather them all and the curse will be lifted!',
          'Look to the north, south, east and west.',
        ],
      },
      VILLAGER: {
        name: 'Villager',
        lines: [
          'I spotted something glowing near the trees!',
          'The Elder knows more — she is by the plaza.',
        ],
      },
      GUARD: {
        name: 'Guard',
        lines: [
          'Halt! Oh... you look like a hero.',
          'The crystals are scattered all around us.',
          'Bring them all back — please hurry!',
        ],
      },
    };

    // ── entities ─────────────────────────────────────────────────────────────
    this.npcs    = [];
    this.crystals = this.physics.add.group({ allowGravity: false });

    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sh = findSheet(sp.entity);
      if (!sh) continue;

      if (sp.entity === 'HERO') {
        this.player = this.physics.add.sprite(px, py, sh.tex, sh.rowIdx * sh.cols);
        this.player.setCollideWorldBounds(true);
        this.player.setDisplaySize(tileSize * 1.1, tileSize * 1.1);
        this.player.body.setSize(tileSize * 0.55, tileSize * 0.55);
        this.player.body.setOffset(
          (this.player.width  - tileSize * 0.55) / 2,
          (this.player.height - tileSize * 0.55) / 2 + tileSize * 0.18
        );
        this.player.play('HERO-idle');

      } else if (NPC_LINES[sp.entity]) {
        const npc = this.add.sprite(px, py, sh.tex, sh.rowIdx * sh.cols);
        npc.entityId  = sp.entity;
        npc.dialogueData = NPC_LINES[sp.entity];
        npc.setDisplaySize(tileSize * 1.1, tileSize * 1.1);
        npc.play(sp.entity + '-idle');

        // "!" proximity indicator
        npc.indicator = this.add.text(px, py - tileSize * 0.85, '!', {
          fontSize: '11px', color: '#ffe000',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(500).setVisible(false);
        this.tweens.add({ targets: npc.indicator, y: '-=4', duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

        this.npcs.push(npc);

      } else if (sp.entity === 'CRYSTAL') {
        const c = this.crystals.create(px, py, sh.tex, sh.rowIdx * sh.cols);
        c.collected = false;
        c.setDisplaySize(tileSize * 0.9, tileSize * 0.9);
        c.body.setSize(tileSize * 0.7, tileSize * 0.7);
        c.body.setOffset(
          (c.width  - tileSize * 0.7) / 2,
          (c.height - tileSize * 0.7) / 2
        );
        c.play('CRYSTAL-idle');
        this.tweens.add({ targets: c, y: c.y - 5, duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        try { if (c.postFX) c.postFX.addGlow(0x44ddff, 5, 0, false, 0.1, 14); } catch (_) { /* postFX unsupported in this WebGL context */ }
      }
    }

    // ── physics ──────────────────────────────────────────────────────────────
    this.physics.add.collider(this.player, layer);

    this.physics.add.overlap(this.player, this.crystals, (_p, crystal) => {
      if (crystal.collected) return;
      crystal.collected = true;
      crystal.body.enable = false;
      this.tweens.killTweensOf(crystal);
      // Burst effect
      for (let i = 0; i < 8; i++) {
        const p = this.add.rectangle(crystal.x, crystal.y, 2, 2, 0x44ddff).setDepth(80);
        const a = (i / 8) * Math.PI * 2;
        this.tweens.add({ targets: p, x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, alpha: 0, duration: 320, onComplete: () => p.destroy() });
      }
      this.tweens.add({ targets: crystal, scale: crystal.scale * 1.8, alpha: 0, duration: 220, onComplete: () => crystal.destroy() });
      this.cameras.main.shake(60, 0.003);
      this.crystalsCollected++;
      this.updateState();
      if (this.crystalsCollected >= 5) this.time.delayedCall(350, () => this.win());
    });

    // ── camera ───────────────────────────────────────────────────────────────
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.roundPixels = true;

    // ── input ────────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys    = this.input.keyboard.addKeys('W,A,S,D');
    this.input.keyboard.on('keydown-Z',     () => this._onInteract());
    this.input.keyboard.on('keydown-SPACE', () => this._onInteract());

    // ── dialogue ─────────────────────────────────────────────────────────────
    this.dialogBox = new DialogBox(this);

    // ── HUD ──────────────────────────────────────────────────────────────────
    this.hud = this.add.text(6, 6, '', {
      fontSize: '8px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 3,
    }).setScrollFactor(0).setDepth(150);

    // Hint label
    this.hint = this.add.text(this.scale.width / 2, this.scale.height - 10, 'Z / SPACE — talk', {
      fontSize: '6px', color: '#888888', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(150).setOrigin(0.5, 1).setAlpha(0.6);

    this.updateState();
    this.events.emit('scene-ready');
  }

  _onInteract() {
    if (this.gameOver) return;
    if (this.dialogBox.active) { this.dialogBox.advance(); return; }
    if (this.nearNpc) {
      const d = this.nearNpc.dialogueData;
      this.dialogBox.show(d.name, d.lines);
    }
  }

  update(_t, _d) {
    if (!this.player || this.gameOver) return;

    // ── movement (locked during dialogue) ───────────────────────────────────
    const b     = this.player.body;
    const speed = 82;
    b.setVelocity(0);

    if (!this.dialogBox.active) {
      const left  = this.cursors.left.isDown  || this.keys.A.isDown;
      const right = this.cursors.right.isDown || this.keys.D.isDown;
      const up    = this.cursors.up.isDown    || this.keys.W.isDown;
      const down  = this.cursors.down.isDown  || this.keys.S.isDown;

      if (left)  { b.setVelocityX(-speed); this.player.setFlipX(true); }
      if (right) { b.setVelocityX( speed); this.player.setFlipX(false); }
      if (up)    b.setVelocityY(-speed);
      if (down)  b.setVelocityY( speed);

      if (b.velocity.x !== 0 || b.velocity.y !== 0) {
        b.velocity.normalize().scale(speed);
        this.player.play('HERO-walk', true);
      } else {
        this.player.play('HERO-idle', true);
      }
    }

    // ── y-sort depth ─────────────────────────────────────────────────────────
    this.player.setDepth(this.player.y + 2);
    for (const npc of this.npcs) npc.setDepth(npc.y + 2);
    for (const c of this.crystals.getChildren()) c.setDepth(c.y + 1);

    // ── NPC proximity ────────────────────────────────────────────────────────
    let nearest = null, nearDist = 54;
    for (const npc of this.npcs) {
      npc.indicator.setVisible(false);
      if (!this.dialogBox.active) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
        if (d < nearDist) { nearest = npc; nearDist = d; }
      }
    }
    if (nearest) nearest.indicator.setVisible(true);
    this.nearNpc = nearest;
    this.hint.setVisible(!this.dialogBox.active && nearest !== null);

    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase:             this.gameOver ? (this.won ? 'won' : 'lost') : 'playing',
      playerX:           this.player ? this.player.x : 0,
      playerY:           this.player ? this.player.y : 0,
      crystalsCollected: this.crystalsCollected,
    };
    if (this.hud) this.hud.setText(`Crystals ${this.crystalsCollected}/5`);
  }

  win() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.won      = true;
    this.updateState();
    this.events.emit('game-won');

    // Close any open dialogue
    if (this.dialogBox.active) this.dialogBox.hide();

    this.cameras.main.flash(320, 100, 190, 255);
    const { width: W, height: H } = this.scale;

    const panel = this.add.graphics().setScrollFactor(0).setDepth(300);
    panel.fillStyle(0x000000, 0.75);
    panel.fillRoundedRect(W * 0.1, H * 0.28, W * 0.8, H * 0.44, 10);
    panel.lineStyle(2, 0xffd700, 1);
    panel.strokeRoundedRect(W * 0.1, H * 0.28, W * 0.8, H * 0.44, 10);

    const title = this.add.text(W / 2, H * 0.40, 'VILLAGE SAVED!', {
      fontSize: '20px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(301).setScale(0);
    this.tweens.add({ targets: title, scale: 1, duration: 420, ease: 'Back.easeOut' });

    this.time.delayedCall(480, () => {
      this.add.text(W / 2, H * 0.54, 'The crystals glow once more...', {
        fontSize: '7px', color: '#aaddff', fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(301).setAlpha(0);
      this.tweens.add({ targets: this.add.text(W / 2, H * 0.54, 'The crystals glow once more...', {
        fontSize: '7px', color: '#aaddff', fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(301), alpha: 1, duration: 600 });
    });
  }
}
