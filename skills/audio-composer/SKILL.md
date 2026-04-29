---
name: audio-composer
description: Generates genre-appropriate 8-bit sound effects (SFX) and looping background music for a generated game. Produces sfx.json, music.json, and a fixed AudioManager.js template. Run in parallel with codesmith. Requires codesmith to import AudioManager (see codesmith SKILL.md).
---

# Audio Composer — Chiptune SFX + Music

Produces deterministic, genre-appropriate audio for generated games using Web Audio API. No audio files required — all sound is synthesized at runtime from numeric descriptors.

## When to use

Run in parallel with codesmith, after GDD + manifest are finalized. Also run if the user says "add sound" or "add music" to an existing game.

## Output contract

Three files written to the target project:

```
public/assets/sfx.json       — SFX descriptors (freq, duration, waveform, volume)
public/assets/music.json     — music loop (BPM + note sequence)
src/audio/AudioManager.js    — fixed template that loads + plays both (never regenerated)
```

`game-state.json` gains `state.audio`:

```jsonc
{
  "audio": {
    "sfxPath": "assets/sfx.json",
    "musicPath": "assets/music.json",
    "managerPath": "src/audio/AudioManager.js"
  }
}
```

## SFX descriptors (sfx.json)

Each entry is `{ freq, dur, type, vol }`:

- `freq` — oscillator frequency in Hz
- `dur` — sound duration in seconds
- `type` — Web Audio oscillator type: `"square"`, `"sawtooth"`, `"sine"`, `"triangle"`
- `vol` — peak gain (0–1)

Standard SFX keys: `jump`, `land`, `hit`, `pickup`, `death`, `win`, `shoot`, `explosion`

## Music descriptor (music.json)

```jsonc
{
  "bpm": 120,
  "loop": true,
  "notes": [
    { "freq": 261.63, "beats": 1 },   // C4
    { "freq": 329.63, "beats": 1 },   // E4
    { "freq": 0,      "beats": 1 }    // rest (freq 0 = silence)
  ]
}
```

## AudioManager usage (codesmith must add these calls)

```js
import AudioManager from '../audio/AudioManager.js';

// In create():
AudioManager.init(this);   // sets up Safari unlock + loads assets

// In update() or event handlers:
AudioManager.play('jump');
AudioManager.play('pickup');
AudioManager.stopMusic();  // on game-over
```

## Genre presets (used by compose_audio.mjs)

| Genre | BPM | Music style | Key SFX |
|---|---|---|---|
| action-platformer / platformer | 130 | Major pentatonic arpeggio | jump, land, hit, pickup, death, win |
| top-down-adventure / dungeon-crawler | 100 | Minor pentatonic, slower | hit, pickup, death, win |
| top-down-rpg | 90 | Gentle waltz | pickup, hit, win |
| shoot-em-up | 160 | Fast aggressive | shoot, explosion, death, win |
| beat-em-up | 140 | Punchy rhythm | hit, death, win |

## Safari AudioContext unlock

AudioManager.init() registers one-shot input listeners (pointer + keyboard) that resume the AudioContext on first interaction. This satisfies Safari iOS's user-gesture requirement. Never call AudioContext.resume() outside a user gesture.

## Process

1. Read `game-state.json` to get `gdd.genre`.
2. Run `scripts/compose_audio.mjs <project-dir>` — picks preset by genre, writes all 3 files.
3. Patch `game-state.json` with `state.audio`.
4. Inform codesmith to add `import AudioManager` and `AudioManager.init(this)` calls. Codesmith places `AudioManager.play('pickup')` calls in pickup overlap callbacks, `AudioManager.play('hit')` on damage, etc.

## Scripts

- `scripts/compose_audio.mjs <project-dir> [--bpm N] [--palette <genre-override>]`
