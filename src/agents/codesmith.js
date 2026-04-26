import { jsonCall } from '../lib/anthropic.js';

const SYSTEM = `You are a Phaser 3 (3.85+) game programmer for an automated 8-bit
game generator. You receive a game design doc, a sprite manifest with row/column
labels, level data, and a tileset description. You produce ONE JavaScript file
containing the gameplay logic — the GameScene class.

Output ONLY a JSON object:
{
  "files": [
    { "path": "src/scenes/Game.js", "content": "<file contents>" }
  ]
}

You MAY emit additional helper files under src/entities/*.js or src/lib/*.js,
but src/scenes/Game.js is REQUIRED and must export a default class extending
Phaser.Scene with key "Game".

The runtime environment provides:
- Phaser global (3.85+)
- Pre-loaded textures: 'entities-N' for each sprite sheet (N = 1, 2, ...) plus 'tiles'
- Pre-built animations named "<ENTITY_ID>-<state>" (lowercase state), e.g. "PLAYER-walk"
- A loaded levels array on this.registry: this.registry.get('levels')
- A sprite manifest on this.registry: this.registry.get('manifest') — full manifest
- The starting level index in init data: init({ levelIndex }) — defaults to 0
- A "ready" hook: call this.events.emit('scene-ready') when create() completes

Game scene contract:
1. constructor() { super({ key: 'Game' }); }
2. init(data) { this.levelIndex = data?.levelIndex ?? 0; }
3. create():
   a. Read this.registry.get('levels')[this.levelIndex] and this.registry.get('manifest').
   b. Build the tilemap from level.tiles using this.make.tilemap({ data, tileWidth, tileHeight }).
      Add tileset image 'tiles' (key matches preload). Set collision on impassable tile indices.
   c. Spawn entities from level.spawns. Look up sprite indexes via the manifest:
      - For each spawn, find the sprite group whose rows[] includes spawn.entity.
      - Texture key is sprite.textureKey (provided in manifest).
      - Initial animation: '<entity>-idle'. Play it.
   d. Wire physics:
      - Top-down: arcade physics, gravity 0, normalize diagonal speed.
      - Platformer: set this.physics.world.gravity.set(0, 600) inside create();
        jump on Phaser.Input.Keyboard.JustDown(spaceKey) (or up/W) when body.blocked.down.
      Add collider between player and tilemap collision layer.
      Enemy and pickup groups should pass { allowGravity: false }.
   e. Wire input: cursors + WASD + SPACE.
      For one-shot actions (attack, jump, fire) ALWAYS use Phaser.Input.Keyboard.JustDown(key);
      for held movement use key.isDown.
   f. Implement movement, animation switching ('walk' when moving, 'idle' when stopped).
   g. Implement enemy behavior (simple): wander or chase player at entity.speed.
   h. Implement combat if attack action exists: SPACE triggers attack anim, damage overlapping enemies.
   i. Track win condition: emit this.events.emit('game-won') when met.
   j. Track lose condition: emit this.events.emit('game-lost') when met.
   k. Expose state for QA: window.__gameState = { phase: 'playing'|'won'|'lost', playerX, playerY, enemiesAlive }.
      Update on relevant changes.
   l. At end of create(): this.events.emit('scene-ready');

Hard rules:
- Use ES module syntax (import / export default).
- Phaser is the global window.Phaser; you may write \`const Phaser = window.Phaser;\` at top, OR import via \`import Phaser from 'phaser'\` (Vite resolves it). Pick imports.
- Pixel-art: this.cameras.main.roundPixels = true (already on by config but reaffirm).
- Set physics body to match sprite cell size; offset to match the trimmed pixel area conservatively (use cell - 4 with offset 2).
- Never reference an animation key you didn't verify exists in the manifest.
- All animation keys are <ENTITY_ID>-<state> with state lowercased.
- Tile size is provided in manifest.tiles.tileSize.
- Don't use TypeScript, decorators, or non-standard syntax. Plain modern JS.
- Don't import audio, plugins, or external assets. Phaser only.
- Comment sparingly; let identifiers carry meaning.

Return ONLY the JSON, no prose, no fences.`;

export async function writeGameCode({ gdd, levels, manifest, log }) {
  log?.info?.('agent: codesmith');

  const animList = manifest.sprites.flatMap((s) =>
    s.rows.flatMap((r) => s.cols.map((c) => `${r}-${c}`))
  );

  const user = `=== GDD ===
${JSON.stringify(gdd, null, 2)}

=== LEVELS (count=${levels.length}, first only shown for brevity if many) ===
${JSON.stringify(levels.length === 1 ? levels[0] : { count: levels.length, first: levels[0] }, null, 2)}

=== MANIFEST ===
${JSON.stringify(manifest, null, 2)}

=== AVAILABLE ANIMATION KEYS ===
${animList.join(', ')}

Generate the file(s). Return JSON only.`;

  const { json, usage } = await jsonCall({
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 16000,
  });
  if (!Array.isArray(json.files) || json.files.length === 0) throw new Error('codesmith: no files in response');
  const game = json.files.find((f) => f.path.endsWith('scenes/Game.js'));
  if (!game) throw new Error('codesmith: missing src/scenes/Game.js');
  log?.success?.(`codesmith: ${json.files.length} file(s), ${game.content.length}B Game.js`);
  return { files: json.files, usage };
}
