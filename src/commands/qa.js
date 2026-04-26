import { loadState, saveState } from '../lib/state.js';
import { spawnDevServer } from '../lib/server.js';
import { runQA } from '../qa/runner.js';
import { CliError, EX } from '../lib/errors.js';

export async function qaCommand(opts, ctx) {
  const log = ctx.log;
  const state = await loadState(ctx.cwd);
  if (!state.gdd) throw new CliError('No GDD in state — run `gamewright generate "..."` first.', EX.CONFIG);

  let url = opts.url;
  let server;
  if (!url) {
    log.emit('qa.dev-server.start');
    server = await spawnDevServer({ projectDir: ctx.cwd, log });
    url = server.url;
    log.emit('qa.dev-server.ready', { url });
  }

  try {
    log.emit('qa.run.start', { url });
    const report = await runQA({
      projectDir: ctx.cwd,
      url,
      gdd: state.gdd,
      updateBaselines: !!opts.updateBaselines,
      log,
    });

    state.qa = [...(state.qa ?? []), report].slice(-5);
    await saveState(ctx.cwd, state);

    log.emit('qa.run.done', { passed: report.passed, scenarios: report.scenarios.length, failures: report.failures.length });
    log.result(report);

    if (!ctx.json) {
      const tag = report.passed ? log.pc.green('PASS') : log.pc.red('FAIL');
      log.info(`${tag} — ${report.scenarios.length} scenario(s), ${report.failures.length} failure(s)`);
      for (const f of report.failures) {
        log.error(`  ✗ [${f.scenario}] ${f.kind}: ${f.message}`);
      }
    }

    if (!report.passed) {
      throw new CliError('QA failed', EX.QA_FAIL);
    }
  } finally {
    if (server) await server.kill();
  }
}
