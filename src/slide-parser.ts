/**
 * WP1 — Slide parser. Deck source → Deck AST.
 *
 * Pure functions only (no DOM, no network). Implements DESIGN.md §4–§5:
 *   - split the source into slides at `<!-- slide … -->` markers,
 *   - parse a leading `<!-- deck … -->` block into DeckConfig,
 *   - expand a preset alias (or parse a raw row/col split grammar) into a
 *     fully-expanded LayoutNode tree (the layout engine never sees a preset
 *     name — the parser owns expansion, §5.4.1),
 *   - parse region bodies (`<!-- @name -->`), reserved regions
 *     (`@notes` / `@footer` / `@float`), per-slide options, the leading-h2
 *     title, and the heading lint rules (§5.2).
 */
import type {
  Deck,
  DeckConfig,
  Slide,
  SlideOptions,
  LayoutNode,
  SplitNode,
  RegionLeaf,
  Region,
  FloatRegion,
  LintMsg,
  Track,
} from './types.js';

/* ── Marker regexes ──────────────────────────────────────────────────────── */

const DECK_BLOCK = /^\s*<!--\s*deck\b([\s\S]*?)-->/;
// A `<!-- slide … -->` marker on its own (we split the source on these).
const SLIDE_MARKER = /<!--\s*slide\b([^>]*?)-->/g;
// A region marker `<!-- @name … -->` at the start of a line.
const REGION_MARKER = /^[ \t]*<!--\s*@([A-Za-z0-9_-]+)\b([^>]*?)-->[ \t]*$/;

/* ── Public entry point ──────────────────────────────────────────────────── */

export function parseDeck(source: string): Deck {
  const src = source.replace(/\r\n?/g, '\n');

  const { config, rest } = parseDeckBlock(src);
  const slides = splitSlides(rest).map((raw, index) => parseSlide(raw, index));

  return { config, slides };
}

/* ── Deck config ─────────────────────────────────────────────────────────── */

function parseDeckBlock(src: string): { config: DeckConfig; rest: string } {
  const m = src.match(DECK_BLOCK);
  if (!m) return { config: {}, rest: src };

  const config: DeckConfig = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2];
    if (value === '') continue;
    switch (key) {
      case 'title':
        config.title = value;
        break;
      case 'theme':
        config.theme = value;
        break;
      case 'ratio':
        config.ratio = value;
        break;
      case 'author':
        config.author = value;
        break;
      case 'footer':
        config.footer = value;
        break;
      case 'transition':
        config.transition = value;
        break;
      // Unknown keys are ignored (forward-compatible).
    }
  }

  // Everything after the deck block is slide content.
  const rest = src.slice((m.index ?? 0) + m[0].length);
  return { config, rest };
}

/* ── Slide splitting ─────────────────────────────────────────────────────── */

/**
 * Split the post-deck source into per-slide raw chunks. Every slide *begins*
 * with a `<!-- slide … -->` marker (the marker is the separator), so each chunk
 * runs from one marker up to (but not including) the next.
 */
function splitSlides(src: string): string[] {
  SLIDE_MARKER.lastIndex = 0;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = SLIDE_MARKER.exec(src)) !== null) starts.push(m.index);

  if (starts.length === 0) return [];

  const slides: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : src.length;
    const chunk = src.slice(begin, end).replace(/\s+$/, '');
    slides.push(chunk);
  }
  return slides;
}

/* ── Per-slide parse ─────────────────────────────────────────────────────── */

function parseSlide(raw: string, index: number): Slide {
  const lint: LintMsg[] = [];

  // The slide marker is the first thing in the chunk.
  const mm = raw.match(/^[ \t]*<!--\s*slide\b([^>]*?)-->[ \t]*\n?/);
  const markerArgs = mm ? mm[1].trim() : '';
  const body = mm ? raw.slice(mm[0].length) : raw;

  const { options, layoutSpec, template, templateVariant } =
    parseMarker(markerArgs);

  // Template slides: own layout + fixed semantics; no preset/split expansion.
  if (template !== undefined) {
    const { regions, floats, footer, notes } = parseRegions(
      body,
      // Template primary region is conventionally 'body'.
      'body',
    );
    return {
      index,
      kind: 'template',
      template,
      templateVariant,
      layout: regionLeaf('body'),
      regions,
      floats,
      footer,
      notes,
      options,
      lint,
      raw,
    };
  }

  // Normal slide: expand the layout, find the primary region, parse regions.
  const layout = layoutSpec
    ? parseLayoutSpec(layoutSpec, lint)
    : regionLeaf('body');
  const primary = firstLeafName(layout);

  const titled = extractTitle(body, lint);
  const { regions, floats, footer, notes } = parseRegions(
    titled.body,
    primary,
  );

  return {
    index,
    kind: 'normal',
    title: titled.title,
    layout,
    regions,
    floats,
    footer,
    notes,
    options,
    lint,
    raw,
  };
}

