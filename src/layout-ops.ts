/**
 * The layout operations of editing mode (b), per slide (REBUILD §3c owner
 * decisions 1(b) and 6, plan step 6): ONE op → text edits, pure (no DOM, no
 * Node built-ins), for the layout GUI, apps and agents alike.
 *
 * The deck text stays the single source of truth: an op is
 * `applyOp(text, slideIndex, op)` → `{ edits, text, label, … }`, the
 * `edits` being the minimal line edits (FC-19 `applyEdits` shape — one undo
 * step in the editor) that turn the text into `text`. What an op may touch:
 * - **marker lines** — the slide marker (`<!-- slide … -->`, rewritten ONLY
 *   when its layout tree or its options change; a tree equal to a preset is
 *   written as the preset, owner decision 6) and region / float markers
 *   (`<!-- @name -->`, `<!-- @float … -->`) — and the blank lines that keep
 *   two pieces of Markdown apart;
 * - **the moved block**: deleting a box moves its content to the
 *   neighbouring box, moving a box's content moves it, and the deck ops
 *   (add / duplicate / delete / move a slide) move whole slide blocks.
 * Every other slide, the header and every region's text stay byte-identical;
 * new lines take the slide's line ending (LF, CR LF or CR).
 *
 * The grammar rules of owner decision 6 are kept by every op: one source per
 * region (a merge never leaves a duplicate-region or region-twice), floats
 * unnamed (by order), a one-box slide whose box is not `body` written as a
 * one-track split, switching preset renames the regions (same name first,
 * then reading order; extra boxes merge into the preset's last box), new
 * regions get short unique names (`left-2`), names that are reserved
 * (`notes`, `footer`, `float`), layout words or taken are refused.
 *
 * Every op is checked before it is returned: the new text is read back (the
 * deck derived from the old one, slide by slide: only the op's slide is
 * parsed again — closed-loop round B, OPS-10) and its slide must have exactly
 * the tree, title, regions, floats (their text AND geometry), notes, footer
 * and options the op means, no new structural lint and no blocking problem
 * (a marker swallowed by a raw HTML block, an unclosed construct: round B,
 * OPS-1) — a text that would not say that is tried once with blank lines
 * around the inserted markers, then refused (`LayoutOpError`), never
 * written. A region marker is never anchored inside or right after a
 * float's, the notes' or the footer's body.
 *
 * Geometry comes from the TEXT (float lengths in % or px of the logical
 * slide, tracks as written; a move keeps the text's units and anchors and
 * writes only the axis it moves — round B, OPS-3). A GUI may add what the
 * reader SEES: a new float's place (`float-add { box }`, where it covers no
 * content) and the start of a move for an axis the text gives in em
 * (`float-geom { from }`) — never a name, an index or an op.
 */
import type { FloatGeom, LayoutNode, Slide, SplitNode } from './types.js';
import { parseDeck, readFloatAttrs, readMarkerArgs, scanMarkers, tokenizeMarker, TEMPLATES, TRANSITION } from './deck/parse.js';
import { DEFAULT_REGION, expandPreset, firstLeaf, isFrTrack, leaf, leaves, normalizeTree, PRESETS, RESERVED_REGIONS, sameTree, serialiseLayout, slideMarker, split, type PresetName } from './deck/layout-spec.js';

/* ───────────────────────── public types ───────────────────────── */

/** One replacement in the exact text (FC-19 `applyEdits`): offsets, sorted, not overlapping. */
export interface TextEdit { from: number; to: number; insert: string }

/** A float's box in % of the logical slide (whole numbers when the GUI writes them). */
export interface FloatBox { left: number; top: number; w: number; h: number }

/** The preset picker's choices (`single`: the one `body` region). */
export type PresetChoice = 'single' | PresetName;
export const PRESET_CHOICES: readonly PresetChoice[] = Object.freeze(['single', ...PRESETS]);

/** The slide options a GUI sets (`null` removes the option). */
export interface SlideOptionChanges {
  fit?: 'fit' | 'scroll' | 'off' | null;
  bg?: string | null;
  transition?: string | null;
  step?: boolean;
}

/** One layout operation on one slide (or, the `slide-*` ops, on the deck). */
export type LayoutOp =
  | { type: 'split'; box: string; dir: 'row' | 'col' }
  | { type: 'delete-box'; box: string }
  | { type: 'tracks'; path: number[]; tracks: string[] }
  | { type: 'preset'; preset: PresetChoice }
  | { type: 'rename'; box: string; to: string }
  | { type: 'swap'; a: string; b: string }
  | { type: 'move-content'; from: string; to: string }
  | { type: 'ensure-region'; name: string }
  /** `box`: where (a GUI's place from the stage; else {@link placeFloat}); `covers`: the GUI found no free place (said in the label). */
  | { type: 'float-add'; box?: FloatBox; covers?: boolean }
  /**
   * The float's new box in % of the slide — ONLY the keys that changed (a horizontal nudge sends `left`): the
   * text keeps its units (px stays px) and anchors (`right=`/`bottom=` stay), the other axis is untouched.
   * `from`: the box the reader sees at the start (the stage's), used only for an axis the text does not give
   * in % or px (em, no size): it seeds what the reader sees, never what the text already says.
   */
  | { type: 'float-geom'; index: number; box: Partial<FloatBox>; from?: FloatBox }
  | { type: 'float-delete'; index: number }
  | { type: 'float-z'; index: number; dir: 'forward' | 'backward' }
  | { type: 'variant'; v: number }
  | { type: 'options'; set: SlideOptionChanges }
  | { type: 'slide-add'; after?: boolean }
  | { type: 'slide-duplicate' }
  | { type: 'slide-delete' }
  | { type: 'slide-move'; to: number };

/** What an op does to the text. */
export interface OpResult {
  /** The minimal line edits (sorted; offsets in the OLD text). */
  edits: TextEdit[];
  /** The text after the edits. */
  text: string;
  /** A short description for the undo step and the status line ("Split left into columns"). */
  label: string;
  /** The slide to show after the op (0-based, in the new text). */
  slide: number;
  /** What to select after the op (offsets in the new text), when there is something to select. */
  select?: { from: number; to: number };
  /** The changed lines (offsets in the new text, whole lines) — what an editor flashes. */
  changed: Array<{ from: number; to: number }>;
  /** What the op made or acted on, for the GUI to select (the new float's number, the new box's name). */
  target?: { box: string } | { float: number } | { block: 'notes' | 'footer' };
}

/** The preset picker's names (the words of the GUI, in labels and refusals too: round B, GUI-9). */
export const PRESET_LABEL: Readonly<Record<PresetChoice, string>> = Object.freeze({ single: 'One box', '2col': 'Two columns', '3col': 'Three columns', '2row': 'Two rows', 'main-side': 'Main and side', quad: 'Four boxes' });
/** The template slides' names. */
export const TEMPLATE_LABEL: Readonly<Record<string, string>> = Object.freeze({ title: 'Title page', section: 'Section page', outline: 'Outline', closing: 'Closing page' });

/** Why an op was refused (the GUI shows `message`). */
export class LayoutOpError extends Error {
  constructor(public readonly code: 'no-slide' | 'no-box' | 'only-box' | 'bad-name' | 'template' | 'normal' | 'blocked' | 'no-float' | 'no-change' | 'bad-value' | 'only-slide' | 'unsafe', message: string) {
    super(message);
    this.name = 'LayoutOpError';
  }
}

/** The logical slide size of a ratio (height 720, Q2): float px ↔ % conversions. */
export const SLIDE_SIZE = Object.freeze({ '16:9': { width: 1280, height: 720 }, '4:3': { width: 960, height: 720 } });

/* ───────────────────────── lines ───────────────────────── */

interface Ln {
  /** The line without its terminator. */
  t: string;
  /** Its terminator ('' on a last line without one). */
  e: string;
  /** Part of the slide's title (the leading h2). */
  title?: boolean;
}

function splitLines(s: string): Ln[] {
  const out: Ln[] = [];
  const re = /\r\n|\r|\n/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push({ t: s.slice(at, m.index), e: m[0] });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: s.slice(at), e: '' });
  return out;
}

const blank = (l: Ln): boolean => l.t.trim() === '';

/** The text's line ending: its first, else LF. */
export function eolOf(text: string): string {
  return /\r\n|\r|\n/.exec(text)?.[0] ?? '\n';
}

/* ───────────────────────── the slide as blocks ───────────────────────── */

type BlockKind = 'lead' | 'grid' | 'stray' | 'float' | 'notes' | 'footer';

interface Block {
  kind: BlockKind;
  /** The region it fills (grid / stray: the written name; lead: the primary's; others: their kind). */
  name: string;
  /** Its marker lines (null for the lead). */
  marker: Ln[] | null;
  body: Ln[];
  /** A marker the op wrote (changed or new). */
  touched?: boolean;
}

interface SlideDoc {
  text: string;
  slide: Slide;
  /** Offsets of the slide in the text: its marker line's start to the next marker (or the end). */
  start: number;
  end: number;
  eol: string;
  /** The slide's raw text ends with a line ending. */
  endsWithEol: boolean;
  marker: Ln[];
  blocks: Block[];
  /** The tree as parsed. */
  tree: LayoutNode;
}

/** The blocking lints: a slide with one of these is fixed in the text first (the GUI says why). */
const BLOCKING = new Set(['duplicate-region', 'region-twice', 'marker-not-alone', 'bad-split', 'unknown-layout', 'layout-tracks', 'layout-on-template', 'marker-in-html', 'unclosed-fence', 'unclosed-container', 'unclosed-math', 'unclosed-html', 'unclosed-plugin']);

/** Why the layout ops are off on a slide (null: they are on): a structural problem the text must fix first. */
export function blockingProblem(text: string, index: number): { code: string; message: string; from: number; to: number } | null {
  const deck = parseDeck(text);
  const s = deck.slides[index];
  if (!s) return null;
  const end = s.span.to;
  const l = deck.lint.find((x) => BLOCKING.has(x.code) && (x.from ?? -1) >= s.span.from && (x.from ?? -1) <= end && x.level === 'error');
  return l ? { code: l.code, message: l.message, from: l.from ?? s.marker.from, to: l.to ?? s.marker.to } : null;
}

function slideBounds(text: string, index: number): { slide: Slide; start: number; end: number } {
  const deck = parseDeck(text);
  const slide = deck.slides[index];
  if (!slide) throw new LayoutOpError('no-slide', `there is no slide ${index + 1}`);
  const next = deck.slides[index + 1];
  return { slide, start: slide.marker.from, end: next ? next.marker.from : text.length };
}

