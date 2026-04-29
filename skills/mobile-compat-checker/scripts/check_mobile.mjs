#!/usr/bin/env node
// Check (and optionally patch) 5 mobile-compat properties in the generated project.
// Usage: node check_mobile.mjs <project-dir> [--fix]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const projectDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const autoFix = args.includes('--fix');

async function tryRead(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

const configPath  = join(projectDir, 'src', 'config.js');
const indexPath   = join(projectDir, 'index.html');
const gamePath    = join(projectDir, 'src', 'scenes', 'Game.js');
const audioMgrPath = join(projectDir, 'src', 'audio', 'AudioManager.js');
const stateFile   = join(projectDir, 'game-state.json');

const configSrc  = await tryRead(configPath);
const indexSrc   = await tryRead(indexPath);
const gameSrc    = await tryRead(gamePath);
const audioMgrSrc = await tryRead(audioMgrPath);
const allSrc     = [configSrc, gameSrc, audioMgrSrc].filter(Boolean).join('\n');

const checks = [];

// 1. roundPixels
const hasRoundPixels = configSrc?.includes('roundPixels: true') ?? false;
checks.push({ id: 'roundPixels', pass: hasRoundPixels, file: 'src/config.js',
  fix: 'add roundPixels: true after pixelArt: true in config.js' });

// 2. image-rendering: pixelated
const hasPixelated = indexSrc?.includes('pixelated') ?? false;
checks.push({ id: 'image-rendering', pass: hasPixelated, file: 'index.html',
  fix: 'add canvas { image-rendering: pixelated; } to index.html <style>' });

// 3. devicePixelRatio
const hasDpr = allSrc.includes('devicePixelRatio');
checks.push({ id: 'devicePixelRatio', pass: hasDpr, file: 'src/config.js',
  fix: 'scale canvas width/height by window.devicePixelRatio in config.js' });

// 4. Touch input
const touchPatterns = ['addPointer', 'pointerdown', 'pointermove', 'virtualPad', 'joystick', 'TouchManager'];
const hasTouch = touchPatterns.some((p) => allSrc.includes(p));
checks.push({ id: 'touch-input', pass: hasTouch, file: 'src/scenes/Game.js',
  fix: 'add virtual d-pad: four pointer zones (left/right/up/action) in Game.js create()' });

// 5. AudioContext unlock
const unlockPatterns = ['audioCtx.resume', 'AudioContext', '.resume()', 'AudioManager.init', '_unlock'];
const hasUnlock = unlockPatterns.some((p) => allSrc.includes(p));
checks.push({ id: 'audio-context-unlock', pass: hasUnlock, file: audioMgrSrc ? 'src/audio/AudioManager.js' : 'src/scenes/Game.js',
  fix: 'gate AudioContext.resume() on first user gesture (pointerdown or keydown)' });

// Auto-patch: checks 1 and 2 (mechanical text changes, safe to auto-apply)
if (autoFix) {
  // Check 1: roundPixels
  if (!hasRoundPixels && configSrc) {
    const patched = configSrc.replace(/(pixelArt:\s*true,?)/, '$1\n  roundPixels: true,');
    if (patched !== configSrc) {
      await writeFile(configPath, patched);
      checks.find((c) => c.id === 'roundPixels').pass = true;
      checks.find((c) => c.id === 'roundPixels').patched = true;
      console.error('[mobile-compat] patched: roundPixels: true added to config.js');
    }
  }

  // Check 2: image-rendering
  if (!hasPixelated && indexSrc) {
    const styleTag = '<style>';
    const pixelatedCss = 'canvas { image-rendering: pixelated; image-rendering: crisp-edges; }';
    let patched;
    if (indexSrc.includes(styleTag)) {
      patched = indexSrc.replace(styleTag, `${styleTag}\n    ${pixelatedCss}`);
    } else {
      patched = indexSrc.replace('</head>', `  <style>\n    ${pixelatedCss}\n  </style>\n</head>`);
    }
    if (patched !== indexSrc) {
      await writeFile(indexPath, patched);
      checks.find((c) => c.id === 'image-rendering').pass = true;
      checks.find((c) => c.id === 'image-rendering').patched = true;
      console.error('[mobile-compat] patched: image-rendering: pixelated added to index.html');
    }
  }
}

const failCount = checks.filter((c) => !c.pass).length;
const result = {
  ok: failCount === 0,
  failCount,
  checks: checks.map(({ id, pass, file, fix, patched }) => {
    const entry = { id, pass, file };
    if (!pass && fix) entry.fix = fix;
    if (patched) entry.patched = true;
    return entry;
  }),
};

console.log(JSON.stringify(result, null, 2));
process.exit(failCount > 0 ? 5 : 0);
