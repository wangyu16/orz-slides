/**
 * Runs once before the suite — what `npm run build` makes (orz-mdhtml's and
 * orz-paged's tests/global-setup.ts):
 * - the browser engine staged into `dist/` (`orz-slides.browser.js` +
 *   `release.json`), where the Node library (src/engine.ts) reads it, and
 *   into `browser/`; tests check those bytes against the in-memory build
 *   (tests/assemble.test.ts, tests/conformance.test.ts), so a stale engine
 *   cannot pass unnoticed;
 * - dist/ removed first (as `npm run build` does: no stale module ships);
 * - the compiled library (`tsc -p tsconfig.build.json` → dist/).
 */
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { buildBrowser, writeBrowser, writeLibEngine } from '../build/bundle.js';

export async function setup(): Promise<void> {
  // as `npm run build`: dist/ from scratch (a module removed from src/ must not linger there and ship)
  rmSync('dist', { recursive: true, force: true });
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const compile = promisify(execFile)(process.execPath, [tsc, '-p', 'tsconfig.build.json']).catch((e: { stdout?: string; message: string }) => {
    throw new Error(`tsc -p tsconfig.build.json failed:\n${e.stdout ?? e.message}`);
  });
  const b = await buildBrowser();
  writeBrowser(b);
  writeLibEngine(b);
  await compile;
}
