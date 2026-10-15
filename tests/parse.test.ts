/**
 * Rebuild step 2 — `parseDeck` on text format 1 (claims P.1–P.12): markers
 * by the token scanner, the header as the deck config, the `deck-block`
 * lint, options, regions, floats, headings, positions. The 0.x parser's
 * cases are kept where their meaning is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { deckTokens, parseDeck, readMarkerArgs, scanMarkers } from '../src/deck/parse.js';
import * as parseModule from '../src/deck/parse.js';
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

/*
 * Closed-loop round A (notes/closed-loop.md): the format findings, each a
 * probe that failed on rebuild/1.0@817de2e before its fix.
 */
describe('marker hygiene (round A: FMT-1, FMT-5, FMT-6, FMT-9)', () => {
  it('[P.13] FMT-1: a marker line inside a raw HTML block is not read (FC-18 §7.2 keeps that rule) but is the error marker-in-html with the blank line as its quick fix', () => {
    const text = '<!-- slide -->\n## Results\n<img src="a.png" width="40">\n<!-- @notes -->\nPRIVATE\n<!-- slide -->\n<div class="note">Image credit</div>\n<!-- slide -->\n## Second\n';
    const d = parseDeck(text);
    expect(d.slides).toHaveLength(1); // the split rule is unchanged: the <img> line's HTML block runs to the end
    const hits = d.lint.filter((l) => l.code === 'marker-in-html');
    expect(hits.map((l) => [l.level, l.line])).toEqual([['error', 4], ['error', 6], ['error', 8]]);
    for (const l of hits) expect(l.message).toMatch(/add a blank line before it/);
    // the first marker line's blank line is THE fix: the later ones follow from it (round A3, A3-FMT-3: fixes commute)
    expect(hits[0].fix).toMatchObject({ insert: '\n', from: hits[0].from, to: hits[0].from });
    expect(hits.slice(1).map((l) => l.fix)).toEqual([undefined, undefined]);
    // applying the quick fixes, one at a time, gives the deck the author meant
    let fixed = text;
    for (let k = 0; k < 5; k++) {
      const l = parseDeck(fixed).lint.find((x) => x.fix);
      if (!l) break;
      fixed = fixed.slice(0, l.fix!.from) + l.fix!.insert + fixed.slice(l.fix!.to);
    }
    const f = parseDeck(fixed);
    expect(f.slides).toHaveLength(3);
    expect(f.slides[0].notes).toBe('PRIVATE');
    expect(f.lint.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('[P.13] FMT-5: a fence or ::: container never closed swallows the markers after it — unclosed-fence / unclosed-container, with a fix that closes it before the next marker; a closed one that shows markers is fine', () => {
    const slides = Array.from({ length: 19 }, (_, i) => `<!-- slide -->\n## S${i + 2}\n`).join('\n');
    const text = `<!-- slide -->\n## S1\n\n\`\`\`python\nx = 1\n\`\`\n\n${slides}`;
    const d = parseDeck(text);
    expect(d.slides).toHaveLength(1);
    const l = d.lint.find((x) => x.code === 'unclosed-fence')!;
    expect(l).toMatchObject({ level: 'error', line: 4 });
    expect(l.message).toMatch(/never closed.*19 marker lines/);
    const fixed = text.slice(0, l.fix!.from) + l.fix!.insert + text.slice(l.fix!.to);
    expect(parseDeck(fixed).slides).toHaveLength(20);
    expect(codes('<!-- slide -->\n## A\n::: info\nhello\n<!-- slide -->\n## B\n')).toContain('unclosed-container');
    expect(codes('<!-- slide -->\n## A\n~~~markdown\n<!-- slide -->\n~~~\n')).toEqual([]);
    expect(codes('<!-- slide -->\n## A\n```\nno markers, just open\n')).toEqual([]);
  });

  it('[P.13] FMT-6: punctuation 0.x read after a region name (@notes:, @notes., @right,) is the marker, noticed — the notes never show on the slide', () => {
    for (const p of [':', '.', ',']) {
      const d = parseDeck(`<!-- slide 2col -->\n## T\nL\n<!-- @right${p} -->\nR\n<!-- @notes${p} -->\nSecret\n`);
      expect(d.slides[0].notes, p).toBe('Secret');
      expect(d.slides[0].regions.map((r) => [r.name, r.markdown]), p).toEqual([['left', 'L'], ['right', 'R']]);
      expect(d.lint.map((l) => [l.level, l.code]), p).toEqual([['warning', 'marker-punctuation'], ['warning', 'marker-punctuation']]);
    }
  });

  it('[P.13] FMT-9: a comment that reads like a marker (<!-- notes -->, <!-- @ notes -->, <!-- speaker notes -->) is the warning marker-lookalike; an author comment is not', () => {
    for (const c of ['<!-- notes -->', '<!-- @ notes -->', '<!-- speaker notes -->', '<!-- Notes: -->', '<!-- footer -->']) {
      const d = parseDeck(`<!-- slide -->\n## T\n${c}\nSecret note\n`);
      expect(d.lint.map((l) => [l.level, l.code]), c).toEqual([['warning', 'marker-lookalike']]);
      expect(d.lint[0].message, c).toMatch(/write <!-- @(notes|footer) -->/);
    }
    expect(codes('<!-- slide -->\n## T\n<!-- TODO: add a figure -->\ntext\n')).toEqual([]);
    expect(codes('<!-- slide -->\n## T\n<!-- see the notes below for the derivation -->\ntext\n')).toEqual([]);
  });

  it('[P.12] no hygiene lint fires on the corpus (markers-in-code shows markers in closed fences, indented code and directives on purpose)', () => {
    for (const c of corpus('slides')) expect(parseDeck(c.text).lint.filter((l) => /marker-|unclosed-/.test(l.code)), c.path).toEqual([]);
  });
});

describe('round A: the smaller format findings (FMT-6, FMT-10, FMT-12)', () => {
  it('[P.9] FMT-6: float lengths take every CSS length unit 0.x wrote (in, pt, pc, cm, mm, ch, ex, vmin, vmax), any case', () => {
    const d = parseDeck('<!-- slide -->\n## T\n<!-- @float top=2in w=40vmin h=12pt left=1.5CM -->\nF\n');
    expect(d.slides[0].floats[0].geom).toEqual({ top: '2in', w: '40vmin', h: '12pt', left: '1.5CM' });
    expect(d.lint).toEqual([]);
  });

  it('[P.10] FMT-10: an author comment between the title and the first region marker is not leading text (no region-twice)', () => {
    const d = parseDeck('<!-- slide 2col -->\n## Compare\n<!-- TODO: add a figure -->\n<!-- @left -->\nL\n<!-- @right -->\nR\n');
    expect(d.lint).toEqual([]);
    expect(d.slides[0].regions.map((r) => [r.name, r.markdown])).toEqual([['left', 'L'], ['right', 'R']]);
  });

  it('[P.4] FMT-12: a comment that only starts with "deck" (<!-- deck-notes: draft -->) is no deck block', () => {
    expect(codes('<!-- deck-notes: draft -->\n<!-- slide -->\n## A\n')).toEqual(['text-before-first-slide']);
    expect(codes('<!-- deck\ntheme: neon\n-->\n<!-- slide -->\n## A\n')).toEqual(['deck-block']);
    expect(codes('<!-- deck-->\n<!-- slide -->\n## A\n')).toEqual(['deck-block']);
    expect(readDocument('<!-- deck-notes: draft -->\n<!-- slide -->\n## A\n').lint.map((l) => l.code)).toEqual(['text-before-first-slide']);
  });
});

describe('parse cost (round A: FMT-8)', () => {
  const deck = (n: number, salt: string): string => {
    let s = '';
    for (let i = 0; i < n; i++) s += `<!-- slide 2col -->\n## S${i}\n\n- a\n- b\n<!-- @right -->\nR $x^2$\n<!-- @notes -->\nN\n\n`;
    return `${s}<!-- ${salt} -->\n`;
  };
  const time = (n: number, k: number): number => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = deck(n, `${k}-${i}`);
      const tokens = deckTokens(t);
      const a = performance.now();
      parseDeck(t, tokens);
      best = Math.min(best, performance.now() - a);
    }
    return best;
  };

  it('[P.14] parseDeck is linear: 500 slides parse (tokens given) under 50 ms, 2000 slides under 8 × that (quadratic was 14.5 ×: 402 → 5851 ms before round A); the same text parses once (memoised, frozen)', () => {
    time(200, 0); // warm the JIT
    const t500 = time(500, 1);
    const t2000 = time(2000, 2);
    expect(t500).toBeLessThan(50);
    expect(t2000).toBeLessThan(8 * Math.max(t500, 5));
    const t = deck(300, 'memo');
    const a = parseDeck(t);
    expect(parseDeck(t)).toBe(a);
    expect(Object.isFrozen(a.slides[0])).toBe(true);
  });
});

describe('the derived deck (closed-loop round B, OPS-10)', () => {
  /** mulberry32 */
  const rng = (seed: number): (() => number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const PIECES = ['<!-- slide -->', '<!-- slide 2col -->', '<!-- slide template=title v=2 -->', '<!-- slide quad bg=#eee -->', '<!-- @right -->', '<!-- @notes -->', '<!-- @footer -->', '<!-- @float left=10% top=10% w=20% h=20% -->', '<!-- @left -->', '<!-- @left -->', '## A title', '# An h1', '## A second h2', 'Some text with $x^2$.', '- a\n- b', '```', '```js', ':::', '::: warning', '$$', '<div>', '</div>', '<img src="x.png">', '<pre>', '</pre>', '<!-- notes -->', '<!-- an author comment -->', '<!-- deck\ntheme: neon\n-->', '<!--', '-->', '', '', '', '    indented code', '> quote', '| a | b |\n|---|---|\n| 1 | 2 |', '<!-- slide\n  2col -->', '<!-- slide 2col --> trailing', '<!-- @notes: -->',
    // closed-loop round B2 (B2-OPS-1): the kit's {{name … }} blocks — the one block construct that looks AHEAD for its
    // closer (the next line holding `}}`, past slide markers) — lone `}}` lines and one-line {{qr …}} / inline uses
    '{{mermaid', '{{mermaid\nflowchart LR\nA --> B\n}}', '{{yml\na: 1', '{{chart\ntype: bar\ndata: [1, 2]\n}}', '}}', '}}', '{{qr https://x.org}}', 'see {{qr x}} inline', '{{youtube abc}}', '{{smiles CCO}} is ethanol'];
  const deckText = (r: () => number, eol: string): string => {
    const lines: string[] = [];
    if (r() < 0.75) lines.push('{{nyml', 'kind: document', 'carrier: slides', 'title: Derive', '}}', '');
    if (r() < 0.1) lines.push('text before the first slide', '');
    const n = 2 + Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      lines.push(pick(r, ['<!-- slide -->', '<!-- slide 2col -->', '<!-- slide template=section -->', '<!-- slide main-side fit=off -->']));
      const k = Math.floor(r() * 7);
      for (let j = 0; j < k; j++) lines.push(...pick(r, PIECES).split('\n'));
      if (r() < 0.7) lines.push('');
    }
    return lines.join(eol) + (r() < 0.8 ? eol : '');
  };
  /** A random edit: an insert, a delete or a replace of a few characters or of whole pieces, anywhere. */
  const edit = (r: () => number, t: string, eol: string): string => {
    const at = Math.floor(r() * (t.length + 1));
    const kind = r();
    const ins = (): string => (r() < 0.5 ? pick(r, ['x', ' ', eol, '<', '-', '`', '#', '@', '!', '{', '}', '{{', '}}', '{{mermaid']) : `${eol}${pick(r, PIECES).split('\n').join(eol)}${eol}`);
    if (kind < 0.4) return t.slice(0, at) + ins() + t.slice(at);
    if (kind < 0.75) { const n = 1 + Math.floor(r() * (r() < 0.8 ? 4 : 120)); return t.slice(0, at) + t.slice(at + n); }
    const n = 1 + Math.floor(r() * 30);
    return t.slice(0, at) + ins() + t.slice(at + n);
  };

  it('[P.14] PROPERTY (seeded, 3000 random decks × LF / CR LF / CR × random edits anywhere — markers made and broken, constructs opened and closed, slides merged and split, the header and the preamble touched): the deck parseDeck derives from the last text is exactly the deck a fresh parse gives', () => {
    const fresh = (parseModule as unknown as { parseDeckFresh: (t: string) => unknown }).parseDeckFresh;
    const r = rng(0xde41e);
    let compared = 0;
    const stats = (parseModule as unknown as { PARSE_STATS: { derived: number; parsed: number } }).PARSE_STATS;
    const d0 = stats.derived;
    for (let c = 0; c < 3000; c++) {
      const eol = pick(r, ['\n', '\n', '\r\n', '\r']);
      let t = deckText(r, eol);
      parseDeck(t);
      for (let e = 0; e < 3; e++) {
        const n = edit(r, t, eol);
        const got = JSON.stringify(parseDeck(n));
        const want = JSON.stringify(fresh(n));
        if (got !== want) throw new Error(`case ${c}.${e}: derived ≠ fresh\n${JSON.stringify(t)}\n=====\n${JSON.stringify(n)}\n--- derived\n${got}\n--- fresh\n${want}`);
        compared++;
        t = n;
      }
    }
    expect(compared).toBe(9000);
    // most edits are derived (the rest reach the header or the text before the first slide, or name a line number): the derivation itself is what is checked
    expect(stats.derived - d0).toBeGreaterThan(5000);
  });

  it('[P.14] B2-OPS-1: a {{name block opened in one slide whose closing }} lies in a later, untouched slide — typed, completed or closed by an edit — derives the deck a fresh parse gives (the kit looks ahead past slide markers for }})', () => {
    const fresh = (parseModule as unknown as { parseDeckFresh: (t: string) => { slides: Array<{ title: string }> } }).parseDeckFresh;
    const H = '{{nyml\nkind: document\ncarrier: slides\n}}\n\n';
    const base = `${H}<!-- slide -->\n## Flow\nIntro text.\n\n<!-- slide 2col -->\n## Compare\nleft\n<!-- @right -->\nright\n\n<!-- slide -->\n## Chart\n{{chart\ntype: bar\ndata: [1, 2]\n}}\n\n<!-- slide -->\n## End\n`;
    const at = base.indexOf('Intro text.') + 'Intro text.'.length;
    const titles = (t: string): string => parseDeck(t).slides.map((s) => s.title).join('|');
    const want = (t: string): string => fresh(t).slides.map((s) => s.title).join('|');
    // typed one character at a time: every step is an edit of the last text (the editor's own path)
    let t = base;
    parseDeck(t);
    for (const step of ['\n', '{', '{', 'm', 'e', 'r', 'm', 'a', 'i', 'd', '\n', 'A', '\n', '}', '}']) {
      const k = t.indexOf('Intro text.') + 'Intro text.'.length + (t.length - base.length);
      t = t.slice(0, k) + step + t.slice(k);
      expect(titles(t), JSON.stringify(t.slice(at, k + 1))).toBe(want(t));
    }
    // the reverse: a lone }} typed in a later slide under an opener left open earlier
    const open = base.slice(0, at) + '\n{{mermaid' + base.slice(at).replace('{{chart\ntype: bar\ndata: [1, 2]\n}}', 'chart text');
    parseDeck(open);
    const closed = open.replace('chart text', 'chart text\n}}');
    expect(titles(closed)).toBe(want(closed));
    expect(want(closed)).toBe('Flow|End');
    // the minimal case the fuzz found
    parseDeck(`${H}<!--slide-->\n<!--slide-->\n}}`);
    expect(parseDeck(`${H}<!--slide-->\n{{yml\n<!--slide-->\n}}`).slides).toHaveLength(fresh(`${H}<!--slide-->\n{{yml\n<!--slide-->\n}}`).slides.length);
  });
});

/*
 * Closed-loop round A2 (notes/closed-loop.md): round A fixed instances of the
 * hygiene lint (a fence or container that runs to the end, a type-6/7 HTML
 * block); A2 found the class — every construct that runs on to a terminator
 * of its own. One mechanism now: each probe below failed on
 * rebuild/1.0@6d3aa97.
 */
describe('marker hygiene, one terminator-aware mechanism (round A2)', () => {
  const H = '{{nyml\nkind: document\ncarrier: slides\n}}\n\n';
  /** Apply the first quick fix of a text. */
  const fixOnce = (t: string): { text: string; code: string; at: number } | null => {
    const l = parseDeck(t).lint.find((x) => x.fix);
    return l ? { text: t.slice(0, l.fix!.from) + l.fix!.insert + t.slice(l.fix!.to), code: l.code, at: l.line! } : null;
  };
  const real = (t: string): number => scanMarkers(t).length;

  /** Every construct that runs on to its own terminator, left open before a slide marker (the A2 matrix). */
  const RUN_ON: Record<string, [string, string, string]> = {
    // name: [opener lines, the lint, the closer the fix inserts]
    'fence ```': ['```python\nx = 1', 'unclosed-fence', '```'],
    'fence ~~~~': ['~~~~\nx', 'unclosed-fence', '~~~~'],
    'fence `````': ['`````md\nx', 'unclosed-fence', '`````'],
    'container :::': ['::: info\nx', 'unclosed-container', ':::'],
    'container ::::': [':::: info\nx', 'unclosed-container', '::::'],
    'container :::::': ['::::: cols\n::: col\nx\n:::', 'unclosed-container', ':::::'],
    'math $$': ['$$\nx^2', 'unclosed-math', '$$'],
    '<pre>': ['<pre>\ncode', 'unclosed-html', '</pre>'],
    '<script>': ['<script>\nlet a = 1', 'unclosed-html', '</script>'],
    '<style>': ['<style>\n.x { color: red }', 'unclosed-html', '</style>'],
    '<textarea>': ['<textarea>\ntext', 'unclosed-html', '</textarea>'],
    'open <!--': ['<!-- TODO rework this', 'unclosed-html', '-->'],
    '<?': ['<?php echo 1;', 'unclosed-html', '?>'],
    '<![CDATA[': ['<![CDATA[ x', 'unclosed-html', ']]>'],
  };

  it('[P.13] A2-FMT-1/3/4: every construct that runs on to its own terminator — a fence of any length and character, a container of any length, $$ math, an HTML block of types 1–5, an open comment — and swallows a slide marker is its unclosed-* error; the fix inserts ITS closer, and applying it removes the lint and shows the slides', () => {
    for (const [name, [open, code, closer]] of Object.entries(RUN_ON)) {
      for (const blank of ['\n', '\n\n']) {
        const t = `${H}<!-- slide -->\n## A\n${open}${blank}<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n`;
        const d = parseDeck(t);
        expect(d.slides.length, name).toBe(1);
        const l = d.lint.find((x) => x.code === code)!;
        expect(l, name).toMatchObject({ level: 'error', line: 8 });
        expect(l.fix!.insert, name).toBe(`${closer}\n`);
        const f = fixOnce(t)!;
        const g = parseDeck(f.text);
        expect(g.slides.map((s) => s.title), name).toEqual(['A', 'B']);
        expect(g.slides[1].notes, name).toBe('PRIVATE');
        expect(g.lint.filter((x) => x.level === 'error'), name).toEqual([]);
      }
    }
  });

  it('[P.13] A2-FMT-1: an HTML block of types 1–5 closed on purpose may show markers — no false error (a closed <pre> was marker-in-html, its fix did nothing)', () => {
    for (const t of ['<pre>\n<!-- slide -->\n<!-- @notes -->\n</pre>', '<textarea>\n<!-- slide -->\n</textarea>', '<script type="text/plain">\n<!-- slide -->\n</script>']) {
      expect(codes(`${H}<!-- slide -->\n## Writing markers\n${t}\n\n<!-- slide -->\n## Two\n`), t).toEqual([]);
    }
  });

  it('[P.13] A2-FMT-2: a block closed only by a LATER slide\'s block of its kind (```js in a ``` fence, ::: warning in a ::: container, a second <pre>) is unclosed-*, and its fix gives every slide back; a ```` fence holding ``` (the corpus nesting) is fine', () => {
    const cases: Array<[string, string, string]> = [
      ['```python\nprint(1)', '```js\nlet x = 1\n```', 'unclosed-fence'],
      ['::: info\nhello', '::: warning\nw\n:::', 'unclosed-container'],
      ['<pre>\nx', '<pre>y</pre>', 'unclosed-html'],
    ];
    for (const [open, later, code] of cases) {
      const t = `${H}<!-- slide -->\n## A\n${open}\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n${later}\n\n<!-- slide -->\n## D\ntext\n`;
      const d = parseDeck(t);
      expect(d.slides.length, code).toBe(2);
      expect(d.lint.map((l) => [l.code, l.level, l.line]), code).toContainEqual([code, 'error', 8]);
      const f = parseDeck(fixOnce(t)!.text);
      expect(f.slides.map((s) => s.title), code).toEqual(['A', 'B', 'C', 'D']);
      expect(f.slides[1].notes, code).toBe('PRIVATE');
      expect(f.lint.filter((l) => l.level === 'error'), code).toEqual([]);
    }
    expect(codes(`${H}<!-- slide -->\n## Nested\n\`\`\`\`markdown\n\`\`\`html\n<!-- slide quad -->\n\`\`\`\n<!-- slide -->\n\`\`\`\`\n\n<!-- slide -->\n## B\n`)).toEqual([]);
  });

  it('[P.13] A2-FMT-2: two bare fences left open pair up across a slide (each slide\'s ``` closes the one before) — a warning, with the same fix; an info string shows markers on purpose', () => {
    let t = H;
    for (let i = 1; i <= 6; i++) t += `<!-- slide -->\n## S${i}\n\`\`\`\ncode ${i}\n\n`;
    expect(parseDeck(t).slides).toHaveLength(3);
    expect(parseDeck(t).lint.map((l) => [l.code, l.level])).toEqual([['unclosed-fence', 'warning'], ['unclosed-fence', 'warning'], ['unclosed-fence', 'warning']]);
    let cur = t;
    for (let k = 0; k < 10; k++) { const f = fixOnce(cur); if (!f) break; cur = f.text; }
    expect(parseDeck(cur).slides.map((s) => s.title)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(parseDeck(cur).lint).toEqual([]);
  });

  it('[P.13] B2-OPS-2: a kit {{name block left open looks ahead to the next line holding }} — another {{name block after a slide marker, a one-line {{qr …}} or an inline use — and swallows the slides between: unclosed-plugin (error), the fix closes it with }} before the first marker, every slide back; a lone }} later closes a drawn block by mistake (a {{yaml may show markers); a closed block, or one left open with no }} after it (literal text), is fine', () => {
    const tail = (later: string): string => `${H}<!-- slide -->\n## A\n{{mermaid\nflowchart LR\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n${later}\n\n<!-- slide -->\n## D\ntext\n`;
    for (const later of ['{{chart\ntype: bar\ndata: [1, 2]\n}}', '{{qr https://example.org}}', 'see {{qr x}} inline', '{{smiles CCO}} is ethanol']) {
      const t = tail(later);
      const d = parseDeck(t);
      expect(d.slides.length, later).toBeLessThan(4);
      const l = d.lint.find((x) => x.code === 'unclosed-plugin')!;
      expect(l, later).toMatchObject({ level: 'error', line: 8 });
      expect(l.message, later).toMatch(/\{\{mermaid block opened on line 8/);
      expect(l.fix!.insert, later).toBe('}}\n');
      const f = parseDeck(fixOnce(t)!.text);
      expect(f.slides.map((s) => s.title), later).toEqual(['A', 'B', 'C', 'D']);
      expect(f.slides[1].notes, later).toBe('PRIVATE');
      expect(f.lint.filter((x) => x.level === 'error'), later).toEqual([]);
      // the ops refuse a slide the block swallowed into (a blocking error)
    }
    // closed later by a lone }}: a drawn block (a diagram) cannot show a marker, so it was closed by mistake …
    const lone = tail('chart text\n}}');
    expect(parseDeck(lone).lint.map((l) => [l.code, l.level])).toContainEqual(['unclosed-plugin', 'error']);
    expect(parseDeck(fixOnce(lone)!.text).slides.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
    // … a text block ({{yaml) may show markers on purpose (corpus markers-in-code)
    expect(codes(lone.replace('{{mermaid', '{{yaml'))).toEqual([]);
    // no }} after it: the kit reads it as text, no slide is lost, no lint
    expect(codes(`${H}<!-- slide -->\n## A\n{{mermaid\nx\n\n<!-- slide -->\n## B\n`)).toEqual([]);
    // closed in its slide: fine
    expect(codes(`${H}<!-- slide -->\n## A\n{{mermaid\nflowchart LR\n}}\n\n<!-- slide -->\n## B\n{{qr x}}\n`)).toEqual([]);
    // CR LF and CR keep their line ending
    for (const eol of ['\r\n', '\r']) {
      const t = tail('{{qr x}}').replace(/\n/g, eol);
      const fx = fixOnce(t)!;
      expect(fx.code).toBe('unclosed-plugin');
      expect(/[\r\n]/.test(fx.text.split(eol).join('')), JSON.stringify(eol)).toBe(false);
    }
  });

  it('[P.13] A2-FMT-4: a $$ block or a container closed AFTER a slide marker is closed by mistake (a marker line is never shown there)', () => {
    expect(codes(`${H}<!-- slide -->\n## A\n$$\nx\n<!-- slide -->\n## B\n$$\n`)).toContain('unclosed-math');
    expect(codes(`${H}<!-- slide -->\n## A\n::: info\nx\n<!-- slide -->\n## B\n:::\n`)).toContain('unclosed-container');
  });

  it('[P.13] A2-FMT-9 and the fix property: over every construct × LF / CR LF / CR, each quick fix keeps the text\'s line ending, removes its own lint and makes at least one more marker line a marker', () => {
    const blocks = [...Object.values(RUN_ON).map(([open]) => open), '<img src="x.png">', '<div class="x">'];
    for (const open of blocks) {
      for (const eol of ['\n', '\r\n', '\r']) {
        const t = `${H}<!-- slide -->\n## A\n${open}\n<!-- slide -->\n## B\n<!-- @notes -->\nN\n`.replace(/\n/g, eol);
        const d = parseDeck(t);
        const l = d.lint.find((x) => x.fix)!;
        expect(l, `${open} ${JSON.stringify(eol)}`).toBeDefined();
        const f = fixOnce(t)!;
        const others = f.text.replace(new RegExp(eol === '\r' ? '\r' : eol, 'g'), '');
        expect(/[\r\n]/.test(others), `${open} ${JSON.stringify(eol)}: mixed line endings`).toBe(false);
        expect(parseDeck(f.text).lint.some((x) => x.code === l.code && x.line === l.line), `${open}: the lint stays`).toBe(false);
        expect(real(f.text), open).toBeGreaterThan(real(t));
      }
    }
  });

  it('[P.13] A2-FMT-6: anything 0.x read after a region name (@notes:private, @notes(speaker), @notes!) is the marker, noticed — private notes never show on the slide; <!-- Slide --> is a lookalike', () => {
    for (const m of ['@notes:private', '@notes(speaker)', '@notes!', '@notes:']) {
      const d = parseDeck(`${H}<!-- slide -->\n## T\n<!-- ${m} -->\nsecret\n`);
      expect(d.slides[0].notes, m).toBe('secret');
      expect(d.slides[0].regions.map((r) => r.markdown).join(''), m).not.toMatch(/secret/);
      expect(d.lint.map((l) => [l.level, l.code]), m).toEqual([['warning', 'marker-punctuation']]);
    }
    for (const c of ['<!-- Slide -->', '<!-- SLIDE 2col -->']) {
      const d = parseDeck(`${H}<!-- slide -->\n## T\n\n${c}\n## U\n`);
      expect(d.lint.find((l) => l.code === 'marker-lookalike')?.message, c).toMatch(/write <!-- slide/);
    }
  });
});

/*
 * Closed-loop round A3 (notes/closed-loop.md) — the format area's FINAL
 * pass (owner's stop rule: its findings are rare combinations or LOW).
 * Each probe failed on rebuild/1.0@a9f4ab3.
 */
describe('marker hygiene, round A3 (final pass)', () => {
  const H = '{{nyml\nkind: document\ncarrier: slides\n}}\n\n';
  const fixOnce = (t: string): string | null => {
    const l = parseDeck(t).lint.find((x) => x.fix);
    return l ? t.slice(0, l.fix!.from) + l.fix!.insert + t.slice(l.fix!.to) : null;
  };
  const sig = (t: string): string => parseDeck(t).slides.map((s) => `${s.title}|${s.notes ?? ''}|${s.regions.map((r) => `${r.name}:${r.markdown}`).join(';')}`).join('§');

  it('[P.13] A3-FMT-1: a CLOSED container whose fenced example shows a marker is no error (the kit\'s container map leaves its closer out; markers inside a nested fence are not the container\'s) — and one left open still is', () => {
    const ok = [
      '::: tip\nWrite the marker on its own line:\n\n```markdown\n<!-- slide -->\n## My title\n```\n:::',
      '::: info\n```markdown\n<!-- @notes -->\nSay hello.\n```\n:::',
      ':::: cols\n::: col\n```markdown\n<!-- @notes -->\nSay hello.\n```\n:::\n::: col\nb\n:::\n::::',
      '::: tip\n~~~\n<!-- slide -->\n~~~\n:::',
    ];
    for (const c of ok) {
      const t = `${H}<!-- slide -->\n## How to start a slide\n\n${c}\n\n<!-- slide -->\n## Next\n`;
      expect(readDocument(t).lint.map((l) => `${l.code}@${l.line}`), c).toEqual([]);
      expect(parseDeck(t).slides.map((s) => s.title), c).toEqual(['How to start a slide', 'Next']);
    }
    // a container really left open (its slide marker is a direct child) is still the error, with its fix
    const open = `${H}<!-- slide -->\n## A\n::: tip\n\`\`\`markdown\n<!-- slide -->\n\`\`\`\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n`;
    expect(parseDeck(open).lint.map((l) => [l.code, l.level])).toContainEqual(['unclosed-container', 'error']);
    const fixed = parseDeck(fixOnce(open)!);
    expect(fixed.slides.map((s) => [s.title, s.notes ?? null])).toEqual([['A', null], ['B', 'PRIVATE']]);
    expect(fixed.lint).toEqual([]);
  });

  it('[P.13] A3-FMT-2: a <pre>/<script>/<style> left open and closed by a DIFFERENT raw-text tag on a later slide is unclosed-html; its fix gives every slide back with its notes private', () => {
    const cases: Array<[string, string]> = [
      ['<pre>\nascii art', '<style>\n.c{color:red}\n</style>'],
      ['<script>\nlet a = 1', '<pre>\nx\n</pre>'],
      ['<style>\n.a{}', '<script>\nlet b\n</script>'],
      ['<pre>\nascii art', '<textarea>t</textarea>'],
    ];
    for (const [open, later] of cases) {
      const t = `${H}<!-- slide -->\n## A\n${open}\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n${later}\n`;
      const d = parseDeck(t);
      expect(d.lint.map((l) => [l.code, l.level, l.line]), open).toContainEqual(['unclosed-html', 'error', 8]);
      const f = parseDeck(fixOnce(t)!);
      expect(f.slides.map((s) => [s.title, s.notes ?? null]), open).toEqual([['A', null], ['B', 'PRIVATE'], ['C', null]]);
      expect(f.lint.filter((l) => l.level === 'error'), open).toEqual([]);
    }
    // the same tag closing it on purpose may still show markers (A2-FMT-1)
    expect(codes(`${H}<!-- slide -->\n## W\n<pre>\n<!-- slide -->\n</pre>\n\n<!-- slide -->\n## Two\n`)).toEqual([]);
  });

  it('[P.13] A3-FMT-3: quick fixes commute — a lint that only follows from an earlier block closed by mistake carries no fix of its own, so one forgotten fence or $$ is repaired the same in any order (no empty code or math block left)', () => {
    const fence = `${H}<!-- slide -->\n## A\n\`\`\`\nx = 1\n\n<!-- slide -->\n## S\n\`\`\`\ny = 2\n\`\`\`\n\n<!-- @notes -->\nPRIVATE\n`;
    const math = `${H}<!-- slide -->\n## A\n$$\nx^2\n\n<!-- slide -->\n## S\n$$\ny\n$$\n\n<!-- @notes -->\nPRIVATE\n`;
    for (const t of [fence, math]) {
      const l = parseDeck(t).lint;
      expect(l.filter((x) => x.fix), t).toHaveLength(1);
      const consequence = l.find((x) => !x.fix);
      expect(consequence?.message, t).toMatch(/may follow from line \d+/);
      let cur = t;
      for (let k = 0; k < 5; k++) { const n = fixOnce(cur); if (!n) break; cur = n; }
      expect(parseDeck(cur).lint, t).toEqual([]);
      expect(parseDeck(cur).slides.map((s) => s.notes ?? null), t).toEqual([null, 'PRIVATE']);
      expect(cur, t).not.toMatch(/```\n```|\$\$\n\$\$/);
    }
  });

  it('[P.13] A3-FMT-3 (property): over 600 random decks of every construct × LF / CR LF / CR, applying the quick fixes first-first, last-first and in random order reaches the same deck, each fix removes its own lint, and nothing with a fix is left', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    const frags = ['```\ncode', '```python\nx = 1', '~~~~\nt', '::: info\nhello', ':::: cols\n::: col\nx\n:::', '$$\nx^2', '<pre>\nart', '<style>\nh2{}',
      '<script>\nlet a', '<!-- todo', '<div>\nhtml', '<img src="x.png">', 'plain text', '- list\n  ```\n  c', '> quote', '<textarea>\nt',
      '```js\nlet x = 1\n```', '::: warning\nw\n:::', '<style>\n.c{}\n</style>', '$$\ny\n$$', '<pre>p</pre>', '::: tip\n```md\n<!-- slide -->\n```\n:::'];
    const marks = ['<!-- slide -->\n## S', '<!-- @notes -->\nN', '<!-- slide 2col -->\n## T\n<!-- @left -->\nl\n<!-- @right -->\nr', '<!-- slide\n  bg=#223 -->\n## M'];
    const apply = (t: string, f: NonNullable<ReturnType<typeof parseDeck>['lint'][number]['fix']>): string => t.slice(0, f.from) + f.insert + t.slice(f.to);
    const bad: string[] = [];
    for (let it = 0; it < 600; it++) {
      let body = '<!-- slide -->\n## A\n';
      const k = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < k; i++) body += (rnd() < 0.6 ? `${pick(frags)}\n${rnd() < 0.5 ? '\n' : ''}` : '') + `${pick(marks)}\n${rnd() < 0.3 ? '\n' : ''}`;
      const eol = pick(['\n', '\r\n', '\r']);
      const text = (H + body).replace(/\n/g, eol);
      const run = (order: 'first' | 'last' | 'rand'): string | null => {
        let cur = text;
        for (let s = 0; s < 40; s++) {
          const fs = parseDeck(cur).lint.filter((l) => l.fix);
          if (fs.length === 0) return cur;
          const f = order === 'first' ? fs[0] : order === 'last' ? fs[fs.length - 1] : pick(fs);
          const next = apply(cur, f.fix!);
          if (parseDeck(next).lint.some((l) => l.code === f.code && l.line === f.line && l.fix)) return null;
          cur = next;
        }
        return null;
      };
      const r = [run('first'), run('last'), run('rand')];
      if (r.some((x) => x === null)) bad.push(`${it}: stuck ${JSON.stringify(body)}`);
      else if (new Set(r.map((x) => sig(x!))).size !== 1) bad.push(`${it}: order-dependent ${JSON.stringify(body)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('[P.13] A3-FMT-4: a comment left open (<!-- TODO) that a MULTI-LINE slide marker\'s --> closes is unclosed-html (a comment can never hold a marker line on purpose), with or without a title on the next slide', () => {
    for (const next of ['## B', 'B text']) {
      const t = `${H}<!-- slide -->\n## A\n<!-- TODO rework\n\n<!-- slide\n  bg=#223 -->\n${next}\n<!-- @notes -->\nPRIVATE\n`;
      const d = parseDeck(t);
      expect(d.lint.map((l) => [l.code, l.level, l.line]), next).toContainEqual(['unclosed-html', 'error', 8]);
      const f = parseDeck(fixOnce(t)!);
      expect(f.slides.map((s) => s.notes ?? null), next).toEqual([null, 'PRIVATE']);
      expect(f.slides[1].options.bg, next).toBe('#223');
    }
  });
});
