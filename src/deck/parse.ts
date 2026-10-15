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
 * - Marker hygiene (closed-loop round A): a marker line the grammar does not
 *   read is noticed, never silent — `marker-in-html`, `unclosed-fence`,
 *   `unclosed-container` (errors with a quick fix), `marker-lookalike` and
 *   `marker-punctuation` (warnings).
 *
 * Linear in the text (tokens indexed once, every per-slide lookup a binary
 * search over its own range) and memoised by text (a frozen result).
 *
 * Every lint carries its line and offsets. Pure apart from the parser
 * instance (created once, on first use) and the memo: no DOM, no Node
 * built-ins, no clock.
 */
import { kitParser, readHeader, type KitToken } from 'orz-markdown/carrier';
import type { Deck, FloatGeom, FloatRegion, LayoutNode, Region, RegionSource, Slide, SlideLint, SlideOptions, Span, TemplateName } from '../types.js';
import { deckConfig } from './config.js';
import { DEFAULT_REGION, firstLeaf, leaf, leaves, parseLayoutSpec, RESERVED_REGIONS } from './layout-spec.js';

/** A markdown-it token of the kit's parser (orz-markdown 2.4.0 `KitToken`: every data field, `nesting` included). */
export type Token = KitToken;

/**
 * The tokens of a text from the kit's parser (`kitParser()`, orz-markdown
 * 2.4.0: the parser `readDocument` and the kit's lints use, private to the
 * kit — a host's `md.use()` cannot change what a deck is), so one parse
 * serves `parseDeck` and `readDocument({ tokens })`.
 */
export function deckTokens(text: string): Token[] {
  if (lastTokens?.text === text) return lastTokens.tokens;
  const tokens = kitParser().parse(text, {});
  lastTokens = { text, tokens };
  return tokens;
}
/** The last text's tokens (a read and a render of the same text tokenize once; never changed by a reader). */
let lastTokens: { text: string; tokens: Token[] } | null = null;

/** A slide marker comment: `<!-- slide [args] -->`, args possibly over several lines. */
const SLIDE_MARKER = /^[ \t]*<!--\s*slide\b([\s\S]*?)-->([\s\S]*)$/;
/**
 * A region marker comment: `<!-- @name [attrs] -->`. Anything 0.x read
 * right after the name that is not a name character (`@notes:`,
 * `@right,`, `@notes:private`, `@notes(speaker)`, `@notes!` — 0.x's
 * `@name\b`) is read as the marker and noticed (`marker-punctuation`),
 * never left on the slide as text (rounds A and A2).
 */
const REGION_MARKER = /^[ \t]*<!--\s*@([A-Za-z0-9_-]+?)((?:(?!-->)[^\sA-Za-z0-9_-])(?:(?!-->)\S)*)?(?:\s+([\s\S]*?))?\s*-->([\s\S]*)$/;
/** The retired 0.x deck block: a comment whose first word is `deck` itself (not `<!-- deck-notes -->`; the kit's rule). */
const DECK_BLOCK = /^[ \t]*<!--\s*deck(?!\w|-(?!->))/;
/** A line that starts like a slide or region marker (for the markers a block swallowed). */
const MARKER_LINE = /^ {0,3}<!--\s*(?:slide\b|@[A-Za-z0-9_-])/;
/** Any HTML comment block (not content for the title rule). */
const COMMENT_BLOCK = /^[ \t]*<!--[\s\S]*-->\s*$/;

/** The template slides and their variant counts (`v=1…n`). */
export const TEMPLATES: Readonly<Record<TemplateName, number>> = Object.freeze({ title: 6, section: 4, outline: 3, closing: 3 });

/** The slide options of FC-18 §7.2 (+ `here`, Q4). */
export const SLIDE_OPTIONS: readonly string[] = Object.freeze(['bg', 't', 'fit', 'class', 'id', 'template', 'v', 'here']);

/** The reveal transitions (`t=`, header `transition`): a name, optionally with `-in` / `-out`, or two such words. */
export const TRANSITION = /^(?:none|fade|slide|convex|concave|zoom)(?:-in|-out)?(?: (?:none|fade|slide|convex|concave|zoom)(?:-in|-out)?)?$/;

/** A float length (`58%`, `300px`, `2.5em`, `2in`, `40vmin`, `0`): a number with a CSS length unit (0.x wrote any). */
const LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|ex|ch|lh|vw|vh|vmin|vmax|cm|mm|q|in|pt|pc)?$/i;
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
  /** A punctuation mark written right after a region marker's name (`@notes:`). */
  punct?: string;
}

