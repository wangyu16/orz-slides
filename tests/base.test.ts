/**
 * Rebuild step 1 — the base (claims B.1–B.6): orz-markdown ^2.3.0 from the
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

  it('[B.6] prepublishOnly builds and tests before any publish; the release script that published the CLI first is gone (D-15)', () => {
    expect(pkg.scripts['prepublishOnly']).toBe('npm run build && npm test');
    expect(pkg.scripts['release']).toBeUndefined();
  });
});
