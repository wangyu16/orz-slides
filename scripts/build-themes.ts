/**
 * Builds the 14 slide themes the engine carries (REBUILD §3c steps 3–4).
 *
 *   npx tsx scripts/build-themes.ts           write the generated files
 *   npx tsx scripts/build-themes.ts --check   exit 1 when a generated file is stale
 *
 * Both exit 1 when a theme breaks the CONTRACT (closed-loop round A,
 * {@link contractProblems}; docs/dom-contract.md §5, §7): a new or ported
 * theme cannot silently drop what decks need — the variant tokens, six chart
 * colours and the diagram tokens, a single-line footer, boxes that keep
 * their clip.
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
import { TEMPLATES } from '../src/deck/parse.js';

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

/* ───────────── the theme contract (closed-loop round A: TK-1, TK-4, TK-5) ───────────── */

/** The custom properties a built theme must define (docs/dom-contract.md §5). */
export const REQUIRED_TOKENS: readonly string[] = Object.freeze([
  '--sl-accent', '--sl-accent-ink',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-text', '--chart-font-size',
  '--mm-text', '--mm-line', '--mm-node', '--mm-border', '--mm-font-size',
]);

/** The rules of a stylesheet, flattened (an @media/@supports block's rules included): selector and declarations. */
function rulesOf(css: string): Array<{ selector: string; decls: Decl[] }> {
  const out: Array<{ selector: string; decls: Decl[] }> = [];
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (n.kind === 'rule') out.push({ selector: n.selector, decls: parseDecls(n.body) });
      else if ((n.name === 'media' || n.name === 'supports') && n.body !== null) walk(parseNodes(n.body));
    }
  };
  walk(parseNodes(stripComments(css)));
  return out;
}

/**
 * What a theme breaks of the contract (empty: nothing). `deck` is deck.css
 * (the engine's structure, shared by every theme), `layer` the theme's own
 * layer, `built` its generated stylesheet:
 * - the built theme defines every {@link REQUIRED_TOKENS} token (the template
 *   variants' accent and its ink; six chart colours; the diagram tokens);
 * - deck.css draws every variant of every template (`TEMPLATES`, v=2…n:
 *   a rule naming the template and the variant);
 * - the footer is one line: deck.css sets `white-space: nowrap` on the
 *   footer's text and no layer sets another `white-space` / `text-wrap` there;
 * - no layer gives a box (`.orz-region`, `.orz-template`) `overflow: visible`
 *   or `hidden` (fit and the clip margin need `clip`), nor the title band
 *   `overflow(-x): visible`.
 * Round A2 (A2-TH-14) checks VALUES, not presence: each chart colour is a
 * colour, the six pairwise ΔE ≥ 18 and ≥ 10 for a protan, deutan and
 * tritan reader; the accent and cover inks read ≥ 4.5 : 1 on them; a
 * variant rule names its template and variant in one compound; a layer rule
 * that can reach the footer's text and outranks deck.css's one-line rule
 * may not let it wrap.
 */