/** The top-level comment-block markers of a text, in order (the token scanner). */
function markersOf(tokens: readonly Token[], from: number): Marker[] {
  const out: Marker[] = [];
  for (const t of tokens) {
    if (t.level !== 0 || t.type !== 'html_block' || !t.map || t.map[0] < from) continue;
    const c = t.content.replace(/\n$/, '');
    let m: RegExpExecArray | null;
    if ((m = SLIDE_MARKER.exec(c))) out.push({ type: 'slide', start: t.map[0], end: t.map[1], args: m[1].replace(/\s+/g, ' ').trim(), trailing: m[2].trim() });
    else if ((m = REGION_MARKER.exec(c))) out.push({ type: 'region', start: t.map[0], end: t.map[1], name: m[1], args: (m[3] ?? '').replace(/\s+/g, ' ').trim(), trailing: m[4].trim(), ...(m[2] ? { punct: m[2] } : {}) });
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
export function scanMarkers(text: string, o: { alone?: boolean } = {}): ScannedMarker[] {
  const L = linesOf(text);
  // `alone`: a part of a text read by itself (one slide's source: it starts at a marker, where the block parser starts afresh) — not memoised
  const tokens = o.alone ? kitParser().parse(text, {}) : deckTokens(text);
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

/**
 * The marker spellings 0.x read that format 1 does not, normalised (for
 * `upgrade`, FMT-6/FMT-7 of closed-loop round A): `key = value` and
 * `col 1 / 2` lose their spaces, option and float keys are lower-cased
 * (`BG=` → `bg=`), the punctuation 0.x let follow a region name goes
 * (`@notes:` → `@notes`), a `v=` the template has no variant for and a float
 * `z=` that is no integer are dropped (0.x showed the first look and CSS
 * ignored the z-index). Returns the new comment text and what changed, or
 * null when the marker is already format 1 (it is then never rewritten).
 */
export function normalizeMarker(content: string): { content: string; notes: string[] } | null {
  const notes: string[] = [];
  const indent = /^[ \t]*/.exec(content)![0];
  const squeeze = (args: string, at: '=' | '/'): string => {
    // outside quotes: no spaces around '=' (float markers: 0.x read `left = 50%`) or around '/' (a split's
    // track separator, at every depth: 0.x read `row 1 / 1 { a; col 1 / 2 { b; c } }`; round A2, A2-FMT-5).
    // A slide marker's `key = value` was NOT read by 0.x (its options are `key=value` tokens), so it stays
    // as written (A2-FMT-7).
    let out = '';
    let quote = '';
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (quote) { out += c; if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; out += c; continue; }
      if (c === at && out !== '') {
        out = out.replace(/\s+$/, '') + c;
        while (i + 1 < args.length && /\s/.test(args[i + 1])) i++;
        continue;
      }
      out += c;
    }
    return out.replace(/\s+/g, ' ').trim();
  };
  let m: RegExpExecArray | null;
  if ((m = SLIDE_MARKER.exec(content))) {
    const was = m[1].replace(/\s+/g, ' ').trim();
    const toks = tokenizeMarker(squeeze(m[1], '/')).map((tok) => {
      const o = tok.startsWith('{') ? null : OPTION_TOKEN.exec(tok);
      return o && o[1] !== o[1].toLowerCase() && SLIDE_OPTIONS.includes(o[1].toLowerCase()) ? `${o[1].toLowerCase()}=${o[2]}` : tok;
    });
    const read = readMarkerArgs(toks.join(' '));
    const kept = toks.filter((tok) => {
      const o = tok.startsWith('{') ? null : OPTION_TOKEN.exec(tok);
      if (o && o[1] === 'fit' && !['fit', 'scroll', 'off'].includes(unquote(o[2]))) { notes.push(`fit=${o[2]} dropped: not fit, scroll or off (0.x ignored it)`); return false; }
      if (!o || o[1] !== 'v' || read.templateVariant !== undefined) return true;
      notes.push(read.template ? `v=${o[2]} dropped: the ${read.template} template has variants 1 to ${TEMPLATES[read.template]} (0.x showed its first look for it)` : `v=${o[2]} dropped: a variant needs template= (0.x ignored it)`);
      return false;
    });
    const args = kept.join(' ');
    if (args === was && notes.length === 0) return null;
    if (notes.length === 0) notes.push(`<!-- slide ${was} --> written <!-- slide ${args} -->`);
    return { content: `${indent}<!-- slide${args ? ` ${args}` : ''} -->${m[2]}`, notes };
  }
  if ((m = REGION_MARKER.exec(content))) {
    const name = m[1];
    const was = (m[3] ?? '').replace(/\s+/g, ' ').trim();
    let args = was;
    if (name.toLowerCase() === 'float') {
      const toks = tokenizeMarker(squeeze(m[3] ?? '', '=')).flatMap((tok) => {
        const o = OPTION_TOKEN.exec(tok);
        if (!o) return [tok];
        const key = o[1].toLowerCase();
        if (key === 'z' && !/^-?\d+$/.test(unquote(o[2]))) { notes.push(`float z=${o[2]} dropped: not an integer (CSS ignored the z-index 0.x wrote)`); return []; }
        return [FLOAT_KEYS[key] ? `${key}=${o[2]}` : tok];
      });
      args = toks.join(' ');
    }
    if (args === was && !m[2] && notes.length === 0) return null;
    if (m[2]) notes.push(`@${name}${m[2]} written @${name}`);
    else if (args !== was) notes.push(`<!-- @${name} ${was} --> written <!-- @${name} ${args} -->`);
    return { content: `${indent}<!-- @${name}${args ? ` ${args}` : ''} -->${m[4]}`, notes };
  }
  return null;
}

/* ───────────────────────── the deck ───────────────────────── */

/**
 * The tokens indexed once for the per-slide lookups (FMT-8: every lookup a
 * slide makes is a binary search over its own range, so a parse is linear
 * in the text, not in slides × tokens).
 */
interface TokenIndex {
  /** Level-0 block openers (and leaves) with a map, in text order, with their token index. */
  blocks: Array<{ token: Token; index: number }>;
  blockStarts: number[];
  /** Every heading opener (any level) with a map, in text order. */
  headings: Token[];
  headingStarts: number[];
}

function indexTokens(tokens: readonly Token[]): TokenIndex {
  const blocks: TokenIndex['blocks'] = [];
  const headings: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.map) continue;
    if (t.level === 0 && t.nesting !== -1) blocks.push({ token: t, index: i });
    if (t.type === 'heading_open') headings.push(t);
  }
  return { blocks, blockStarts: blocks.map((b) => b.token.map![0]), headings, headingStarts: headings.map((h) => h.map![0]) };
}

