---
name: codesmith
description: Writes the gameplay code for a Phaser 3 game (src/scenes/Game.js plus optional helpers). Reads the GDD, levels, and sprite/tile manifest; produces ES module code that consumes assets by name (never magic numbers). Use after sprite-artist and tile-artist have produced a complete manifest.
---

# Codesmith

Phaser 3 game programmer. Produces ONE required file (`src/scenes/Game.js`) and optional helpers under `src/entities/` or `src/lib/`.

## When to use

Final LLM stage of the generation pipeline, after design + level + asset stages have completed.

## Output contract

Output ONLY a JSON object:

```jsonc
{
  "files": [
    { "path": "src/scenes/Game.js", "content": "<full file contents>" },
    { "path": "src/entities/Enemy.js", "content": "..." }   // optional
  ]
}
```

`src/scenes/Game.js` is **required**. May also write under `src/entities/` or `src/lib/`. MUST NOT write outside `src/`.

## Runtime environment (already provided by template)

- `Phaser` global (3.85+) imported as `import Phaser from 'phaser'`.
- Pre-loaded textures via Boot/Preload:
  - `entities-N` (one per sprite sheet, N = 1, 2, ...)
  - `tiles`
- Pre-built animations: `<ENTITY_ID>-<state>` (lowercase state). E.g. `KNIGHT-walk`, `SLIME-hurt`.
- `this.registry.get('levels')` → levels array
- `this.registry.get('manifest')` → full manifest
- `init({ levelIndex })` data on scene start

## GameScene contract (REQUIRED)

```js
import Phaser from 'phaser';

export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  init(data) { this.levelIndex = data?.levelIndex ?? 0; }

  create() {
    const levels   = this.registry.get('levels');
    const manifest = this.registry.get('manifest');
    const level    = levels[this.levelIndex];
    const tileSize = manifest.tiles.tileSize;

    // 1. Build tilemap
    const map = this.make.tilemap({ data: level.tiles, tileWidth: tileSize, tileHeight: tileSize });
    const tileset = map.addTilesetImage('tiles', 'tiles', tileSize, tileSize, 0, 0);
    const layer = map.createLayer(0, tileset, 0, 0);
    layer.setCollision(manifest.tiles.passable.map((p, i) => p ? -1 : i).filter(i => i >= 0));

    // 2. (For platformer only) set per-world gravity
    // this.physics.world.gravity.set(0, 600);

    // 3. Spawn entities — look up sheet by name
    const findSheet = (id) => {
      for (const s of manifest.sprites) {
        const r = s.rows.indexOf(id);
        if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
      }
      return null;
    };
    // ... loop level.spawns, create sprites with frame = sheet.rowIdx * sheet.cols
    //     play '<ENTITY_ID>-idle' on each

    // 4. Wire physics colliders / overlaps
    // 5. Wire input: cursors + WASD + SPACE
    // 6. Update window.__gameState every frame
    // 7. At end of create():
    this.events.emit('scene-ready');
  }

  update(time, delta) {
    // movement, animation switching, AI, win/lose checks
    this.updateState();
  }

  updateState() {
    window.__gameState = {
      phase: this.gameOver ? (this.won ? 'won' : 'lost') : 'playing',
      playerX: this.player ? this.player.x : 0,
      playerY: this.player ? this.player.y : 0,
      // ... game-specific fields referenced by gdd.winCondition / loseCondition
    };
  }
}
```

## NES-quality visual patterns (use these — not plain text HUD)

Generated games must use real visual effects, not just text labels. These patterns are copy-pasteable and tested across all 4 example games.

### HUD — NES-style segmented HP bar + portrait box

