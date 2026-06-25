import { describe, it, expect } from 'vitest';
import { renderLayout } from '../src/layout.js';
import type { LayoutNode } from '../src/types.js';

describe('renderLayout', () => {
  it('renders a single region as an empty placeholder cell', () => {
    const node: LayoutNode = { kind: 'region', name: 'main' };
    const { html, regions } = renderLayout(node);
    expect(html).toBe('<div class="orz-region" data-region="main"></div>');
    expect(regions).toEqual(['main']);
  });

  it('renders a 2-col split with a ratio (number → fr)', () => {
    const node: LayoutNode = {
      kind: 'split',
      dir: 'col',
      tracks: ['2', '1'],
      children: [
        { kind: 'region', name: 'left' },
        { kind: 'region', name: 'right' },
      ],
    };
    const { html, regions } = renderLayout(node);
    expect(html).toBe(
      '<div class="orz-split" style="display:grid;grid-template-columns:2fr 1fr">' +
        '<div class="orz-region" data-region="left"></div>' +
        '<div class="orz-region" data-region="right"></div>' +
        '</div>',
    );
    expect(regions).toEqual(['left', 'right']);
  });

  it('uses grid-template-rows for dir:row', () => {
    const node: LayoutNode = {
      kind: 'split',
      dir: 'row',
      tracks: ['1', '1'],
      children: [
        { kind: 'region', name: 'top' },
        { kind: 'region', name: 'bottom' },
      ],
    };
    const { html } = renderLayout(node);
    expect(html).toContain('grid-template-rows:1fr 1fr');
    expect(html).not.toContain('grid-template-columns');
  });

  it('handles arbitrary nesting (split inside split)', () => {
    const node: LayoutNode = {
      kind: 'split',
      dir: 'row',
      tracks: ['auto', '1'],
      children: [
        { kind: 'region', name: 'head' },
        {
          kind: 'split',
          dir: 'col',
          tracks: ['1', '1'],
          children: [
            { kind: 'region', name: 'a' },
            { kind: 'region', name: 'b' },
          ],
        },
      ],
    };
    const { html, regions } = renderLayout(node);
    expect(html).toBe(
      '<div class="orz-split" style="display:grid;grid-template-rows:auto 1fr">' +
        '<div class="orz-region" data-region="head"></div>' +
        '<div class="orz-split" style="display:grid;grid-template-columns:1fr 1fr">' +
        '<div class="orz-region" data-region="a"></div>' +
        '<div class="orz-region" data-region="b"></div>' +
        '</div>' +
        '</div>',
    );
    // Document order: outer-first, depth-first.
    expect(regions).toEqual(['head', 'a', 'b']);
  });

  it('converts tracks: bare numbers → fr, passes through auto/percent/px/fr', () => {
    const node: LayoutNode = {
      kind: 'split',
      dir: 'col',
      tracks: ['2', 'auto', '30%', '200px', '1fr', '1.5'],
      children: [
        { kind: 'region', name: 'r0' },
        { kind: 'region', name: 'r1' },
        { kind: 'region', name: 'r2' },
        { kind: 'region', name: 'r3' },
        { kind: 'region', name: 'r4' },
        { kind: 'region', name: 'r5' },
      ],
    };
    const { html } = renderLayout(node);
    expect(html).toContain(
      'grid-template-columns:2fr auto 30% 200px 1fr 1.5fr',
    );
  });

  it('does not inline gap', () => {
    const node: LayoutNode = {
      kind: 'split',
      dir: 'col',
      tracks: ['1', '1'],
      children: [
        { kind: 'region', name: 'a' },
        { kind: 'region', name: 'b' },
      ],
    };
    const { html } = renderLayout(node);
    expect(html).not.toContain('gap');
  });

  it('escapes the region name in the attribute defensively', () => {
    const node: LayoutNode = { kind: 'region', name: 'a"><script>' };
    const { html, regions } = renderLayout(node);
    expect(html).toBe(
      '<div class="orz-region" data-region="a&quot;&gt;&lt;script&gt;"></div>',
    );
    // regions list keeps the raw name (it is an identifier, not HTML).
    expect(regions).toEqual(['a"><script>']);
  });
});
