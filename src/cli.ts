#!/usr/bin/env node
/**
 * orz-slides — generate a self-contained, presentable .slides.html from a deck
 * source (orz-markdown + the slide layout syntax).
 *
 * Usage:
 *   orz-slides <input.md> [options]
 *
 * Options:
 *   -o, --out <file>   output path (default: <input>.slides.html)
 *   --theme <name>     theme id (fallback; the deck's `<!-- deck theme: -->` wins)
 *   --inline           embed the engine bundle + theme CSS in the file (default)
 *   --cdn              reference the engine + theme from jsDelivr (small files)
 *   --title <text>     document <title> (fallback; deck `title:` wins)
 *
 * The inline path (the default) is shared with the programmatic library entry
 * `buildSlidesHtml` (src/lib.ts) — there is ONE composition path. The CDN path
 * lives here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getBrowserRuntimeScript } from 'orz-markdown/runtime';
import { PREVIEW_CDN } from 'orz-markdown/preview-frame';
import { parseDeck } from './slide-parser.js';
import { buildHtml, type ThemeEntry, type RendererSpec, type ThemeSpec } from './template.js';
import {
  THEME_DEFS,
  selfVersion,
  findAsset,
  pkgVersion,
  buildSlidesHtmlWithDocId,
} from './lib.js';

interface Args {
  input?: string;
  out?: string;
  theme?: string;
  delivery: 'inline' | 'cdn';
  title?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { delivery: 'inline' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--out') a.out = argv[++i];
    else if (arg === '--theme') a.theme = argv[++i];
    else if (arg === '--inline') a.delivery = 'inline';
    else if (arg === '--cdn') a.delivery = 'cdn';
    else if (arg === '--title') a.title = argv[++i];
    else if (!arg.startsWith('-')) a.input = arg;
  }
  return a;
}

/** The CDN delivery path (engine + themes referenced from jsDelivr). */
function buildCdnHtml(
  source: string,
  title: string,
  base: string,
  docId: string,
  ver: string,
  themes: ThemeEntry[],
  defaultTheme: string,
  ratio: string,
): string {
  const renderer: RendererSpec = {
    mode: 'cdn',
    src: `https://cdn.jsdelivr.net/npm/orz-slides-browser@${ver}/orz-slides.browser.js`,
  };
  const theme: ThemeSpec = { mode: 'cdn' };

  const revealVer = pkgVersion('reveal.js', '5.0.4');
  const revealCss: Parameters<typeof buildHtml>[0]['revealCss'] = {
    mode: 'cdn',
    resetUrl: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reset.css`,
    coreUrl: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reveal.css`,
  };

  const appJs = readFileSync(findAsset('app.js'), 'utf8');
  const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16';
  return buildHtml({
    source,
    title,
    filename: base,
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: orz-slides <input.md> [-o out] [--theme name] [--inline|--cdn]');
    process.exit(1);
  }

  const inputPath = resolve(args.input);
  const source = readFileSync(inputPath, 'utf8');
  const base = basename(inputPath, extname(inputPath)).replace(/\.slides$/, '');
  const outPath = args.out ? resolve(args.out) : join(dirname(inputPath), `${base}.slides.html`);

  const deck = parseDeck(source);
  const docId = randomUUID();

  // Resolve the effective (validated) theme once, for the log line and CDN path.
  const wanted = deck.config.theme || args.theme || 'paper';
  const defaultTheme = THEME_DEFS.some((t) => t.id === wanted) ? wanted : THEME_DEFS[0].id;

  let html: string;
  if (args.delivery === 'inline') {
    // Shared inline composition — the library and the CLI produce byte-identical
    // output for the same source (modulo docId). The deck-config precedence and
    // the 'Untitled' fallbacks live in lib.ts; the CLI passes its filename-based
    // title as the fallback so the deck's own title still wins.
    html = buildSlidesHtmlWithDocId(
      { markdown: source, title: args.title ?? base, theme: args.theme },
      docId,
    );
  } else {
    // The deck's own config wins; CLI flags are fallbacks.
    const ver = selfVersion();
    const themeBase = `https://cdn.jsdelivr.net/npm/orz-slides@${ver}/assets/themes`;
    const themes: ThemeEntry[] = THEME_DEFS.map((t) => ({ ...t, href: `${themeBase}/theme-${t.id}.css` }));
    const ratio = deck.config.ratio || '16:9';
    const title = deck.config.title || args.title || base;
    html = buildCdnHtml(source, title, base, docId, ver, themes, defaultTheme, ratio);
  }

  writeFileSync(outPath, html, 'utf8');
  console.log(`Wrote ${outPath} (${args.delivery}, theme: ${defaultTheme}, ${deck.slides.length} slides)`);
}

main();
