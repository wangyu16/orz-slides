/**
 * orz-slides 1.1 on orz-markdown 2.5.0 (family C1): the host's twin-link
 * naming (FC-18 §8.2 `twinLinks`, K1) through the assembler, `upgrade`, the
 * CLI's re-assembly and every render of the deck (the read view's deck, print
 * and speaker view, the flattened preview, the live card's env); the kit's
 * browser-safe targets of a text (K2) re-exported; the theme picker's dots
 * (STATUS D-95). Claims A.8, W.11, S.5, T.22.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kit from 'orz-markdown/carrier';
import { themeInfo, themeSwatch as kitSwatch } from 'orz-markdown/themes';
import { assemble as isoAssemble, extract } from '../src/assemble.js';
import * as lib from '../src/lib.js';
import { renderDeckText, twinLinksEnv } from '../src/present/render.js';
import { renderFlat } from '../src/browser/slides/flat.js';
import { THEMES, themeSwatch } from '../src/themes.js';
import { ENGINE } from './helpers.js';

const NAMING = { slides: '{stem}.html', md: '{stem}.html' } as const;
const TEXT = '{{nyml\nkind: document\ncarrier: slides\nuid: doc-links000000000001\ntitle: Links\n}}\n\n<!-- slide -->\n## Links\n\n[next week](week2.slides.md) and [notes](notes.md#part) and [site](https://example.org/a.md)\n';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'orz-slides-links-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const CLI = join(process.cwd(), 'dist', 'cli.js');
function cli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: join(tmp, '.cache') } }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

describe('the twin-link naming (FC-18 §8.2, orz-markdown 2.5.0)', () => {
  it('[A.8] assemble(text, { twinLinks }) stores a non-family naming in #orz-shell "links" (extract gives it back), the family naming writes the bytes of assemble(text), an invalid naming throws; the Node library equals the isomorphic assembler; upgrade of a format-1 file keeps the naming; the CLI\'s assemble over a file keeps its naming', async () => {
    for (const delivery of ['inline', 'cdn'] as const) {
      const o = delivery === 'inline' ? { engineSource: ENGINE } : { delivery };
      const plain = isoAssemble(TEXT, o);
      const named = isoAssemble(TEXT, { ...o, twinLinks: { ...NAMING } });
      expect(named).not.toBe(plain);
      expect(named).toContain('"links":');
      expect(extract(named)?.twinLinks).toEqual(NAMING);
      expect(extract(named)?.text).toBe(TEXT);
      expect(extract(plain)?.twinLinks).toBeUndefined();
      // the family naming, spelt out or empty: no "links", the exact bytes of a file without it
      expect(isoAssemble(TEXT, { ...o, twinLinks: {} })).toBe(plain);
      expect(isoAssemble(TEXT, { ...o, twinLinks: { slides: '{stem}.slides.html' } })).toBe(plain);
      expect(isoAssemble(TEXT, { ...o, twinLinks: null })).toBe(plain);
      // idempotence with the naming
      expect(isoAssemble(extract(named)!.text, { ...o, twinLinks: extract(named)!.twinLinks! })).toBe(named);
      // the Node library: the same bytes (inline carries this release's engine)
      if (delivery === 'cdn') expect(lib.assemble(TEXT, { delivery, twinLinks: { ...NAMING } })).toBe(named);
      // an invalid naming is refused
      expect(() => isoAssemble(TEXT, { ...o, twinLinks: { slides: 'x.html' } as never })).toThrow();
      expect(() => isoAssemble(TEXT, { ...o, twinLinks: { slides: '../{stem}.html' } as never })).toThrow();
    }
    // upgrade re-assembles a format-1 file with its naming (and keeps the naming given instead)
    const named = lib.assemble(TEXT, { delivery: 'cdn', twinLinks: { ...NAMING } });
    const up = lib.upgrade(named, { delivery: 'cdn' });
    expect(up.html).toBe(named);
    expect(extract(lib.upgrade(named, { delivery: 'cdn', twinLinks: { md: '{stem}.htm.html' } }).html)?.twinLinks).toEqual({ md: '{stem}.htm.html' });
    // the CLI keeps the existing file's naming when it assembles over it (as it keeps its delivery and includes)
    const d = join(tmp, 'cli');
    mkdirSync(d);
    writeFileSync(join(d, 'deck.slides.md'), TEXT, 'utf8');
    writeFileSync(join(d, 'deck.slides.html'), named, 'utf8');
    const edited = TEXT.replace('## Links', '## Links, edited');
    writeFileSync(join(d, 'deck.slides.md'), edited, 'utf8');
    const r = await cli(['assemble', 'deck.slides.md', '--json', '--force'], d);
    expect(r.code, r.stderr).toBe(0);
    const out = readFileSync(join(d, 'deck.slides.html'), 'utf8');
    expect(extract(out)?.text).toBe(edited);
    expect(extract(out)?.twinLinks).toEqual(NAMING);
    expect(out).toBe(lib.assemble(edited, { delivery: 'cdn', twinLinks: { ...NAMING } }));
  });

  it('[W.11] every render of the deck names twin links with the naming — the read view\'s deck (and so print and the speaker view), the flattened preview (renderPreview, the editor) and the live card\'s env; `false` keeps links as written (an app\'s resolveLink); default the family names', async () => {
    const hrefs = (html: string): string[] => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]!);
    const family = ['week2.slides.html', 'notes.md.html#part', 'https://example.org/a.md'];
    const host = ['week2.html', 'notes.html#part', 'https://example.org/a.md'];
    const written = ['week2.slides.md', 'notes.md#part', 'https://example.org/a.md'];
    expect(hrefs((await renderDeckText(TEXT)).html)).toEqual(family);
    expect(hrefs((await renderDeckText(TEXT, { twinLinks: { ...NAMING } })).html)).toEqual(host);
    expect(hrefs(await renderFlat(TEXT))).toEqual(family);
    expect(hrefs(await renderFlat(TEXT, { twinLinks: { ...NAMING } }))).toEqual(host);
    expect(hrefs(await renderFlat(TEXT, { twinLinks: false }))).toEqual(written);
    // the live card's env (src/browser/slides/editor.ts) takes the shell's render context the same way
    expect(twinLinksEnv(undefined)).toBe(true);
    expect(twinLinksEnv(true)).toBe(true);
    expect(twinLinksEnv(null)).toBe(true);
    expect(twinLinksEnv(false)).toBe(false);
    expect(twinLinksEnv({ ...NAMING })).toEqual(NAMING);
    // the editor's sources hard-code no naming any more (C1: browser/slides/editor.ts said `orzTwinLinks: true`)
    for (const f of ['src/browser/slides/editor.ts', 'src/browser/slides/flat.ts', 'src/present/render.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/orzTwinLinks:\s*true/);
    }
  });
});

describe('the package surface (1.1)', () => {
  it('[S.5] the Node library, the ES module and the IIFE global offer the kit\'s browser-safe targets of a text (includeTargets, linkTargets: orz-markdown 2.5.0 K2), themeSwatch, and (browser) printDocument and printDeck; browser/index.d.ts declares them', async () => {
    expect(lib.includeTargets).toBe(kit.includeTargets);
    expect(lib.linkTargets).toBe(kit.linkTargets);
    const text = `${TEXT}\n{{md ./part.md}}\n\n![a figure](fig.png)\n`;
    expect(lib.includeTargets(text)).toEqual(['./part.md']);
    expect(lib.linkTargets(text).map((l) => [l.href, l.kind])).toEqual([['week2.slides.md', 'twin'], ['notes.md#part', 'twin'], ['https://example.org/a.md', 'other'], ['fig.png', 'asset']]);
    expect(lib.themeSwatch).toBe(themeSwatch);
    const esm = readFileSync('src/browser/esm.ts', 'utf8');
    for (const name of ['includeTargets', 'linkTargets', 'printDocument', 'printDeck', 'themeSwatch']) {
      expect(esm, `esm: ${name}`).toMatch(new RegExp(`export \\{[^}]*\\b${name}\\b`));
    }
    expect(esm).toMatch(/OrzCarrier = Object\.freeze\(\{[^}]*includeTargets, linkTargets, printDocument, printDeck/);
    expect(readFileSync('src/browser/index.ts', 'utf8')).toMatch(/layout: LAYOUT_API, includeTargets, linkTargets, printDocument, printDeck/);
    const dts = readFileSync('browser/index.d.ts', 'utf8');
    for (const decl of ['function includeTargets(', 'function linkTargets(', 'function printDocument(', 'function printDeck(', 'function themeSwatch(', 'export type TwinNaming', 'twinLinks?: TwinNaming;']) {
      expect(dts, decl).toContain(decl);
    }
  });
});

describe('the theme picker (STATUS D-95)', () => {
  it('[T.22] every slide theme\'s dot differs: its page colour and signature colour split diagonally (orz-markdown 2.5.0 themeSwatch) — a derived theme\'s are its orz-markdown theme\'s, an updated 0.x theme\'s its own layer\'s; the Theme setting\'s choices carry them', async () => {
    const dots = THEMES.map((t) => themeSwatch(t.id));
    expect(new Set(dots).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(themeSwatch(t.id)).toBe(`linear-gradient(135deg, ${t.paper} 50%, ${t.accent} 50%)`);
      if (t.derivedFrom) {
        expect(themeSwatch(t.id), t.id).toBe(kitSwatch(t.derivedFrom));
        expect([t.paper, t.accent]).toEqual([themeInfo(t.derivedFrom).paper, themeInfo(t.derivedFrom).accent]);
      } else {
        const layer = readFileSync(`assets/themes/layers/${t.id}.css`, 'utf8').toLowerCase();
        expect(layer, t.id).toContain(t.paper);
      }
    }
    // an alias and an unknown id
    expect(themeSwatch('light-neat-1')).toBe(themeSwatch('sky'));
    expect(themeSwatch('nope')).toBe(themeSwatch('orchard'));
    const { SLIDES_SETTINGS } = await import('../src/browser/slides/settings.js');
    const theme = SLIDES_SETTINGS.find((s) => s.key === 'theme')!;
    expect(theme.choices.map((c) => (c as { swatch?: string }).swatch)).toEqual(dots);
  });
});
