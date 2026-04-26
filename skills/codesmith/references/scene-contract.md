# GameScene contract

The codesmith-written `src/scenes/Game.js` MUST match this shape. The playtester relies on every item in this contract; deviations cause `boot-timeout` or `no-movement` failures.

## Required class shape

```js
import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) {
    // Always read levelIndex even if you only have one level.
    this.levelIndex = data?.levelIndex ?? 0;
    // Initialize gameOver flag so update() can short-circuit.
    this.gameOver = false;
    // Initialize all fields referenced by gdd.winCondition / gdd.loseCondition here.
  }

  create() {
    const levels   = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level    = levels[this.levelIndex];
    const tileSize = manifest.tiles.tileSize;

    // 1. Tilemap — same boilerplate every game
    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    layer.setCollision(manifest.tiles.passable.map((p, i) => p ? -1 : i).filter(i => i >= 0));

    // 2. (Platformer only) per-world gravity
    // this.physics.world.gravity.set(0, 600);

    // 3. Camera + world bounds
    this.cameras.main.setBounds(0, 0, level.size[0] * tileSize, level.size[1] * tileSize);
    this.physics.world.setBounds(0, 0, level.size[0] * tileSize, level.size[1] * tileSize);

    // 4. Entity lookup helper
    const findSheet = (id) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(id);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };

    // 5. Spawn entities
    this.enemies = this.physics.add.group({ allowGravity: false });
    for (const sp of level.spawns) {
      const px = sp.x * tileSize + tileSize / 2;
      const py = sp.y * tileSize + tileSize / 2;
      const sheet = findSheet(sp.entity);
      if (!sheet) continue;
      // create sprite, setDisplaySize(tileSize, tileSize), play '<entity>-idle'
    }

    // 6. Colliders
    this.physics.add.collider(this.player, layer);
    // ... overlap callbacks for pickups, enemy contact

    // 7. Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    // 8. Camera follow + roundPixels
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.roundPixels = true;

    // 9. HUD
    this.hud = this.add.text(4, 4, '', { fontSize: '8px', color: '#ffffff', backgroundColor: '#000000' })
      .setScrollFactor(0).setDepth(100);

    // 10. Initial state push
    this.updateState();

    // 11. REQUIRED — emit ready signal
    this.events.emit('scene-ready');
  }

  update(time, delta) {
    if (!this.player || this.gameOver) return;
    // Movement, animation switching, AI, win/lose checks.
    this.updateState();
  }

  // REQUIRED — keep this method, populate it with all fields referenced by GDD conditions.
  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.won ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      // ... game-specific fields the GDD's winCondition/loseCondition string reads from
    };
    if (this.hud) this.hud.setText(/* ... */);
  }

  win() {
    this.gameOver = true; this.won = true;
    this.updateState();
    this.events.emit('game-won');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'YOU WIN',
      { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  lose() {
    this.gameOver = true;
    this.updateState();
    this.events.emit('game-lost');
    this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'GAME OVER',
      { fontSize: '24px', color: '#f44' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }
}
```

## Why each piece exists

- `key: 'Game'` — the harness queries `scene.scenes.find(s => s.sys.settings.key === 'Game')`.
- `init(data)` — `gameforge qa --start-from-level <n>` (future) passes `levelIndex` here.
- `'scene-ready'` event — the harness blocks on `window.__gameReady = true`, set when this fires.
- `window.__gameState` — the harness reads this for movement-delta assertions and win/lose checks.
- `roundPixels = true` — without it, scaled pixel sprites are bilinear-blurred.
- `startFollow` — keeps the player in the camera viewport for movement scenarios.
- `setScrollFactor(0)` on HUD — keeps it pinned to the camera, not the world.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Forgetting `scene-ready` | `boot-timeout` after 15s | Add `this.events.emit('scene-ready')` at end of `create()` |
| `key !== 'Game'` | harness can't find scene | Match exactly |
| Polling `isDown` for one-shot actions | `no-jump` despite Space pressed | Use `Phaser.Input.Keyboard.JustDown(key)` |
| Skipping `updateState()` calls | Movement scenarios pass but win/lose never trigger | Call it every `update()` tick AND on win/lose |
| Not setting display size | Sprite massive, body tiny | `setDisplaySize(tileSize, tileSize)` then `body.setSize(...)` |
| Body outside visible pixels | Player collides with air | Use `tileSize * 0.6-0.7` for body, with offset |
