/**
 * Editing mode (b), per slide (rebuild step 6): the pure layout ops of
 * src/layout-ops.ts (claims L.1–L.6) — each op one set of minimal text edits
 * on marker lines (plus the moved block), the grammar rules of owner
 * decision 6, and the layout-GUI ROUND-TRIP PROPERTY over a seeded
 * generator (no new dependency): for random decks (LF, CR LF, CR; every
 * layout shape, every region kind, titles in the lead or in the first
 * region, floats, notes, footers, templates, markers shown in fences, raw
 * HTML) and random ops, `parseDeck(apply(op, text))` gives exactly
 * `op(tree)` for that slide, every other slide and the header stay
 * byte-identical, the diff touches only marker lines and blank lines (plus
 * the moved block of a delete or a move), no region text is lost or
 * altered, undo (the inverse edits) restores the exact text, and the line
 * ending is kept.
 */
import { describe, it, expect } from 'vitest';
import {
  applyEdits, applyOp, blockingProblem, deleteTree, floatBox, freshName, LayoutOpError, nameProblem, partAt, placeFloat, presetMapping, presetOf, presetTree,
  slideMap, splitTree, stepRatio, tracksForRatio, tracksTree, type LayoutOp, type OpResult,
} from '../src/layout-ops.js';
import { parseDeck } from '../src/deck/parse.js';
import { leaf, leaves, normalizeTree, sameTree, split, serialiseLayout } from '../src/deck/layout-spec.js';
import type { LayoutNode, Slide } from '../src/types.js';

/** mulberry32: the same seed, the same cases. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEAD = '{{nyml\nkind: document\ncarrier: slides\ntitle: Ops\nuid: doc-layoutops0001\n}}\n\n';
const deck = (body: string): string => HEAD + body;
const ok = (text: string, i: number, op: LayoutOp): OpResult => applyOp(text, i, op);
const slideOf = (text: string, i: number): Slide => parseDeck(text).slides[i];
/** Region texts (blank-line runs as one, blank ends dropped; a first line's indentation kept — indented code, round B OPS-8). */
const regions = (s: Slide): Record<string, string> => Object.fromEntries(s.regions.filter((r) => r.markdown.trim()).map((r) => [r.name, r.markdown.replace(/\n{3,}/g, '\n\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')]));
const MARKER_LINE = /^[ \t]{0,3}<!--\s*(?:slide\b|@[A-Za-z0-9_-]+)[\s\S]*-->\s*$/;

const TWO = deck('<!-- slide 2col -->\n## Two\nLeft text\n<!-- @right -->\nRight text\n\n<!-- slide -->\n## One\nBody\n');

