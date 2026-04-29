#!/usr/bin/env node
// Generate genre-appropriate SFX + music. When ELEVENLABS_API_KEY is set,
// calls ElevenLabs text-to-sound-effects API for real audio files (MP3).
// Otherwise falls back to Web Audio oscillator descriptors at runtime.
// Usage: node compose_audio.mjs <project-dir> [--bpm N] [--no-elevenlabs]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const bpmFlagIdx = args.indexOf('--bpm');
const bpmOverride = bpmFlagIdx >= 0 ? parseInt(args[bpmFlagIdx + 1]) : null;
const skipElevenLabs = args.includes('--no-elevenlabs');

const state = JSON.parse(await readFile(join(projectDir, 'game-state.json'), 'utf8'));
const genre = state.gdd?.genre ?? 'platformer';
const gameTitle = state.gdd?.title ?? state.name ?? 'game';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const useElevenLabs = !skipElevenLabs && !!ELEVENLABS_API_KEY;

// ── Oscillator fallback descriptors ──────────────────────────────────────────
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

// ── ElevenLabs text prompts ───────────────────────────────────────────────────
// duration_seconds: how long ElevenLabs should generate (null = auto)
const ELEVENLABS_PROMPTS = {
  jump:      { text: `Retro 8-bit video game jump sound, quick upward pitch sweep, classic arcade style`, duration_seconds: 0.5 },
  land:      { text: `Retro 8-bit video game landing thud, short low-pitched impact when character hits the ground`, duration_seconds: 0.3 },
  hit:       { text: `Retro 8-bit video game hit impact, sharp damage sound effect, quick percussive hit`, duration_seconds: 0.4 },
  pickup:    { text: `Retro 8-bit video game item pickup chime, bright cheerful ascending arpeggio, coin collection sound`, duration_seconds: 0.6 },
  death:     { text: `Retro 8-bit video game character death sound, descending buzzer, game over sting`, duration_seconds: 0.8 },
  win:       { text: `Retro 8-bit video game victory jingle, triumphant short fanfare, level complete sound`, duration_seconds: 1.5 },
  shoot:     { text: `Retro arcade laser shoot sound, quick electronic zap, sci-fi blaster fire`, duration_seconds: 0.3 },
  explosion: { text: `Retro arcade explosion, low frequency impact burst with noise, short satisfying boom`, duration_seconds: 0.8 },
};

// Genre-flavoured prompt prefix for context
const GENRE_FLAVOUR = {
  'action-platformer': '2D action platformer game, ',
  'platformer':        '2D platformer game, ',
  'top-down-adventure':'top-down adventure game, ',
  'dungeon-crawler':   'dungeon crawler game, ',
  'top-down-rpg':      'RPG video game, ',
  'shoot-em-up':       'shoot-em-up arcade game, ',
  'beat-em-up':        'beat-em-up fighting game, ',
};

