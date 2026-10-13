/**
 * `parseDeck` — a format-1 `slides` text → {@link Deck} (FC-18 §7.2,
 * REBUILD §3c step 2).
 *
 * Markers are found with the kit's TOKEN SCANNER (the orz-markdown parser:
 * the same tokens the renderer sees, as orz-paged finds its element blocks):
 * a marker is a TOP-LEVEL HTML-comment block (`html_block` at nesting level
 * 0) — never inside a fence, indented code, a code span, a list, a
 * blockquote, a container or a multi-line directive (corpus
 * `markers-in-code`; the 0.8.5 bug of STATUS D-47: a `<!-- slide` typed in a
 * fence split the deck). Indentation of up to three spaces is allowed (as in
 * the kit's title chain, FC-18 §8.1).
 *
 * - The deck config is the FC-18 header (src/deck/config.ts); a
 *   `<!-- deck … -->` block renders nothing and is the lint `deck-block`
 *   (error, next: `upgrade`) — never a second config source.
 * - Text before the first slide marker is kept and noticed
 *   (`text-before-first-slide`).
 * - Slide options are validated: an unknown option is `unknown-option`, a
 *   bad value `invalid-option`; a bare word that is no layout is
 *   `unknown-layout`.
 * - Regions: a region the layout lacks is `unknown-region`; a name marked
 *   twice is `duplicate-region` and a region filled both by the slide's
 *   leading text and by its own marker is `region-twice` (both errors,
 *   owner decision 6; nothing is lost — the contents are joined in order).
 * - Headings (normal slides, 0.x rules): a slide that begins with an h2
 *   has it as its title; one that does not is `no-title`, a WARNING (owner
 *   default 2026-10-13: image-only slides are normal); no h1
 *   (`h1-on-slide`) and no second h2 (`second-h2`) outside the speaker
 *   notes (errors).
 *
 * Every lint carries its line and offsets. Pure apart from the parser
 * instance (created once, on first use): no DOM, no Node built-ins, no clock.
 */
import { kitParser, readHeader } from 'orz-markdown/carrier';
import type { Deck, FloatGeom, FloatRegion, LayoutNode, Region, RegionSource, Slide, SlideLint, SlideOptions, Span, TemplateName } from '../types.js';
import { deckConfig } from './config.js';
import { DEFAULT_REGION, firstLeaf, leaf, leaves, parseLayoutSpec, RESERVED_REGIONS } from './layout-spec.js';

/** A markdown-it token of the kit's parser (the kit's `KitToken` is a narrower view: it lacks `nesting`). */
export type Token = ReturnType<ReturnType<typeof kitParser>['parse']>[number];

/**
 * The tokens of a text from the kit's parser (`kitParser()`, orz-markdown
 * 2.4.0: the parser `readDocument` and the kit's lints use, private to the
 * kit — a host's `md.use()` cannot change what a deck is), so one parse
 * serves `parseDeck` and `readDocument({ tokens })`.
 */
export function deckTokens(text: string): Token[] {
  return kitParser().parse(text, {});
}

/** A slide marker comment: `<!-- slide [args] -->`, args possibly over several lines. */
const SLIDE_MARKER = /^[ \t]*<!--\s*slide\b([\s\S]*?)-->([\s\S]*)$/;
/** A region marker comment: `<!-- @name [attrs] -->`. */
const REGION_MARKER = /^[ \t]*<!--\s*@([A-Za-z0-9_-]+?)(?:\s+([\s\S]*?))?\s*-->([\s\S]*)$/;
/** The retired 0.x deck block. */
const DECK_BLOCK = /^[ \t]*<!--\s*deck\b/;
/** Any HTML comment block (not content for the title rule). */
const COMMENT_BLOCK = /^[ \t]*<!--[\s\S]*-->\s*$/;

/** The template slides and their variant counts (`v=1…n`). */
export const TEMPLATES: Readonly<Record<TemplateName, number>> = Object.freeze({ title: 6, section: 4, outline: 3, closing: 3 });

/** The slide options of FC-18 §7.2 (+ `here`, Q4). */
export const SLIDE_OPTIONS: readonly string[] = Object.freeze(['bg', 't', 'fit', 'class', 'id', 'template', 'v', 'here']);

/** The reveal transitions (`t=`, header `transition`): a name, optionally with `-in` / `-out`, or two such words. */
export const TRANSITION = /^(?:none|fade|slide|convex|concave|zoom)(?:-in|-out)?(?: (?:none|fade|slide|convex|concave|zoom)(?:-in|-out)?)?$/;

