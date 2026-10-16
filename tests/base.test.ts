/**
 * Rebuild step 1 — the base (claims B.1–B.7): orz-markdown ^2.3.0 from the
 * registry, reveal.js pinned, no shims and no copied shell code, one theme
 * list, the version constant, the test setup, prepublishOnly (D-15).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES, DEFAULT_THEME, THEME_VALUES, DROPPED_THEMES, isThemeId, resolveTheme } from '../src/themes.js';
import { VERSION } from '../src/version.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
const sources = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(ts|js|cjs|mjs)$/.test(f)).map((f) => join(dir, f));

describe('base', () => {
  it('[B.1] depends on orz-markdown ^2.3.0 (installed from the registry, or — until 2.4.0 is published — linked to the 2.4.0 checkout) and reveal.js pinned exactly; no shims, aliases, path-browserify or package.json walk', () => {
    expect(pkg.dependencies['orz-markdown']).toMatch(/^\^2\.[34]\.0$/);
    if (lstatSync('node_modules/orz-markdown').isSymbolicLink()) {
      // KIT LINK (rebuild step 3): the prepared, unpublished orz-markdown 2.4.0 checkout (as orz-paged used 2.3.0)
      expect(realpathSync('node_modules/orz-markdown')).toBe(realpathSync('../orz-markdown'));
      expect((JSON.parse(readFileSync('node_modules/orz-markdown/package.json', 'utf8')) as { version: string }).version).toBe('2.4.0');
    }
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

  it('[B.6] both prepublishOnlys run the release check (the browser package\'s before anything is published); the root\'s then builds and runs the full suite; the release script that published the CLI first is gone (D-15)', () => {
    expect(pkg.scripts['prepublishOnly']).toBe('npm run build && tsx scripts/release-check.ts && npm test');
    expect(pkg.scripts['release:check']).toBe('tsx scripts/release-check.ts');
    const browser = JSON.parse(readFileSync('browser/package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(browser.scripts['prepublishOnly']).toBe('node scripts/check-release.mjs && cd .. && npx tsx scripts/release-check.ts');
    expect(pkg.scripts['release']).toBeUndefined();
  });

  it('[B.7] the release check refuses what would ship a broken or half-published release: an orz-markdown range below the kit the code needs (2.3.0 crashes at import), a linked kit, an older installed kit, versions out of lockstep, an undated CHANGELOG entry, a dirty tree — and passes a release state (final loop RR-2, RR-5)', async () => {
    const { KIT_REQUIRED, releaseProblems } = await import('../scripts/release-check.js');
    expect(KIT_REQUIRED).toBe('2.4.0');
    const ok = { version: '1.0.0', browserVersion: '1.0.0', kitRange: '^2.4.0', kitLinked: false, kitInstalled: '2.4.0', changelog: '## [1.0.0] - 2026-10-17\n', head: 'abc', clean: true };
    expect(releaseProblems(ok)).toEqual([]);
    const one = (patch: Record<string, unknown>, re: RegExp): void => { const p = releaseProblems({ ...ok, ...patch }); expect(p, JSON.stringify(patch)).toHaveLength(1); expect(p[0], JSON.stringify(patch)).toMatch(re); };
    one({ kitRange: '^2.3.0' }, /needs orz-markdown 2\.4\.0/);
    one({ kitRange: '2.4.0' }, /write it as \^2\.4\.0/);
    one({ kitLinked: true }, /never release from a link/);
    one({ kitInstalled: '2.3.0' }, /installed orz-markdown is 2\.3\.0/);
    one({ browserVersion: '0.8.5' }, /same version/);
    one({ changelog: '## [1.0.0] — 2026-10-13 (prepared; not yet published)\n' }, /still marked/);
    one({ changelog: '## [1.0.0] — unreleased (prepared on branch rebuild/1.0)\n' }, /not dated/);
    one({ changelog: '## [Unreleased]\n' }, /no "## \[1\.0\.0\] — <date>" entry/);
    expect(releaseProblems({ ...ok, changelog: '## [1.0.0] — 2026-10-17\n' })).toEqual([]);
    one({ clean: false }, /uncommitted/);
    // the repository now (the kit linked, ^2.3.0, the entry not dated): refused, naming the kit
    const { releaseState } = await import('../scripts/release-check.js');
    expect(releaseProblems(releaseState(process.cwd())).join('\n')).toMatch(/orz-markdown/);
  });
});