describe('the layout ops (one op → marker-line edits)', () => {
  it('[L.1] split, delete, resize, preset, rename, swap and move each rewrite marker lines only (plus the moved block): the canonical marker (a preset when the tree is one), new boxes with short unique names, the deleted box\'s text in its neighbour', () => {
    const s = ok(TWO, 0, { type: 'split', box: 'right', dir: 'col' });
    expect(slideOf(s.text, 0).layoutSpec).toBe('col 2/1/1 { left; right; right-2 }');
    expect(s.text).toContain('Right text\n<!-- @right-2 -->\n');
    expect(s.edits).toHaveLength(2);
    // splitting a box across its parent's direction nests a split; the new region is empty, with its marker
    const r = ok(TWO, 0, { type: 'split', box: 'left', dir: 'row' });
    expect(slideOf(r.text, 0).layoutSpec).toBe('col 1/1 { row 1/1 { left; left-2 }; right }');
    // delete: the neighbour takes the track and the text; the one box left (not body) is a one-track split
    const d = ok(TWO, 0, { type: 'delete-box', box: 'right' });
    expect(slideOf(d.text, 0).layoutSpec).toBe('col 1 { left }');
    expect(regions(slideOf(d.text, 0))).toEqual({ left: 'Left text\n\nRight text' });
    // resize: the preset with its ratio; the marker line alone
    const t = ok(TWO, 0, { type: 'tracks', path: [], tracks: ['2', '1'] });
    expect(t.edits).toEqual([{ from: TWO.indexOf('<!-- slide 2col'), to: TWO.indexOf('## Two'), insert: '<!-- slide 2col 2/1 -->\n' }]);
    // a tree that equals a preset is written as the preset (a rename back to the preset's names)
    const raw = deck('<!-- slide col 1/1 { a; b } -->\n## R\nA\n<!-- @b -->\nB\n');
    const a1 = ok(raw, 0, { type: 'rename', box: 'a', to: 'left' });
    const a2 = ok(a1.text, 0, { type: 'rename', box: 'b', to: 'right' });
    expect(slideOf(a2.text, 0).layoutSpec).toBe('2col');
    expect(regions(slideOf(a2.text, 0))).toEqual({ left: 'A', right: 'B' });
    // swap: the texts change boxes, the tree and the slide marker stay
    const w = ok(TWO, 0, { type: 'swap', a: 'left', b: 'right' });
    expect(regions(slideOf(w.text, 0))).toEqual({ left: 'Right text', right: 'Left text' });
    expect(w.text).toContain('<!-- slide 2col -->\n');
    // move: the text goes to the end of the other box; the emptied box keeps its marker
    const m = ok(TWO, 0, { type: 'move-content', from: 'left', to: 'right' });
    expect(regions(slideOf(m.text, 0))).toEqual({ right: 'Right text\n\nLeft text' });
    expect(slideMap(m.text, 0)!.boxes.find((b) => b.name === 'left')!.marker).not.toBeNull();
  });

  it('[L.2] owner decision 6: switching preset renames the regions (same name first, then reading order; extra boxes merge into the last); a marker whose tree did not change is never rewritten; a slide with a duplicate region or a region filled twice is fixed first; names that are reserved, layout words or taken are refused', () => {
    expect([...presetMapping(presetTree('2col'), '2row')]).toEqual([['left', 'top'], ['right', 'bottom']]);
    expect([...presetMapping(presetTree('2col'), '3col')]).toEqual([['left', 'left'], ['right', 'right']]);
    expect([...presetMapping(presetTree('quad'), '2col')]).toEqual([['tl', 'left'], ['tr', 'right'], ['bl', 'right'], ['br', 'right']]);
    const q = deck('<!-- slide quad -->\n## Q\n<!-- @tl -->\nA\n<!-- @tr -->\nB\n<!-- @bl -->\nC\n<!-- @br -->\nD\n');
    const p = ok(q, 0, { type: 'preset', preset: '2col' });
    expect(regions(slideOf(p.text, 0))).toEqual({ left: 'A', right: 'B\n\nC\n\nD' });
    expect(slideOf(p.text, 0).lint.filter((l) => l.level === 'error')).toEqual([]);
    const three = ok(TWO, 0, { type: 'preset', preset: '3col' });
    expect(slideMap(three.text, 0)!.boxes.map((b) => [b.name, b.empty])).toEqual([['left', false], ['mid', true], ['right', false]]);
    expect(presetOf(slideOf(three.text, 0).layout)).toBe('3col');
    // an op that does not change the tree leaves the slide marker byte-identical (float, notes, swap)
    for (const op of [{ type: 'float-add' }, { type: 'ensure-region', name: 'notes' }, { type: 'swap', a: 'left', b: 'right' }] as LayoutOp[]) {
      expect(ok(TWO, 0, op).text).toContain('\n<!-- slide 2col -->\n## Two\n');
    }
    // blocked slides
    const dup = deck('<!-- slide 2col -->\n## D\n<!-- @left -->\nA\n<!-- @left -->\nB\n');
    expect(blockingProblem(dup, 0)?.code).toBe('duplicate-region');
    expect(() => ok(dup, 0, { type: 'split', box: 'left', dir: 'col' })).toThrow(/fix this first/);
    const twice = deck('<!-- slide 2col -->\n## D\nlead\n<!-- @left -->\nB\n');
    expect(blockingProblem(twice, 0)?.code).toBe('region-twice');
    // names
    expect(nameProblem('notes', [])).toMatch(/reserved/);
    expect(nameProblem('Footer', [])).toMatch(/reserved/);
    expect(nameProblem('row', [])).toMatch(/layout word/);
    expect(nameProblem('right', ['right'])).toMatch(/already/);
    expect(nameProblem('2x', [])).toMatch(/starts with a letter/);
    expect(() => ok(TWO, 0, { type: 'rename', box: 'left', to: 'right' })).toThrow(LayoutOpError);
    expect(freshName('left', ['left', 'left-2'])).toBe('left-3');
    expect(freshName('left-3', ['left-3'])).toBe('left-2');
  });

  it('[L.3] floats: added where they overlap no float (else offset), moved and resized in whole % from the TEXT\'s geometry, deleted, brought forward or sent backward (z=), identified by order; a template slide changes only its look (v=) — its layout ops are refused with the reason', () => {
    const a1 = ok(TWO, 0, { type: 'float-add' });
    const a2 = ok(a1.text, 0, { type: 'float-add' });
    const a3 = ok(a2.text, 0, { type: 'float-add' });
    const boxes = slideMap(a3.text, 0)!.floats.map((f) => f.box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [x, y] = [boxes[i], boxes[j]];
      expect(x.left < y.left + y.w && y.left < x.left + x.w && x.top < y.top + y.h && y.top < x.top + x.h).toBe(false);
    }
    // a full slide: the new one is offset from the last
    const full = Array.from({ length: 12 }, (_, k) => ({ left: (k % 4) * 25, top: Math.floor(k / 4) * 34, w: 25, h: 34 }));
    expect(placeFloat(full)).toEqual({ left: Math.min(70, full[11].left + 4), top: Math.min(78, full[11].top + 4), w: 30, h: 22, covers: true });
    // move / resize rewrite the marker's keys of the axis moved, in their units and anchors (round B, OPS-3); z is kept
    const z = deck('<!-- slide -->\n## F\nB\n<!-- @float right=10% bottom=10% w=20% h=20% z=5 -->\nNote\n');
    const mv = ok(z, 0, { type: 'float-geom', index: 0, box: { left: 12, top: 30 } });
    expect(mv.text).toContain('<!-- @float right=68% bottom=50% w=20% h=20% z=5 -->');
    expect(floatBox(slideOf(mv.text, 0).floats[0].geom)).toMatchObject({ left: 12, top: 30, w: 20, h: 20 });
    expect(floatBox(slideOf(z, 0).floats[0].geom)).toMatchObject({ left: 70, top: 70, w: 20, h: 20 });
    const px = deck('<!-- slide -->\n## F\nB\n<!-- @float left=640px top=72px w=320px h=144px -->\nNote\n');
    expect(floatBox(slideOf(px, 0).floats[0].geom)).toMatchObject({ left: 50, top: 10, w: 25, h: 20 });
    // z: forward and back by one step of the stacking order
    const two = deck('<!-- slide -->\n## F\nB\n<!-- @float left=1% top=1% w=10% h=10% -->\nA\n<!-- @float left=5% top=5% w=10% h=10% -->\nB\n');
    const fwd = ok(two, 0, { type: 'float-z', index: 0, dir: 'forward' });
    expect(fwd.text).toContain('<!-- @float left=1% top=1% w=10% h=10% z=3 -->');
    expect(() => ok(two, 0, { type: 'float-z', index: 1, dir: 'forward' })).toThrow(/already in front/);
    const back = ok(two, 0, { type: 'float-z', index: 1, dir: 'backward' });
    expect(back.text).toContain('<!-- @float left=5% top=5% w=10% h=10% z=1 -->');
    const del = ok(two, 0, { type: 'float-delete', index: 0 });
    expect(slideOf(del.text, 0).floats.map((f) => f.markdown)).toEqual(['B']);
    // templates
    const tpl = deck('<!-- slide template=title -->\n# A title\n## sub\n');
    expect(() => ok(tpl, 0, { type: 'split', box: 'body', dir: 'col' })).toThrow(/template slide has its own layout/);
    expect(() => ok(tpl, 0, { type: 'preset', preset: '2col' })).toThrow(/template/);
    const v3 = ok(tpl, 0, { type: 'variant', v: 3 });
    expect(slideOf(v3.text, 0).templateVariant).toBe(3);
    expect(ok(v3.text, 0, { type: 'variant', v: 1 }).text).toContain('<!-- slide template=title -->');
    expect(() => ok(tpl, 0, { type: 'variant', v: 9 })).toThrow(/looks 1 to 6/);
  });

  it('[L.4] the slide options a GUI sets (fit, bg, t, step) rewrite the option tokens in place, quoted when needed; bad values are refused; notes and footer get their marker when missing', () => {
    const o = ok(TWO, 0, { type: 'options', set: { fit: 'off', bg: 'linear-gradient(red, blue)', transition: 'zoom', step: true } });
    const s = slideOf(o.text, 0);
    expect(s.options).toMatchObject({ fit: 'off', bg: 'linear-gradient(red, blue)', transition: 'zoom', step: true });
    expect(s.layoutSpec).toBe('2col');
    const back = ok(o.text, 0, { type: 'options', set: { fit: 'fit', bg: null, transition: null, step: false } });
    expect(back.text).toBe(TWO);
    expect(() => ok(TWO, 0, { type: 'options', set: { bg: 'a --> b' } })).toThrow(LayoutOpError);
    expect(() => ok(TWO, 0, { type: 'options', set: { transition: 'wobble' } })).toThrow(/transition/);
    const n = ok(TWO, 0, { type: 'ensure-region', name: 'notes' });
    expect(slideOf(n.text, 0).notes).toBe('');
    expect(n.select).toBeDefined();
    const f = ok(n.text, 0, { type: 'ensure-region', name: 'footer' });
    expect(slideOf(f.text, 0).footer).toBe('');
    expect(() => ok(f.text, 0, { type: 'ensure-region', name: 'footer' })).toThrow(/already/);
  });

  it('[L.5] the filmstrip\'s deck ops are slide-block moves: add (after or before), duplicate (without the id), delete (never the last slide), move — every slide\'s text byte-identical, one set of edits each', () => {
    const T = deck('<!-- slide -->\n## A\n\n<!-- slide id=bee -->\n## B\n\n<!-- slide -->\n## C\n');
    const blocks = (t: string): string[] => { const d = parseDeck(t); return d.slides.map((s, i) => t.slice(s.marker.from, d.slides[i + 1]?.marker.from ?? t.length)); };
    const [A, B, C] = blocks(T);
    expect(blocks(ok(T, 0, { type: 'slide-move', to: 2 }).text)).toEqual([B, C, A]);
    expect(blocks(ok(T, 2, { type: 'slide-move', to: 0 }).text)).toEqual([C, A, B]);
    expect(blocks(ok(T, 1, { type: 'slide-delete' }).text)).toEqual([A, C]);
    const dup = blocks(ok(T, 1, { type: 'slide-duplicate' }).text);
    expect(dup).toEqual([A, B, '<!-- slide -->\n## B\n\n', C]);
    const add = ok(T, 0, { type: 'slide-add' });
    expect(add.text.slice(add.select!.from, add.select!.to)).toBe('New slide');
    expect(parseDeck(add.text).slides[1].title).toBe('New slide');
    expect(() => ok(deck('<!-- slide -->\n## only\n'), 0, { type: 'slide-delete' })).toThrow(/at least one slide/);
    // no final line ending: the moved last slide gets one, nothing else changes
    const open = T.replace(/\n$/, '');
    expect(blocks(ok(open, 2, { type: 'slide-move', to: 0 }).text)).toEqual([C, A, B]);
  });
});

