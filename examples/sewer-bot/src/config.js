import Phaser from 'phaser';

export const GAME_CONFIG = {
  type: Phaser.AUTO,
  parent: 'game',
  pixelArt: true,
  roundPixels: true,
  width: 480,
  height: 360,
  backgroundColor: '#050a10',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  seed: ['sewer-bot'],
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  fps: { target: 60, forceSetTimeOut: false },
};