export function contractProblems(id: string, css: { deck: string; layer: string; built: string }): string[] {
  const problems: string[] = [];
  const builtRules = rulesOf(css.built);
  const defined = new Set<string>();
  for (const r of builtRules) for (const d of r.decls) if (d.prop.startsWith('--')) defined.add(d.prop);
  for (const t of REQUIRED_TOKENS) if (!defined.has(t)) problems.push(`${id}: the token ${t} is not set`);
  // the tokens' VALUES (round A2, A2-TH-14: presence alone let an empty, a duplicate or an unreadable value through)
  const value = tokenValues(builtRules);
  const chart: Array<number[] | null> = [];
  for (let i = 1; i <= 6; i++) {
    const v = value(`--chart-${i}`);
    if (v === undefined) continue;
    const c = colourOf(v);
    if (c === 'unknown') { chart.push(null); continue; }
    if (c === null) { problems.push(`${id}: --chart-${i} is not a colour ("${v}")`); chart.push(null); continue; }
    chart.push(c);
  }
  for (let a = 0; a < chart.length; a++) for (let b = a + 1; b < chart.length; b++) {
    const x = chart[a];
    const y = chart[b];
    if (!x || !y) continue;
    const n = deltaE(x, y);
    if (n < 18) problems.push(`${id}: --chart-${a + 1} and --chart-${b + 1} are too alike (ΔE ${n.toFixed(1)} < 18)`);
    for (const [k, m] of Object.entries(CVD)) {
      const d = deltaE(simulate(x, m), simulate(y, m));
      if (d < 10) problems.push(`${id}: --chart-${a + 1} and --chart-${b + 1} merge for a ${k} reader (ΔE ${d.toFixed(1)} < 10)`);
    }
  }
  for (const [bg, ink] of [['--sl-accent', '--sl-accent-ink'], ['--sl-cover', '--sl-cover-ink']] as const) {
    const a = value(bg);
    const b = value(ink);
    if (a === undefined || b === undefined) continue;
    const x = colourOf(a);
    const y = colourOf(b);
    if (Array.isArray(x) && Array.isArray(y) && contrastOf(x, y) < 4.5) problems.push(`${id}: ${ink} on ${bg} reads ${contrastOf(x, y).toFixed(2)} : 1 (< 4.5)`);
  }
  const deckRules = rulesOf(css.deck);
  for (const [template, n] of Object.entries(TEMPLATES)) {
    for (let v = 2; v <= n; v++) {
      // the template and the variant in ONE compound of one selector (an :is() list expanded), not anywhere in the rule
      const drawn = deckRules.some((r) => r.decls.length > 0 && plainSelectors(r.selector).some((sel) => compounds(sel).some((c) => c.includes(`[data-template="${template}"]`) && c.includes(`[data-v="${v}"]`))));
      if (!drawn) problems.push(`deck.css: the ${template} template's variant v=${v} has no rule`);
    }
  }
  const footerRule = deckRules.find((r) => /\.orz-footer\b/.test(r.selector) && r.decls.some((d) => d.prop === 'white-space' && d.value === 'nowrap') && r.decls.some((d) => d.prop === 'text-overflow' && d.value === 'ellipsis'));
  if (!footerRule) problems.push('deck.css: the footer is not one ellipsized line');
  const footerSpec = footerRule ? Math.min(...plainSelectors(footerRule.selector).filter((x) => /\.orz-footer\b/.test(x)).map(specificity)) : 0;
  for (const r of rulesOf(css.layer)) {
    const sels = splitTop(r.selector, ',');
    const wraps = r.decls.some((d) => (d.prop === 'white-space' && d.value !== 'nowrap') || ((d.prop === 'text-wrap' || d.prop === 'text-wrap-mode') && !/nowrap/.test(d.value)));
    // a rule that can reach the footer's text: it names the footer or the chrome, or it is an unscoped text rule
    // (`.reveal .markdown-body p`) — and outranks deck.css's one-line rule
    const reaches = (x: string): boolean => /\.orz-(footer|chrome)\b/.test(x) || (!/\.orz-(region|template|float|title|head|outline|section|qr|print)|\b(pre|code|td|th|table|li|blockquote|h[1-6])\b|\.(katex|mermaid|hljs)/.test(x) && /(^|[\s>+~])(p|span|div|\*|\.markdown-body)\s*$/.test(x));
    if (wraps && plainSelectors(r.selector).some((x) => reaches(x) && (/\.orz-footer\b/.test(x) || specificity(x) >= footerSpec))) problems.push(`${id}: "${r.selector}" lets the footer wrap`);
    if (sels.some((x) => /\.orz-(region|template)\s*$/.test(x)) && r.decls.some((d) => /^overflow(-[xy])?$/.test(d.prop) && /^(visible|hidden)$/.test(d.value))) problems.push(`${id}: "${r.selector}" sets overflow on a box (fit needs clip)`);
    // the title band clips across (overflow-x: clip) and grows down: a layer must not make it visible across
    if (sels.some((x) => /\.orz-title\s*$/.test(x)) && r.decls.some((d) => (d.prop === 'overflow' || d.prop === 'overflow-x') && /^visible/.test(d.value))) problems.push(`${id}: "${r.selector}" lets the title band overflow across (it clips on x)`);
  }
  return problems;
}

/* ── the contract's value checks (round A2): token values, colours, specificity ── */

