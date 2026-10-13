/**
 * The layout grammar of a slide marker (FC-18 §7.2, syntax kept from 0.x —
 * owner decision 2, REBUILD §3c): a PRESET alias with an optional ratio
 * (`2col`, `3col 1/2/1`, `2row`, `main-side 3/1`, `quad`) or a RAW SPLIT
 * (`col 220px/1fr { sidebar; row 1/1 { a; b } }`), parsed into a layout tree,
 * and the canonical serialiser that writes a tree back as marker text.
 *
 *   split  := ("row" | "col") tracks "{" item (";" item)* "}"
 *   item   := region-name | split
 *   tracks := track ("/" track)*
 *   track  := number ["fr" | "%" | "px" | "em" | "rem"] | "auto"
 *
 * One normalisation (so every tree has one canonical text): a split with ONE
 * child whose track is a plain fr size (`1`, `2`, `1fr`) is the same box as
 * the child alone, so `col 1 { main }` parses to the leaf `main`. That is how
 * a one-box slide whose box is not `body` is written (owner decision 6).
 *
 * Pure: no DOM, no Node built-ins.
 */
import type { LayoutNode, RegionLeaf, SplitNode, Track } from '../types.js';

/** The presets, in the order the serialiser tries them. */
export const PRESETS = ['2col', '3col', '2row', 'main-side', 'quad'] as const;
export type PresetName = (typeof PRESETS)[number];

/** Region names each preset has, in reading order (the documented region list, FC-18 §7.2). */
export const PRESET_REGIONS: Readonly<Record<PresetName, readonly string[]>> = Object.freeze({
  '2col': ['left', 'right'],
  '3col': ['left', 'mid', 'right'],
  '2row': ['top', 'bottom'],
  'main-side': ['main', 'side'],
  quad: ['tl', 'tr', 'bl', 'br'],
});

/** The default ratio of each preset that takes one (`quad` takes none). */
export const PRESET_DEFAULT_RATIO: Readonly<Record<Exclude<PresetName, 'quad'>, string>> = Object.freeze({
  '2col': '1/1',
  '3col': '1/1/1',
  '2row': '1/1',
  'main-side': '2/1',
});

/** The single region of a slide without a layout. */
export const DEFAULT_REGION = 'body';

/** Region names the grammar reserves for other things (FC-18 §7.2: notes, footer, float). */
export const RESERVED_REGIONS: readonly string[] = Object.freeze(['notes', 'footer', 'float']);

/** A valid track token. */
const TRACK = /^(?:(?:\d+(?:\.\d+)?|\.\d+)(?:fr|%|px|em|rem)?|auto)$/;
/** A valid region name in a split. */
const NAME = /^[A-Za-z0-9_-]+$/;

export const leaf = (name: string): RegionLeaf => ({ kind: 'region', name });
export const split = (dir: 'row' | 'col', tracks: Track[], children: LayoutNode[]): SplitNode => ({ kind: 'split', dir, tracks, children });

/** Parse a `/`-separated track list. */
export function parseTracks(str: string): Track[] {
  return str.split('/').map((t) => t.trim());
}

/** A track that is a plain fr size (`2`, `1.5`, `1fr`): such a one-child split is the child itself. */
export function isFrTrack(t: Track): boolean {
  return /^(?:\d+(?:\.\d+)?|\.\d+)(?:fr)?$/.test(t);
}

/** The tree with every one-child fr split replaced by its child (see the module comment). */
export function normalizeTree(n: LayoutNode): LayoutNode {
  if (n.kind === 'region') return n;
  const children = n.children.map(normalizeTree);
  if (children.length === 1 && n.tracks.length === 1 && isFrTrack(n.tracks[0])) return children[0];
  return split(n.dir, [...n.tracks], children);
}

/** Expand a preset (with an optional ratio such as `3/2`) to its tree; null for an unknown name. */
export function expandPreset(name: string, ratio?: string): LayoutNode | null {
  const r = (def: string): Track[] => parseTracks(ratio ?? def);
  switch (name) {
    case '2col':
      return split('col', r('1/1'), [leaf('left'), leaf('right')]);
    case '3col':
      return split('col', r('1/1/1'), [leaf('left'), leaf('mid'), leaf('right')]);
    case '2row':
      return split('row', r('1/1'), [leaf('top'), leaf('bottom')]);
    case 'main-side':
      return split('col', r('2/1'), [leaf('main'), leaf('side')]);
    case 'quad':
      return split('row', ['1', '1'], [split('col', ['1', '1'], [leaf('tl'), leaf('tr')]), split('col', ['1', '1'], [leaf('bl'), leaf('br')])]);
    default:
      return null;
  }
}

/** A finding of the layout spec (the parser turns it into a lint with the marker's position). */
export interface LayoutProblem {
  code: 'unknown-layout' | 'layout-tracks' | 'bad-split' | 'duplicate-region' | 'reserved-region';
  message: string;
}

