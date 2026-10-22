/**
 * Rebuild step 7 — the CLI (FC-10; claims V.1–V.12, I.8; orz-paged 1.0's
 * tests/cli.test.ts for the slides kind). Every test spawns the real CLI —
 * `dist/cli.js`, compiled by tests/global-setup.ts as `npm run build` does —
 * on files in a temporary folder, and compares what it wrote with the
 * library's own results: byte-exact round trips (CR LF, BOM), the 0.x
 * fixtures, `--json` that parses, exit statuses, reason codes, `next`
 * commands followed verbatim, and the overwrite guards. The pair records
 * live in a temporary `XDG_CACHE_HOME`, never the user's.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintHeader, readHeader, sha256, UID_PATTERN } from 'orz-markdown/carrier';
import { REASONS } from 'orz-markdown/carrier/node';
import {
  assemble, extract, extractLegacy, inspect, layoutAdvice, readDocument, readLegacy, upgrade, upgradeReport, upgradeText,
  DEFAULT_TEMPLATE, DEFAULT_THEME, ORZ_MARKDOWN_VERSION, TEMPLATES, THEMES, VERSION,
} from '../src/lib.js';
import { parseDeck } from '../src/deck/parse.js';
import { storedText } from '../src/assemble.js';
import { presentationOf } from '../src/presentation.js';
import { corpus, HAZARDS, LEGACY_DIR, LEGACY_FILES, read } from './helpers.js';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'orz-slides-cli-')));
/** The CLI's cache (the pair records) lives here, never in the user's ~/.cache. */
const CACHE = join(tmp, '.cache');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** A fresh folder for one scenario. */
const folder = (): string => { const d = join(tmp, `t${++n}`); mkdirSync(d); return d; };

interface Run { code: number; stdout: string; stderr: string }
/** Spawn the CLI (cwd = the given folder, so relative names are relative to it). */
function cli(args: string[], cwd: string = tmp, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: CACHE, ...env } }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      if (error && typeof error.code !== 'number') reject(error); else resolve({ code, stdout, stderr });
    });
  });
}
/** The CLI's raw stdout bytes. */
function cliBytes(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: CACHE } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
const json = (r: Run): Record<string, unknown> => JSON.parse(r.stdout) as Record<string, unknown>;
const bytes = (path: string): Buffer => readFileSync(path);
const text = (path: string): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(path));
const write = (path: string, s: string): void => writeFileSync(path, s, 'utf8');
const touch = (path: string, t: number): void => utimesSync(path, t, t);
const noTemp = (dir: string): void => { expect(readdirSync(dir).filter((f) => f.includes('.orz-') && f.endsWith('.tmp'))).toEqual([]); };
/** A 0.x fixture file's content. */
const legacyFile = (name: string): string => read(join(LEGACY_DIR, name));
/** A 0.x file that SHOWED `theme` first (its CLI `--theme`): the 0.8.5 plain fixture with another default theme. */
const legacyWithTheme = (theme: string): string => legacyFile('plain-0.8.5.slides.html').replace('"defaultTheme":"paper"', `"defaultTheme":"${theme}"`);
/** A format-1 slides text with (or without) a uid. */
let docs = 0;
const deckText = (title: string, uid = true): string => `{{nyml\nkind: document\ncarrier: slides\n${uid ? `uid: doc-cli${String(++docs).padStart(8, '0')}\n` : ''}title: ${title}\n}}\n\n<!-- slide -->\n## ${title}\n\n${title} body\n`;