/* ── Marker (slide options + layout spec) ────────────────────────────────── */

interface MarkerParse {
  options: SlideOptions;
  layoutSpec: string; // preset alias or raw split expression (may be '')
  template?: string;
  templateVariant?: number;
}

function parseMarker(args: string): MarkerParse {
  const options: SlideOptions = {};
  let template: string | undefined;
  let templateVariant: number | undefined;

  // Pull out `key=value` options first (these never contain spaces in value
  // except for quoted values). We support quotes for bg/class.
  // Strategy: tokenize, treating `{ … }` braces as opaque (they belong to the
  // layout split expression, not options).
  const optionKeys = new Set([
    'bg',
    't',
    'fit',
    'class',
    'id',
    'template',
    'v',
  ]);

  const leftover: string[] = [];
  const tokens = tokenizeMarker(args);
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq > 0 && !tok.startsWith('{')) {
      const key = tok.slice(0, eq).toLowerCase();
      let value = tok.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (optionKeys.has(key)) {
        switch (key) {
          case 'bg':
            options.bg = value;
            break;
          case 't':
            options.transition = value;
            break;
          case 'fit':
            if (value === 'fit' || value === 'scroll' || value === 'off')
              options.fit = value;
            break;
          case 'class':
            options.class = value;
            break;
          case 'id':
            options.id = value;
            break;
          case 'template':
            template = value;
            break;
          case 'v':
            templateVariant = Number(value);
            break;
        }
        continue;
      }
    }
    if (tok === 'step') {
      options.step = true;
      continue;
    }
    leftover.push(tok);
  }

  const layoutSpec = leftover.join(' ').trim();
  return { options, layoutSpec, template, templateVariant };
}

/**
 * Split marker args on whitespace, but keep `{ … }` brace groups (the split
 * body) intact so a layout like `col 3/2 { main; side }` survives.
 */
