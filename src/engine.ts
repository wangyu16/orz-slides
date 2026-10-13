/**
 * NODE ONLY: the browser engine an inline file carries, for the Node library
 * and the CLI.
 *
 * Decision (as orz-mdhtml step 5 and orz-paged step 3): the `orz-slides` package ships its own copy of
 * the IIFE bundle and its `release.json` in `dist/` — staged by
 * `build/bundle.ts` from the SAME build that writes `orz-slides-browser`'s
 * files (the two packages are released in lockstep, FC-13). So the Node
 * `assemble` inlines exactly the bytes the browser package publishes and the
 * browser's own `OrzCarrier.assemble` writes (FC-18 law 2), with no runtime
 * dependency on the browser package being installed or published first, and
 * in a source checkout too (`src/` → `../dist/`).
 *
 * The file is checked before use against its manifest: `release.json` must
 * be this release (`kind: slides`, `version` = {@link VERSION}, `bundle.path` =
 * the file) and its SHA-384 integrity must match the bundle's exact bytes,
 * and the bundle must be script-safe. A stale or foreign bundle is refused
 * with the command that rebuilds it, never inlined.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isScriptSafe } from 'orz-markdown/carrier/shell';
import { BUNDLE_FILE } from './assemble.js';
import { VERSION } from './version.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the engine is looked for: next to the compiled library (published), then the build output of a source checkout. */
export function engineDirs(): string[] {
  return [HERE, join(HERE, '..', 'dist')];
}

export interface EngineFiles {
  /** Path of `orz-slides.browser.js`. */
  bundle: string;
  /** Path of its `release.json`. */
  release: string;
  /** The bundle's exact text. */
  source: string;
  /** Its SHA-384 integrity (`sha384-…`), as `release.json` states it. */
  integrity: string;
}

let cached: EngineFiles | null = null;

/**
 * Read and verify the engine in the first of `dirs` that holds both files
 * (uncached). Throws when none does, or when it is stale (another version),
 * altered (integrity) or not script-safe.
 */
export function readEngine(dirs: readonly string[], version: string = VERSION): EngineFiles {
  const dir = dirs.find((d) => existsSync(join(d, BUNDLE_FILE)) && existsSync(join(d, 'release.json')));
  if (!dir) throw new Error(`orz-slides: the browser engine (${BUNDLE_FILE} and release.json) is missing next to the library; in a source checkout run \`npm run bundle\``);
  const bundle = join(dir, BUNDLE_FILE);
  const release = join(dir, 'release.json');
  const source = readFileSync(bundle, 'utf8');
  let manifest: { kind?: unknown; version?: unknown; bundle?: { path?: unknown; integrity?: unknown } };
  try { manifest = JSON.parse(readFileSync(release, 'utf8')); } catch (e) { throw new Error(`orz-slides: ${release} is not valid JSON (${(e as Error).message})`); }
  const integrity = `sha384-${createHash('sha384').update(source, 'utf8').digest('base64')}`;
  const problems: string[] = [];
  if (manifest.kind !== 'slides') problems.push(`kind ${JSON.stringify(manifest.kind)}, not "slides"`);
  if (manifest.version !== version) problems.push(`version ${JSON.stringify(manifest.version)}, not this release's ${version}`);
  if (manifest.bundle?.path !== BUNDLE_FILE) problems.push(`bundle.path ${JSON.stringify(manifest.bundle?.path)}, not ${BUNDLE_FILE}`);
  if (manifest.bundle?.integrity !== integrity) problems.push('the bundle does not match the integrity in release.json');
  if (!isScriptSafe(source) || source.includes('\r')) problems.push('the bundle is not script-safe');
  if (problems.length > 0) throw new Error(`orz-slides: the browser engine in ${dir} cannot be used: ${problems.join('; ')}; in a source checkout run \`npm run bundle\``);
  return { bundle, release, source, integrity };
}

/**
 * The verified engine of this release (cached after the first call). Throws
 * when it is missing, stale (another version), altered (integrity) or not
 * script-safe.
 */
export function engineFiles(): EngineFiles {
  return (cached ??= readEngine(engineDirs()));
}

/** The exact text of this release's browser bundle (what an inline file carries). */
export function engineSource(): string {
  return engineFiles().source;
}