```js
_buildHud() {
  const W = this.scale.width;
  // Portrait box (top-left)
  this.add.rectangle(4, 4, 36, 36, 0x000000).setOrigin(0).setScrollFactor(0).setDepth(300);
  this.add.rectangle(5, 5, 34, 34, 0x111111).setOrigin(0).setScrollFactor(0).setDepth(301);
  const portrait = this.add.sprite(22, 22, texMap.PLAYER_ENTITY).setScrollFactor(0).setDepth(302);
  portrait.setDisplaySize(28, 28);
  // Segmented HP bar (10 segments)
  this._hpSegments = [];
  for (let i = 0; i < MAX_HP; i++) {
    const seg = this.add.rectangle(46 + i * 12, 8, 10, 8, 0xdd2222).setOrigin(0).setScrollFactor(0).setDepth(300);
    this._hpSegments.push(seg);
  }
  // Lives counter
  this._livesTxt = this.add.text(4, 44, '×3', { fontSize: '11px', fill: '#fff', stroke: '#000', strokeThickness: 2 }).setScrollFactor(0).setDepth(300);
  // Score (top-right, yellow)
  this._scoreTxt = this.add.text(W - 8, 4, 'SCORE\n000000', { fontSize: '11px', fill: '#ffdd00', align: 'right' }).setOrigin(1, 0).setScrollFactor(0).setDepth(300);
}

_refreshHud() {
  this._hpSegments.forEach((seg, i) => seg.setVisible(i < this.playerHp));
  this._scoreTxt.setText('SCORE\n' + String(this.score).padStart(6, '0'));
}
```

### Hit particles

```js
_emitHitParticles(x, y, color = 0xffffff) {
  for (let i = 0; i < 5; i++) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, 4, 4);
    g.setPosition(x, y).setDepth(50);
    const angle = (Math.PI * 2 * i) / 5;
    this.tweens.add({
      targets: g, x: x + Math.cos(angle) * 28, y: y + Math.sin(angle) * 28,
      alpha: 0, duration: 240, onComplete: () => g.destroy(),
    });
  }
}
```

### Pickup sparkle

```js
_pickupSparkle(x, y) {
  const c = this.add.circle(x, y, 1, 0xffffff, 0.9).setDepth(60);
  this.tweens.add({ targets: c, scaleX: 18, scaleY: 18, alpha: 0, duration: 220, onComplete: () => c.destroy() });
}
```

### Enemy death animation

```js
_killEnemy(e) {
  let flashes = 0;
  const flash = () => {
    if (flashes++ >= 3 || !e.active) return;
    e.setTint(0xffffff);
    this.time.delayedCall(60, () => { if (e.active) { e.clearTint(); this.time.delayedCall(60, flash); } });
  };
  flash();
  if (e.body) e.body.setAllowGravity(true);
  this.tweens.add({ targets: e, alpha: 0, y: e.y + 30, duration: 380, onComplete: () => e.destroy() });
}
```

### Screen flash (on player hurt or big event)

```js
_screenFlash() {
  const { width: W, height: H } = this.scale;
  const fl = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0.4).setScrollFactor(0).setDepth(500);
  this.tweens.add({ targets: fl, alpha: 0, duration: 180, onComplete: () => fl.destroy() });
}
```

### 3-layer parallax background (action-platformer / platformer)

```js
// In create(), after checking manifest.bg:
if (manifest.bg) {
  this.add.image(0, 0, 'bg').setOrigin(0).setScrollFactor(0.05).setDepth(-300).setDisplaySize(worldW, worldH);
  this.add.image(0, 0, 'bg').setOrigin(0).setScrollFactor(0.15).setDepth(-200).setDisplaySize(worldW, worldH).setAlpha(0.6);
  this.add.image(0, 0, 'bg').setOrigin(0).setScrollFactor(0.35).setDepth(-100).setDisplaySize(worldW, worldH).setAlpha(0.35);
}
```

### Beat-em-up combo counter

```js
// In _hitEnemy():
this._comboCount = (this._comboCount ?? 0) + 1;
clearTimeout(this._comboTimer);
this._comboTimer = setTimeout(() => { this._comboCount = 0; }, 1500);
if (this._comboCount >= 2) {
  const txt = this.add.text(e.x, e.y - 20, `×${this._comboCount}`, {
    fontSize: '14px', fill: '#ffdd00', stroke: '#000', strokeThickness: 3,
  }).setDepth(80);
  this.tweens.add({ targets: txt, y: txt.y - 28, alpha: 0, duration: 600, onComplete: () => txt.destroy() });
}
```

### Coyote-time jump (action-platformer)

```js
const COYOTE_MS = 80;
// In update():
if (this.player.body.blocked.down) { this._coyote = COYOTE_MS; this._isJumping = false; }
else { this._coyote = Math.max(0, this._coyote - delta); }

if (Phaser.Input.Keyboard.JustDown(jumpKey) && this._coyote > 0 && !this._isJumping) {
  this.player.body.setVelocityY(JUMP_VY);  // e.g. -380
  this._coyote = 0;
  this._isJumping = true;
}
// Variable jump height (release early = shorter jump):
if (!jumpKey.isDown && this.player.body.velocity.y < -80) {
  this.player.body.setVelocityY(this.player.body.velocity.y * 0.88);
}
```