/** The value of a custom property in a built theme: its LAST declaration (any selector), var() resolved; undefined when not set. */
function tokenValues(rules: ReturnType<typeof rulesOf>): (name: string) => string | undefined {
  const last = new Map<string, string>();
  for (const r of rules) for (const d of r.decls) if (d.prop.startsWith('--')) last.set(d.prop, d.value.trim());
  const resolve = (v: string, depth: number): string => v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))*[^()]*))?\)/g, (_m, n: string, fb?: string) => {
    if (depth > 8) return '';
    const x = last.get(n);
    return x !== undefined ? resolve(x, depth + 1) : (fb !== undefined ? resolve(fb.trim(), depth + 1) : '');
  });
  return (name) => { const v = last.get(name); return v === undefined ? undefined : resolve(v, 0).trim(); };
}

/** A CSS colour → [r, g, b] (hex, rgb()), null when it is no colour (empty, `initial`, a length), 'unknown' when it cannot be read here (color-mix, oklch …). */
function colourOf(v: string): number[] | null | 'unknown' {
  const s = v.trim().toLowerCase();
  if (s === '' || /^(initial|inherit|unset|revert|none|transparent)$/.test(s) || /^-?[\d.]+(px|em|%)?$/.test(s)) return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1].length <= 4 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map(Number);
  return 'unknown';
}

const lin = (v: number): number => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const gam = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function labOf(rgb: number[]): number[] {
  const [r, g, b] = rgb.map(lin);
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIE76 ΔE of two sRGB colours. */
export function deltaE(a: number[], b: number[]): number { const p = labOf(a), q = labOf(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
/** Colour-vision deficiency simulation (Machado, Oliveira & Fernandes 2009, severity 1), in linear RGB. */
export const CVD: Readonly<Record<'protan' | 'deutan' | 'tritan', number[][]>> = Object.freeze({
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
});
export function simulate(rgb: number[], m: number[][]): number[] { const l = rgb.map(lin); return m.map((row) => gam(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])))); }
function contrastOf(a: number[], b: number[]): number {
  const L = (c: number[]): number => { const [r, g, bl] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A selector list with every :is()/:where() expanded into its alternatives (one level per pass). */
function plainSelectors(selector: string): string[] {
  let out = splitTop(selector, ',').map((x) => x.trim());
  for (let pass = 0; pass < 4; pass++) {
    const next: string[] = [];
    let changed = false;
    for (const sel of out) {
      const at = sel.search(/:(is|where)\(/);
      if (at < 0) { next.push(sel); continue; }
      const open = sel.indexOf('(', at);
      let depth = 0;
      let close = -1;
      for (let i = open; i < sel.length; i++) { if (sel[i] === '(') depth++; else if (sel[i] === ')' && --depth === 0) { close = i; break; } }
      if (close < 0) { next.push(sel); continue; }
      for (const alt of splitTop(sel.slice(open + 1, close), ',')) next.push(sel.slice(0, at) + alt.trim() + sel.slice(close + 1));
      changed = true;
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

/** The compound selectors of a plain selector (split at combinators). */
function compounds(sel: string): string[] {
  return sel.replace(/\s*([>+~])\s*/g, ' ').split(/\s+(?![^[]*\])/).filter((x) => x !== '');
}

/** A plain selector's specificity as one number (ids × 10000 + classes/attributes/pseudo-classes × 100 + types). */
function specificity(sel: string): number {
  const s = sel.replace(/\[[^\]]*\]/g, () => '.a').replace(/::[\w-]+/g, ' t').replace(/:(?:not|has)\(([^)]*)\)/g, ' $1');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|:[\w-]+/g) ?? []).length;
  const types = (s.replace(/[#.:][\w-]+/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

/** The contract problems of every built theme (as {@link themeCss} would write it). */
export function allContractProblems(): string[] {
  const deck = readFileSync(join(THEME_DIR, 'deck.css'), 'utf8');
  return builtThemes().flatMap((id) => contractProblems(id, { deck, layer: readFileSync(join(LAYER_DIR, `${id}.css`), 'utf8'), built: themeCss(id) }));
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
  const broken = allContractProblems();
  for (const p of broken) console.error(`contract: ${p}`);
  if (stale || broken.length) process.exit(1);
}