/** The first position in a sorted array whose value is ≥ x. */
function lowerBound(a: readonly number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last parses, by text (the read view, its title and lang, the renderer and the lint ask for the same text). */
const parsed: Array<{ text: string; deck: Deck }> = [];
const PARSED_KEEP = 4;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/**
 * Parse a format-1 slides text (see the module comment). `tokens`: the
 * text's tokens from {@link deckTokens} when the caller has them (one parse
 * shared with the kit's `readDocument`). Linear in the text; the last few
 * results are memoised by text, so the result is frozen (copy it to change
 * it).
 */
export function parseDeck(text: string, tokens?: readonly Token[]): Deck {
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].text === text) {
      const hit = parsed[i];
      if (i > 0) { parsed.splice(i, 1); parsed.unshift(hit); }
      return hit.deck;
    }
  }
  // an edit of the last text (typing, a layout op): its deck derived slide by slide (closed-loop round B, OPS-10)
  const derived = !tokens && parsed.length > 0 ? deriveDeck(parsed[0].text, parsed[0].deck, text) : null;
  if (derived) PARSE_STATS.derived++; else PARSE_STATS.parsed++;
  const deck = derived ?? deepFreeze(parseDeckNow(text, tokens ?? deckTokens(text)));
  parsed.unshift({ text, deck });
  if (parsed.length > PARSED_KEEP) parsed.pop();
  return deck;
}

/** How many decks were derived from the last one and how many parsed in full (a test's view of the derivation). */
export const PARSE_STATS = { derived: 0, parsed: 0 };

/** `parseDeck` without the memo or the derivation: what a fresh parse of the text gives (the oracle of the derived deck). */
export function parseDeckFresh(text: string): Deck {
  return deepFreeze(parseDeckNow(text, kitParser().parse(text, {})));
}

/* ───────────────────────── the derived deck (closed-loop round B, OPS-10) ───────────────────────── */

/** A span moved. */
const movedSpan = (x: Span, dc: number, dl: number): Span => ({ from: x.from + dc, to: x.to + dc, line: x.line + dl, endLine: x.endLine + dl });

/** A lint moved (its quick fix too). */
function movedLint(l: SlideLint, dc: number, dl: number): SlideLint {
  const o: SlideLint = { ...l };
  if (typeof l.line === 'number') o.line = l.line + dl;
  if (typeof l.from === 'number') o.from = l.from + dc;
  if (typeof l.to === 'number') o.to = l.to + dc;
  if (l.fix) o.fix = { ...l.fix, from: l.fix.from + dc, to: l.fix.to + dc };
  return o;
}

/** A slide moved by `dc` characters and `dl` lines: new objects only where an offset is (its layout, options and texts shared). */
function movedSlide(s: Slide, dc: number, dl: number): Slide {
  const o: Slide = { ...s, span: movedSpan(s.span, dc, dl), marker: movedSpan(s.marker, dc, dl) };
  if (s.titleSpan) o.titleSpan = movedSpan(s.titleSpan, dc, dl);
  o.regions = s.regions.map((r) => ({ ...r, sources: r.sources.map((x) => ({ ...x, marker: x.marker ? movedSpan(x.marker, dc, dl) : null, body: movedSpan(x.body, dc, dl) })) }));
  o.floats = s.floats.map((f) => ({ ...f, marker: movedSpan(f.marker, dc, dl), body: movedSpan(f.body, dc, dl) }));
  o.lint = s.lint.map((l) => movedLint(l, dc, dl));
  return o;
}

/** A line number in a lint's words ("the marker on line 12"): such a lint cannot be moved by offset arithmetic. */
const SAYS_LINE = /\bline \d/;

/**
 * The deck of `text`, an edit of `oldText` (whose deck is `old`), derived instead of parsed: the slides
 * before the edit are kept, the slides the edit touches are parsed again ALONE — a text of the same
 * length and lines with everything before them blanked (the header kept), so every offset, line and
 * message is the real one — and the slides after it are the old ones moved. Sound because a slide
 * starts at a top-level marker, where the block parser starts afresh, and `parseSlide` reads nothing
 * outside its slide; checked by re-reading the next slide's marker after the edited ones. Null (a full
 * parse) when the edit reaches the header or the text before the first slide, when the slide count
 * around the edit does not read back, or when a moved lint names a line number.
 */