### Platform-edge-aware enemy patrol

```js
_patrolEnemy(e, delta) {
  const ts = manifest.tiles.tileSize;
  const dir = e.getData('dir') ?? 1;
  const nextX = e.x + dir * (ts * 0.6);
  const tileAhead = this._tileLayer.getTileAtWorldXY(nextX, e.y);
  const tileBelow = this._tileLayer.getTileAtWorldXY(nextX, e.y + ts * 0.6);
  if (!tileBelow || tileAhead) e.setData('dir', -dir);  // flip at edge or wall
  e.body.setVelocityX(e.getData('dir') * e.getData('speed'));
  e.setFlipX(e.getData('dir') < 0);
}
```

## Known-pitfalls injection (from debug library)

Before writing Game.js, read the top entries from the persistent debug library and treat them as hard constraints:

```bash
node scripts/debug_library.mjs --list
```

Each entry is a symptom → fix pair accumulated across past refiner runs. If the library is non-empty, prepend its entries to your mental model as "DO NOT DO X because it causes Y." This prevents codesmith from shipping bugs the refiner already solved.

## Hard rules

1. **ES module syntax** — `import Phaser from 'phaser'`, `export default class`. No CJS, no TypeScript.
2. **Animation keys**: ALWAYS `<ENTITY_ID>-<state-lowercased>`. NEVER reference an animation key not present in the manifest.
3. **Sprite frames**: ALWAYS `frame = rowIdx * cols + colIdx`. Look up via `manifest.sprites[i]`.
4. **Movement**:
   - Held inputs → `key.isDown`.
   - One-shot actions (jump, attack, fire) → `Phaser.Input.Keyboard.JustDown(key)`. THIS IS NON-NEGOTIABLE — single keypresses can be sub-frame and `isDown` polling will miss them.
5. **Top-down physics**: `gravity 0`, normalize diagonal velocity (`b.velocity.normalize().scale(speed)`).
6. **Platformer physics**: `this.physics.world.gravity.set(0, 600)` in `create()`. Jump on `JustDown(SPACE) && body.blocked.down`. Pickup/enemy groups: `this.physics.add.group({ allowGravity: false })`.
7. **Body sizing**: `setDisplaySize(tileSize, tileSize)` then `body.setSize(tileSize * 0.6-0.7, tileSize * 0.6-0.85)` so hitbox matches visible pixels.
8. **Camera**: `cameras.main.startFollow(player, true, 0.1, 0.1)` for scrolling games; `roundPixels = true`.
9. **Determinism**: don't use `Math.random()` or `Date.now()` directly — use `Phaser.Math.RND` (seeded via game config).
10. **Comments**: minimal. Identifiers carry meaning. No file-header docblocks, no decorative comments.
11. **`window.__gameState`**: MUST update every frame with at least `phase`, `playerX`, `playerY` plus any field referenced by `winCondition` / `loseCondition`. The playtester reads this.
12. **`this.events.emit('scene-ready')`**: MUST fire at end of `create()`. The harness blocks on this.
13. **Win/lose**: when reached, set `this.gameOver = true`, emit `'game-won'` or `'game-lost'`, render an overlay text. Stop processing input/physics in `update()` after gameOver.

## Process

1. Read GDD + levels + manifest from `game-state.json`.
2. Build the file using the contract above.
3. Validate with `scripts/validate_code.mjs` (basic AST + animation-key reference check).
4. Run `scripts/write_files.mjs <project-dir>` — refuses paths outside `src/`.

## References

- `references/phaser-recipes.md` — copy-pasteable patterns: tilemap setup, 4-direction top-down, platformer jump arc, projectile pooling, simple enemy AI.
- `references/scene-contract.md` — the full GameScene contract (verbose with annotations).
- `references/animation-keys.md` — how the manifest → Phaser animation mapping works.
- `references/common-pitfalls.md` — top 10 things that bite first-time Phaser devs (texture filtering, body offset, scale mode, depth sorting, input focus, etc.).

## Scripts

- `scripts/validate_code.mjs <file-path> <manifest-path>` — checks: parses as JS, referenced animation keys exist in manifest, no use of `Math.random()`, GameScene exports default class with `key: 'Game'`.
- `scripts/write_files.mjs <project-dir> <files-json>` — safety-checked file writer. Rejects paths outside `src/`.