/* ───────────────────────── the round-trip property ───────────────────────── */

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'rate', 'chain', 'radical', 'polymer', 'monomer', 'yield'];
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** A random content block (one of the region kinds a deck has), as lines. */
function block(r: () => number): string[] {
  const w = (): string => Array.from({ length: 2 + Math.floor(r() * 5) }, () => pick(r, WORDS)).join(' ');
  switch (Math.floor(r() * 9)) {
    case 0: return [`- ${w()}`, `- ${w()}`];
    case 1: return ['```text', '<!-- slide 2col -->', `<!-- @right -->`, w(), '```'];
    case 2: return ['| a | b |', '|---|---|', `| ${w()} | x |`];
    case 3: return [`> ${w()}`];
    case 4: return ['$$', 'E = mc^2', '$$'];
    case 5: return ['<div class="note">', w(), '</div>', ...(r() < 0.6 ? [''] : [])];
    case 6: return ['<!-- an author comment -->'];
    case 7: return r() < 0.5 ? [`1. ${w()}`, `   - ${w()}`] : [`    ${w()}`, `    ${w()}`];
    default: return [w() + (r() < 0.3 ? ' **bold**' : '')];
  }
}

/** Region text: one to three blocks, blank lines between; sometimes nothing. */
function body(r: () => number, allowEmpty = true): string[] {
  if (allowEmpty && r() < 0.15) return [];
  const n = 1 + Math.floor(r() * 3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { if (i > 0) out.push(''); out.push(...block(r)); }
  return out;
}

const TREES = ['', '2col', '3col', '2row', 'main-side', 'quad', '2col 2/1', 'main-side 3/1', 'col 1/2 { a; b }', 'row 1/1/1 { a; b; c }', 'col 2/1 { main; row 1/1 { a; b } }', 'col 220px/1fr { side; main }', 'col 1 { main }', 'row auto/1 { head; col 1/1 { x; y } }', 'col 30%/1/1 { n; row 2/1 { p; q }; r }'];

/** A random slide's lines. */
function randomSlide(r: () => number): string[] {
  if (r() < 0.12) {
    const t = pick(r, ['title', 'section', 'outline', 'closing'] as const);
    const v = r() < 0.4 ? ` v=${1 + Math.floor(r() * 3)}` : '';
    const out = [`<!-- slide template=${t}${v} -->`, '# A template', ...body(r)];
    if (r() < 0.3) out.push('<!-- @notes -->', 'Speaker notes.');
    return out;
  }
  const spec = pick(r, TREES);
  const opts = r() < 0.25 ? pick(r, [' bg=#eef', ' fit=off', ' t=fade', ' step', ' class=wide', ' id=s1']) : '';
  const marker = `<!-- slide${spec ? ` ${spec}` : ''}${opts} -->`;
  const names = leaves(parseDeck(`${marker}\n`).slides[0].layout);
  const out = [marker];
  const titleInRegion = r() < 0.15 && names.length > 1;
  if (!titleInRegion && r() < 0.9) out.push(`## ${pick(r, WORDS)} title`);
  // round B (OPS-1): a float right after the title, before any region marker, its body raw HTML (no blank line after it)
  if (!titleInRegion && r() < 0.15) out.push('', `<!-- @float ${pick(r, ['right=3% top=3% w=10% h=10%', 'left=60% top=10% w=30% h=20%', 'left=2em top=3em w=10em h=4em'])} -->`, pick(r, ['<img src="logo.png" alt="logo">', '<div class="callout">', 'A plain float']), ...(r() < 0.5 ? [''] : []));
  // round B (OPS-6): notes before the floats
  const notesFirst = r() < 0.1;
  if (notesFirst) out.push('<!-- @notes -->', 'Early notes.');
  // the primary region: leading text or its own marker (or nothing)
  const leadWay = r();
  const order = [...names];
  if (r() < 0.2) order.reverse();
  let first = true;
  for (const n of order) {
    const isPrimary = n === names[0];
    if (isPrimary && leadWay < 0.55 && !titleInRegion && first) { out.push(...body(r)); first = false; continue; }
    if (r() < 0.12 && !(titleInRegion && first)) continue; // an empty box with no marker
    out.push(`<!-- @${n} -->`);
    if (titleInRegion && first) out.push(`## ${pick(r, WORDS)} title`);
    out.push(...body(r, !(titleInRegion && first)));
    first = false;
    if (r() < 0.4) out.push('');
  }
  const floats = Math.floor(r() * 3.6);
  for (let k = 0; k < floats; k++) {
    // round B (OPS-3, OPS-9): anchors right/bottom, no size, em, a key written twice
    const geo = pick(r, [
      `left=${5 + Math.floor(r() * 60)}% top=${5 + Math.floor(r() * 60)}% w=${10 + Math.floor(r() * 25)}% h=${10 + Math.floor(r() * 25)}%`,
      `left=${5 + Math.floor(r() * 60)}% top=${5 + Math.floor(r() * 60)}% w=${10 + Math.floor(r() * 25)}% h=${10 + Math.floor(r() * 25)}%`,
      `right=${2 + Math.floor(r() * 20)}% bottom=${2 + Math.floor(r() * 20)}%`,
      `left=${Math.floor(r() * 600)}px top=${Math.floor(r() * 400)}px w=300px h=120px`,
      'left=2em top=3em w=10em h=4em',
      `left=10% top=10% w=20% h=20% left=${30 + Math.floor(r() * 30)}%`,
    ]);
    out.push(`<!-- @float ${geo}${r() < 0.3 ? ` z=${Math.floor(r() * 5)}` : ''} -->`);
    out.push(...body(r));
  }
  if (r() < 0.3) out.push('<!-- @footer -->', 'A slide footer');
  if (!notesFirst && r() < 0.4) out.push('<!-- @notes -->', 'Some notes.', '', 'More notes.');
  return out;
}

function randomDeck(r: () => number, eol: string): string {
  const n = 1 + Math.floor(r() * 5);
  const lines: string[] = [];
  if (r() < 0.7) lines.push('{{nyml', 'kind: document', 'carrier: slides', 'title: Random', '}}', '');
  for (let i = 0; i < n; i++) { lines.push(...randomSlide(r)); if (r() < 0.8) lines.push(''); }
  const text = lines.join(eol) + (r() < 0.85 ? eol : '');
  return text;
}

/** A random op that makes sense on a slide (its own box names, floats, a template's variant). */
function randomOp(r: () => number, s: Slide, total: number): LayoutOp {
  const names = leaves(s.layout);
  const box = pick(r, names);
  const rest = names.filter((x) => x !== box);
  const other = rest.length > 0 && r() < 0.9 ? pick(r, rest) : box;
  const fl = Math.max(1, s.floats.length);
  const k = Math.floor(r() * 18);
  if (s.kind === 'template' && k < 9) return r() < 0.5 ? { type: 'variant', v: 1 + Math.floor(r() * 4) } : { type: 'split', box, dir: 'col' };
  switch (k) {
    case 0: case 1: return { type: 'split', box, dir: r() < 0.5 ? 'col' : 'row' };
    case 2: case 3: return { type: 'delete-box', box };
    case 4: {
      const sp = s.layout.kind === 'split' ? s.layout : null;
      if (!sp) return { type: 'preset', preset: pick(r, ['2col', '3col', '2row', 'main-side', 'quad'] as const) };
      const i = Math.floor(r() * (sp.tracks.length - 1));
      return { type: 'tracks', path: [], tracks: tracksForRatio(sp.tracks, Math.max(0, i), pick(r, [[1, 2], [2, 1], [1, 1], [3, 1], [1, 3]] as const)) };
    }
    case 5: return { type: 'preset', preset: pick(r, ['single', '2col', '3col', '2row', 'main-side', 'quad'] as const) };
    case 6: return { type: 'rename', box, to: pick(r, ['fig', 'text', 'main', 'aside', box, 'notes']) };
    case 7: return { type: 'swap', a: box, b: other };
    case 8: return { type: 'move-content', from: box, to: other };
    case 9: return { type: 'float-add' };
    case 10: return { type: 'float-geom', index: Math.floor(r() * fl), box: pick(r, [{ left: Math.floor(r() * 80), top: Math.floor(r() * 80) }, { left: 10, top: 10, w: 20 + Math.floor(r() * 30), h: 20 }, { left: Math.floor(r() * 80) }, { top: Math.floor(r() * 80) }, { w: 20 + Math.floor(r() * 30) }]), ...(r() < 0.5 ? { from: { left: 30, top: 30, w: 20, h: 20 } } : {}) };
    case 11: return { type: 'float-delete', index: Math.floor(r() * fl) };
    case 12: return { type: 'float-z', index: Math.floor(r() * fl), dir: r() < 0.5 ? 'forward' : 'backward' };
    case 13: return { type: 'ensure-region', name: pick(r, ['notes', 'footer', box]) };
    case 14: return { type: 'options', set: pick(r, [{ fit: 'off' }, { fit: 'fit' }, { bg: '#123456' }, { bg: null }, { transition: 'zoom' }, { step: true }, { step: false }] as const) };
    case 15: return { type: 'slide-move', to: Math.floor(r() * total) };
    case 16: return pick(r, [{ type: 'slide-duplicate' }, { type: 'slide-add' }, { type: 'slide-delete' }] as const);
    default: return { type: 'split', box, dir: 'col' };
  }
}

/** What the op means for the slide's tree (the pure tree ops), or null when it does not change the tree. */
function treeAfter(s: Slide, op: LayoutOp): LayoutNode | null {
  const fresh = (b: string): string => {
    const taken = [...leaves(s.layout), ...s.regions.map((x) => x.name)];
    return freshName(b, taken);
  };
  switch (op.type) {
    case 'split': return splitTree(s.layout, op.box, op.dir, fresh(op.box));
    case 'delete-box': return deleteTree(s.layout, op.box).tree;
    case 'tracks': return tracksTree(s.layout, op.path, op.tracks);
    case 'preset': return presetTree(op.preset);
    case 'rename': { const rn = (n: LayoutNode): LayoutNode => (n.kind === 'region' ? leaf(n.name === op.box ? op.to : n.name) : split(n.dir, n.tracks, n.children.map(rn))); return rn(s.layout); }
    default: return null;
  }
}

/** The regions the op means (text order joins; names moved), from the OLD slide. */
function regionsAfter(s: Slide, op: LayoutOp): Record<string, string> {
  const old = regions(s);
  const byOrder = [...s.regions].filter((x) => x.markdown.trim()).sort((a, b) => (a.sources[0]?.body.from ?? 0) - (b.sources[0]?.body.from ?? 0));
  const remap = (map: Map<string, string>): Record<string, string> => {
    const out: Record<string, string[]> = {};
    for (const x of byOrder) (out[map.get(x.name) ?? x.name] ??= []).push(old[x.name]);
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n\n')]));
  };
  switch (op.type) {
    case 'delete-box': return remap(new Map([[op.box, deleteTree(s.layout, op.box).target]]));
    case 'preset': return remap(presetMapping(s.layout, op.preset));
    case 'rename': return remap(new Map([[op.box, op.to]]));
    case 'swap': return remap(new Map([[op.a, op.b], [op.b, op.a]]));
    case 'move-content': {
      const out = { ...old };
      out[op.to] = [old[op.to], old[op.from]].filter((x) => x).join('\n\n');
      delete out[op.from];
      return out;
    }
    default: return old;
  }
}

/** Lines of a string with their terminators. */
const unit = (s: string): string[] => s.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];