function deriveDeck(oldText: string, old: Deck, text: string): Deck | null {
  const slides = old.slides;
  if (slides.length === 0) return null;
  const oldLen = oldText.length;
  const len = text.length;
  // the common start and end (compared a chunk at a time first: an edited text is often a rope, slow per character)
  const max = Math.min(oldLen, len);
  const C = 2048;
  let P = 0;
  while (P + C <= max && oldText.slice(P, P + C) === text.slice(P, P + C)) P += C;
  while (P < max && oldText.charCodeAt(P) === text.charCodeAt(P)) P++;
  let S = 0;
  while (S + C <= max - P && oldText.slice(oldLen - S - C, oldLen - S) === text.slice(len - S - C, len - S)) S += C;
  while (S < max - P && oldText.charCodeAt(oldLen - 1 - S) === text.charCodeAt(len - 1 - S)) S++;
  // the edit must lie after the first slide's marker starts
  if (P <= slides[0].marker.from) return null;
  // the first touched slide: the one holding the character before the edit
  let a = slides.length - 1;
  while (a > 0 && slides[a].marker.from > P - 1) a--;
  // an edit inside its marker may unmake it: the slide before takes its text, so that one is read again too
  if (P < slides[a].marker.to) { if (a === 0) return null; a--; }
  // the first slide after the edit: its marker wholly in the unchanged end
  const editEnd = oldLen - S;
  let b = a + 1;
  while (b < slides.length && slides[b].marker.from < editEnd) b++;
  const dc = len - oldLen;
  const A = slides[a].marker.from;
  const next = b < slides.length ? slides[b] : null;
  const B = next ? next.marker.from + dc : len;
  const until = next ? next.marker.to + dc : len;
  const header = readHeader(text);
  const hEnd = header ? header.end : 0;
  if (hEnd > A || hEnd !== (readHeader(oldText)?.end ?? 0)) return null;
  // the touched slides, read alone (a slide starts at a marker, where the block parser starts afresh), then moved to
  // their place; a lint that names a line number is read in place instead (a text of the same length and lines, the
  // header kept and everything else before the slides blanked)
  const lineA = slides[a].marker.line - 1;
  let part = parseDeckNow(text.slice(A, until), kitParser().parse(text.slice(A, until), {}), a);
  let inPlace = false;
  if (part.lint.some((l) => SAYS_LINE.test(l.message))) {
    const padded = text.slice(0, hEnd) + text.slice(hEnd, A).replace(/[^\r\n]+/g, (x) => ' '.repeat(x.length)) + text.slice(A, until);
    part = parseDeckNow(padded, kitParser().parse(padded, {}), a);
    inPlace = true;
  }
  const at = (x: number): number => (inPlace ? x : x + A);
  const m = part.slides.length - (next ? 1 : 0);
  if (m < 0 || (m === 0 && A < B)) return null;
  if (m > 0 && at(part.slides[0].marker.from) !== A) return null;
  if (next) {
    const nm = part.slides[part.slides.length - 1];
    if (at(nm.marker.from) !== B || at(nm.marker.to) !== until) return null;
  }
  const fresh = part.slides.slice(0, m).map((x) => (inPlace ? x : movedSlide(x, A, lineA)));
  // the slides after the edit, moved
  const dl = next ? (inPlace ? part.slides[part.slides.length - 1].marker.line : part.slides[part.slides.length - 1].marker.line + lineA) - next.marker.line : 0;
  const di = a + m - b;
  const moved: Slide[] = [];
  for (let k = b; k < slides.length; k++) {
    const s = slides[k];
    if (dc === 0 && dl === 0 && di === 0) { moved.push(s); continue; }
    if (dl !== 0 && s.lint.some((l) => SAYS_LINE.test(l.message))) return null;
    const t = movedSlide(s, dc, dl);
    if (di !== 0) {
      t.index = s.index + di;
      t.lint = t.lint.map((l) => (l.message.startsWith(`slide ${s.index + 1}: `) ? { ...l, message: `slide ${s.index + di + 1}: ${l.message.slice(`slide ${s.index + 1}: `.length)}` } : l));
    }
    moved.push(t);
  }
  const newSlides = [...slides.slice(0, a), ...fresh, ...moved];
  // the deck's own lints (deck blocks, hidden markers, the preamble): before the edit kept, in it re-read, after it moved
  const ofSlides = new Set<SlideLint>();
  for (const s of slides) for (const l of s.lint) ofSlides.add(l);
  const partOfSlides = new Set<SlideLint>();
  for (const s of part.slides) for (const l of s.lint) partOfSlides.add(l);
  const nextFrom = next ? next.marker.from : Infinity;
  const own = (l: SlideLint): number => (l.code === 'deck-block' ? 0 : l.code === 'text-before-first-slide' || l.code === 'no-slides' ? 2 : 1);
  const groups: SlideLint[][] = [[], [], []];
  for (const l of old.lint) {
    if (ofSlides.has(l)) continue;
    if ((l.from ?? 0) < A) groups[own(l)].push(l);
  }
  for (const l of part.lint) {
    if (partOfSlides.has(l) || own(l) === 2) continue;
    const pl = inPlace ? l : movedLint(l, A, lineA);
    const x = pl.from ?? 0;
    if (x >= A && x < B) groups[own(l)].push(pl);
  }
  for (const l of old.lint) {
    if (ofSlides.has(l)) continue;
    if ((l.from ?? 0) < nextFrom) continue;
    if (dl !== 0 && SAYS_LINE.test(l.message)) return null;
    groups[own(l)].push(dc === 0 && dl === 0 ? l : movedLint(l, dc, dl));
  }
  const lint = [...groups[0], ...groups[1], ...groups[2]];
  for (const s of newSlides) lint.push(...s.lint);
  lint.sort((x, y) => (x.from ?? 0) - (y.from ?? 0));
  return deepFreeze({ config: old.config, slides: newSlides, preamble: old.preamble, lint });
}

