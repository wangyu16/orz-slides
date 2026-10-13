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
