/**
 * VLM Intent Alignment QA — second pass after pixelmatch.
 *
 * Sends the boot screenshot to Claude Haiku with the original prompt + GDD
 * and asks it to score how well the game matches the description.
 * Issues above threshold are added to the refiner's failure list.
 *
 * Usage:
 *   node scripts/intent_qa.mjs <project-dir> [--screenshot path/to/shot.png]
 *
 * Exit code: 0 = pass (score >= threshold), 1 = fail.
 *
 * Appends result to qa/qa-report.json under key "intentQA".
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const PASS_THRESHOLD = 6; // score out of 10

async function findScreenshot(projectDir) {
  const candidates = [
    join(projectDir, 'qa', '__baselines__', 'boot.png'),
    join(projectDir, 'qa', 'boot.png'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export async function runIntentQA({ projectDir, screenshotPath, apiKey }) {
  const stateFile = join(resolve(projectDir), 'game-state.json');
  if (!existsSync(stateFile)) throw new Error(`game-state.json not found in ${projectDir}`);

  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const gdd   = state.gdd;
  const prompt = state.prompt ?? gdd?.tagline ?? '';

  const shotPath = screenshotPath ?? await findScreenshot(projectDir);
  if (!shotPath || !existsSync(shotPath)) {
    return { skipped: true, reason: 'no screenshot available — run playtester first' };
  }

  const imageData = (await readFile(shotPath)).toString('base64');

  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: imageData },
        },
        {
          type: 'text',
          text: [
            'You are a game QA reviewer checking visual intent alignment.',
            '',
            `Original description: "${prompt}"`,
            `Title: ${gdd?.title ?? 'unknown'} | Genre: ${gdd?.genre ?? 'unknown'}`,
            `Win condition: ${gdd?.winCondition ?? 'unknown'}`,
            `Expected entities: ${(gdd?.entities ?? []).map(e => e.id).join(', ')}`,
            '',
            'Look at the screenshot and answer these questions:',
            '1. Does the game look like the description? (0 = nothing matches, 10 = perfect match)',
            '2. Is the player character visible?',
            '3. Is the game world rendered (tiles/background visible, not blank)?',
            '4. List up to 3 critical issues (visual mismatches, missing elements, wrong genre feel).',
            '',
            'Respond ONLY with valid JSON, no prose:',
            '{ "score": <0-10>, "player_visible": <bool>, "world_rendered": <bool>, "issues": ["<issue>", ...] }',
          ].join('\n'),
        },
      ],
    }],
  });

  let result;
  try {
    result = JSON.parse(msg.content[0].text);
  } catch {
    result = { score: 5, player_visible: true, world_rendered: true, issues: ['Could not parse VLM response'] };
  }

  const passed = result.score >= PASS_THRESHOLD && result.world_rendered !== false;

  const report = {
    ts:        new Date().toISOString(),
    screenshot: shotPath,
    score:     result.score,
    threshold: PASS_THRESHOLD,
    passed,
    player_visible: result.player_visible,
    world_rendered: result.world_rendered,
    issues:    result.issues ?? [],
  };

  // Merge into existing qa-report.json
  const qaPath = join(resolve(projectDir), 'qa', 'qa-report.json');
  if (existsSync(qaPath)) {
    const qa = JSON.parse(await readFile(qaPath, 'utf8'));
    qa.intentQA = report;
    if (!passed) {
      qa.passed = false;
      qa.failures = [
        ...(qa.failures ?? []),
        ...report.issues.map(msg => ({ scenario: 'intent-qa', kind: 'intent-mismatch', message: msg })),
      ];
    }
    await writeFile(qaPath, JSON.stringify(qa, null, 2));
  }

  return report;
}

// CLI entry point
if (process.argv[1]?.endsWith('intent_qa.mjs')) {
  const args     = process.argv.slice(2);
  const shotIdx  = args.indexOf('--screenshot');
  const projectDir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--screenshot') ?? '.';
  const shotPath   = shotIdx >= 0 ? args[shotIdx + 1] : undefined;

  try {
    const report = await runIntentQA({ projectDir, screenshotPath: shotPath });
    if (report.skipped) {
      console.log(`⚠ Intent QA skipped: ${report.reason}`);
      process.exit(0);
    }
    const icon = report.passed ? '✅' : '❌';
    console.log(`${icon} Intent QA — score ${report.score}/${report.threshold} (${report.passed ? 'PASS' : 'FAIL'})`);
    if (report.issues.length) report.issues.forEach(i => console.log(`   • ${i}`));
    process.exit(report.passed ? 0 : 1);
  } catch (e) {
    console.error('Intent QA error:', e.message);
    process.exit(1);
  }
}
