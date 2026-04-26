import { createConsola } from 'consola';
import pc from 'picocolors';

const isTTY = !!process.stdout.isTTY;

export function makeLog({ json = false, verbose = false } = {}) {
  const useColor = isTTY && !json && !process.env.NO_COLOR;

  const consola = createConsola({
    level: verbose ? 4 : 3,
    formatOptions: { colors: useColor, date: false, compact: true },
  });

  if (json) {
    consola.setReporters([{
      log: (entry) => {
        process.stderr.write(JSON.stringify({
          level: entry.level,
          type: entry.type,
          message: entry.args.map(String).join(' '),
          ts: Date.now(),
        }) + '\n');
      },
    }]);
  }

  function emit(event, data = {}) {
    if (json) {
      process.stdout.write(JSON.stringify({ event, ts: Date.now(), data }) + '\n');
    } else {
      const arrow = useColor ? pc.cyan('→') : '→';
      consola.info(`${arrow} ${event}${Object.keys(data).length ? ` ${pc.dim(JSON.stringify(data))}` : ''}`);
    }
  }

  function result(payload) {
    if (json) {
      process.stdout.write(JSON.stringify({ event: 'result', ts: Date.now(), data: payload }) + '\n');
    }
  }

  return { ...consola, emit, result, color: useColor, json, pc };
}

export const colors = pc;