/** A git runner for a folder (null when git is not installed). */
const gitIn = async (dir: string): Promise<((...args: string[]) => Promise<Run>) | null> => {
  const git = (...args: string[]): Promise<Run> => new Promise((res) => execFile('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir }, (e, stdout, stderr) => res({ code: e ? 1 : 0, stdout, stderr })));
  return (await git('init', '-q')).code === 0 ? git : null;
};

describe.concurrent('the CLI', () => {
  it('[V.1] assemble (and `orz-slides <file.slides.md>`, and a plain x.md) writes x.slides.html = the library\'s assemble of the exact text: inline by default, --cdn, -o, -o - ; the --json result', async () => {
    const d = folder();
    const samples: Array<[string, string]> = [
      ['crlf-bom', `﻿${deckText('CR LF and BOM').replace(/\n/g, '\r\n')}`],
      ['cr', HAZARDS['cr']!],
      ['script-close', HAZARDS['script-close']!],
      ['corpus', corpus('slides').find((c) => c.path.includes('every-layout'))!.text],
      ['starter', read('examples/starter.slides.md')],
    ];
    for (const [name, t] of samples) {
      write(join(d, `${name}.slides.md`), t);
      const r = await cli(['assemble', `${name}.slides.md`, '--json'], d);
      expect(r.code, r.stderr + r.stdout).toBe(0);
      const out = join(d, `${name}.slides.html`);
      expect(bytes(out).equals(Buffer.from(assemble(t), 'utf8')), name).toBe(true);
      expect(extract(text(out))!.text === t, name).toBe(true);
      const info = readDocument(t, { kind: 'slides' });
      const p = presentationOf(t);
      expect(json(r)).toEqual({ ok: true, command: 'assemble', input: join(d, `${name}.slides.md`), output: out, kind: 'slides', format: 1, shell: VERSION, delivery: 'inline', uid: info.meta.uid ?? null, title: info.title, theme: info.theme ?? null, themeEffective: p.theme.id, ratio: p.ratio, includes: 0, resolved: 0, unresolved: [], stale: [], backup: null, replaced: null, sha256: sha256(storedText(t)), bytes: Buffer.byteLength(assemble(t), 'utf8'), warnings: json(r).warnings });
      // the shorthand is the same command; --cdn
      rmSync(out);
      expect((await cli([`${name}.slides.md`], d)).code).toBe(0);
      expect(bytes(out).equals(Buffer.from(assemble(t), 'utf8'))).toBe(true);
      expect((await cli([`${name}.slides.md`, '--cdn'], d)).code).toBe(0);
      expect(text(out)).toBe(assemble(t, { delivery: 'cdn' }));
    }
    // the human lines
    const h = await cli(['assemble', 'cr.slides.md', '--inline'], d);
    expect(h.stdout).toBe(`Wrote ${join(d, 'cr.slides.html')} (inline, orz-slides ${VERSION})\n  sha256 ${sha256(storedText(HAZARDS['cr']!))} (of the text it holds: pass it as --replaces to replace this file later without --force)\n`);
    // -o elsewhere (folders created), and -o - to stdout
    expect((await cli(['assemble', 'crlf-bom.slides.md', '-o', 'pub/deck.slides.html'], d)).code).toBe(0);
    expect(text(join(d, 'pub/deck.slides.html')) === assemble(samples[0]![1])).toBe(true);
    const so = await cli(['assemble', 'cr.slides.md', '--cdn', '-o', '-'], d);
    expect(so.code).toBe(0);
    expect(so.stdout).toBe(assemble(HAZARDS['cr']!, { delivery: 'cdn' }));
    // a plain Markdown text (the 0.x habit, no deck block) assembles to x.slides.html
    write(join(d, 'plain.md'), '<!-- slide -->\n## Plain\n');
    const plain = await cli(['plain.md', '--json'], d);
    expect(plain.code, plain.stdout).toBe(0);
    expect(json(plain)).toMatchObject({ output: join(d, 'plain.slides.html'), kind: 'slides', themeEffective: DEFAULT_THEME });
    noTemp(d);
  }, 240_000);

  it('[V.2] new writes a lint-clean text twin from a deck template (carrier slides, a fresh uid, the given title, theme and ratio) and with --html its file; stdout without a file; refusals; --force keeps <file>~', async () => {
    const d = folder();
    const r = await cli(['new', 'talk.slides.md', '--template', 'talk', '--title', 'Buffers', '--theme', 'nocturne', '--ratio', '4:3', '--html', '--json'], d);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const t = text(join(d, 'talk.slides.md'));
    const h = readHeader(t)!;
    expect(t.split('\n').slice(0, 8)).toEqual(['{{nyml', 'kind: document', 'carrier: slides', `uid: ${h.fields['uid']}`, 'title: Buffers', 'theme: nocturne', 'ratio: 4:3', '}}']);
    expect(UID_PATTERN.test(h.fields['uid']!)).toBe(true);
    expect(readDocument(t).lint).toEqual([]);
    expect(text(join(d, 'talk.slides.html')) === assemble(t)).toBe(true);
    expect(json(r)).toEqual({ ok: true, command: 'new', file: join(d, 'talk.slides.md'), html: join(d, 'talk.slides.html'), kind: 'slides', format: 1, uid: h.fields['uid'], title: 'Buffers', theme: 'nocturne', themeEffective: 'nocturne', ratio: '4:3', template: 'talk', sha256: sha256(t), delivery: 'inline', shell: VERSION, backups: [], warnings: [] });
    // every template; the default one is the starter; a second text has another uid; --cdn for its file
    for (const tpl of TEMPLATES) {
      expect((await cli(['new', `tpl-${tpl.id}.slides.md`, '--template', tpl.id], d)).code, tpl.id).toBe(0);
      const tt = text(join(d, `tpl-${tpl.id}.slides.md`));
      expect(readDocument(tt).lint, tpl.id).toEqual([]);
      expect(lintHeader(tt, 'slides'), tpl.id).toEqual([]);
    }
    const two = await cli(['new', 'two.slides.md', '--html', '--cdn', '--json'], d);
    expect(json(two)).toMatchObject({ template: DEFAULT_TEMPLATE, theme: null, themeEffective: DEFAULT_THEME, ratio: '16:9', delivery: 'cdn' });
    const twoText = text(join(d, 'two.slides.md'));
    expect(readHeader(twoText)!.fields['uid']).not.toBe(h.fields['uid']);
    expect(parseDeck(twoText).slides.map((s) => s.template ?? s.layoutSpec)).toEqual(parseDeck(text(join(d, 'tpl-starter.slides.md'))).slides.map((s) => s.template ?? s.layoutSpec));
    expect(text(join(d, 'two.slides.html'))).toBe(assemble(twoText, { delivery: 'cdn' }));
    // no file: the text on stdout (and in --json)
    const s = await cli(['new', '--title', 'Out', '--template', 'minimal'], d);
    expect(s.code).toBe(0);
    expect(readHeader(s.stdout)!.fields['title']).toBe('Out');
    expect(parseDeck(s.stdout).slides).toHaveLength(2);
    expect((json(await cli(['new', '--json'], d)) as { file: unknown; text: string }).file).toBeNull();
    // refusals: an existing file (untouched, reason exists), a bad theme, template or ratio, another kind's name, no .slides.md, --html without a file
    const before = bytes(join(d, 'talk.slides.md'));
    const again = await cli(['new', 'talk.slides.md', '--json'], d);
    expect(again.code).toBe(1);
    expect(json(again)).toMatchObject({ ok: false, command: 'new', reason: 'exists' });
    expect(bytes(join(d, 'talk.slides.md')).equals(before)).toBe(true);
    const beforeHtml = bytes(join(d, 'talk.slides.html'));
    const forced = await cli(['new', 'talk.slides.md', '--html', '--force', '--json'], d);
    expect(forced.code, forced.stdout).toBe(0);
    expect(json(forced).backups).toEqual([join(d, 'talk.slides.md~'), join(d, 'talk.slides.html~')]);
    expect(bytes(join(d, 'talk.slides.md~')).equals(before)).toBe(true);
    expect(bytes(join(d, 'talk.slides.html~')).equals(beforeHtml)).toBe(true);
    const bad = await cli(['new', 'bad.slides.md', '--theme', 'executive'], d);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/unknown theme "executive".*themes: orchard, sky/);
    expect((await cli(['new', 'bad.slides.md', '--template', 'lecture'], d)).stderr).toMatch(/unknown template "lecture" \(starter, talk, minimal\); `orz-slides templates` describes them/);
    expect((await cli(['new', 'bad.slides.md', '--ratio', '21:9'], d)).stderr).toMatch(/unknown ratio "21:9"/);
    expect(existsSync(join(d, 'bad.slides.md'))).toBe(false);
    expect((await cli(['new', 'doc.paged.md'], d)).stderr).toMatch(/orz-paged/);
    const plain = await cli(['new', 'notes.md'], d);
    expect(plain.code).toBe(2);
    expect(plain.stderr).toMatch(/ends in \.slides\.md \(e\.g\. notes\.slides\.md\)/);
    expect((await cli(['new', '--html'], d)).code).toBe(2);
    noTemp(d);
  }, 240_000);

  it('[V.3] extract writes the exact text twin (CR LF + BOM, inline and cdn, -o, -o -); includes reported; an unknown writer and a cut-off file warn; a 0.x file is refused with next upgrade; an empty or foreign file is not-orz', async () => {
    const d = folder();
    expect((await cli(['new', 'doc.slides.md', '--title', 'Round trip'], d)).code).toBe(0);
    const crlf = `﻿${text(join(d, 'doc.slides.md')).replace(/\n/g, '\r\n')}`;
    write(join(d, 'doc.slides.md'), crlf);
    const original = bytes(join(d, 'doc.slides.md'));
    for (const delivery of [[], ['--cdn']]) {
      expect((await cli(['assemble', 'doc.slides.md', ...delivery], d)).code).toBe(0);
      rmSync(join(d, 'doc.slides.md'));
      const r = await cli(['extract', 'doc.slides.html', '--json'], d);
      expect(r.code, r.stdout).toBe(0);
      expect(bytes(join(d, 'doc.slides.md')).equals(original)).toBe(true);
      expect(json(r)).toMatchObject({ ok: true, command: 'extract', output: join(d, 'doc.slides.md'), kind: 'slides', format: 1, shell: VERSION, delivery: delivery.length ? 'cdn' : 'inline', title: 'Round trip', includes: 0, bytes: original.length, warnings: [], sha256: sha256(crlf) });
    }
    expect((await cli(['extract', 'doc.slides.html', '-o', 'copy.slides.md'], d)).code).toBe(0);
    expect(bytes(join(d, 'copy.slides.md')).equals(original)).toBe(true);
    expect((await cliBytes(['extract', 'doc.slides.html', '-o', '-'], d)).equals(original)).toBe(true);
    write(join(d, 'inc.slides.html'), assemble(HAZARDS['crlf-header']!, { includes: { './a.md': 'A\r\n' } }));
    expect(json(await cli(['extract', 'inc.slides.html', '--json'], d)).includes).toBe(1);
    expect(text(join(d, 'inc.slides.md')) === HAZARDS['crlf-header']).toBe(true);
    // a 0.x file: refused, next upgrade (with --text when the twin exists), nothing written
    for (const f of LEGACY_FILES) {
      write(join(d, f), legacyFile(f));
      const r = await cli(['extract', f, '--json'], d);
      expect(r.code, f).toBe(1);
      expect(json(r), f).toMatchObject({ reason: 'legacy-file', next: { command: 'upgrade', args: [f] } });
      expect(existsSync(join(d, f.replace(/\.html$/, '.md')))).toBe(false);
    }
    // following the next verbatim: the file upgraded, its format-1 text written beside it
    const follow = json(await cli(['extract', LEGACY_FILES[0]!, '--json'], d)).next as { command: string; args: string[] };
    expect((await cli([follow.command, ...follow.args], d)).code).toBe(0);
    expect(extract(text(join(d, LEGACY_FILES[0]!)))!.text).toBe(text(join(d, LEGACY_FILES[0]!.replace(/\.html$/, '.md'))));
    write(join(d, 'old.slides.md'), 'my text\n');
    write(join(d, 'old.slides.html'), legacyFile('demo-0.8.5.slides.html'));
    expect(json(await cli(['extract', 'old.slides.html', '--json'], d))).toMatchObject({ reason: 'legacy-file', next: { command: 'upgrade', args: ['old.slides.html', '--text', 'old.browser.slides.md'] } });
    // an island without #orz-shell: extracted with a warning; a cut-off file: extracted with a warning
    write(join(d, 'foreign.slides.html'), '<!doctype html><html><body><script type="text/markdown" id="orz-src"><!-- slide -->\n## foreign\n</script></body></html>');
    const foreign = await cli(['extract', 'foreign.slides.html', '--json'], d);
    expect(foreign.code).toBe(0);
    expect((json(foreign).warnings as string[]).join('\n')).toMatch(/no #orz-shell: an unknown writer/);
    const whole = assemble('<!-- slide -->\n## Cut\n\nfirst part\n\nsecond part\n', { delivery: 'cdn' });
    write(join(d, 'cut.slides.html'), whole.slice(0, whole.indexOf('second part') + 6));
    const cut = await cli(['extract', 'cut.slides.html', '--json'], d);
    expect(cut.code).toBe(0);
    expect((json(cut).warnings as string[]).join('\n')).toMatch(/cut off.*may be incomplete/);
    write(join(d, 'empty.slides.html'), '');
    expect(json(await cli(['extract', 'empty.slides.html', '--json'], d))).toMatchObject({ reason: 'not-orz' });
    expect(String(json(await cli(['extract', 'empty.slides.html', '--json'], d)).error)).toMatch(/is empty \(0 bytes\)/);
    write(join(d, 'page.slides.html'), '<!doctype html><title>x</title><p>hello</p>');
    expect(json(await cli(['extract', 'page.slides.html', '--json'], d))).toMatchObject({ reason: 'not-orz', next: { command: 'inspect', args: ['page.slides.html'] } });
    expect((await cli(['inspect', 'page.slides.html'], d)).stdout).toMatch(/^input\s+HTML that is not an orz document$/m);
    noTemp(d);
  }, 240_000);

  it('[V.4] upgrade writes a 0.x file\'s new file in place and its text twin (= the library\'s upgrade), keeps its delivery, carries the upgrade report and notes, writes the theme 0.x SHOWED (dropped themes mapped: executive → sky, poppy → sticker, sage → orchard; none → paper); re-assembles an older format-1 shell; refuses a different existing twin', async () => {
    const d = folder();
    const all = [...LEGACY_FILES.map((f) => [f, legacyFile(f)] as const), ['neon-0.8.5.slides.html', read(join(LEGACY_DIR, 'cli-theme', 'neon-0.8.5.slides.html'))] as const];
    for (const [name, old] of all) {
      const base = `up-${name.replace(/\.slides\.html$/, '').replace(/\W+/g, '-')}`;
      const file = join(d, `${base}.slides.html`);
      write(file, old);
      const r = await cli(['upgrade', `${base}.slides.html`, '--json'], d);
      expect(r.code, `${name}: ${r.stdout}`).toBe(0);
      const j = json(r);
      const twin = text(join(d, `${base}.slides.md`));
      const lib = upgrade(old, { uid: j.uid as string, delivery: j.delivery as 'inline' | 'cdn' });
      expect(twin === lib.text, name).toBe(true);
      expect(text(file) === lib.html, name).toBe(true);
      const legacy = readLegacy(old)!;
      const report = upgradeReport(legacy.text, twin, legacy.defaultTheme ?? '');
      expect(report.unexplained, name).toEqual([]);
      expect(j, name).toMatchObject({ ok: true, command: 'upgrade', input: file, output: file, text: join(d, `${base}.slides.md`), from: 'legacy', previous: legacy.version, shell: VERSION, moved: lib.moved, report, slides: parseDeck(twin).slides.length, sha256: sha256(lib.text) });
      expect((j.notes as string[]).slice(0, lib.notes.length)).toEqual(lib.notes);
      expect((j.notes as string[]).some((x) => x.startsWith('upgrade report: '))).toBe(true);
      // the conversion notes are notes, not warnings (D-75)
      expect((j.warnings as string[]).filter((w) => (j.notes as string[]).includes(w))).toEqual([]);
      expect(j.delivery).toBe(legacy.delivery ?? 'inline');
      // twice: a format-1 file of this shell, the text unchanged, no report
      const again = await cli(['upgrade', `${base}.slides.html`, '--inline', '--json'], d);
      expect(again.code, again.stdout).toBe(0);
      expect(json(again)).toMatchObject({ from: 'format-1', report: null, notes: [] });
      expect(text(file) === assemble(twin)).toBe(true);
    }
    // the theme 0.x showed: the file's own (its --theme), the dropped ones mapped, none → paper
    for (const [shown, written] of [['executive', 'sky'], ['poppy', 'sticker'], ['sage', 'orchard'], ['neon', 'neon'], ['paper', 'paper']] as const) {
      write(join(d, `t-${shown}.slides.html`), legacyWithTheme(shown));
      const j = json(await cli(['upgrade', `t-${shown}.slides.html`, '--json'], d));
      expect(j.theme, shown).toBe(written);
      expect(readHeader(text(join(d, `t-${shown}.slides.md`)))!.fields['theme'], shown).toBe(written);
      expect((j.report as { unexplained: string[] }).unexplained, shown).toEqual([]);
      if (shown !== written) expect((j.notes as string[]).join('\n')).toMatch(new RegExp(`the 0\\.x theme ${shown} was dropped in 1\\.0; its successor ${written} is written`));
    }
    write(join(d, 'implicit.slides.html'), legacyFile('plain-0.8.5.slides.html').replace(/"defaultTheme":"paper",?/, ''));
    expect(json(await cli(['upgrade', 'implicit.slides.html', '--json'], d)).theme).toBe('paper');
    // the human output: notes as notes (stdout, D-75: not warnings), the report's summary among them
    write(join(d, 'h.slides.html'), legacyWithTheme('executive'));
    const human = await cli(['upgrade', 'h.slides.html'], d);
    expect(human.stdout).toMatch(/\n  note: upgrade report: the upgraded deck shows what orz-slides 0\.8\.5 showed/);
    expect(human.stderr).not.toMatch(/warning: upgrade report/);
    expect(human.stdout).toMatch(/Upgraded .*h\.slides\.html \(from orz-slides 0\.8\.5 to .*\)\nWrote .*h\.slides\.md \(the text twin\)\nMoved into the header: carrier: slides; uid: doc-[0-9a-z]+; theme: sky/);
    // an older format-1 shell is re-assembled with this one (text and includes unchanged)
    const t = HAZARDS['bom-crlf']!;
    const older = assemble(t, { delivery: 'cdn', includes: { './x.md': 'X\n' } }).split(`"shell":"${VERSION}"`).join('"shell":"0.0.1"');
    expect(extract(older)!.shell).toBe('0.0.1');
    write(join(d, 'older.slides.html'), older);
    const o = await cli(['upgrade', 'older.slides.html', '-o', 'newer.slides.html', '--text', 'newer-text.slides.md', '--json'], d);
    expect(o.code, o.stdout).toBe(0);
    expect(json(o)).toMatchObject({ from: 'format-1', previous: '0.0.1', delivery: 'cdn', report: null });
    expect(text(join(d, 'newer.slides.html'))).toBe(assemble(t, { delivery: 'cdn', includes: { './x.md': 'X\n' } }));
    expect(text(join(d, 'newer-text.slides.md')) === t).toBe(true);
    expect(text(join(d, 'older.slides.html'))).toBe(older);
    // an existing, different text twin: refused before anything is written; --no-text upgrades the file only
    const legacy = legacyFile('demo-0.8.5.slides.html');
    write(join(d, 'kept.slides.html'), legacy);
    write(join(d, 'kept.slides.md'), '<!-- slide -->\n## my own newer text\n');
    const refused = await cli(['upgrade', 'kept.slides.html', '--json'], d);
    expect(refused.code).toBe(1);
    expect(json(refused)).toMatchObject({ reason: 'twin-differs', next: { command: 'upgrade', args: ['kept.slides.html', '--text', 'kept.browser.slides.md'] } });
    expect(text(join(d, 'kept.slides.html'))).toBe(legacy);
    expect((await cli(['upgrade', 'kept.slides.html', '--no-text'], d)).code).toBe(0);
    expect(text(join(d, 'kept.slides.md'))).toBe('<!-- slide -->\n## my own newer text\n');
    expect(inspect(text(join(d, 'kept.slides.html'))).input).toBe('assembled');
    write(join(d, 'plain.html'), '<!doctype html><p>x</p>');
    expect(json(await cli(['upgrade', 'plain.html', '--no-text', '--json'], d))).toMatchObject({ ok: false, reason: 'not-orz' });
    noTemp(d);
  }, 300_000);

  it('[V.5] upgrade of a 0.x TEXT: deck.md → deck.slides.md (the library\'s upgradeText, with the report), a .slides.md in place keeping <file>~, a format-1 text is left alone; an existing different output is output-differs with next; assemble then works', async () => {
    const d = folder();
    const src = read(join(LEGACY_DIR, 'demo.md'));
    write(join(d, 'deck.md'), src);
    const r = await cli(['upgrade', 'deck.md', '--json'], d);
    expect(r.code, r.stdout).toBe(0);
    const j = json(r);
    const out = text(join(d, 'deck.slides.md'));
    const lib = upgradeText(src, { uid: j.uid as string });
    expect(out).toBe(lib.text);
    expect(text(join(d, 'deck.md'))).toBe(src); // the 0.x source is left alone
    const report = upgradeReport(src, out, '');
    expect(report.unexplained).toEqual([]);
    expect(j).toMatchObject({ ok: true, command: 'upgrade', input: join(d, 'deck.md'), output: null, text: join(d, 'deck.slides.md'), from: 'text', changed: true, written: true, moved: lib.moved, report, backups: [], sha256: sha256(out) });
    expect(readHeader(out)!.fields).toMatchObject({ carrier: 'slides', title: 'orz-slides — demo', theme: 'paper' });
    expect(readDocument(out).lint.filter((l) => l.level === 'error')).toEqual([]);
    // the same again: the output already holds that text — nothing written
    const same = json(await cli(['upgrade', 'deck.md', '--json'], d));
    expect(same).toMatchObject({ ok: true, written: false });
    // an edited output: output-differs, next upgrade -o a free name; following it works
    write(join(d, 'deck.slides.md'), `${out}\n<!-- slide -->\n## edited\n`);
    const refused = json(await cli(['upgrade', 'deck.md', '--json'], d));
    expect(refused).toMatchObject({ ok: false, reason: 'output-differs', next: { command: 'upgrade', args: ['deck.md', '-o', 'deck.browser.slides.md'] } });
    expect((await cli(['upgrade', 'deck.md', '-o', 'deck.browser.slides.md'], d)).code).toBe(0);
    expect(text(join(d, 'deck.slides.md'))).toMatch(/## edited/);
    // a .slides.md holding a deck block: upgraded in place, the old text kept as <file>~
    write(join(d, 'inplace.slides.md'), src);
    const ip = json(await cli(['upgrade', 'inplace.slides.md', '--json'], d));
    expect(ip).toMatchObject({ ok: true, text: join(d, 'inplace.slides.md'), changed: true, backups: [join(d, 'inplace.slides.md~')] });
    expect(text(join(d, 'inplace.slides.md~'))).toBe(src);
    // a format-1 text with no deck block: nothing to upgrade, nothing written, no backup
    const f1 = deckText('Already');
    write(join(d, 'f1.slides.md'), f1);
    const nothing = await cli(['upgrade', 'f1.slides.md', '--json'], d);
    expect(json(nothing)).toMatchObject({ ok: true, changed: false, written: false, backups: [], report: null });
    expect(existsSync(join(d, 'f1.slides.md~'))).toBe(false);
    expect((await cli(['upgrade', 'f1.slides.md'], d)).stdout).toMatch(/already an orz-slides 1\.0 text: nothing to upgrade/);
    // a format-1 text WITH a stray deck block: the header's keys win, the block's missing keys move in
    write(join(d, 'stray.slides.md'), `{{nyml\nkind: document\ncarrier: slides\nuid: doc-strayblock01\ntheme: copper\n}}\n\n<!-- deck\ntheme: neon\nfooter: from the block\n-->\n\n<!-- slide -->\n## S\n`);
    expect((await cli(['upgrade', 'stray.slides.md'], d)).code).toBe(0);
    expect(readHeader(text(join(d, 'stray.slides.md')))!.fields).toMatchObject({ theme: 'copper', footer: 'from the block' });
    // file-only options are usage errors for a text; another kind is refused
    expect((await cli(['upgrade', 'deck.md', '--no-text'], d)).code).toBe(2);
    write(join(d, 'web.md'), '{{nyml\nkind: document\ncarrier: md\n}}\n\n# web\n');
    expect(json(await cli(['upgrade', 'web.md', '--json'], d))).toMatchObject({ reason: 'other-kind' });
    // then assemble works (the text is lint-clean)
    const a = await cli(['assemble', 'deck.slides.md', '--json'], d);
    expect(a.code, a.stdout).toBe(0);
    noTemp(d);
  }, 240_000);

  it('[V.6] inspect is human-readable by default and --json prints the library\'s inspect report (0.x files and texts, assembled decks, texts, another kind, plain HTML)', async () => {
    const d = folder();
    const files: Array<[string, string]> = [
      ...LEGACY_FILES.map((f) => [`legacy-${f}`, legacyFile(f)] as [string, string]),
      ['assembled.slides.html', assemble(HAZARDS['crlf-header']!, { delivery: 'cdn', includes: { './a.md': 'A\n' } })],
      ['inline.slides.html', assemble(read('examples/starter.slides.md'))],
      ['twin.slides.md', HAZARDS['crlf-header']!],
      ['zero-x.md', read(join(LEGACY_DIR, 'demo.md'))],
      ['doc.paged.md', '# a page\n'],
      ['page.html', '<!doctype html><title>x</title>'],
    ];
    for (const [name, content] of files) {
      write(join(d, name), content);
      const r = await cli(['inspect', name, '--json'], d);
      expect(r.code, name).toBe(0);
      expect(json(r), name).toEqual(JSON.parse(JSON.stringify(inspect(content, { filename: name }))));
      const h = await cli(['inspect', name], d);
      expect(h.code).toBe(0);
      expect(h.stdout).toMatch(new RegExp(`^file\\s+${name.replace(/\./g, '\\.')}\\ninput\\s+`));
    }
    const legacyHuman = (await cli(['inspect', 'legacy-demo-0.8.5.slides.html'], d)).stdout;
    expect(legacyHuman).toMatch(/^legacy\s+orz-slides 0\.8\.5, cdn delivery, shown with theme paper; deck block first in the source \(0\.x read it\)$/m);
    expect(legacyHuman).toMatch(/^upgrade\s+shows what 0\.8\.5 showed$/m);
    expect(legacyHuman).toMatch(/advice:\n {2}- orz-slides 0\.8\.5 file .*`orz-slides upgrade legacy-demo-0\.8\.5\.slides\.html`/);
    const inline = (await cli(['inspect', 'inline.slides.html'], d)).stdout;
    expect(inline).toMatch(/^structure\s+complete, this release's engine$/m);
    expect(inline).toMatch(/^slides\s+11$/m);
    const zero = (await cli(['inspect', 'zero-x.md'], d)).stdout;
    expect(zero).toMatch(/^legacy\s+a <!-- deck --> block first in the source/m);
    expect(zero).toMatch(/`orz-slides upgrade zero-x\.md` moves it into the header and writes zero-x\.slides\.md/);
  }, 240_000);

  it('[V.7] every command answers --help, -h and help <command>; --version (and --json); themes lists the 14 with a line each and marks the default; templates; failures exit 1 or 2 with one JSON object; assemble has no content options (D-07)', async () => {
    const d = folder();
    await Promise.all(['new', 'assemble', 'extract', 'upgrade', 'inspect', 'themes', 'templates'].flatMap((c) => [[c, '--help'], [c, '-h'], ['help', c]].map(async (args) => {
      const r = await cli(args, d);
      expect(r.code, args.join(' ')).toBe(0);
      expect(r.stdout.startsWith(`orz-slides ${c} `), args.join(' ')).toBe(true);
    })));
    const help = await cli(['--help'], d);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^orz-slides .* — slide decks written in Markdown/);
    for (const c of ['new', 'assemble', 'extract', 'upgrade', 'inspect', 'themes', 'templates']) expect(help.stdout).toContain(`  orz-slides ${c}`);
    expect(help.stdout).toContain('Exit status: 0 done, 1 refused or failed, 2 usage error.');
    const none = await cli([], d);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('Usage:');
    expect((await cli(['--version'], d)).stdout).toBe(`orz-slides ${VERSION} (orz-markdown ${ORZ_MARKDOWN_VERSION}, text format 1)\n`);
    expect(json(await cli(['--version', '--json'], d))).toEqual({ name: 'orz-slides', version: VERSION, orzMarkdown: ORZ_MARKDOWN_VERSION, formats: [1] });
    const themes = json(await cli(['themes', '--json'], d)).themes as Array<{ id: string; default: boolean }>;
    expect(themes).toEqual(THEMES.map((t) => ({ id: t.id, name: t.name, scheme: t.scheme, description: t.description, alias: t.derivedFrom, default: t.id === DEFAULT_THEME })));
    expect(themes).toHaveLength(14);
    expect(themes.filter((t) => t.default).map((t) => t.id)).toEqual(['orchard']);
    const tl = (await cli(['themes'], d)).stdout.trimEnd().split('\n');
    expect(tl).toHaveLength(14);
    expect(tl[0]).toMatch(/^orchard +light +\S.*\[default\]$/);
    for (const t of THEMES) expect(tl.some((l) => l.startsWith(`${t.id} `) && l.includes(t.description))).toBe(true);
    const templates = json(await cli(['templates', '--json'], d)).templates as Array<{ id: string; default: boolean }>;
    expect(templates).toEqual(TEMPLATES.map((t) => ({ ...t, default: t.id === DEFAULT_TEMPLATE })));
    expect((await cli(['templates'], d)).stdout).toMatch(/^starter {2}a tour of every kind of slide.*\[default\]$/m);
    // failures: 1 (missing, non-UTF-8), 2 (usage); --json gives {ok: false} on stdout
    const missing = await cli(['assemble', 'nope.slides.md', '--json'], d);
    expect(missing.code).toBe(1);
    expect(json(missing)).toEqual({ ok: false, command: 'assemble', error: `${join(d, 'nope.slides.md')}: no such file`, reason: 'no-such-file', exitCode: 1 });
    writeFileSync(join(d, 'bad-utf8.slides.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    expect((await cli(['assemble', 'bad-utf8.slides.md'], d)).stderr).toMatch(/not valid UTF-8/);
    write(join(d, 'doc.slides.md'), deckText('Doc'));
    for (const args of [['assemble', 'doc.slides.md', '--frobnicate'], ['assemble', 'doc.slides.md', 'other.slides.md'], ['assemble', 'doc.slides.md', '--cdn', '--inline'], ['assemble', 'doc.slides.md', '-o'], ['inspect', 'doc.slides.md', '--offline'], ['themes', 'x']]) {
      const r = await cli([...args, '--json'], d);
      expect(r.code, args.join(' ')).toBe(2);
      expect(json(r), args.join(' ')).toMatchObject({ ok: false, reason: 'bad-usage', exitCode: 2 });
    }
    // content options are gone from assemble (D-07): a clear message, exit 2, nothing written
    for (const [flag, value] of [['--theme', 'neon'], ['--title', 'T'], ['--ratio', '4:3'], ['--footer', 'F']]) {
      for (const args of [['assemble', 'doc.slides.md', flag!, value!], ['doc.slides.md', flag!, value!]]) {
        const r = await cli(args, d);
        expect(r.code, args.join(' ')).toBe(2);
        expect(r.stderr).toContain(`${flag} is not an assemble option`);
        expect(r.stderr).toMatch(/header/);
        expect(existsSync(join(d, 'doc.slides.html'))).toBe(false);
      }
    }
    expect((await cli(['doc.slides.md', '--template', 'talk'], d)).stderr).toMatch(/--template is not an assemble option: a deck template starts a NEW text — `orz-slides new <file\.slides\.md> --template <id>`/);
    // an assembled file given to assemble; another kind by name or by header; no nameable output; a newer format
    expect((await cli(['assemble', 'doc.slides.md'], d)).code).toBe(0);
    expect((await cli(['assemble', 'doc.slides.html'], d)).stderr).toMatch(/is an assembled file.*extract/);
    write(join(d, 'doc.paged.md'), '# p\n');
    expect((await cli(['assemble', 'doc.paged.md'], d)).stderr).toMatch(/orz-paged/);
    write(join(d, 'web.md'), '{{nyml\nkind: document\ncarrier: md\n}}\n\n# Web\n');
    expect(String(json(await cli(['web.md', '--json'], d)).error)).toMatch(/carrier: md; use orz-mdhtml/);
    write(join(d, 'noext'), '<!-- slide -->\n## x\n');
    expect((await cli(['assemble', 'noext'], d)).code).toBe(2);
    expect((await cli(['assemble', 'noext', '-o', 'noext.slides.html'], d)).code).toBe(0);
    write(join(d, 'newer.slides.md'), '{{nyml\nkind: document\nformat: 2\n}}\n\nx\n');
    expect(json(await cli(['assemble', 'newer.slides.md', '--json'], d))).toMatchObject({ reason: 'newer-format' });
    // lints are reported as warnings with their lines; the file is still written
    write(join(d, 'lint.slides.md'), '{{nyml\nkind: document\ntheme: no-such-theme\n}}\n\n<!-- slide 2col -->\n## L\n<!-- @middle -->\nx\n');
    const lint = await cli(['assemble', 'lint.slides.md', '--json'], d);
    expect(lint.code).toBe(0);
    expect(json(lint).warnings).toEqual([expect.stringMatching(/^lint error \(the deck may not show what the text says until it is fixed\): slide 1: the layout has no region "middle" .*\(unknown-region, line 8\)$/), expect.stringMatching(/\(unknown-theme, line 3\)$/)]);
  }, 240_000);

  it('[V.8] nothing is overwritten that could lose work unless --force (which keeps <file>~): a non-orz output, a .slides.html holding a different text (the browser\'s work) — extract -o x.browser.slides.md, merge, assemble; known states: the pair record, git, --replaces', async () => {
    const d = folder();
    write(join(d, 'a.slides.md'), deckText('A'));
    write(join(d, 'a.slides.html'), '<!doctype html><p>someone else\'s page</p>');
    const r1 = await cli(['assemble', 'a.slides.md', '--json'], d);
    expect(json(r1)).toMatchObject({ ok: false, reason: 'not-orz' });
    expect(text(join(d, 'a.slides.html'))).toMatch(/someone else/);
    const f1 = await cli(['assemble', 'a.slides.md', '--force', '--json'], d);
    expect(json(f1)).toMatchObject({ ok: true, backup: join(d, 'a.slides.html~') });
    expect(text(join(d, 'a.slides.html~'))).toMatch(/someone else/);
    // the agent workflow: new --html; a browser save adds a slide; the agent edits the text (newer); assemble refuses
    const w = folder();
    expect((await cli(['new', 'doc.slides.md', '--html', '--template', 'minimal'], w)).code).toBe(0);
    const made = text(join(w, 'doc.slides.md'));
    write(join(w, 'doc.slides.html'), assemble(`${made}\n<!-- slide -->\n## BROWSER WORK\n`));
    touch(join(w, 'doc.slides.html'), 1_700_000_100);
    write(join(w, 'doc.slides.md'), `${made}\n<!-- slide -->\n## agent slide\n`);
    touch(join(w, 'doc.slides.md'), 1_700_000_200);
    const insp = json(await cli(['inspect', 'doc.slides.md', '--json'], w));
    expect(insp.twin).toMatchObject({ name: 'doc.slides.html', holds: 'different', newer: 'input' });
    expect((insp.advice as string[]).join('\n')).toMatch(/orz-slides extract doc\.slides\.html -o doc\.browser\.slides\.md/);
    const refused = json(await cli(['assemble', 'doc.slides.md', '--json'], w));
    expect(refused).toMatchObject({ ok: false, reason: 'twin-differs', next: { command: 'extract', args: ['doc.slides.html', '-o', 'doc.browser.slides.md'] } });
    expect((await cli(['extract', 'doc.slides.html', '-o', 'doc.browser.slides.md'], w)).code).toBe(0);
    const merged = `${made}\n<!-- slide -->\n## BROWSER WORK\n\n<!-- slide -->\n## agent slide\n`;
    write(join(w, 'doc.slides.md'), merged);
    // the hash of what the file holds (the refusal names it) replaces it without --force
    const held = extract(text(join(w, 'doc.slides.html')))!.text;
    const swapped = json(await cli(['assemble', 'doc.slides.md', '--replaces', sha256(held), '--json'], w));
    expect(swapped).toMatchObject({ ok: true, replaced: 'token', backup: null });
    expect(extract(text(join(w, 'doc.slides.html')))!.text).toBe(merged);
    // a wrong token is refused, nothing written
    write(join(w, 'doc.slides.md'), `${merged}x\n`);
    expect(json(await cli(['assemble', 'doc.slides.md', '--replaces', sha256('other'), '--json'], w))).toMatchObject({ ok: false, reason: 'replaces-mismatch' });
    expect(json(await cli(['assemble', 'doc.slides.md', '--replaces', 'abc', '--json'], w))).toMatchObject({ ok: false, reason: 'bad-usage' });
    // the pair record: the normal loop (edit, assemble) needs no --force
    expect(json(await cli(['assemble', 'doc.slides.md', '--json'], w))).toMatchObject({ ok: true, replaced: 'cache' });
    // a different twin that extract would replace: refused unless it is a known state
    write(join(w, 'doc.slides.md'), `${text(join(w, 'doc.slides.md'))}my edit\n`);
    expect(json(await cli(['extract', 'doc.slides.html', '--json'], w))).toMatchObject({ ok: false, reason: 'twin-differs', next: { command: 'extract', args: ['doc.slides.html', '-o', 'doc.browser-2.slides.md'] } });
    // git: a committed twin's earlier text in the file is replaced without --force (no cache)
    const g = folder();
    const git = await gitIn(g);
    if (git) {
      const env = { XDG_CACHE_HOME: join(g, '.no-cache') };
      write(join(g, 'x.slides.md'), deckText('X'));
      expect((await git('add', 'x.slides.md')).code).toBe(0);
      expect((await git('commit', '-q', '-m', 'one')).code).toBe(0);
      write(join(g, 'x.slides.html'), assemble(text(join(g, 'x.slides.md'))));
      write(join(g, 'x.slides.md'), `${text(join(g, 'x.slides.md'))}\nedited\n`);
      const viaGit = await cli(['assemble', 'x.slides.md', '--json'], g, env);
      expect(json(viaGit)).toMatchObject({ ok: true, replaced: 'git-head', backup: null });
    }
    noTemp(d);
    noTemp(w);
  }, 240_000);

  it('[V.9] neither upgrade nor assemble downgrades: a newer shell is newer-shell (--force keeps <file>~); upgrade refuses a file cut off inside its island (unclosed-island, next extract -o x.recovered.slides.md)', async () => {
    const d = folder();
    const t = deckText('N');
    const newer = assemble(t).split(`"shell":"${VERSION}"`).join('"shell":"99.0.0"');
    write(join(d, 'n.slides.html'), newer);
    write(join(d, 'n.slides.md'), t);
    expect(json(await cli(['upgrade', 'n.slides.html', '--json'], d))).toMatchObject({ ok: false, reason: 'newer-shell' });
    expect(json(await cli(['assemble', 'n.slides.md', '--json'], d))).toMatchObject({ ok: false, reason: 'newer-shell' });
    expect(text(join(d, 'n.slides.html'))).toBe(newer);
    const forced = json(await cli(['assemble', 'n.slides.md', '--force', '--json'], d));
    expect(forced).toMatchObject({ ok: true, backup: join(d, 'n.slides.html~') });
    expect(text(join(d, 'n.slides.html~'))).toBe(newer);
    const whole = assemble(deckText('Cut'), { delivery: 'cdn' });
    write(join(d, 'cut.slides.html'), whole.slice(0, whole.indexOf('Cut body')));
    expect(json(await cli(['upgrade', 'cut.slides.html', '--json'], d))).toMatchObject({ ok: false, reason: 'unclosed-island', next: { command: 'extract', args: ['cut.slides.html', '-o', 'cut.recovered.slides.md'] } });
    expect((await cli(['extract', 'cut.slides.html', '-o', 'cut.recovered.slides.md'], d)).code).toBe(0);
  }, 240_000);

  it('[V.10] machine-readable refusals: every --json failure is { ok: false, command, error, reason, next?, exitCode } with a reason from the family\'s list and, where a command resolves it, next: { command, args } — never --force', async () => {
    const d = folder();
    const seen = new Set<string>();
    /** `next`: the expected one; undefined: none; 'any': whichever the kit names (never --force). */
    const fail = async (args: string[], reason: string, next?: { command: string; args: string[] } | 'any', env: NodeJS.ProcessEnv = {}): Promise<void> => {
      const r = await cli([...args, '--json'], d, env);
      expect(r.code, args.join(' ')).toBe(reason === 'bad-usage' ? 2 : 1);
      const j = json(r);
      const keys = ['command', 'error', 'exitCode', 'ok', 'reason'];
      expect(Object.keys(j).filter((k) => k !== 'next').sort(), args.join(' ')).toEqual(keys);
      expect(j, args.join(' ')).toMatchObject({ ok: false, command: args[0] === 'deck.md' ? 'assemble' : args[0], reason, exitCode: r.code });
      expect(REASONS).toContain(j.reason);
      if (next === undefined) expect(j, args.join(' ')).not.toHaveProperty('next');
      else if (next !== 'any') expect(j.next, args.join(' ')).toEqual(next);
      if (j.next) expect((j.next as { args: string[] }).args).not.toContain('--force');
      seen.add(reason);
    };
    write(join(d, 'doc.slides.md'), deckText('Doc'));
    await fail(['assemble', 'doc.slides.md', '--frobnicate'], 'bad-usage');
    await fail(['assemble', 'nope.slides.md'], 'no-such-file');
    mkdirSync(join(d, 'folder.slides.md'));
    await fail(['assemble', 'folder.slides.md'], 'unreadable');
    writeFileSync(join(d, 'bad.slides.md'), Buffer.from([0x23, 0xff, 0x0a]));
    await fail(['assemble', 'bad.slides.md'], 'not-utf8');
    await fail(['new', 'doc.slides.md'], 'exists');
    write(join(d, 'doc.slides.html'), '<!doctype html><p>a page</p>');
    await fail(['assemble', 'doc.slides.md'], 'not-orz');
    await fail(['extract', 'doc.slides.html'], 'not-orz', { command: 'inspect', args: ['doc.slides.html'] });
    rmSync(join(d, 'doc.slides.html'));
    write(join(d, 'other.slides.html'), assemble(deckText('Another')));
    await fail(['assemble', 'doc.slides.md', '-o', 'other.slides.html'], 'output-differs', 'any');
    expect((await cli(['assemble', 'doc.slides.md'], d)).code).toBe(0);
    await fail(['assemble', 'doc.slides.html'], 'assembled-input', { command: 'extract', args: ['doc.slides.html'] });
    write(join(d, 'doc.slides.html'), assemble(`${text(join(d, 'doc.slides.md'))}browser\n`));
    write(join(d, 'doc.slides.md'), `${text(join(d, 'doc.slides.md'))}agent\n`);
    await fail(['assemble', 'doc.slides.md'], 'twin-differs', { command: 'extract', args: ['doc.slides.html', '-o', 'doc.browser.slides.md'] });
    await fail(['assemble', 'doc.slides.md', '--replaces', sha256('x')], 'replaces-mismatch', 'any');
    write(join(d, 'p.paged.md'), '# p\n');
    await fail(['assemble', 'p.paged.md'], 'other-kind');
    write(join(d, 'newer.slides.md'), '{{nyml\nkind: document\nformat: 2\n}}\n\nx\n');
    await fail(['assemble', 'newer.slides.md'], 'newer-format');
    // 0.x: a file (extract → upgrade), a text over a 0.x file, a 0.x TEXT (assemble → upgrade it)
    write(join(d, 'old.slides.html'), legacyFile('demo-0.8.5.slides.html'));
    await fail(['extract', 'old.slides.html'], 'legacy-file', { command: 'upgrade', args: ['old.slides.html'] });
    write(join(d, 'old.slides.md'), '<!-- slide -->\n## my 0.x text, edited\n');
    await fail(['assemble', 'old.slides.md'], 'legacy-file', { command: 'upgrade', args: ['old.slides.html', '--text', 'old.browser.slides.md'] });
    await fail(['upgrade', 'old.slides.html'], 'twin-differs', { command: 'upgrade', args: ['old.slides.html', '--text', 'old.browser.slides.md'] });
    write(join(d, 'deck.md'), read(join(LEGACY_DIR, 'demo.md')));
    await fail(['assemble', 'deck.md'], 'legacy-file', { command: 'upgrade', args: ['deck.md'] });
    await fail(['deck.md', '--cdn'], 'legacy-file', { command: 'upgrade', args: ['deck.md'] });
    const t = deckText('N');
    write(join(d, 'n.slides.md'), t);
    write(join(d, 'n.slides.html'), assemble(t).split(`"shell":"${VERSION}"`).join('"shell":"99.0.0"'));
    await fail(['upgrade', 'n.slides.html'], 'newer-shell');
    const whole = assemble(deckText('Cut'));
    write(join(d, 'cut.slides.html'), whole.slice(0, whole.indexOf('Cut body')));
    await fail(['upgrade', 'cut.slides.html'], 'unclosed-island', { command: 'extract', args: ['cut.slides.html', '-o', 'cut.recovered.slides.md'] });
    write(join(d, 'nul.slides.md'), '<!-- slide -->\n## a\u0000b\n');
    await fail(['assemble', 'nul.slides.md'], 'invalid-text');
    // inspect --layout: no Chrome (simulated: ORZ_SLIDES_CHROME names nothing) is no-browser, with no next
    await fail(['inspect', 'doc.slides.md', '--layout'], 'no-browser', undefined, { ORZ_SLIDES_CHROME: join(d, 'no-such-chrome') });
    for (const r of ['bad-usage', 'no-such-file', 'unreadable', 'not-utf8', 'exists', 'not-orz', 'output-differs', 'assembled-input', 'twin-differs', 'replaces-mismatch', 'other-kind', 'newer-format', 'legacy-file', 'newer-shell', 'unclosed-island', 'invalid-text', 'no-browser']) expect(seen, r).toContain(r);
    noTemp(d);
  }, 240_000);

  it('[V.11] a 0.x text: assemble refuses it (legacy-file, next upgrade) — the deck block would show nothing — and --force assembles it as it is, with the lint as a warning', async () => {
    const d = folder();
    const src = read(join(LEGACY_DIR, 'demo.md'));
    write(join(d, 'demo.md'), src);
    const r = await cli(['demo.md'], d);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/demo\.md holds a <!-- deck --> block \(line 1\) — an orz-slides 0\.x text: orz-slides 1\.0 reads the deck's title, theme, ratio and footer only from the header.*`orz-slides upgrade demo\.md` moves it into the header \(and writes demo\.slides\.md\)/);
    expect(existsSync(join(d, 'demo.slides.html'))).toBe(false);
    const forced = await cli(['demo.md', '--force', '--json'], d);
    expect(forced.code, forced.stdout).toBe(0);
    expect((json(forced).warnings as string[]).join('\n')).toMatch(/deck-block, line 1/);
    expect(text(join(d, 'demo.slides.html')) === assemble(src, { legacy: 'as-is' })).toBe(true);
  }, 120_000);

  it('[I.8] inspect --layout without Chrome is refused with reason no-browser (simulated: ORZ_SLIDES_CHROME names no file), exit 1, no next, nothing written; --layout on something that is no slides deck is other-kind / not-orz before any browser is looked for', async () => {
    const d = folder();
    write(join(d, 'doc.slides.md'), deckText('Doc'));
    const env = { ORZ_SLIDES_CHROME: join(d, 'no-such-chrome') };
    const r = await cli(['inspect', 'doc.slides.md', '--layout', '--json'], d, env);
    expect(r.code).toBe(1);
    expect(json(r)).toEqual({ ok: false, command: 'inspect', error: expect.stringMatching(/no Chrome was found \(ORZ_SLIDES_CHROME names .*no-such-chrome, which does not exist\): install Google Chrome, or set ORZ_SLIDES_CHROME.*`orz-slides inspect doc\.slides\.md` without --layout needs no browser/), reason: 'no-browser', exitCode: 1 });
    const h = await cli(['inspect', 'doc.slides.md', '--layout'], d, env);
    expect(h.code).toBe(1);
    expect(h.stderr).toMatch(/^orz-slides inspect: --layout renders the deck in Chrome, and no Chrome was found/);
    // without --layout no browser is needed
    expect((await cli(['inspect', 'doc.slides.md', '--json'], d, env)).code).toBe(0);
    write(join(d, 'p.paged.md'), '# p\n');
    expect(json(await cli(['inspect', 'p.paged.md', '--layout', '--json'], d, env))).toMatchObject({ reason: 'other-kind' });
    write(join(d, 'page.html'), '<!doctype html><p>x</p>');
    expect(json(await cli(['inspect', 'page.html', '--layout', '--json'], d, env))).toMatchObject({ reason: 'not-orz' });
    expect(readdirSync(d).sort()).toEqual(['doc.slides.md', 'p.paged.md', 'page.html']);
  }, 120_000);

  it('[V.12] following every refusal\'s next verbatim never loses a text and ends in success: two inputs to one -o, an input against another\'s twin, browser saves on the twin and on -o, both sides changed, a copied file, a 0.x text and a 0.x file beside its text — with and without uids, with and without git', async () => {
    interface Scenario { d: string; env: NodeJS.ProcessEnv; texts: Map<string, string | null>; log: string[] }
    const present = (s: Scenario): Set<string> => {
      const all = new Set<string>();
      for (const rel of readdirSync(s.d, { recursive: true }) as string[]) {
        if (/^\.(git|cache)(\/|$)/.test(rel)) continue;
        const path = join(s.d, rel);
        if (!statSync(path).isFile()) continue;
        const t = text(path);
        all.add(t);
        const held = extract(t);
        if (held) all.add(held.text);
        const legacy = readLegacy(t);
        if (legacy) all.add(legacy.text);
      }
      return all;
    };
    const kept = (s: Scenario, t: string, here: Set<string>): boolean => here.has(t) || [...s.texts].some(([child, parent]) => parent === t && kept(s, child, here));
    const lost = (s: Scenario): string[] => { const here = present(s); return [...s.texts.keys()].filter((t) => !kept(s, t, here)); };
    const descends = (s: Scenario, t: string, of: string): boolean => { for (let c: string | null | undefined = t; c; c = s.texts.get(c)) if (c === of) return true; return false; };
    const textFiles = (s: Scenario): Map<string, string> => new Map((readdirSync(s.d, { recursive: true }) as string[]).filter((rel) => !/^\.(git|cache)(\/|$)/.test(rel) && rel.endsWith('.md') && statSync(join(s.d, rel)).isFile()).map((rel) => [rel, text(join(s.d, rel))]));
    /** Run one command: no text lost; a text file it replaced now holds a later edit of its text. A 0.x text's upgrade is its edit. */
    const run = async (s: Scenario, args: string[]): Promise<Run> => {
      const before = textFiles(s);
      const r = await cli([...args, '--json'], s.d, s.env);
      s.log.push(`${args.join(' ')} -> ${r.code} ${r.code ? String(JSON.parse(r.stdout).reason) : ''}`);
      // an upgrade's new text descends from what it upgraded
      if (r.code === 0 && args[0] === 'upgrade') {
        const j = JSON.parse(r.stdout) as { text: string | null; from: string; input: string };
        if (j.text && existsSync(j.text)) {
          const made = text(j.text);
          const from = j.from === 'text' ? (before.get(args[1]!) ?? text(j.input)) : null;
          if (!s.texts.has(made)) s.texts.set(made, from ?? [...s.texts.keys()].find((t) => made.includes(t.replace(/^[\s\S]*?\}\}\n\n/, ''))) ?? null);
        }
      }
      expect(lost(s), s.log.join('\n')).toEqual([]);
      for (const [rel, now] of textFiles(s)) {
        const was = before.get(rel);
        if (was !== undefined && was !== now) expect(descends(s, now, was), `${s.log.join('\n')}\n${rel}: ${JSON.stringify(was)} became ${JSON.stringify(now)}`).toBe(true);
      }
      return r;
    };
    const put = (s: Scenario, rel: string, t: string, from: string | null = null, html?: string): void => {
      mkdirSync(join(s.d, rel, '..'), { recursive: true });
      write(join(s.d, rel), html ?? (rel.endsWith('.slides.html') ? assemble(t, { delivery: 'cdn' }) : t));
      if (!s.texts.has(t)) s.texts.set(t, from);
    };
    const step = async (s: Scenario, args: string[]): Promise<Run> => {
      let r = await run(s, args);
      for (let depth = 0; r.code !== 0 && JSON.parse(r.stdout).next; depth++) {
        expect(depth, s.log.join('\n')).toBeLessThan(3);
        const next = JSON.parse(r.stdout).next as { command: string; args: string[] };
        expect(next.args, s.log.join('\n')).not.toContain('--force');
        s.log.push('  next:');
        r = await run(s, [next.command, ...next.args]);
        if (r.code !== 0) expect(JSON.parse(r.stdout).next, `${s.log.join('\n')}\n${r.stdout}`).toBeDefined();
      }
      return r;
    };
    const scenario = async (uid: boolean, withGit: boolean): Promise<{ s: Scenario; commit: (...files: string[]) => Promise<void> } | null> => {
      const d = folder();
      const git = withGit ? await gitIn(d) : null;
      if (withGit && !git) return null;
      const s: Scenario = { d, env: { XDG_CACHE_HOME: join(d, '.cache') }, texts: new Map(), log: [`uid ${uid}, git ${withGit}`] };
      return { s, commit: async (...files) => { if (!git) return; expect((await git('add', ...files)).code).toBe(0); expect((await git('commit', '-q', '-m', 'c')).code).toBe(0); } };
    };
    for (const uid of [false, true]) {
      for (const withGit of [false, true]) {
        const one = await scenario(uid, withGit);
        if (!one) continue;
        // 1. two inputs publish to one -o
        {
          const { s, commit } = one;
          const A = deckText('A', uid);
          const B = deckText('B', uid);
          put(s, 'a.slides.md', A);
          put(s, 'b.slides.md', B);
          await commit('a.slides.md', 'b.slides.md');
          expect((await step(s, ['assemble', 'a.slides.md', '-o', 'out/site.slides.html', '--cdn'])).code).toBe(0);
          await step(s, ['assemble', 'b.slides.md', '-o', 'out/site.slides.html']);
          await step(s, ['assemble', 'b.slides.md', '-o', 'out/site.slides.html', '--replaces', sha256(A)]);
          await step(s, ['assemble', 'a.slides.md', '-o', 'out/site.slides.html']);
          await step(s, ['extract', 'out/site.slides.html', '-o', 'a.slides.md']);
          await step(s, ['upgrade', 'out/site.slides.html', '--text', 'a.slides.md']);
          expect(text(join(s.d, 'a.slides.md')), s.log.join('\n')).toBe(A);
        }
        // 2. an input against another input's twin
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const X = deckText('X', uid);
          const Y = deckText('Y', uid);
          put(s, 'x.slides.md', X);
          put(s, 'y.slides.md', Y);
          await commit('x.slides.md', 'y.slides.md');
          expect((await step(s, ['assemble', 'x.slides.md', '--cdn'])).code).toBe(0);
          await step(s, ['assemble', 'y.slides.md', '-o', 'x.slides.html']);
          await step(s, ['assemble', 'y.slides.md', '-o', 'x.slides.html', '--replaces', sha256(X)]);
          await step(s, ['assemble', 'x.slides.md']);
          await step(s, ['extract', 'x.slides.html']);
          await step(s, ['upgrade', 'x.slides.html']);
          expect(text(join(s.d, 'x.slides.md')), s.log.join('\n')).toBe(X);
        }
        // 3. a browser save in the twin, then in an -o copy
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const X = deckText('X', uid);
          put(s, 'x.slides.md', X);
          await commit('x.slides.md');
          expect((await step(s, ['assemble', 'x.slides.md', '--cdn'])).code).toBe(0);
          put(s, 'x.slides.html', `${X}browser\n`, X);
          expect((await step(s, ['assemble', 'x.slides.md'])).code).toBe(0);
          expect(text(join(s.d, 'x.slides.md'))).toBe(uid ? `${X}browser\n` : X);
          if (!uid) expect(text(join(s.d, 'x.browser.slides.md'))).toBe(`${X}browser\n`);
          expect((await step(s, ['assemble', 'x.slides.md', '-o', 'pub/x.slides.html', '--cdn'])).code).toBe(0);
          const P = uid ? `${X}browser\npub\n` : `${X}pub\n`;
          put(s, 'pub/x.slides.html', P, uid ? `${X}browser\n` : X);
          expect((await step(s, ['assemble', 'x.slides.md', '-o', 'pub/x.slides.html'])).code).toBe(0);
          expect(text(join(s.d, 'x.slides.md'))).toBe(uid ? P : X);
        }
        // 4. both sides changed
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const X = deckText('X', uid);
          put(s, 'x.slides.md', X);
          await commit('x.slides.md');
          expect((await step(s, ['assemble', 'x.slides.md', '--cdn'])).code).toBe(0);
          put(s, 'x.slides.html', `${X}browser\n`, X);
          put(s, 'x.slides.md', `${X}agent\n`, X);
          await step(s, ['assemble', 'x.slides.md']);
          await step(s, ['extract', 'x.slides.html']);
          await step(s, ['upgrade', 'x.slides.html']);
          expect(text(join(s.d, 'x.slides.md'))).toBe(`${X}agent\n`);
        }
        // 5. another document's file copied over the twin
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const X = deckText('X', uid);
          const Y = deckText('Y', true);
          put(s, 'x.slides.md', X);
          put(s, 'y.slides.md', Y);
          await commit('x.slides.md', 'y.slides.md');
          expect((await step(s, ['assemble', 'x.slides.md', '--cdn'])).code).toBe(0);
          expect((await step(s, ['assemble', 'y.slides.md', '--cdn'])).code).toBe(0);
          copyFileSync(join(s.d, 'y.slides.html'), join(s.d, 'x.slides.html'));
          const asked = await run(s, ['assemble', 'x.slides.md']);
          expect(JSON.parse(asked.stdout).next?.args, s.log.join('\n')).not.toEqual(['x.slides.html']);
          await step(s, ['extract', 'x.slides.html']);
          await step(s, ['upgrade', 'x.slides.html']);
          await step(s, ['assemble', 'x.slides.md']);
          expect(text(join(s.d, 'x.slides.md')), s.log.join('\n')).toBe(X);
        }
        // 6. a 0.x text: assemble → next upgrade (deck.md → deck.slides.md) → assemble deck.slides.md
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const src = read(join(LEGACY_DIR, 'demo.md'));
          put(s, 'deck.md', src);
          await commit('deck.md');
          expect((await step(s, ['deck.md'])).code, s.log.join('\n')).toBe(0);
          expect(text(join(s.d, 'deck.md'))).toBe(src);
          expect(readHeader(text(join(s.d, 'deck.slides.md')))!.fields['theme']).toBe('paper');
          expect((await step(s, ['assemble', 'deck.slides.md'])).code, s.log.join('\n')).toBe(0);
          expect(extract(text(join(s.d, 'deck.slides.html')))!.text).toBe(text(join(s.d, 'deck.slides.md')));
        }
        // 7. a 0.x file beside its own (edited) text: assemble → next upgrade --text x.browser.slides.md; then
        //    the merge and assemble --replaces with the sha256 the upgrade printed — nothing of either is lost
        {
          const { s, commit } = (await scenario(uid, withGit))!;
          const legacy = legacyFile('demo-0.8.5.slides.html');
          const zero = readLegacy(legacy)!.text;
          const mine = upgradeText(`${zero}\n<!-- slide -->\n## my edit\n`, { uid: 'doc-mineedited0001' }).text;
          put(s, 'x.slides.md', mine);
          put(s, 'x.slides.html', zero, null, legacy);
          await commit('x.slides.md');
          const r = await step(s, ['assemble', 'x.slides.md']);
          expect(r.code, s.log.join('\n')).toBe(0);
          const up = JSON.parse(r.stdout) as { command: string; sha256: string; text: string };
          expect(up.command).toBe('upgrade');
          expect(text(join(s.d, 'x.slides.md'))).toBe(mine);
          expect(text(up.text)).toMatch(/^\{\{nyml\nkind: document\ncarrier: slides\n/);
          const done = await run(s, ['assemble', 'x.slides.md', '--replaces', up.sha256]);
          expect(done.code, s.log.join('\n')).toBe(0);
          expect(extract(text(join(s.d, 'x.slides.html')))!.text).toBe(mine);
        }
      }
    }
  }, 900_000);
});

