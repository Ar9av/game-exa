#!/usr/bin/env node
// Re-export of the safety-checked file writer used by both codesmith and refiner.
// Usage: node apply_fixes.mjs <project-dir> <fixes-json | ->
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const codesmithWriter = fileURLToPath(new URL('../../codesmith/scripts/write_files.mjs', import.meta.url));
const proc = spawn('node', [codesmithWriter, ...process.argv.slice(2)], { stdio: 'inherit' });
proc.on('close', (c) => process.exit(c ?? 1));
