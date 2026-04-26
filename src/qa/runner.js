import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { bootGame, diffOrRecord } from './harness.js';
import { pickScenarios } from './scenarios.js';

/**
 * Run QA on a game project. Expects a dev server running at `url`.
 * Writes baselines under <projectDir>/qa/__baselines__/<scenario>.png
 * and actual/diff under qa/__actual__/ and qa/__diffs__/.
 */
export async function runQA({ projectDir, url, gdd, updateBaselines = false, log }) {
  const scenarios = pickScenarios(gdd);
  const baseDir = resolve(projectDir, 'qa');
  await mkdir(join(baseDir, '__baselines__'), { recursive: true });
  await mkdir(join(baseDir, '__actual__'), { recursive: true });
  await mkdir(join(baseDir, '__diffs__'), { recursive: true });

  const { browser, page, errors: bootErrors } = await bootGame(url, { log });
  const results = [];
  const failures = [];

  if (bootErrors.length) {
    for (const e of bootErrors) failures.push({ scenario: 'boot', kind: e.kind, message: e.message });
  }

  for (const sc of scenarios) {
    log?.info?.(`scenario: ${sc.name}`);
    const sceErrors = [];
    const onErr = (e) => sceErrors.push({ kind: 'exception', message: e.message });
    const onCon = (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/Failed to load resource:.*404|favicon\.ico|\[vite\]/i.test(text)) return;
      sceErrors.push({ kind: 'console-error', message: text });
    };
    page.on('pageerror', onErr);
    page.on('console', onCon);

    let result;
    try {
      result = await sc.run({ page, log });
    } catch (err) {
      failures.push({ scenario: sc.name, kind: 'scenario-crash', message: err.message });
      page.off('pageerror', onErr);
      page.off('console', onCon);
      continue;
    }
    page.off('pageerror', onErr);
    page.off('console', onCon);

    for (const e of sceErrors) failures.push({ scenario: sc.name, kind: e.kind, message: e.message });

    let diff = null;
    if (result.screenshot) {
      const baseline = join(baseDir, '__baselines__', `${sc.name}.png`);
      const actual = join(baseDir, '__actual__', `${sc.name}.png`);
      const diffPath = join(baseDir, '__diffs__', `${sc.name}.png`);
      await writeFile(actual, result.screenshot);
      diff = await diffOrRecord({
        buf: result.screenshot,
        baselinePath: baseline,
        diffPath,
        updateBaselines,
      });
      if (diff.status === 'fail') {
        failures.push({
          scenario: sc.name,
          kind: 'screenshot-diff',
          message: `${(diff.ratio * 100).toFixed(2)}% pixels differ${diff.note ? ` (${diff.note})` : ''}`,
        });
      }
    }

    // Scenario-specific assertions.
    const o = result.observations ?? {};
    if (o.fps !== undefined && o.fps < 25) {
      failures.push({ scenario: sc.name, kind: 'low-fps', message: `fps=${o.fps.toFixed(1)} < 25` });
    }
    if (o.blank) {
      failures.push({ scenario: sc.name, kind: 'blank-canvas', message: 'canvas center pixel is blank/black' });
    }
    if (sc.name === 'walk-right' && (o.xDelta ?? 0) <= 0) {
      failures.push({ scenario: sc.name, kind: 'no-movement', message: `Right held but xDelta=${o.xDelta}` });
    }
    if (sc.name === 'walk-down' && (o.yDelta ?? 0) <= 0) {
      failures.push({ scenario: sc.name, kind: 'no-movement', message: `Down held but yDelta=${o.yDelta}` });
    }
    if (sc.name === 'jump' && (o.jumpDelta ?? 0) <= 0) {
      failures.push({ scenario: sc.name, kind: 'no-jump', message: `Space pressed but jumpDelta=${o.jumpDelta}` });
    }

    results.push({ scenario: sc.name, observations: o, diff });
  }

  await browser.close();

  const report = {
    ts: new Date().toISOString(),
    url,
    passed: failures.length === 0,
    scenarios: results,
    failures,
  };
  await writeFile(join(baseDir, 'qa-report.json'), JSON.stringify(report, null, 2));
  return report;
}