function readSlide(text: string, index: number): SlideDoc {
  const { slide, start, end } = slideBounds(text, index);
  const raw = text.slice(start, end);
  const lines = splitLines(raw);
  const eol = /\r\n|\r|\n/.exec(raw)?.[0] ?? eolOf(text);
  const first = slide.marker.line - 1;
  const rel = (absLine: number): number => absLine - first;
  // title lines
  if (slide.titleSpan) for (let i = rel(slide.titleSpan.line - 1); i < rel(slide.titleSpan.endLine); i++) if (lines[i]) lines[i].title = true;
  // the slide's own markers, read from its source alone (a slide starts at a marker: the same markers as in the whole text)
  const markers = scanMarkers(raw, { alone: true }).filter((m) => m.type === 'region' && m.span.from >= slide.marker.to - start);
  const markerEnd = rel(slide.marker.endLine);
  const blocks: Block[] = [];
  const grid = leaves(slide.layout);
  const isTemplate = slide.kind === 'template';
  const leadEnd = markers.length > 0 ? markers[0].span.line - 1 : lines.length;
  blocks.push({ kind: 'lead', name: firstLeaf(slide.layout), marker: null, body: lines.slice(markerEnd, leadEnd) });
  markers.forEach((m, k) => {
    const a = m.span.line - 1;
    const b = m.span.endLine;
    const e = k + 1 < markers.length ? markers[k + 1].span.line - 1 : lines.length;
    const lower = (m.name ?? '').toLowerCase();
    const kind: BlockKind = lower === 'float' ? 'float' : lower === 'notes' ? 'notes' : lower === 'footer' ? 'footer'
      : (isTemplate ? m.name === DEFAULT_REGION : grid.includes(m.name!)) ? 'grid' : 'stray';
    blocks.push({ kind, name: kind === 'grid' || kind === 'stray' ? m.name! : kind, marker: lines.slice(a, b), body: lines.slice(b, e) });
  });
  return { text, slide, start, end, eol, endsWithEol: lines.length > 0 && lines[lines.length - 1].e !== '', marker: lines.slice(0, markerEnd), blocks, tree: slide.layout };
}

/** An author comment on a line of its own (not a marker): the parser does not count a lead of only these as content. */
const COMMENT_LINE = /^[ \t]{0,3}<!--(?!\s*(?:slide\b|@[A-Za-z0-9_-]))[\s\S]*-->[ \t]*$/;

/** The lead's content lines (not the title, not blank at its ends) — the primary region's text when it has any (a lead of only author comments has none, as in the parser). */
function leadContentRange(lead: Block): [number, number] | null {
  let a = 0;
  while (a < lead.body.length && (blank(lead.body[a]) || lead.body[a].title)) a++;
  let b = lead.body.length;
  while (b > a && blank(lead.body[b - 1])) b--;
  if (a >= b) return null;
  if (lead.body.slice(a, b).every((l) => blank(l) || l.title || COMMENT_LINE.test(l.t))) return null;
  return [a, b];
}

/** Content lines of a marker block's body (title lines and blank ends removed). */
function contentOf(lines: Ln[]): Ln[] {
  const c = lines.filter((l) => !l.title);
  let a = 0;
  let b = c.length;
  while (a < b && blank(c[a])) a++;
  while (b > a && blank(c[b - 1])) b--;
  return c.slice(a, b);
}

const hasContent = (lines: Ln[]): boolean => lines.some((l) => !l.title && !blank(l));

/* ───────────────────────── names ───────────────────────── */

/** Why a name cannot be a region's (null: it can): letters first, then letters, digits, - and _; not reserved, not a layout word, not taken. */
export function nameProblem(name: string, taken: readonly string[]): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return 'a name starts with a letter and has only letters, digits, - and _';
  if (RESERVED_REGIONS.includes(name.toLowerCase())) return `"${name}" is reserved (notes, footer and float are not layout boxes)`;
  if (name === 'row' || name === 'col') return `"${name}" is a layout word`;
  if (taken.includes(name)) return `there is already a box called "${name}"`;
  if (name.length > 40) return 'a name has at most 40 characters';
  return null;
}

/** A short unique name from a base: `left` → `left-2`, `left-2` → `left-3`. */
export function freshName(base: string, taken: readonly string[]): string {
  const stem = base.replace(/-\d+$/, '') || 'box';
  for (let k = 2; ; k++) {
    const n = `${stem}-${k}`;
    if (!taken.includes(n) && nameProblem(n, []) === null) return n;
  }
}

function takenNames(d: SlideDoc, tree: LayoutNode): string[] {
  return [...new Set([...leaves(tree), ...leaves(d.tree), ...d.blocks.filter((b) => b.kind === 'grid' || b.kind === 'stray').map((b) => b.name)])];
}

/* ───────────────────────── tree helpers ───────────────────────── */

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The path (child indices) of a leaf, or null. */
export function pathOf(n: LayoutNode, name: string, path: number[] = []): number[] | null {
  if (n.kind === 'region') return n.name === name ? path : null;
  for (let i = 0; i < n.children.length; i++) {
    const p = pathOf(n.children[i], name, [...path, i]);
    if (p) return p;
  }
  return null;
}

export function nodeAt(n: LayoutNode, path: readonly number[]): LayoutNode | null {
  let cur: LayoutNode = n;
  for (const i of path) {
    if (cur.kind !== 'split' || !cur.children[i]) return null;
    cur = cur.children[i];
  }
  return cur;
}

function replaceAt(root: LayoutNode, path: readonly number[], node: LayoutNode): LayoutNode {
  if (path.length === 0) return node;
  const parent = nodeAt(root, path.slice(0, -1)) as SplitNode;
  parent.children[path[path.length - 1]] = node;
  return root;
}

const lastLeaf = (n: LayoutNode): string => (n.kind === 'region' ? n.name : lastLeaf(n.children[n.children.length - 1]));

function renameLeaves(n: LayoutNode, map: ReadonlyMap<string, string>): LayoutNode {
  if (n.kind === 'region') return leaf(map.get(n.name) ?? n.name);
  return split(n.dir, [...n.tracks], n.children.map((c) => renameLeaves(c, map)));
}

/** Every split of a tree in pre-order (the DOM order of `.orz-split`), with its path. */
export function splitsOf(n: LayoutNode, path: number[] = [], out: Array<{ path: number[]; node: SplitNode }> = []): Array<{ path: number[]; node: SplitNode }> {
  if (n.kind === 'split') {
    out.push({ path, node: n });
    n.children.forEach((c, i) => splitsOf(c, [...path, i], out));
  }
  return out;
}

/* ───────────────────────── track arithmetic ───────────────────────── */

interface Frac { n: number; d: number }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
const frac = (n: number, d = 1): Frac => { const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
const fadd = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);

/** A track as a rational number of fr (`2`, `1.5`, `3fr`), or null (auto, %, px, em, rem). */
export function trackFr(t: string): Frac | null {
  const m = /^(\d+)(?:\.(\d+))?(fr)?$/.exec(t.trim());
  if (!m) return null;
  const dec = (m[2] ?? '').slice(0, 4);
  return frac(Number(m[1] + dec), 10 ** dec.length);
}

/** Rationals scaled to the smallest whole numbers with the same proportions. */
function wholeNumbers(fs: Frac[]): number[] {
  const L = fs.reduce((a, f) => lcm(a, f.d), 1);
  const ints = fs.map((f) => (f.n * L) / f.d);
  const G = ints.reduce((a, b) => gcd(a, b), 0) || 1;
  return ints.map((x) => x / G);
}

/** fr tracks written as small whole numbers (the `fr` suffix kept where written); other tracks as written. */
function normaliseTracks(tracks: string[], values: Array<Frac | null>): string[] {
  const idx = values.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const ints = wholeNumbers(idx.map((i) => values[i]!));
  const out = tracks.slice();
  idx.forEach((i, k) => { out[i] = `${ints[k]}${/fr$/.test(tracks[i]) ? 'fr' : ''}`; });
  return out;
}

/** The simple ratios a divider snaps to: p:q with p, q ≤ 4 but not 3:4 / 4:3 (too close to 1:1) — 1:4 … 1:1 … 4:1, smallest share first. */
export const SNAP_RATIOS: ReadonlyArray<readonly [number, number]> = Object.freeze((() => {
  const out: Array<[number, number]> = [];
  for (let p = 1; p <= 4; p++) for (let q = 1; q <= 4; q++) if (gcd(p, q) === 1 && p * q !== 12) out.push([p, q]);
  return out.sort((x, y) => x[0] / (x[0] + x[1]) - y[0] / (y[0] + y[1]));
})());

/**
 * The tracks of a split after its divider `i` (between child i and i+1) is set to the ratio p:q — from
 * the TEXT only: the pair keeps its total share (a non-fr track in the pair counts as the split's mean fr
 * track, then becomes fr); the other tracks stay as written.
 */
export function tracksForRatio(tracks: readonly string[], i: number, [p, q]: readonly [number, number]): string[] {
  const values = tracks.map(trackFr);
  const frs = values.filter((v): v is Frac => v !== null);
  const mean = frs.length > 0 ? frs.reduce(fadd, frac(0)) : frac(1);
  const unit = frs.length > 0 ? frac(mean.n, mean.d * frs.length) : frac(1);
  const a = values[i] ?? unit;
  const b = values[i + 1] ?? unit;
  const S = fadd(a, b);
  values[i] = frac(S.n * p, S.d * (p + q));
  values[i + 1] = frac(S.n * q, S.d * (p + q));
  const t = tracks.slice();
  if (!trackFr(t[i])) t[i] = '1';
  if (!trackFr(t[i + 1])) t[i + 1] = '1';
  return normaliseTracks(t, values);
}

