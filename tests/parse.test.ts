/**
 * Rebuild step 2 — `parseDeck` on text format 1 (claims P.1–P.12): markers
 * by the token scanner, the header as the deck config, the `deck-block`
 * lint, options, regions, floats, headings, positions. The 0.x parser's
 * cases are kept where their meaning is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { parseDeck, readMarkerArgs } from '../src/deck/parse.js';
import { deckConfig, headerLint } from '../src/deck/config.js';
import { readDocument } from '../src/assemble.js';
import { lintHeader } from 'orz-markdown/carrier';
import type { LayoutNode, RegionLeaf, SplitNode } from '../src/types.js';
import { corpus } from './helpers.js';

const asSplit = (n: LayoutNode): SplitNode => {
  if (n.kind !== 'split') throw new Error('expected split');
  return n;
};
const names = (n: LayoutNode): string[] => asSplit(n).children.map((c) => (c as RegionLeaf).name);
const codes = (text: string): string[] => parseDeck(text).lint.map((l) => l.code);
const H = (keys = ''): string => `{{nyml\nkind: document\n${keys}}}\n\n`;

describe('markers are top-level comment blocks (the kit token scanner)', () => {
  it('[P.1] every slides corpus text gives its manifest slideCount; markers-in-code exactly 5 slides', () => {
    for (const c of corpus('slides')) {
      expect(parseDeck(c.text).slides.length, c.path).toBe(c.slideCount);
    }
    const mic = corpus('slides').find((c) => c.path.endsWith('markers-in-code.slides.md'))!;
    const d = parseDeck(mic.text);
    expect(d.slides.map((s) => s.title)).toEqual(['How a deck is written', 'The header, shown as an example', 'Nested and indented code', 'Markers inside multi-line directives', 'The last real slide']);
    // the deck block inside a ~~~ fence is no deck block
    expect(d.lint.filter((l) => l.code === 'deck-block')).toEqual([]);
  });

  it('[P.1] a marker in a fence, indented code, a code span, a list, a blockquote, a container or a directive never splits', () => {
    const text = [
      '<!-- slide -->', '## One', '',
      '```', '<!-- slide -->', '<!-- @left -->', '```', '',
      '    <!-- slide -->', '',
      'inline `<!-- slide -->` here', '',
      '- item', '  <!-- slide -->', '',
      '> <!-- slide -->', '',
      '::: info', '<!-- slide -->', ':::', '',
      '{{yaml', 'a: |', '  <!-- slide -->', '}}', '',
      '<!-- slide -->', '## Two', '',
    ].join('\n');
    const d = parseDeck(text);
    expect(d.slides.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(d.slides[0].regions.map((r) => r.name)).toEqual(['body']);
  });

  it('[P.1] up to three spaces of indentation are allowed; a tab makes indented code; CR LF and CR line ends', () => {
    expect(parseDeck('   <!-- slide -->\n## A\n').slides).toHaveLength(1);
    expect(parseDeck('\t<!-- slide -->\n## A\n').slides).toHaveLength(0);
    const crlf = parseDeck('<!-- slide -->\r\n## A\r\n<!-- slide 2col -->\r\n## B\r\n<!-- @right -->\r\nr\r\n');
    expect(crlf.slides.map((s) => s.title)).toEqual(['A', 'B']);
    expect(crlf.slides[1].regions.map((r) => [r.name, r.markdown])).toEqual([['right', 'r']]);
    const cr = parseDeck('<!-- slide -->\r## A\r<!-- slide -->\r## B\r');
    expect(cr.slides.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('[P.2] positions: slide, marker, title and region spans index the text exactly (any line ending)', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const text = ['{{nyml', 'kind: document', '}}', '', '<!-- slide 2col -->', '## Title', 'lead', '<!-- @right -->', 'right', '', '<!-- slide -->', '## Next'].join(eol);
      const d = parseDeck(text);
      const s = d.slides[0];
      expect(text.slice(s.marker.from, s.marker.to)).toBe('<!-- slide 2col -->');
      expect(s.marker.line).toBe(5);
      expect(text.slice(s.titleSpan!.from, s.titleSpan!.to)).toBe('## Title');
      const right = s.regions.find((r) => r.name === 'right')!;
      expect(text.slice(right.sources[0].marker!.from, right.sources[0].marker!.to)).toBe('<!-- @right -->');
      expect(right.sources[0].marker!.line).toBe(8);
      expect(text.slice(s.span.from, s.span.to)).toBe(['<!-- slide 2col -->', '## Title', 'lead', '<!-- @right -->', 'right', ''].join(eol));
      expect(s.raw).toBe(['<!-- slide 2col -->', '## Title', 'lead', '<!-- @right -->', 'right', '', ''].join(eol));
      expect(d.slides[1].span.endLine).toBe(12);
    }
  });
});

describe('the header is the deck config', () => {
  it('[P.3] title theme ratio author footer transition and the Q3 keys come from the header only, resolved', () => {
    const text = `${H('title: Polymers\ntheme: light-neat-1\nratio: 4:3\nauthor: Yu Wang\nfooter: CHEM 320\ntransition: fade\nslide_numbers: no\nprogress: yes\nsection_numbers: roman\n')}<!-- slide -->\n## A\n`;
    expect(deckConfig(text)).toEqual({ title: 'Polymers', theme: 'sky', themeAsWritten: 'light-neat-1', ratio: '4:3', author: 'Yu Wang', footer: 'CHEM 320', transition: 'fade', slideNumbers: false, progress: true, sectionNumbers: 'roman' });
    expect(deckConfig('<!-- slide -->\n## A\n')).toEqual({ theme: 'orchard', ratio: '16:9', slideNumbers: true, progress: true, sectionNumbers: null });
    // unknown values fall back to the defaults (and are linted)
    expect(deckConfig(`${H('theme: executive\nratio: 21:9\ntransition: wobble\nsection_numbers: greek\n')}`)).toMatchObject({ theme: 'orchard', themeAsWritten: 'executive', ratio: '16:9', sectionNumbers: null });
    expect(deckConfig(`${H('theme: executive\n')}`).transition).toBeUndefined();
  });

  it('[P.4] a <!-- deck --> block renders nothing and is never a config source: lint deck-block (error, next upgrade)', () => {
    const text = `${H('theme: chalk\n')}<!-- deck\ntitle: Old\ntheme: neon\n-->\n\n<!-- slide -->\n## A\n<!-- deck\nfooter: x\n-->\n`;
    const d = parseDeck(text);
    expect(d.config.theme).toBe('chalk');
    expect(d.config.title).toBeUndefined();
    expect(d.config.footer).toBeUndefined();
    const lints = d.lint.filter((l) => l.code === 'deck-block');
    expect(lints).toHaveLength(2);
    expect(lints.every((l) => l.level === 'error' && l.next === 'upgrade')).toBe(true);
    expect(lints.map((l) => l.line)).toEqual([6, 13]);
    // the deck block alone is not "text before the first slide"
    expect(d.preamble).toBeNull();
  });

  it('[P.5] the Q3 keys are in the kit registry (orz-markdown 2.4.0): no unknown-key; bad values are the carrier\'s invalid-value warnings; ratio takes 16:9 / 4:3', () => {
    const text = `${H('slide_numbers: maybe\nprogress: no\nsection_numbers: 01\nratio: 21:9\ntransition: wobble\nsubtitle: kept\n')}<!-- slide -->\n## A\n`;
    const kit = lintHeader(text, { kind: 'slides' });
    expect(kit.filter((l) => l.code === 'unknown-key').map((l) => l.key)).toEqual(['subtitle']);
    const mine = headerLint(text);
    expect(mine.filter((l) => l.code === 'unknown-key')).toEqual([]);
    const invalid = mine.filter((l) => l.code === 'invalid-value');
    expect(invalid.map((l) => [l.key, l.level, l.line])).toEqual([['ratio', 'warning', 6], ['transition', 'warning', 7], ['slide_numbers', 'warning', 3]]);
    // readDocument reports the kit's and the carrier's, once each
    const info = readDocument(text);
    expect(info.lint.filter((l) => l.code === 'invalid-value')).toHaveLength(3);
    expect(info.lint.filter((l) => l.code === 'unknown-key').map((l) => l.key)).toEqual(['subtitle']);
    expect(info.settings).toMatchObject({ slide_numbers: 'maybe', progress: 'no', section_numbers: '01' });
  });

  it('[P.4] readDocument reports one deck-block per block (the kit\'s lint, marked next: upgrade)', () => {
    const text = `${H('theme: chalk\n')}<!-- deck\ntitle: Old\n-->\n\n<!-- slide -->\n## A\n`;
    const d = readDocument(text).lint.filter((l) => l.code === 'deck-block');
    expect(d).toHaveLength(1);
    expect((d[0] as { next?: string }).next).toBe('upgrade');
    expect(d[0].level).toBe('error');
  });
});

describe('text before the first slide', () => {
  it('[P.6] is kept (the preamble span) and noticed; a text with no marker has no slides', () => {
    const text = `${H()}Intro paragraph.\n\n<!-- slide -->\n## A\n`;
    const d = parseDeck(text);
    expect(text.slice(d.preamble!.from, d.preamble!.to)).toBe('Intro paragraph.');
    expect(d.lint.map((l) => [l.code, l.level, l.line])).toEqual([['text-before-first-slide', 'warning', 5]]);
    expect(codes('just text\n')).toEqual(['no-slides']);
    expect(codes('')).toEqual([]);
  });
});

describe('slide options (FC-18 §7.2)', () => {
  it('[P.7] bg t fit class id template v here and the step flag; quoted values; option tokens kept as written', () => {
    const s = parseDeck('<!-- slide 2col bg=#0b3 t=fade fit=scroll class="quiz wide" id=intro step -->\n## T\nx\n').slides[0];
    expect(s.options).toEqual({ bg: '#0b3', transition: 'fade', fit: 'scroll', class: 'quiz wide', id: 'intro', step: true });
    expect(s.optionTokens).toEqual(['bg=#0b3', 't=fade', 'fit=scroll', 'class="quiz wide"', 'id=intro', 'step']);
    expect(s.layoutSpec).toBe('2col');
    expect(names(s.layout)).toEqual(['left', 'right']);
    expect(s.lint).toEqual([]);
    const t = parseDeck('<!-- slide template=outline v=3 here=2 -->\n## Outline\n1. a\n2. b\n').slides[0];
    expect([t.kind, t.template, t.templateVariant, t.options.here]).toEqual(['template', 'outline', 3, 2]);
    expect(t.lint).toEqual([]);
  });

  it('[P.7] an unknown option is unknown-option (an error, not a layout name); bad values are invalid-option', () => {
    expect(codes('<!-- slide colour=red -->\n## T\n')).toEqual(['unknown-option']);
    expect(codes('<!-- slide fit=shrink -->\n## T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide t=wobble -->\n## T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide template=cover -->\n## T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide v=2 -->\n## T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide template=title v=7 -->\n# T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide template=section here=1 -->\n# T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide id="two words" -->\n## T\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide fit=off fit=scroll -->\n## T\n')).toEqual(['duplicate-option']);
    expect(readMarkerArgs('2col 3/2 step').layoutSpec).toBe('2col 3/2');
    expect(parseDeck('<!-- slide bogus -->\n## T\n').lint.map((l) => [l.code, l.level])).toEqual([['unknown-layout', 'error']]);
  });
});

describe('layouts and regions', () => {
  it('[P.8] presets and raw splits expand (0.x cases); quad takes no ratio; a preset ratio has the preset\'s track count', () => {
    const lay = (m: string): LayoutNode => parseDeck(`<!-- slide ${m} -->\n## T\nx\n`).slides[0].layout;
    expect(lay('')).toEqual({ kind: 'region', name: 'body' });
    expect(asSplit(lay('2col 3/2')).tracks).toEqual(['3', '2']);
    expect(names(lay('3col'))).toEqual(['left', 'mid', 'right']);
    expect(names(lay('2row'))).toEqual(['top', 'bottom']);
    expect(asSplit(lay('main-side')).tracks).toEqual(['2', '1']);
    expect(asSplit(lay('row auto/1fr/30%/200px { a; b; c; d }')).tracks).toEqual(['auto', '1fr', '30%', '200px']);
    const deep = asSplit(lay('row auto/1/auto { banner; col 3/2 { main; row 1/1 { fig; note } }; bar }'));
    expect(names(asSplit(deep.children[1]).children[1])).toEqual(['fig', 'note']);
    expect(codes('<!-- slide quad 1/2 -->\n## T\n')).toEqual(['layout-tracks']);
    expect(codes('<!-- slide 3col 1/2 -->\n## T\n')).toEqual(['layout-tracks']);
    expect(codes('<!-- slide col 1/1/1 { a; b } -->\n## T\n')).toEqual(['bad-split']);
    expect(codes('<!-- slide col 1/1 { a; a } -->\n## T\n')).toEqual(['duplicate-region']);
    expect(codes('<!-- slide col 1/1 { a; notes } -->\n## T\n')).toEqual(['reserved-region']);
    expect(codes('<!-- slide col 1/huge { a; b } -->\n## T\n')).toEqual(['layout-tracks']);
    expect(codes('<!-- slide template=title 2col -->\n# T\n')).toEqual(['layout-on-template']);
  });

  it('[P.9] leading text fills the first leaf; regions by marker; @notes @footer @float apart; a template slide has body', () => {
    const s = parseDeck('<!-- slide row auto/1 { head; col 1/1 { a; b } } -->\n## T\nheader content\n<!-- @a -->\nA\n<!-- @b -->\nB\n<!-- @footer -->\nfoot\n<!-- @notes -->\nRemember.\n<!-- @float left=58% top=10% w=36% h=44% z=3 -->\n> Key\n').slides[0];
    expect(s.regions.map((r) => [r.name, r.markdown])).toEqual([['head', 'header content'], ['a', 'A'], ['b', 'B']]);
    expect([s.footer, s.notes]).toEqual(['foot', 'Remember.']);
    expect(s.floats.map((f) => [f.geom, f.markdown])).toEqual([[{ left: '58%', top: '10%', w: '36%', h: '44%', z: 3 }, '> Key']]);
    expect(s.lint).toEqual([]);
    const t = parseDeck('<!-- slide template=title -->\n<!-- @body -->\n# Big\n## Sub\n<!-- @notes -->\nhi\n').slides[0];
    expect(t.regions.map((r) => r.name)).toEqual(['body']);
    expect(t.lint).toEqual([]);
  });

  it('[P.10] decided errors (owner decision 6): a duplicate region and a region filled by leading text AND its own marker — nothing is lost', () => {
    const dup = parseDeck('<!-- slide 2col -->\n## T\n<!-- @left -->\none\n<!-- @right -->\nr\n<!-- @left -->\ntwo\n').slides[0];
    expect(dup.lint.map((l) => [l.code, l.level, l.line])).toEqual([['duplicate-region', 'error', 7]]);
    expect(dup.regions.find((r) => r.name === 'left')!.markdown).toBe('one\n\ntwo');
    expect(dup.regions.find((r) => r.name === 'left')!.sources).toHaveLength(2);
    const twice = parseDeck('<!-- slide 2col -->\n## T\nlead text\n<!-- @left -->\nmarked\n').slides[0];
    expect(twice.lint.map((l) => [l.code, l.level])).toEqual([['region-twice', 'error']]);
    expect(twice.regions.find((r) => r.name === 'left')!.markdown).toBe('lead text\n\nmarked');
    expect(codes('<!-- slide 2col -->\n## T\n<!-- @middle -->\nx\n')).toEqual(['unknown-region']);
    expect(codes('<!-- slide template=title -->\n# T\n<!-- @left -->\nx\n')).toEqual(['unknown-region']);
    expect(codes('<!-- slide -->\n## T\n<!-- @notes -->\na\n<!-- @notes -->\nb\n')).toEqual(['duplicate-region']);
    expect(codes('<!-- slide -->\n## T\n<!-- @float left=1% colour=red -->\nx\n')).toEqual(['invalid-option']);
    expect(codes('<!-- slide 2col -->\n## T\n<!-- @left w=3 -->\nx\n')).toEqual(['ignored-attrs']);
    expect(codes('<!-- slide --> ## T\n')).toContain('marker-not-alone');
  });
});

describe('headings (normal slides, 0.x rules)', () => {
  it('[P.11] the leading h2 is the title (inline Markdown kept), lifted out of its region; no-title, h1-on-slide, second-h2; fences and notes do not count', () => {
    const s = parseDeck('<!-- slide -->\n## **Bold** title\n- a\n- b\n').slides[0];
    expect(s.title).toBe('**Bold** title');
    expect(s.regions[0].markdown).toBe('- a\n- b');
    expect(codes('<!-- slide -->\njust text\n')).toEqual(['no-title']);
    expect(parseDeck('<!-- slide -->\n![a picture](p.png)\n').lint.map((l) => l.level)).toEqual(['warning']);
    expect(codes('<!-- slide -->\n# Title\nbody\n')).toEqual(['h1-on-slide']);
    expect(codes('<!-- slide -->\n## First\nbody\n## Second\n')).toEqual(['second-h2']);
    expect(codes('<!-- slide -->\n## Title\nbody\n# Nope\n')).toEqual(['h1-on-slide']);
    expect(codes('<!-- slide -->\n## Real\n```\n## not a heading\n```\n')).toEqual([]);
    expect(codes('<!-- slide -->\n## Real\n<!-- @notes -->\n## a heading in the notes\n')).toEqual([]);
    expect(codes('<!-- slide -->\n<!-- an author comment -->\n## Real\nx\n')).toEqual([]);
    // the first content may sit in the first marked region (0.x)
    const r = parseDeck('<!-- slide 2col -->\n<!-- @left -->\n## In left\nx\n<!-- @right -->\ny\n').slides[0];
    expect(r.title).toBe('In left');
    expect(r.regions.map((x) => [x.name, x.markdown])).toEqual([['left', 'x'], ['right', 'y']]);
    expect(r.lint).toEqual([]);
  });
});

describe('the corpus', () => {
  it('[P.12] every slides corpus text reads without any lint, with its manifest title', () => {
    for (const c of corpus('slides')) {
      const info = readDocument(c.text, { filename: c.path });
      expect(info.lint.map((l) => l.code), c.path).toEqual([]);
      expect(info.title, c.path).toBe(c.derivedTitle);
      expect(info.kind).toBe('slides');
    }
  });
});
