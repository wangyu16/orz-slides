import { describe, it, expect } from 'vitest';
import { buildSlidesHtml, buildSlidesHtmlWithDocId } from '../src/lib.js';

const DECK = `<!-- deck
  title: Library Deck
  theme: executive
-->

<!-- slide -->
## Hello
body text`;

/** Replace the config docId (a string value in the embedded config JSON). */
const stripDocId = (html: string) =>
  html.replace(/"docId":"[^"]*"/, '"docId":"__ID__"');

describe('buildSlidesHtml — programmatic library entry', () => {
  it('(a) embeds the carrier source island (#orz-deck)', () => {
    const html = buildSlidesHtml({ markdown: DECK });
    expect(html).toContain('<script type="text/orz-slides" id="orz-deck">');
    // The deck source itself round-trips into the island.
    expect(html).toContain('## Hello');
  });

  it('(b) inlines the engine — no CDN engine <script src>', () => {
    const html = buildSlidesHtml({ markdown: DECK });
    // The engine script is present and marked as the engine asset...
    expect(html).toContain('<script data-orz-asset="engine">');
    // ...and it is NOT a CDN reference (no orz-slides-browser@ pin, no src).
    expect(html).not.toContain('orz-slides-browser@');
    expect(html).not.toMatch(/<script data-orz-asset="engine"[^>]*\bsrc=/);
  });

  it('(c) composition is deterministic — two builds differ ONLY in the docId', () => {
    const a = buildSlidesHtml({ markdown: DECK });
    const b = buildSlidesHtml({ markdown: DECK });
    // The random docIds almost certainly differ...
    // ...but once normalised the full documents are byte-identical, which is the
    // real content of the CLI-inline byte-identity guarantee (the CLI's inline
    // branch calls the same buildSlidesHtmlWithDocId).
    expect(stripDocId(a)).toBe(stripDocId(b));
  });

  it('(c) buildSlidesHtml equals buildSlidesHtmlWithDocId (same shared path)', () => {
    const viaPrimary = buildSlidesHtml({ markdown: DECK });
    const viaExplicit = buildSlidesHtmlWithDocId({ markdown: DECK }, 'fixed-doc-id');
    expect(stripDocId(viaPrimary)).toBe(stripDocId(viaExplicit));
  });

  it('deck config wins over passed options (title, theme)', () => {
    const html = buildSlidesHtmlWithDocId(
      { markdown: DECK, title: 'Ignored', theme: 'paper' },
      'id',
    );
    // Deck `title: Library Deck` wins over opts.title.
    expect(html).toContain('<title>Library Deck</title>');
    // Deck `theme: executive` wins over opts.theme='paper'.
    expect(html).toContain('data-theme="executive"');
  });

  it('falls back to opts and defaults when the deck has no config', () => {
    const bare = `<!-- slide -->\n## A\nx`;
    const withOpts = buildSlidesHtmlWithDocId({ markdown: bare, title: 'My Title', theme: 'neon' }, 'id');
    expect(withOpts).toContain('<title>My Title</title>');
    expect(withOpts).toContain('data-theme="neon"');

    const bareDefaults = buildSlidesHtmlWithDocId({ markdown: bare }, 'id');
    // title fallback = 'Untitled', theme fallback = 'paper'.
    expect(bareDefaults).toContain('<title>Untitled</title>');
    expect(bareDefaults).toContain('data-theme="paper"');
  });

  it('an unknown theme falls back to the first shipped theme (paper)', () => {
    const bare = `<!-- slide -->\n## A\nx`;
    const html = buildSlidesHtmlWithDocId({ markdown: bare, theme: 'no-such-theme' }, 'id');
    expect(html).toContain('data-theme="paper"');
  });
});