/** The nearest simple ratio to a fraction f (0..1) of the pair's size. */
export function nearestRatio(f: number): readonly [number, number] {
  let best = SNAP_RATIOS[0];
  let bd = Infinity;
  for (const r of SNAP_RATIOS) {
    const d = Math.abs(r[0] / (r[0] + r[1]) - f);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

/** The ratio a divider's pair has in the text (null when a track of the pair is not fr). */
export function pairRatio(tracks: readonly string[], i: number): readonly [number, number] | null {
  const a = trackFr(tracks[i] ?? '');
  const b = trackFr(tracks[i + 1] ?? '');
  if (!a || !b) return null;
  const [x, y] = wholeNumbers([a, b]);
  return [x, y];
}

/** The next simple ratio from the pair's current one, one step towards the first (-1) or the second (+1) child growing. */
export function stepRatio(tracks: readonly string[], i: number, dir: 1 | -1): readonly [number, number] {
  const a = trackFr(tracks[i] ?? '');
  const b = trackFr(tracks[i + 1] ?? '');
  const f = a && b ? (a.n / a.d) / (a.n / a.d + b.n / b.d) : 0.5;
  const share = (r: readonly [number, number]): number => r[0] / (r[0] + r[1]);
  if (dir > 0) return SNAP_RATIOS.find((r) => share(r) > f + 1e-6) ?? SNAP_RATIOS[SNAP_RATIOS.length - 1];
  for (let k = SNAP_RATIOS.length - 1; k >= 0; k--) if (share(SNAP_RATIOS[k]) < f - 1e-6) return SNAP_RATIOS[k];
  return SNAP_RATIOS[0];
}

/** The largest sum of a split's fr tracks a divider writes (three-track ratios stay simple: coordinator decision, round B OPS-4). */
export const SNAP_SUM = 12;

/**
 * The places divider `i` of a split of three or more tracks snaps to: the whole track set in small whole
 * numbers — the other fr tracks scaled by k, the pair keeping its share of the split (so every other
 * divider stays where it is), the fr tracks summing to at most {@link SNAP_SUM} (a text that already sums
 * to more keeps its own numbers, k = 1). `f`: the first child's share of the pair. Null when a track of
 * the pair is not fr.
 */
function snapCandidates(tracks: readonly string[], i: number): Array<{ tracks: string[]; f: number; sum: number }> | null {
  const values = tracks.map(trackFr);
  if (!values[i] || !values[i + 1]) return null;
  const idx = values.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
  const ints = wholeNumbers(idx.map((k) => values[k]!));
  const at = new Map(idx.map((k, j) => [k, ints[j]]));
  const pair = at.get(i)! + at.get(i + 1)!;
  const total = ints.reduce((x, y) => x + y, 0);
  const out = new Map<string, { tracks: string[]; f: number; sum: number }>();
  for (let k = 1; k === 1 || k * total <= SNAP_SUM; k++) {
    for (let a = 1; a < k * pair; a++) {
      const nums = idx.map((t) => (t === i ? a : t === i + 1 ? k * pair - a : k * at.get(t)!));
      const g = nums.reduce((x, y) => gcd(x, y), 0) || 1;
      const red = nums.map((x) => x / g);
      const t = tracks.slice();
      idx.forEach((tk, j) => { t[tk] = `${red[j]}${/fr$/.test(tracks[tk]) ? 'fr' : ''}`; });
      const key = t.join('/');
      const sum = red.reduce((x, y) => x + y, 0);
      if (!out.has(key)) out.set(key, { tracks: t, f: a / (k * pair), sum });
    }
  }
  return [...out.values()].sort((x, y) => x.f - y.f || x.sum - y.sum);
}

/**
 * How divider `i` of a split snaps (round B2, B2-OPS-3): `ratio` — the pair alone through {@link SNAP_RATIOS}
 * (two tracks, or a pair whose two fr tracks are the split's only fr tracks: the fixed ones stay as written) —
 * or the whole split through {@link snapCandidates}, from `tracks` in which a fixed track of the pair (px, auto,
 * em) is written as the split's mean fr track, as {@link tracksForRatio} does (so the sum stays ≤ {@link SNAP_SUM}).
 */
function snapPlan(tracks: readonly string[], i: number): { ratio: true } | { ratio: false; tracks: string[]; c: Array<{ tracks: string[]; f: number; sum: number }> } {
  if (tracks.length <= 2) return { ratio: true };
  const values = tracks.map(trackFr);
  const frCount = values.filter((v) => v !== null).length;
  if (values[i] && values[i + 1] && frCount === 2) return { ratio: true };
  let t = tracks.slice();
  if (!values[i] || !values[i + 1]) {
    const frs = values.filter((v): v is Frac => v !== null);
    const unit = frs.length > 0 ? frac(frs.reduce(fadd, frac(0)).n, frs.reduce(fadd, frac(0)).d * frs.length) : frac(1);
    if (!values[i]) { values[i] = unit; t[i] = '1'; }
    if (!values[i + 1]) { values[i + 1] = unit; t[i + 1] = '1'; }
    t = normaliseTracks(t, values);
  }
  const c = snapCandidates(t, i);
  return c && c.length > 0 ? { ratio: false, tracks: t, c } : { ratio: true };
}

/** The tracks after divider `i` is dragged to `f` (the first child's share of the pair): two tracks snap to {@link SNAP_RATIOS}; three or more to {@link snapCandidates} (see {@link snapPlan}). */
export function snapTracks(tracks: readonly string[], i: number, f: number): string[] {
  const plan = snapPlan(tracks, i);
  if (plan.ratio) return tracksForRatio(tracks, i, nearestRatio(f));
  const c = plan.c;
  let best = c[0];
  for (const x of c) if (Math.abs(x.f - f) < Math.abs(best.f - f) - 1e-9 || (Math.abs(Math.abs(x.f - f) - Math.abs(best.f - f)) <= 1e-9 && x.sum < best.sum)) best = x;
  return best.tracks;
}

/** One key step of divider `i`: the next snap place, the divider moving back (-1: the first child shrinks) or forward (+1: it grows). */
export function stepTracks(tracks: readonly string[], i: number, dir: 1 | -1): string[] {
  const plan = snapPlan(tracks, i);
  if (plan.ratio) return tracksForRatio(tracks, i, stepRatio(tracks, i, dir));
  const c = plan.c;
  const a = trackFr(plan.tracks[i])!;
  const b = trackFr(plan.tracks[i + 1])!;
  const f = (a.n / a.d) / (a.n / a.d + b.n / b.d);
  const shares = [...new Set(c.map((x) => x.f))];
  const next = dir > 0 ? shares.find((x) => x > f + 1e-9) : [...shares].reverse().find((x) => x < f - 1e-9);
  if (next === undefined) return plan.tracks;
  return c.filter((x) => Math.abs(x.f - next) < 1e-9).sort((x, y) => x.sum - y.sum)[0].tracks;
}

/* ───────────────────────── tree ops (pure, on the layout tree) ───────────────────────── */

/** Split a box into two columns or rows: a new sibling sharing its track (same direction as its parent) or a new split. */
export function splitTree(tree: LayoutNode, box: string, dir: 'row' | 'col', fresh: string): LayoutNode {
  const t = clone(tree);
  const path = pathOf(t, box);
  if (!path) throw new LayoutOpError('no-box', `there is no box "${box}"`);
  const parent = path.length ? (nodeAt(t, path.slice(0, -1)) as SplitNode) : null;
  if (parent && parent.dir === dir) {
    const i = path[path.length - 1];
    const tr = parent.tracks[i];
    const f = trackFr(tr);
    const unit = /^(\d+(?:\.\d+)?)(%|px|em|rem)$/.exec(tr);
    const half = f ? tr : unit ? `${+(Number(unit[1]) / 2).toFixed(2)}${unit[2]}` : tr;
    const values = parent.tracks.map(trackFr);
    parent.tracks.splice(i, 1, half, half);
    values.splice(i, 1, f ? frac(f.n, f.d * 2) : null, f ? frac(f.n, f.d * 2) : null);
    parent.children.splice(i + 1, 0, leaf(fresh));
    parent.tracks = normaliseTracks(parent.tracks, values);
    return t;
  }
  return replaceAt(t, path, split(dir, ['1', '1'], [leaf(box), leaf(fresh)]));
}

/** Delete a box: its neighbour (previous sibling, else next) takes its track; returns the tree and that neighbour (the box its content goes to). */
export function deleteTree(tree: LayoutNode, box: string): { tree: LayoutNode; target: string } {
  let t = clone(tree);
  const path = pathOf(t, box);
  if (!path) throw new LayoutOpError('no-box', `there is no box "${box}"`);
  if (path.length === 0) throw new LayoutOpError('only-box', 'this is the only box on the slide');
  const pp = path.slice(0, -1);
  const parent = nodeAt(t, pp) as SplitNode;
  const i = path[path.length - 1];
  const before = i > 0;
  const ni = before ? i - 1 : i + 1;
  const target = before ? lastLeaf(parent.children[ni]) : firstLeaf(parent.children[ni]);
  const fi = trackFr(parent.tracks[i]);
  const fn = trackFr(parent.tracks[ni]);
  const values = parent.tracks.map(trackFr);
  if (fi && fn) values[ni] = fadd(fi, fn);
  parent.children.splice(i, 1);
  parent.tracks.splice(i, 1);
  values.splice(i, 1);
  parent.tracks = normaliseTracks(parent.tracks, values);
  if (parent.children.length === 1) t = replaceAt(t, pp, parent.children[0]);
  return { tree: normalizeTree(t), target };
}

/** Set the tracks of the split at `path`. */
export function tracksTree(tree: LayoutNode, path: readonly number[], tracks: readonly string[]): LayoutNode {
  const t = clone(tree);
  const node = nodeAt(t, path);
  if (!node || node.kind !== 'split' || node.tracks.length !== tracks.length) throw new LayoutOpError('no-box', 'there is no such divider');
  if (tracks.some((x) => !/^(?:(?:\d+(?:\.\d+)?|\.\d+)(?:fr|%|px|em|rem)?|auto)$/.test(x))) throw new LayoutOpError('bad-value', `invalid track size in ${tracks.join('/')}`);
  node.tracks = [...tracks];
  return t;
}

/** A preset's tree (`single`: the one `body` region). */
export function presetTree(p: PresetChoice): LayoutNode {
  return p === 'single' ? leaf(DEFAULT_REGION) : expandPreset(p)!;
}

/** How a preset maps the boxes of a tree: same name first, then reading order; extra boxes go to the preset's last box. */
export function presetMapping(tree: LayoutNode, p: PresetChoice): Map<string, string> {
  const oldNames = leaves(tree);
  const newNames = leaves(presetTree(p));
  const map = new Map<string, string>();
  for (const n of oldNames) if (newNames.includes(n)) map.set(n, n);
  const free = newNames.filter((n) => ![...map.values()].includes(n));
  for (const n of oldNames) if (!map.has(n)) map.set(n, free.shift() ?? newNames[newNames.length - 1]);
  return map;
}

/** The preset a tree is (null: a custom split). */
export function presetOf(tree: LayoutNode): PresetChoice | null {
  const t = normalizeTree(tree);
  if (t.kind === 'region') return t.name === DEFAULT_REGION ? 'single' : null;
  for (const p of PRESETS) {
    const e = expandPreset(p)!;
    if (leaves(e).join() !== leaves(t).join()) continue;
    if (p === 'quad' ? sameTree(e, t) : t.dir === (e as SplitNode).dir && t.children.every((c) => c.kind === 'region')) return p;
  }
  return null;
}

/* ───────────────────────── floats (text geometry) ───────────────────────── */

/** A float length in % of a size, from the text: `30%`, `300px`, `0`; null for other units or none. */
function pct(v: string | undefined, size: number): number | null {
  if (v === undefined) return null;
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%|px)?$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;
  return m[2] === '%' ? n : (n / size) * 100;
}

/** The box of a float from its marker (TEXT only, % of the logical slide): right/bottom and px converted; what the text does not say, the GUI's default (60, 10, 30 × 20). */
export function floatBox(geom: FloatGeom, ratio: '16:9' | '4:3' = '16:9'): FloatBox & { exact: boolean } {
  const { width, height } = SLIDE_SIZE[ratio];
  const w = pct(geom.w, width);
  const h = pct(geom.h, height);
  const r = pct(geom.right, width);
  const b = pct(geom.bottom, height);
  const l = pct(geom.left, width);
  const t = pct(geom.top, height);
  const W = w ?? 30;
  const H = h ?? 20;
  return {
    left: l ?? (r !== null ? 100 - r - W : 60),
    top: t ?? (b !== null ? 100 - b - H : 10),
    w: W,
    h: H,
    exact: w !== null && h !== null && (l !== null || r !== null) && (t !== null || b !== null),
  };
}

const round1 = (x: number): string => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
const overlaps = (a: FloatBox, b: FloatBox): boolean => a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;

/** The area two boxes share. */
const overlapArea = (a: FloatBox, b: FloatBox): number => Math.max(0, Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top));