describe('the layout-GUI round-trip property', () => {
  it('[L.6] PROPERTY (seeded, 2500 random decks × LF / CR LF / CR × random ops): parseDeck(apply(op, text)) gives exactly op(tree) for the slide; every other slide and the header are byte-identical; the diff touches only marker lines and blank lines (plus the moved block of a delete, a move or a deck op); no region text is lost or altered; the inverse edits (undo) restore the exact text; the line ending is kept', () => {
    const r = rng(0x10ad6);
    const stats: Record<string, { applied: number; refused: number }> = {};
    const reasons: Record<string, number> = {};
    const unsafe: string[] = [];
    for (let c = 0; c < 2500; c++) {
      const eol = pick(r, ['\n', '\n', '\r\n', '\r']);
      const text = randomDeck(r, eol);
      const d = parseDeck(text);
      if (d.slides.length === 0) continue;
      const i = Math.floor(r() * d.slides.length);
      const s = d.slides[i];
      const op = randomOp(r, s, d.slides.length);
      const st = (stats[op.type] ??= { applied: 0, refused: 0 });
      let res: OpResult;
      try {
        res = applyOp(text, i, op);
      } catch (e) {
        if (!(e instanceof LayoutOpError)) throw new Error(`case ${c}: ${op.type} threw ${String(e)}\n${text}`);
        st.refused++;
        if ((e as LayoutOpError).code === 'unsafe') { unsafe.push(`${op.type}: ${(e as Error).message}`); }
        reasons[(e as LayoutOpError).code] = (reasons[(e as LayoutOpError).code] ?? 0) + 1;
        continue;
      }
      st.applied++;
      const where = `case ${c} (${JSON.stringify(op)}, slide ${i + 1}, eol ${JSON.stringify(eol)}):\n${JSON.stringify(text)}\n=====\n${JSON.stringify(res.text)}`;
      // the edits are sorted, apart, and make the text
      for (let k = 1; k < res.edits.length; k++) expect(res.edits[k].from, where).toBeGreaterThanOrEqual(res.edits[k - 1].to);
      expect(applyEdits(text, res.edits), where).toBe(res.text);
      // undo: the inverse edits restore the exact text
      let shift = 0;
      const inverse = res.edits.map((e) => { const from = e.from + shift; shift += e.insert.length - (e.to - e.from); return { from, to: from + e.insert.length, insert: text.slice(e.from, e.to) }; });
      expect(applyEdits(res.text, inverse), where).toBe(text);
      // the line ending is kept (a uniform text stays uniform)
      const ends = new Set(res.text.match(/\r\n|\r|\n/g) ?? []);
      expect([...ends].every((x) => x === eol), where).toBe(true);
      const nd = parseDeck(res.text);
      // the header (and the text before the first slide) byte-identical
      expect(res.text.slice(0, nd.slides[0]?.marker.from ?? 0), where).toBe(text.slice(0, d.slides[0].marker.from));
      const rawOf = (t: string, dk: typeof d, k: number): string => t.slice(dk.slides[k].marker.from, dk.slides[k + 1]?.marker.from ?? t.length);
      const withEol = (x: string): string => (/(?:\r\n|\r|\n)$/.test(x) ? x : x + eol);
      if (op.type.startsWith('slide-')) {
        // a block move may add ONE blank line after the slide before it (when that slide ends in an open raw HTML block)
        const trim = (x: string): string => x.replace(/(?:[ \t]*(?:\r\n|\r|\n))+$/, '');
        const old = d.slides.map((_, k) => trim(rawOf(text, d, k)));
        const now = nd.slides.map((_, k) => trim(rawOf(res.text, nd, k)));
        const expected = [...old];
        if (op.type === 'slide-move') { const [m] = expected.splice(i, 1); expected.splice(Math.max(0, Math.min(d.slides.length - 1, op.to)), 0, m); }
        if (op.type === 'slide-delete') expected.splice(i, 1);
        if (op.type === 'slide-duplicate') expected.splice(i + 1, 0, s.options.id !== undefined ? now[i + 1] : old[i]);
        if (op.type === 'slide-add') expected.splice(i + 1, 0, now[i + 1]);
        expect(now, where).toEqual(expected);
        if (op.type === 'slide-add') expect(nd.slides[i + 1].title, where).toBe('New slide');
        continue;
      }
      expect(nd.slides.length, where).toBe(d.slides.length);
      for (let k = 0; k < d.slides.length; k++) if (k !== i) expect(withEol(rawOf(res.text, nd, k)), where).toBe(withEol(rawOf(text, d, k)));
      const ns = nd.slides[i];
      // exactly op(tree)
      const t = treeAfter(s, op);
      expect(sameTree(normalizeTree(ns.layout), normalizeTree(t ?? s.layout)), where).toBe(true);
      // the marker: never rewritten when neither tree nor options changed; written canonically when the tree changed
      const markerOld = text.slice(s.marker.from, s.marker.to);
      const markerNew = res.text.slice(ns.marker.from, ns.marker.to);
      const treeChanged = t !== null && !sameTree(normalizeTree(t), normalizeTree(s.layout));
      if (!treeChanged && op.type !== 'options' && op.type !== 'variant') expect(markerNew, where).toBe(markerOld);
      if (treeChanged) expect(ns.layoutSpec, where).toBe(serialiseLayout(t!));
      // title, notes, footer kept; regions as the op means
      expect(ns.title, where).toBe(s.title);
      if (op.type !== 'ensure-region') { expect(ns.notes, where).toBe(s.notes); expect(ns.footer, where).toBe(s.footer); }
      expect(regions(ns), where).toEqual(regionsAfter(s, op));
      // floats: by order; only the op's own float changes — its text never, its geometry only by a move or a z op (round B: OPS-1, OPS-9)
      const fl = (x: Slide): string[] => x.floats.map((f) => f.markdown);
      const geo = (x: Slide): string[] => x.floats.map((f) => JSON.stringify(f.geom));
      if (op.type === 'float-add') { expect(fl(ns), where).toEqual([...fl(s), '']); expect(geo(ns).slice(0, -1), where).toEqual(geo(s)); }
      else if (op.type === 'float-delete') { expect(fl(ns), where).toEqual(fl(s).filter((_, k) => k !== op.index)); expect(geo(ns), where).toEqual(geo(s).filter((_, k) => k !== op.index)); }
      else {
        expect(fl(ns), where).toEqual(fl(s));
        const moved = op.type === 'float-geom' || op.type === 'float-z' ? op.index : -1;
        expect(geo(ns).filter((_, k) => k !== moved), where).toEqual(geo(s).filter((_, k) => k !== moved));
        // a move writes only the axes it moves, in the text's units and anchors (round B, OPS-3)
        if (op.type === 'float-geom') {
          const a = s.floats[op.index].geom;
          const b = ns.floats[op.index].geom;
          if (op.box.left === undefined && op.box.w === undefined) for (const k of ['left', 'right', 'w'] as const) expect(b[k], where).toBe(a[k]);
          if (op.box.top === undefined && op.box.h === undefined) for (const k of ['top', 'bottom', 'h'] as const) expect(b[k], where).toBe(a[k]);
          for (const k of ['left', 'right', 'top', 'bottom', 'w', 'h'] as const) if (a[k] !== undefined && /px$/.test(a[k]!) && b[k] !== undefined) expect(b[k], where).toMatch(/px$/);
          if (a.left === undefined && a.right !== undefined) expect(b.left, where).toBeUndefined();
        }
      }
      // no blocking problem made (a marker in a raw HTML block, an unclosed construct: round B, OPS-1)
      expect(blockingProblem(res.text, i), where).toBeNull();
      // no new error
      const before = new Set(s.lint.filter((l) => l.level === 'error').map((l) => l.code));
      expect(ns.lint.filter((l) => l.level === 'error' && !before.has(l.code)).map((l) => l.code), where).toEqual([]);
      // the diff: marker lines and blank lines only — plus, for a delete or a move, the moved content lines (the same lines, not altered)
      const removed: string[] = [];
      const added: string[] = [];
      for (const e of res.edits) { removed.push(...unit(text.slice(e.from, e.to))); added.push(...unit(e.insert)); }
      const content = (ls: string[]): string[] => ls.map((l) => l.replace(/(?:\r\n|\r|\n)$/, '')).filter((l) => l.trim() !== '' && !MARKER_LINE.test(l)).sort();
      if (op.type === 'delete-box' || op.type === 'move-content' || op.type === 'swap' || op.type === 'preset' || op.type === 'rename') {
        expect(content(added), where).toEqual(content(removed));
      } else if (op.type === 'float-delete') {
        expect(content(removed), where).toEqual(content(unit(`${s.floats[op.index].markdown}\n`)));
        expect(content(added), where).toEqual([]);
      } else {
        expect(content(removed), where).toEqual([]);
        expect(content(added), where).toEqual([]);
      }
    }
    // every op kind was exercised and applied many times; refusals are LayoutOpErrors with a reason
    // eslint-disable-next-line no-console
    console.log(`[L.6] ${JSON.stringify(stats)} refused by reason ${JSON.stringify(reasons)}`);
    for (const [k, v] of Object.entries(stats)) expect(v.applied, k).toBeGreaterThan(10);
    // eslint-disable-next-line no-console
    if (unsafe.length) console.log(`[L.6] refused as unsafe: ${unsafe.join(' | ')}`);
    // no op is refused as unsafe on these decks (the check would catch a text that does not read back as meant)
    expect(unsafe).toEqual([]);
  });

  it('[L.6] where a click goes: every box, float, the title, the notes and the footer map to their text range, and the caret\'s part is found back', () => {
    const t = deck('<!-- slide 2col -->\n## Two\nLeft text\n<!-- @right -->\nRight text\n<!-- @float left=1% top=1% w=9% h=9% -->\nF\n<!-- @notes -->\nN\n');
    const m = slideMap(t, 0)!;
    expect(t.slice(m.boxes[0].range!.from, m.boxes[0].range!.to)).toBe('Left text');
    expect(t.slice(m.boxes[1].range!.from, m.boxes[1].range!.to)).toBe('Right text');
    expect(t.slice(m.floats[0].range.from, m.floats[0].range.to)).toBe('F');
    expect(t.slice(m.title!.from, m.title!.to)).toBe('## Two');
    expect(t.slice(m.notes!.from, m.notes!.to)).toBe('N');
    expect(partAt(m, t.indexOf('Right'))).toEqual({ box: 'right' });
    expect(partAt(m, t.indexOf('F\n'))).toEqual({ float: 0 });
    expect(partAt(m, t.indexOf('## Two') + 2)).toEqual({ part: 'title' });
    expect(stepRatio(['1', '1'], 0, 1)).toEqual([3, 2]);
    expect(stepRatio(['1', '1'], 0, -1)).toEqual([2, 3]);
    expect(tracksForRatio(['200px', '1', '1'], 0, [1, 1])).toEqual(['1', '1', '1']);
  });
});