/** A float length (`58%`, `300px`, `2.5em`, `0`). */
const LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|vw|vh)?$/;
const FLOAT_KEYS: Readonly<Record<string, keyof FloatGeom>> = Object.freeze({ left: 'left', right: 'right', top: 'top', bottom: 'bottom', w: 'w', width: 'w', h: 'h', height: 'h', z: 'z' });

/* ───────────────────────── lines ───────────────────────── */

/** Line starts and content ends of a text (lines end at LF, CR LF or CR — the parser's lines). */
interface Lines {
  starts: number[];
  ends: number[];
  length: number;
}

function linesOf(text: string): Lines {
  const starts = [0];
  const ends: number[] = [];
  const re = /\r\n|\r|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ends.push(m.index);
    starts.push(m.index + m[0].length);
  }
  ends.push(text.length);
  return { starts, ends, length: text.length };
}

/** The span of lines [a, b) (0-based); an empty range is an empty span at line a's start. */
function spanOf(L: Lines, a: number, b: number): Span {
  const n = L.starts.length;
  if (b <= a) {
    const at = a < n ? L.starts[a] : L.length;
    return { from: at, to: at, line: Math.min(a, n - 1) + 1, endLine: Math.min(a, n - 1) + 1 };
  }
  return { from: L.starts[a], to: L.ends[Math.min(b, n) - 1], line: a + 1, endLine: Math.min(b, n) };
}

/** The Markdown of a span: line endings as LF, blank lines around it removed. */
function markdownOf(text: string, s: Span): string {
  const lines = text.slice(s.from, s.to).split(/\r\n|\r|\n/);
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b).join('\n');
}

/* ───────────────────────── markers ───────────────────────── */

interface Marker {
  type: 'slide' | 'region' | 'deck';
  /** 0-based first and past-last line. */
  start: number;
  end: number;
  /** Slide args or region attrs. */
  args: string;
  /** Region name (as written). */
  name?: string;
  /** Text after `-->` on the marker's last line. */
  trailing: string;
}

/** The top-level comment-block markers of a text, in order (the token scanner). */
function markersOf(tokens: readonly Token[], from: number): Marker[] {
  const out: Marker[] = [];
  for (const t of tokens) {
    if (t.level !== 0 || t.type !== 'html_block' || !t.map || t.map[0] < from) continue;
    const c = t.content.replace(/\n$/, '');
    let m: RegExpExecArray | null;
    if ((m = SLIDE_MARKER.exec(c))) out.push({ type: 'slide', start: t.map[0], end: t.map[1], args: m[1].replace(/\s+/g, ' ').trim(), trailing: m[2].trim() });
    else if ((m = REGION_MARKER.exec(c))) out.push({ type: 'region', start: t.map[0], end: t.map[1], name: m[1], args: (m[2] ?? '').replace(/\s+/g, ' ').trim(), trailing: m[3].trim() });
    else if (DECK_BLOCK.test(c)) out.push({ type: 'deck', start: t.map[0], end: t.map[1], args: '', trailing: '' });
  }
  return out;
}

/** A marker found by {@link scanMarkers}: its kind, its span and its comment text. */
export interface ScannedMarker {
  type: 'slide' | 'region' | 'deck';
  span: Span;
  /** The comment block's text (line endings as LF). */
  content: string;
  /** Slide args or region attrs (white space collapsed). */
  args: string;
  /** Region name. */
  name?: string;
}

/**
 * Every top-level marker comment of a text (slide, region and 0.x deck
 * blocks), in order, found with the token scanner — what `parseDeck` splits
 * on. For tools that edit marker lines (upgrade, the layout ops).
 */
export function scanMarkers(text: string): ScannedMarker[] {
  const L = linesOf(text);
  const tokens = deckTokens(text);
  const contents = new Map<number, string>();
  for (const t of tokens) if (t.level === 0 && t.type === 'html_block' && t.map) contents.set(t.map[0], t.content.replace(/\n$/, ''));
  return markersOf(tokens, 0).map((m) => ({ type: m.type, span: spanOf(L, m.start, m.end), content: contents.get(m.start) ?? '', args: m.args, ...(m.name !== undefined ? { name: m.name } : {}) }));
}

