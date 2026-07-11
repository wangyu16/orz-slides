/**
 * orz-slides — programmatic library entry.
 *
 * Exposes {@link buildSlidesHtml}, which generates a fully self-contained,
 * presentable `.slides.html` document IN-PROCESS from a deck source string
 * (orz-markdown + the slide layout syntax) — no CLI, no shelling out, no
 * filesystem input file.
 *
 * The output is ALWAYS fully-inline (inlined engine bundle + inlined base/theme
 * CSS + inlined reveal.js CSS + embedded deck source; no CDN engine/theme pins),
 * byte-identical to the CLI `--inline` path for the same markdown/title/theme
 * (modulo the random docId).
 *
 * This module also owns the shared inline-composition helpers (`selfVersion`,
 * `findAsset`, `themeOnly`, `THEME_DEFS`, reveal.js CSS reading, `pkgVersion`)
 * so there is ONE composition path and the CLI imports them rather than
 * duplicating the logic.
 *
 * Asset resolution is ALWAYS via `import.meta.url` (never `process.cwd()`), so
 * the entry works when consumed from an installed npm package.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { getBrowserRuntimeScript } from 'orz-markdown/runtime';
import { PREVIEW_CDN } from 'orz-markdown/preview-frame';
import { parseDeck } from './slide-parser.js';
import { buildHtml, type ThemeEntry, type RendererSpec, type ThemeSpec } from './template.js';
import { mergeDocMeta, renderDocMetaHead, renderDocMetaIsland, type DocMeta } from 'orz-markdown/doc-meta';

/** The seven shipped slide themes (served from the orz-slides package on CDN). */
export const THEME_DEFS: Array<Omit<ThemeEntry, 'href'>> = [
  { id: 'paper', name: 'Paper', scheme: 'light' },
  { id: 'architect', name: 'Architect', scheme: 'light' },
  { id: 'executive', name: 'Executive', scheme: 'light' },
  { id: 'sage', name: 'Sage', scheme: 'light' },
  { id: 'poppy', name: 'Poppy', scheme: 'light' },
  { id: 'neon', name: 'Neon', scheme: 'dark' },
  { id: 'chalk', name: 'Chalk', scheme: 'dark' },
];

const require = createRequire(import.meta.url);
// Asset resolution anchors on THIS module's location, never process.cwd().
const HERE = dirname(fileURLToPath(import.meta.url));

export function pkgVersion(name: string, fallback = '0.0.0'): string {
  try {
    let dir = dirname(require.resolve(name));
    while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || fallback;
  } catch {
    return fallback;
  }
}

/** orz-slides' own version — pins the engine bundle + theme CDN + version check. */
export function selfVersion(): string {
  for (const p of [join(HERE, '..', 'package.json'), join(HERE, '..', '..', 'package.json')]) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (j.name === 'orz-slides' && j.version) return j.version;
    } catch { /* keep looking */ }
  }
  return '0.0.0';
}

/** assets/ sits next to dist/ when published, and next to src/ in dev. */
export function findAsset(rel: string): string {
  for (const p of [join(HERE, '..', 'assets', rel), join(HERE, '..', '..', 'assets', rel)]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`asset not found: ${rel}`);
}