describe('the CLI: every command it names runs as written', () => {
  /** POSIX shell words (the CLI quotes with single quotes, `'\''` inside). */
  const words = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let has = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === "'") { const j = line.indexOf("'", i + 1); cur += line.slice(i + 1, j); i = j; has = true; }
      else if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; }
      else if (/\s/.test(c)) { if (has) out.push(cur); cur = ''; has = false; }
      else { cur += c; has = true; }
    }
    if (has) out.push(cur);
    return out;
  };
  /** Every orz-slides command a text names: backticked, or after "next:". */
  const commandsIn = (s: string): string[] => [
    ...[...s.matchAll(/`((?:npx )?orz-slides(?:@[\w.]+)? [^`]+)`/g)].map((m) => m[1]!),
    ...[...s.matchAll(/next: (orz-slides [^\n]+)/g)].map((m) => m[1]!.trim()),
  ];
  /** Runnable as written here: no placeholder, no other version, no browser. */
  const runnable = (c: string): boolean => !/[<>…]|\.\.\.|@latest|--layout|--force/.test(c);
  /** Everything a run said: human or JSON (error, advice, warnings, next). */
  const said = (r: Run): string => {
    let extra = '';
    try {
      const j = JSON.parse(r.stdout) as { error?: string; advice?: string[]; warnings?: string[]; next?: { command: string; args: string[] } };
      extra = [j.error ?? '', ...(j.advice ?? []), ...(j.warnings ?? [])].join('\n');
      if (j.next) extra += `\n\`orz-slides ${[j.next.command, ...j.next.args].map((a) => (/^[\w./@:=+-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ')}\``;
    } catch { /* human output */ }
    return `${r.stdout}\n${r.stderr}\n${extra}`;
  };
  const UID = 'doc-v13runnable0001';
  const T = `{{nyml\nkind: document\ncarrier: slides\nuid: ${UID}\ntitle: R\n}}\n\n<!-- slide -->\n## R\n\nR body\n`;
  const newerFile = (t: string): string => assemble(t).split(`"shell":"${VERSION}"`).join('"shell":"99.0.0"');
  /** The scenarios: a deterministic setup each (re-run from scratch for every command), and the commands that probe it. */
  const SCENARIOS: Array<{ name: string; setup(d: string): Promise<void>; probes: string[][] }> = [
    { name: 'a text alone', setup: async (d) => { write(join(d, 'x.slides.md'), T); }, probes: [['inspect', 'x.slides.md'], ['assemble', 'x.slides.md', '--footer', 'F'], ['assemble', 'x.slides.md', '--author', 'A'], ['assemble', 'x.slides.md', '--title', 'X']] },
    { name: 'a pair, the file saved in the browser', setup: async (d) => { write(join(d, 'x.slides.md'), T); expect((await cli(['assemble', 'x.slides.md'], d, { XDG_CACHE_HOME: join(d, '.cache') })).code).toBe(0); write(join(d, 'x.slides.html'), assemble(`${T}browser\n`)); }, probes: [['inspect', 'x.slides.md'], ['inspect', 'x.slides.html'], ['assemble', 'x.slides.md']] },
    { name: 'both changed', setup: async (d) => { write(join(d, 'x.slides.md'), T); expect((await cli(['assemble', 'x.slides.md'], d, { XDG_CACHE_HOME: join(d, '.cache') })).code).toBe(0); write(join(d, 'x.slides.html'), assemble(`${T}browser\n`)); write(join(d, 'x.slides.md'), `${T}agent\n`); }, probes: [['inspect', 'x.slides.md'], ['assemble', 'x.slides.md'], ['extract', 'x.slides.html']] },
    { name: 'a 0.x file beside its edited text (CLI-3)', setup: async (d) => { const legacy = legacyFile('demo-0.8.5.slides.html'); write(join(d, 'x.slides.html'), legacy); write(join(d, 'x.slides.md'), upgradeText(`${readLegacy(legacy)!.text}\n<!-- slide -->\n## my edit\n`, { uid: 'doc-mineedited0001' }).text); }, probes: [['inspect', 'x.slides.html'], ['inspect', 'x.slides.md'], ['assemble', 'x.slides.md']] },
    { name: 'a 0.x deck source beside the 0.x file built from it (CLI-4)', setup: async (d) => { write(join(d, 'talk.md'), read(join(LEGACY_DIR, 'demo.md'))); write(join(d, 'talk.slides.html'), legacyFile('demo-0.8.5-inline.slides.html')); }, probes: [['upgrade', 'talk.md'], ['inspect', 'talk.md'], ['talk.md']] },
    { name: 'a 0.x file alone (CLI-7)', setup: async (d) => { write(join(d, 'old.slides.html'), legacyFile('meta-0.8.5.slides.html')); }, probes: [['assemble', 'old.slides.html'], ['extract', 'old.slides.html'], ['inspect', 'old.slides.html']] },
    { name: 'plain Markdown (CLI-8)', setup: async (d) => { write(join(d, 'p.md'), '# Hi\n\nplain text\n'); write(join(d, 'm.slides.md'), '{{nyml\nkind: document\ncarrier: md\n}}\n\n# M\n'); }, probes: [['assemble', 'p.md'], ['inspect', 'p.md'], ['assemble', 'm.slides.md'], ['inspect', 'm.slides.md'], ['upgrade', 'm.slides.md']] },
    { name: 'only the file (CLI-9)', setup: async (d) => { write(join(d, 'e.slides.html'), assemble(T)); }, probes: [['inspect', 'e.slides.md'], ['inspect', 'e.slides.html']] },
    { name: 'a twin made by a newer shell (CLI-6)', setup: async (d) => { write(join(d, 'n.slides.html'), newerFile(T)); write(join(d, 'n.slides.md'), `${T}- y\n`); }, probes: [['inspect', 'n.slides.md'], ['assemble', 'n.slides.md']] },
    { name: 'a twin cut off inside its text (CLI-5)', setup: async (d) => { const whole = assemble(`${T}second part\n`, { delivery: 'cdn' }); write(join(d, 'c.slides.html'), whole.slice(0, whole.indexOf('second part') + 6)); write(join(d, 'c.slides.md'), `${T}second part\n`); }, probes: [['inspect', 'c.slides.md'], ['inspect', 'c.slides.html'], ['assemble', 'c.slides.md'], ['upgrade', 'c.slides.html']] },
  ];

  it('[V.14] every `next`, and every command an advice, a refusal, a warning or a note names, runs as written in the state that named it (exit 0) — a text alone, browser saves, both sides changed, 0.x files beside texts and alone, plain Markdown, only the file, a newer shell, a cut-off file — and every concrete command in the help parses (final loop CLI-3/4/6/7/8/9, RR-8)', async () => {
    const failures: string[] = [];
    let ran = 0;
    // the scenarios side by side (each in folders of its own); within one, a state is rebuilt from scratch for every command
    await Promise.all(SCENARIOS.map(async (sc) => {
      const fresh = async (): Promise<{ d: string; env: NodeJS.ProcessEnv }> => { const d = folder(); const env = { XDG_CACHE_HOME: join(d, '.cache') }; await sc.setup(d); return { d, env }; };
      const named = new Map<string, string[]>();
      for (const probe of sc.probes) {
        const runs = await Promise.all([false, true].map(async (asJson) => { const { d, env } = await fresh(); return cli([...probe, ...(asJson ? ['--json'] : [])], d, env); }));
        named.set(probe.join('\u0000'), [...new Set(runs.flatMap((r) => commandsIn(said(r))))].filter(runnable));
      }
      for (const [key, commands] of named) {
        const probe = key.split('\u0000');
        await Promise.all(commands.map(async (c) => {
          const { d, env } = await fresh();
          await cli(probe, d, env); // the state that named it
          const out = await cli([...words(c.replace(/^npx /, '')).slice(1), '--json'], d, env);
          ran++;
          if (out.code !== 0) failures.push(`${sc.name}: \`${probe.join(' ')}\` named \`${c}\` → exit ${out.code}: ${(() => { try { return String(JSON.parse(out.stdout).error); } catch { return out.stderr.trim(); } })()}`);
        }));
      }
    }));
    expect(failures).toEqual([]);
    expect(ran).toBeGreaterThan(20);
    // the help: every concrete command parses (no usage error) in a folder holding the files it names
    const d = folder();
    write(join(d, 'x.slides.md'), T);
    write(join(d, 'x.md'), read(join(LEGACY_DIR, 'demo.md')));
    write(join(d, 'deck.md'), read(join(LEGACY_DIR, 'demo.md')));
    const help = (await Promise.all(['', 'new', 'assemble', 'extract', 'upgrade', 'inspect', 'themes', 'templates'].map((c) => cli(c ? [c, '--help'] : ['--help'], d)))).map((r) => r.stdout).join('\n');
    const helpCommands = [...new Set(commandsIn(help))].filter((c) => !/[<>\[\]|…]|@latest/.test(c));
    expect(helpCommands.length).toBeGreaterThan(3);
    for (const c of helpCommands) {
      const out = await cli([...words(c.replace(/^npx /, '')).slice(1), '--json'], d);
      expect(out.code, `help names \`${c}\`: ${out.stdout}${out.stderr}`).not.toBe(2);
    }
  }, 600_000);

  it('[V.14] the kind and the advice as inspect decides them: plain Markdown and a `carrier: md` text are other-kind for assemble and upgrade (--force builds them; CLI-8); `inspect x.slides.md` with only x.slides.html names `extract x.slides.html` (CLI-9); a header key given to assemble names `new` only for the keys `new` takes (RR-8)', async () => {
    const d = folder();
    const env = { XDG_CACHE_HOME: join(d, '.cache') };
    write(join(d, 'p.md'), '# Hi\n\nplain text\n');
    write(join(d, 'm.slides.md'), '{{nyml\nkind: document\ncarrier: md\n}}\n\n# M\n');
    for (const args of [['assemble', 'p.md'], ['assemble', 'm.slides.md'], ['upgrade', 'm.slides.md']]) {
      const r = json(await cli([...args, '--json'], d, env));
      expect(r, args.join(' ')).toMatchObject({ ok: false, reason: 'other-kind' });
      expect(String(r.error), args.join(' ')).toMatch(/orz-mdhtml/);
    }
    expect(existsSync(join(d, 'p.slides.html'))).toBe(false);
    expect((await cli(['assemble', 'p.md', '--force'], d, env)).code).toBe(0);
    write(join(d, 'e.slides.html'), assemble(T));
    expect(json(await cli(['inspect', 'e.slides.md', '--json'], d, env))).toMatchObject({ ok: false, reason: 'no-such-file', next: { command: 'extract', args: ['e.slides.html'] } });
    write(join(d, 'x.slides.md'), T);
    for (const key of ['--footer', '--author', '--transition', '--uid', '--lang']) expect(String(json(await cli(['assemble', 'x.slides.md', key, 'v', '--json'], d, env)).error), key).not.toMatch(/orz-slides new/);
    for (const key of ['--title', '--theme', '--ratio']) expect(String(json(await cli(['assemble', 'x.slides.md', key, 'v', '--json'], d, env)).error), key).toMatch(new RegExp(`orz-slides new <file\\.slides\\.md> ${key}`));
  }, 120_000);

  it('[V.14] a text beside a file cut off inside its text is never told to bring the file\'s text in as browser changes: the advice says the file is cut off and names assemble --replaces (CLI-5); the record of the last sync is worded as a sync, never "wrote it from" a file orz-slides read', async () => {
    const d = folder();
    const whole = assemble(`${T}second part\n`, { delivery: 'cdn' });
    write(join(d, 'c.slides.html'), whole.slice(0, whole.indexOf('second part') + 6));
    write(join(d, 'c.slides.md'), `${T}second part\n`);
    const r = json(await cli(['inspect', 'c.slides.md', '--json'], d, { XDG_CACHE_HOME: join(d, '.cache') }));
    const advice = (r.advice as string[]).join('\n');
    expect(advice).toMatch(/cut off inside its text/);
    expect(advice).toMatch(/assemble c\.slides\.md --replaces [0-9a-f]{64}/);
    expect(advice).not.toMatch(/saved in the browser/);
    expect((await cli(['extract', 'c.slides.html', '-o', 'c.recovered.slides.md'], d, { XDG_CACHE_HOME: join(d, '.cache') })).code).toBe(0);
    // assemble itself says so too (confirming round C-H1: the kit refuses a cut file with unclosed-island)
    const a = json(await cli(['assemble', 'c.slides.md', '--json'], d, { XDG_CACHE_HOME: join(d, '.cache') }));
    expect(a).toMatchObject({ ok: false, reason: 'unclosed-island', next: { command: 'assemble', args: ['c.slides.md', '--replaces', expect.stringMatching(/^[0-9a-f]{64}$/)] } });
    // the record of the last sync, for a complete file another text last synced
    write(join(d, 'e.slides.html'), assemble(`${T}from the browser\n`, { delivery: 'cdn' }));
    expect((await cli(['extract', 'e.slides.html', '-o', 'e.other.slides.md'], d, { XDG_CACHE_HOME: join(d, '.cache') })).code).toBe(0);
    write(join(d, 'e.slides.md'), `${T}mine\n`);
    const b = json(await cli(['assemble', 'e.slides.md', '--json'], d, { XDG_CACHE_HOME: join(d, '.cache') }));
    expect(String(b.error)).not.toMatch(/last wrote it from/);
    expect(String(b.error)).toMatch(/last synced it with e\.other\.slides\.md/);
  }, 120_000);

  it('[V.15] a file cut off inside its text never replaces the complete text: with the pair recorded (the text unchanged since the sync), assemble refuses with unclosed-island and next `assemble x.slides.md --replaces <hash>` — never extract —, which repairs the file; extract in place and with -o onto the text are refused (next: extract -o x.recovered.slides.md) and --force keeps x.slides.md~ (confirming round C-H1)', async () => {
    const d = folder();
    const env = { XDG_CACHE_HOME: join(d, '.cache') };
    expect((await cli(['new', 'x.slides.md', '--template', 'talk', '--html'], d, env)).code).toBe(0);
    const whole = text(join(d, 'x.slides.md'));
    const lines = text(join(d, 'x.slides.html')).split('\n');
    const at = lines.findIndex((l) => l.includes('id="orz-src"'));
    write(join(d, 'x.slides.html'), `${lines.slice(0, at + 21).join('\n')}\n`);
    const held = extract(text(join(d, 'x.slides.html')))!.text;
    expect(held.length).toBeLessThan(whole.length);
    const a = json(await cli(['assemble', 'x.slides.md', '--json'], d, env));
    expect(a).toMatchObject({ ok: false, reason: 'unclosed-island', next: { command: 'assemble', args: ['x.slides.md', '--replaces', sha256(held)] } });
    for (const args of [['extract', 'x.slides.html'], ['extract', 'x.slides.html', '-o', 'x.slides.md']]) {
      const r = json(await cli([...args, '--json'], d, env));
      expect(r, args.join(' ')).toMatchObject({ ok: false, reason: 'unclosed-island', next: { command: 'extract', args: ['x.slides.html', '-o', 'x.recovered.slides.md'] } });
      expect(text(join(d, 'x.slides.md'))).toBe(whole);
    }
    const f = json(await cli(['extract', 'x.slides.html', '--force', '--json'], d, env));
    expect(f).toMatchObject({ ok: true, backup: join(d, 'x.slides.md~') });
    expect(text(join(d, 'x.slides.md~'))).toBe(whole);
    write(join(d, 'x.slides.md'), whole);
    // the repair: the named next, verbatim (a cache that never saw the cut text)
    const env2 = { XDG_CACHE_HOME: join(d, '.cache2') };
    const b = json(await cli(['assemble', 'x.slides.md', '--json'], d, env2));
    expect(b.reason).toBe('unclosed-island');
    const next = b.next as { command: string; args: string[] };
    expect((await cli([next.command, ...next.args], d, env2)).code).toBe(0);
    expect(extract(text(join(d, 'x.slides.html')))!.text).toBe(whole);
    expect(inspect(text(join(d, 'x.slides.html'))).checks?.island).toBe('closed');
  }, 120_000);

  it('[V.16] extract never puts an older text over a newer twin: a file that holds one of the text\'s earlier commits (or the text last synced) beside a committed newer text is refused (twin-differs, next `assemble x.slides.md`, which then brings the file up to date), --force keeps x.slides.md~ (confirming round C-L1); an in-place upgrade of a 0.x file keeps the old file as old.slides.html~ (C-L2)', async () => {
    const d = folder();
    const git = await gitIn(d);
    const env = { XDG_CACHE_HOME: join(d, '.cache') };
    if (git) {
      write(join(d, 'x.slides.md'), T);
      expect((await cli(['assemble', 'x.slides.md'], d, env)).code).toBe(0);
      await git('add', '.'); await git('commit', '-q', '-m', 'a');
      write(join(d, 'x.slides.md'), `${T}b\n`); await git('commit', '-q', '-am', 'b');
      write(join(d, 'x.slides.md'), `${T}b\nc\n`); await git('commit', '-q', '-am', 'c');
      for (const e of [env, { XDG_CACHE_HOME: join(d, '.fresh') }]) {
        const r = json(await cli(['extract', 'x.slides.html', '--json'], d, e));
        expect(r).toMatchObject({ ok: false, reason: 'twin-differs', next: { command: 'assemble', args: ['x.slides.md'] } });
        expect(text(join(d, 'x.slides.md'))).toBe(`${T}b\nc\n`);
      }
      const f = json(await cli(['extract', 'x.slides.html', '--force', '--json'], d, env));
      expect(f).toMatchObject({ ok: true, backup: join(d, 'x.slides.md~') });
      expect(text(join(d, 'x.slides.md~'))).toBe(`${T}b\nc\n`);
      write(join(d, 'x.slides.md'), `${T}b\nc\n`);
      const r = json(await cli(['extract', 'x.slides.html', '--json'], d, env));
      const next = r.next as { command: string; args: string[] };
      expect((await cli([next.command, ...next.args], d, env)).code).toBe(0);
      expect(extract(text(join(d, 'x.slides.html')))!.text).toBe(`${T}b\nc\n`);
    }
    // C-L2: the 0.x file replaced in place is kept
    const e = folder();
    const old = legacyFile('plain-0.8.5.slides.html');
    write(join(e, 'old.slides.html'), old);
    const u = json(await cli(['upgrade', 'old.slides.html', '--json'], e, { XDG_CACHE_HOME: join(e, '.cache') }));
    expect(u).toMatchObject({ ok: true, backups: [join(e, 'old.slides.html~')] });
    expect(text(join(e, 'old.slides.html~'))).toBe(old);
  }, 120_000);
});

