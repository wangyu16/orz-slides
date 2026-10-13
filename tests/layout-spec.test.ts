/**
 * Rebuild step 2 — the layout grammar and its canonical serialiser (claims
 * G.1–G.4), including the layout-marker round-trip PROPERTY over a seeded
 * generator (no new dependency) and the D-47 guard: a marker inside a code
 * fence never splits a slide.
 */
import { describe, it, expect } from 'vitest';
import { expandPreset, normalizeTree, parseLayoutSpec, PRESETS, rawSpec, sameTree, serialiseLayout, slideMarker, leaf, split } from '../src/deck/layout-spec.js';
import { parseDeck } from '../src/deck/parse.js';
import type { LayoutNode } from '../src/types.js';

/** A small seeded PRNG (mulberry32): the same seed, the same cases. */
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

const TRACKS = ['1', '2', '3', '1fr', '2fr', 'auto', '30%', '200px', '1.5', '2em', '12rem'];
const NAMES = ['main', 'side', 'left', 'right', 'top', 'bottom', 'a', 'b', 'c', 'fig', 'note', 'head', 'body', 'tl', 'tr', 'bl', 'br', 'mid', 'x_1', 'y-2'];

/** A random tree with unique region names (any shape the grammar can write). */
function randomTree(r: () => number, depth = 0, taken = new Set<string>()): LayoutNode {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  if (depth >= 3 || (depth > 0 && r() < 0.45)) {
    let name = pick(NAMES);
    for (let k = 2; taken.has(name); k++) name = `${pick(NAMES)}${k}`;
    taken.add(name);
    return leaf(name);
  }
  const n = 1 + Math.floor(r() * 4);
  const children: LayoutNode[] = [];
  for (let i = 0; i < n; i++) children.push(randomTree(r, depth + 1, taken));
  return split(r() < 0.5 ? 'row' : 'col', children.map(() => pick(TRACKS)), children);
}

describe('the layout grammar', () => {
  it('[G.1] presets expand to their documented regions; the default ratio is optional; quad has none', () => {
    expect(expandPreset('2col')).toEqual(split('col', ['1', '1'], [leaf('left'), leaf('right')]));
    expect(expandPreset('main-side', '3/1')).toEqual(split('col', ['3', '1'], [leaf('main'), leaf('side')]));
    for (const p of PRESETS) expect(parseLayoutSpec(p).problems).toEqual([]);
    expect(sameTree(parseLayoutSpec('2col 1/1').tree, parseLayoutSpec('2col').tree)).toBe(true);
    expect(parseLayoutSpec('quad 1/1').problems.map((p) => p.code)).toEqual(['layout-tracks']);
  });

  it('[G.2] a one-child fr split is its child (col 1 { main } is the leaf main); other one-child splits stay', () => {
    expect(parseLayoutSpec('col 1 { main }').tree).toEqual(leaf('main'));
    expect(parseLayoutSpec('col 2/1 { row 1 { a }; b }').tree).toEqual(split('col', ['2', '1'], [leaf('a'), leaf('b')]));
    expect(parseLayoutSpec('col 50% { main }').tree).toEqual(split('col', ['50%'], [leaf('main')]));
    expect(normalizeTree(split('row', ['1fr'], [split('col', ['1'], [leaf('z')])]))).toEqual(leaf('z'));
  });
});

