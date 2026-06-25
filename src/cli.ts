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
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { parseDeck } from './slide-parser.js';
import { buildHtml, type ThemeEntry, type RendererSpec, type ThemeSpec } from './template.js';

/** The seven shipped slide themes (served from the orz-slides package on CDN). */
const THEME_DEFS: Array<Omit<ThemeEntry, 'href'>> = [
  { id: 'paper', name: 'Paper', scheme: 'light' },
  { id: 'architect', name: 'Architect', scheme: 'light' },
  { id: 'executive', name: 'Executive', scheme: 'light' },
  { id: 'sage', name: 'Sage', scheme: 'light' },
  { id: 'poppy', name: 'Poppy', scheme: 'light' },
  { id: 'neon', name: 'Neon', scheme: 'dark' },
  { id: 'chalk', name: 'Chalk', scheme: 'dark' },
];

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

function pkgVersion(name: string, fallback = '0.0.0'): string {
  try {
    let dir = dirname(require.resolve(name));
    while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || fallback;
  } catch {
    return fallback;
  }
}

/** orz-slides' own version — pins the engine bundle + theme CDN + version check. */
function selfVersion(): string {
  for (const p of [join(HERE, '..', 'package.json'), join(HERE, '..', '..', 'package.json')]) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (j.name === 'orz-slides' && j.version) return j.version;
    } catch { /* keep looking */ }
  }
  return '0.0.0';
}

/** assets/ sits next to dist/ when published, and next to src/ in dev. */
function findAsset(rel: string): string {
  for (const p of [join(HERE, '..', 'assets', rel), join(HERE, '..', '..', 'assets', rel)]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`asset not found: ${rel}`);
}

/** Inline a theme: splice base.css in for its `@import url('./base.css')`. */
function inlineTheme(id: string): string {
  const themeCss = readFileSync(findAsset(`themes/theme-${id}.css`), 'utf8');
  const baseCss = readFileSync(findAsset('themes/base.css'), 'utf8');
  return themeCss.replace(/@import\s+url\(\s*['"]?\.\/base\.css['"]?\s*\)\s*;/, '\n' + baseCss + '\n');
}

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

  // The deck's own config wins; CLI flags are fallbacks.
  const deck = parseDeck(source);
  const ver = selfVersion();
  const themeBase = `https://cdn.jsdelivr.net/npm/orz-slides@${ver}/assets/themes`;
  const themes: ThemeEntry[] = THEME_DEFS.map((t) => ({ ...t, href: `${themeBase}/theme-${t.id}.css` }));

  const wanted = deck.config.theme || args.theme || 'paper';
  const defaultTheme = themes.some((t) => t.id === wanted) ? wanted : themes[0].id;
  const ratio = deck.config.ratio || '16:9';
  const title = deck.config.title || args.title || base;

  // Engine + theme delivery.
  let renderer: RendererSpec;
  let theme: ThemeSpec;
  if (args.delivery === 'inline') {
    const bundlePath = [
      join(HERE, 'orz-slides.browser.js'),
      join(HERE, '..', 'dist', 'orz-slides.browser.js'),
    ].find(existsSync);
    if (!bundlePath) {
      console.error('Inline mode needs the engine bundle. Run: npm run bundle');
      process.exit(1);
    }
    renderer = { mode: 'inline', js: readFileSync(bundlePath, 'utf8') };
    theme = { mode: 'inline', css: inlineTheme(defaultTheme) };
  } else {
    renderer = { mode: 'cdn', src: `https://cdn.jsdelivr.net/npm/orz-slides-browser@${ver}/orz-slides.browser.js` };
    theme = { mode: 'cdn' };
  }

  const revealVer = pkgVersion('reveal.js', '5.0.4');
  const html = buildHtml({
    source,
    title,
    filename: base,
    docId: randomUUID(),
    rendererVersion: ver,
    renderer,
    theme,
    defaultTheme,
    themes,
    ratio,
    versionManifest: 'https://data.jsdelivr.com/v1/packages/npm/orz-slides-browser/resolved',
    cdn: {
      revealResetCss: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reset.css`,
      revealCss: `https://cdn.jsdelivr.net/npm/reveal.js@${revealVer}/dist/reveal.css`,
      katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      mermaidJs: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
      smilesJs: 'https://cdn.jsdelivr.net/npm/smiles-drawer@1.0.10/dist/smiles-drawer.min.js',
      chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js',
    },
  });

  writeFileSync(outPath, html, 'utf8');
  console.log(`Wrote ${outPath} (${args.delivery}, theme: ${defaultTheme}, ${deck.slides.length} slides)`);
}

main();
