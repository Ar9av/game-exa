import Phaser from 'phaser';
import { GAME_CONFIG } from './config.js';
import Boot from './scenes/Boot.js';
import Preload from './scenes/Preload.js';
import Game from './scenes/Game.js';

const config = {
  ...GAME_CONFIG,
  scene: [Boot, Preload, Game],
};

const game = new Phaser.Game(config);
window.__game = game;
window.__gameReady = false;
window.__gameState = { phase: 'booting', playerX: 0, playerY: 0, batteriesCollected: 0 };

game.events.once(Phaser.Core.Events.READY, () => {
  const tryHook = () => {
    const gameScene = game.scene.scenes.find((s) => s.sys.settings.key === 'Game');
    if (gameScene) {
      gameScene.events.once('scene-ready', () => { window.__gameReady = true; });
    } else {
      setTimeout(tryHook, 50);
    }
  };
  tryHook();
});
