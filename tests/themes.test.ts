/**
 * Rebuild steps 3–4 — the engine's themes as built (claim T.2): the 14
 * generated stylesheets are current, and the engine carries every stylesheet
 * it needs (inline and cdn files style the same; the shell's head names no
 * theme).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { allContractProblems, builtThemes, contractProblems, themeCss } from '../scripts/build-themes.js';
import { execFileSync } from 'node:child_process';
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

describe('the theme contract (round A)', () => {
  const at = (rev: string, path: string): string => execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  it('[T.13] build-themes checks the contract — every theme sets the variant tokens, six chart colours and the diagram tokens; deck.css draws every template variant and a one-line footer; no layer lets the footer wrap or a box stop clipping — and it would have caught round A\'s TK-1, TK-4 and TK-5 in the round-start themes', () => {
    expect(allContractProblems()).toEqual([]);
    // the round-start themes (rebuild/1.0@817de2e): no variant rules, a footer that wrapped, four-colour palettes
    const old = { deck: at('817de2e', 'assets/themes/deck.css') };
    const arch = contractProblems('architect', { ...old, layer: at('817de2e', 'assets/themes/layers/architect.css'), built: at('817de2e', 'assets/themes/architect.css') });
    expect(arch).toEqual(expect.arrayContaining([
      'architect: the token --sl-accent is not set',
      'architect: the token --chart-5 is not set',
      'architect: the token --chart-6 is not set',
      'deck.css: the title template\'s variant v=4 has no rule',
      'deck.css: the outline template\'s variant v=3 has no rule',
      'deck.css: the footer is not one ellipsized line',
    ]));
    // a layer that lets the footer wrap, or a box stop clipping
    const deck = readFileSync('assets/themes/deck.css', 'utf8');
    const built = readFileSync('assets/themes/orchard.css', 'utf8');
    const bad = contractProblems('orchard', { deck, built, layer: `${readFileSync('assets/themes/layers/orchard.css', 'utf8')}\n.reveal .orz-footer p { white-space: normal; }\n.reveal .orz-region { overflow: visible; }\n` });
    expect(bad).toEqual(['orchard: ".reveal .orz-footer p" lets the footer wrap', 'orchard: ".reveal .orz-region" sets overflow on a box (fit needs clip)']);
  });

  it('[T.13] A2-TH-14: the contract checks VALUES — it rejects a footer wrapped through another selector, an accent ink that does not read, empty or duplicate chart colours, colours a colour-blind reader cannot tell apart, a variant "rule" made of an unrelated selector, and a title band that overflows across (each passed --check at rebuild/1.0@6d3aa97)', () => {
    const deck = readFileSync('assets/themes/deck.css', 'utf8');
    const built = readFileSync('assets/themes/orchard.css', 'utf8');
    const layer = readFileSync('assets/themes/layers/orchard.css', 'utf8');
    const check = (o: { deck?: string; layer?: string; built?: string }): string[] => contractProblems('orchard', { deck: o.deck ?? deck, layer: o.layer ?? layer, built: o.built ?? built });
    expect(check({})).toEqual([]);
    expect(check({ layer: `${layer}\n.reveal .orz-chrome .markdown-body p { white-space: normal; }\n` })).toEqual(['orchard: ".reveal .orz-chrome .markdown-body p" lets the footer wrap']);
    expect(check({ built: `${built}\n.reveal { --sl-accent: #2f8f86; --sl-accent-ink: #2f8f86; }\n` }).join('\n')).toMatch(/--sl-accent-ink on --sl-accent reads 1\.00 : 1/);
    expect(check({ built: `${built}\n.reveal { --chart-5: ; --chart-6: initial; }\n` })).toEqual(expect.arrayContaining(['orchard: --chart-5 is not a colour ("")', 'orchard: --chart-6 is not a colour ("initial")']));
    expect(check({ built: `${built}\n.reveal { --chart-5: #5f9e44; }\n` }).join('\n')).toMatch(/--chart-1 and --chart-5 are too alike/);
    expect(check({ built: `${built}\n.reveal { --chart-4: #7fb6ff; --chart-5: #c59bff; }\n` }).join('\n')).toMatch(/--chart-4 and --chart-5 merge for a deutan reader/);
    const noOutline3 = deck.split('\n').filter((l) => !/data-template="outline"\]\[data-v="3"\]/.test(l)).join('\n') + '\n.reveal [data-template="outline"] .x, .reveal [data-template="title"][data-v="3"] .y { color: red; }\n';
    expect(check({ deck: noOutline3 })).toEqual(['deck.css: the outline template\'s variant v=3 has no rule']);
    expect(check({ layer: `${layer}\n.reveal .orz-title { overflow: visible; }\n` })).toEqual(['orchard: ".reveal .orz-title" lets the title band overflow across (it clips on x)']);
  });
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