function tokenizeMarker(args: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
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

/* ── Layout spec → LayoutNode ────────────────────────────────────────────── */

/**
 * A layout spec is either a *preset alias* (optionally with a track ratio,
 * e.g. `2col 3/2`, `main-side`, `quad`) or a *raw split expression*
 * (`col 3/2 { main; side }`). Presets are expanded here.
 */
function parseLayoutSpec(spec: string, lint: LintMsg[]): LayoutNode {
  const trimmed = spec.trim();
  if (trimmed === '') return regionLeaf('body');

  // Raw split expression: starts with row/col and contains braces.
  const head = trimmed.split(/\s+/, 1)[0];
  if ((head === 'row' || head === 'col') && trimmed.includes('{')) {
    try {
      return parseSplit(trimmed);
    } catch (e) {
      lint.push({
        level: 'error',
        message: `Invalid layout split: ${(e as Error).message}`,
      });
      return regionLeaf('body');
    }
  }

  // Otherwise: a preset alias, possibly followed by a ratio token.
  const parts = trimmed.split(/\s+/);
  const name = parts[0];
  const ratio = parts[1];
  const node = expandPreset(name, ratio);
  if (node) return node;

  lint.push({ level: 'error', message: `Unknown layout preset: ${name}` });
  return regionLeaf('body');
}

/** Expand a preset alias (+ optional ratio like '3/2') to a layout tree. */
function expandPreset(name: string, ratio?: string): LayoutNode | null {
  const r = (def: string): Track[] => parseTracks(ratio ?? def);
  switch (name) {
    case '2col':
      return split('col', r('1/1'), [regionLeaf('left'), regionLeaf('right')]);
    case '3col':
      return split('col', r('1/1/1'), [
        regionLeaf('left'),
        regionLeaf('mid'),
        regionLeaf('right'),
      ]);
    case '2row':
      return split('row', r('1/1'), [regionLeaf('top'), regionLeaf('bottom')]);
    case 'main-side':
      return split('col', r('2/1'), [regionLeaf('main'), regionLeaf('side')]);
    case 'quad':
      return split('row', parseTracks('1/1'), [
        split('col', parseTracks('1/1'), [
          regionLeaf('tl'),
          regionLeaf('tr'),
        ]),
        split('col', parseTracks('1/1'), [
          regionLeaf('bl'),
          regionLeaf('br'),
        ]),
      ]);
    default:
      return null;
  }
}

/* ── Raw split grammar parser ────────────────────────────────────────────── */
//
//   split  := ("row" | "col") tracks "{" item (";" item)* "}"
//   item   := region-name | split
//   tracks := token ("/" token)*
//
// Implemented as a small recursive-descent parser over a character cursor.

function parseSplit(input: string): SplitNode {
  const p = new SplitCursor(input);
  const node = p.parseSplitNode();
  if (!p.atEnd())
    throw new Error(`unexpected trailing input near "${p.rest()}"`);
  return node;
}

class SplitCursor {
  private i = 0;
  constructor(private readonly s: string) {}

  parseSplitNode(): SplitNode {
    this.skipWs();
    const dir = this.readWord();
    if (dir !== 'row' && dir !== 'col')
      throw new Error(`expected "row" or "col", got "${dir}"`);

    this.skipWs();
    const tracksStr = this.readUntil('{').trim();
    if (tracksStr === '') throw new Error('missing tracks before "{"');
    const tracks = parseTracks(tracksStr);

    this.expect('{');
    const children: LayoutNode[] = [];
    do {
      this.skipWs();
      children.push(this.parseItem());
      this.skipWs();
    } while (this.consumeIf(';'));
    this.skipWs();
    this.expect('}');

    if (children.length !== tracks.length)
      throw new Error(
        `track count (${tracks.length}) != child count (${children.length})`,
      );

    return { kind: 'split', dir, tracks, children };
  }

  parseItem(): LayoutNode {
    this.skipWs();
    // Lookahead: a nested split starts with "row" or "col" followed (after
    // tracks) by "{". A region name is a bare identifier.
    const save = this.i;
    const word = this.peekWord();
    if (word === 'row' || word === 'col') {
      // Confirm there's a "{" before the next ";" or "}" — otherwise treat the
      // word as a (oddly-named) region. In practice row/col are reserved, but
      // being defensive keeps single-name items safe.
      if (this.hasBraceBeforeDelimiter()) {
        return this.parseSplitNode();
      }
    }
    this.i = save;
    const name = this.readName();
    if (name === '') throw new Error('expected region name');
    return regionLeaf(name);
  }

  /* ── primitives ── */

  private skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private readWord(): string {
    this.skipWs();
    let w = '';
    while (this.i < this.s.length && /[A-Za-z]/.test(this.s[this.i]))
      w += this.s[this.i++];
    return w;
  }
  private peekWord(): string {
    const save = this.i;
    const w = this.readWord();
    this.i = save;
    return w;
  }
  private readName(): string {
    let n = '';
    while (this.i < this.s.length && /[A-Za-z0-9_-]/.test(this.s[this.i]))
      n += this.s[this.i++];
    return n;
  }
  private readUntil(stop: string): string {
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== stop)
      out += this.s[this.i++];
    return out;
  }
  private expect(ch: string): void {
    this.skipWs();
    if (this.s[this.i] !== ch)
      throw new Error(`expected "${ch}" at "${this.rest()}"`);
    this.i++;
  }
  private consumeIf(ch: string): boolean {
    this.skipWs();
    if (this.s[this.i] === ch) {
      this.i++;
      return true;
    }
    return false;
  }
  private hasBraceBeforeDelimiter(): boolean {
    let depth = 0;
    for (let j = this.i; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '{') return true;
      if ((c === ';' || c === '}') && depth === 0) return false;
    }
    return false;
  }
  atEnd(): boolean {
    this.skipWs();
    return this.i >= this.s.length;
  }
  rest(): string {
    return this.s.slice(this.i, this.i + 20);
  }
}

