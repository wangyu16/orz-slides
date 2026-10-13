/**
 * Rebuild steps 3–4 — the engine's themes as built (claim T.2): the 14
 * generated stylesheets are current, and the engine carries every stylesheet
 * it needs (inline and cdn files style the same; the shell's head names no
 * theme).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { builtThemes, themeCss } from '../scripts/build-themes.js';
import { THEMES } from '../src/themes.js';
import { buildBrowser } from '../build/bundle.js';
import { assemble } from '../src/lib.js';
import { ENGINE } from './helpers.js';

describe('the engine\'s themes', () => {
  it('[T.2] assets/themes/<id>.css is exactly what scripts/build-themes.ts makes from the installed orz-markdown for each of the 14 themes (derived: source + slide-scale + layer; updated: content + layer); the engine bundle carries reveal\'s core CSS, deck.css and the 14 themes; no assembled file links a theme stylesheet', async () => {
    expect(builtThemes()).toEqual(THEMES.map((t) => t.id));
    expect(builtThemes()).toHaveLength(14);
    for (const id of builtThemes()) expect(readFileSync(`assets/themes/${id}.css`, 'utf8') === themeCss(id), `assets/themes/${id}.css is stale: run npx tsx scripts/build-themes.ts`).toBe(true);
    for (const t of THEMES) {
      const css = readFileSync(`assets/themes/${t.id}.css`, 'utf8');
      if (t.derivedFrom) expect(css, t.id).toContain(`orz-markdown 2.4.0 ${t.derivedFrom}.css`);
      else expect(css, t.id).toContain('===== layers/content.css');
      expect(css, t.id).toContain(`===== layers/${t.id}.css`);
      expect(css, t.id).toMatch(/\.reveal \.orz-outline li\.orz-here/);
      expect(css, t.id).toMatch(/--chart-font-size:/);
    }
    expect(readFileSync('assets/themes/notebook.css', 'utf8')).toContain('@media screen rules, scoped to .reveal .orz-region > .markdown-body');
    const orchard = readFileSync('assets/themes/orchard.css', 'utf8');
    expect(orchard).toContain('orz-markdown 2.4.0 light-neat-3.css');
    expect(orchard).toContain('.reveal .orz-outline li.orz-here');
    expect(orchard).toContain('--chart-1: #5f9e44');
    const b = await buildBrowser();
    for (const marker of ['.reveal .orz-qr-slot', 'Bricolage+Grotesque', '.reveal.overview', 'an updated 0.x theme: no source theme', 'Cinzel', 'EB+Garamond', 'Baloo+2']) expect(b.iife.includes(marker), marker).toBe(true);
    const text = '{{nyml\nkind: document\ntheme: orchard\n}}\n\n<!-- slide -->\n## A\n';
    for (const html of [assemble(text, { engineSource: ENGINE }), assemble(text, { delivery: 'cdn' })]) {
      expect(html).not.toMatch(/id="orz-theme"/);
      expect(html).not.toMatch(/orz-markdown@[^/]+\/themes\//);
    }
  }, 120_000);
});
