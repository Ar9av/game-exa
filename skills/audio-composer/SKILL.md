---
name: audio-composer
description: Generates genre-appropriate sound effects and looping background music for a generated game. When ELEVENLABS_API_KEY is set, calls the ElevenLabs text-to-sound-effects API for real MP3 audio; otherwise falls back to Web Audio oscillator synthesis. Produces sfx.json, music.json, and AudioManager.js. Run in parallel with art generation stages.
---

# Audio Composer — SFX + Music

Two-tier audio system: **real AI-generated MP3s** when `ELEVENLABS_API_KEY` is available, deterministic **chiptune oscillator synthesis** as a zero-cost fallback. The same `AudioManager.js` handles both transparently — no code change needed in Game.js.

## When to use

Run in parallel with the art generation stages (sprite-artist, tile-artist, bg-artist), after GDD is finalized. Also run on an existing game when the user says "add sound", "add music", or "upgrade to ElevenLabs audio."

## Two modes

### Mode A — ElevenLabs (when `ELEVENLABS_API_KEY` is set)

Calls `POST https://api.elevenlabs.io/v1/sound-generation` for each SFX action. Uses the `eleven_text_to_sound_v2` model with a genre-flavoured text prompt (e.g. `"2D action platformer game, retro 8-bit jump sound, quick upward pitch sweep"`). Saves MP3s to `public/assets/sfx/<name>.mp3`. Adds `mp3Path` to each entry in `sfx.json`. `AudioManager.js` preloads all MP3s as `AudioBuffer`s via `decodeAudioData` and plays them on demand.

Rate limit: requests are made sequentially with automatic retry on HTTP 429.

### Mode B — Web Audio oscillator (no API key, or `--no-elevenlabs`)

Writes oscillator parameters (`freq`, `dur`, `type`, `vol`) to `sfx.json`. `AudioManager.js` generates sound at runtime using `OscillatorNode` — no audio files, no network calls, works offline.

## Output contract

```
public/assets/sfx.json         — SFX descriptors (always written)
public/assets/music.json       — music loop: BPM + pentatonic note sequence
public/assets/sfx/<name>.mp3   — real audio files (Mode A only)
src/audio/AudioManager.js      — fixed runtime template (never regenerated)
```

`game-state.json` gains `state.audio`:

```jsonc
{
  "audio": {
    "sfxPath": "assets/sfx.json",
    "musicPath": "assets/music.json",
    "managerPath": "src/audio/AudioManager.js",
    "elevenlabs": true,       // true when Mode A ran
    "mp3Count": 6             // number of MP3s successfully generated
  }
}
```

## sfx.json shape

Mode A (with MP3):
```jsonc
{
  "jump": { "freq": 380, "dur": 0.14, "type": "square", "vol": 0.22, "mp3Path": "assets/sfx/jump.mp3" }
}
```

Mode B (oscillator only):
```jsonc
{
  "jump": { "freq": 380, "dur": 0.14, "type": "square", "vol": 0.22 }
}
```

`AudioManager.play('jump')` checks for `mp3Path` first; if missing or load fails, falls back to the oscillator params. Per-sound graceful degradation — a failed ElevenLabs response for one SFX doesn't break the rest.

## Genre presets

| Genre | BPM | SFX keys |
|---|---|---|
| action-platformer / platformer | 130 | jump, land, hit, pickup, death, win |
| top-down-adventure / dungeon-crawler | 100 | hit, pickup, death, win |
| top-down-rpg | 88 | pickup, hit, win |
| shoot-em-up | 160 | shoot, explosion, hit, death, win |
| beat-em-up | 140 | hit, death, win |

## AudioManager usage (codesmith adds these)

```js
import AudioManager from '../audio/AudioManager.js';

// In create():
AudioManager.init(this);        // registers Safari AudioContext unlock

// In event handlers / overlaps:
AudioManager.play('jump');      // plays MP3 if available, oscillator if not
AudioManager.play('pickup');
AudioManager.play('hit');
AudioManager.play('death');
AudioManager.play('win');
AudioManager.stopMusic();       // call on game-over

// Optional:
AudioManager.mute();
AudioManager.unmute();
```

## Safari iOS compatibility

`AudioManager.init(scene)` registers one-shot `pointerdown` and `keydown` listeners that create and unlock the `AudioContext` on first interaction. MP3 buffers are decoded at that point. This satisfies Safari iOS's user-gesture requirement without any extra plumbing in Game.js.

## Process

1. Read `game-state.json` → `gdd.genre`.
2. Run `scripts/compose_audio.mjs <project-dir>`.
   - If `ELEVENLABS_API_KEY` is set: generate MP3s, fallback per-sound on error.
   - Otherwise: oscillator-only mode.
3. Patch `game-state.json` with `state.audio`.
4. Codesmith reads `state.audio` and adds `import AudioManager` + `AudioManager.init(this)` to `Game.js`.

## Scripts

- `scripts/compose_audio.mjs <project-dir> [--bpm N] [--no-elevenlabs]`
  - `--no-elevenlabs` — force oscillator mode even if the key is set
  - `--bpm N` — override music tempo
