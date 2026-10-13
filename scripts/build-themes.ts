/**
 * Builds the 14 slide themes the engine carries (REBUILD §3c steps 3–4).
 *
 *   npx tsx scripts/build-themes.ts           write the generated files
 *   npx tsx scripts/build-themes.ts --check   exit 1 when a generated file is stale
 *
 * A DERIVED theme (orz-markdown theme → slide theme; FC-05 structure and
 * decoration kept) is, in order:
 *
 *   orz-markdown common.css      the structure, adapted to a slide (below)
 *   orz-markdown <source>.css    the decoration, adapted to a slide
 *   assets/themes/layers/slide-scale.css   reading column → projected slide
 *   assets/themes/layers/<id>.css          the theme's slide layer (chrome
 *                                          slots, templates, fragments …)
 *
 * The adaptation (ported from the theme concepts, branch concepts/themes):
 * only `:root` and rules that style `.markdown-body` (or the QR overlay) are
 * kept; the article frame's box properties, width modifiers, `@media`
 * blocks and fixed/sticky positioning go; `clamp(min, <viewport>, max)`
 * becomes its desktop value; `rem` (and `px` font sizes) become `em` of the
 * source theme's body size, so the slide's text size scales every size.
 * Font `@import`s are hoisted to the top.
 *
 * An UPDATED theme (a 0.x theme kept: Architect, Chalk, Neon, Paper) has no
 * source theme; it is
 *
 *   assets/themes/layers/content.css       Markdown content in theme tokens
 *   assets/themes/layers/<id>.css          the theme (tokens, content, slide)
 *
 * Inputs: the INSTALLED orz-markdown package (node_modules/orz-markdown/
 * themes), so an orz-markdown theme change flows into the slides on
 * rebuild. Output (generated, committed; run by `prebuild` and `pretest`):
 * assets/themes/<id>.css for every theme of src/themes.ts (each must have
 * its layer). The engine's
 * structure (assets/themes/deck.css) is hand-written; build/bundle.ts
 * bundles it and the generated themes as text (the virtual module
 * `orz-slides:themes`), so inline and cdn files style the same.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { THEMES } from '../src/themes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MD_THEMES = join(ROOT, 'node_modules/orz-markdown/themes');
const THEME_DIR = join(ROOT, 'assets/themes');
const LAYER_DIR = join(THEME_DIR, 'layers');

/* ───────────── a small CSS reader (after orz-paged scripts/build-themes.ts) ───────────── */

function endOfString(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; }
  return j + 1;
}
function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length;) {
    const c = css[i];
    if (c === '"' || c === "'") { const j = endOfString(css, i); out += css.slice(i, j); i = j; }
    else if (c === '/' && css[i + 1] === '*') { const j = css.indexOf('*/', i + 2); i = j < 0 ? css.length : j + 2; }
    else { out += c; i++; }
  }
  return out;
}
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") i = endOfString(s, i) - 1;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}
type Node = { kind: 'rule'; selector: string; body: string } | { kind: 'at'; name: string; prelude: string; body: string | null };
function parseNodes(css: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    let depth = 0, j = i;
    for (; j < css.length; j++) {
      const c = css[j];
      if (c === '"' || c === "'") j = endOfString(css, j) - 1;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && (c === '{' || c === ';')) break;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length || css[j] === ';') {
      const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(prelude);
      if (m) nodes.push({ kind: 'at', name: m[1].toLowerCase(), prelude: m[2].trim(), body: null });
      i = j + 1;
      continue;
    }
    let level = 1, k = j + 1;
    for (; k < css.length && level > 0; k++) {
      const c = css[k];
      if (c === '"' || c === "'") k = endOfString(css, k) - 1;
      else if (c === '{') level++;
      else if (c === '}') level--;
    }
    const body = css.slice(j + 1, k - 1);
    const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(prelude);
    if (m) nodes.push({ kind: 'at', name: m[1].toLowerCase(), prelude: m[2].trim(), body });
    else nodes.push({ kind: 'rule', selector: prelude, body });
    i = k;
  }
  return nodes;
}
type Decl = { prop: string; value: string; important: boolean };
function parseDecls(body: string): Decl[] {
  return splitTop(body, ';').flatMap((d) => {
    const colon = d.indexOf(':');
    if (colon < 0) return [];
    const prop = d.slice(0, colon).trim();
    let value = d.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    return [{ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important }];
  });
}
const fmt = (ds: Decl[]) => ds.map((d) => `  ${d.prop}: ${d.value}${d.important ? ' !important' : ''};`).join('\n');

/* ───────────── deriving a source theme for a slide ───────────── */

