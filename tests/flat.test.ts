/**
 * The flattened preview of editing mode (a), whole deck (rebuild step 5;
 * claims W.2, W.3): src/browser/slides/flat.ts in Node — an ordinary flow
 * with a divider per slide, region labels, notes and footers apart, every
 * block anchored on its line of the whole text.
 */
import { describe, it, expect } from 'vitest';
import { renderFlat } from '../src/browser/slides/flat.js';
import { caretOf, slideIndexAt } from '../src/browser/slides/editor.js';
import { parseDeck } from '../src/deck/parse.js';
import { corpus, HAZARDS } from './helpers.js';

const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;
const lineOfText = (text: string, needle: string): number => text.slice(0, text.indexOf(needle)).split(/\r\n|\r|\n/).length - 1;

describe('[W.2] the flattened preview: one flow, a divider per slide, regions labelled, notes apart', () => {
  it('every slides corpus deck: one divider per slide (its manifest slideCount; markers in code are no dividers), numbered in order, each at its marker\'s line', async () => {
    for (const c of corpus('slides')) {
      const html = await renderFlat(c.text);
      expect(count(html, /class="orz-flat-slide"/g), c.path).toBe(c.slideCount);
      const deck = parseDeck(c.text);
      for (const s of deck.slides) {
        expect(html, `${c.path} slide ${s.index + 1}`).toContain(`<div class="orz-flat-slide" data-slide="${s.index}" data-src-line="${s.marker.line - 1}"`);
        expect(html).toContain(`<span class="orz-flat-n">${s.index + 1}</span>`);
      }
    }
  });

  it('a divider says the slide\'s title (plain text), its layout and options as written, or its template; the leading region and every marked region get a label; floats show their geometry', async () => {
    const t = '{{nyml\nkind: document\ntitle: T\n}}\n\n<!-- slide template=title v=2 -->\n# The *deck*\n\n<!-- slide 2col 3/2 step -->\n## Two **columns**\nleading text\n<!-- @right -->\nright text\n<!-- @float left=10% top=20% w=30% -->\nfloating\n\n<!-- slide -->\nno title here\n';
    const html = await renderFlat(t);
    expect(html).toContain('<span class="orz-flat-t">The deck</span><span class="orz-flat-meta">title page v2</span>');
    expect(html).toContain('<span class="orz-flat-t">Two columns</span><span class="orz-flat-meta">2col 3/2 step</span>');
    expect(html).toContain('<span class="orz-flat-t"><i>untitled</i></span>');
    // the leading text's region (the first leaf, `left`) is labelled after the title; `right` at its marker
    const left = html.indexOf('data-region="left"');
    expect(left).toBeGreaterThan(html.indexOf('<h2'));
    expect(left).toBeLessThan(html.indexOf('leading text'));
    expect(html).toContain(`<div class="orz-flat-region" data-src-line="${lineOfText(t, '<!-- @right')}" data-region="right">`);
    expect(html).toContain('float · left=10% top=20% w=30%');
    // a one-box slide gets no region label
    expect(count(html, /class="orz-flat-region[ "]/g)).toBe(3);
  });

  it('speaker notes are an aside and a slide\'s footer a box of their own, each labelled; text before the first slide and a 0.x deck block are said; the markers render nothing else', async () => {
    const t = 'before the deck\n\n<!-- deck\ntheme: neon\n-->\n\n<!-- slide -->\n## One\nbody\n<!-- @footer -->\nmy footer\n<!-- @notes -->\nsay this\n\n<!-- slide -->\n## Two\n';
    const html = await renderFlat(t);
    expect(html).toMatch(/<div class="orz-flat-preamble" data-src-line="0"><span class="orz-flat-label">Before the first slide \(not shown\)<\/span>\n<p data-src-line="0">before the deck<\/p>\n/);
    expect(html).toContain('0.x deck block: renders nothing (run upgrade)');
    expect(html).toMatch(/<div class="orz-flat-footer" data-src-line="\d+"><span class="orz-flat-label">Footer<\/span>\n<p data-src-line="\d+">my footer<\/p>\n<\/div>/);
    expect(html).toMatch(/<aside class="orz-flat-notes" data-src-line="\d+"><span class="orz-flat-label">Speaker notes<\/span>\n<p data-src-line="\d+">say this<\/p>\n<\/aside>\n<div class="orz-flat-slide" data-slide="1"/);
    expect(html).not.toContain('<!--');
  });

  it('a marker the grammar does not read (inside an HTML block, a fence) is no divider — it stays the comment it is', async () => {
    const t = '<!-- slide -->\n## One\n<div>\n<!-- slide -->\n</div>\n\n```\n<!-- slide -->\n```\n';
    const html = await renderFlat(t);
    expect(count(html, /class="orz-flat-slide"/g)).toBe(1);
  });
});

describe('[W.3] the flattened preview anchors every block on its line of the whole text (the kit\'s scroll sync)', () => {
  it('blocks, dividers and labels carry data-src-line = their 0-based line, header lines counted, for LF, CR LF and CR texts', async () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const t = ['{{nyml', 'kind: document', 'title: Lines', '}}', '', '<!-- slide 2col -->', '## Title', '', 'para', '<!-- @right -->', '- item', '', '<!-- slide -->', '## Two', '```', 'code', '```', ''].join(eol);
      const html = await renderFlat(t);
      expect(html).toContain('data-slide="0" data-src-line="5"');
      expect(html).toContain('<h2 id="title" tabindex="-1" data-src-line="6">');
      expect(html).toContain('<p data-src-line="8">para</p>');
      expect(html).toContain('<div class="orz-flat-region" data-src-line="9" data-region="right">');
      expect(html).toContain('<ul data-src-line="10">');
      expect(html).toContain('data-slide="1" data-src-line="12"');
      expect(html).toMatch(/<pre><code[^>]*data-src-line="14"|<pre data-src-line="14"/);
    }
  });

  it('the hazard texts render (no throw), and a BOM text anchors as written', async () => {
    for (const [name, t] of Object.entries(HAZARDS)) await expect(renderFlat(t), name).resolves.toBeTypeOf('string');
    expect(await renderFlat(HAZARDS.bom)).toContain('data-slide="0" data-src-line="0"');
  });

  it('the caret\'s slide: slideIndexAt finds the slide that holds an offset (the first for text before it), caretOf puts the caret at its title (else after its marker)', () => {
    const t = 'pre\n\n<!-- slide -->\n## A\n\n<!-- slide -->\nno title\n';
    const d = parseDeck(t);
    expect(slideIndexAt(d, 0)).toBe(0);
    expect(slideIndexAt(d, t.indexOf('## A'))).toBe(0);
    expect(slideIndexAt(d, t.indexOf('no title'))).toBe(1);
    expect(slideIndexAt(d, t.length)).toBe(1);
    expect(slideIndexAt(parseDeck('just text'), 3)).toBe(-1);
    expect(caretOf(d.slides[0])).toBe(t.indexOf('## A'));
    expect(caretOf(d.slides[1])).toBe(t.indexOf('<!-- slide -->', 10) + '<!-- slide -->'.length);
  });
});
