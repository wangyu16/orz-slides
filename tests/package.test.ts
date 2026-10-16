/**
 * Rebuild step 7 — the package surface (claims S.1, S.2): the Node library
 * apps and agents import (the BUILT `dist/lib.js`, as npm ships it) and the
 * `orz-slides` bin; the committed examples never go stale (orz-paged's D.1).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { twinName } from 'orz-markdown/carrier';
import { assemble, extract, inspect, TEMPLATES, THEMES, VERSION } from '../src/lib.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { bin: Record<string, string>; files: string[]; main: string; types: string; scripts: Record<string, string> };

describe('the package', () => {
  it('[S.1] the library (dist/lib.js) exports the format-1 API — assemble, extract, readDocument, newDocument with its templates, upgrade, inspect, inspectLayout, the upgrade report — plus parseDeck and the layout ops the per-slide editor uses (applyOp, slideMap, partAt, …) for apps and agents; buildSlidesHtml and the 0.x API are gone (FC-09); the bin `orz-slides` is dist/cli.js', async () => {
    const lib = await import('../dist/lib.js') as Record<string, unknown>;
    for (const name of ['assemble', 'extract', 'readDocument', 'newDocument', 'storedText', 'upgrade', 'upgradeText', 'readLegacy', 'inspect', 'inspectLayout', 'findChrome', 'layoutAdvice', 'upgradeReport', 'reportNotes', 'parseDeck', 'scanMarkers', 'planDeck', 'deckConfig', 'applyOp', 'applyEdits', 'slideMap', 'partAt', 'blockingProblem', 'placeFloat', 'presetOf', 'snapTracks', 'stepTracks', 'resolveTheme', 'isThemeId', 'sha256', 'engineSource']) {
      expect(typeof lib[name], name).toBe('function');
    }
    for (const name of ['TEMPLATES', 'DEFAULT_TEMPLATE', 'THEMES', 'DEFAULT_THEME', 'DROPPED_THEMES', 'PRESET_CHOICES', 'SLIDE_SIZE', 'VERSION', 'ORZ_MARKDOWN_VERSION', 'LayoutOpError']) expect(lib[name], name).toBeDefined();
    for (const gone of ['buildSlidesHtml', 'THEME_DEFS', 'selfVersion', 'pkgVersion']) expect(lib, gone).not.toHaveProperty(gone);
    // an agent's round: a new deck, one layout op, the parse of the result, the file
    const L = lib as unknown as typeof import('../src/lib.js');
    const text = L.newDocument({ template: 'minimal', uid: 'doc-agentround0001' });
    const op = L.applyOp(text, 1, { type: 'split', box: 'body', dir: 'col' });
    expect(op.edits.length).toBeGreaterThan(0);
    expect(L.applyEdits(text, op.edits)).toBe(op.text);
    const deck = L.parseDeck(op.text);
    expect(deck.slides[1]!.regions.map((r) => r.name)).toEqual(['body', 'body-2']);
    expect(deck.slides[1]!.layoutSpec).toMatch(/^col /);
    expect(L.slideMap(op.text, 1)!.boxes.map((b) => b.name)).toHaveLength(2);
    expect(() => L.applyOp(text, 0, { type: 'split', box: 'body', dir: 'col' })).toThrow(L.LayoutOpError);
    expect(L.extract(L.assemble(op.text))!.text).toBe(op.text);
    expect(L.inspect(op.text, { filename: 'a.slides.md' }).slides).toBe(2);
    // the bin
    expect(pkg.bin).toEqual({ 'orz-slides': 'dist/cli.js' });
    expect(readFileSync('dist/cli.js', 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(pkg.files).toContain('dist');
    expect([pkg.main, pkg.types]).toEqual(['./dist/lib.js', './dist/lib.d.ts']);
    expect(pkg.scripts['examples']).toBe('tsx scripts/examples.ts');
  });

  it('[S.2] the committed examples never go stale: every examples/*.slides.md has its examples/*.slides.html, which extracts to exactly that text, was made by this version, and equals a fresh assemble with its delivery and includes (one inline example, `starter`, the rest cdn decks for the web: the repository stays lean); the texts have a uid and no lint errors; `npm run examples` regenerates them', () => {
    const texts = readdirSync('examples').filter((f) => f.endsWith('.slides.md')).sort();
    const files = readdirSync('examples').filter((f) => f.endsWith('.slides.html')).sort();
    expect(texts.length).toBeGreaterThanOrEqual(4);
    expect(files).toEqual(texts.map((t) => twinName(t)));
    const inline: string[] = [];
    const themes = new Set<string>();
    for (const name of texts) {
      const text = readFileSync(`examples/${name}`, 'utf8');
      const html = readFileSync(`examples/${twinName(name)}`, 'utf8');
      const ex = extract(html);
      expect(ex, name).not.toBeNull();
      expect(ex!.text === text, `${name}: the file's text is not its twin`).toBe(true);
      expect(ex!.shell, `${name}: made by another version`).toBe(VERSION);
      expect(ex!.kind, name).toBe('slides');
      if (ex!.delivery === 'inline') inline.push(name);
      else expect(ex!.delivery, name).toBe('cdn');
      const fresh = assemble(text, { delivery: ex!.delivery as 'inline' | 'cdn', ...(ex!.includes ? { includes: ex!.includes } : {}) });
      expect(fresh === html, `${twinName(name)} is stale: run \`npm run build && npm run examples\``).toBe(true);
      const r = inspect(text, { filename: name });
      expect(r.lint.filter((l) => l.level === 'error'), name).toEqual([]);
      expect(r.uid, name).not.toBeNull();
      themes.add(r.themeEffective!);
    }
    expect(inline).toEqual(['starter.slides.md']);
    expect(themes.size).toBeGreaterThanOrEqual(3);
  });

  it('[S.3] the review decks never go stale (STATUS D-29): every tests/decks/*.slides.md is a format-1 slides text with a uid, no lint error or warning, and assembles to a file that extracts to exactly it; their .slides.html are not committed', () => {
    const texts = readdirSync('tests/decks').filter((f) => f.endsWith('.slides.md')).sort();
    expect(texts.length).toBeGreaterThanOrEqual(8);
    expect(readdirSync('tests').filter((f) => /^test-.*\.(md|slides\.html)$/.test(f))).toEqual([]);
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^tests\/decks\/\*\.slides\.html$/m);
    for (const name of texts) {
      const text = readFileSync(`tests/decks/${name}`, 'utf8');
      const r = inspect(text, { filename: name });
      expect(r.kind, name).toBe('slides');
      expect(r.format, name).toBe(1);
      expect(r.uid, name).not.toBeNull();
      expect(r.lint, name).toEqual([]);
      expect(extract(assemble(text, { delivery: 'cdn' }))!.text === text, name).toBe(true);
    }
  });

  it('[S.4] the agent skill (orz-slides-skills/SKILL.md, mirrored by orz-claude-plugin) is the 1.x skill: format 1 and its header keys, both editing modes, the layout grammar and presets, template pages with their looks and here=, the 14 themes, the deck templates, capacity budgets with inspect --layout, upgrade of files and texts, recovery; nothing of 0.x is taught as current', () => {
    const skill = readFileSync('orz-slides-skills/SKILL.md', 'utf8');
    expect(skill.startsWith('---\nname: orz-slides\ndescription: ')).toBe(true);
    for (const term of ['{{nyml', 'carrier: slides', 'slide_numbers', 'progress', 'section_numbers', 'ratio', 'deck-block', 'flattened', 'live slide card', 'single-slide editing', 'Cmd/Ctrl+Shift+Enter',
      'main-side', 'quad', 'row auto/1', '@notes', '@footer', '@float', 'step', 'fit=', 'here=N', 'v=1`–`6', 'inspect x.slides.md --layout', 'no-browser', 'upgrade deck.md', 'upgrade old.slides.html', '--replaces', 'orz-src', 'orz-deck', 'starter', 'talk', 'minimal', 'applyOp', '1280 × 720']) {
      expect(skill, term).toContain(term);
    }
    for (const t of THEMES) expect(skill, t.id).toContain(`\`${t.id}\``);
    for (const t of TEMPLATES) expect(skill, t.id).toContain(`\`${t.id}\``);
    expect(skill).not.toMatch(/BUDGETS|text\/orz-slides" id="orz-deck">\s*\n\s*\.\.\.deck config|buildSlidesHtml|seven themes|executive`?,? `?poppy`?,? (and )?`?sage`? (are|is) (themes|available)/);
  });
});
