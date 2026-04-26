import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Spawn `vite` (via npx) in the given project dir. Resolves to { url, kill }.
 * Listens for the "Local:   http://..." line in vite stdout to detect readiness.
 */
export function spawnDevServer({ projectDir, port = 5173, log }) {
  if (!existsSync(`${projectDir}/node_modules/vite`)) {
    return Promise.reject(new Error(`vite not installed in ${projectDir}. Run npm install first.`));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let resolved = false;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const onLine = (chunk) => {
      stdout += chunk;
      if (log?.verbose) process.stderr.write(chunk);
      if (resolved) return;
      const m = stripAnsi(stdout).match(/Local:\s+(https?:\/\/\S+)/);
      if (m) {
        resolved = true;
        const url = m[1].replace(/\/$/, '');
        resolve({
          url,
          kill: () => new Promise((res) => {
            proc.once('exit', () => res());
            proc.kill('SIGTERM');
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } res(); }, 2000);
          }),
        });
      }
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);
    proc.on('exit', (code) => {
      if (!resolved) reject(new Error(`vite exited ${code} before ready: ${stdout.slice(-400)}`));
    });
    proc.on('error', reject);
    setTimeout(() => {
      if (!resolved) reject(new Error(`vite did not become ready within 30s: ${stdout.slice(-400)}`));
    }, 30_000);
  });
}

export function runScript(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)));
  });
}
