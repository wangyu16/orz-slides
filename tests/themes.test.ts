/**
 * Rebuild step 3 — the engine's themes as built (claim T.2): the generated
 * stylesheet is current, and the engine carries every stylesheet it needs
 * (inline and cdn files style the same; the shell's head names no theme).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { builtThemes, derivedTheme } from '../scripts/build-themes.js';
import { buildBrowser } from '../build/bundle.js';
import { assemble } from '../src/lib.js';
import { ENGINE } from './helpers.js';

describe('the engine\'s themes', () => {
  it('[T.2] assets/themes/<id>.css is exactly what scripts/build-themes.ts derives from the installed orz-markdown (step 3 builds Orchard); the engine bundle carries reveal\'s core CSS, deck.css and the built themes; no assembled file links a theme stylesheet', async () => {
    expect(builtThemes()).toEqual(['orchard']);
    for (const id of builtThemes()) expect(readFileSync(`assets/themes/${id}.css`, 'utf8') === derivedTheme(id), `assets/themes/${id}.css is stale: run npx tsx scripts/build-themes.ts`).toBe(true);
    const orchard = readFileSync('assets/themes/orchard.css', 'utf8');
    expect(orchard).toContain('orz-markdown 2.4.0 light-neat-3.css');
    expect(orchard).toContain('.reveal .orz-outline li.orz-here');
    expect(orchard).toContain('--chart-1: #5f9e44');
    const b = await buildBrowser();
    for (const marker of ['.reveal .orz-qr-slot', 'Bricolage+Grotesque', '.reveal.overview']) expect(b.iife.includes(marker), marker).toBe(true);
    const text = '{{nyml\nkind: document\ntheme: orchard\n}}\n\n<!-- slide -->\n## A\n';
    for (const html of [assemble(text, { engineSource: ENGINE }), assemble(text, { delivery: 'cdn' })]) {
      expect(html).not.toMatch(/id="orz-theme"/);
      expect(html).not.toMatch(/orz-markdown@[^/]+\/themes\//);
    }
  }, 120_000);
});
