#!/usr/bin/env node
// Generate genre-appropriate SFX + music descriptors and write AudioManager.js.
// Usage: node compose_audio.mjs <project-dir> [--bpm N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const bpmFlagIdx = args.indexOf('--bpm');
const bpmOverride = bpmFlagIdx >= 0 ? parseInt(args[bpmFlagIdx + 1]) : null;

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
const genre = state.gdd?.genre ?? 'platformer';

// SFX presets — Web Audio API oscillator descriptors
const SFX_PRESETS = {
  jump:      { freq: 380, dur: 0.14, type: 'square',   vol: 0.22 },
  land:      { freq: 110, dur: 0.09, type: 'square',   vol: 0.18 },
  hit:       { freq: 200, dur: 0.18, type: 'sawtooth', vol: 0.28 },
  pickup:    { freq: 660, dur: 0.11, type: 'sine',     vol: 0.26 },
  death:     { freq: 80,  dur: 0.55, type: 'sawtooth', vol: 0.35 },
  win:       { freq: 880, dur: 0.38, type: 'sine',     vol: 0.30 },
  shoot:     { freq: 480, dur: 0.07, type: 'square',   vol: 0.22 },
  explosion: { freq: 60,  dur: 0.40, type: 'sawtooth', vol: 0.38 },
};

// Genre-specific SFX subsets (keys that are relevant per genre)
const GENRE_SFX = {
  'action-platformer': ['jump', 'land', 'hit', 'pickup', 'death', 'win'],
  'platformer':        ['jump', 'land', 'hit', 'pickup', 'death', 'win'],
  'top-down-adventure':['hit', 'pickup', 'death', 'win'],
  'dungeon-crawler':   ['hit', 'pickup', 'death', 'win'],
  'top-down-rpg':      ['pickup', 'hit', 'win'],
  'shoot-em-up':       ['shoot', 'explosion', 'hit', 'death', 'win'],
  'beat-em-up':        ['hit', 'death', 'win'],
};
const sfxKeys = GENRE_SFX[genre] ?? Object.keys(SFX_PRESETS);
const sfx = Object.fromEntries(sfxKeys.map((k) => [k, SFX_PRESETS[k]]));

// Music note frequencies (Hz) — C major pentatonic
const C4=261.63, D4=293.66, E4=329.63, F4=349.23, G4=392.00, A4=440.00,
      C5=523.25, D5=587.33, E5=659.25, G5=783.99;
const REST = 0;

// Genre music presets
const MUSIC_PRESETS = {
  'action-platformer': {
    bpm: 130,
    notes: [
      {freq:C4,beats:1},{freq:E4,beats:1},{freq:G4,beats:1},{freq:A4,beats:1},
      {freq:C5,beats:2},{freq:G4,beats:1},{freq:E4,beats:1},
      {freq:D4,beats:1},{freq:G4,beats:1},{freq:A4,beats:1},{freq:C5,beats:1},
      {freq:G4,beats:2},{freq:REST,beats:2},
    ],
  },
  'platformer': {
    bpm: 120,
    notes: [
      {freq:C4,beats:1},{freq:E4,beats:1},{freq:G4,beats:2},
      {freq:A4,beats:1},{freq:G4,beats:1},{freq:E4,beats:2},
      {freq:D4,beats:1},{freq:F4,beats:1},{freq:G4,beats:2},
      {freq:C5,beats:2},{freq:REST,beats:2},
    ],
  },
  'top-down-adventure': {
    bpm: 100,
    notes: [
      {freq:C4,beats:2},{freq:D4,beats:2},{freq:E4,beats:2},{freq:REST,beats:2},
      {freq:G4,beats:2},{freq:E4,beats:2},{freq:C4,beats:4},
    ],
  },
  'dungeon-crawler': {
    bpm: 90,
    notes: [
      {freq:C4,beats:2},{freq:REST,beats:1},{freq:C4,beats:1},
      {freq:D4,beats:2},{freq:REST,beats:2},
      {freq:E4,beats:3},{freq:REST,beats:1},
      {freq:G4,beats:4},
    ],
  },
  'top-down-rpg': {
    bpm: 88,
    notes: [
      {freq:C4,beats:2},{freq:E4,beats:1},{freq:G4,beats:1},
      {freq:A4,beats:2},{freq:G4,beats:2},
      {freq:E4,beats:2},{freq:D4,beats:2},
      {freq:C4,beats:4},
    ],
  },
  'shoot-em-up': {
    bpm: 160,
    notes: [
      {freq:C5,beats:1},{freq:G4,beats:1},{freq:A4,beats:1},{freq:C5,beats:1},
      {freq:E5,beats:2},{freq:D5,beats:2},
      {freq:C5,beats:1},{freq:A4,beats:1},{freq:G4,beats:1},{freq:REST,beats:1},
      {freq:G5,beats:2},{freq:REST,beats:2},
    ],
  },
  'beat-em-up': {
    bpm: 140,
    notes: [
      {freq:C4,beats:1},{freq:C4,beats:1},{freq:REST,beats:1},{freq:E4,beats:1},
      {freq:G4,beats:2},{freq:REST,beats:2},
      {freq:A4,beats:1},{freq:G4,beats:1},{freq:E4,beats:1},{freq:REST,beats:1},
      {freq:C4,beats:4},
    ],
  },
};

