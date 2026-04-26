import { runScript } from '../lib/server.js';

export async function buildCommand(opts, ctx) {
  ctx.log.info('vite build');
  await runScript('npx', ['vite', 'build'], { cwd: ctx.cwd });
  ctx.log.success('built dist/');
}
