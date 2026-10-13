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

describe('the header settings (Theme, Ratio and the Q3 keys)', () => {
  it('[T.9] the settings offer Theme (the 14), Ratio, Slide numbers, Progress bar and Section numbers, each reading its value from the header; "Theme default" removes section_numbers and names the theme\'s style', async () => {
    const { SLIDES_SETTINGS } = await import('../src/browser/slides/settings.js');
    const by = (k: string) => SLIDES_SETTINGS.find((s) => s.key === k)!;
    expect(SLIDES_SETTINGS.map((s) => s.key)).toEqual(['theme', 'ratio', 'slide_numbers', 'progress', 'section_numbers']);
    expect(by('theme').choices.map((c) => c.value)).toEqual(THEMES.map((t) => t.id));
    const plain = '{{nyml\nkind: document\ntheme: paper\n}}\n\n<!-- slide -->\n## A\n';
    const set = '{{nyml\nkind: document\ntheme: sky\nslide_numbers: no\nprogress: no\nsection_numbers: roman\n}}\n\n<!-- slide -->\n## A\n';
    expect(SLIDES_SETTINGS.map((s) => s.current(plain))).toEqual(['paper', '16:9', 'yes', 'yes', 'theme']);
    expect(SLIDES_SETTINGS.map((s) => s.current(set))).toEqual(['sky', '16:9', 'no', 'no', 'roman']);
    const sec = by('section_numbers');
    expect(sec.choicesFor!(plain)[0]).toEqual({ value: 'theme', label: 'Theme default (I, II, III)' });
    expect(sec.choicesFor!(set)[0].label).toBe('Theme default (01, 02, 03)');
    expect(sec.apply!(set, 'theme')).toEqual({ section_numbers: null });
    expect(sec.apply!(plain, '01')).toEqual({ section_numbers: '01' });
  });
});