const MODIFIER = /\.(font-(serif|sans|handwritten|typewrite)|size-(xs|sm|lg|xl)|measure-(wide|full))\b/;
const ARTICLE = /^(:where\()?\.markdown-body\)?$/;
const ARTICLE_PSEUDO = /^(:where\()?\.markdown-body\)?::?(before|after)$/;
const ARTICLE_KEEP = /^(color|font-family|font-variant[\w-]*|font-feature-settings|font-variation-settings|font-kerning|font-optical-sizing|-webkit-font-smoothing|text-rendering|hyphens|overflow-wrap|word-break|letter-spacing|word-spacing|text-align)$/;
const ROOT_DROP = /^--(markdown-body-[\w-]+|orz-measure-wide)$/;

/** clamp(min, <viewport>, max) → max (the desktop design value). */
function withoutViewport(value: string): string {
  let out = value;
  for (let guard = 0; guard < 20 && /v(w|h|min|max)\b/.test(out); guard++) {
    const m = /clamp\(/.exec(out);
    if (!m) break;
    let depth = 0, end = m.index + 6;
    for (; end < out.length; end++) {
      if (out[end] === '(') depth++;
      else if (out[end] === ')') { if (depth === 0) break; depth--; }
    }
    const a = splitTop(out.slice(m.index + 6, end), ',');
    const rep = a.length === 3 && /v(w|h|min|max)\b/.test(a[1]) ? a[2] : `__C__(${a.join(', ')})`;
    out = out.slice(0, m.index) + rep + out.slice(end + 1);
  }
  return out.replace(/__C__\(/g, 'clamp(');
}
/** rem (and, for font-size, px) → em of the source theme's body size, so the slide size scales it. */
function relative(value: string, basePx: number, fontSize: boolean): string {
  const re = fontSize ? /(-?(?:\d*\.)?\d+)(px|rem)\b/g : /(-?(?:\d*\.)?\d+)(rem)\b/g;
  return value.replace(re, (_, n: string, unit: string) => `${+((parseFloat(n) * (unit === 'rem' ? 16 : 1)) / basePx).toFixed(4)}em`);
}
function basePxOf(css: string): number {
  const m = /--base-size:\s*([\d.]+)(px|rem)/.exec(css);
  return m ? parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) : 16;
}

/**
 * `screenScope`: the source theme's `@media screen` rules are kept (unwrapped:
 * a slide is always on a screen, and its print document must look the same),
 * with `.markdown-body` rescoped to this selector — the screen notebook's
 * baseline grid of light-playful-1, which the kit's grid pass
 * (orz-markdown 2.3.0, `--orz-grid`) aligns, applied to a slide's regions.
 */
export function deriveSource(file: string, fonts: string[], o: { screenScope?: string } = {}): string {
  const raw = readFileSync(file, 'utf8');
  const basePx = basePxOf(raw);
  const scoped = (nodes: Node[], scope: string): string[] => nodes.flatMap((n) => {
    if (n.kind !== 'rule') return [];
    const sels = splitTop(n.selector, ',').map((x) => x.replace(/\.markdown-body\b/g, scope));
    const ds = parseDecls(n.body).map((d) => ({ ...d, value: relative(withoutViewport(d.value), basePx, d.prop === 'font-size') }));
    return ds.length ? [`${sels.join(',\n')} {\n${fmt(ds)}\n}`] : [];
  });
  const emit = (nodes: Node[]): string[] => {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.kind === 'rule') {
        const sels = splitTop(n.selector, ',').filter((s) => {
          if (MODIFIER.test(s)) return false;
          if (s === ':root') return true;
          if (ARTICLE_PSEUDO.test(s)) return false;
          return s.includes('markdown-body') || /^\.qrcode-overlay/.test(s);
        });
        if (!sels.length) continue;
        const inRoot = sels.length === 1 && sels[0] === ':root';
        const article = sels.every((s) => ARTICLE.test(s));
        const ds = parseDecls(n.body)
          .filter((d) => !(inRoot && ROOT_DROP.test(d.prop)))
          .filter((d) => !(d.prop === 'position' && /^(fixed|sticky)$/i.test(d.value)))
          .filter((d) => !article || ARTICLE_KEEP.test(d.prop) || d.prop.startsWith('--'))
          .map((d) => ({ ...d, value: relative(withoutViewport(d.value), basePx, d.prop === 'font-size') }));
        if (ds.length) out.push(`${sels.join(',\n')} {\n${fmt(ds)}\n}`);
        continue;
      }
      if (n.name === 'import') {
        const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)|^['"]([^'"]+)['"]/.exec(n.prelude);
        const href = url?.[1] ?? url?.[2] ?? '';
        if (/^https?:/.test(href)) fonts.push(href);
        continue;
      }
      if (n.name === 'media') {
        // narrow-screen and print: not a slide; the screen notebook only where a theme asks for it (screenScope)
        if (o.screenScope && n.body !== null && /^screen$/i.test(n.prelude.trim())) {
          const inner = scoped(parseNodes(n.body), o.screenScope);
          if (inner.length) out.push(`/* the source's @media screen rules, scoped to ${o.screenScope} */\n${inner.join('\n\n')}`);
        }
        continue;
      }
      if (n.name === 'supports' && n.body !== null) {
        const inner = emit(parseNodes(n.body));
        if (inner.length) out.push(`@supports ${n.prelude} {\n${inner.join('\n\n')}\n}`);
        continue;
      }
      if ((n.name === 'keyframes' || n.name === 'font-face') && n.body !== null) out.push(`@${n.name} ${n.prelude} {${n.body}}`);
    }
    return out;
  };
  return emit(parseNodes(stripComments(raw))).join('\n\n');
}