/**
 * Where a new float goes (round B, GUI-2): the place on a 2 % grid that overlaps no existing float and
 * covers the least of the slide's `content` (its title band, its text and pictures — the GUI's stage
 * knows them; % of the slide), the bottom right first among equals; `covers` says it covers some. When
 * every place overlaps a float: offset 4 % right and down from the last float (kept on the slide).
 */
export function placeFloat(existing: readonly FloatBox[], size: { w: number; h: number } = { w: 30, h: 22 }, content: readonly FloatBox[] = []): FloatBox & { covers: boolean } {
  const { w, h } = size;
  let best: FloatBox | null = null;
  let bestScore = Infinity;
  for (let y = Math.max(2, 98 - h); y >= 2; y -= 2) {
    for (let x = Math.max(2, 98 - w); x >= 2; x -= 2) {
      const c = { left: x, top: y, w, h };
      if (existing.some((e) => overlaps(c, e))) continue;
      const score = content.reduce((sum, r) => sum + overlapArea(c, r), 0);
      if (score < bestScore - 1e-9) { best = c; bestScore = score; }
    }
  }
  if (best) return { left: Math.round(best.left), top: Math.round(best.top), w, h, covers: bestScore > 0.5 };
  const last = existing[existing.length - 1] ?? { left: 60, top: 10, w, h };
  const off = { left: Math.round(Math.min(100 - w, last.left + 4)), top: Math.round(Math.min(100 - h, last.top + 4)), w, h };
  return { ...off, covers: true };
}

/** A float's geometry with some keys set (`undefined` removes one). */
function withSet(g: FloatGeom, set: Record<string, string | undefined>): FloatGeom {
  const out: Record<string, unknown> = { ...g };
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete out[k];
    else out[k] = k === 'z' ? Number(v) : v;
  }
  return out as FloatGeom;
}

/** A length's unit as written: '%', 'px', or another (em, rem, …: not a share of the slide), or none. */
const unitOf = (v: string | undefined): '%' | 'px' | 'other' | null => (v === undefined ? null : /%$/.test(v.trim()) ? '%' : /px$/i.test(v.trim()) ? 'px' : /^-?0*\.?0*$/.test(v.trim()) ? '%' : 'other');

/**
 * The marker keys a float move or resize writes (round B, OPS-3): per axis, only when the op changes it;
 * a value in px stays px (whole px), in % stays %; an anchor stays — a float placed by `right=` is moved
 * by its `right=`; what the text gives in em (or not at all) is written in %, from the box the reader
 * saw (`from`) — refused without it.
 */
function floatGeomEdits(g: FloatGeom, ratio: '16:9' | '4:3', box: Partial<FloatBox>, from: FloatBox | undefined, index: number): Record<string, string | undefined> {
  const { width, height } = SLIDE_SIZE[ratio];
  const set: Record<string, string | undefined> = {};
  const fin = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
  const axis = (pos: 'left' | 'top', end: 'right' | 'bottom', size: 'w' | 'h', total: number, newPos: number | undefined, newSize: number | undefined): void => {
    if (!fin(newPos) && !fin(newSize)) return;
    const say = (k: string): string => `float ${index + 1}'s ${k} is not in % or px: move it on the stage, or write its ${k} in % or px`;
    const p = pct(g[pos], total);
    const e = pct(g[end], total);
    const sz = pct(g[size], total);
    // the box the reader starts from: the text's where it is exact, else the stage's
    const S = sz ?? from?.[size === 'w' ? 'w' : 'h'];
    const P0 = p ?? (e !== null && S !== undefined ? 100 - e - S : from?.[pos]);
    const write = (k: string, v: string | undefined, pctValue: number, base: number): void => {
      const u = unitOf(v);
      set[k] = u === 'px' ? `${Math.round((pctValue / 100) * base)}px` : `${round1(pctValue)}%`;
    };
    const dPos = fin(newPos) ? (P0 === undefined ? NaN : newPos - P0) : 0;
    const dSize = fin(newSize) ? (S === undefined ? NaN : newSize - S) : 0;
    if (Number.isNaN(dPos)) throw new LayoutOpError('bad-value', say(pos));
    if (Number.isNaN(dSize)) throw new LayoutOpError('bad-value', say(size === 'w' ? 'width' : 'height'));
    const anchoredEnd = g[pos] === undefined && g[end] !== undefined;
    if (anchoredEnd) {
      // moved (or grown on its start side) by its end anchor
      if (dPos !== 0 || dSize !== 0) {
        const eNow = e ?? (P0 !== undefined && S !== undefined ? 100 - P0 - S : undefined);
        if (eNow === undefined) throw new LayoutOpError('bad-value', say(end));
        write(end, g[end], eNow - dPos - dSize, total);
      }
    } else if (dPos !== 0) {
      write(pos, g[pos], (P0 as number) + dPos, total);
      // left AND right written, no size: the box is between them — the far edge follows a move
      if (g[end] !== undefined && g[size] === undefined && e !== null && !fin(newSize)) write(end, g[end], e - dPos, total);
    }
    if (fin(newSize) && dSize !== 0) write(size, g[size], Math.max(1, (S as number) + dSize), total);
  };
  axis('left', 'right', 'w', width, box.left, box.w);
  axis('top', 'bottom', 'h', height, box.top, box.h);
  return set;
}

/** The box a GUI starts a float's move or resize from: the text's values where they are in % or px, the stage's (`from`) for the rest. */
export function floatStart(geom: FloatGeom, ratio: '16:9' | '4:3', from?: FloatBox | null): FloatBox | null {
  const { width, height } = SLIDE_SIZE[ratio];
  const one = (pos: 'left' | 'top', end: 'right' | 'bottom', size: 'w' | 'h', total: number): [number, number] | null => {
    const p = pct(geom[pos], total);
    const e = pct(geom[end], total);
    const sz = pct(geom[size], total) ?? from?.[size] ?? null;
    if (sz === null) return null;
    const p0 = p ?? (e !== null ? 100 - e - sz : from?.[pos] ?? null);
    return p0 === null ? null : [p0, sz];
  };
  const x = one('left', 'right', 'w', width);
  const y = one('top', 'bottom', 'h', height);
  return x && y ? { left: x[0], top: y[0], w: x[1], h: y[1] } : null;
}

/** The stacking order of floats (CSS: z-index, then order; the default z-index is the theme's 2). */
export const FLOAT_Z_DEFAULT = 2;
function stackOrder(zs: ReadonlyArray<number | undefined>): number[] {
  return zs.map((z, i) => ({ z: z ?? FLOAT_Z_DEFAULT, i })).sort((a, b) => a.z - b.z || a.i - b.i).map((x) => x.i);
}

/** A float marker with its attributes changed (`undefined` removes a key): the geometry keys in one order (left right top bottom w h z), other tokens after them as written. */
function floatMarkerLine(indent: string, attrs: string, set: Record<string, string | undefined>): string {
  const ORDER = ['left', 'right', 'top', 'bottom', 'w', 'h', 'z'];
  const values = new Map<string, string>();
  const rest: string[] = [];
  for (const tok of tokenizeMarker(attrs)) {
    const m = /^([A-Za-z]+)=([\s\S]*)$/.exec(tok);
    const k0 = m?.[1].toLowerCase() ?? '';
    const k = k0 === 'width' ? 'w' : k0 === 'height' ? 'h' : k0;
    // a key written twice: the last one counts, as the parser reads it (round B, OPS-9); it is written once
    if (m && ORDER.includes(k)) values.set(k, m[2]); else rest.push(tok);
  }
  for (const [k, v] of Object.entries(set)) { if (v === undefined) values.delete(k); else values.set(k, v); }
  const out = [...ORDER.filter((k) => values.has(k)).map((k) => `${k}=${values.get(k)}`), ...rest];
  return `${indent}<!-- @float${out.length ? ` ${out.join(' ')}` : ''} -->`;
}

/* ───────────────────────── realising a slide ───────────────────────── */

const newLine = (t: string, d: SlideDoc): Ln => ({ t, e: d.eol });
const regionMarker = (name: string): string => `<!-- @${name} -->`;

/** The index of the first notes/footer block (floats and new grid markers go before it). */
function tailStart(blocks: Block[]): number {
  const i = blocks.findIndex((b) => b.kind === 'notes' || b.kind === 'footer');
  return i < 0 ? blocks.length : i;
}

/** Insert an empty marker block after block `after`; the trailing blank lines of that block stay before the next marker. */
function insertMarkerAfter(d: SlideDoc, blocks: Block[], after: number, line: string, kind: BlockKind, name: string, spacious: boolean): Block {
  const prev = blocks[after];
  let k = prev.body.length;
  while (k > 0 && blank(prev.body[k - 1])) k--;
  const tail = prev.body.splice(k);
  const marker = [newLine(line, d)];
  // spacious: a blank line between the content before and the new marker (a raw HTML block runs on until one)
  if (spacious && k > 0) prev.body.push(newLine('', d));
  const b: Block = { kind, name, marker, body: tail, touched: true };
  blocks.splice(after + 1, 0, b);
  return b;
}

/**
 * Append content lines at the end of a block's content (one blank line between), before its trailing
 * blank lines; `spacious`: a blank line after them too when none follows (a raw HTML block among them
 * runs on until one).
 */
function appendContent(d: SlideDoc, b: Block, add: Ln[], spacious = false): void {
  if (add.length === 0) return;
  let k = b.body.length;
  while (k > 0 && blank(b.body[k - 1])) k--;
  const before = b.body.slice(0, k);
  const tail = b.body.slice(k);
  const sep = hasContent(before) || (k > 0 && !blank(before[k - 1])) ? [newLine('', d)] : [];
  b.body = [...before, ...sep, ...add, ...(tail.length ? tail : spacious ? [newLine('', d)] : [])];
}

/** Lift a title that sits in a marker block into the lead (right after the slide marker), so moving that block never moves the title. */
function liftTitle(d: SlideDoc, blocks: Block[], from: Block): void {
  if (!from.body.some((l) => l.title)) return;
  const title = from.body.filter((l) => l.title);
  from.body = from.body.filter((l) => !l.title);
  blocks[0].body = [...title, ...blocks[0].body];
  void d;
}

interface Plan {
  /** The new tree (null: the tree does not change). */
  tree: LayoutNode | null;
  /** New option tokens (null: as written). */
  options: string[] | null;
  blocks: Block[];
}