describe.concurrent('1.1 repairs (the CLI and the library)', () => {
  /** The browser's Save: the file re-assembled from an edited text (the same uid). */
  const browserEdit = (path: string, edit: (t: string) => string): void => { write(path, assemble(edit(extract(text(path))!.text))); };

  it('[V.8] D-70: extract -o x.browser.slides.md again, when that output still holds exactly what extract wrote there, rewrites it — also after an assemble of x.slides.md synced the file in between; an -o output with edits of its own is refused output-differs (not twin-differs)', async () => {
    const d = folder();
    expect((await cli(['new', 'x.slides.md'], d)).code).toBe(0);
    expect((await cli(['assemble', 'x.slides.md'], d)).code).toBe(0);
    browserEdit(join(d, 'x.slides.html'), (t) => t.replace('## ', '## Edited '));
    expect((await cli(['extract', 'x.slides.html', '-o', 'x.browser.slides.md'], d)).code).toBe(0);
    // merged; assembled (the other pair now synced the file last); edited in the browser again
    write(join(d, 'x.slides.md'), text(join(d, 'x.browser.slides.md')));
    expect((await cli(['assemble', 'x.slides.md'], d)).code).toBe(0);
    browserEdit(join(d, 'x.slides.html'), (t) => `${t}\n<!-- slide -->\n## Added in the browser\n`);
    const again = await cli(['extract', 'x.slides.html', '-o', 'x.browser.slides.md', '--json'], d);
    expect(again.code, again.stdout).toBe(0);
    expect(json(again)).toMatchObject({ ok: true, replaced: 'cache' });
    expect(text(join(d, 'x.browser.slides.md'))).toContain('## Added in the browser');
    // an edit of its own: refused, output-differs, with the extract to another name
    write(join(d, 'x.browser.slides.md'), `${text(join(d, 'x.browser.slides.md'))}\nmine\n`);
    browserEdit(join(d, 'x.slides.html'), (t) => `${t}\nmore\n`);
    const mine = await cli(['extract', 'x.slides.html', '-o', 'x.browser.slides.md', '--json'], d);
    expect(mine.code).toBe(1);
    expect(json(mine)).toMatchObject({ reason: 'output-differs', next: { command: 'extract' } });
  });

  it('[V.10] D-71, D-72: inspect advises from the state just checked — a 0.x text left beside its upgraded file is never told to assemble (refused legacy-file) but where its text is now; a deck text whose file holds it is "up to date"; after --layout, --layout is not advised again', async () => {
    const d = folder();
    write(join(d, 'demo.md'), read(join(LEGACY_DIR, 'demo.md')));
    write(join(d, 'demo.slides.html'), legacyFile('demo-0.8.5.slides.html'));
    expect((await cli(['upgrade', 'demo.slides.html'], d)).code).toBe(0);
    const r = json(await cli(['inspect', 'demo.md', '--json'], d));
    const advice = (r.advice as string[]).join('\n');
    expect(advice).not.toMatch(/orz-slides assemble demo\.md/);
    expect(advice).toMatch(/demo\.slides\.md holds its upgraded text/);
    // a deck text and its up-to-date file
    write(join(d, 'y.slides.md'), deckText('Up to date'));
    expect((await cli(['assemble', 'y.slides.md'], d)).code).toBe(0);
    const y = json(await cli(['inspect', 'y.slides.md', '--json'], d));
    expect((y.advice as string[]).join('\n')).toMatch(/y\.slides\.html holds this text \(up to date\)/);
    expect((y.advice as string[]).join('\n')).not.toMatch(/makes its \.slides\.html/);
    const laid = inspect(deckText('Laid out'), { filename: 'z.slides.md', layout: true });
    expect(laid.advice.join('\n')).not.toMatch(/--layout/);
  });

  it('[V.10] D-73: a box shrunk well below full size but not cut gets a hint (shorten or split); one nearly full size does not', () => {
    const base = { browser: { product: 'Chrome' }, network: 'offline', theme: 'orchard', ratio: '16:9', size: { width: 1280, height: 720 }, summary: {}, errors: [] };
    const box = (b: string, scale: number, clipped = false) => ({ box: b, scale, clipped, scroll: false });
    const advice = layoutAdvice({ ...base, slides: [{ slide: 2, title: 'Dense', boxes: [box('left', 0.72), box('right', 0.97)], footerClipped: false, settled: 'yes' }] } as never);
    expect(advice.filter((a) => /shrunk to fit/.test(a))).toEqual([expect.stringMatching(/^slide 2 \(Dense\): left \(72%\) is shrunk to fit: .*shorten it or split the slide$/)]);
  });

  it('[V.7] D-76, D-107: a 0.x content option to assemble is a usage error with a next (upgrade a 0.x text; new a deck that does not exist); the help lists --cdn | --inline', async () => {
    const d = folder();
    write(join(d, 'old.md'), read(join(LEGACY_DIR, 'demo.md')));
    const a = await cli(['old.md', '--theme', 'paper', '--json'], d);
    expect(a.code).toBe(2);
    expect(json(a)).toMatchObject({ reason: 'bad-usage', next: { command: 'upgrade', args: ['old.md'] } });
    expect(json(a).error).toMatch(/`theme: paper`/);
    const b = await cli(['assemble', 'fresh.slides.md', '--theme', 'paper', '--json'], d);
    expect(json(b)).toMatchObject({ reason: 'bad-usage', next: { command: 'new', args: ['fresh.slides.md', '--theme', 'paper'] } });
    for (const h of [(await cli(['--help'], d)).stdout, (await cli(['assemble', '--help'], d)).stdout]) expect(h).toMatch(/assemble <file\.slides\.md> \[-o out\.slides\.html\] \[--cdn \| --inline\]/);
  });

  it('[V.1] D-77: assemble -o - into a reader that closes early ends quietly (exit 0, no stack)', async () => {
    const d = folder();
    write(join(d, 'p.slides.md'), deckText('Pipe'));
    const r = await new Promise<{ code: number | null; stderr: string; got: number }>((res) => {
      const c = spawn(process.execPath, [CLI, 'assemble', 'p.slides.md', '-o', '-'], { cwd: d, env: { ...process.env, XDG_CACHE_HOME: CACHE } });
      let stderr = '';
      let got = 0;
      c.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
      c.stdout.once('data', (b: Buffer) => { got = b.length; c.stdout.destroy(); });
      c.on('close', (code) => res({ code, stderr, got }));
    });
    expect(r.got).toBeGreaterThan(0);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('[V.11] D-89: a text with no slide marker (plain Markdown named or headed as a deck) is refused, never guessed: invalid-text, with `new … --template talk` when that name is free; --force assembles it as it is', async () => {
    const d = folder();
    write(join(d, 'talk.md'), '{{nyml\nkind: document\ncarrier: slides\ntitle: Talk\n}}\n\n# My talk\n\n## Intro\n\nHello\n');
    const r = await cli(['assemble', 'talk.md', '--json'], d);
    expect(r.code).toBe(1);
    expect(json(r)).toMatchObject({ reason: 'invalid-text', next: { command: 'new', args: ['talk.slides.md', '--template', 'talk'] } });
    expect(json(r).error).toMatch(/no slide marker.*<!-- slide -->/);
    expect(existsSync(join(d, 'talk.slides.html'))).toBe(false);
    write(join(d, 'bare.slides.md'), '# x\n\nhello\n');
    const b = json(await cli(['assemble', 'bare.slides.md', '--json'], d));
    expect(b).toMatchObject({ reason: 'invalid-text' });
    expect(b.next).toBeUndefined();
    expect((await cli(['assemble', 'bare.slides.md', '--force'], d)).code).toBe(0);
  });

  it('[V.11] D-112, D-111: the library refuses a 0.x deck text as the CLI does (code legacy-file; legacy: \'as-is\' assembles it); extractLegacy gives a 0.x file\'s text as upgrade writes it (title, metadata, theme in the header)', () => {
    const src = read(join(LEGACY_DIR, 'demo.md'));
    expect(() => assemble(src, { delivery: 'cdn' })).toThrow(expect.objectContaining({ code: 'legacy-file' }));
    expect(() => assemble(src, { delivery: 'cdn', legacy: 'as-is' })).not.toThrow();
    for (const f of LEGACY_FILES) {
      const html = legacyFile(f);
      const x = extractLegacy(html, { uid: 'doc-legacyextract01' })!;
      expect(x, f).not.toBeNull();
      expect(x.text, f).toBe(upgrade(html, { delivery: 'cdn', uid: 'doc-legacyextract01' }).text);
      expect(x, f).toMatchObject({ kind: 'slides', format: 1, shell: '' });
      expect(readHeader(x.text)?.fields['theme'], f).toBeTruthy();
    }
    expect(extractLegacy(assemble(deckText('Not old'), { delivery: 'cdn' }))).toBeNull();
  });
});

