/**
 * Rebuild step 7 — `inspect` (claims I.1–I.6; orz-paged's tests/inspect.test.ts
 * for the slides kind): the isomorphic report on assembled decks, 0.x files
 * and texts, format-1 texts and plain HTML; the shipped upgrade report.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readDocument as kitReadDocument, sha256 } from 'orz-markdown/carrier';
import { assemble, inspect, readLegacy, upgradeText, upgradeReport, reportNotes, VERSION } from '../src/lib.js';
import { inspect as isoInspect } from '../src/inspect.js';
import { parseDeck } from '../src/deck/parse.js';
import { storedText } from '../src/assemble.js';
import { corpus, HAZARDS, LEGACY_DIR, LEGACY_FILES, read, ENGINE } from './helpers.js';

const legacyFile = (name: string): string => read(join(LEGACY_DIR, name));

describe('inspect', () => {
  it('[I.1] an assembled deck: input assembled, kind, format, shell (version, generator, delivery, relation), uid, title, theme as written and shown, ratio, slides, header keys, settings, includes, sha256, lint and structure; advice for an older shell, an altered engine, a newer shell; another kind is pointed to its carrier', () => {
    const t = '{{nyml\nkind: document\ncarrier: slides\nuid: doc-inspect0000001\ntitle: Inspected\ntheme: light-neat-1\nratio: 4:3\nprogress: no\n}}\n\n<!-- slide -->\n## One\n\n<!-- slide 2col -->\n## Two\n<!-- @left -->\nl\n<!-- @right -->\nr\n';
    const r = inspect(assemble(t, { delivery: 'cdn', includes: { './a.md': 'A\n' } }), { filename: 'x.slides.html' });
    expect(r).toMatchObject({ tool: { name: 'orz-slides', version: VERSION, formats: [1] }, input: 'assembled', kind: 'slides', format: 1, writable: true, legacy: null, uid: 'doc-inspect0000001', title: 'Inspected', theme: 'light-neat-1', themeEffective: 'sky', ratio: '4:3', slides: 2, includes: 1, sha256: sha256(t), lint: [], upgrade: null });
    expect(r.shell).toEqual({ version: VERSION, generator: `orz-slides ${VERSION}`, delivery: 'cdn', relation: 'same' });
    expect(r.header).toEqual({ present: true, legacy: null, keys: ['carrier', 'uid', 'title', 'theme', 'ratio', 'progress'] });
    expect(r.settings).toMatchObject({ progress: 'no', slide_numbers: 'yes' });
    expect(r.checks).toEqual({ island: 'closed', end: 'closed', engine: 'cdn' });
    // inline: the engine checked against this release's
    expect(inspect(assemble(t)).checks!.engine).toBe('same');
    expect(isoInspect(assemble(t, { engineSource: ENGINE }), { engineSource: `${ENGINE}//` }).checks!.engine).toBe('different');
    // an older and a newer shell
    const older = assemble(t, { delivery: 'cdn' }).split(`"shell":"${VERSION}"`).join('"shell":"0.0.1"');
    const o = inspect(older, { filename: 'old.slides.html' });
    expect(o.shell!.relation).toBe('older');
    expect(o.advice.join('\n')).toMatch(/older than this tool .*`orz-slides upgrade old\.slides\.html`/);
    const newer = inspect(assemble(t, { delivery: 'cdn' }).split(`"shell":"${VERSION}"`).join('"shell":"99.0.0"'));
    expect(newer.writable).toBe(false);
    expect(newer.advice.join('\n')).toMatch(/newer orz-slides .*npx orz-slides@latest/);
    // a cut-off file
    const whole = assemble(t, { delivery: 'cdn' });
    const cut = inspect(whole.slice(0, whole.indexOf('## Two')), { filename: 'c.slides.html' });
    expect(cut.checks!.island).toBe('unclosed');
    expect(cut.writable).toBe(false);
    expect(cut.advice.join('\n')).toMatch(/orz-slides extract c\.slides\.html -o c\.recovered\.slides\.md/);
    // another kind's text
    const md = inspect('# hello\n', { filename: 'x.md' });
    expect(md.kind).toBe('md');
    expect(md.advice.join('\n')).toMatch(/use orz-mdhtml/);
  });

  it('[I.2] a 0.x file: input legacy, its version, generator, delivery, <title>, #orz-meta keys, the theme it showed and its deck block; the title, theme and slides as upgrade would write them; the sha256 of its source; no format, not writable; the upgrade report (nothing unexplained for every fixture) in `upgrade` and the notes; advice upgrade (with --text beside a text twin)', () => {
    for (const f of [...LEGACY_FILES, 'cli-theme/neon-0.8.5.slides.html']) {
      const html = legacyFile(f);
      const legacy = readLegacy(html)!;
      const r = inspect(html, { filename: 'old.slides.html' });
      const up = upgradeText(legacy.text, { uid: 'doc-0000000000000000', file: { title: legacy.title, meta: legacy.meta, defaultTheme: legacy.defaultTheme } });
      expect(r, f).toMatchObject({ input: 'legacy', kind: 'slides', format: null, writable: false, header: null, sha256: sha256(legacy.text), slides: parseDeck(up.text).slides.length });
      expect(r.legacy, f).toMatchObject({ version: legacy.version, generator: legacy.generator, delivery: legacy.delivery, title: legacy.title, defaultTheme: legacy.defaultTheme });
      expect(r.theme, f).toBe(kitReadDocument(up.text, { kind: 'slides' }).theme);
      expect(r.upgrade, f).toEqual(upgradeReport(legacy.text, up.text, legacy.defaultTheme ?? ''));
      expect(r.upgrade!.unexplained, f).toEqual([]);
      expect(r.notes, f).toEqual(expect.arrayContaining(reportNotes(r.upgrade!)));
      expect(r.advice[0], f).toMatch(/run `orz-slides upgrade old\.slides\.html`/);
      // the uid is the file's own, never the placeholder of the in-memory upgrade
      expect(r.uid === null || r.uid !== 'doc-0000000000000000', f).toBe(true);
    }
    const demo = inspect(legacyFile('demo-0.8.5.slides.html'));
    expect(demo.legacy).toMatchObject({ deckBlock: 'top', deckBlocks: 1, defaultTheme: 'paper' });
    expect(demo.theme).toBe('paper');
    expect(inspect(legacyFile('plain-0.8.5.slides.html')).legacy).toMatchObject({ deckBlock: 'none' });
    expect(inspect(legacyFile('cli-theme/neon-0.8.5.slides.html')).theme).toBe('neon');
    // beside a text twin: upgrade --text x.browser.slides.md, then merge
    const beside = inspect(legacyFile('demo-0.8.5.slides.html'), { filename: 'demo.slides.html', twin: { name: 'demo.slides.md', content: 'my text\n' } });
    expect(beside.advice[0]).toMatch(/orz-slides upgrade demo\.slides\.html --text demo\.browser\.slides\.md.*merge.*orz-slides assemble demo\.slides\.md/);
  });

  it('[I.3] a text: input text, kind (the name, else the header\'s carrier, else slides — a plain x.md that is a deck counts as one), format, uid, title, slides (the corpus manifest\'s slideCount), sha256, lint with lines; a 0.x text (deck block) gets its legacy facts, the upgrade report and `upgrade` advice; the twin check', () => {
    for (const c of corpus('slides')) {
      const r = inspect(c.text, { filename: c.path.split('/').pop() });
      expect(r, c.path).toMatchObject({ input: 'text', kind: 'slides', format: 1, title: c.derivedTitle, sha256: sha256(c.text) });
      if (c.slideCount !== undefined) expect(r.slides, c.path).toBe(c.slideCount);
    }
    const zero = read(join(LEGACY_DIR, 'demo.md'));
    const z = inspect(zero, { filename: 'deck.md' });
    expect(z).toMatchObject({ input: 'text', kind: 'slides', legacy: { deckBlock: 'top', deckBlocks: 1 } });
    expect(z.lint.map((l) => [l.code, l.line])).toContainEqual(['deck-block', 1]);
    expect(z.upgrade!.unexplained).toEqual([]);
    expect(z.advice.join('\n')).toMatch(/an orz-slides 0\.x text: .*`orz-slides upgrade deck\.md` moves it into the header and writes deck\.slides\.md/);
    expect(inspect(zero, { filename: 'deck.slides.md' }).advice.join('\n')).toMatch(/`orz-slides upgrade deck\.slides\.md` moves it into the header \(in place; the old text is kept as a backup\)/);
    // a plain x.md: a deck by its markers, a document otherwise; a header's carrier decides
    expect(inspect('<!-- slide -->\n## a\n', { filename: 'a.md' }).kind).toBe('slides');
    expect(inspect('# just a page\n', { filename: 'a.md' }).kind).toBe('md');
    expect(inspect('{{nyml\nkind: document\ncarrier: paged\n}}\n\n# p\n', { filename: 'a.md' }).kind).toBe('paged');
    // no header: the default theme is shown; 0.x showed paper (a note)
    expect(inspect('<!-- slide -->\n## a\n', { filename: 'a.slides.md' }).notes.join('\n')).toMatch(/default theme \(orchard\).*0\.x deck showed paper/);
    // a newer format: read-only
    const newer = inspect('{{nyml\nkind: document\ncarrier: slides\nformat: 2\n}}\n\nx\n');
    expect(newer.writable).toBe(false);
    expect(newer.advice.join('\n')).toMatch(/newer than this tool/);
    // lint errors named in the advice, with lines in the report
    const bad = inspect('<!-- slide 2col -->\n## x\n<!-- @middle -->\ny\n', { filename: 'b.slides.md' });
    expect(bad.lint.find((l) => l.code === 'unknown-region')!.line).toBe(3);
    expect(bad.advice.join('\n')).toMatch(/fix the lint errors in the text \(unknown-region\)/);
    // the twin: same, different (with the merge advice), an earlier state, not orz
    const t = HAZARDS['crlf-header']!;
    expect(inspect(t, { filename: 'x.slides.md', twin: { name: 'x.slides.html', content: assemble(t, { delivery: 'cdn' }) } }).twin).toMatchObject({ holds: 'same' });
    const diff = inspect(t, { filename: 'x.slides.md', twin: { name: 'x.slides.html', content: assemble(`${t}more\n`, { delivery: 'cdn' }), newer: 'twin' } });
    expect(diff.twin).toMatchObject({ holds: 'different', newer: 'twin', sha256: sha256(storedText(`${t}more\n`)) });
    expect(diff.advice.join('\n')).toMatch(/orz-slides extract x\.slides\.html -o x\.browser\.slides\.md.*orz-slides assemble x\.slides\.md --replaces [0-9a-f]{64}/);
    const earlier = inspect(t, { filename: 'x.slides.md', twin: { name: 'x.slides.html', content: assemble(`${t}old\n`, { delivery: 'cdn' }), earlier: 'git-head' } });
    expect(earlier.twin!.earlier).toBe('git-head');
    expect(earlier.advice.join('\n')).toMatch(/earlier text of this text twin \(its last commit\).*no --force needed/);
    expect(inspect(t, { filename: 'x.slides.md', twin: { name: 'x.slides.html', content: '<!doctype html><p>x</p>' } }).twin!.holds).toBe('none');
  });

  it('[I.4] HTML that is no orz file, an empty .slides.html and an island of an unknown writer: input html, no document claimed', () => {
    expect(inspect('<!doctype html><title>x</title><p>hi</p>')).toMatchObject({ input: 'html', kind: null, sha256: null, writable: false });
    const empty = inspect('', { filename: 'e.slides.html' });
    expect(empty).toMatchObject({ input: 'html', kind: null });
    expect(empty.advice[0]).toMatch(/the file is empty \(no bytes\)/);
    const foreign = inspect('<!doctype html><script type="text/markdown" id="orz-src"># x\n</script>');
    expect(foreign).toMatchObject({ input: 'html', kind: null });
    expect(foreign.notes[0]).toMatch(/unknown writer/);
  });

  it('[I.5] the report is plain JSON data and deterministic', () => {
    const inputs = [legacyFile('demo-0.8.5.slides.html'), read(join(LEGACY_DIR, 'demo.md')), assemble(HAZARDS['bom-crlf']!), HAZARDS['deck-block']!, '<p>x</p>'];
    for (const i of inputs) {
      const a = inspect(i, { filename: 'x.slides.md' });
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      expect(inspect(i, { filename: 'x.slides.md' })).toEqual(a);
    }
  });

  it('[I.6] the upgrade report ships with the package (src/upgrade-report.ts with the frozen 0.8.5 parser in src/legacy/parser-0.8.5): `upgradeReport` and `reportNotes` are exported; a deck that differs from what 0.8.5 showed is named line by line, a registered decision as such', () => {
    const same = upgradeReport(read(join(LEGACY_DIR, 'demo.md')), upgradeText(read(join(LEGACY_DIR, 'demo.md')), { uid: 'doc-0000000000000000' }).text, '');
    expect(same).toEqual({ unexplained: [], accepted: [] });
    expect(reportNotes(same)).toEqual(['upgrade report: the upgraded deck shows what orz-slides 0.8.5 showed (slides, titles, regions, layouts, notes, footers, floats, slide options, theme)']);
    // a marker shown in indented code: 0.8.5 split there, 1.0 does not (D-47) — a registered decision
    const fence = '<!-- slide -->\n## Code\n\n    <!-- slide -->\n    indented code\n';
    const r = upgradeReport(fence, upgradeText(fence, { uid: 'doc-0000000000000000' }).text, '');
    expect(r.unexplained).toEqual([]);
    expect(r.accepted.join('\n')).toMatch(/^marker-in-code: /m);
    expect(reportNotes(r).join('\n')).toMatch(/^upgrade report: differs from 0\.8\.5 by a registered decision — marker-in-code: /m);
    // a hand-made difference is unexplained
    const wrong = upgradeReport('<!-- slide -->\n## A\n\nx\n', '{{nyml\nkind: document\ntheme: paper\n}}\n\n<!-- slide -->\n## B\n\nx\n', '');
    expect(wrong.unexplained.join('\n')).toMatch(/slide 1 title "A" -> "B"/);
    expect(reportNotes(wrong).join('\n')).toMatch(/^upgrade report: differs from what 0\.8\.5 showed — slide 1 title/m);
  });
});