/** A theme's CSS without its `@import url('./base.css')` (base is inlined once). */
export function themeOnly(id: string): string {
  const css = readFileSync(findAsset(`themes/theme-${id}.css`), 'utf8');
  return css.replace(/@import\s+url\(\s*['"]?\.\/base\.css['"]?\s*\)\s*;/, '');
}

/** The inlined engine bundle (dist/orz-slides.browser.js), read from disk. */
function readEngineBundle(): string {
  const bundlePath = [
    join(HERE, 'orz-slides.browser.js'),
    join(HERE, '..', 'dist', 'orz-slides.browser.js'),
  ].find(existsSync);
  if (!bundlePath) {
    throw new Error('Inline mode needs the engine bundle. Run: npm run bundle');
  }
  return readFileSync(bundlePath, 'utf8');
}

/** reveal.js reset.css + reveal.css (both contain only data: URIs — offline-safe). */
function readRevealCss(): { reset: string; core: string } {
  const revealDist = dirname(require.resolve('reveal.js'));
  return {
    reset: readFileSync(join(revealDist, 'reset.css'), 'utf8'),
    core: readFileSync(join(revealDist, 'reveal.css'), 'utf8'),
  };
}

export interface BuildSlidesOptions {
  /** The deck source (orz-markdown + slide layout syntax). */
  markdown: string;
  /** Document `<title>` fallback; the deck's own `title:` wins. */
  title?: string;
  /** Theme id fallback; the deck's own `theme:` wins. Validated against THEME_DEFS. */
  theme?: string;
  /** Renderer + theme + reveal CSS delivery: `inline` (default, offline) or
   *  `cdn` (small file — engine, themes, and reveal.css load from jsDelivr at
   *  view time; requires orz-slides-browser to be published at this version). */
  delivery?: 'inline' | 'cdn';
  /** Document metadata injected by the host; wins over the deck config. */
  metadata?: DocMeta;
}

/**
 * Shared inline-composition path. Both {@link buildSlidesHtml} and the CLI's
 * `--inline` branch call this; the ONLY difference between them is the `docId`
 * they pass, so with the same `docId` the outputs are byte-identical.
 *
 * @internal — exported for tests / the CLI, not part of the primary API surface.
 */
export function buildSlidesHtmlWithDocId(opts: BuildSlidesOptions, docId: string): string {
  // The deck's own config wins; the passed options are fallbacks. The library
  // has no input filename, so 'Untitled' stands in where the CLI used `base`.
  const deck = parseDeck(opts.markdown);
  const ver = selfVersion();
  const themeBase = `https://cdn.jsdelivr.net/npm/orz-slides@${ver}/assets/themes`;
  const themes: ThemeEntry[] = THEME_DEFS.map((t) => ({ ...t, href: `${themeBase}/theme-${t.id}.css` }));

  const wanted = deck.config.theme || opts.theme || 'paper';
  const defaultTheme = themes.some((t) => t.id === wanted) ? wanted : themes[0].id;
  const ratio = deck.config.ratio || '16:9';
  const title = deck.config.title || opts.title || 'Untitled';

  // The deck config is slides' native metadata channel; the host wins over it,
  // field by field. Note this drives the <head> only — deck.config.footer keeps
  // driving the on-slide footer, unchanged. Nothing is stripped from the source.
  const meta = mergeDocMeta(
    { title: deck.config.title, author: deck.config.author },
    opts.metadata,
  );

  // Engine + theme + reveal CSS delivery: inline (default, offline) or CDN.
  const cdn = opts.delivery === 'cdn';
  const renderer: RendererSpec = cdn
    ? { mode: 'cdn', src: `https://cdn.jsdelivr.net/npm/orz-slides-browser@${ver}/orz-slides.browser.js` }
    : { mode: 'inline', js: readEngineBundle() };
  const theme: ThemeSpec = cdn
    ? { mode: 'cdn' }
    : {
        mode: 'inline',
        base: readFileSync(findAsset('themes/base.css'), 'utf8'),
        themes: THEME_DEFS.map((t) => ({ id: t.id, css: themeOnly(t.id) })),
      };

  let revealCss: Parameters<typeof buildHtml>[0]['revealCss'];
  if (cdn) {
    const revealVer = pkgVersion('reveal.js', '5.0.4');
    revealCss = {
      mode: 'cdn',
      resetUrl: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reset.css`,
      coreUrl: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reveal.css`,
    };
  } else {
    const reveal = readRevealCss();
    revealCss = { mode: 'inline', reset: reveal.reset, core: reveal.core };
  }

  const appJs = readFileSync(findAsset('app.js'), 'utf8');
  const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16';
  return buildHtml({
    source: opts.markdown,
    metaHead: renderDocMetaHead(meta),
    metaIsland: renderDocMetaIsland(meta),
    title,
    filename: 'Untitled',
    docId,
    rendererVersion: ver,
    renderer,
    theme,
    defaultTheme,
    themes,
    ratio,
    versionManifest: 'https://data.jsdelivr.com/v1/packages/npm/orz-slides-browser/resolved',
    appJs,
    runtime: getBrowserRuntimeScript(),
    editorLibs: {
      codemirrorCss: `${CM}/codemirror.min.css`,
      codemirrorLightThemeCss: `${CM}/theme/eclipse.min.css`,
      codemirrorDarkThemeCss: `${CM}/theme/material-darker.min.css`,
      codemirrorJs: `${CM}/codemirror.min.js`,
      codemirrorMarkdownJs: `${CM}/mode/markdown/markdown.min.js`,
      codemirrorContinuelistJs: `${CM}/addon/edit/continuelist.min.js`,
    },
    revealCss,
    cdn: {
      katexCss: PREVIEW_CDN.katexCss,
      mermaidJs: PREVIEW_CDN.mermaidJs,
      smilesJs: PREVIEW_CDN.smilesJs,
      chartJs: PREVIEW_CDN.chartJs,
    },
  });
}

/**
 * Generate a fully self-contained, presentable `.slides.html` document from a
 * deck source string, in-process. Returns the FULL document string.
 *
 * The output is always fully-inline (engine + base/theme CSS + reveal CSS +
 * embedded deck source), byte-identical to the CLI `--inline` output for the
 * same markdown/title/theme (modulo the random docId).
 *
 * Deck-config precedence: the deck's own `title:`/`theme:`/`ratio:` always win;
 * `opts.title`/`opts.theme` are fallbacks (title falls back to `'Untitled'`,
 * theme to `'paper'`, validated against THEME_DEFS).
 */
export function buildSlidesHtml(opts: BuildSlidesOptions): string {
  return buildSlidesHtmlWithDocId(opts, randomUUID());
}
