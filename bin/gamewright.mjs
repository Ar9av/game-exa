#!/usr/bin/env node
import { run } from '../src/cli.js';
run(process.argv).catch((err) => {
  if (err && err.exitCode != null) {
    if (err.message) process.stderr.write(err.message + '\n');
    process.exit(err.exitCode);
  }
  console.error(err);
  process.exit(1);
});