/** Rebuild the slide's text from its marker and blocks. */
function serialiseSlide(d: SlideDoc, plan: Plan): string {
  let marker: Ln[] = d.marker;
  const treeChanged = plan.tree !== null && !sameTree(normalizeTree(plan.tree), d.tree);
  if (treeChanged || plan.options !== null) {
    const indent = /^[ \t]*/.exec(d.marker[0]?.t ?? '')![0];
    const spec = treeChanged ? serialiseLayout(plan.tree!) : d.slide.layoutSpec;
    const opts = plan.options ?? d.slide.optionTokens;
    marker = [{ t: slideMarker(spec, opts, indent), e: d.marker[d.marker.length - 1]?.e || d.eol }];
  }
  const lines: Ln[] = [...marker];
  for (const b of plan.blocks) {
    if (b.marker) lines.push(...b.marker);
    lines.push(...b.body);
  }
  // every line but the last ends; the last as the slide did
  let out = '';
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    out += l.t + (last ? (d.endsWithEol ? (l.e || d.eol) : '') : (l.e || d.eol));
  });
  return out;
}

/* ───────────────────────── the line diff ───────────────────────── */

interface Hunk { a0: number; a1: number; b0: number; b1: number }

/** A line diff (common prefix and suffix, then LCS on the middle). */
function lineDiff(a: readonly string[], b: readonly string[]): Hunk[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s);
  const B = b.slice(p, b.length - s);
  const n = A.length;
  const m = B.length;
  const hunks: Hunk[] = [];
  if (n * m > 4_000_000) {
    if (n || m) hunks.push({ a0: p, a1: p + n, b0: p, b1: p + m });
    return hunks;
  }
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0;
  let j = 0;
  let h: Hunk | null = null;
  const close = (): void => { if (h) { h.a1 = i + p; h.b1 = j + p; hunks.push(h); h = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { close(); i++; j++; continue; }
    if (!h) h = { a0: i + p, a1: i + p, b0: j + p, b1: j + p };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) j++;
    else i++;
  }
  close();
  return hunks;
}

/** Lines with their terminators (the units of the diff). */
function unitLines(s: string): string[] {
  return s.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

/** The edits that turn `oldPart` (at `base` in the text) into `newPart`, and the changed line ranges in the new text. */
function editsFor(text: string, base: number, oldPart: string, newPart: string): { edits: TextEdit[]; changed: Array<{ from: number; to: number }>; text: string } {
  const a = unitLines(oldPart);
  const b = unitLines(newPart);
  const aStart: number[] = [0];
  for (const l of a) aStart.push(aStart[aStart.length - 1] + l.length);
  const bStart: number[] = [0];
  for (const l of b) bStart.push(bStart[bStart.length - 1] + l.length);
  const hunks = lineDiff(a, b);
  const edits: TextEdit[] = hunks.map((h) => ({ from: base + aStart[h.a0], to: base + aStart[h.a1], insert: b.slice(h.b0, h.b1).join('') }));
  const changed = hunks.map((h) => ({ from: base + bStart[h.b0], to: base + bStart[h.b1] }));
  return { edits, changed, text: text.slice(0, base) + newPart + text.slice(base + oldPart.length) };
}

/** Apply sorted, non-overlapping edits to a text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = '';
  let at = 0;
  for (const e of edits) { out += text.slice(at, e.from) + e.insert; at = e.to; }
  return out + text.slice(at);
}

/* ───────────────────────── checking an op ───────────────────────── */

/** What a slide must say after an op. */
interface Expect {
  tree: LayoutNode;
  /** Region name → its Markdown (blank-line runs normalised; empty regions left out). */
  regions: Record<string, string>;
  /** Every float after the op, in order: its Markdown and (unless the op moves it) its geometry. */
  floats: ExpectFloat[];
  /** The notes / footer after the op, when the op changes them (else as before). */
  notes?: string;
  footer?: string;
  /** The op sets the slide's options (else they must read back as they were). */
  options?: true;
}

interface ExpectFloat { md: string; geom: string | null }

/** A float's geometry, canonically (key order fixed), for comparing. */
const geomKey = (g: FloatGeom): string => JSON.stringify(['left', 'right', 'top', 'bottom', 'w', 'h', 'z'].map((k) => g[k as keyof FloatGeom] ?? null));

/** The floats of a slide as an op that does not touch them leaves them. */
const sameFloats = (s: Slide): ExpectFloat[] => s.floats.map((f) => ({ md: normMd(f.markdown), geom: geomKey(f.geom) }));

/** A region's Markdown for comparing: LF, blank-line runs as one, blank lines at the ends dropped — a first line's indentation KEPT (indented code: round B, OPS-8). */
const normMd = (s: string): string => s.replace(/(?:\r\n|\r)/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

function regionsOf(s: Slide): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of s.regions) if (normMd(r.markdown) !== '') out[r.name] = normMd(r.markdown);
  return out;
}

function check(d: SlideDoc, newText: string, index: number, exp: Expect): string | null {
  const nd = parseDeck(newText);
  const ns = nd.slides[index];
  if (!ns) return 'the slide is gone';
  if (!sameTree(normalizeTree(ns.layout), normalizeTree(exp.tree))) return 'the layout does not read back';
  if ((ns.title ?? null) !== (d.slide.title ?? null)) return 'the title moved';
  const notes = 'notes' in exp ? exp.notes : d.slide.notes;
  const footer = 'footer' in exp ? exp.footer : d.slide.footer;
  if ((ns.notes ?? null) !== (notes ?? null) || (ns.footer ?? null) !== (footer ?? null)) return 'the notes or footer changed';
  if (ns.floats.length !== exp.floats.length) return 'a float was lost';
  for (let k = 0; k < exp.floats.length; k++) {
    const e = exp.floats[k];
    if (normMd(ns.floats[k].markdown) !== e.md) return `the text of float ${k + 1} would change`;
    if (e.geom !== null && geomKey(ns.floats[k].geom) !== e.geom) return `float ${k + 1} would move`;
  }
  if (!exp.options && JSON.stringify(ns.options) !== JSON.stringify(d.slide.options)) return 'the slide options would change';
  const got = regionsOf(ns);
  const keys = new Set([...Object.keys(got), ...Object.keys(exp.regions)]);
  for (const k of keys) if ((got[k] ?? '') !== (exp.regions[k] ?? '')) return `the text of "${k}" would change`;
  const before = new Set(d.slide.lint.filter((l) => l.level === 'error').map((l) => l.code));
  const fresh = ns.lint.filter((l) => l.level === 'error' && !before.has(l.code));
  if (fresh.length > 0) return `it would make the error ${fresh[0].code}`;
  if (nd.slides.length !== parseDeck(d.text).slides.length) return 'the number of slides would change';
  // a deck-level problem in the slide (a marker swallowed by a raw HTML block, an unclosed construct): the op was refused before when there was one
  const blocked = blockingProblem(newText, index);
  if (blocked) return `it would make the error ${blocked.code}`;
  return null;
}

/** Old region Markdown by name (normalised). */
const oldRegions = (d: SlideDoc): Record<string, string> => regionsOf(d.slide);

/** The expected regions after an owner map (old name → new name), contents joined in text order. */
function remapRegions(d: SlideDoc, map: ReadonlyMap<string, string>): Record<string, string> {
  const order = d.slide.regions.map((r) => ({ r, at: r.sources[0]?.body.from ?? 0 })).sort((a, b) => a.at - b.at);
  const out: Record<string, string[]> = {};
  for (const { r } of order) {
    const md = normMd(r.markdown);
    if (md === '') continue;
    const to = map.get(r.name) ?? r.name;
    (out[to] ??= []).push(md);
  }
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) res[k] = v.join('\n\n');
  return res;
}

/* ───────────────────────── the slide ops ───────────────────────── */

/** Owner fix-ups after names changed: the lead's content goes to the new primary or gets its own marker; one source per region (merges in text order). */
function settleOwners(d: SlideDoc, blocks: Block[], tree: LayoutNode, leadOwner: string | null, spacious: boolean): void {
  const primary = firstLeaf(tree);
  const lead = blocks[0];
  lead.name = primary;
  // the lead's content belongs to someone else: a marker before it
  const lr = leadContentRange(lead);
  if (lr && leadOwner !== null && leadOwner !== primary) {
    const content = lead.body.splice(lr[0]);
    const m = [newLine(regionMarker(leadOwner), d)];
    if (spacious && lr[0] > 0 && !blank(lead.body[lr[0] - 1])) lead.body.push(newLine('', d));
    blocks.splice(1, 0, { kind: 'grid', name: leadOwner, marker: m, body: content, touched: true });
  }
  const grid = new Set(leaves(tree));
  // reclassify: a stray whose name the tree now has is a grid block, and the other way round
  for (const b of blocks) {
    if (b.kind === 'grid' || b.kind === 'stray') b.kind = grid.has(b.name) ? 'grid' : 'stray';
  }
  // one source per region, in text order: the lead (with content) first
  const sources = (): Array<{ b: Block; i: number }> => blocks.map((b, i) => ({ b, i })).filter(({ b, i }) => (i === 0 ? leadContentRange(b) !== null : b.kind === 'grid'));
  for (let guard = 0; guard < 64; guard++) {
    const src = sources();
    let dup: { first: { b: Block; i: number }; again: { b: Block; i: number } } | null = null;
    for (let x = 0; x < src.length && !dup; x++) for (let y = x + 1; y < src.length && !dup; y++) if (src[x].b.name === src[y].b.name) dup = { first: src[x], again: src[y] };
    if (!dup) break;
    const { first, again } = dup;
    if (again.i === first.i + 1) {
      // adjacent: the marker goes (a blank line keeps the two texts apart)
      const prevLast = first.b.body.length > 0 ? first.b.body[first.b.body.length - 1] : (first.b.marker ? first.b.marker[first.b.marker.length - 1] : undefined);
      const nextFirst = again.b.body[0];
      const needGap = prevLast !== undefined && !blank(prevLast) && nextFirst !== undefined && !blank(nextFirst) && (first.i !== 0 || hasContent(first.b.body));
      if (again.b.body.some((l) => l.title)) liftTitle(d, blocks, again.b);
      first.b.body.push(...(needGap ? [newLine('', d)] : []), ...again.b.body);
      blocks.splice(again.i, 1);
    } else {
      // apart: the later block's content moves to the end of the first's
      if (again.b.body.some((l) => l.title)) liftTitle(d, blocks, again.b);
      appendContent(d, first.b, contentOf(again.b.body), spacious);
      // its trailing blank lines stay where the block was (joined to the block before it)
      blocks.splice(again.i, 1);
    }
  }
}

/** Rewrite the names of grid/stray markers (only where the name changes). */
function renameMarkers(d: SlideDoc, blocks: Block[], map: ReadonlyMap<string, string>): void {
  for (const b of blocks.slice(1)) {
    if (b.kind !== 'grid') continue;
    const to = map.get(b.name);
    if (to === undefined || to === b.name) continue;
    const indent = /^[ \t]*/.exec(b.marker![0].t)![0];
    b.marker = [{ t: `${indent}${regionMarker(to)}`, e: b.marker![b.marker!.length - 1].e || d.eol }];
    b.name = to;
    b.touched = true;
  }
}