const musicBase = MUSIC_PRESETS[genre] ?? MUSIC_PRESETS['action-platformer'];
const music = {
  bpm: bpmOverride ?? musicBase.bpm,
  loop: true,
  notes: musicBase.notes,
};

// Write public/assets/sfx.json and music.json
const assetsDir = join(projectDir, 'public', 'assets');
await writeFile(join(assetsDir, 'sfx.json'), JSON.stringify(sfx, null, 2));
await writeFile(join(assetsDir, 'music.json'), JSON.stringify(music, null, 2));

// Write src/audio/AudioManager.js (fixed template — never regenerated)
const audioDir = join(projectDir, 'src', 'audio');
await mkdir(audioDir, { recursive: true });

const managerTemplate = `// AudioManager — chiptune SFX + music via Web Audio API.
// Auto-unlocks AudioContext on first user gesture (Safari iOS compatible).
const AudioManager = (() => {
  let _ctx = null;
  let _sfx = null;
  let _music = null;
  let _musicTimer = null;
  let _noteIdx = 0;
  let _muted = false;

  function _unlock() {
    if (_ctx) return;
    _ctx = new AudioContext();
    Promise.all([
      fetch('assets/sfx.json').then((r) => r.json()),
      fetch('assets/music.json').then((r) => r.json()),
    ]).then(([s, m]) => {
      _sfx = s;
      _music = m;
      if (!_muted) _startMusic();
    });
  }

  function play(name) {
    if (!_ctx || !_sfx?.[name]) return;
    const { freq, dur, type = 'square', vol = 0.25 } = _sfx[name];
    const osc = _ctx.createOscillator();
    const gain = _ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, _ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, _ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(_ctx.destination);
    osc.start();
    osc.stop(_ctx.currentTime + dur + 0.01);
  }

  function _startMusic() {
    if (!_ctx || !_music) return;
    const beatMs = (60 / _music.bpm) * 1000;
    const tick = () => {
      const n = _music.notes[_noteIdx % _music.notes.length];
      if (n.freq > 0 && !_muted) {
        const osc = _ctx.createOscillator();
        const gain = _ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = n.freq;
        const noteDur = (beatMs * n.beats) / 1000;
        gain.gain.setValueAtTime(0.08, _ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, _ctx.currentTime + noteDur * 0.85);
        osc.connect(gain);
        gain.connect(_ctx.destination);
        osc.start();
        osc.stop(_ctx.currentTime + noteDur);
      }
      _noteIdx++;
      if (_music.loop || _noteIdx < _music.notes.length) {
        _musicTimer = setTimeout(tick, beatMs * n.beats);
      }
    };
    tick();
  }

  function stopMusic() {
    clearTimeout(_musicTimer);
    _musicTimer = null;
  }

  function mute() {
    _muted = true;
    stopMusic();
  }

  function unmute() {
    _muted = false;
    if (_ctx && _music) _startMusic();
  }

  function init(scene) {
    scene.input.once('pointerdown', _unlock);
    scene.input.keyboard.once('keydown', _unlock);
  }

  return { init, play, stopMusic, mute, unmute };
})();

export default AudioManager;
`;

await writeFile(join(audioDir, 'AudioManager.js'), managerTemplate);

// Patch state.audio
state.audio = {
  sfxPath: 'assets/sfx.json',
  musicPath: 'assets/music.json',
  managerPath: 'src/audio/AudioManager.js',
};
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2));

console.log(JSON.stringify({
  ok: true,
  genre,
  bpm: music.bpm,
  sfxKeys: Object.keys(sfx),
  noteCount: music.notes.length,
  files: ['public/assets/sfx.json', 'public/assets/music.json', 'src/audio/AudioManager.js'],
}));
