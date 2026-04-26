import Phaser from 'phaser';
import GameScene from './scenes/Game.js';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#000000',
  pixelArt: false,
  roundPixels: false,
  parent: 'game',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [GameScene],
};

const game = new Phaser.Game(config);
window.__game = game;
window.__gameState = { phase: 'booting', playerX: 0, playerY: 0, enemiesAlive: 0 };
