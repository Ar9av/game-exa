import { jsonCall } from '../lib/anthropic.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SYSTEM = `You are a Phaser 3 game programmer fixing failures from automated QA.
You receive: failure descriptions, the current source files, and the GDD/manifest.
You output a JSON object with a "files" array of REPLACEMENT file contents — only
files you are modifying. Keep changes targeted to fix the listed failures.

{
  "files": [
    { "path": "src/scenes/Game.js", "content": "<full new contents>" }
  ],
  "rationale": "<one short paragraph explaining the fixes>"
}

Rules:
- Provide FULL file contents, not patches.
- Don't modify files outside src/.
- Preserve the GameScene contract (init, create, scene-ready event, window.__gameState).
- If a failure is "console error: <X>", fix the cause, do not silence the log.
- If win condition is unreachable, fix the level/code so the QA scenario can complete.
- Return ONLY the JSON, no prose, no fences.`;

export async function refineCode({ failures, projectDir, gdd, manifest, files, log }) {
  log?.info?.(`agent: refiner — ${failures.length} failure(s)`);

  const fileBlocks = await Promise.all(files.map(async (rel) => {
    const abs = resolve(projectDir, rel);
    try {
      const content = await readFile(abs, 'utf8');
      return `--- ${rel} ---\n${content}`;
    } catch {
      return `--- ${rel} (missing) ---`;
    }
  }));

  const user = `=== FAILURES ===
${failures.map((f, i) => `${i + 1}. [${f.scenario}] ${f.kind}: ${f.message}`).join('\n')}

=== GDD (excerpt) ===
${JSON.stringify({ genre: gdd.genre, controls: gdd.controls, winCondition: gdd.winCondition, loseCondition: gdd.loseCondition }, null, 2)}

=== MANIFEST ===
${JSON.stringify(manifest, null, 2)}

=== CURRENT FILES ===
${fileBlocks.join('\n\n')}

Output the JSON now.`;

  const { json, usage } = await jsonCall({
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 16000,
  });
  if (!Array.isArray(json.files)) throw new Error('refiner: no files in response');
  log?.success?.(`refiner: ${json.files.length} file(s) edited — ${json.rationale ?? '(no rationale)'}`);
  return { files: json.files, rationale: json.rationale, usage };
}
