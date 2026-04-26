import * as p from '@clack/prompts';
import { CliError, EX } from './errors.js';

export function isInteractive(opts = {}) {
  if (opts.yes || opts.json) return false;
  if (process.env.CI) return false;
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false;
  return true;
}

export async function ensureValue(value, { name, opts, prompt, default: def }) {
  if (value != null && value !== '') return value;
  if (!isInteractive(opts)) {
    if (def != null) return def;
    throw new CliError(`Missing required ${name}. Pass it as an argument or run interactively.`, EX.USAGE);
  }
  const result = await prompt();
  if (p.isCancel(result)) {
    p.cancel('Aborted.');
    throw new CliError('cancelled', EX.INTERRUPT);
  }
  return result;
}

export { p as prompts };