/* ───────────── a derived theme ───────────── */

/** Derived themes whose regions are written on the source's baseline grid (its @media screen rules kept, rescoped). */
const SCREEN_GRID: ReadonlySet<string> = new Set(['notebook']);

const IMPORT = /^@import\s+url\((['"]).*?\1\)\s*;/gm;

/** The generated stylesheet of a derived slide theme (its layer must exist). */
export function derivedTheme(id: string): string {
  const t = THEMES.find((x) => x.id === id);
  if (!t || !t.derivedFrom) throw new Error(`build-themes: ${id} is not a derived theme`);
  const fonts: string[] = [];
  const common = deriveSource(join(MD_THEMES, 'common.css'), fonts);
  const source = deriveSource(join(MD_THEMES, `${t.derivedFrom}.css`), fonts, SCREEN_GRID.has(id) ? { screenScope: '.reveal .orz-region > .markdown-body' } : {});
  const layer = readFileSync(join(LAYER_DIR, `${id}.css`), 'utf8');
  const layerImports = layer.match(IMPORT) ?? [];
  const mdVersion = (JSON.parse(readFileSync(join(MD_THEMES, '..', 'package.json'), 'utf8')) as { version: string }).version;
  return [
    `/* orz-slides theme "${id}" (${t.name}) — GENERATED by scripts/build-themes.ts from orz-markdown ${mdVersion} ${t.derivedFrom}.css; edit assets/themes/layers/${id}.css instead. */`,
    ...[...new Set(fonts)].map((f) => `@import url('${f}');`),
    ...layerImports,
    `/* ===== orz-markdown common.css (structure, adapted to a slide) ===== */`,
    common,
    `/* ===== orz-markdown ${t.derivedFrom}.css (decoration, adapted to a slide) ===== */`,
    source,
    `/* ===== layers/slide-scale.css ===== */`,
    readFileSync(join(LAYER_DIR, 'slide-scale.css'), 'utf8').trim(),
    `/* ===== layers/${id}.css (the slide layer) ===== */`,
    layer.replace(IMPORT, '').trim(),
  ].join('\n\n') + '\n';
}

/** The generated stylesheet of an updated theme (layers/content.css + its layer). */
export function updatedTheme(id: string): string {
  const t = THEMES.find((x) => x.id === id);
  if (!t || t.derivedFrom) throw new Error(`build-themes: ${id} is not an updated theme`);
  const content = readFileSync(join(LAYER_DIR, 'content.css'), 'utf8');
  const layer = readFileSync(join(LAYER_DIR, `${id}.css`), 'utf8');
  return [
    `/* orz-slides theme "${id}" (${t.name}) — GENERATED by scripts/build-themes.ts (an updated 0.x theme: no source theme); edit assets/themes/layers/${id}.css instead. */`,
    ...(layer.match(IMPORT) ?? []),
    `/* ===== layers/content.css (Markdown content in theme tokens) ===== */`,
    content.trim(),
    `/* ===== layers/${id}.css (the theme) ===== */`,
    layer.replace(IMPORT, '').trim(),
  ].join('\n\n') + '\n';
}

/** The stylesheet of any theme. */
export function themeCss(id: string): string {
  const t = THEMES.find((x) => x.id === id);
  if (!t) throw new Error(`build-themes: unknown theme ${id}`);
  return t.derivedFrom ? derivedTheme(id) : updatedTheme(id);
}

/** The themes built: every theme of src/themes.ts (a missing layer is an error). */
export function builtThemes(): string[] {
  for (const t of THEMES) if (!existsSync(join(LAYER_DIR, `${t.id}.css`))) throw new Error(`build-themes: no layer for theme ${t.id} (assets/themes/layers/${t.id}.css)`);
  return THEMES.map((t) => t.id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const id of builtThemes()) {
    const file = join(THEME_DIR, `${id}.css`);
    const css = themeCss(id);
    const same = existsSync(file) && readFileSync(file, 'utf8') === css;
    if (check) { if (!same) { stale++; console.error(`stale: assets/themes/${id}.css`); } continue; }
    if (!same) writeFileSync(file, css, 'utf8');
    console.log(`${same ? 'unchanged' : 'wrote'} assets/themes/${id}.css (${(css.length / 1024).toFixed(1)} KiB)`);
  }
  if (stale) process.exit(1);
}