/** What {@link parseLayoutSpec} reads. */
export interface LayoutSpec {
  /** The expanded, normalised tree (`body` alone when the spec is empty or unusable). */
  tree: LayoutNode;
  /** The preset written, with its ratio as written (null for a raw split or no layout). */
  preset: { name: PresetName; ratio: string | null } | null;
  problems: LayoutProblem[];
}

/**
 * Parse the layout part of a slide marker (everything but the options): a
 * preset alias (with an optional ratio), a raw split, or '' (one `body`
 * region). An unusable spec gives the `body` leaf and a problem.
 */
export function parseLayoutSpec(spec: string): LayoutSpec {
  const s = spec.trim();
  const problems: LayoutProblem[] = [];
  if (s === '') return { tree: leaf(DEFAULT_REGION), preset: null, problems };
  const head = /^[A-Za-z0-9_-]+/.exec(s)?.[0] ?? '';
  if ((head === 'row' || head === 'col') && s.includes('{')) {
    try {
      const raw = new SplitCursor(s).parseAll();
      const tree = normalizeTree(raw);
      checkNames(tree, problems);
      checkTracks(tree, problems);
      return { tree, preset: null, problems };
    } catch (e) {
      problems.push({ code: 'bad-split', message: `invalid layout split "${s}": ${(e as Error).message}` });
      return { tree: leaf(DEFAULT_REGION), preset: null, problems };
    }
  }
  const parts = s.split(/\s+/);
  const name = parts[0];
  if (!(PRESETS as readonly string[]).includes(name)) {
    problems.push({ code: 'unknown-layout', message: `unknown layout "${name}" (presets: ${PRESETS.join(', ')}; or a raw split such as col 1/1 { a; b })` });
    return { tree: leaf(DEFAULT_REGION), preset: null, problems };
  }
  const preset = name as PresetName;
  if (parts.length > 2) {
    problems.push({ code: 'unknown-layout', message: `unexpected "${parts.slice(2).join(' ')}" after the layout "${parts[0]} ${parts[1]}"` });
  }
  const ratio = parts[1] ?? null;
  if (preset === 'quad' && ratio !== null) {
    problems.push({ code: 'layout-tracks', message: `the quad layout takes no ratio (got "${ratio}")` });
    return { tree: expandPreset('quad')!, preset: { name: preset, ratio: null }, problems };
  }
  if (ratio !== null) {
    const tracks = parseTracks(ratio);
    const want = PRESET_REGIONS[preset].length;
    if (tracks.length !== want) {
      problems.push({ code: 'layout-tracks', message: `the ${preset} layout takes ${want} tracks, "${ratio}" has ${tracks.length}` });
      return { tree: expandPreset(preset)!, preset: { name: preset, ratio: null }, problems };
    }
    const bad = tracks.filter((t) => !TRACK.test(t));
    if (bad.length > 0) {
      problems.push({ code: 'layout-tracks', message: `invalid track size ${bad.map((t) => `"${t}"`).join(', ')} in "${ratio}" (a number, fr, %, px, em, rem or auto)` });
      return { tree: expandPreset(preset)!, preset: { name: preset, ratio: null }, problems };
    }
  }
  return { tree: expandPreset(preset, ratio ?? undefined)!, preset: { name: preset, ratio }, problems };
}

function checkNames(tree: LayoutNode, problems: LayoutProblem[]): void {
  const names = leaves(tree);
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) problems.push({ code: 'duplicate-region', message: `the layout names the region "${n}" twice` });
    seen.add(n);
    if (RESERVED_REGIONS.includes(n.toLowerCase())) problems.push({ code: 'reserved-region', message: `"${n}" is reserved (notes, footer, float) and cannot be a layout region` });
  }
}

function checkTracks(n: LayoutNode, problems: LayoutProblem[]): void {
  if (n.kind === 'region') return;
  const bad = n.tracks.filter((t) => !TRACK.test(t));
  if (bad.length > 0) problems.push({ code: 'layout-tracks', message: `invalid track size ${bad.map((t) => `"${t}"`).join(', ')} (a number, fr, %, px, em, rem or auto)` });
  n.children.forEach((c) => checkTracks(c, problems));
}

/** Recursive descent over a raw split (0.x grammar, stricter: names and tracks are checked). */
class SplitCursor {
  private i = 0;
  constructor(private readonly s: string) {}

  parseAll(): SplitNode {
    const node = this.parseSplit();
    this.ws();
    if (this.i < this.s.length) throw new Error(`unexpected "${this.s.slice(this.i, this.i + 20)}" after the split`);
    return node;
  }

