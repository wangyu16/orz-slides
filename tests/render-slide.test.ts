/**
 * Rebuild step 3 — the deck plan and the slide DOM (claims E.2, D.1–D.5):
 * pure modules (src/deck/plan.ts, src/render-slide.ts) in Node.
 */
import { describe, it, expect } from 'vitest';
import { md } from 'orz-markdown';
import { parseDeck } from '../src/deck/parse.js';
import { planDeck, roman, sectionLabel } from '../src/deck/plan.js';
import { renderDeck, renderSlide, type Renderer } from '../src/render-slide.js';

const renderer = md as unknown as Renderer;
const H = (keys = ''): string => `{{nyml\nkind: document\ntitle: The deck\n${keys}}}\n\n`;
const sections = (html: string): string[] => html.match(/<section[\s\S]*?<\/section>/g) ?? [];

const DECK = `${H()}<!-- slide template=title -->
# Title

<!-- slide template=outline -->
## Today
1. First part
2. Second part
3. Third part

<!-- slide template=section -->
# First part

<!-- slide -->
## In part one

<!-- slide template=outline -->
## Again
1. First part
2. Second part
3. Third part

<!-- slide template=section -->
# Second **part**
Its subtitle

<!-- slide template=outline here=3 -->
## Jump
1. a
2. b
3. c

<!-- slide template=outline here=0 -->
## None
1. a
2. b

<!-- slide template=closing -->
# Thanks
`;

describe('[E.2] render-slide: a parsed slide → its reveal <section> in the 1.0 DOM contract', () => {
  it('renders a normal two-column slide: title band and regions are fit boxes, the slots are inside the slide', () => {
    const deck = parseDeck('<!-- slide 2col 3/2 -->\n## Results\n<!-- @left -->\n- a\n- b\n<!-- @right -->\nright text\n');
    const html = renderSlide(deck.slides[0], planDeck(deck)[0], renderer, deck.config);
    expect(html).toMatch(/^<section class="orz-slide" data-kind="normal" data-fit="fit" data-n="1" data-sec="" style="--progress:1\.0000">/);
    expect(html).toContain('<div class="orz-head"><span class="orz-head-deck"></span><span class="orz-head-sec" data-sec=""></span></div>');
    expect(html).toContain('<header class="orz-title orz-box"><div class="markdown-body"><h2>Results</h2></div></header>');
    expect(html).toMatch(/<div class="orz-region orz-box" data-region="left"><div class="markdown-body"><ul>/);
    expect(html).toMatch(/<div class="orz-region orz-box" data-region="right"><div class="markdown-body"><p>right text/);
    expect(html).toContain('<div class="orz-chrome"><span class="orz-chrome-sec" data-sec=""></span><span class="orz-chrome-num"><b>1</b><i>/</i><span>1</span></span><span class="orz-chrome-bar" aria-hidden="true"></span></div>');
  });

  it('places the footer in the bottom slot, floats as fit boxes, and the speaker notes', () => {
    const deck = parseDeck('<!-- slide -->\n## Frame\nbody text\n<!-- @footer -->\nConfidential\n<!-- @float left=60% top=10% w=30% h=40% -->\n**badge**\n<!-- @notes -->\nsay this\n');
    const html = renderSlide(deck.slides[0], planDeck(deck)[0], renderer, deck.config);
    expect(html).toContain('<div class="orz-chrome"><div class="orz-footer"><div class="markdown-body"><p>Confidential</p>');
    expect(html).toContain('<div class="orz-float orz-box" style="left:60%;top:10%;width:30%;height:40%">');
    expect(html).toContain('<aside class="notes"><p>say this</p>');
  });

  it('renders template slides: a bounded template box; the deck footer is not on the title page', () => {
    const deck = parseDeck(`${H('footer: Deck footer\n')}<!-- slide template=title v=2 -->\n# My Talk\n## Subtitle\n**Dr. Yu Wang**\n\nSecond paragraph\n\n<!-- slide template=closing -->\n# Bye\n`);
    const [title, closing] = sections(renderDeck(deck, renderer));
    expect(title).toContain('data-kind="template" data-template="title" data-v="2"');
    expect(title).toContain('<div class="orz-template orz-template-title orz-v2 orz-box" data-orz-copy>');
    expect(title).toMatch(/<h1 class="orz-title-main">My Talk<\/h1><div class="orz-title-sub">Subtitle<\/div><div class="orz-title-meta markdown-body"><p><strong>Dr. Yu Wang<\/strong><\/p>\n<p>Second paragraph<\/p>/);
    expect(title).not.toContain('orz-footer');
    expect(closing).toContain('<div class="orz-footer"><div class="markdown-body"><p>Deck footer</p>');
  });

  it('a bg option is an image when it names one, else a colour', () => {
    const deck = parseDeck('<!-- slide bg=#10243a -->\n## A\n\n<!-- slide bg=https://example.org/p.jpg -->\n## B\n\n<!-- slide bg=pics/bg.png -->\n## C\n');
    const [a, b, c] = sections(renderDeck(deck, renderer));
    expect(a).toContain('data-background-color="#10243a"');
    expect(b).toContain('data-background-image="https://example.org/p.jpg"');
    expect(c).toContain('data-background-image="pics/bg.png"');
  });
});

