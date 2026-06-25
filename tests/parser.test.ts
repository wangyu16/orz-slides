import { describe, it, expect } from 'vitest';
import { parseDeck } from '../src/slide-parser.js';
import type { SplitNode, RegionLeaf, LayoutNode } from '../src/types.js';

const asSplit = (n: LayoutNode): SplitNode => {
  if (n.kind !== 'split') throw new Error('expected split');
  return n;
};
const asLeaf = (n: LayoutNode): RegionLeaf => {
  if (n.kind !== 'region') throw new Error('expected region leaf');
  return n;
};

/* ── Deck config ─────────────────────────────────────────────────────────── */

describe('deck config', () => {
  it('parses a leading deck block (YAML-ish key:value)', () => {
    const src = `<!-- deck
  title: Controlled Polymerization
  theme: executive
  ratio: 16:9
  author: Dr. Yu Wang
  footer: Internal · v3
  transition: fade
-->

<!-- slide -->
## Hello
body text`;
    const deck = parseDeck(src);
    expect(deck.config).toEqual({
      title: 'Controlled Polymerization',
      theme: 'executive',
      ratio: '16:9',
      author: 'Dr. Yu Wang',
      footer: 'Internal · v3',
      transition: 'fade',
    });
    expect(deck.slides).toHaveLength(1);
  });

  it('no deck block → empty config', () => {
    const deck = parseDeck(`<!-- slide -->\n## A\nx`);
    expect(deck.config).toEqual({});
    expect(deck.slides).toHaveLength(1);
  });
});

/* ── Slide splitting ─────────────────────────────────────────────────────── */

