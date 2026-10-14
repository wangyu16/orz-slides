/**
 * Rebuild step 2 — 0.x files and texts (src/legacy.ts; claims U.1–U.5): the
 * fixtures were made by the PUBLISHED 0.x CLIs (`npx orz-slides@0.7.1 / 0.8.0
 * / 0.8.2 / 0.8.5 <src>.md --cdn`, and one inline 0.8.5 file) from the
 * sources next to them (tests/fixtures/legacy/*.md):
 * - demo.md — a deck block first (0.x read it), every kind of slide;
 * - meta.md — a {{nyml kind: meta}} block BEFORE the deck block (0.x read
 *   neither: paper, no footer), text before the first slide, `</script>` in
 *   the text, a marker inside a fence, the dropped theme `executive`;
 * - plain.md — no deck block (0.x's implicit paper).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kit from 'orz-markdown/carrier';
import { readLegacy, upgrade, upgradeText } from '../src/legacy.js';
import { assemble, readDocument } from '../src/assemble.js';
import { parseDeck } from '../src/deck/parse.js';
import { LEGACY_DIR, LEGACY_FILES, ENGINE } from './helpers.js';

const UID = 'doc-legacy0000000001';
const source = (name: string): string => readFileSync(join(LEGACY_DIR, `${name}.md`), 'utf8');
const ink = (s: string): string => s.replace(/\s+/g, '');

describe('reading 0.x files', () => {
  it('[U.1] fixtures from the published 0.7.1, 0.8.0, 0.8.2 and 0.8.5 CLIs: the #orz-deck source exactly as the .md they were made from', () => {
    expect(LEGACY_FILES).toHaveLength(13);
    for (const v of ['0.7.1', '0.8.0', '0.8.2', '0.8.5']) for (const n of ['demo', 'meta', 'plain']) expect(LEGACY_FILES).toContain(`${n}-${v}.slides.html`);
    for (const f of LEGACY_FILES) {
      const html = readFileSync(join(LEGACY_DIR, f), 'utf8');
      const l = readLegacy(html);
      expect(l, f).not.toBeNull();
      const name = f.split('-')[0];
      expect(l!.text === source(name), f).toBe(true);
      expect(l!.wrapped, f).toBe(true);
      expect(l!.version, f).toBe(f.replace(/^[a-z]+-(\d+\.\d+\.\d+).*$/, '$1'));
      expect(l!.delivery, f).toBe(f.includes('inline') ? 'inline' : 'cdn');
      expect(l!.generator, f).toBe('orz-slides');
      // the 0.x writer's </script escape is undone and said
      expect(l!.scriptEscapes, f).toBe(name === 'meta' ? 1 : 0);
      // a 0.x file is no format-1 file
      expect(kit.extract(html), f).toBeNull();
    }
    expect(readLegacy(readFileSync(join(LEGACY_DIR, 'demo-0.8.5.slides.html'), 'utf8'))!.title).toBe('orz-slides — demo');
  });

  it('[U.1] a format-1 file and other HTML are not 0.x files', () => {
    expect(readLegacy(assemble('<!-- slide -->\n## A\n', { delivery: 'cdn' }))).toBeNull();
    expect(readLegacy('<html><script id="orz-deck" type="text/orz-slides">\nx\n</script></html>')).toBeNull();
    expect(readLegacy('<html><head><meta name="generator" content="orz-slides"></head><body><script type="text/orz-slides" id="orz-deck">\nx\n</script></body></html>')!.text).toBe('x');
  });
});

describe('upgrading 0.x texts', () => {
  it('[U.2] the deck block becomes the header (carrier, uid, its keys; paper written explicitly) and is removed; the rest of the text is unchanged', () => {
    const up = upgradeText(source('demo'), { uid: UID });
    expect(up.text.startsWith(`{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\ntitle: orz-slides — demo\nfooter: orz-slides · demo deck\nratio: 16:9\ntheme: paper\n}}\n\n<!-- slide template=title -->\n`)).toBe(true);
    expect(kit.withoutHeader(up.text).body.replace(/^\n\n/, '')).toBe(source('demo').replace(/^<!-- deck[\s\S]*?-->\n\n/, ''));
    const info = readDocument(up.text);
    expect(info.lint).toEqual([]);
    expect(parseDeck(up.text).config).toMatchObject({ theme: 'paper', ratio: '16:9', footer: 'orz-slides · demo deck', title: 'orz-slides — demo' });
    // a text without a deck block: 0.x's implicit paper
    const plain = upgradeText(source('plain'), { uid: UID });
    expect(kit.readHeader(plain.text)!.fields).toEqual({ carrier: 'slides', uid: UID, theme: 'paper' });
    expect(plain.notes.join(' ')).toMatch(/paper written explicitly/);
  });

  it('[U.3] a kind: meta block before the deck block: one header (the deck block wins a clash, said), the dropped theme mapped, nothing lost', () => {
    const up = upgradeText(source('meta'), { uid: UID });
    const h = kit.readHeader(up.text)!;
    expect(h.legacy).toBeNull();
    expect(h.fields).toEqual({ title: 'Buffers in five minutes', author: 'Yu Wang', license: 'CC-BY-4.0', carrier: 'slides', uid: UID, footer: 'CHEM 101 · week 3', transition: 'fade', ratio: '4:3', theme: 'sky' });
    expect(up.notes.join('\n')).toMatch(/0\.x did not read this deck block/);
    expect(up.notes.join('\n')).toMatch(/executive was dropped.*sky/);
    expect(up.notes.join('\n')).toMatch(/replaces the header's "Buffers — a legacy deck"/);
    // every non-blank character of the source survives except the deck block and the meta block's kind/title lines
    const removed = ink('<!-- deck\ntitle: Buffers in five minutes\ntheme: executive\nratio: 4:3\nfooter: CHEM 101 · week 3\ntransition: fade\n-->');
    expect(ink(up.text)).toContain(ink('Text before the first slide (0.x never showed it).'));
    expect(ink(kit.withoutHeader(up.text).body)).toBe(ink(kit.withoutHeader(source('meta')).body).replace(removed, ''));
    // the text before the first slide is kept and noticed; the fenced marker is no slide
    expect(readDocument(up.text).lint.map((l) => l.code)).toEqual(['text-before-first-slide']);
    expect(parseDeck(up.text).slides).toHaveLength(2);
  });

  it('[U.4] upgradeText is a no-op on a format-1 text but for carrier/uid, and maps every dropped theme', () => {
    const f1 = `{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\ntheme: nocturne\n}}\n\n<!-- slide -->\n## A\n`;
    expect(upgradeText(f1).text).toBe(f1);
    for (const [from, to] of [['executive', 'sky'], ['poppy', 'sticker'], ['sage', 'orchard'], ['bogus', 'paper'], ['light-neat-1', 'light-neat-1']]) {
      const t = upgradeText(`<!-- deck\ntheme: ${from}\n-->\n<!-- slide -->\n## A\n`, { uid: UID }).text;
      expect(kit.readHeader(t)!.fields['theme'], from).toBe(to);
    }
    // a format-1 text that still holds a deck block: the header keeps its own keys (the block never applied), the block's fill the rest
    const mixed = upgradeText(`{{nyml\nkind: document\ntheme: chalk\n}}\n\n<!-- deck\ntheme: neon\nfooter: F\n-->\n\n<!-- slide -->\n## A\n`, { uid: UID });
    expect(kit.readHeader(mixed.text)!.fields).toMatchObject({ theme: 'chalk', footer: 'F' });
    expect(mixed.notes.join('\n')).toMatch(/header's "chalk" is kept/);
    expect(parseDeck(mixed.text).lint).toEqual([]);
  });
});

describe('upgrading 0.x files', () => {
  it('[U.5] every fixture upgrades to a format-1 file of this shell whose text is the upgraded source; a format-1 file is re-assembled as it is', () => {
    for (const f of LEGACY_FILES) {
      const html = readFileSync(join(LEGACY_DIR, f), 'utf8');
      const up = upgrade(html, { uid: UID, engineSource: ENGINE });
      expect(up.from, f).toBe('legacy');
      expect(up.version, f).toBe(f.replace(/^[a-z]+-(\d+\.\d+\.\d+).*$/, '$1'));
      const ex = kit.extract(up.html)!;
      expect(ex.text === up.text, f).toBe(true);
      expect(ex.kind).toBe('slides');
      expect(up.html === assemble(up.text, { engineSource: ENGINE }), f).toBe(true);
      expect(up.text, f).toBe(upgradeText(source(f.split('-')[0]), { uid: UID, file: { title: readLegacy(html)!.title, meta: null } }).text);
      expect(readDocument(up.text).lint.filter((l) => l.level === 'error'), f).toEqual([]);
      // upgrading the result again changes nothing
      const again = upgrade(up.html, { engineSource: ENGINE });
      expect(again.from).toBe('format-1');
      expect(again.html === up.html, f).toBe(true);
    }
    expect(() => upgrade('<html></html>')).toThrow(/not an orz-slides file/);
  });
});

/*
 * Closed-loop round A (notes/closed-loop.md): upgrade keeps what 0.x SHOWED.
 * Each case failed on rebuild/1.0@817de2e before its fix.
 */