describe('the canonical serialiser (owner decision 6)', () => {
  it('[G.3] the preset when the tree equals one (its ratio only when not the default), else the raw split; body alone is empty; a one-box non-body slide is a one-track split', () => {
    expect(serialiseLayout(leaf('body'))).toBe('');
    expect(serialiseLayout(leaf('main'))).toBe('col 1 { main }');
    expect(serialiseLayout(expandPreset('2col')!)).toBe('2col');
    expect(serialiseLayout(expandPreset('2col', '1/1')!)).toBe('2col');
    expect(serialiseLayout(expandPreset('2col', '3/2')!)).toBe('2col 3/2');
    expect(serialiseLayout(expandPreset('main-side')!)).toBe('main-side');
    expect(serialiseLayout(expandPreset('main-side', '1/1')!)).toBe('main-side 1/1');
    expect(serialiseLayout(expandPreset('quad')!)).toBe('quad');
    // a raw split that happens to equal a preset is written as the preset
    expect(serialiseLayout(parseLayoutSpec('col 1/2/1 { left; mid; right }').tree)).toBe('3col 1/2/1');
    expect(serialiseLayout(parseLayoutSpec('row auto/1 { head; col 1/1 { a; b } }').tree)).toBe('row auto/1 { head; col 1/1 { a; b } }');
    // renamed regions are no preset
    expect(serialiseLayout(split('col', ['1', '1'], [leaf('a'), leaf('b')]))).toBe('col 1/1 { a; b }');
    expect(rawSpec(expandPreset('quad')!)).toBe('row 1/1 { col 1/1 { tl; tr }; col 1/1 { bl; br } }');
    expect(slideMarker('2col 3/2', ['bg=#fff', 'step'], '  ')).toBe('  <!-- slide 2col 3/2 bg=#fff step -->');
    expect(slideMarker('', [])).toBe('<!-- slide -->');
  });

  it('[G.4] PROPERTY (seeded): serialise(tree) parses back to the same tree, with no problem, alone and inside a slide marker; writing is idempotent', () => {
    const r = rng(0x5eed);
    for (let i = 0; i < 600; i++) {
      const tree = normalizeTree(randomTree(r));
      const spec = serialiseLayout(tree);
      const back = parseLayoutSpec(spec);
      expect(back.problems, spec).toEqual([]);
      expect(sameTree(back.tree, tree), `${spec} ← ${JSON.stringify(tree)}`).toBe(true);
      expect(serialiseLayout(back.tree)).toBe(spec);
      const s = parseDeck(`${slideMarker(spec, i % 3 === 0 ? ['step', 'bg=#123'] : [])}\n## T\nx\n`).slides[0];
      expect(sameTree(s.layout, tree), spec).toBe(true);
      expect(s.lint.filter((l) => l.code !== 'unknown-region'), spec).toEqual([]);
    }
  });
});

describe('the D-47 guard', () => {
  it('[G.5] PROPERTY (seeded): random decks with markers inside fences, indented code and directives split only at their real markers, each slide keeping its layout', () => {
    const r = rng(47);
    const noise = [
      (spec: string) => `\`\`\`markdown\n<!-- slide ${spec} -->\n<!-- @left -->\n\`\`\``,
      (spec: string) => `~~~\n<!-- slide ${spec} -->\n~~~`,
      (spec: string) => `    <!-- slide ${spec} -->`,
      (spec: string) => `{{yaml\nx: |\n  <!-- slide ${spec} -->\n}}`,
      (spec: string) => `- a list item\n  <!-- slide ${spec} -->`,
      (spec: string) => `Inline \`<!-- slide ${spec} -->\` code.`,
    ];
    for (let deck = 0; deck < 120; deck++) {
      const n = 1 + Math.floor(r() * 6);
      const trees: LayoutNode[] = [];
      const parts: string[] = [];
      for (let k = 0; k < n; k++) {
        const tree = normalizeTree(randomTree(r));
        trees.push(tree);
        const spec = serialiseLayout(tree);
        parts.push(`${slideMarker(spec)}\n## Slide ${k + 1}\n\n${noise[Math.floor(r() * noise.length)](serialiseLayout(normalizeTree(randomTree(r))))}\n`);
      }
      const d = parseDeck(parts.join('\n'));
      expect(d.slides.length).toBe(n);
      d.slides.forEach((s, k) => {
        expect(s.title).toBe(`Slide ${k + 1}`);
        expect(sameTree(s.layout, trees[k])).toBe(true);
      });
    }
  });
});
