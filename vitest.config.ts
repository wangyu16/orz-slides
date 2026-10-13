import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test projects (orz-paged's layout): `main` (unit, corpus, legacy — files in
 * parallel), then `chrome` (the files that drive real Chrome, ONE FILE AT A
 * TIME: their timings are unreliable under parallel load), then
 * `conformance` — orz-markdown's carrier conformance harness against the
 * real carrier (tests/conformance.test.ts, minutes of Chrome load), so its
 * load never shares the machine with the other suites' timing.
 * `tests/global-setup.ts` stages the browser engine into dist/ first.
 * Real-Chrome tests (playwright-core, channel 'chrome') skip themselves when
 * Chrome is not installed; such a run does not verify the claims marked
 * "real" in notes/CLAIMS.md.
 */
const HEAVY = ['tests/conformance.test.ts'];
const CHROME = ['tests/standalone.test.ts', 'tests/fit.test.ts', 'tests/engine.test.ts', 'tests/print.test.ts', 'tests/themes-look.test.ts'];

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      { extends: true, test: { name: 'main', include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, ...HEAVY, ...CHROME], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'chrome', include: CHROME, fileParallelism: false, testTimeout: 60_000, sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: 'conformance', include: HEAVY, sequence: { groupOrder: 2 } } },
    ],
  },
});