  private parseSplit(): SplitNode {
    this.ws();
    const dir = this.word();
    if (dir !== 'row' && dir !== 'col') throw new Error(`expected "row" or "col", got "${dir}"`);
    this.ws();
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i] !== '{' && this.s[this.i] !== '}' && this.s[this.i] !== ';') this.i++;
    const tracksStr = this.s.slice(start, this.i).trim();
    if (tracksStr === '') throw new Error('missing tracks before "{"');
    if (/\s/.test(tracksStr)) throw new Error(`tracks "${tracksStr}" hold a space`);
    const tracks = parseTracks(tracksStr);
    this.expect('{');
    const children: LayoutNode[] = [];
    do {
      children.push(this.parseItem());
    } while (this.eat(';'));
    this.expect('}');
    if (children.length !== tracks.length) throw new Error(`${tracks.length} track${tracks.length === 1 ? '' : 's'} for ${children.length} item${children.length === 1 ? '' : 's'}`);
    return split(dir, tracks, children);
  }

  private parseItem(): LayoutNode {
    this.ws();
    const save = this.i;
    const w = this.word();
    this.i = save;
    if ((w === 'row' || w === 'col') && this.braceBeforeDelimiter()) return this.parseSplit();
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z0-9_-]/.test(this.s[this.i])) this.i++;
    const name = this.s.slice(start, this.i);
    if (name === '') throw new Error(`expected a region name at "${this.s.slice(this.i, this.i + 20)}"`);
    if (!NAME.test(name)) throw new Error(`bad region name "${name}"`);
    return leaf(name);
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private word(): string {
    this.ws();
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }
  private expect(ch: string): void {
    this.ws();
    if (this.s[this.i] !== ch) throw new Error(`expected "${ch}" at "${this.s.slice(this.i, this.i + 20) || 'the end'}"`);
    this.i++;
  }
  private eat(ch: string): boolean {
    this.ws();
    if (this.s[this.i] === ch) {
      this.i++;
      return true;
    }
    return false;
  }
  private braceBeforeDelimiter(): boolean {
    for (let j = this.i; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '{') return true;
      if (c === ';' || c === '}') return false;
    }
    return false;
  }
}

/* ───────────────────────── tree helpers ───────────────────────── */

/** The region names of a tree, in reading order. */
export function leaves(n: LayoutNode): string[] {
  return n.kind === 'region' ? [n.name] : n.children.flatMap(leaves);
}

/** The first leaf's name: the region the slide's leading text fills (the primary region). */
export function firstLeaf(n: LayoutNode): string {
  return n.kind === 'region' ? n.name : firstLeaf(n.children[0]);
}

/** Structural equality of two trees (track strings compared exactly). */
export function sameTree(a: LayoutNode, b: LayoutNode): boolean {
  if (a.kind === 'region' || b.kind === 'region') return a.kind === b.kind && (a as RegionLeaf).name === (b as RegionLeaf).name;
  return a.dir === b.dir && a.tracks.length === b.tracks.length && a.tracks.every((t, i) => t === b.tracks[i]) && a.children.length === b.children.length && a.children.every((c, i) => sameTree(c, b.children[i]));
}

/* ───────────────────────── serialiser ───────────────────────── */

/** The raw split text of a tree, canonical spacing: `col 2/1 { main; row 1/1 { a; b } }` (a leaf: `col 1 { name }`). */
export function rawSpec(n: LayoutNode): string {
  if (n.kind === 'region') return `col 1 { ${n.name} }`;
  const item = (c: LayoutNode): string => (c.kind === 'region' ? c.name : rawSpec(c));
  return `${n.dir} ${n.tracks.join('/')} { ${n.children.map(item).join('; ')} }`;
}

/**
 * Tree → the canonical layout text of a marker (owner decision 6): `''` for
 * the single `body` region; the preset when the tree equals a preset (its
 * ratio only when not the default); otherwise the raw split — a one-box slide
 * whose box is not `body` as a one-track split (`col 1 { main }`). Parsing the
 * result gives the tree back (`parseLayoutSpec(serialiseLayout(t)).tree` equals
 * `normalizeTree(t)`), so nothing but the marker line ever needs rewriting.
 */
export function serialiseLayout(tree: LayoutNode): string {
  const t = normalizeTree(tree);
  if (t.kind === 'region') return t.name === DEFAULT_REGION ? '' : rawSpec(t);
  for (const p of PRESETS) {
    if (sameTree(expandPreset(p)!, t)) return p;
  }
  const ratio = t.tracks.join('/');
  for (const p of PRESETS) {
    if (p === 'quad') continue;
    const e = expandPreset(p, ratio);
    if (e && sameTree(e, t) && t.tracks.every((x) => TRACK.test(x))) return `${p} ${ratio}`;
  }
  return rawSpec(t);
}

/**
 * The marker line of a slide with a layout spec and option tokens (as
 * written, in order): `<!-- slide [layout] [options] -->`, with the given
 * indentation.
 */
export function slideMarker(spec: string, optionTokens: readonly string[] = [], indent = ''): string {
  const args = [spec, ...optionTokens].filter((a) => a !== '').join(' ');
  return `${indent}<!-- slide${args ? ` ${args}` : ''} -->`;
}
