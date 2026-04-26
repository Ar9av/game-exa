export default class Boot extends Phaser.Scene {
  constructor() { super({ key: 'Boot' }); }

  preload() {
    this.load.json('manifest', 'assets/manifest.json');
    this.load.json('levels', 'data/levels.json');
  }

  create() {
    this.scene.start('Preload');
  }
}
