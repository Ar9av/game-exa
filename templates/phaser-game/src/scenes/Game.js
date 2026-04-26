// Placeholder. Overwritten by the codesmith agent at generate time.
export default class Game extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }
  create() {
    this.add.text(20, 20, 'Empty game — run gameforge generate', { color: '#ffffff', fontSize: '12px' });
    window.__gameState = { phase: 'playing', playerX: 0, playerY: 0, enemiesAlive: 0 };
    this.events.emit('scene-ready');
  }
}