/** Insert empty markers for the given regions (that have no source), each after the block of the region before it in reading order. */
function addEmptyMarkers(d: SlideDoc, blocks: Block[], tree: LayoutNode, names: readonly string[], spacious: boolean): void {
  const order = leaves(tree);
  for (const n of names) {
    const has = blocks.some((b, i) => (i === 0 ? leadContentRange(b) !== null && b.name === n : b.kind === 'grid' && b.name === n));
    if (has) continue;
    let after = -1;
    for (let k = order.indexOf(n) - 1; k >= 0 && after < 0; k--) {
      const j = blocks.findIndex((b, i) => (i === 0 ? leadContentRange(b) !== null && b.name === order[k] : b.kind === 'grid' && b.name === order[k]));
      if (j >= 0) after = j;
    }
    if (after < 0) {
      // before the first grid block of a later region, else at the end of the grid blocks
      const later = blocks.findIndex((b, i) => i > 0 && b.kind === 'grid' && order.indexOf(b.name) > order.indexOf(n));
      after = later > 0 ? later - 1 : Math.max(0, lastGridIndex(blocks));
    }
    // never inside or right after a float's, the notes' or the footer's body (round B, OPS-1: a raw-HTML float body
    // swallowed the marker): before that block, after the box text before it
    while (after > 0 && (blocks[after].kind === 'float' || blocks[after].kind === 'notes' || blocks[after].kind === 'footer')) after--;
    insertMarkerAfter(d, blocks, after, regionMarker(n), 'grid', n, spacious);
  }
}

function lastGridIndex(blocks: Block[]): number {
  let k = 0;
  for (let i = 1; i < tailStart(blocks); i++) if (blocks[i].kind === 'grid' || blocks[i].kind === 'stray') k = i;
  return k;
}

/** Where a region's content block is now (index; -1: none). */
function ownerIndex(blocks: Block[], name: string): number {
  return blocks.findIndex((b, i) => (i === 0 ? leadContentRange(b) !== null && b.name === name : b.kind === 'grid' && b.name === name));
}

interface Built { plan: Plan; expect: Expect; label: string; selectName?: string | { float: number } | { block: 'notes' | 'footer' } }

function cloneBlocks(d: SlideDoc): Block[] {
  return d.blocks.map((b) => ({ ...b, marker: b.marker ? [...b.marker] : null, body: [...b.body] }));
}

function requireNormal(d: SlideDoc, what: string): void {
  if (d.slide.kind === 'template') throw new LayoutOpError('template', `a template slide has its own layout (${what} works on normal slides; a template changes its look)`);
}