/** Parse a `/`-separated track list: `2/1`, `auto/1fr`, `30%/1fr`, `200px/1`. */
function parseTracks(str: string): Track[] {
  return str
    .trim()
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/* ── Region bodies (regions, floats, footer, notes) ──────────────────────── */

interface RegionParse {
  regions: Region[];
  floats: FloatRegion[];
  footer?: string;
  notes?: string;
}

/**
 * Split the slide body into region chunks at `<!-- @name -->` markers. Content
 * before the first marker fills `primaryName` (the layout's primary region).
 * Reserved names (`notes`, `footer`, `float`) are routed to dedicated fields.
 */
function parseRegions(body: string, primaryName: string): RegionParse {
  const lines = body.split('\n');

  const regions: Region[] = [];
  const floats: FloatRegion[] = [];
  let footer: string | undefined;
  let notes: string | undefined;

  // Current accumulator.
  let curName: string | null = null; // null = leading (primary) region
  let curAttrs = '';
  let buf: string[] = [];

  const flush = () => {
    const markdown = trimBlock(buf.join('\n'));
    if (curName === null) {
      // Leading content → primary region (only if non-empty).
      if (markdown !== '') regions.push({ name: primaryName, markdown });
    } else {
      const lname = curName.toLowerCase();
      if (lname === 'notes') {
        notes = markdown;
      } else if (lname === 'footer') {
        footer = markdown;
      } else if (lname === 'float') {
        floats.push({ geom: parseFloatGeom(curAttrs), markdown });
      } else {
        regions.push({ name: curName, markdown });
      }
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(REGION_MARKER);
    if (m) {
      flush();
      curName = m[1];
      curAttrs = (m[2] || '').trim();
      continue;
    }
    buf.push(line);
  }
  flush();

  return { regions, floats, footer, notes };
}

/** Parse `<!-- @float left=58% top=10% w=36% h=44% z=3 -->` attributes. */
function parseFloatGeom(attrs: string): FloatRegion['geom'] {
  const geom: FloatRegion['geom'] = {};
  const re = /([A-Za-z]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) {
    const key = m[1].toLowerCase();
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    switch (key) {
      case 'left':
        geom.left = val;
        break;
      case 'right':
        geom.right = val;
        break;
      case 'top':
        geom.top = val;
        break;
      case 'bottom':
        geom.bottom = val;
        break;
      case 'w':
      case 'width':
        geom.w = val;
        break;
      case 'h':
      case 'height':
        geom.h = val;
        break;
      case 'z':
        geom.z = Number(val);
        break;
    }
  }
  return geom;
}

/* ── Title extraction + heading lint ─────────────────────────────────────── */

interface TitleParse {
  title?: string;
  body: string; // body with the leading h2 removed
}

/**
 * On a normal slide the single leading h2 is lifted into the title band. Lint:
 *   - the first content must be exactly one h2;
 *   - a second h2, or any h1, anywhere on a normal slide is an error.
 * Headings inside fenced code blocks are ignored.
 */
function extractTitle(body: string, lint: LintMsg[]): TitleParse {
  const lines = body.split('\n');

  // Locate the first non-blank, non-region-marker content line.
  let firstIdx = -1;
  let inFence = false;
  let fenceTok = '';
  const headings: { level: number; idx: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceTok = fence[1][0];
      } else if (line.trimStart().startsWith(fenceTok)) {
        inFence = false;
      }
      if (firstIdx === -1 && line.trim() !== '') firstIdx = i;
      continue;
    }
    if (inFence) continue;

    if (REGION_MARKER.test(line)) continue;
    if (line.trim() === '') continue;
    if (firstIdx === -1) firstIdx = i;

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) headings.push({ level: h[1].length, idx: i, text: h[2].trim() });
  }

  let title: string | undefined;
  let removeIdx = -1;

  const firstHeading = headings[0];
  const firstIsLeadingH2 =
    firstHeading && firstHeading.idx === firstIdx && firstHeading.level === 2;

  if (firstIsLeadingH2) {
    title = firstHeading.text;
    removeIdx = firstHeading.idx;
  } else if (firstIdx !== -1) {
    // First content is not a leading h2.
    if (firstHeading && firstHeading.idx === firstIdx && firstHeading.level === 1) {
      lint.push({
        level: 'error',
        message: 'h1 is not allowed on a normal slide (use template=title).',
      });
    } else {
      lint.push({
        level: 'error',
        message: 'A normal slide must begin with exactly one h2 title.',
      });
    }
  }

  // Lint the remaining headings: any h1, or a second h2, is an error.
  for (const h of headings) {
    if (h.idx === removeIdx) continue;
    if (h.level === 1) {
      lint.push({
        level: 'error',
        message: 'h1 is not allowed on a normal slide (use template=title).',
      });
    } else if (h.level === 2) {
      lint.push({
        level: 'error',
        message: 'A normal slide may have only one h2 (the title).',
      });
    }
  }

  let outLines = lines;
  if (removeIdx !== -1) {
    outLines = lines.slice();
    outLines.splice(removeIdx, 1);
  }
  return { title, body: outLines.join('\n') };
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

function split(dir: 'row' | 'col', tracks: Track[], children: LayoutNode[]): SplitNode {
  return { kind: 'split', dir, tracks, children };
}

function regionLeaf(name: string): RegionLeaf {
  return { kind: 'region', name };
}

/** Name of the first leaf in document order (the primary region). */
function firstLeafName(node: LayoutNode): string {
  if (node.kind === 'region') return node.name;
  return firstLeafName(node.children[0]);
}

/** Trim leading/trailing blank lines but keep internal structure. */
function trimBlock(s: string): string {
  return s.replace(/^\n+/, '').replace(/\n+$/, '').replace(/^[ \t]+$/gm, '').trim();
}
