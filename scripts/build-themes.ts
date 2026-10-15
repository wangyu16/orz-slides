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

/**
 * Derived themes whose regions are written on the source's baseline grid (its @media screen rules kept, rescoped):
 * none since the owner's decision of 2026-10-14 — Notebook's ruling is the slide's background, independent of the
 * content (no text aligned to it, no ruled sheet for a shrunk region); the kept mechanism takes a theme again only by
 * a new decision.
 */
const SCREEN_GRID: ReadonlySet<string> = new Set([]);

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

/** The stylesheet of any theme: its parts, then its generated surround ({@link surroundOf}). */
export function themeCss(id: string): string {
  const t = THEMES.find((x) => x.id === id);
  if (!t) throw new Error(`build-themes: unknown theme ${id}`);
  const css = t.derivedFrom ? derivedTheme(id) : updatedTheme(id);
  const s = surroundOf(css, t.scheme);
  if (!s) return css; // the contract reports it (no readable slide colour or designed tint)
  const why = t.scheme === 'dark'
    ? `the theme's scheme is dark — src/themes.ts — so the page around the slide is a SOFT\n   dark of the slide's own hue: the slide ${s.tone} at OKLCH L ${s.toneL.toFixed(3)} → ${s.hex} at L ${s.L.toFixed(3)}`
    : `the theme's scheme is light — src/themes.ts — so the page around the slide is the\n   layer's designed tint --sl-viewport ${s.hex} (OKLCH L ${s.L.toFixed(3)}) around the slide ${s.tone}`;
  return css + '\n' + [
    `/* ===== the surround (GENERATED: ${why}; ΔE ${s.dE.toFixed(1)}; docs/dom-contract.md §5) ===== */`,
    `:root {`,
    ...(t.scheme === 'dark' ? [`  --sl-viewport: ${s.hex};`] : []),
    `  --sl-surround: ${s.hex};`,
    `}`,
  ].join('\n') + '\n';
}

/* ───────────── the surround (owner revision 2026-10-15) ───────────── */

/**
 * THE RULE: a dark theme's surround — the page around the slide in the read
 * view, Present, overview, the letterbox, the speaker view's panes and the
 * editor's stage and live card — is a SOFT dark derived from the slide's
 * colour (`--sl-tone`, else `--sl-bg`) in OKLCH: the slide's hue, its chroma
 * capped at 0.03, and one step of lightness toward the soft-dark band's
 * middle — a near-black slide (L < 0.245) gets a LIGHTER surround,
 * L + 0.07 inside [0.24, 0.30]; a lighter dark slide a DARKER one, L − 0.06,
 * at least 0.22. So the surround is never near black, never light, and the
 * slide's edge shows (the contract checks the band and ΔE ≥ 3).
 */
export function surroundRule(tone: number[]): number[] {
  const [l, c, h] = oklchOf(tone);
  const L = l < 0.245 ? Math.min(0.30, Math.max(0.24, l + 0.07)) : Math.max(0.22, l - 0.06);
  return rgbOfOklch([L, Math.min(c, 0.03), h]);
}

const hexOf = (rgb: number[]): string => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * A theme's slide colour (`--sl-tone`, else `--sl-bg`, resolved) and its surround: a dark theme's made by
 * {@link surroundRule}, a light theme's its layer's designed tint (`--sl-viewport`); null when either is not a
 * readable colour.
 */
