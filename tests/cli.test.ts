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
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintHeader, readHeader, sha256, UID_PATTERN } from 'orz-markdown/carrier';
import { REASONS } from 'orz-markdown/carrier/node';
import {
  assemble, extract, inspect, readDocument, readLegacy, upgrade, upgradeReport, upgradeText,
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
    expect(h.stdout).toBe(`Wrote ${join(d, 'cr.slides.html')} (inline, orz-slides ${VERSION})\n  sha256 ${sha256(storedText(HAZARDS['cr']!))} (the text it holds; --replaces takes it)\n`);
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
      expect(j.warnings).toEqual(j.notes);
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
    // the human output: notes as warnings (stderr), the report's summary among them
    write(join(d, 'h.slides.html'), legacyWithTheme('executive'));
    const human = await cli(['upgrade', 'h.slides.html'], d);
    expect(human.stderr).toMatch(/orz-slides: warning: upgrade report: the upgraded deck shows what orz-slides 0\.8\.5 showed/);
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
    expect((await cli(['upgrade', 'f1.slides.md'], d)).stdout).toMatch(/already a format-1 slides text: nothing to upgrade/);
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
    expect(json(lint).warnings).toEqual([expect.stringMatching(/^slide 1: the layout has no region "middle" .*\(unknown-region, line 8\)$/), expect.stringMatching(/\(unknown-theme, line 3\)$/)]);
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
    expect(r.stderr).toMatch(/demo\.md holds a <!-- deck --> block \(line 1\) — an orz-slides 0\.x text: format 1 reads the deck's title, theme, ratio and footer only from the header.*`orz-slides upgrade demo\.md` moves it into the header \(and writes demo\.slides\.md\)/);
    expect(existsSync(join(d, 'demo.slides.html'))).toBe(false);
    const forced = await cli(['demo.md', '--force', '--json'], d);
    expect(forced.code, forced.stdout).toBe(0);
    expect((json(forced).warnings as string[]).join('\n')).toMatch(/deck-block, line 1/);
    expect(text(join(d, 'demo.slides.html')) === assemble(src)).toBe(true);
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
