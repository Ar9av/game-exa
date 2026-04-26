export default class Preload extends Phaser.Scene {
  constructor() { super({ key: 'Preload' }); }

  preload() {
    const manifest = this.cache.json.get('manifest') ?? { sprites: [], tiles: null };

    for (let i = 0; i < (manifest.sprites?.length ?? 0); i++) {
      const s   = manifest.sprites[i];
      const key = s.textureKey ?? `entities-${i + 1}`;
      this.load.spritesheet(key, s.relSheet, { frameWidth: s.cell, frameHeight: s.cell });
    }

    if (manifest.tiles) {
      this.load.spritesheet('tiles', manifest.tiles.relSheet, {
        frameWidth:  manifest.tiles.tileSize,
        frameHeight: manifest.tiles.tileSize,
      });
    }

    if (manifest.bg) this.load.image('bg', manifest.bg.relPath);

    const { width: W, height: H } = this.scale;
    const bar = this.add.graphics();
    this.load.on('progress', (v) => {
      bar.clear();
      bar.fillStyle(0xcc2222, 1);
      bar.fillRect(W * 0.1, H / 2 - 8, (W * 0.8) * v, 16);
      bar.lineStyle(1, 0xffffff, 1);
      bar.strokeRect(W * 0.1, H / 2 - 8, W * 0.8, 16);
    });
  }

  create() {
    const manifest = this.cache.json.get('manifest') ?? { sprites: [], tiles: null };

    for (let i = 0; i < (manifest.sprites?.length ?? 0); i++) {
      const s    = manifest.sprites[i];
      const key  = s.textureKey ?? `entities-${i + 1}`;
      const cols = s.cols.length;
      for (let row = 0; row < s.rows.length; row++) {
        for (let col = 0; col < cols; col++) {
          const animKey = `${s.rows[row]}-${s.cols[col]}`;
          if (this.anims.exists(animKey)) continue;
          this.anims.create({
            key: animKey,
            frames: [{ key, frame: row * cols + col }],
            frameRate: 6,
            repeat: -1,
          });
        }
      }
    }

    this.registry.set('levels',   this.cache.json.get('levels'));
    this.registry.set('manifest', manifest);
    this.scene.start('Game', { levelIndex: 0 });
  }
}
