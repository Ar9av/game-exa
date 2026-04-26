import { holdKey, pressKey, snapshotCanvas, readGameState, smoke } from './harness.js';

/**
 * Each scenario receives { page, log } and returns { name, observations, screenshot }.
 * observations are merged into the QA report; screenshot (Buffer) is diffed against
 * a baseline named after the scenario.
 */
export const DEFAULT_SCENARIOS = [
  {
    name: 'boot',
    description: 'Boots, smoke checks, captures initial frame.',
    async run({ page }) {
      // Let the game render a few frames before snapshotting.
      await page.evaluate(() => new Promise((res) => {
        let i = 0;
        const tick = () => (++i >= 60 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }));
      const obs = await smoke(page);
      const shot = await snapshotCanvas(page);
      return { observations: obs, screenshot: shot };
    },
  },
  {
    name: 'walk-right',
    description: 'Holds Right for 600ms, expects player x to increase.',
    async run({ page }) {
      const before = await readGameState(page);
      await holdKey(page, 'ArrowRight', 600);
      const after = await readGameState(page);
      const obs = await smoke(page);
      const shot = await snapshotCanvas(page);
      return {
        observations: {
          ...obs,
          before, after,
          xDelta: (after?.playerX ?? 0) - (before?.playerX ?? 0),
        },
        screenshot: shot,
      };
    },
  },
  {
    name: 'walk-down',
    description: 'Holds Down for 600ms, expects player y to increase (top-down only).',
    async run({ page }) {
      const before = await readGameState(page);
      await holdKey(page, 'ArrowDown', 600);
      const after = await readGameState(page);
      const obs = await smoke(page);
      return {
        observations: {
          ...obs,
          before, after,
          yDelta: (after?.playerY ?? 0) - (before?.playerY ?? 0),
        },
      };
    },
    appliesTo: (gdd) => gdd.controls?.movement !== 'platformer',
  },
  {
    name: 'jump',
    description: 'Presses Space (or Up) once, expects platformer player.y to decrease briefly.',
    async run({ page }) {
      const before = await readGameState(page);
      await pressKey(page, 'Space');
      await page.waitForTimeout(150);
      const apex = await readGameState(page);
      await page.waitForTimeout(400);
      const obs = await smoke(page);
      return {
        observations: {
          ...obs,
          before, apex,
          jumpDelta: (before?.playerY ?? 0) - (apex?.playerY ?? 0),
        },
      };
    },
    appliesTo: (gdd) => gdd.controls?.movement === 'platformer',
  },
  {
    name: 'attack',
    description: 'Presses Space, expects no errors and animation toggle.',
    async run({ page }) {
      await pressKey(page, 'Space');
      await page.waitForTimeout(300);
      const obs = await smoke(page);
      return { observations: obs };
    },
    appliesTo: (gdd) => gdd.controls?.actions?.some((a) => /attack|fire|shoot/i.test(a.name)),
  },
];

export function pickScenarios(gdd) {
  return DEFAULT_SCENARIOS.filter((s) => !s.appliesTo || s.appliesTo(gdd));
}
