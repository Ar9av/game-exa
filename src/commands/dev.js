import { runScript } from '../lib/server.js';

export async function devCommand(opts, ctx) {
  const port = opts.port ?? 5173;
  ctx.log.info(`vite dev on port ${port}`);
  await runScript('npx', ['vite', '--port', String(port)], { cwd: ctx.cwd });
}
