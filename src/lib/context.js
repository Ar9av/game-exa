import { resolve } from 'node:path';
import { makeLog } from './log.js';

export function buildContext(globalOpts = {}) {
  const cwd = resolve(globalOpts.cwd ?? process.cwd());
  const log = makeLog({ json: !!globalOpts.json, verbose: !!globalOpts.verbose });
  return {
    cwd,
    log,
    json: !!globalOpts.json,
    yes: !!globalOpts.yes,
    verbose: !!globalOpts.verbose,
    config: globalOpts.config ?? null,
  };
}