function parseDeckNow(text: string, tokens: readonly Token[], indexBase = 0): Deck {
  const L = linesOf(text);
  const header = readHeader(text);
  // the header's last line (0-based), so markers start after it
  let bodyLine = 0;
  if (header) {
    const endLine = text.slice(0, header.end).split(/\r\n|\r|\n/).length - 1;
    bodyLine = endLine + 1;
  }
  const markers = markersOf(tokens, bodyLine);
  const ix = indexTokens(tokens);
  const lint: SlideLint[] = [];
  const at = (s: Span): Pick<SlideLint, 'line' | 'from' | 'to'> => ({ line: s.line, from: s.from, to: s.to });

  for (const m of markers) {
    if (m.type === 'deck') {
      lint.push({ level: 'error', code: 'deck-block', message: 'a <!-- deck … --> block is the 0.x deck config: in text format 1 the header is the deck config and this block renders nothing (run upgrade to move its keys into the header)', next: 'upgrade', ...at(spanOf(L, m.start, m.end)) });
    }
  }
  lint.push(...hiddenMarkers(text, L, tokens, ix, bodyLine));

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

  // one forward pass: each slide takes the region markers in its own range
  const regionMarkers = markers.filter((m) => m.type === 'region');
  const slides: Slide[] = [];
  let r = 0;
  for (let i = 0; i < slideMarkers.length; i++) {
    const m = slideMarkers[i];
    const end = i + 1 < slideMarkers.length ? slideMarkers[i + 1].start : L.starts.length;
    while (r < regionMarkers.length && regionMarkers[r].start < m.end) r++;
    const mine: Marker[] = [];
    while (r < regionMarkers.length && regionMarkers[r].start < end) mine.push(regionMarkers[r++]);
    slides.push(parseSlide(text, L, tokens, ix, i + indexBase, m, end, mine));
  }
  for (const s of slides) lint.push(...s.lint);
  lint.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  return { config: deckConfig(text), slides, preamble, lint };
}

/** The lines of a text range [a, b) (0-based). */
function linesIn(text: string, L: Lines, a: number, b: number): string[] {
  const out: string[] = [];
  for (let i = a; i < b && i < L.starts.length; i++) out.push(text.slice(L.starts[i], L.ends[i]));
  return out;
}

/** The hygiene lints whose quick fix repairs a marker a block swallowed (upgrade applies them). */
export const REPAIR_CODES: ReadonlySet<string> = new Set(['marker-in-html', 'unclosed-fence', 'unclosed-container', 'unclosed-math', 'unclosed-html']);
/** A line that starts like a SLIDE marker (a slide that a block swallowed). */
const SLIDE_LINE = /^ {0,3}<!--\s*slide\b/;
/**
 * A line that opens a construct which runs on to a terminator of its own
 * (a fence, a container, `$$` math, an HTML block of CommonMark types 1–5, a
 * comment not closed on its line) — after such a line, what follows is not
 * read until that terminator.
 */