describe('round A: upgrade keeps what 0.x showed (FMT-1 … FMT-7, FMT-11)', () => {
  it('[U.6] FMT-2: a 0.x file built with the CLI\'s --theme (no deck block) upgrades to that theme, not paper', () => {
    const html = readFileSync(join(LEGACY_DIR, 'cli-theme/neon-0.8.5.slides.html'), 'utf8');
    expect(readLegacy(html)!.defaultTheme).toBe('neon');
    const up = upgrade(html, { uid: UID, delivery: 'cdn' });
    expect(kit.readHeader(up.text)!.fields['theme']).toBe('neon');
    expect(up.notes.join('\n')).not.toMatch(/paper written explicitly/);
    // a dropped CLI theme maps to its successor; none at all is 0.x's paper
    expect(kit.readHeader(upgradeText('<!-- slide -->\n## A\n', { uid: UID, file: { title: null, meta: null, defaultTheme: 'poppy' } }).text)!.fields['theme']).toBe('sticker');
    expect(kit.readHeader(upgradeText('<!-- slide -->\n## A\n', { uid: UID, file: { title: null, meta: null, defaultTheme: null } }).text)!.fields['theme']).toBe('paper');
    // the deck block still wins over the CLI flag (0.8.5: deck.config.theme || args.theme || 'paper')
    expect(kit.readHeader(upgradeText('<!-- deck\ntheme: chalk\n-->\n<!-- slide -->\n## A\n', { uid: UID, file: { title: null, meta: null, defaultTheme: 'neon' } }).text)!.fields['theme']).toBe('chalk');
  });

  it('[U.4] FMT-3: a format-1 text with no theme gets no theme (orchard stays orchard)', () => {
    const f1 = '{{nyml\nkind: document\ncarrier: slides\nuid: doc-0000000000\ntitle: F1\n}}\n\n<!-- slide -->\n## A\n';
    const up = upgradeText(f1);
    expect(up.text).toBe(f1);
    expect(up.moved).toEqual({});
  });

  it('[U.4] A3-FMT-5: upgradeText leaves a format-1 text\'s body alone — no hygiene repair (0.x split at every marker; a format-1 author did not rely on it): a bare fence or a callout that SHOWS a marker stays as written, with or without a stray deck block', () => {
    const body = '<!-- slide -->\n## How\n```\n<!-- slide -->\n## Shown\n```\n\n<!-- slide -->\n## Tip\n::: tip\n```markdown\n<!-- @notes -->\nhi\n```\n:::\n\n<!-- slide -->\n## Notes\n<!-- @notes: -->\nN\n';
    const f1 = `{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\n}}\n\n${body}`;
    const up = upgradeText(f1);
    expect(up.text).toBe(f1);
    expect(up.notes).toEqual([]);
    const stray = upgradeText(`{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\n}}\n\n<!-- deck\nfooter: F\n-->\n\n${body}`);
    expect(stray.text.endsWith(body)).toBe(true);
    // a 0.x text is still repaired (0.x split there)
    expect(parseDeck(upgradeText(body, { uid: UID }).text).slides).toHaveLength(4);
  });

  it('[U.6] FMT-4: every deck block is consumed — one pasted between slides, two before slide 1 — so the deck-block advice never loops', () => {
    const between = upgradeText(`{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\n}}\n\n<!-- slide -->\n## A\n\n<!-- deck\ntheme: neon\nfooter: F\n-->\n\n<!-- slide -->\n## B\n`);
    expect(parseDeck(between.text).lint).toEqual([]);
    expect(kit.readHeader(between.text)!.fields).toMatchObject({ theme: 'neon', footer: 'F' });
    expect(upgradeText(between.text).text).toBe(between.text);
    const two = upgradeText('\n<!-- deck\ntheme: neon\n-->\n<!-- deck\ntitle: T\nfooter: Foot\ntheme: chalk\n-->\n\n<!-- slide -->\n## A\n', { uid: UID });
    expect(readDocument(two.text).lint).toEqual([]);
    expect(kit.readHeader(two.text)!.fields).toMatchObject({ theme: 'neon', title: 'T', footer: 'Foot' });
    expect(two.notes.join('\n')).toMatch(/line \d+ \(0\.x ignored it\) was removed; its title, footer filled/);
  });

  it('[U.6] FMT-6: marker spellings 0.x read are normalised (@notes:, spaced tracks, key = value, BG=), a non-integer z dropped — each with a note', () => {
    const src = '<!-- slide col 1 / 2 { a; b } BG=#123456 -->\n## T\n<!-- @a -->\nA\n<!-- @b -->\nB\n<!-- @float left = 50% TOP=10% z=2.5 -->\nF\n<!-- @notes: -->\nSecret\n';
    const up = upgradeText(src, { uid: UID });
    const d = parseDeck(up.text);
    expect(d.lint).toEqual([]);
    const s = d.slides[0];
    expect(s.layoutSpec).toBe('col 1/2 { a; b }');
    expect(s.options.bg).toBe('#123456');
    expect(s.floats[0].geom).toEqual({ left: '50%', top: '10%' });
    expect(s.notes).toBe('Secret');
    expect(up.notes.join('\n')).toMatch(/z=2\.5 dropped/);
    // an already-format-1 marker is never rewritten
    const clean = `{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\ntheme: paper\n}}\n\n<!--  slide   2col  -->\n## A\n`;
    expect(upgradeText(clean).text).toBe(clean);
  });

  it('[U.6] FMT-7: a v= the template has no variant for (coursewerk decks: outline/section/closing v=5) is dropped with a note — 0.x showed the first look; a defined one stays', () => {
    const up = upgradeText('<!-- slide template=outline v=5 -->\n## Plan\n1. A\n\n<!-- slide template=title v=4 -->\n# T\n\n<!-- slide template=closing v=5 -->\n# Thanks\n', { uid: UID });
    expect(readDocument(up.text).lint.filter((l) => l.level === 'error')).toEqual([]);
    expect(parseDeck(up.text).slides.map((s) => s.templateVariant ?? 1)).toEqual([1, 4, 1]);
    expect(up.notes.filter((n) => /v=5 dropped: the (outline|closing) template has variants 1 to 3/.test(n))).toHaveLength(2);
  });

  it('[U.6] FMT-1/FMT-5: a marker hidden in a raw HTML block gets its blank line, a fence left open is closed before the next marker — the slides 0.x showed', () => {
    const src = '<!-- slide -->\n## Results\n<img src="a.png" width="40">\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## Code\n```python\nx = 1\n``\n<!-- slide -->\n## Last\n';
    const up = upgradeText(src, { uid: UID });
    const d = parseDeck(up.text);
    expect(d.lint.filter((l) => l.level === 'error')).toEqual([]);
    expect(d.slides.map((s) => s.title)).toEqual(['Results', 'Code', 'Last']);
    expect(d.slides[0].notes).toBe('PRIVATE');
    expect(up.notes.join('\n')).toMatch(/blank line added before the marker/);
    expect(up.notes.join('\n')).toMatch(/code fence left open was closed/);
  });

  it('[U.6] FMT-11: a BOM before the deck block is kept (FC-18 §3)', () => {
    const up = upgradeText('﻿<!-- deck\ntitle: Bom\n-->\n\n<!-- slide -->\n## A\n', { uid: UID });
    expect(up.text.startsWith('﻿{{nyml')).toBe(true);
    expect(up.text.split('﻿')).toHaveLength(2);
  });

  /*
   * Round A2 (notes/closed-loop.md): each probe failed on rebuild/1.0@6d3aa97.
   */
  it('[U.6] A2-FMT-1/3/4: upgrade repairs every construct left open before a marker with ITS closer — <pre>, an open comment, ::::, $$ — once each: no 50 blank lines, no 50 ::: lines, one note per repair', () => {
    const cases: Array<[string, string]> = [
      ['<pre>\ncode\n', '</pre>'],
      ['<!-- TODO rework this\n', '-->'],
      [':::: info\nx\n', '::::'],
      [':::: cols\n::: col\nx\n:::\n', '::::'],
      ['$$\nx^2\n', '$$'],
    ];
    for (const [open, closer] of cases) {
      const src = `<!-- slide -->\n## A\n${open}\n<!-- slide -->\n## B\n<!-- @notes -->\nN\n`;
      const up = upgradeText(src, { uid: UID });
      const d = parseDeck(up.text);
      expect(d.slides.map((s) => s.title), open).toEqual(['A', 'B']);
      expect(d.slides[1].notes, open).toBe('N');
      expect(d.lint.filter((l) => l.level === 'error'), open).toEqual([]);
      expect(up.text.length - src.length, open).toBeLessThan(120); // the header and one closer
      expect(up.text.split(closer).length - src.split(closer).length, open).toBe(1);
      expect(up.notes.filter((n) => /left open was closed|blank line added/.test(n)), open).toHaveLength(1);
    }
  });

  it('[U.6] A2-FMT-1: the repair loop stops when a pass makes no progress, and is bounded by the marker lines — a 1000-slide deck with an open comment upgrades in one repair, not 50 re-parses', () => {
    let src = '<!-- slide -->\n## A\n<!-- TODO: rework\n\n';
    for (let i = 0; i < 1000; i++) src += `<!-- slide -->\n## S${i}\ntext\n<!-- @notes -->\nnote ${i}\n\n`;
    const a = performance.now();
    const up = upgradeText(src, { uid: UID });
    expect(performance.now() - a).toBeLessThan(2500); // 5029 ms before
    expect(parseDeck(up.text).slides).toHaveLength(1001);
    expect(up.notes.filter((n) => /left open was closed/.test(n))).toHaveLength(1);
  });

  it('[U.6] A2-FMT-2: a fence (or container) closed only by a later slide\'s block, and 60 slides that each leave a bare ``` open, upgrade to the slides 0.x showed', () => {
    const src = '<!-- slide -->\n## A\n```python\nprint(1)\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n```js\nlet x = 1\n```\n\n<!-- slide -->\n## D\ntext\n';
    const d = parseDeck(upgradeText(src, { uid: UID }).text);
    expect(d.slides.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(d.slides[1].notes).toBe('PRIVATE');
    let sixty = '';
    for (let i = 1; i <= 60; i++) sixty += `<!-- slide -->\n## S${i}\n\`\`\`\ncode ${i}\n\n`;
    const up = upgradeText(sixty, { uid: UID });
    expect(parseDeck(up.text).slides).toHaveLength(60);
    expect(parseDeck(up.text).lint).toEqual([]);
  });

  it('[U.6] A2-FMT-5/7: a nested split\'s spaced tracks are squeezed at every depth; a slide marker\'s `key = value` (0.x did not read it) stays as written, and a fit= value 0.x ignored is dropped', () => {
    const up = upgradeText('<!-- slide row 1 / 1 { a; col 1 / 2 { b; c } } -->\n## T\n<!-- @a -->\nA\n<!-- @b -->\nB\n<!-- @c -->\nC\n', { uid: UID });
    const d = parseDeck(up.text);
    expect(d.lint).toEqual([]);
    expect(d.slides[0].layoutSpec).toBe('row 1/1 { a; col 1/2 { b; c } }');
    expect(d.slides[0].regions.map((r) => [r.name, r.markdown])).toEqual([['a', 'A'], ['b', 'B'], ['c', 'C']]);
    const eq = upgradeText('<!-- slide t = fade -->\n## T\n', { uid: UID });
    expect(eq.text).toMatch(/<!-- slide t = fade -->/);
    const fit = upgradeText('<!-- slide fit=shrink -->\n## T\n', { uid: UID });
    expect(fit.text).toMatch(/<!-- slide -->/);
    expect(fit.notes.join('\n')).toMatch(/fit=shrink dropped/);
    expect(readDocument(fit.text).lint.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('[U.6] A2-FMT-6: @notes:private, @notes(speaker), @notes! become @notes (0.x read them as the notes)', () => {
    const up = upgradeText('<!-- slide -->\n## T\n<!-- @notes:private -->\nsecret\n<!-- slide -->\n## U\n<!-- @notes(speaker) -->\ns2\n<!-- slide -->\n## V\n<!-- @notes! -->\ns3\n', { uid: UID });
    const d = parseDeck(up.text);
    expect(d.lint).toEqual([]);
    expect(d.slides.map((s) => s.notes)).toEqual(['secret', 's2', 's3']);
  });

  it('[U.6] A2-FMT-8/9: upgrade is idempotent (a marker a repair reveals is normalised too) and keeps the text\'s line ending; notes cite the ORIGINAL lines', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const src = '<!-- deck\ntheme: neon\n-->\n<!-- slide -->\n## A\ntext\n<!-- slide -->\n<img src=x>\n<!-- @notes: -->\nN\n```\ncode\n<!-- slide -->\n## C\n'.replace(/\n/g, eol);
      const up = upgradeText(src, { uid: UID });
      expect(upgradeText(up.text, { uid: UID }).text, JSON.stringify(eol)).toBe(up.text);
      expect(up.text.replace(new RegExp(eol, 'g'), '').match(/[\r\n]/), JSON.stringify(eol)).toBeNull();
      const d = parseDeck(up.text);
      expect(d.slides.map((s) => s.title)).toEqual(['A', undefined, 'C']);
      expect(d.slides[1].notes).toBe('N\n```\ncode\n```');
      expect(d.lint.filter((l) => l.level === 'error')).toEqual([]);
      // the <!-- @notes: --> line is line 9 of the source, the open fence line 11
      expect(up.notes.join('\n')).toMatch(/line 9: a blank line added/);
      expect(up.notes.join('\n')).toMatch(/line 11: the code fence left open/);
      expect(up.notes.join('\n')).toMatch(/line 9: @notes: written @notes/);
    }
  });
});