function buildSlideOp(d: SlideDoc, op: LayoutOp, spacious: boolean): Built {
  const blocks = cloneBlocks(d);
  const tree = d.tree;
  const grid = leaves(tree);
  const ownerMap = (): Map<string, string> => new Map(grid.map((n) => [n, n]));
  const leadOwner0 = leadContentRange(blocks[0]) ? firstLeaf(tree) : null;
  const needBox = (n: string): void => { if (!grid.includes(n)) throw new LayoutOpError('no-box', `there is no box "${n}"`); };
  const floats = d.blocks.filter((b) => b.kind === 'float');
  const floatAt = (i: number): Block => {
    const b = blocks.filter((x) => x.kind === 'float')[i];
    if (!b) throw new LayoutOpError('no-float', `there is no float ${i + 1}`);
    return b;
  };
  const expectSame = (t: LayoutNode = tree): Expect => ({ tree: t, regions: oldRegions(d), floats: sameFloats(d.slide) });

  switch (op.type) {
    case 'split': {
      requireNormal(d, 'splitting');
      needBox(op.box);
      const fresh = freshName(op.box, takenNames(d, tree));
      const t = splitTree(tree, op.box, op.dir, fresh);
      settleOwners(d, blocks, t, leadOwner0, spacious);
      // the new box's empty marker right after the split box's content
      const own = ownerIndex(blocks, op.box);
      if (own >= 0) insertMarkerAfter(d, blocks, own, regionMarker(fresh), 'grid', fresh, spacious);
      else addEmptyMarkers(d, blocks, t, [fresh], spacious);
      return { plan: { tree: t, options: null, blocks }, expect: expectSame(t), label: `Split ${op.box} into ${op.dir === 'col' ? 'columns' : 'rows'}`, selectName: fresh };
    }
    case 'delete-box': {
      requireNormal(d, 'deleting a box');
      needBox(op.box);
      const { tree: t, target } = deleteTree(tree, op.box);
      const map = ownerMap();
      map.set(op.box, target);
      renameMarkers(d, blocks, map);
      settleOwners(d, blocks, t, leadOwner0 === null ? null : (map.get(leadOwner0) ?? leadOwner0), spacious);
      return { plan: { tree: t, options: null, blocks }, expect: { tree: t, regions: remapRegions(d, map), floats: sameFloats(d.slide) }, label: `Delete ${op.box} (its text goes to ${target})`, selectName: target };
    }
    case 'tracks': {
      requireNormal(d, 'resizing');
      const t = tracksTree(tree, op.path, op.tracks);
      if (sameTree(t, tree)) throw new LayoutOpError('no-change', 'the sizes are already these');
      return { plan: { tree: t, options: null, blocks }, expect: expectSame(t), label: `Resize to ${op.tracks.join('/')}` };
    }
    case 'preset': {
      requireNormal(d, 'a layout');
      if (!PRESET_CHOICES.includes(op.preset)) throw new LayoutOpError('bad-value', `unknown layout "${String(op.preset)}"`);
      const t = presetTree(op.preset);
      const map = presetMapping(tree, op.preset);
      // the layout it already has, whatever its sizes: no change (round B, GUI-3 — a custom ratio is never reset by picking its own layout)
      if (presetOf(tree) === op.preset || sameTree(normalizeTree(t), normalizeTree(tree))) {
        throw new LayoutOpError('no-change', op.preset === 'single' ? 'the slide already has one box' : `the slide already has the ${PRESET_LABEL[op.preset]} layout: drag a divider to change the sizes`);
      }
      renameMarkers(d, blocks, map);
      settleOwners(d, blocks, t, leadOwner0 === null ? null : (map.get(leadOwner0) ?? leadOwner0), spacious);
      // every box of the preset has a place in the text
      addEmptyMarkers(d, blocks, t, leaves(t).filter((n) => ownerIndex(blocks, n) < 0 && n !== firstLeaf(t)), spacious);
      return { plan: { tree: t, options: null, blocks }, expect: { tree: t, regions: remapRegions(d, map), floats: sameFloats(d.slide) }, label: `Layout: ${PRESET_LABEL[op.preset]}` };
    }
    case 'rename': {
      requireNormal(d, 'renaming');
      needBox(op.box);
      if (op.to === op.box) throw new LayoutOpError('no-change', 'the box already has this name');
      const problem = nameProblem(op.to, takenNames(d, tree).filter((n) => n !== op.box));
      if (problem) throw new LayoutOpError('bad-name', problem);
      const map = ownerMap();
      map.set(op.box, op.to);
      const t = renameLeaves(tree, map);
      renameMarkers(d, blocks, map);
      settleOwners(d, blocks, t, leadOwner0 === null ? null : (map.get(leadOwner0) ?? leadOwner0), spacious);
      return { plan: { tree: t, options: null, blocks }, expect: { tree: t, regions: remapRegions(d, map), floats: sameFloats(d.slide) }, label: `Rename ${op.box} to ${op.to}`, selectName: op.to };
    }
    case 'swap': {
      requireNormal(d, 'swapping');
      needBox(op.a);
      needBox(op.b);
      if (op.a === op.b) throw new LayoutOpError('no-change', 'a box swaps with another box');
      const map = ownerMap();
      map.set(op.a, op.b);
      map.set(op.b, op.a);
      renameMarkers(d, blocks, map);
      settleOwners(d, blocks, tree, leadOwner0 === null ? null : (map.get(leadOwner0) ?? leadOwner0), spacious);
      return { plan: { tree: null, options: null, blocks }, expect: { tree, regions: remapRegions(d, map), floats: sameFloats(d.slide) }, label: `Swap the text of ${op.a} and ${op.b}`, selectName: op.b };
    }
    case 'move-content': {
      requireNormal(d, 'moving text');
      needBox(op.from);
      needBox(op.to);
      if (op.from === op.to) throw new LayoutOpError('no-change', 'the text moves to another box');
      const fi = ownerIndex(blocks, op.from);
      if (fi < 0 || !hasContent(fi === 0 ? blocks[0].body.slice(leadContentRange(blocks[0])![0]) : blocks[fi].body)) throw new LayoutOpError('no-change', `${op.from} has no text to move`);
      const src = blocks[fi];
      let moved: Ln[];
      if (fi === 0) {
        const [a, b] = leadContentRange(src)!;
        moved = src.body.slice(a, b);
        src.body.splice(a, b - a);
      } else {
        if (src.body.some((l) => l.title)) liftTitle(d, blocks, src);
        moved = contentOf(src.body);
        const keepTail: Ln[] = [];
        let k = src.body.length;
        while (k > 0 && blank(src.body[k - 1])) k--;
        keepTail.push(...src.body.slice(k));
        src.body = keepTail;
      }
      let ti = ownerIndex(blocks, op.to);
      if (ti < 0) {
        addEmptyMarkers(d, blocks, tree, [op.to], spacious);
        ti = ownerIndex(blocks, op.to);
        if (ti < 0) ti = blocks.findIndex((b, i) => i > 0 && b.kind === 'grid' && b.name === op.to);
      }
      appendContent(d, blocks[ti], moved, spacious);
      // the emptied box keeps a place in the text (its marker), so it can be written into again
      if (fi === 0) addEmptyMarkers(d, blocks, tree, [op.from], spacious);
      const exp = oldRegions(d);
      exp[op.to] = [exp[op.to], exp[op.from]].filter((x) => x).join('\n\n');
      delete exp[op.from];
      return { plan: { tree: null, options: null, blocks }, expect: { tree, regions: exp, floats: sameFloats(d.slide) }, label: `Move the text of ${op.from} to ${op.to}`, selectName: op.to };
    }
    case 'ensure-region': {
      const lower = op.name.toLowerCase();
      if (lower === 'notes' || lower === 'footer') {
        const has = blocks.findIndex((b) => b.kind === lower);
        if (has >= 0) throw new LayoutOpError('no-change', `the slide already has its ${lower}`);
        const last = blocks.length - 1;
        insertMarkerAfter(d, blocks, last, `<!-- @${lower} -->`, lower as BlockKind, lower, true);
        return { plan: { tree: null, options: null, blocks }, expect: { ...expectSame(), [lower]: '' }, label: lower === 'notes' ? 'Add speaker notes' : 'Add a slide footer', selectName: { block: lower as 'notes' | 'footer' } };
      }
      if (d.slide.kind === 'template') {
        if (op.name !== DEFAULT_REGION) throw new LayoutOpError('no-box', `a template slide has one region, body`);
      } else needBox(op.name);
      if (ownerIndex(blocks, op.name) >= 0) throw new LayoutOpError('no-change', `${op.name} already has its place in the text`);
      addEmptyMarkers(d, blocks, tree, [op.name], spacious);
      return { plan: { tree: null, options: null, blocks }, expect: expectSame(), label: `Give ${op.name} a place in the text`, selectName: op.name };
    }
    case 'float-add': {
      const ratio = parseDeck(d.text).config.ratio;
      const existing = floats.map((b) => floatBox(readFloatAttrs(markerAttrs(b)).geom, ratio));
      const placed = op.box ? { ...op.box, covers: op.covers === true } : placeFloat(existing);
      const line = `<!-- @float left=${round1(placed.left)}% top=${round1(placed.top)}% w=${round1(placed.w)}% h=${round1(placed.h)}% -->`;
      // after the last float (the new one is the last: drawn on top, its number one more — round B, OPS-6), else after the
      // last grid / stray block — before notes and footer
      const lastFloat = blocks.map((b) => b.kind).lastIndexOf('float');
      let after = 0;
      if (lastFloat > 0) after = lastFloat;
      else for (let i = 1; i < tailStart(blocks); i++) after = i;
      insertMarkerAfter(d, blocks, after, line, 'float', 'float', spacious);
      return { plan: { tree: null, options: null, blocks }, expect: { tree, regions: oldRegions(d), floats: [...sameFloats(d.slide), { md: '', geom: null }] }, label: placed.covers ? 'Add a float — no free place on the slide: it covers some content; drag it where it belongs' : 'Add a float', selectName: { float: floats.length } };
    }
    case 'float-geom': {
      const b = floatAt(op.index);
      const ratio = parseDeck(d.text).config.ratio;
      const g = readFloatAttrs(markerAttrs(b)).geom;
      const set = floatGeomEdits(g, ratio, op.box, op.from, op.index);
      const indent = /^[ \t]*/.exec(b.marker![0].t)![0];
      const line = floatMarkerLine(indent, markerAttrs(b), set);
      if (line === b.marker!.map((l) => l.t).join('\n')) throw new LayoutOpError('no-change', 'the float is already there');
      b.marker = [{ t: line, e: b.marker![b.marker!.length - 1].e || d.eol }];
      b.touched = true;
      const exp = expectSame();
      exp.floats[op.index] = { ...exp.floats[op.index], geom: geomKey(withSet(g, set)) };
      return { plan: { tree: null, options: null, blocks }, expect: exp, label: op.box.w !== undefined || op.box.h !== undefined ? `Resize float ${op.index + 1}` : `Move float ${op.index + 1}`, selectName: { float: op.index } };
    }
    case 'float-delete': {
      const b = floatAt(op.index);
      const i = blocks.indexOf(b);
      // its trailing blank lines stay (joined to the block before)
      let k = b.body.length;
      while (k > 0 && blank(b.body[k - 1])) k--;
      blocks[i - 1].body.push(...b.body.slice(k));
      blocks.splice(i, 1);
      return { plan: { tree: null, options: null, blocks }, expect: { tree, regions: oldRegions(d), floats: sameFloats(d.slide).filter((_, k) => k !== op.index) }, label: `Delete float ${op.index + 1}` };
    }
    case 'float-z': {
      const fl = blocks.filter((x) => x.kind === 'float');
      if (!fl[op.index]) throw new LayoutOpError('no-float', `there is no float ${op.index + 1}`);
      const zs = fl.map((x) => readFloatAttrs(markerAttrs(x)).geom.z);
      const order = stackOrder(zs);
      const pos = order.indexOf(op.index);
      const zOf = (i: number): number => zs[i] ?? FLOAT_Z_DEFAULT;
      // one step in the stacking order (z-index, then order): just above the float above it, or just below the one below
      let z: number;
      if (op.dir === 'forward') {
        if (pos === order.length - 1) throw new LayoutOpError('no-change', 'this float is already in front');
        const j = order[pos + 1];
        z = op.index > j ? zOf(j) : zOf(j) + 1;
      } else {
        if (pos === 0) throw new LayoutOpError('no-change', 'this float is already at the back');
        const j = order[pos - 1];
        z = op.index < j ? zOf(j) : zOf(j) - 1;
      }
      const b = fl[op.index];
      const indent = /^[ \t]*/.exec(b.marker![0].t)![0];
      b.marker = [{ t: floatMarkerLine(indent, markerAttrs(b), { z: String(z) }), e: b.marker![b.marker!.length - 1].e || d.eol }];
      b.touched = true;
      const zExp = expectSame();
      zExp.floats[op.index] = { ...zExp.floats[op.index], geom: geomKey({ ...readFloatAttrs(markerAttrs(fl[op.index])).geom, z }) };
      return { plan: { tree: null, options: null, blocks }, expect: zExp, label: op.dir === 'forward' ? `Bring float ${op.index + 1} forward` : `Send float ${op.index + 1} backward`, selectName: { float: op.index } };
    }
    case 'variant': {
      if (d.slide.kind !== 'template') throw new LayoutOpError('normal', 'only a template slide (a title, section, outline or closing page) has looks');
      const max = TEMPLATES[d.slide.template!];
      const kind = TEMPLATE_LABEL[d.slide.template!] ?? d.slide.template!;
      if (!Number.isInteger(op.v) || op.v < 1 || op.v > max) throw new LayoutOpError('bad-value', `a ${kind.toLowerCase()} has looks 1 to ${max}`);
      if ((d.slide.templateVariant ?? 1) === op.v) throw new LayoutOpError('no-change', `the slide already shows look ${op.v}`);
      const opts = setOption(d.slide.optionTokens, 'v', op.v === 1 ? null : String(op.v));
      return { plan: { tree: null, options: opts, blocks }, expect: { ...expectSame(), options: true }, label: `${kind}: look ${op.v}` };
    }
    case 'options': {
      let opts = [...d.slide.optionTokens];
      const s = op.set;
      if (s.fit !== undefined) {
        if (s.fit !== null && !['fit', 'scroll', 'off'].includes(s.fit)) throw new LayoutOpError('bad-value', 'fit takes fit, scroll or off');
        opts = setOption(opts, 'fit', s.fit === 'fit' ? null : s.fit);
      }
      if (s.transition !== undefined) {
        if (s.transition !== null && !TRANSITION.test(s.transition)) throw new LayoutOpError('bad-value', 'not a transition (none, fade, slide, convex, concave, zoom)');
        opts = setOption(opts, 't', s.transition);
      }
      if (s.bg !== undefined) {
        const v = s.bg === null ? null : s.bg.trim();
        if (v !== null && (v === '' || /-->|[\r\n]|--/.test(v) || (v.includes('"') && v.includes("'")))) throw new LayoutOpError('bad-value', 'a background is a colour, a gradient or an image path on one line, without "--"');
        opts = setOption(opts, 'bg', v === null ? null : /[\s"]/.test(v) ? (v.includes('"') ? `'${v}'` : `"${v}"`) : v);
      }
      if (s.step !== undefined) {
        const has = opts.includes('step');
        if (s.step && !has) opts.push('step');
        if (!s.step && has) opts = opts.filter((t) => t !== 'step');
      }
      if (opts.join(' ') === d.slide.optionTokens.join(' ')) throw new LayoutOpError('no-change', 'the slide already has these options');
      const read = readMarkerArgs([d.slide.layoutSpec, ...opts].filter((x) => x).join(' '));
      const before = new Set(readMarkerArgs([d.slide.layoutSpec, ...d.slide.optionTokens].filter((x) => x).join(' ')).problems.map((p) => p.message));
      const bad = read.problems.find((p) => !before.has(p.message));
      if (bad) throw new LayoutOpError('bad-value', bad.message);
      return { plan: { tree: null, options: opts, blocks }, expect: { ...expectSame(), options: true }, label: 'Slide options' };
    }
    default:
      throw new LayoutOpError('bad-value', `unknown op ${(op as { type: string }).type}`);
  }
}

/** A marker block's attributes (the text after `@name`). */
function markerAttrs(b: Block): string {
  const c = b.marker!.map((l) => l.t).join(' ');
  return /<!--\s*@[A-Za-z0-9_-]+\s*([\s\S]*?)\s*-->/.exec(c)?.[1] ?? '';
}

/** Option tokens with one key set (in place), added (at the end) or removed (`null`). */
function setOption(tokens: readonly string[], key: string, value: string | null): string[] {
  const out: string[] = [];
  let done = false;
  for (const t of tokens) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)=/.exec(t);
    if (m && m[1] === key) {
      if (!done && value !== null) out.push(`${key}=${value}`);
      done = true;
      continue;
    }
    out.push(t);
  }
  if (!done && value !== null) out.push(`${key}=${value}`);
  return out;
}

/* ───────────────────────── where things are (for the GUI) ───────────────────────── */

/** A text range. */
export interface Range { from: number; to: number }

/** Where each part of a slide is in the text — what a click selects, what the caret is in. */
export interface SlideMap {
  index: number;
  kind: 'normal' | 'template';
  /** Each layout box: its content range (empty at the line after its marker when it has no text), or null with no place in the text. */
  boxes: Array<{ name: string; range: Range | null; marker: Range | null; empty: boolean }>;
  title: Range | null;
  floats: Array<{ range: Range; marker: Range; box: FloatBox; z: number | undefined; empty: boolean; exact: boolean }>;
  notes: Range | null;
  footer: Range | null;
  /** The slide's marker line(s). */
  marker: Range;
  span: Range;
}