export const RUN_ON_OPENER = /^ {0,3}(?:`{3,}|~{3,}|:{3,}|\$\$|<(?:script|pre|style|textarea)(?=[\s>]|$)|<\?|<![A-Za-z]|<!\[CDATA\[|<!--(?!.*-->))/i;

/**
 * A block construct that runs on until its own terminator, not until a
 * blank line (closed-loop round A2: one mechanism for every such construct):
 * how a line closes it, the line that closes it, and which line opens
 * another block of the same kind that it cannot hold.
 */
interface Terminated {
  code: 'unclosed-fence' | 'unclosed-container' | 'unclosed-math' | 'unclosed-html';
  /** What it is, for messages. */
  what: string;
  /** The line that closes it (the quick fix inserts it). */
  closer: string;
  /** Whether a line closes it. */
  closes(line: string): boolean;
  /** Whether a line opens another block of the same kind (one it cannot hold: after a slide marker, it was closed by mistake). */
  reopens(line: string): boolean;
  /** Whether its closing line closes it with ANOTHER construct's terminator (a `<pre>` ended by `</style>`: closed by mistake; round A3, A3-FMT-2). */
  foreign?(line: string): boolean;
  /** A comment: it ends at the first `-->`, so it can never hold a marker line on purpose (A3-FMT-4). */
  comment?: boolean;
  /** Its closing line is the line AFTER its token's map (the kit's containers leave their closer out of the map; A3-FMT-1). */
  closerAfterMap?: boolean;
}

/** CommonMark's HTML blocks of types 1–5 (they end at their terminator, not at a blank line); types 6 and 7 are null. */
const HTML_RUN_ON: ReadonlyArray<{ open: RegExp; closes: RegExp; closer: (m: RegExpExecArray) => string; what: string }> = [
  { open: /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i, closes: /<\/(?:script|pre|style|textarea)>/i, closer: (m) => `</${m[1].toLowerCase()}>`, what: 'HTML block' },
  { open: /^ {0,3}<!--/, closes: /-->/, closer: () => '-->', what: 'HTML comment' },
  { open: /^ {0,3}<\?/, closes: /\?>/, closer: () => '?>', what: 'processing instruction' },
  { open: /^ {0,3}<!\[CDATA\[/, closes: /\]\]>/, closer: () => ']]>', what: 'CDATA section' },
  { open: /^ {0,3}<![A-Za-z]/, closes: />/, closer: () => '>', what: 'declaration' },
];

/** How a level-0 block token ends: a {@link Terminated} construct, `'blank'` (an HTML block of type 6 or 7: at a blank line), or null. */
function terminatorOf(t: Token, first: string): Terminated | 'blank' | null {
  const run = (re: RegExp, len: number, ch: string, needInfo: boolean) => (line: string): boolean => {
    const m = re.exec(line);
    return !!m && m[1][0] === ch && m[1].length >= len && (m[2].trim() !== '') === needInfo;
  };
  if (t.type === 'fence') {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
    return { code: 'unclosed-fence', what: `code fence (${t.markup})`, closer: t.markup, closes: run(fence, t.markup.length, t.markup[0], false), reopens: run(fence, t.markup.length, t.markup[0], true) };
  }
  if (/^container_.*_open$/.test(t.type)) {
    const colons = /^ {0,3}(:{3,})(.*)$/;
    return { code: 'unclosed-container', what: `${t.markup} container`, closer: t.markup, closes: run(colons, t.markup.length, ':', false), reopens: run(colons, t.markup.length, ':', true), closerAfterMap: true };
  }
  if (t.type === 'math_block') return { code: 'unclosed-math', what: '$$ math block', closer: '$$', closes: (line) => line.trim().endsWith('$$'), reopens: () => false };
  if (t.type === 'html_block') {
    for (const h of HTML_RUN_ON) {
      const m = h.open.exec(first);
      if (!m) continue;
      const own = m[1]?.toLowerCase();
      // type 1 (`<pre>`, `<script>`, `<style>`, `<textarea>`): CommonMark ends it at ANY of the four closers, so another
      // type-1 opener after a slide marker, or a closer of another tag, means it was closed by mistake (A3-FMT-2)
      const type1 = h === HTML_RUN_ON[0];
      return {
        code: 'unclosed-html', what: `${h.what} (${first.trim().slice(0, 12)}…)`, closer: h.closer(m), closes: (line) => h.closes.test(line),
        reopens: (line) => h !== HTML_RUN_ON[1] && h.open.test(line) && (type1 || h.open.exec(line)![1]?.toLowerCase() === own),
        ...(type1 ? { foreign: (line: string) => { const c = /<\/(script|pre|style|textarea)>/i.exec(line); return !!c && c[1].toLowerCase() !== own; } } : {}),
        ...(h === HTML_RUN_ON[1] ? { comment: true } : {}),
      };
    }
    return 'blank';
  }
  return null;
}

/** The line ending to use for an insert before line `line` (0-based): the previous line's, else the text's first, else LF. */
function eolBefore(text: string, L: Lines, line: number): string {
  if (line > 0 && line < L.starts.length) return text.slice(L.ends[line - 1], L.starts[line]);
  return /\r\n|\r|\n/.exec(text)?.[0] ?? '\n';
}

/**
 * Marker hygiene (closed-loop rounds A and A2): marker lines the grammar
 * does not read — FC-18 §7.2 recognises markers only as top-level comment
 * blocks, and that rule stays — are noticed instead of silently changing
 * the deck. ONE mechanism for every construct that holds a marker line
 * after its first line, by how the construct ends:
 * - an HTML block of CommonMark type 6 or 7 (`<img>`, `<div>` … — it runs
 *   on until a blank line): `marker-in-html` (error) on each marker line,
 *   the blank line it needs as the quick fix;
 * - a construct that runs on to a terminator of its own — a code fence of
 *   any length and character, a `:::` container of any length, a `$$` math
 *   block, an HTML block of types 1–5 (`<pre>`, `<script>`, `<style>`,
 *   `<textarea>`, a comment `<!--` left open, `<?`, `<!X`, `<![CDATA[`):
 *   `unclosed-fence` / `unclosed-container` / `unclosed-math` /
 *   `unclosed-html` (error) when it was never closed, when a marker line's
 *   own `-->` closed it, or when it was closed by mistake (after a slide
 *   marker, a line opens another block of its kind it cannot hold — a
 *   ```` ```js ```` in a ```` ``` ```` fence, a `::: warning` in a `:::`
 *   container, a second `<pre>`); the quick fix inserts the construct's
 *   own closer before its first marker line. One that IS closed on purpose
 *   may show markers: the documented way to write about them (corpus
 *   `markers-in-code`);
 * - `marker-lookalike` (warning): a short comment that reads like a marker
 *   but is not one (`<!-- notes -->`, `<!-- @ notes -->`, `<!-- Slide -->`),
 *   whose text would otherwise show on the slide.
 * Every quick fix keeps the text's line ending, and applying it removes its
 * lint and turns at least one marker line into a marker (tests: P.13).
 */
function hiddenMarkers(text: string, L: Lines, tokens: readonly Token[], ix: TokenIndex, bodyLine: number): SlideLint[] {
  const out: SlideLint[] = [];
  /** A lint about a block that was closed by mistake or ambiguously, and the line that closed it (A3-FMT-3). */
  const roots: Array<{ code: string; open: number; closedAt: number }> = [];
  /** Lints with a fix, by their block's opening line (for the consequence pass). */
  const fixable: Array<{ lint: SlideLint; code: string; open: number }> = [];
  const markerLines: number[] = [];
  for (const { token: t, index } of ix.blocks) {
    const [a, b] = t.map!;
    if (a < bodyLine) continue;
    const lines = linesIn(text, L, a, b);
    if (t.type === 'html_block') {
      const c = t.content.replace(/\n$/, '');
      if (SLIDE_MARKER.test(c) || REGION_MARKER.test(c)) { markerLines.push(a); continue; }
      if (DECK_BLOCK.test(c)) continue;
      if (COMMENT_BLOCK.test(c)) {
        const look = lookalike(c);
        if (look) { const s = spanOf(L, a, b); out.push({ level: 'warning', code: 'marker-lookalike', message: `this comment looks like a marker but is not one: it is not read, and the text after it stays where it is (write ${look})`, ...{ line: s.line, from: s.from, to: s.to } }); }
      }
    }
    const end = terminatorOf(t, lines[0]);
    // a container's own marker lines are those not inside a code-like block nested in it (a fenced example that
    // SHOWS a marker is no marker the container swallowed: A3-FMT-1)
    const shown = new Set<number>();
    if (end !== null && end !== 'blank' && end.closerAfterMap) {
      for (let j = index + 1; j < tokens.length && !(tokens[j].level === 0 && tokens[j].nesting === -1); j++) {
        const n = tokens[j];
        if (n.map && /^(?:fence|code_block|math_block)$/.test(n.type)) for (let k = n.map[0]; k < n.map[1]; k++) shown.add(k - a);
      }
    }
    const hidden: number[] = [];
    for (let k = 1; k < lines.length; k++) if (!shown.has(k) && MARKER_LINE.test(lines[k])) hidden.push(k);
    if (hidden.length === 0 || end === null) continue;
    if (end === 'blank') {
      // only the first marker line's blank line ends the block; what follows it is read anew, so the later
      // lines' fixes follow from it (A3-FMT-3: blank lines added first in the wrong places otherwise)
      for (const k of hidden) {
        const line = a + k;
        const s = spanOf(L, line, line + 1);
        const root = k === hidden[0];
        out.push({ level: 'error', code: 'marker-in-html', message: `the marker on line ${line + 1} is inside a raw HTML block (the HTML that starts on line ${a + 1} runs on until a blank line), so it is not read: add a blank line before it${root ? '' : ` (this may follow from line ${a + hidden[0] + 1}: fix that first)`}`, line: s.line, from: s.from, to: s.to,
          ...(root ? { fix: { from: s.from, to: s.from, insert: eolBefore(text, L, line), label: 'Add a blank line before the marker' } } : {}) });
      }
      continue;
    }
    // how it ended: never (it runs to the end of the text), on a marker line (a comment's `-->`), or on purpose;
    // the closing line is the map's last line, or (a container) the line after the map
    const closeLine = end.closerAfterMap ? b : a + lines.length - 1;
    const last = end.closerAfterMap ? (b < L.starts.length ? text.slice(L.starts[b], L.ends[b]) : '') : lines[lines.length - 1];
    const closed = t.type === 'html_block' ? end.closes(last) && !(lines.length === 1)
      : end.closerAfterMap ? b < L.starts.length && end.closes(last)
      : lines.length > 1 && end.closes(last) && b <= L.starts.length;
    // a comment ends at the first `-->`: one that holds a marker line was closed by a marker (a multi-line marker's
    // `-->` is on a later line than the one that starts it: A3-FMT-4)
    const byMarker = closed && (MARKER_LINE.test(last) || !!end.comment);
    let byMistake = closed && !byMarker && !!end.foreign?.(last);
    const slideAt = (k: number): boolean => hidden.includes(k) && SLIDE_LINE.test(lines[k]);
    if (closed && !byMarker && !byMistake) {
      let slide = false;
      for (let k = 1; k < lines.length && !byMistake; k++) {
        if (slideAt(k)) slide = true;
        else if (slide && end.reopens(lines[k])) byMistake = true;
      }
    }
    let ambiguous = false;
    if (closed && !byMarker && !byMistake) {
      // closed: a code fence or a raw-text HTML block may SHOW markers (the documented way to write about them);
      // a container or a $$ block cannot (a marker line in it is an invisible comment, or LaTeX), so a slide
      // marker in one was closed by mistake; a fence with no info string that holds a slide marker is
      // ambiguous (two fences left open pair up: ``` … <!-- slide --> … ```) — a warning, with the same fix
      if (!hidden.some(slideAt)) continue;
      if (/^container_|^math_block$/.test(t.type)) byMistake = true;
      else if (t.type === 'fence' && t.info.trim() === '') ambiguous = true;
      else continue;
    }
    const s = spanOf(L, a, a + 1);
    const first = a + hidden[0];
    const n = hidden.length;
    const how = !closed ? 'is never closed' : byMarker ? `is closed only by the marker's own "${end.closer}" on line ${closeLine + 1}` : byMistake ? `is closed only on line ${closeLine + 1}, by mistake` : `is closed only on line ${closeLine + 1}`;
    const message = ambiguous
      ? `the code fence opened on line ${a + 1} has no info string and holds ${n} marker line${n === 1 ? '' : 's'}, a slide marker among them: if it was left open (two open fences pair up), close it with ${end.closer} before line ${first + 1}; to show markers on purpose, give it an info string (${end.closer}markdown)`
      : `the ${end.what} opened on line ${a + 1} ${how}, so ${n} marker line${n === 1 ? ' is' : 's are'} inside it and not read: close it with ${end.closer} before line ${first + 1}`;
    const lint: SlideLint = { level: ambiguous ? 'warning' : 'error', code: end.code, message, line: s.line, from: s.from, to: s.to,
      fix: { from: L.starts[first], to: L.starts[first], insert: `${end.closer}${eolBefore(text, L, first)}`, label: `Close it before the marker on line ${first + 1}` } };
    out.push(lint);
    fixable.push({ lint, code: end.code, open: a });
    if (byMistake || ambiguous) roots.push({ code: end.code, open: a, closedAt: closeLine });
  }
  // A3-FMT-3: a block of the same kind that opens after the line that closed a block by mistake (and before the
  // next marker) is most likely that block's own closer, left over: its lint follows from the first and carries
  // no fix of its own, so the fixes commute (fixing the consequence first left an empty code or math block)
  for (const r of roots) {
    const next = markerLines[lowerBound(markerLines, r.closedAt + 1)] ?? Infinity;
    for (const f of fixable) {
      if (f.code !== r.code || f.open <= r.closedAt || f.open >= next || !f.lint.fix) continue;
      delete f.lint.fix;
      f.lint.message += ` (this may follow from line ${r.open + 1}: fix that first)`;
    }
  }
  return out;
}

/** The words a marker is made of (a short comment of these reads as one). */
const MARKER_WORDS = /^(?:notes?|speaker|footer|float|slide|region)$/i;

/** When a comment reads like a region marker (`<!-- notes -->`, `<!-- @ notes -->`, `<!-- speaker notes -->`): the marker to write. */
function lookalike(comment: string): string | null {
  const inner = comment.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
  if (inner === '' || inner.length > 40) return null;
  // `<!-- Slide -->`, `<!-- SLIDE 2col -->`: the marker word is lower case (A2 improvement)
  if (/^slide\b/i.test(inner) && !/^slide\b/.test(inner)) return `<!-- slide${inner.slice(5)} -->`.replace(/\s+-->$/, ' -->');
  const words = inner.replace(/^@\s*/, '').split(/[\s:.,;]+/).filter((w) => w !== '');
  if (words.length === 0 || words.length > 3 || !words.every((w) => MARKER_WORDS.test(w))) return null;
  const name = words.some((w) => /^notes?$/i.test(w)) ? 'notes' : words.find((w) => /^(?:footer|float)$/i.test(w))?.toLowerCase();
  return name ? `<!-- @${name} -->` : null;
}

/** The first content token (a top-level block, comments skipped) whose first line is in [a, b). */
function firstContent(ix: TokenIndex, a: number, b: number): { token: Token; index: number } | null {
  for (let k = lowerBound(ix.blockStarts, a); k < ix.blocks.length; k++) {
    const { token: t, index } = ix.blocks[k];
    if (t.map![0] >= b) return null;
    if (t.type === 'html_block' && COMMENT_BLOCK.test(t.content)) continue;
    return { token: t, index };
  }
  return null;
}

/** True when the lines [a, b) hold only comment blocks (and blank lines; the title's line `skip` aside). */
function onlyComments(ix: TokenIndex, a: number, b: number, skip = -1): boolean {
  let any = false;
  for (let k = lowerBound(ix.blockStarts, a); k < ix.blocks.length; k++) {
    const t = ix.blocks[k].token;
    if (t.map![0] >= b) break;
    if (t.map![0] === skip) continue;
    if (!(t.type === 'html_block' && COMMENT_BLOCK.test(t.content))) return false;
    any = true;
  }
  return any;
}

/** A slide (see parseDeck). */
function parseSlide(text: string, L: Lines, tokens: readonly Token[], ix: TokenIndex, index: number, m: Marker, end: number, regionMarkers: Marker[]): Slide {
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
      first = firstContent(ix, b.bodyStart, b.bodyEnd);
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
      for (let k = lowerBound(ix.headingStarts, b.bodyStart); k < ix.headings.length && ix.headingStarts[k] < b.bodyEnd; k++) {
        const t = ix.headings[k];
        const map = t.map!;
        if (titleLines && map[0] === titleLines[0]) continue;
        const s = spanOf(L, map[0], map[1]);
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
      // leading text of only author comments renders nothing: not content of the first region (FMT-10)
      if (md !== '' && !onlyComments(ix, b.bodyStart, b.bodyEnd, titleLines ? titleLines[0] : -1)) add(primary, { marker: null, body }, md);
      continue;
    }
    const mk = b.marker;
    const ms = spanOf(L, mk.start, mk.end);
    if (mk.trailing !== '') err('marker-not-alone', `text after the region marker on its line ("${mk.trailing.slice(0, 40)}") is ignored; put it on the next line`, ms);
    if (mk.punct) warn('marker-punctuation', `"@${mk.name}${mk.punct}" is read as the marker @${mk.name}; write <!-- @${mk.name} --> (0.x read any character after the name)`, ms);
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