describe('slide splitting', () => {
  it('splits on every <!-- slide --> marker', () => {
    const src = `<!-- slide -->
## One
a
<!-- slide -->
## Two
b
<!-- slide -->
## Three
c`;
    const deck = parseDeck(src);
    expect(deck.slides.map((s) => s.title)).toEqual(['One', 'Two', 'Three']);
    expect(deck.slides.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('keeps raw source per slide (lossless)', () => {
    const src = `<!-- slide -->\n## One\na\n<!-- slide -->\n## Two\nb`;
    const deck = parseDeck(src);
    expect(deck.slides[0].raw).toBe('<!-- slide -->\n## One\na');
    expect(deck.slides[1].raw).toBe('<!-- slide -->\n## Two\nb');
  });
});

/* ── Presets → LayoutNode ────────────────────────────────────────────────── */

describe('preset expansion', () => {
  const layoutOf = (marker: string) =>
    parseDeck(`<!-- slide ${marker} -->\n## T\nx`).slides[0].layout;

  it('(none) → single body region', () => {
    expect(parseDeck(`<!-- slide -->\n## T\nx`).slides[0].layout).toEqual({
      kind: 'region',
      name: 'body',
    });
  });

  it('2col → col 1/1 { left; right }', () => {
    const n = asSplit(layoutOf('2col'));
    expect(n.dir).toBe('col');
    expect(n.tracks).toEqual(['1', '1']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['left', 'right']);
  });

  it('2col 3/2 → ratio applied', () => {
    const n = asSplit(layoutOf('2col 3/2'));
    expect(n.tracks).toEqual(['3', '2']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['left', 'right']);
  });

  it('3col → col 1/1/1 { left; mid; right }', () => {
    const n = asSplit(layoutOf('3col'));
    expect(n.dir).toBe('col');
    expect(n.tracks).toEqual(['1', '1', '1']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual([
      'left',
      'mid',
      'right',
    ]);
  });

  it('2row → row 1/1 { top; bottom }', () => {
    const n = asSplit(layoutOf('2row'));
    expect(n.dir).toBe('row');
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['top', 'bottom']);
  });

  it('main-side → default 2/1 { main; side }', () => {
    const n = asSplit(layoutOf('main-side'));
    expect(n.dir).toBe('col');
    expect(n.tracks).toEqual(['2', '1']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['main', 'side']);
  });

  it('main-side 1/2 → ratio override', () => {
    expect(asSplit(layoutOf('main-side 1/2')).tracks).toEqual(['1', '2']);
  });

  it('quad → nested row of two cols (tl,tr / bl,br)', () => {
    const n = asSplit(layoutOf('quad'));
    expect(n.dir).toBe('row');
    expect(n.tracks).toEqual(['1', '1']);
    const top = asSplit(n.children[0]);
    const bottom = asSplit(n.children[1]);
    expect(top.dir).toBe('col');
    expect(top.children.map((c) => asLeaf(c).name)).toEqual(['tl', 'tr']);
    expect(bottom.children.map((c) => asLeaf(c).name)).toEqual(['bl', 'br']);
  });

  it('unknown preset → lint error + body fallback', () => {
    const s = parseDeck(`<!-- slide bogus -->\n## T\nx`).slides[0];
    expect(s.layout).toEqual({ kind: 'region', name: 'body' });
    expect(s.lint.some((l) => /Unknown layout preset/.test(l.message))).toBe(
      true,
    );
  });
});

/* ── Raw split grammar ───────────────────────────────────────────────────── */

describe('raw split grammar', () => {
  const layoutOf = (marker: string) =>
    parseDeck(`<!-- slide ${marker} -->\n## T\nx`).slides[0].layout;

  it('col 3/2 { main; side }', () => {
    const n = asSplit(layoutOf('col 3/2 { main; side }'));
    expect(n.dir).toBe('col');
    expect(n.tracks).toEqual(['3', '2']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['main', 'side']);
  });

  it('mixed track tokens (auto/1fr/30%/200px)', () => {
    const n = asSplit(layoutOf('row auto/1fr/30%/200px { a; b; c; d }'));
    expect(n.tracks).toEqual(['auto', '1fr', '30%', '200px']);
    expect(n.children.map((c) => asLeaf(c).name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nested split: row auto/1 { head; col 1/1 { a; b } }', () => {
    const n = asSplit(layoutOf('row auto/1 { head; col 1/1 { a; b } }'));
    expect(n.dir).toBe('row');
    expect(n.tracks).toEqual(['auto', '1']);
    expect(asLeaf(n.children[0]).name).toBe('head');
    const inner = asSplit(n.children[1]);
    expect(inner.dir).toBe('col');
    expect(inner.children.map((c) => asLeaf(c).name)).toEqual(['a', 'b']);
  });

  it('deeply nested: row auto/1/auto { banner; col 3/2 { main; row 1/1 { fig; note } }; bar }', () => {
    const n = asSplit(
      layoutOf(
        'row auto/1/auto { banner; col 3/2 { main; row 1/1 { fig; note } }; bar }',
      ),
    );
    expect(n.tracks).toEqual(['auto', '1', 'auto']);
    expect(asLeaf(n.children[0]).name).toBe('banner');
    expect(asLeaf(n.children[2]).name).toBe('bar');
    const col = asSplit(n.children[1]);
    expect(col.dir).toBe('col');
    expect(col.tracks).toEqual(['3', '2']);
    expect(asLeaf(col.children[0]).name).toBe('main');
    const inner = asSplit(col.children[1]);
    expect(inner.children.map((c) => asLeaf(c).name)).toEqual(['fig', 'note']);
  });

  it('track/child count mismatch → lint error', () => {
    const s = parseDeck(`<!-- slide col 1/1/1 { a; b } -->\n## T\nx`).slides[0];
    expect(s.layout).toEqual({ kind: 'region', name: 'body' });
    expect(s.lint.some((l) => l.level === 'error')).toBe(true);
  });
});

/* ── Primary region assignment ───────────────────────────────────────────── */

describe('primary region', () => {
  it('leading content (before first marker) fills the primary leaf', () => {
    const src = `<!-- slide 2col -->
## Results
- Accuracy 92%
<!-- @right -->
right stuff`;
    const s = parseDeck(src).slides[0];
    // primary = first leaf of col{left;right} = 'left'
    const left = s.regions.find((r) => r.name === 'left');
    const right = s.regions.find((r) => r.name === 'right');
    expect(left?.markdown).toBe('- Accuracy 92%');
    expect(right?.markdown).toBe('right stuff');
  });

  it('primary of a nested layout is the first leaf in document order', () => {
    const src = `<!-- slide row auto/1 { head; col 1/1 { a; b } } -->
## T
header content
<!-- @a -->
A
<!-- @b -->
B`;
    const s = parseDeck(src).slides[0];
    expect(s.regions.find((r) => r.name === 'head')?.markdown).toBe(
      'header content',
    );
  });

  it('explicit body region for single-region slide', () => {
    const s = parseDeck(`<!-- slide -->\n## T\nhello world`).slides[0];
    expect(s.regions).toEqual([{ name: 'body', markdown: 'hello world' }]);
  });
});

/* ── Floats ──────────────────────────────────────────────────────────────── */

describe('floats', () => {
  it('parses geometry attributes', () => {
    const src = `<!-- slide -->
## T
main
<!-- @float left=58% top=10% w=36% h=44% z=3 -->
> Key takeaway`;
    const s = parseDeck(src).slides[0];
    expect(s.floats).toHaveLength(1);
    expect(s.floats[0].geom).toEqual({
      left: '58%',
      top: '10%',
      w: '36%',
      h: '44%',
      z: 3,
    });
    expect(s.floats[0].markdown).toBe('> Key takeaway');
  });

  it('multiple floats kept in declaration order', () => {
    const src = `<!-- slide -->
## T
x
<!-- @float left=0 top=0 -->
one
<!-- @float right=0 bottom=0 -->
two`;
    const s = parseDeck(src).slides[0];
    expect(s.floats.map((f) => f.markdown)).toEqual(['one', 'two']);
    expect(s.floats[0].geom.left).toBe('0');
    expect(s.floats[1].geom.right).toBe('0');
  });
});

/* ── Reserved regions: notes & footer ────────────────────────────────────── */

describe('reserved regions', () => {
  it('@notes → Slide.notes, @footer → Slide.footer (not in regions)', () => {
    const src = `<!-- slide -->
## T
body content
<!-- @footer -->
Internal · v3 · 2026
<!-- @notes -->
Remember back-pressure.`;
    const s = parseDeck(src).slides[0];
    expect(s.footer).toBe('Internal · v3 · 2026');
    expect(s.notes).toBe('Remember back-pressure.');
    expect(s.regions.map((r) => r.name)).toEqual(['body']);
  });
});

/* ── Title extraction ────────────────────────────────────────────────────── */

describe('title extraction', () => {
  it('lifts the leading h2 into Slide.title and removes it from the region', () => {
    const s = parseDeck(`<!-- slide -->\n## Results\n- a\n- b`).slides[0];
    expect(s.title).toBe('Results');
    expect(s.regions[0].markdown).toBe('- a\n- b');
  });

  it('h2 with inline markdown is preserved as text', () => {
    const s = parseDeck(`<!-- slide -->\n## **Bold** title\nx`).slides[0];
    expect(s.title).toBe('**Bold** title');
  });
});

/* ── Templates ───────────────────────────────────────────────────────────── */

describe('templates', () => {
  it('template=title v=2 → kind template, no preset expansion, h1 allowed', () => {
    const src = `<!-- slide template=title v=2 -->
# Controlled Polymerization
## RAFT vs ATRP
**Dr. Yu Wang**`;
    const s = parseDeck(src).slides[0];
    expect(s.kind).toBe('template');
    expect(s.template).toBe('title');
    expect(s.templateVariant).toBe(2);
    // h1 on a title page is NOT a lint error.
    expect(s.lint).toEqual([]);
  });
});

/* ── Options ─────────────────────────────────────────────────────────────── */

describe('slide options', () => {
  it('parses bg / t / fit / class / id alongside a preset', () => {
    const s = parseDeck(
      `<!-- slide 2col bg=#0b3 t=fade fit=scroll class=dark id=intro -->\n## T\nx`,
    ).slides[0];
    expect(s.options).toEqual({
      bg: '#0b3',
      transition: 'fade',
      fit: 'scroll',
      class: 'dark',
      id: 'intro',
    });
    expect(asSplit(s.layout).children.map((c) => asLeaf(c).name)).toEqual([
      'left',
      'right',
    ]);
  });

  it('parses the bare `step` flag without consuming the layout', () => {
    const s = parseDeck(`<!-- slide step 2col -->\n## T\nx`).slides[0];
    expect(s.options.step).toBe(true);
    expect(asSplit(s.layout).children.map((c) => asLeaf(c).name)).toEqual([
      'left',
      'right',
    ]);
  });

  it('no `step` flag → step is undefined', () => {
    expect(parseDeck(`<!-- slide -->\n## T\nx`).slides[0].options.step).toBeUndefined();
  });
});

/* ── Lint: heading rules ─────────────────────────────────────────────────── */

describe('lint — heading rules', () => {
  it('a normal slide with no h2 first → error', () => {
    const s = parseDeck(`<!-- slide -->\njust text, no heading`).slides[0];
    expect(s.lint.some((l) => l.level === 'error')).toBe(true);
  });

  it('a second h2 on a normal slide → error', () => {
    const s = parseDeck(`<!-- slide -->\n## First\nbody\n## Second`).slides[0];
    expect(s.title).toBe('First');
    expect(
      s.lint.some((l) => l.level === 'error' && /only one h2/.test(l.message)),
    ).toBe(true);
  });

  it('an h1 on a normal slide → error', () => {
    const s = parseDeck(`<!-- slide -->\n## Title\nbody\n# Nope`).slides[0];
    expect(
      s.lint.some((l) => l.level === 'error' && /h1 is not allowed/.test(l.message)),
    ).toBe(true);
  });

  it('a leading h1 on a normal slide → error', () => {
    const s = parseDeck(`<!-- slide -->\n# Title\nbody`).slides[0];
    expect(
      s.lint.some((l) => l.level === 'error' && /h1 is not allowed/.test(l.message)),
    ).toBe(true);
  });

  it('a clean single-h2 slide has no lint', () => {
    const s = parseDeck(`<!-- slide -->\n## Clean\nbody\n### sub ok`).slides[0];
    expect(s.lint).toEqual([]);
  });

  it('a "## " inside a fenced code block is not a heading', () => {
    const src =
      '<!-- slide -->\n## Real Title\n```\n## not a heading\n```\nmore';
    const s = parseDeck(src).slides[0];
    expect(s.title).toBe('Real Title');
    expect(s.lint).toEqual([]);
  });
});
