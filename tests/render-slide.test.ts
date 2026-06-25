import { describe, it, expect } from 'vitest';
import { md } from 'orz-markdown';
import { parseDeck } from '../src/slide-parser.js';
import { renderSlide, renderDeck } from '../src/render-slide.js';

const renderer = md as unknown as { render: (s: string) => string; renderInline?: (s: string) => string };

describe('render-slide (assembler)', () => {
  it('renders a normal two-column slide with title band + filled regions', () => {
    const deck = parseDeck([
      '<!-- slide 2col 3/2 -->',
      '## Results',
      '<!-- @left -->',
      '- a',
      '- b',
      '<!-- @right -->',
      'right text',
    ].join('\n'));
    const html = renderSlide(deck.slides[0], renderer, deck.config);

    expect(html).toContain('<section class="orz-slide" data-fit="fit" data-kind="normal">');
    expect(html).toContain('<header class="orz-title">');
    expect(html).toContain('<h2>Results</h2>');
    expect(html).toContain('<div class="orz-content">');
    expect(html).toContain('class="orz-split"');
    // both regions present and filled with markdown-body
    expect(html).toMatch(/data-region="left"><div class="markdown-body"><ul>/);
    expect(html).toMatch(/data-region="right"><div class="markdown-body"><p>right text/);
  });

  it('places footer, float, and speaker notes', () => {
    const deck = parseDeck([
      '<!-- slide -->',
      '## Frame',
      'body text',
      '<!-- @footer -->',
      'Confidential',
      '<!-- @float left=60% top=10% w=30% h=40% -->',
      '**badge**',
      '<!-- @notes -->',
      'say this',
    ].join('\n'));
    const html = renderSlide(deck.slides[0], renderer, deck.config);

    expect(html).toContain('<footer class="orz-footer">');
    expect(html).toContain('Confidential');
    expect(html).toMatch(/<div class="orz-float" style="position:absolute;left:60%;top:10%;width:30%;height:40%">/);
    expect(html).toContain('<aside class="notes">');
    expect(html).toContain('say this');
  });

  it('renders a title template slide', () => {
    const deck = parseDeck([
      '<!-- slide template=title -->',
      '# My Talk',
      '## Subtitle',
      '**Dr. Yu Wang**',
    ].join('\n'));
    const html = renderSlide(deck.slides[0], renderer, deck.config);
    expect(html).toContain('data-kind="template" data-template="title"');
    expect(html).toContain('orz-template-title');
    expect(html).toMatch(/<h1[^>]*>My Talk<\/h1>/);
  });

  it('renders a whole deck of sections', () => {
    const deck = parseDeck([
      '<!-- slide template=title -->',
      '# T',
      '<!-- slide 2col -->',
      '## Two',
      '<!-- @left -->',
      'L',
      '<!-- @right -->',
      'R',
    ].join('\n'));
    const html = renderDeck(deck, renderer);
    expect((html.match(/<section /g) || []).length).toBe(2);
  });
});
