---
name: manifest-auditor
description: Static analysis of Game.js that cross-references every animation key and texture key against manifest.json. Catches "Animation not found" and "Texture not found" bugs before the browser is opened. Run after codesmith, before playtester.
---

# Manifest Auditor — Key Consistency Check

Scans the codesmith-generated `Game.js` for every string literal used as an animation key or texture key, then checks each against the manifest. Catches the most common class of silent Phaser failures — mismatched key names — in milliseconds without a browser.

## When to use

After codesmith writes `src/scenes/Game.js`, before starting the dev server. Also run after refiner patches to catch regressions.

## What it checks

### Animation keys
Patterns: `.play('KEY')`, `.play("KEY")`, `.chain('KEY')`, `.chain("KEY")`

Valid animation keys are derived from `manifest.sprites`:
```
for each sheet s:
  for each row r in s.rows:
    for each col c in s.cols:
      valid key = `${r}-${c.toLowerCase()}`
```
Example: `KNIGHT-walk`, `SLIME-idle`, `ORB-idle`.

### Texture keys
Patterns: `this.add.sprite(x, y, 'KEY')`, `this.add.image(x, y, 'KEY')`, `this.physics.add.sprite(x, y, 'KEY')`, `this.textures.get('KEY')`, `this.load.image('KEY', ...)`, `this.load.spritesheet('KEY', ...)`

Valid texture keys:
- Each `s.textureKey` from `manifest.sprites` (e.g. `entities-1`)
- `'tiles'` — always present
- `'bg'` — present when `manifest.bg` exists

### Frame indices
Pattern: `setFrame(N)` or `.frame = N` — warns if N is out of range for the sprite sheet cell count (`rows.length * cols.length`).

## Output contract

```jsonc
{
  "ok": true,
  "errors": 0,
  "warnings": 2,
  "total": 2,
  "issues": [
    {
      "kind": "unknown-anim-key",
      "key": "KNIGHT-run",
      "line": 87,
      "suggestion": "Did you mean KNIGHT-walk?",
      "severity": "error"
    },
    {
      "kind": "unknown-texture-key",
      "key": "Player",
      "line": 34,
      "suggestion": "Texture keys are case-sensitive. Manifest has: entities-1",
      "severity": "error"
    }
  ]
}
```

Exit code `0` = all OK, `5` = errors found, `3` = missing files.

## Process

1. Run `scripts/audit_manifest.mjs <project-dir>` after codesmith writes Game.js.
2. If errors: surface to refiner as `manifest-key-mismatch` failures. Refiner fixes key strings.
3. Re-run. If clean, proceed to playtester.

Feed errors into refiner as:
```jsonc
{ "kind": "manifest-key-mismatch", "message": "KNIGHT-run not in manifest (line 87). Use KNIGHT-walk." }
```

## Scripts

- `scripts/audit_manifest.mjs <project-dir> [--fix]` — static analysis. `--fix` applies best-guess corrections in-place.