export function surroundOf(css: string, scheme: 'light' | 'dark'): { tone: string; toneL: number; hex: string; L: number; dE: number } | null {
  const value = tokenValues(rulesOf(css));
  const v = value('--sl-tone') ?? value('--sl-bg');
  const c = v === undefined ? null : colourOf(v);
  if (!Array.isArray(c)) return null;
  let out: number[];
  if (scheme === 'dark') out = surroundRule(c);
  else {
    const vp = value('--sl-viewport');
    const x = vp === undefined ? null : colourOf(vp);
    if (!Array.isArray(x)) return null;
    out = x;
  }
  return { tone: hexOf(c), toneL: oklchOf(c)[0], hex: hexOf(out), L: oklchOf(out)[0], dE: deltaE(c, out) };
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
  // round A3 (A3-TH-1): a rule that sets the metrics or layout of a paragraph BY the image it holds (`p:has(> img)`,
  // `p > img`) also reaches a sentence with an inline icon and a caption written above its picture — five themes set
  // their line height to 0; a picture is `p.orz-pic` (the engine marks it)
  // round A4 (A4-TH-5): any property but a cosmetic one is refused (the font shorthand, flex, overflow, aspect-ratio,
  // text-indent … sized it too); only a selector one of whose own compounds is p.orz-pic / p.orz-pics is exempt (not
  // one that merely names it, `:not(.orz-pic)`); img in any case, and [src]
  const own = (x: string): string => x.replace(/:not\((?:[^()]|\([^()]*\))*\)/gi, '');
  const isPicture = (x: string): boolean => /\.orz-pics?\b/.test(own(x));
  const IMG = /(\bimg\b|\[\s*src\b)/i;
  const byImage = (x: string): boolean => !isPicture(x) && (new RegExp(`:has\\([^)]*${IMG.source}`, 'i').test(x) || /\bp\s*>\s*img\b|\bp\s+img\b/i.test(x));
  const COSMETIC = /^(border(-[\w-]+)?|border-radius|box-shadow|outline(-[\w-]+)?|filter|opacity|background(-[\w-]+)?|--[\w-]+)$/;
  // an image made a block by the image alone (`.markdown-body img { display: block }`, A4-TH-2) breaks a linked icon's sentence too
  const GENERIC = /^(\.reveal|\.markdown-body|\.orz-(region|slide|box|content|float|frame)|p|a|li|td|th|ul|ol|blockquote|div|span)$/i;
  const subjectImg = (x: string): boolean => { const c = compounds(own(x)); return c.length > 0 && /^img$/i.test(c[c.length - 1]) && c.slice(0, -1).every((k) => GENERIC.test(k)); };
  for (const [where, text] of [[id, css.layer], ['deck.css', css.deck]] as const) {
    for (const r of rulesOf(text)) {
      const sels = splitTop(r.selector, ',');
      if (sels.some(byImage) && r.decls.some((d) => !COSMETIC.test(d.prop))) problems.push(`${where}: "${r.selector}" sizes a paragraph by the image it holds (a sentence with an icon too): use p.orz-pic`);
      else if (sels.some(subjectImg) && r.decls.some((d) => d.prop === 'display' && /^(block|flex|grid|table)/.test(d.value))) problems.push(`${where}: "${r.selector}" makes every image a block (a linked icon breaks its sentence): use p.orz-pic`);
    }
  }
  // round B (GUI-7): a theme that frames a picture (p.orz-pic, or its image) frames each picture of a row too (p.orz-pics)
  const FRAME = /^(border(-[\w-]+)?|box-shadow|outline(-[\w-]+)?|background(-color)?|padding(-[\w-]+)?)$/;
  const framesSingle = rulesOf(css.layer).some((r) => splitTop(r.selector, ',').some((x) => /p\.orz-pic\b(?!s)/.test(own(x)) && !/::(before|after)/.test(x)) && r.decls.some((d) => FRAME.test(d.prop) && !/^(none|0|transparent)$/.test(d.value.trim())));
  const framesRow = rulesOf(css.layer).some((r) => splitTop(r.selector, ',').some((x) => /p\.orz-pics\b/.test(own(x)) && /\bimg\b/.test(x)) && r.decls.some((d) => /^(border(-[\w-]+)?|box-shadow|outline(-[\w-]+)?)$/.test(d.prop) && !/^(none|0)$/.test(d.value.trim())));
  if (framesSingle && !framesRow) problems.push(`${id}: a picture (p.orz-pic) is framed but the pictures of a row (p.orz-pics img) are not`);
  // the surround (owner revision and decision 2026-10-15): every theme has one --sl-surround, generated — a dark theme's from
  // its slide colour, in the soft-dark band; a light one's its layer's designed tint, in the light band; the edge visible; the scheme of src/themes.ts agrees with the slide colour where it can be read
  const scheme = THEMES.find((x) => x.id === id)?.scheme;
  const layerSets = (name: string): boolean => rulesOf(css.layer).some((r) => r.decls.some((d) => d.prop === name));
  const toneV = value('--sl-tone') ?? value('--sl-bg');
  const tone = toneV === undefined ? null : colourOf(toneV);
  if (Array.isArray(tone)) {
    const L = oklchOf(tone)[0];
    if (scheme === 'dark' && L >= 0.5) problems.push(`${id}: the scheme is dark but the slide colour ${hexOf(tone)} is light (OKLCH L ${L.toFixed(3)})`);
    if (scheme === 'light' && L < 0.5) problems.push(`${id}: the scheme is light but the slide colour ${hexOf(tone)} is dark (OKLCH L ${L.toFixed(3)})`);
  }
  if (layerSets('--sl-surround')) problems.push(`${id}: the layer sets --sl-surround (the surround is generated: a dark theme's from its slide colour, a light theme's from its --sl-viewport)`);
  if (scheme === 'dark' && layerSets('--sl-viewport')) problems.push(`${id}: the layer sets --sl-viewport (a dark theme's surround is generated from its slide colour)`);
  if (!Array.isArray(tone)) problems.push(`${id}: the surround needs a readable slide colour (set --sl-tone to the slide's base colour)`);
  else {
    const sv = value('--sl-surround');
    const vv = value('--sl-viewport');
    const s = sv === undefined ? null : colourOf(sv);
    if (!Array.isArray(s)) problems.push(`${id}: no generated surround (--sl-surround)`);
    else {
      const [L, C] = oklchOf(s);
      const band = scheme === 'dark' ? SURROUND_BAND : SURROUND_LIGHT_BAND;
      const kind = scheme === 'dark' ? 'soft-dark' : 'light';
      if (L < band[0] || L > band[1]) problems.push(`${id}: the surround ${hexOf(s)} is outside the ${kind} band (OKLCH L ${L.toFixed(3)}, not in [${band.join(', ')}])`);
      if (C > 0.04) problems.push(`${id}: the surround ${hexOf(s)} is not a low-chroma ${scheme === 'dark' ? 'dark' : 'tint'} (C ${C.toFixed(3)} > 0.04)`);
      const d = deltaE(s, tone);
      if (d < 3) problems.push(`${id}: the slide's edge does not show on the surround (ΔE ${d.toFixed(1)} < 3 between ${hexOf(tone)} and ${hexOf(s)})`);
      if (scheme === 'dark' && hexOf(s) !== hexOf(surroundRule(tone))) problems.push(`${id}: the surround ${hexOf(s)} is not the rule's ${hexOf(surroundRule(tone))}`);
      const vc = vv === undefined ? null : colourOf(vv);
      if (!Array.isArray(vc) || hexOf(vc) !== hexOf(s)) problems.push(`${id}: --sl-viewport (${vv}) is not the surround (${sv})`);
    }
  }
  // round A4 (A4-TH-3): a section number drawn by ::after needs its own guard for section_numbers: none (deck.css
  // hides an empty ::before for every theme)
  const layerRules = rulesOf(css.layer);
  const numberAfter = layerRules.some((r) => /\.orz-section-main\b[^,]*::after/.test(r.selector) && !/\[data-sec=""\]/.test(r.selector) && r.decls.some((d) => d.prop === 'content' && /attr\(\s*data-sec\s*\)/.test(d.value)));
  const guarded = layerRules.some((r) => /\.orz-section-main\[data-sec=""\]::after/.test(r.selector) && r.decls.some((d) => d.prop === 'display' && d.value.startsWith('none')));
  if (numberAfter && !guarded) problems.push(`${id}: the section number on .orz-section-main::after has no [data-sec=""] guard (section_numbers: none draws an empty badge)`);
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
/** sRGB (0–255) → OKLCH [L 0–1, C, h°] (Björn Ottosson's OKLab). */
export function oklchOf(rgb: number[]): [number, number, number] {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
/** OKLCH → sRGB (0–255, rounded; clipped to the gamut — the surround's low chroma is always inside it). */
export function rgbOfOklch([L, C, H]: number[]): number[] {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
    .map((v) => Math.round(Math.min(255, Math.max(0, gam(Math.max(0, v))))));
}
/** The soft-dark band a dark theme's surround must lie in (OKLCH L; owner revision 2026-10-15). */
export const SURROUND_BAND: readonly [number, number] = Object.freeze([0.18, 0.32]) as unknown as readonly [number, number];
/** The band a light theme's surround (its designed tint) must lie in (OKLCH L; owner decision 2026-10-15). */
export const SURROUND_LIGHT_BAND: readonly [number, number] = Object.freeze([0.85, 0.99]) as unknown as readonly [number, number];
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