/** Split marker args on white space, keeping `{ … }` groups and quoted values whole (0.x's tokenizer). */
export function tokenizeMarker(args: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let quote = '';
  for (const c of args) {
    if (quote) {
      buf += c;
      if (c === quote) quote = '';
      continue;
    }
    if ((c === '"' || c === "'") && depth === 0) {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth = Math.max(0, depth - 1);
    if (/\s/.test(c) && depth === 0) {
      if (buf) out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

const unquote = (v: string): string => (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) ? v.slice(1, -1) : v);

/** An option token: `key=value` with a key that looks like one. */
const OPTION_TOKEN = /^([A-Za-z][A-Za-z0-9_-]*)=([\s\S]*)$/;

/** What the slide marker's args say. */
export interface MarkerArgs {
  options: SlideOptions;
  /** The layout part as written. */
  layoutSpec: string;
  /** Option tokens as written, in order. */
  optionTokens: string[];
  template?: TemplateName;
  /** A `template=` value that is not a template. */
  badTemplate?: string;
  templateVariant?: number;
  problems: Array<{ level: 'error' | 'warning'; code: string; message: string }>;
}

/** Read a slide marker's args: options (validated) and the layout spec. */
export function readMarkerArgs(args: string): MarkerArgs {
  const options: SlideOptions = {};
  const optionTokens: string[] = [];
  const layout: string[] = [];
  const problems: MarkerArgs['problems'] = [];
  const seen = new Set<string>();
  let template: TemplateName | undefined;
  let badTemplate: string | undefined;
  let variant: string | undefined;
  let here: string | undefined;
  for (const tok of tokenizeMarker(args)) {
    const m = tok.startsWith('{') ? null : OPTION_TOKEN.exec(tok);
    if (tok === 'step') {
      optionTokens.push(tok);
      if (seen.has('step')) problems.push({ level: 'warning', code: 'duplicate-option', message: 'the option "step" is given twice' });
      seen.add('step');
      options.step = true;
      continue;
    }
    if (!m) {
      layout.push(tok);
      continue;
    }
    optionTokens.push(tok);
    const key = m[1];
    const value = unquote(m[2]);
    if (!SLIDE_OPTIONS.includes(key)) {
      problems.push({ level: 'error', code: 'unknown-option', message: `unknown slide option "${key}" (options: ${SLIDE_OPTIONS.join(', ')}, step)` });
      continue;
    }
    if (seen.has(key)) problems.push({ level: 'warning', code: 'duplicate-option', message: `the option "${key}" is given twice; the last one counts` });
    seen.add(key);
    const bad = (why: string): void => { problems.push({ level: 'error', code: 'invalid-option', message: `${key}=${m[2]}: ${why}` }); };
    switch (key) {
      case 'bg':
        if (value.trim() === '') bad('an empty background');
        else options.bg = value;
        break;
      case 't':
        if (TRANSITION.test(value)) options.transition = value;
        else bad('not a transition (none, fade, slide, convex, concave, zoom)');
        break;
      case 'fit':
        if (value === 'fit' || value === 'scroll' || value === 'off') options.fit = value;
        else bad('fit takes fit, scroll or off');
        break;
      case 'class':
        if (value.trim() === '') bad('an empty class');
        else options.class = value;
        break;
      case 'id':
        if (/^[A-Za-z][\w:.-]*$/.test(value)) options.id = value;
        else bad('an id is a letter followed by letters, digits, -, _, : or .');
        break;
      case 'template':
        if (Object.prototype.hasOwnProperty.call(TEMPLATES, value)) { template = value as TemplateName; badTemplate = undefined; }
        else { badTemplate = value; bad(`not a template (${Object.keys(TEMPLATES).join(', ')})`); }
        break;
      case 'v':
        variant = value;
        break;
      case 'here':
        here = value;
        break;
    }
  }
  let templateVariant: number | undefined;
  if (variant !== undefined) {
    if (!template) {
      if (badTemplate === undefined) problems.push({ level: 'error', code: 'invalid-option', message: `v=${variant}: a variant needs template=` });
    } else if (!/^[1-9]\d*$/.test(variant) || Number(variant) > TEMPLATES[template]) {
      problems.push({ level: 'error', code: 'invalid-option', message: `v=${variant}: the ${template} template has variants 1 to ${TEMPLATES[template]}` });
    } else {
      templateVariant = Number(variant);
    }
  }
  if (here !== undefined) {
    if (template !== 'outline') problems.push({ level: 'error', code: 'invalid-option', message: `here=${here}: only an outline slide (template=outline) marks a current item` });
    else if (!/^\d+$/.test(here)) problems.push({ level: 'error', code: 'invalid-option', message: `here=${here}: the item number (0 for none)` });
    else options.here = Number(here);
  }
  return { options, layoutSpec: layout.join(' '), optionTokens, ...(template ? { template } : {}), ...(badTemplate !== undefined ? { badTemplate } : {}), ...(templateVariant !== undefined ? { templateVariant } : {}), problems };
}

/** Read a float marker's attributes; problems for unknown keys and bad values. */
export function readFloatAttrs(attrs: string): { geom: FloatGeom; problems: string[] } {
  const geom: FloatGeom = {};
  const problems: string[] = [];
  for (const tok of tokenizeMarker(attrs)) {
    const m = OPTION_TOKEN.exec(tok);
    if (!m) { problems.push(`"${tok}" is not key=value`); continue; }
    const key = FLOAT_KEYS[m[1].toLowerCase()];
    const value = unquote(m[2]);
    if (!key) { problems.push(`unknown float attribute "${m[1]}" (left, right, top, bottom, w, h, z)`); continue; }
    if (key === 'z') {
      if (/^-?\d+$/.test(value)) geom.z = Number(value);
      else problems.push(`z=${m[2]}: an integer`);
    } else if (LENGTH.test(value)) geom[key] = value;
    else problems.push(`${m[1]}=${m[2]}: a length (58%, 300px, 2em)`);
  }
  return { geom, problems };
}

/* ───────────────────────── the deck ───────────────────────── */

/**
 * Parse a format-1 slides text (see the module comment). `tokens`: the
 * text's tokens from {@link deckTokens} when the caller has them (one parse
 * shared with the kit's `readDocument`).
 */
export function parseDeck(text: string, tokens: readonly Token[] = deckTokens(text)): Deck {
  const L = linesOf(text);
  const header = readHeader(text);
  // the header's last line (0-based), so markers start after it
  let bodyLine = 0;
  if (header) {
    const endLine = text.slice(0, header.end).split(/\r\n|\r|\n/).length - 1;
    bodyLine = endLine + 1;
  }
  const markers = markersOf(tokens, bodyLine);
  const lint: SlideLint[] = [];
  const at = (s: Span): Pick<SlideLint, 'line' | 'from' | 'to'> => ({ line: s.line, from: s.from, to: s.to });

  for (const m of markers) {
    if (m.type === 'deck') {
      lint.push({ level: 'error', code: 'deck-block', message: 'a <!-- deck … --> block is the 0.x deck config: in text format 1 the header is the deck config and this block renders nothing (run upgrade to move its keys into the header)', next: 'upgrade', ...at(spanOf(L, m.start, m.end)) });
    }
  }

  const slideMarkers = markers.filter((m) => m.type === 'slide');
  const firstSlideLine = slideMarkers.length > 0 ? slideMarkers[0].start : L.starts.length;
  // the preamble: anything but deck blocks and blank lines between the header and the first slide
  let preamble: Span | null = null;
  {
    const deckLines = new Set<number>();
    for (const m of markers) if (m.type === 'deck' && m.start < firstSlideLine) for (let i = m.start; i < m.end; i++) deckLines.add(i);
    let a = -1;
    let b = -1;
    for (let i = bodyLine; i < firstSlideLine && i < L.starts.length; i++) {
      if (deckLines.has(i)) continue;
      if (text.slice(L.starts[i], L.ends[i]).trim() === '') continue;
      if (a < 0) a = i;
      b = i + 1;
    }
    if (a >= 0) {
      preamble = spanOf(L, a, b);
      lint.push(slideMarkers.length > 0
        ? { level: 'warning', code: 'text-before-first-slide', message: 'text before the first slide marker is kept but never shown (move it into a slide, or into the speaker notes)', ...at(preamble) }
        : { level: 'warning', code: 'no-slides', message: 'the text has no slide marker (<!-- slide -->), so the deck has no slides', ...at(preamble) });
    }
  }

  const slides: Slide[] = [];
  for (let i = 0; i < slideMarkers.length; i++) {
    const m = slideMarkers[i];
    const end = i + 1 < slideMarkers.length ? slideMarkers[i + 1].start : L.starts.length;
    const regionMarkers = markers.filter((r) => r.type === 'region' && r.start >= m.end && r.start < end);
    const slide = parseSlide(text, L, tokens, i, m, end, regionMarkers);
    slides.push(slide);
  }
  for (const s of slides) lint.push(...s.lint);
  lint.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  return { config: deckConfig(text), slides, preamble, lint };
}

/** The first content token (a top-level block, comments skipped) whose first line is in [a, b). */
function firstContent(tokens: readonly Token[], a: number, b: number): { token: Token; index: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level !== 0 || t.nesting === -1 || !t.map) continue;
    if (t.map[0] < a) continue;
    if (t.map[0] >= b) return null;
    if (t.type === 'html_block' && COMMENT_BLOCK.test(t.content)) continue;
    return { token: t, index: i };
  }
  return null;
}

/** A slide (see parseDeck). */
function parseSlide(text: string, L: Lines, tokens: readonly Token[], index: number, m: Marker, end: number, regionMarkers: Marker[]): Slide {
  const lint: SlideLint[] = [];
  const markerSpan = spanOf(L, m.start, m.end);
  const span = spanOf(L, m.start, end);
  const at = (s: Span): Pick<SlideLint, 'line' | 'from' | 'to'> => ({ line: s.line, from: s.from, to: s.to });
  const err = (code: string, message: string, s: Span = markerSpan): void => { lint.push({ level: 'error', code, message: `slide ${index + 1}: ${message}`, ...at(s) }); };
  const warn = (code: string, message: string, s: Span = markerSpan): void => { lint.push({ level: 'warning', code, message: `slide ${index + 1}: ${message}`, ...at(s) }); };

  if (m.trailing !== '') err('marker-not-alone', `text after the slide marker on its line ("${m.trailing.slice(0, 40)}") is ignored; put it on the next line`);
  const args = readMarkerArgs(m.args);
  for (const p of args.problems) (p.level === 'error' ? err : warn)(p.code, p.message);
  const isTemplate = args.template !== undefined;

  let layout: LayoutNode = leaf(DEFAULT_REGION);
  if (isTemplate) {
    if (args.layoutSpec !== '') err('layout-on-template', `a template slide has its own layout; "${args.layoutSpec}" is ignored`);
  } else {
    const spec = parseLayoutSpec(args.layoutSpec);
    layout = spec.tree;
    for (const p of spec.problems) err(p.code, p.message);
  }
  const primary = firstLeaf(layout);
  const gridNames = leaves(layout);

  // blocks: the lead (after the marker) and one per region marker
  interface Block { marker: Marker | null; body: Span; bodyStart: number; bodyEnd: number }
  const blocks: Block[] = [];
  const leadEnd = regionMarkers.length > 0 ? regionMarkers[0].start : end;
  blocks.push({ marker: null, body: spanOf(L, m.end, leadEnd), bodyStart: m.end, bodyEnd: leadEnd });
  regionMarkers.forEach((r, k) => {
    const e = k + 1 < regionMarkers.length ? regionMarkers[k + 1].start : end;
    blocks.push({ marker: r, body: spanOf(L, r.end, e), bodyStart: r.end, bodyEnd: e });
  });

  // the title: the slide's first content (lead, then grid regions in text order) when it is an h2 (normal slides)
  let title: string | undefined;
  let titleSpan: Span | undefined;
  let titleLines: [number, number] | null = null;
  const isGridBlock = (b: Block): boolean => b.marker === null || !RESERVED_REGIONS.includes(b.marker.name!.toLowerCase());
  if (!isTemplate) {
    let first: { token: Token; index: number } | null = null;
    for (const b of blocks) {
      if (!isGridBlock(b)) continue;
      first = firstContent(tokens, b.bodyStart, b.bodyEnd);
      if (first) break;
    }
    if (first && first.token.type === 'heading_open' && first.token.tag === 'h2') {
      title = tokens[first.index + 1]?.content ?? '';
      titleLines = [first.token.map![0], first.token.map![1]];
      titleSpan = spanOf(L, titleLines[0], titleLines[1]);
    } else if (first) {
      const s = spanOf(L, first.token.map![0], first.token.map![1]);
      if (first.token.type === 'heading_open' && first.token.tag === 'h1') err('h1-on-slide', 'an h1 on a normal slide (a title page is template=title)', s);
      else warn('no-title', 'a normal slide without a title (it may begin with one h2, ## Title); an image-only slide is fine', s);
    }
  }

  // heading rules: no h1 and no second h2 on a normal slide (speaker notes excluded)
  if (!isTemplate) {
    for (const b of blocks) {
      if (b.marker && b.marker.name!.toLowerCase() === 'notes') continue;
      for (const t of tokens) {
        if (t.type !== 'heading_open' || !t.map || t.map[0] < b.bodyStart || t.map[0] >= b.bodyEnd) continue;
        if (titleLines && t.map[0] === titleLines[0]) continue;
        const s = spanOf(L, t.map[0], t.map[1]);
        if (t.tag === 'h1') { if (!lint.some((x) => x.code === 'h1-on-slide' && x.from === s.from)) err('h1-on-slide', 'an h1 on a normal slide (a title page is template=title)', s); }
        else if (t.tag === 'h2') err('second-h2', 'a normal slide has one h2, its title', s);
      }
    }
  }

  // regions, floats, notes, footer
  const regions: Region[] = [];
  const floats: FloatRegion[] = [];
  let notes: string | undefined;
  let footer: string | undefined;
  const byName = new Map<string, Region>();
  const add = (name: string, src: RegionSource, md: string): void => {
    const r = byName.get(name);
    if (r) {
      r.sources.push(src);
      if (md !== '') r.markdown = r.markdown === '' ? md : `${r.markdown}\n\n${md}`;
      return;
    }
    const n: Region = { name, markdown: md, sources: [src] };
    byName.set(name, n);
    regions.push(n);
  };
  let notesSeen = false;
  let footerSeen = false;
  for (const b of blocks) {
    // the body without the title's lines
    let body = b.body;
    let md = markdownOf(text, body);
    if (titleLines && titleLines[0] >= b.bodyStart && titleLines[0] < b.bodyEnd) {
      const before = spanOf(L, b.bodyStart, titleLines[0]);
      const after = spanOf(L, titleLines[1], b.bodyEnd);
      md = [markdownOf(text, before), markdownOf(text, after)].filter((x) => x !== '').join('\n\n');
      body = after;
    }
    if (b.marker === null) {
      if (md !== '') add(primary, { marker: null, body }, md);
      continue;
    }
    const mk = b.marker;
    const ms = spanOf(L, mk.start, mk.end);
    if (mk.trailing !== '') err('marker-not-alone', `text after the region marker on its line ("${mk.trailing.slice(0, 40)}") is ignored; put it on the next line`, ms);
    const name = mk.name!;
    const lower = name.toLowerCase();
    if (lower === 'float') {
      const { geom, problems } = readFloatAttrs(mk.args);
      for (const p of problems) err('invalid-option', `float: ${p}`, ms);
      floats.push({ geom, markdown: md, marker: ms, body: b.body });
      continue;
    }
    if (mk.args !== '') warn('ignored-attrs', `the region marker @${name} takes no attributes ("${mk.args}" is ignored; only @float has a geometry)`, ms);
    if (lower === 'notes') {
      if (notesSeen) err('duplicate-region', 'speaker notes (@notes) are marked twice; they are joined', ms);
      notes = notesSeen ? [notes, md].filter((x) => x).join('\n\n') : md;
      notesSeen = true;
      continue;
    }
    if (lower === 'footer') {
      if (footerSeen) err('duplicate-region', 'the slide footer (@footer) is marked twice; they are joined', ms);
      footer = footerSeen ? [footer, md].filter((x) => x).join('\n\n') : md;
      footerSeen = true;
      continue;
    }
    const prior = byName.get(name);
    if (prior) {
      if (prior.sources.some((s) => s.marker !== null)) err('duplicate-region', `the region "${name}" is marked twice; its contents are joined in order`, ms);
      else err('region-twice', `the region "${name}" is filled both by the slide's leading text and by its own marker; the leading text comes first`, ms);
    }
    const known = isTemplate ? name === DEFAULT_REGION : gridNames.includes(name);
    if (!known) err('unknown-region', isTemplate ? `a template slide has one region, body (and notes, footer, float); "@${name}" is not shown` : `the layout has no region "${name}" (it has ${gridNames.join(', ')}); its content is not shown`, ms);
    add(name, { marker: ms, body }, md);
  }

  const slide: Slide = {
    index,
    kind: isTemplate ? 'template' : 'normal',
    ...(args.template ? { template: args.template } : {}),
    ...(args.templateVariant !== undefined ? { templateVariant: args.templateVariant } : {}),
    ...(title !== undefined ? { title, titleSpan } : {}),
    layout,
    layoutSpec: args.layoutSpec,
    optionTokens: args.optionTokens,
    regions,
    floats,
    ...(footerSeen ? { footer } : {}),
    ...(notesSeen ? { notes } : {}),
    options: args.options,
    lint,
    raw: text.slice(L.starts[m.start], end < L.starts.length ? L.starts[end] : text.length),
    span,
    marker: markerSpan,
  };
  return slide;
}
