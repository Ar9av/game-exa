import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, EX } from './errors.js';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const MAX_OUTPUT_TOKENS = 8192;

let cachedKey = null;

async function findApiKey() {
  if (cachedKey) return cachedKey;
  if (process.env.ANTHROPIC_API_KEY) {
    cachedKey = process.env.ANTHROPIC_API_KEY;
    return cachedKey;
  }
  const envFile = join(homedir(), '.all-skills', '.env');
  if (existsSync(envFile)) {
    const raw = await readFile(envFile, 'utf8');
    const m = raw.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) {
      cachedKey = m[1].replace(/^["']|["']$/g, '');
      return cachedKey;
    }
  }
  return null;
}

export async function getClient() {
  const apiKey = await findApiKey();
  if (!apiKey) {
    throw new CliError(
      'ANTHROPIC_API_KEY not set. Export it, or add it to ~/.all-skills/.env.',
      EX.CONFIG,
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Call Claude with a JSON-output contract. The system prompt is cached
 * (5min TTL) so repeated agent calls within a generate run are cheap.
 *
 * @param {object} opts
 * @param {string} opts.system - cached system prompt
 * @param {Array<{role:string,content:string|Array}>} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{json:any, raw:string, usage:object}>}
 */
export async function jsonCall({ system, messages, model = DEFAULT_MODEL, maxTokens = MAX_OUTPUT_TOKENS }) {
  const client = await getClient();
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const json = parseJson(text);
  return { json, raw: text, usage: resp.usage };
}

function parseJson(text) {
  // Strip ```json fences if the model wrapped output.
  const stripped = text.replace(/```(?:json)?\n?([\s\S]*?)\n?```/g, '$1').trim();
  // Find first `{` or `[` and parse the balanced span.
  const start = stripped.search(/[{[]/);
  if (start === -1) {
    throw new CliError(`Model output contained no JSON: ${text.slice(0, 200)}`, EX.GENERIC);
  }
  const open = stripped[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new CliError(`Model output JSON unterminated`, EX.GENERIC);
  const slice = stripped.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new CliError(`Model output not valid JSON: ${e.message}\n--- raw ---\n${slice.slice(0, 400)}`, EX.GENERIC);
  }
}
