/**
 * Rebuild step 2 — the isomorphic assembler (src/assemble.ts) against the
 * FC-18 laws on the shared golden corpus (slides, the D-46 reproduction
 * included) and hazard texts; `readDocument`; `newDocument`; the Node
 * library's engine (claims A.1–A.8, N.1–N.2).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as kit from 'orz-markdown/carrier';
import { assemble, extract, readDocument, shellParts, storedText, cdnBundleUrl, newDocument, BUNDLE_FILE, type AssembleOptions } from '../src/assemble.js';
import { assemble as libAssemble, engineFiles } from '../src/lib.js';
import { buildBrowser } from '../build/bundle.js';
import { VERSION } from '../src/version.js';
import { presentationOf } from '../src/presentation.js';
import { corpus, HAZARDS, ENGINE } from './helpers.js';

const CORPUS = corpus('slides');
const TEXTS: Array<[string, string]> = [
  ...CORPUS.map((c) => [c.path, c.text] as [string, string]),
  ...Object.entries(HAZARDS).map(([name, text]) => [`hazard:${name}`, text] as [string, string]),
];
const SOME_INCLUDES = { './part.md': 'Included </script> text\r\nwith CR LF and 𝒳\n', 'https://example.test/x.md': '# x\n' };
const OPTION_SETS: Array<[string, AssembleOptions]> = [
  ['inline', { engineSource: ENGINE }],
  ['cdn', { delivery: 'cdn' }],
  ['inline+includes', { engineSource: ENGINE, includes: SOME_INCLUDES }],
  ['cdn+includes', { delivery: 'cdn', includes: SOME_INCLUDES }],
];
const MODULES = ['src/assemble.ts', 'src/presentation.ts', 'src/themes.ts', 'src/legacy.ts', 'src/deck/parse.ts', 'src/deck/config.ts', 'src/deck/layout-spec.ts'];

describe('FC-18 laws on the slides corpus', () => {
  it('[A.1] the corpus is the slides corpus of the orz-markdown package, with markers-in-code and the D-46 reproduction', () => {
    expect(CORPUS.map((c) => c.path).sort()).toEqual([
      'slides/every-layout.slides.md', 'slides/every-template.slides.md', 'slides/markers-in-code.slides.md',
      'slides/minimal.slides.md', 'slides/notes-and-fragments.slides.md', 'slides/title-v2-long-title.slides.md',
    ]);
    expect(CORPUS.find((c) => c.defect === 'D-46')?.path).toBe('slides/title-v2-long-title.slides.md');
  });

  for (const [name, o] of OPTION_SETS) {
    it(`[A.1] round trip, ${name}: extract(assemble(T)).text === T for every slides corpus text and hazard text`, () => {
      for (const [id, text] of TEXTS) {
        const html = assemble(text, o);
        const ex = extract(html);
        expect(ex, id).not.toBeNull();
        expect(ex!.text === text, id).toBe(true);
        expect(ex!.kind, id).toBe('slides');
        expect(ex!.format, id).toBe(1);
        expect(ex!.shell, id).toBe(VERSION);
        expect(ex!.delivery, id).toBe(o.delivery ?? 'inline');
        expect(ex!.includes, id).toEqual(o.includes);
        expect(storedText(text) === text, id).toBe(true);
      }
    });
  }

  it('[A.2] determinism: the same bytes on every call and after a fresh module load', async () => {
    const first = TEXTS.map(([, t]) => OPTION_SETS.map(([, o]) => assemble(t, o)));
    const again = TEXTS.map(([, t]) => OPTION_SETS.map(([, o]) => assemble(t, o)));
    expect(again).toEqual(first);
    vi.resetModules();
    const fresh = await import('../src/assemble.js');
    expect(fresh.assemble).not.toBe(assemble);
    expect(TEXTS.map(([, t]) => OPTION_SETS.map(([, o]) => fresh.assemble(t, o)))).toEqual(first);
  });

  it('[A.2] the isomorphic modules read no clock, randomness or environment', () => {
    for (const file of MODULES) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\bDate\b|Math\.random|\bprocess\b|\bnavigator\b|\blocation\b|performance\.now|crypto\.|from 'node:/);
    }
  });

  it('[A.3] idempotence: assemble(extract(F).text, o) === F', () => {
    for (const [id, text] of TEXTS) {
      for (const [, o] of OPTION_SETS) {
        const f = assemble(text, o);
        expect(assemble(extract(f)!.text, o) === f, id).toBe(true);
      }
    }
  });

  it('[A.4] mixed line endings are stored in the first line break\'s style (storedText); NUL, a lone surrogate and format 2 are refused', () => {
    const mixed = '<!-- slide -->\r\n## A\nb\r\n';
    expect(extract(assemble(mixed, { delivery: 'cdn' }))!.text).toBe(storedText(mixed));
    expect(storedText(mixed)).toBe('<!-- slide -->\r\n## A\r\nb\r\n');
    expect(() => assemble('a\u0000b', { delivery: 'cdn' })).toThrow();
    expect(() => assemble('a\ud800b', { delivery: 'cdn' })).toThrow();
    expect(() => assemble('{{nyml\nkind: document\nformat: 2\n}}\n', { delivery: 'cdn' })).toThrow();
    expect(() => assemble('x', {})).toThrow(/engine source/);
    expect(() => assemble('x', { engineSource: 'a</script>b' })).toThrow(/script-safe/);
    expect(() => assemble('x', { delivery: 'zip' as never })).toThrow(/unknown delivery/);
  });
});

describe('the envelope and the shell parts', () => {
  it('[A.5] the text-derived parts are the kit\'s assembleEnvelope (one #orz-src island, #orz-shell, #orz-meta, <title> by FC-18 §8.1 for slides); the shell parts depend only on the options and the header\'s theme and ratio', () => {
    for (const [id, text] of TEXTS) {
      const parts = shellParts({ delivery: 'cdn' }, presentationOf(text));
      expect(assemble(text, { delivery: 'cdn' }) === kit.assembleEnvelope(text, parts), id).toBe(true);
      const html = assemble(text, { delivery: 'cdn' });
      expect(html.match(/<script type="text\/markdown" id="orz-src"/g)?.length, id).toBe(1);
      const shell = html.replace(/<script type="text\/markdown" id="orz-src"[\s\S]*?<\/script>/, '');
      expect(shell, id).not.toMatch(/id="orz-deck"|text\/orz-slides|__ORZ_SLIDES__/);
    }
    for (const c of CORPUS) {
      const html = assemble(c.text, { delivery: 'cdn' });
      expect(kit.decodeEntities(/<title>([^<]*)<\/title>/.exec(html)![1]), c.path).toBe(c.derivedTitle);
      expect(html).toContain(`<meta name="generator" content="orz-slides ${VERSION}">`);
      expect(html).toContain(`<script id="orz-engine" src="${cdnBundleUrl()}"></script>`);
    }
    // a body edit does not change the shell parts; a theme or ratio change does
    const a = shellParts({ delivery: 'cdn' }, presentationOf('{{nyml\nkind: document\ntheme: chalk\n}}\n<!-- slide -->\n## A\n'));
    const b = shellParts({ delivery: 'cdn' }, presentationOf('{{nyml\nkind: document\ntheme: chalk\n}}\n<!-- slide -->\n## B\nmore\n'));
    expect(b).toEqual(a);
    expect(shellParts({ delivery: 'cdn' }, presentationOf('{{nyml\nkind: document\nratio: 4:3\n}}\n'))).not.toEqual(shellParts({ delivery: 'cdn' }, presentationOf('')));
    expect(cdnBundleUrl('1.2.3')).toBe(`https://cdn.jsdelivr.net/npm/orz-slides-browser@1.2.3/${BUNDLE_FILE}`);
  });

  it('[A.6] the Node library inlines this release\'s verified engine — the bytes of the browser build — and equals assemble with that engineSource', async () => {
    const own = await buildBrowser();
    const engine = engineFiles();
    expect(engine.source === own.iife).toBe(true);
    expect(readFileSync('browser/orz-slides.browser.js', 'utf8') === own.iife).toBe(true);
    expect(readFileSync(engine.release, 'utf8')).toBe(own.release);
    for (const c of CORPUS.slice(0, 2)) expect(libAssemble(c.text) === assemble(c.text, { engineSource: own.iife })).toBe(true);
    expect(JSON.parse(own.release)).toMatchObject({ kind: 'slides', version: VERSION, formats: [1], bundle: { path: BUNDLE_FILE, integrity: own.integrity } });
  });
});

describe('readDocument', () => {
  it('[A.7] agrees with the manifest for every slides corpus text: kind, title, header facts, the slides ratio default', () => {
    for (const c of CORPUS) {
      const info = readDocument(c.text);
      expect(info.kind, c.path).toBe('slides');
      expect(info.title, c.path).toBe(c.derivedTitle);
      expect(info.meta.title ?? null, c.path).toBe(c.header.title);
      expect(info.meta.uid ?? null, c.path).toBe(c.header.uid);
      expect(info.theme ?? null, c.path).toBe(c.header.theme);
      expect(info.header?.keys ?? [], c.path).toEqual(c.keys);
      expect(info.settings['ratio'], c.path).toBeDefined();
    }
    // the kind: opts, the file name, the header's carrier, else slides
    expect(readDocument('# x\n').kind).toBe('slides');
    expect(readDocument('# x\n', { filename: 'a.md' }).kind).toBe('md');
    expect(readDocument('{{nyml\nkind: document\ncarrier: paged\n}}\n').kind).toBe('paged');
  });
});

describe('newDocument', () => {
  it('[N.1] a header with carrier: slides and a fresh uid first, a title slide and a normal slide; lint-clean; the kit\'s conformance shape', () => {
    const a = newDocument();
    const b = newDocument();
    expect(a.startsWith('{{nyml\nkind: document\ncarrier: slides\nuid: doc-')).toBe(true);
    const ua = kit.readHeader(a)!.fields['uid'];
    expect(ua).toMatch(/^doc-[0-9a-z]{16}$/);
    expect(kit.readHeader(b)!.fields['uid']).not.toBe(ua);
    const info = readDocument(a);
    expect(info.lint).toEqual([]);
    expect(info.title).toBe('Untitled deck');
    expect(kit.lintHeader(a, 'slides').filter((l) => l.level === 'error')).toEqual([]);
  });

  it('[N.2] title, theme, ratio and uid options; refusals', () => {
    const t = newDocument({ title: 'Buffers *and* pH', theme: 'nocturne', ratio: '4:3', uid: 'doc-0123456789abcdef' });
    const h = kit.readHeader(t)!.fields;
    expect([h['title'], h['theme'], h['ratio'], h['uid']]).toEqual(['Buffers *and* pH', 'nocturne', '4:3', 'doc-0123456789abcdef']);
    expect(t).toContain('# Buffers \\*and\\* pH');
    expect(readDocument(t).lint).toEqual([]);
    expect(() => newDocument({ theme: 'executive' })).toThrow(/unknown theme/);
    expect(() => newDocument({ ratio: '21:9' })).toThrow(/unknown ratio/);
    expect(() => newDocument({ uid: 'nope' })).toThrow(/malformed uid/);
  });
});
