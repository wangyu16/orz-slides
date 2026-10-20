/**
 * Rebuild step 1 — the base (claims B.1–B.7): orz-markdown ^2.4.0 from the
 * registry, reveal.js pinned, no shims and no copied shell code, one theme
 * list, the version constant, the test setup, prepublishOnly (D-15).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES, DEFAULT_THEME, THEME_VALUES, DROPPED_THEMES, isThemeId, resolveTheme } from '../src/themes.js';
import { VERSION } from '../src/version.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>; files: string[] };
const sources = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(ts|js|cjs|mjs)$/.test(f)).map((f) => join(dir, f));

describe('base', () => {
  it('[B.1] depends on orz-markdown ^2.4.0 installed from the registry (a real install, not a link to a checkout) and reveal.js pinned exactly; no shims, aliases, path-browserify or package.json walk', () => {
    expect(pkg.dependencies['orz-markdown']).toMatch(/^\^2\.([4-9]|\d\d+)\.\d+$/);
    expect(lstatSync('node_modules/orz-markdown').isSymbolicLink()).toBe(false);
    const installed = (JSON.parse(readFileSync('node_modules/orz-markdown/package.json', 'utf8')) as { version: string }).version.split('.').map(Number);
    expect(installed[0]).toBe(2);
    expect(installed[1]!).toBeGreaterThanOrEqual(4);
    expect(pkg.dependencies['reveal.js']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync('build/shims')).toBe(false);
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('path-browserify');
    for (const file of [...sources('src'), ...sources('build')]) {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/path-browserify|build\/shims|shims\/|inject\s*:/);
      expect(src, file).not.toMatch(/require\.resolve\(['"]orz-markdown|pkgVersion|selfVersion|walking up/);
    }
    expect(readFileSync('src/lib.ts', 'utf8')).toMatch(/from 'orz-markdown\/version'/);
    expect(readFileSync('build/bundle.ts', 'utf8')).toMatch(/from 'orz-markdown\/version'/);
  });

  it('[B.2] the copied 0.x shell is gone: no assets/app.js, template, browser-entry, 0.x CLI or library; no save/host/update code of its own (the kit\'s carrier/app replaces it)', () => {
    for (const f of ['assets/app.js', 'src/template.ts', 'src/browser-entry.ts', 'src/slide-parser.ts', 'src/globals.d.ts']) expect(existsSync(f), f).toBe(false);
    for (const file of sources('src')) {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      // (reveal.js's own `postMessage: false` option is a setting that turns its message API off, not a call)
      expect(src, file).not.toMatch(/showSaveFilePicker|indexedDB|postMessage\s*\(|\.postMessage\b|addEventListener\(\s*['"]message|__ORZ_SLIDES__\s*=|data\.jsdelivr\.com|buildSlidesHtml/);
    }
    expect(readFileSync('src/browser/index.ts', 'utf8')).toMatch(/startCarrier\(SLIDES_KIND\)/);
  });

  it('[B.3] one slide theme list (src/themes.ts): the 14 themes of owner decision 5, default orchard, orz-markdown ids as aliases of the 10 derived (and of paper for the 2 dropped md-derived)', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['orchard', 'sky', 'stationery', 'preprint', 'small-press', 'notebook', 'sticker', 'inscription', 'copper', 'nocturne', 'architect', 'chalk', 'neon', 'paper']);
    expect(DEFAULT_THEME).toBe('orchard');
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
    expect(THEMES.filter((t) => t.derivedFrom !== null)).toHaveLength(10);
    expect(resolveTheme('light-neat-3')!.id).toBe('orchard');
    expect(resolveTheme('dark-elegant-3')!.id).toBe('nocturne');
    // Manuscript and Trade Book were dropped in favour of Paper: their md ids are aliases of paper
    expect(resolveTheme('light-academic-1')!.id).toBe('paper');
    expect(resolveTheme('beige-decent-1')!.id).toBe('paper');
    expect(THEME_VALUES).toHaveLength(26);
    for (const [from, to] of Object.entries(DROPPED_THEMES)) {
      expect(isThemeId(from)).toBe(false);
      expect(isThemeId(to)).toBe(true);
    }
    // the kit's themes exist for every derived theme
    const kitThemes = readdirSync('node_modules/orz-markdown/themes').filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4));
    for (const t of THEMES) if (t.derivedFrom) expect(kitThemes).toContain(t.derivedFrom);
  });

  it('[B.4] VERSION (the shell version every file records) is the package version, and orz-slides-browser is in lockstep', () => {
    expect(VERSION).toBe(pkg.version);
    expect(JSON.parse(readFileSync('browser/package.json', 'utf8')).version).toBe(pkg.version);
  });

  it('[B.5] the test setup is orz-paged\'s: vitest projects main, chrome (one file at a time) and conformance; playwright-core; the live claims registry', () => {
    const config = readFileSync('vitest.config.ts', 'utf8');
    for (const name of ['main', 'chrome', 'conformance']) expect(config).toContain(`name: '${name}'`);
    expect(config).toMatch(/fileParallelism: false/);
    expect(pkg.devDependencies['playwright-core']).toBeDefined();
    expect(existsSync('notes/CLAIMS.md')).toBe(true);
    expect(existsSync('tests/claims.test.ts')).toBe(true);
  });

  it('[B.6] both prepublishOnlys run the family release gate (the browser package\'s after its own manifest check) and the stamp check; the root\'s builds first and never runs the suite (the green-run stamp of `npm run test:release` stands for it); the tiers are scripts; the release script that published the CLI first is gone (D-15)', () => {
    expect(pkg.scripts['prepublishOnly']).toBe('npm run build && tsx scripts/release-check.ts --after-build && tsx scripts/test-release.ts --check');
    expect(pkg.scripts['release:check']).toBe('tsx scripts/release-check.ts');
    expect(pkg.scripts['test:release']).toBe('tsx scripts/test-release.ts');
    expect(pkg.scripts['test:fast']).toBe('tsx scripts/test-release.ts --fast');
    expect(pkg.scripts['test:changed']).toBe('tsx scripts/test-release.ts --changed');
    const browser = JSON.parse(readFileSync('browser/package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(browser.scripts['prepublishOnly']).toBe('node scripts/check-release.mjs && cd .. && npx tsx scripts/release-check.ts && npx tsx scripts/test-release.ts --check');
    expect(pkg.scripts['release']).toBeUndefined();
    expect(readFileSync('.gitignore', 'utf8').split('\n')).toContain('.release/');
    for (const f of pkg.files) expect(f, 'the release tooling is never shipped').not.toMatch(/^(scripts|\.release|release\.config\.json)/);
  });

  it('[B.7] the release check refuses what would ship a broken or half-published release: an orz-markdown range below the kit the code needs (2.3.0 crashes at import), a linked kit, an older installed kit, a bundle of another kit, versions out of lockstep, an undated CHANGELOG entry, a dirty tree, a stale manifest — and passes a release state (final loop RR-2, RR-5; the family gate, scripts/release-check.ts)', async () => {
    const { KIT_REQUIRED, loadConfig, releaseProblems, releaseState } = await import('../scripts/release-check.js');
    const config = loadConfig(process.cwd());
    expect(KIT_REQUIRED).toBe('2.4.0');
    expect(config.kit).toEqual({ name: 'orz-markdown', required: '2.4.0' });
    expect(config.checks).toEqual([['node', 'browser/scripts/check-release.mjs']]);
    const ok = { name: 'orz-slides', version: '1.0.0', browserVersion: '1.0.0', kitRange: '^2.4.0', kitLinked: false, kitInstalled: '2.4.0', kitLocked: 'https://registry.npmjs.org/orz-markdown/-/orz-markdown-2.4.0.tgz', bundledKit: [{ file: 'browser/orz-slides.browser.js', versions: ['2.4.0'] }], manifestKit: null, changelog: '## [1.0.0] - 2026-10-17\n', head: 'abc', clean: true, dirty: [], checkFailures: [] };
    expect(releaseProblems(ok, config)).toEqual([]);
    const one = (patch: Record<string, unknown>, re: RegExp): void => { const p = releaseProblems({ ...ok, ...patch }, config); expect(p, JSON.stringify(patch)).toHaveLength(1); expect(p[0], JSON.stringify(patch)).toMatch(re); };
    one({ kitRange: '^2.3.0' }, /needs orz-markdown 2\.4\.0/);
    one({ kitRange: '2.4.0' }, /write it as \^2\.4\.0/);
    one({ kitLinked: true }, /never release from a link/);
    one({ kitLocked: 'file:../orz-markdown' }, /not the npm registry/);
    one({ kitInstalled: '2.3.0', bundledKit: [{ file: 'browser/orz-slides.browser.js', versions: ['2.3.0'] }] }, /installed orz-markdown is 2\.3\.0/);
    one({ bundledKit: [{ file: 'browser/orz-slides.browser.js', versions: ['2.3.0'] }] }, /embeds orz-markdown 2\.3\.0, but the installed orz-markdown is 2\.4\.0/);
    one({ browserVersion: '0.8.5' }, /same version/);
    one({ changelog: '## [1.0.0] — 2026-10-13 (prepared; not yet published)\n' }, /still marked/);
    one({ changelog: '## [1.0.0] — unreleased (prepared on branch rebuild/1.0)\n' }, /not dated/);
    one({ changelog: '## [Unreleased]\n' }, /no "## \[1\.0\.0\] — <date>" entry/);
    expect(releaseProblems({ ...ok, changelog: '## [1.0.0] — 2026-10-17\n' }, config)).toEqual([]);
    one({ clean: false, dirty: [' M src/cli.ts'] }, /uncommitted/);
    one({ checkFailures: [{ command: 'node browser/scripts/check-release.mjs', output: 'stale' }] }, /release manifest does not match/);
    // the repository now (the registry kit ^2.4.0, the built bundle): nothing about the kit stops a release
    expect(releaseProblems(releaseState(process.cwd(), config), config).filter((p) => /orz-markdown/.test(p))).toEqual([]);
  });
});