describe('the deck plan (src/deck/plan.ts)', () => {
  it('[D.1] numbers every slide n of total, with --progress from 0 (first) to 1 (last)', () => {
    const plans = planDeck(parseDeck(DECK));
    expect(plans.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plans.every((p) => p.total === 9)).toBe(true);
    expect(plans[0].progress).toBe(0);
    expect(plans[8].progress).toBe(1);
    expect(plans[4].progress).toBe(0.5);
    expect(planDeck(parseDeck('<!-- slide -->\n## One\n'))[0].progress).toBe(1);
  });

  it('[D.2] numbers sections automatically; every slide knows its section (none before the first) and its title', () => {
    const plans = planDeck(parseDeck(DECK));
    expect(plans.map((p) => p.section)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2]);
    expect(plans.map((p) => p.sectionLabel)).toEqual(['', '', '01', '01', '01', '02', '02', '02', '02']);
    expect(plans[3].sectionTitle).toBe('First part');
    expect(plans[5].sectionTitle).toBe('Second part');
    expect(plans[0].sectionTitle).toBe('');
  });

  it('[D.3] section numbers follow the header\'s section_numbers (plain, roman, 01, none), else the theme\'s default', () => {
    const label = (keys: string, theme?: 'plain' | 'roman' | '01' | 'none') => planDeck(parseDeck(`${H(keys)}${DECK.slice(H().length)}`), theme)[5].sectionLabel;
    expect(label('')).toBe('02');
    expect(label('', 'roman')).toBe('II');
    expect(label('section_numbers: plain\n', 'roman')).toBe('2');
    expect(label('section_numbers: roman\n')).toBe('II');
    expect(label('section_numbers: 01\n', 'roman')).toBe('02');
    expect(label('section_numbers: none\n')).toBe('');
    expect([1, 4, 9, 14, 40, 90, 400, 1994, 3999].map(roman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMXCIV', 'MMMCMXCIX']);
    expect(sectionLabel(12, '01')).toBe('12');
    expect(sectionLabel(0, 'plain')).toBe('');
  });

  it('[D.4] an outline marks the item of the next section (an outline before section k marks item k); here=N overrides, here=0 marks none', () => {
    const deck = parseDeck(DECK);
    const plans = planDeck(deck);
    expect(plans[1].here).toBe(1);
    expect(plans[4].here).toBe(2);
    expect(plans[6].here).toBe(3);
    expect(plans[7].here).toBe(0);
    const html = sections(renderDeck(deck, renderer));
    const marked = (s: string): string[] => [...s.matchAll(/<li class="orz-here" aria-current="step">([^<]*)/g)].map((m) => m[1]);
    expect(marked(html[1])).toEqual(['First part']);
    expect(marked(html[4])).toEqual(['Second part']);
    expect(marked(html[6])).toEqual(['c']);
    expect(marked(html[7])).toEqual([]);
    expect(html[1]).toContain('<div class="orz-outline markdown-body" data-here="1">');
    // an outline after the last section marks none; a nested list item is never the marked one
    const tail = planDeck(parseDeck('<!-- slide template=section -->\n# S\n\n<!-- slide template=outline -->\n## O\n1. a\n2. b\n'));
    expect(tail[1].here).toBe(0);
    const nested = parseDeck('<!-- slide template=outline here=2 -->\n## O\n1. a\n   - a.1\n   - a.2\n2. b\n');
    expect(marked(sections(renderDeck(nested, renderer))[0])).toEqual(['b']);
  });

  it('[D.5] the header keys decide the bottom slot: slide_numbers: no drops the number, progress: no the bar; section templates carry their number', () => {
    const plain = sections(renderDeck(parseDeck(DECK), renderer));
    expect(plain[3]).toContain('<span class="orz-chrome-num"><b>4</b><i>/</i><span>9</span></span>');
    expect(plain[3]).toContain('<span class="orz-chrome-bar" aria-hidden="true"></span>');
    expect(plain[3]).toContain('<span class="orz-chrome-sec" data-sec="01">First part</span>');
    expect(plain[3]).toContain('<span class="orz-head-deck">The deck</span><span class="orz-head-sec" data-sec="01">First part</span>');
    expect(plain[5]).toContain('<div class="orz-section-main" data-sec="02">Second <strong>part</strong></div>');
    expect(plain[5]).toContain('<div class="orz-section-meta markdown-body"><p>Its subtitle</p>');
    const off = sections(renderDeck(parseDeck(`${H('slide_numbers: no\nprogress: no\nsection_numbers: roman\n')}${DECK.slice(H().length)}`), renderer));
    expect(off[3]).not.toContain('orz-chrome-num');
    expect(off[3]).not.toContain('orz-chrome-bar');
    expect(off[3]).toContain('<span class="orz-chrome-sec" data-sec="I">First part</span>');
    expect(off[5]).toContain('data-sec="II"');
  });
});