/** The map of a slide (see {@link SlideMap}). */
export function slideMap(text: string, index: number): SlideMap | null {
  let d: SlideDoc;
  try { d = readSlide(text, index); } catch { return null; }
  const ratio = parseDeck(text).config.ratio;
  // offsets of each block's lines
  let at = d.start;
  for (const l of d.marker) at += l.t.length + l.e.length;
  const where: Array<{ b: Block; markerFrom: number; markerTo: number; bodyFrom: number; bodyLines: Array<{ from: number; to: number; l: Ln }> }> = [];
  for (const b of d.blocks) {
    const markerFrom = at;
    if (b.marker) for (const l of b.marker) at += l.t.length + l.e.length;
    const markerTo = b.marker ? at - (b.marker[b.marker.length - 1].e.length) : at;
    const bodyFrom = at;
    const bodyLines: Array<{ from: number; to: number; l: Ln }> = [];
    for (const l of b.body) { bodyLines.push({ from: at, to: at + l.t.length, l }); at += l.t.length + l.e.length; }
    where.push({ b, markerFrom, markerTo, bodyFrom, bodyLines });
  }
  const contentRange = (w: (typeof where)[number]): Range | null => {
    const ls = w.bodyLines.filter((x) => !x.l.title && !blank(x.l));
    if (ls.length === 0) return null;
    return { from: ls[0].from, to: ls[ls.length - 1].to };
  };
  const emptyAt = (w: (typeof where)[number]): Range => {
    const first = w.bodyLines.find((x) => !x.l.title);
    // no body line: the end of its marker line — inside the slide, never the next slide's marker (round B, B-ED-1)
    const p = first ? first.from : w.b.marker ? w.markerTo : (w.bodyLines.length > 0 ? w.bodyLines[w.bodyLines.length - 1].to : w.bodyFrom);
    return { from: p, to: p };
  };
  const boxes: SlideMap['boxes'] = [];
  const names = d.slide.kind === 'template' ? [DEFAULT_REGION] : leaves(d.tree);
  for (const n of names) {
    const wi = where.findIndex((w, i) => (i === 0 ? leadContentRange(w.b) !== null && w.b.name === n : w.b.kind === 'grid' && w.b.name === n));
    if (wi < 0) { boxes.push({ name: n, range: null, marker: null, empty: true }); continue; }
    const w = where[wi];
    const r = contentRange(w);
    boxes.push({ name: n, range: r ?? emptyAt(w), marker: wi === 0 ? null : { from: w.markerFrom, to: w.markerTo }, empty: r === null });
  }
  const fl = where.filter((w) => w.b.kind === 'float').map((w) => {
    const g = readFloatAttrs(markerAttrs(w.b)).geom;
    const r = contentRange(w);
    const fb = floatBox(g, ratio);
    return { range: r ?? emptyAt(w), marker: { from: w.markerFrom, to: w.markerTo }, box: { left: fb.left, top: fb.top, w: fb.w, h: fb.h }, z: g.z, empty: r === null, exact: fb.exact };
  });
  const tail = (k: 'notes' | 'footer'): Range | null => {
    const w = where.find((x) => x.b.kind === k);
    return w ? (contentRange(w) ?? emptyAt(w)) : null;
  };
  return {
    index,
    kind: d.slide.kind,
    boxes,
    title: d.slide.titleSpan ? { from: d.slide.titleSpan.from, to: d.slide.titleSpan.to } : null,
    floats: fl,
    notes: tail('notes'),
    footer: tail('footer'),
    marker: { from: d.slide.marker.from, to: d.slide.marker.to },
    span: { from: d.slide.span.from, to: d.slide.span.to },
  };
}

/** What part of a slide an offset is in (the caret's box): a box name, a float index, the title, notes or footer; null elsewhere. */
export function partAt(map: SlideMap, offset: number): { box: string } | { float: number } | { part: 'title' | 'notes' | 'footer' } | null {
  const inside = (r: Range | null): boolean => !!r && offset >= r.from && offset <= r.to;
  if (inside(map.title)) return { part: 'title' };
  for (const b of map.boxes) if (inside(b.range) || inside(b.marker)) return { box: b.name };
  for (let i = 0; i < map.floats.length; i++) if (inside(map.floats[i].range) || inside(map.floats[i].marker)) return { float: i };
  if (inside(map.notes)) return { part: 'notes' };
  if (inside(map.footer)) return { part: 'footer' };
  return null;
}

/* ───────────────────────── applying ───────────────────────── */

/**
 * Apply one op to slide `index` of a text (see the module comment). Throws a
 * {@link LayoutOpError} when the op cannot apply (no such box, a template, a
 * blocking problem in the slide, nothing to change, or a result that would
 * not read back as meant).
 */
export function applyOp(text: string, index: number, op: LayoutOp): OpResult {
  if (op.type === 'slide-add' || op.type === 'slide-duplicate' || op.type === 'slide-delete' || op.type === 'slide-move') return deckOp(text, index, op);
  const blocked = blockingProblem(text, index);
  if (blocked) throw new LayoutOpError('blocked', `fix this first: ${blocked.message}`);
  let last: string | null = null;
  for (const spacious of [false, true]) {
    const d = readSlide(text, index);
    const built = buildSlideOp(d, op, spacious);
    const raw = text.slice(d.start, d.end);
    const next = serialiseSlide(d, built.plan);
    if (next === raw) throw new LayoutOpError('no-change', 'nothing to change');
    const { edits, changed, text: newText } = editsFor(text, d.start, raw, next);
    const why = check(d, newText, index, built.expect);
    if (why) { last = why; continue; }
    const sel = built.selectName;
    const target = sel === undefined ? undefined : typeof sel === 'string' ? { box: sel } : sel;
    return { edits, text: newText, label: built.label, slide: index, changed, ...selectAfter(newText, index, built.selectName), ...(target ? { target } : {}) };
  }
  throw new LayoutOpError('unsafe', `this change cannot be written safely here (${last})`);
}

function selectAfter(text: string, index: number, sel: Built['selectName']): { select?: Range } {
  if (sel === undefined) return {};
  const m = slideMap(text, index);
  if (!m) return {};
  if (typeof sel === 'string') { const b = m.boxes.find((x) => x.name === sel); return b?.range ? { select: b.range } : {}; }
  if ('float' in sel) { const f = m.floats[sel.float]; return f ? { select: f.range } : {}; }
  const r = m[sel.block];
  return r ? { select: r } : {};
}

/* ───────────────────────── deck ops (whole slide blocks) ───────────────────────── */

function deckOp(text: string, index: number, op: Extract<LayoutOp, { type: 'slide-add' | 'slide-duplicate' | 'slide-delete' | 'slide-move' }>): OpResult {
  const deck = parseDeck(text);
  const n = deck.slides.length;
  const eol = eolOf(text);
  const startOf = (i: number): number => (i < n ? deck.slides[i].marker.from : text.length);
  const endsOpen = !/(?:\r\n|\r|\n)$/.test(text);
  /** A slide's block, ending with a line ending. */
  const blockOf = (i: number): string => {
    const raw = text.slice(startOf(i), startOf(i + 1));
    return /(?:\r\n|\r|\n)$/.test(raw) ? raw : raw + eol;
  };
  const trimEnd = (x: string): string => x.replace(/(?:[ \t]*(?:\r\n|\r|\n))+$/, '').replace(/[ \t]+$/, '');
  /**
   * Insert a block at `at`: a line ending first when `at` is the end of a text without a final one; with
   * `gap`, a blank line first when the line before is not blank (a raw HTML block before it runs on until one).
   */
  const insertAt = (at: number, block: string, gap: boolean): TextEdit => {
    let lead = at === text.length && endsOpen && text.length > 0 ? eol : '';
    if (gap && at > 0) {
      const before = text.slice(0, at) + lead;
      const line = /([^\r\n]*)(?:\r\n|\r|\n)$/.exec(before)?.[1] ?? '';
      if (line.trim() !== '') lead += eol;
    }
    return { from: at, to: at, insert: lead + block };
  };
  /** The op's edits, and the slides' blocks it means (in the new order; trailing blank lines aside). */
  const plan = (gap: boolean): { edits: TextEdit[]; expect: string[]; slide: number; label: string; select?: Range; block?: { at: number; len: number } } => {
    const blocks = deck.slides.map((_, k) => blockOf(k));
    if (op.type === 'slide-add') {
      const after = n === 0 ? false : op.after !== false;
      const at = n === 0 ? text.length : after ? startOf(index + 1) : startOf(index);
      const block = `<!-- slide -->${eol}## New slide${eol}${eol}`;
      const e = insertAt(at, block, gap);
      const s = n === 0 ? 0 : after ? index + 1 : index;
      blocks.splice(s, 0, block);
      const titleAt = at + e.insert.length - block.length + `<!-- slide -->${eol}## `.length;
      return { edits: [e], expect: blocks, slide: s, label: 'Add a slide', select: { from: titleAt, to: titleAt + 'New slide'.length }, block: { at: at + e.insert.length - block.length, len: block.length } };
    }
    if (op.type === 'slide-duplicate') {
      const s = deck.slides[index];
      let block = blocks[index];
      // the copy without the original's id (two slides with one id are one target)
      if (s.options.id !== undefined) {
        const m = scanMarkers(block, { alone: true }).find((x) => x.type === 'slide' && x.span.from === 0)!;
        const indent = /^[ \t]*/.exec(m.content)![0];
        block = slideMarker(s.layoutSpec, s.optionTokens.filter((t) => !/^id=/.test(t)), indent) + block.slice(s.marker.to - s.marker.from);
      }
      const at = startOf(index + 1);
      const e = insertAt(at, block, gap);
      blocks.splice(index + 1, 0, block);
      return { edits: [e], expect: blocks, slide: index + 1, label: `Duplicate slide ${index + 1}`, block: { at: at + e.insert.length - block.length, len: block.length } };
    }
    if (op.type === 'slide-delete') {
      if (n === 1) throw new LayoutOpError('only-slide', 'a deck keeps at least one slide');
      blocks.splice(index, 1);
      return { edits: [{ from: startOf(index), to: startOf(index + 1), insert: '' }], expect: blocks, slide: Math.min(index, n - 2), label: `Delete slide ${index + 1}` };
    }
    // move: slide `index` to position `to` (its index after the move)
    const to = Math.max(0, Math.min(n - 1, Math.floor(op.to)));
    if (to === index) throw new LayoutOpError('no-change', 'the slide is already there');
    const block = blocks[index];
    const del: TextEdit = { from: startOf(index), to: startOf(index + 1), insert: '' };
    const ins = insertAt(to < index ? startOf(to) : startOf(to + 1), block, gap);
    const [m] = blocks.splice(index, 1);
    blocks.splice(to, 0, m);
    const edits = to < index ? [ins, del] : [del, ins];
    return { edits, expect: blocks, slide: to, label: `Move slide ${index + 1} to ${to + 1}` };
  };
  if (op.type !== 'slide-add' && (index < 0 || index >= n)) throw new LayoutOpError('no-slide', `there is no slide ${index + 1}`);
  let why = '';
  for (const gap of [false, true]) {
    const p = plan(gap);
    const newText = applyEdits(text, p.edits);
    // a move is two edits far apart: the deck after the later one first, so each is derived from its neighbours (OPS-10)
    if (p.edits.length > 1) parseDeck(applyEdits(text, p.edits.slice(1)));
    const nd = parseDeck(newText);
    const got = nd.slides.map((_, k) => trimEnd(newText.slice(nd.slides[k].marker.from, nd.slides[k + 1]?.marker.from ?? newText.length)));
    const want = p.expect.map(trimEnd);
    if (got.length !== want.length || got.some((g, k) => g !== want[k])) { why = 'a slide before it ends inside a raw HTML block or another open construct'; continue; }
    const ns = nd.slides[p.slide];
    const changed = p.block ? [{ from: p.block.at, to: p.block.at + p.block.len }] : op.type === 'slide-move' && ns ? [{ from: ns.marker.from, to: ns.span.to }] : [{ from: p.edits[0].from, to: p.edits[0].from }];
    return { edits: p.edits, text: newText, label: p.label, slide: p.slide, changed, ...(p.select ? { select: p.select } : {}) };
  }
  throw new LayoutOpError('unsafe', `this change cannot be written safely here (${why}): fix the slide's issues first`);
}
