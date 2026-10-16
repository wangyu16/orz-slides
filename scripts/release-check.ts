/**
 * The release gate of BOTH packages (final loop RR-2, RR-5):
 *
 *   tsx scripts/release-check.ts   both `prepublishOnly`s run it (orz-slides-browser's first, so nothing is
 *                                  published before it passes); `npm run release:check` runs it alone. Refuses unless
 *     - orz-slides and orz-slides-browser have the same version;
 *     - the orz-markdown dependency is `^X.Y.Z` with X.Y.Z at least {@link KIT_REQUIRED} (the kit this code
 *       imports: `kitParser`, the 2.4.0 editor API — 2.3.0 crashes at import), and the installed orz-markdown is
 *       a registry install of such a version, not a link to a checkout;
 *     - the CHANGELOG has a dated entry for the version (not "unreleased");
 *     - the tree is clean (a release is a commit).
 * The full suite is the root package's `prepublishOnly` (after this check). The family's planned green-run stamp
 * that would spare publishing the re-run is Phase 4 work (owner, 2026-10-12: "apply in Phase 4, not before"); until
 * then CLAUDE.md "Releasing" runs the root's checks before the browser package is published.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The oldest orz-markdown this code runs on. Raise it with the code that needs more. */
export const KIT_REQUIRED = '2.4.0';

export interface ReleaseState {
  version: string;
  browserVersion: string;
  /** package.json's `dependencies['orz-markdown']`. */
  kitRange: string;
  /** node_modules/orz-markdown is a symbolic link (a checkout), not an install. */
  kitLinked: boolean;
  /** The installed orz-markdown's version (null: none). */
  kitInstalled: string | null;
  changelog: string;
  head: string | null;
  /** `git status --porcelain` is empty. */
  clean: boolean;
}

const parse = (v: string): number[] | null => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const atLeast = (v: number[], min: number[]): boolean => { for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i]! > min[i]!; return true; };

/** What stops a release, in words (empty: none). Pure, for the tests. */
export function releaseProblems(s: ReleaseState): string[] {
  const out: string[] = [];
  const min = parse(KIT_REQUIRED)!;
  if (s.version !== s.browserVersion) out.push(`orz-slides is ${s.version}, orz-slides-browser ${s.browserVersion}: the two are released with the same version (bump both)`);
  const range = /^\^(\d+\.\d+\.\d+)$/.exec(s.kitRange);
  const floor = range ? parse(range[1]!) : null;
  if (!floor) out.push(`the orz-markdown dependency is "${s.kitRange}": write it as ^${KIT_REQUIRED} (or later)`);
  else if (!atLeast(floor, min) || floor[0] !== min[0]) out.push(`the orz-markdown dependency is "${s.kitRange}", but this code needs orz-markdown ${KIT_REQUIRED} (it crashes at import on older ones): \`npx npm@11 install orz-markdown@^${KIT_REQUIRED}\``);
  if (s.kitLinked) out.push(`node_modules/orz-markdown is a link to a checkout: never release from a link — \`npx npm@11 install orz-markdown@^${KIT_REQUIRED}\` installs the published package`);
  else if (s.kitInstalled === null) out.push('orz-markdown is not installed (`npm ci`)');
  else { const v = parse(s.kitInstalled); if (!v || !atLeast(v, min) || (floor && !atLeast(v, floor))) out.push(`the installed orz-markdown is ${s.kitInstalled}, older than the dependency's floor (${s.kitRange}, at least ${KIT_REQUIRED}): \`npm ci\``); }
  const head = new RegExp(`^## \\[${s.version.replace(/\./g, '\\.')}\\] [-–—] (.*)$`, 'm').exec(s.changelog);
  const entry = head ? /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(head[1]!) : null;
  if (!head) out.push(`the CHANGELOG has no "## [${s.version}] — <date>" entry`);
  else if (!entry) out.push(`the CHANGELOG entry of ${s.version} is not dated ("${head[1]!.trim()}"): date it`);
  else if (/unreleased|prepared|not (yet )?(released|published)/i.test(entry[2]!)) out.push(`the CHANGELOG entry of ${s.version} is still marked "${entry[2]!.trim()}": date it`);
  if (!s.clean) out.push('the working tree has uncommitted changes: commit the release first');
  return out;
}

/** The repository's state now. */
export function releaseState(root: string): ReleaseState {
  const json = (f: string): Record<string, any> => JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, any>;
  const pkg = json('package.json');
  const link = join(root, 'node_modules', 'orz-markdown');
  const linked = existsSync(link) && lstatSync(link).isSymbolicLink();
  const installed = existsSync(join(link, 'package.json')) ? String(json('node_modules/orz-markdown/package.json').version) : null;
  const git = (...args: string[]): string | null => { try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  return {
    version: String(pkg.version),
    browserVersion: String(json('browser/package.json').version),
    kitRange: String(pkg.dependencies?.['orz-markdown'] ?? ''),
    kitLinked: linked,
    kitInstalled: installed,
    changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    head: git('rev-parse', 'HEAD'),
    clean: git('status', '--porcelain') === '',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const state = releaseState(root);
  const problems = releaseProblems(state);
  if (problems.length > 0) {
    console.error(`orz-slides release check: not ready\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`orz-slides release check: ${state.version} at ${state.head?.slice(0, 12)} passes (kit, lockstep, dated entry, clean tree)`);
}