/* ───────────────────────── closed-loop round B (rebuild/1.0@6accc1f): the probes of the pure ops ───────────────────────── */

describe('closed-loop round B probes (layout ops)', () => {
  const H = '{{nyml\nkind: document\ncarrier: slides\ntitle: F\n}}\n\n';
  /** Everything an op must leave alone about floats: their Markdown and geometry. */
  const floatsOf = (t: string, i: number): Array<{ md: string; geom: unknown }> => parseDeck(t).slides[i].floats.map((f) => ({ md: f.markdown, geom: f.geom }));

  it('[L.6] round B, OPS-1: a marker is never written inside or right after a float\'s raw-HTML body (an op on a slide whose float holds an <img> or a <div> before the region markers); check() refuses any new blocking problem and any change to a float\'s Markdown or geometry', () => {
    const img = `${H}<!-- slide 2col -->\n## Logo slide\n\n<!-- @float right=3% top=3% w=10% h=10% -->\n<img src="logo.png" alt="logo">\n\n<!-- @right -->\nRight text\n\n<!-- slide -->\n## Next\nx\n`;
    const div = `${H}<!-- slide 2col -->\n## Callout\n\n<!-- @float left=60% top=10% w=30% h=20% -->\n<div class="callout">\nSee <b>this</b>\n\n<!-- @right -->\nRight text\n`;
    for (const [name, t] of [['img', img], ['div', div]] as const) {
      for (const op of [{ type: 'ensure-region', name: 'left' }, { type: 'split', box: 'left', dir: 'row' }, { type: 'preset', preset: '3col' }] as LayoutOp[]) {
        const r = applyOp(t, 0, op);
        const where = `${name} ${JSON.stringify(op)}:\n${r.text}`;
        expect(blockingProblem(r.text, 0), where).toBeNull();
        expect(floatsOf(r.text, 0), where).toEqual(floatsOf(t, 0));
        // and the next op still works
        expect(() => applyOp(r.text, 0, { type: 'float-add' }), where).not.toThrow();
      }
    }
  });

  it('[L.3] round B, OPS-3: float geometry keeps its units and anchors — a one-axis move writes that axis only, right/bottom anchors stay anchors, px stays px; an axis the text gives in em is seeded from the box the reader sees (`from`), never from a default', () => {
    const t = `${H}<!-- slide -->\n## Floats\n\nBody\n\n<!-- @float left=2em top=3em w=10em h=4em -->\nem\n\n<!-- @float right=5% bottom=5% -->\ncorner\n\n<!-- @float left=640px top=72px w=320px h=144px -->\npx\n`;
    // a horizontal move of the em float, from the box shown (frame-measured): left only, in %; the em top and size kept
    const em = applyOp(t, 0, { type: 'float-geom', index: 0, box: { left: 13 }, from: { left: 12, top: 7, w: 12, h: 9 } } as LayoutOp);
    expect(parseDeck(em.text).slides[0].floats[0].geom).toEqual({ left: '13%', top: '3em', w: '10em', h: '4em' });
    // an em axis with no `from`: refused with the reason, never jumped to a default place
    expect(() => applyOp(t, 0, { type: 'float-geom', index: 0, box: { left: 13 } })).toThrow(/em|%/);
    // the corner note: a horizontal nudge of +1 % moves its right anchor by -1 %; bottom untouched; still no size
    const corner = applyOp(t, 0, { type: 'float-geom', index: 1, box: { left: 66 }, from: { left: 65, top: 75, w: 30, h: 20 } } as LayoutOp);
    expect(parseDeck(corner.text).slides[0].floats[1].geom).toEqual({ right: '4%', bottom: '5%' });
    // px stays px (1 % of 1280 = 12.8 px → whole px), the other axis untouched
    const px = applyOp(t, 0, { type: 'float-geom', index: 2, box: { left: 51 } });
    expect(parseDeck(px.text).slides[0].floats[2].geom).toEqual({ left: '653px', top: '72px', w: '320px', h: '144px' });
    // a vertical move of the px float writes top only
    const v = applyOp(t, 0, { type: 'float-geom', index: 2, box: { top: 15 } });
    expect(parseDeck(v.text).slides[0].floats[2].geom).toEqual({ left: '640px', top: '108px', w: '320px', h: '144px' });
  });

  it('[L.1] round B, OPS-4: a divider of a split of three or more tracks snaps the WHOLE track set to small whole numbers (sum ≤ 12), the other dividers staying where they are; keys step through the same set', () => {
    const m = slideMapModule;
    const snap = (m as unknown as { snapTracks?: (t: readonly string[], i: number, f: number) => string[] }).snapTracks;
    const step = (m as unknown as { stepTracks?: (t: readonly string[], i: number, d: 1 | -1) => string[] }).stepTracks;
    expect(typeof snap).toBe('function');
    expect(typeof step).toBe('function');
    const share = (tr: string[]): number[] => { const v = tr.map(Number); const s = v.reduce((a, b) => a + b, 0); let acc = 0; return v.slice(0, -1).map((x) => (acc += x) / s); };
    for (const [tr, i] of [[['1', '1', '1'], 0], [['1', '1', '1'], 1], [['2', '1', '1'], 0], [['1', '2', '3'], 1], [['1', '1', '1', '1'], 2]] as const) {
      for (const f of [0.1, 0.2, 0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75, 0.8, 0.9]) {
        const out = snap!(tr, i, f);
        const v = out.map(Number);
        expect(v.every((x) => Number.isInteger(x) && x >= 1), `${tr.join('/')} ${i} ${f} → ${out.join('/')}`).toBe(true);
        expect(v.reduce((a, b) => a + b, 0), `${tr.join('/')} ${i} ${f} → ${out.join('/')}`).toBeLessThanOrEqual(12);
        // every other divider stays where it was
        const before = share([...tr]);
        const after = share(out);
        before.forEach((b, k) => { if (k !== i) expect(after[k], `${tr.join('/')} ${i} ${f} → ${out.join('/')}`).toBeCloseTo(b, 6); });
      }
    }
    expect(snap!(['1', '1', '1'], 0, 0.25)).toEqual(['1', '3', '2']);
    let cur: string[] = ['1', '1', '1'];
    for (let k = 0; k < 8; k++) { cur = step!(cur, 0, 1); expect(cur.map(Number).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12); expect(share(cur)[1]).toBeCloseTo(2 / 3, 6); }
  });

  it('[L.3] round B, OPS-6: a new float goes after the last float (notes or a footer before the floats included) and the op says which float it is (`target`), so the GUI selects the new one', () => {
    const t = `${H}<!-- slide -->\n## F\nBody\n\n<!-- @notes -->\nSay it.\n\n<!-- @float left=5% top=5% w=20% h=20% -->\nExisting float\n`;
    const r = applyOp(t, 0, { type: 'float-add' });
    const fl = parseDeck(r.text).slides[0].floats;
    expect(fl.map((f) => f.markdown)).toEqual(['Existing float', '']);
    expect((r as OpResult & { target?: unknown }).target).toEqual({ float: 1 });
    expect(slideMap(r.text, 0)!.floats[1].range).toEqual(r.select);
  });

  it('[L.6] round B, OPS-8: a region whose text starts with indented code moves, swaps and changes preset like any other (the check keeps leading spaces)', () => {
    const t = `${H}<!-- slide quad -->\n## Q\n<!-- @tl -->\nA\n<!-- @tr -->\nB\n<!-- @bl -->\n    indented code\n<!-- @br -->\nD\n`;
    for (const op of [{ type: 'move-content', from: 'bl', to: 'tr' }, { type: 'preset', preset: '2col' }, { type: 'preset', preset: 'single' }, { type: 'swap', a: 'bl', b: 'br' }] as LayoutOp[]) {
      expect(() => applyOp(t, 0, op), JSON.stringify(op)).not.toThrow();
    }
  });

  it('[L.3] round B, OPS-9: with a key written twice the last one counts (as the parser reads it): bringing forward or moving a float never moves or resizes it', () => {
    const t = `${H}<!-- slide -->\n## F\nB\n<!-- @float left=10% top=10% w=20% h=20% left=50% -->\nA\n<!-- @float left=1% top=1% w=10% h=10% width=30% -->\nB\n`;
    const geom = (x: string): unknown => parseDeck(x).slides[0].floats.map((f) => ({ ...f.geom, z: undefined }));
    const f = applyOp(t, 0, { type: 'float-z', index: 0, dir: 'forward' });
    expect(geom(f.text)).toEqual(geom(t));
    const b = applyOp(t, 0, { type: 'float-z', index: 1, dir: 'backward' });
    expect(geom(b.text)).toEqual(geom(t));
  });

  it('[L.6] round B, B-ED-1: an empty box or float right before the next slide\'s marker (no blank line) is selected INSIDE its own slide', () => {
    const t = `${H}<!-- slide -->\n## One\nBody one\n<!-- slide -->\n## Two\nBody two\n<!-- slide -->\n## Two\nBody two\n`;
    const r = applyOp(t, 1, { type: 'float-add' });
    const d = parseDeck(r.text);
    expect(r.select!.from).toBeGreaterThanOrEqual(d.slides[1].span.from);
    expect(r.select!.from).toBeLessThanOrEqual(d.slides[1].span.to);
    const e = applyOp(`${H}<!-- slide 2col -->\n## A\nLeft\n<!-- @right -->\n<!-- slide -->\n## B\n`, 0, { type: 'split', box: 'right', dir: 'col' });
    const de = parseDeck(e.text);
    expect(e.select!.from).toBeLessThanOrEqual(de.slides[0].span.to);
  });

  it('[L.2] round B, GUI-3 and GUI-9: the preset the slide already has (any sizes) is no change — its custom ratio is kept and the reason is said in the words of the UI; labels and refusals use the picker\'s names and "look"', () => {
    const t = `${H}<!-- slide 2col 3/2 -->\n## Two\nL\n<!-- @right -->\nR\n\n<!-- slide template=title -->\n# T\n`;
    expect(() => applyOp(t, 0, { type: 'preset', preset: '2col' })).toThrow(/already .*Two columns.*divider/i);
    expect(applyOp(t, 0, { type: 'preset', preset: '3col' }).label).toBe('Layout: Three columns');
    expect(() => applyOp(t, 1, { type: 'variant', v: 1 })).toThrow(/look 1/);
    expect(() => applyOp(t, 1, { type: 'variant', v: 9 })).toThrow(/looks 1 to 6/);
    expect(applyOp(t, 1, { type: 'variant', v: 2 }).label).toMatch(/look 2/);
  });

  it('[L.3] round B, GUI-2: a new float avoids the slide\'s content as well as the floats — the emptiest place, preferring the bottom right; when every place covers something it says so', () => {
    const place = (slideMapModule as unknown as { placeFloat: (e: unknown, s?: unknown, c?: unknown) => { left: number; top: number; w: number; h: number; covers?: boolean } }).placeFloat;
    // a title band across the top, a column of text on the left and one on the right top
    const content = [{ left: 4, top: 4, w: 92, h: 12 }, { left: 4, top: 20, w: 44, h: 70 }, { left: 52, top: 20, w: 44, h: 30 }];
    const b = place([], { w: 30, h: 22 }, content);
    const ov = (a: { left: number; top: number; w: number; h: number }, c: { left: number; top: number; w: number; h: number }): boolean => a.left < c.left + c.w && c.left < a.left + a.w && a.top < c.top + c.h && c.top < a.top + a.h;
    expect(content.some((c) => ov(b, c)), JSON.stringify(b)).toBe(false);
    expect(b.covers ?? false).toBe(false);
    const full = place([], { w: 30, h: 22 }, [{ left: 0, top: 0, w: 100, h: 100 }]);
    expect(full.covers).toBe(true);
  });

  it('[L.6] round B, OPS-10: the ops are cheap on a 1000-slide deck — an op re-reads only its own slide (the deck after it is derived from the deck before, slide by slide), and that derived deck is exactly the one a fresh parse gives', () => {
    const big = (): string => {
      let t = H;
      for (let i = 0; i < 1000; i++) t += `<!-- slide ${i % 3 === 0 ? '2col' : ''} -->\n## Slide ${i}\n\n${i % 3 === 0 ? '<!-- @left -->\n' : ''}- point one with $x^2$ and **bold**\n- point two\n\n\`\`\`js\nconst a = ${i};\n\`\`\`\n${i % 3 === 0 ? '\n<!-- @right -->\nright text\n' : ''}\n<!-- @notes -->\nnotes ${i}\n\n`;
      return t;
    };
    let cur = big();
    parseDeck(cur);
    const times: Record<string, number[]> = {};
    /** The slide near `at` that the op fits (a 2col for a split of left or new tracks, one with a float for a move). */
    const near = (t: string, at: number, ok: (s: Slide) => boolean): number => { const d = parseDeck(t); for (let k = 0; k < d.slides.length; k++) { const j = (at + k) % d.slides.length; if (ok(d.slides[j])) return j; } return at; };
    const ops: Array<[number, LayoutOp, (s: Slide) => boolean]> = [
      [501, { type: 'split', box: 'left', dir: 'col' }, (s) => s.layoutSpec === '2col'],
      [900, { type: 'float-add' }, () => true],
      [900, { type: 'float-geom', index: 0, box: { left: 20 } }, (s) => s.floats.length > 0 && s.floats[0].geom.left !== '20%'],
      [300, { type: 'tracks', path: [], tracks: ['2', '1'] }, (s) => s.layoutSpec === '2col'],
      [10, { type: 'slide-move', to: 990 }, () => true],
      [500, { type: 'slide-duplicate' }, () => true],
      [700, { type: 'slide-delete' }, () => true],
      [42, { type: 'options', set: { fit: 'off' } }, (s) => s.options.fit !== 'off'],
    ];
    const fresh = (parseModule as unknown as { parseDeckFresh?: (t: string) => unknown }).parseDeckFresh;
    for (let round = 0; round < 3; round++) {
      for (const [at, op, fits] of ops) {
        const i = near(cur, at, fits);
        const t0 = performance.now();
        const r = applyOp(cur, i, op);
        parseDeck(r.text);
        (times[op.type] ??= []).push(performance.now() - t0);
        // the derived deck is the deck a fresh parse gives
        if (round === 0) expect(JSON.stringify(parseDeck(r.text)), op.type).toBe(JSON.stringify(fresh?.(r.text)));
        cur = r.text;
      }
    }
    const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    // eslint-disable-next-line no-console
    console.log(`[L.6] OPS-10 1000 slides, ms per op (median of 3, op + the deck after it): ${Object.entries(times).map(([k, v]) => `${k} ${med(v).toFixed(1)}`).join(', ')}`);
    for (const [k, v] of Object.entries(times)) expect(med(v), k).toBeLessThan(40);
  });
});

import * as slideMapModule from '../src/layout-ops.js';
import * as parseModule from '../src/deck/parse.js';
