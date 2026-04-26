import { Command } from 'commander';
import { buildContext } from './lib/context.js';
import { CliError, EX } from './lib/errors.js';

export async function run(argv) {
  process.on('SIGINT', () => process.exit(EX.INTERRUPT));

  const program = new Command();
  program
    .name('gamewright')
    .description('game-exa — agent-driven framework for generating runnable Phaser 3 games.')
    .version('0.1.0')
    .option('--json', 'machine-readable NDJSON output on stdout')
    .option('--cwd <path>', 'working directory', process.cwd())
    .option('-y, --yes', 'non-interactive; require all values via flags')
    .option('-v, --verbose', 'verbose logging')
    .option('--config <path>', 'config file path');

  program
    .command('init [name]')
    .description('scaffold a new Phaser 3 game project')
    .option('--dir <path>', 'output directory (default: ./<name>)')
    .option('--prompt <text>', 'pre-fill the game description')
    .option('--genre <id>', 'pre-fill genre hint')
    .option('--force', 'allow non-empty target directory')
    .option('--skip-install', 'do not run npm install')
    .action(async (name, opts) => dispatch(program, opts, () => import('./commands/init.js').then((m) => m.initCommand(name, opts, ctxOf(program)))));

  program
    .command('generate [description]')
    .description('run agent pipeline: GDD → levels → sprites → code')
    .option('--genre <id>', 'force genre')
    .option('--quality <low|medium|high>', 'sprite generation quality', 'low')
    .option('--skip-sprites', 'reuse existing sprite sheets')
    .option('--placeholder-sprites', 'generate procedural placeholder sprites (no FAL credits)')
    .action(async (description, opts) => dispatch(program, opts, () => import('./commands/generate.js').then((m) => m.generateCommand(description, opts, ctxOf(program)))));

  program
    .command('qa')
    .description('run headless tests + screenshot diff against the generated game')
    .option('--url <url>', 'use an already-running dev server')
    .option('--update-baselines', 'overwrite baseline screenshots with current output')
    .action(async (opts) => dispatch(program, opts, () => import('./commands/qa.js').then((m) => m.qaCommand(opts, ctxOf(program)))));

  program
    .command('refine')
    .description('feed the latest QA failures back to the refiner agent')
    .option('--force', 'refine even if last QA passed')
    .option('--skip-qa', 'do not rerun qa after refining')
    .action(async (opts) => dispatch(program, opts, () => import('./commands/refine.js').then((m) => m.refineCommand(opts, ctxOf(program)))));

  program
    .command('dev')
    .description('start the Vite dev server')
    .option('--port <n>', 'dev server port', (v) => parseInt(v, 10), 5173)
    .action(async (opts) => dispatch(program, opts, () => import('./commands/dev.js').then((m) => m.devCommand(opts, ctxOf(program)))));

  program
    .command('build')
    .description('build the production bundle')
    .action(async (opts) => dispatch(program, opts, () => import('./commands/build.js').then((m) => m.buildCommand(opts, ctxOf(program)))));

  program.exitOverride((err) => {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') process.exit(0);
    throw new CliError(err.message, EX.USAGE);
  });

  await program.parseAsync(argv);
}

function ctxOf(program) {
  return buildContext(program.opts());
}

async function dispatch(program, _localOpts, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(err.message, EX.GENERIC, err);
  }
}