async function callElevenLabs(sfxName, retries = 2) {
  const prompt = ELEVENLABS_PROMPTS[sfxName];
  if (!prompt) return null;
  const flavour = GENRE_FLAVOUR[genre] ?? '';
  const text = flavour + prompt.text;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          duration_seconds: prompt.duration_seconds,
          prompt_influence: 0.5,
          model_id: 'eleven_text_to_sound_v2',
        }),
      });

      if (res.status === 429) {
        // rate-limited — wait and retry
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        console.error(`[audio-composer] ElevenLabs ${sfxName}: HTTP ${res.status} — ${body}`);
        return null;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[audio-composer] ElevenLabs ${sfxName}: fetch error — ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

// ── Music presets ─────────────────────────────────────────────────────────────
const C4=261.63, D4=293.66, E4=329.63, F4=349.23, G4=392.00, A4=440.00,
      C5=523.25, D5=587.33, E5=659.25, G5=783.99, REST=0;

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
const music = { bpm: bpmOverride ?? musicBase.bpm, loop: true, notes: musicBase.notes };

// ── Build sfx descriptor object ───────────────────────────────────────────────
const sfx = Object.fromEntries(sfxKeys.map((k) => [k, { ...SFX_PRESETS[k] }]));

// ── ElevenLabs: generate real MP3s when key is available ──────────────────────
const sfxDir = join(projectDir, 'public', 'assets', 'sfx');
const generatedMp3s = [];

if (useElevenLabs) {
  await mkdir(sfxDir, { recursive: true });
  console.error(`[audio-composer] ElevenLabs key found — generating ${sfxKeys.length} MP3 SFX…`);

  // Sequential to avoid hammering the rate limit
  for (const key of sfxKeys) {
    const mp3 = await callElevenLabs(key);
    if (mp3) {
      const relPath = `assets/sfx/${key}.mp3`;
      await writeFile(join(projectDir, 'public', relPath), mp3);
      sfx[key].mp3Path = relPath;
      generatedMp3s.push(key);
      console.error(`[audio-composer] ✓ ${key}.mp3 (${mp3.length} bytes)`);
    } else {
      console.error(`[audio-composer] ✗ ${key} — oscillator fallback`);
    }
  }
} else if (!ELEVENLABS_API_KEY) {
  console.error('[audio-composer] ELEVENLABS_API_KEY not set — using Web Audio oscillator fallback');
} else {
  console.error('[audio-composer] --no-elevenlabs passed — using Web Audio oscillator fallback');
}

// ── Write asset files ─────────────────────────────────────────────────────────
const assetsDir = join(projectDir, 'public', 'assets');
await writeFile(join(assetsDir, 'sfx.json'), JSON.stringify(sfx, null, 2));
await writeFile(join(assetsDir, 'music.json'), JSON.stringify(music, null, 2));

// ── AudioManager.js template (handles both MP3 + oscillator modes) ────────────
const audioDir = join(projectDir, 'src', 'audio');
await mkdir(audioDir, { recursive: true });

const managerTemplate = `// AudioManager — SFX + chiptune music via Web Audio API.
// Prefers ElevenLabs MP3s (sfx[name].mp3Path) when present; falls back to oscillator synthesis.
// Auto-unlocks AudioContext on first user gesture (Safari iOS compatible).
const AudioManager = (() => {
  let _ctx = null;
  let _sfxSpec = null;
  let _buffers = {};
  let _music = null;
  let _musicTimer = null;
  let _noteIdx = 0;
  let _muted = false;

  async function _loadMp3Buffers() {
    const entries = Object.entries(_sfxSpec).filter(([, s]) => s.mp3Path);
    await Promise.all(entries.map(async ([name, spec]) => {
      try {
        const res = await fetch(spec.mp3Path);
        const raw = await res.arrayBuffer();
        _buffers[name] = await _ctx.decodeAudioData(raw);
      } catch (_) { /* mp3 failed — will use oscillator fallback */ }
    }));
  }

  function _unlock() {
    if (_ctx) return;
    _ctx = new AudioContext();
    Promise.all([
      fetch('assets/sfx.json').then((r) => r.json()),
      fetch('assets/music.json').then((r) => r.json()),
    ]).then(async ([s, m]) => {
      _sfxSpec = s;
      _music = m;
      await _loadMp3Buffers();
      if (!_muted) _startMusic();
    });
  }

  function play(name) {
    if (!_ctx || !_sfxSpec?.[name]) return;
    const spec = _sfxSpec[name];

    if (_buffers[name]) {
      const src = _ctx.createBufferSource();
      const gain = _ctx.createGain();
      src.buffer = _buffers[name];
      gain.gain.value = spec.vol ?? 0.7;
      src.connect(gain);
      gain.connect(_ctx.destination);
      src.start();
    } else {
      const { freq, dur, type = 'square', vol = 0.25 } = spec;
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

  function stopMusic() { clearTimeout(_musicTimer); _musicTimer = null; }
  function mute()   { _muted = true; stopMusic(); }
  function unmute() { _muted = false; if (_ctx && _music) _startMusic(); }

  function init(scene) {
    scene.input.once('pointerdown', _unlock);
    scene.input.keyboard.once('keydown', _unlock);
  }

  return { init, play, stopMusic, mute, unmute };
})();

export default AudioManager;
`;

await writeFile(join(audioDir, 'AudioManager.js'), managerTemplate);

// ── Patch game-state.json ─────────────────────────────────────────────────────
state.audio = {
  sfxPath: 'assets/sfx.json',
  musicPath: 'assets/music.json',
  managerPath: 'src/audio/AudioManager.js',
  elevenlabs: useElevenLabs,
  mp3Count: generatedMp3s.length,
};
await writeFile(join(projectDir, 'game-state.json'), JSON.stringify(state, null, 2));

console.log(JSON.stringify({
  ok: true,
  genre,
  bpm: music.bpm,
  sfxKeys,
  mp3Generated: generatedMp3s,
  oscillatorFallback: sfxKeys.filter((k) => !generatedMp3s.includes(k)),
  noteCount: music.notes.length,
  files: [
    'public/assets/sfx.json',
    'public/assets/music.json',
    'src/audio/AudioManager.js',
    ...generatedMp3s.map((k) => `public/assets/sfx/${k}.mp3`),
  ],
}));
