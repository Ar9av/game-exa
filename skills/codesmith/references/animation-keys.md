# Animation key conventions

The Preload scene reads `manifest.json` and creates one Phaser animation per `(entity, state)` pair. The codesmith-written Game.js consumes them by **name**, never by frame index.

## Naming

```
<ENTITY_ID>-<state-lowercase>
```

Examples:
- `KNIGHT-idle`, `KNIGHT-walk`, `KNIGHT-attack`, `KNIGHT-hurt`
- `SLIME-idle`, `SLIME-walk`, `SLIME-hurt` (no attack — slimes don't attack in the GDD)
- `BULLET-idle`

## Frame index math

For sheet `manifest.sprites[i]`:
- `rows[]`  is the entity ordering (top to bottom in the PNG)
- `cols[]`  is the state ordering (left to right)
- frame index of `(entityId, state)` = `rows.indexOf(entityId) * cols.length + cols.indexOf(state)`

The Preload scene does this once and registers each animation as a single-frame anim by default. If multi-frame anims are added later, the manifest will gain `framesPerCell` and the math becomes a range.

## Lookup helper

Always include this helper in Game.js:

```js
const findSheet = (entityId) => {
  for (const s of manifest.sprites) {
    const r = s.rows.indexOf(entityId);
    if (r >= 0) return { tex: s.textureKey, rowIdx: r, cols: s.cols.length };
  }
  return null;
};
```

Then when creating a sprite:

```js
const sheet = findSheet('KNIGHT');
if (!sheet) return;  // entity wasn't in any sheet — should be impossible if manifest is valid
const sprite = this.physics.add.sprite(x, y, sheet.tex, sheet.rowIdx * sheet.cols);
sprite.play('KNIGHT-idle');
```

The `frame` arg to `sprite()` is the initial frame; `play(animKey)` then drives the animation system.

## Switching animations on input

```js
if (b.velocity.x !== 0 || b.velocity.y !== 0) {
  if (!this.attacking) this.player.play('KNIGHT-walk', true);
} else if (!this.attacking) {
  this.player.play('KNIGHT-idle', true);
}
```

The `true` second arg is "ignore-if-already-playing" — without it, the animation restarts from frame 0 every tick and looks frozen.

## Verification

The codesmith MUST validate that every animation key it references exists in the manifest. The `validate_code.mjs` script greps `'KNIGHT-walk'` style references and intersects with manifest-derived keys; any unknown key fails validation.
