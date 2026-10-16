/**
 * Web-app readiness (rebuild step 8; claims X.1–X.4): the example app
 * (examples/webapp/) mounts two slides editors — each with its flattened
 * preview and live slide card in a sandboxed frame — with every FC-19 hook
 * under a nonce CSP with 'strict-dynamic' and works end to end in real Chrome,
 * OFFLINE (D-63: no host resolves; CodeMirror is served from the installed
 * orz-markdown, everything else off the machine is refused); the ESM
 * variant; the app author's guide; the browser package's release check.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { UID_PATTERN } from 'orz-markdown/carrier';
import { assemble } from '../src/lib.js';
import { launchChrome } from './helpers.js';

type Browser = import('playwright-core').Browser;
type BrowserContext = import('playwright-core').BrowserContext;
type Page = import('playwright-core').Page;
type Frame = import('playwright-core').Frame;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** A static server of the repository on the loopback (the one host Chrome resolves). */
async function serve(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

const browser: Browser | null = await launchChrome(); // offline (D-63)
const site = await serve(resolve('.'));
afterAll(async () => { await browser?.close(); await site.close(); });
const chrome = browser ? describe : describe.skip;

type Ed = {
  getText(): string; setText(t: string): void; undo(): boolean; save(): Promise<{ ok: boolean; via?: string }>; isDirty(): boolean;
  setMode(m: string): void; getMode(): string; focus(): void; requestAi(op: string, o?: { selection?: boolean }): Promise<{ ok: boolean }>;
  uploadAssets(f: File[]): Promise<{ ok: boolean; inserted: string[] }>; ensureUid(): Promise<string>; ready: Promise<{ engine: string }>;
  select(a: number, b: number): void;
  slides: { caretSlide(): number; isPerSlide(): boolean; setPerSlide(on: boolean): void; isLive(): boolean };
};
type Demo = { editors: { a: Ed; b: Ed }; store: Map<string, string>; calls: Array<{ hook: string; detail: string }> };
const CSP_INIT = `(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sample || '')), true); })();`;

/** A context that serves CodeMirror (the kit's vendored files) from the installed orz-markdown; every other request off the machine is refused and logged. */
async function context(log: string[]): Promise<BrowserContext> {
  const ctx = await browser!.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(CSP_INIT);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const url = r.request().url();
    log.push(url);
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/orz-markdown@[^/]+\/(vendor\/.+)$/.exec(url);
    const f = m ? join('node_modules/orz-markdown', m[1]!) : '';
    if (f && existsSync(f)) return r.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': extname(f) === '.css' ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' } });
    return r.abort('internetdisconnected');
  });
  return ctx;
}

async function open(path: string, log: string[]): Promise<{ page: Page; errors: string[]; consoleLines: string[] }> {
  const ctx = await context(log);
  const page = await ctx.newPage();
  const errors: string[] = [];
  const consoleLines: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => consoleLines.push(m.text()));
  await page.goto(`${site.url}${path}`);
  return { page, errors, consoleLines };
}

/** The editor preview frame (it has the live card; the library's thumbnail has not) whose flattened deck shows `text`, polled. */
async function frameShowing(page: Page, text: string): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      if (await f.evaluate((t) => !!document.getElementById('orz-live') && !!document.querySelector('#orz-doc .orz-flat-slide') && (document.getElementById('orz-doc')?.textContent ?? '').includes(t), text).catch(() => false)) return f;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`no preview shows ${JSON.stringify(text)}`);
}

chrome('the example web app (real Chrome, offline)', () => {
  it('[X.1] two editors with every hook under a nonce CSP with \'strict-dynamic\': save, undo per instance, resolveAsset (flattened preview and live slide), fetchInclude, resolveLink, uploadAsset, ai, mintUid; chrome none drives the API — single-slide editing and a layout op (applyOp → applyEdits, one undo step); Cmd/Ctrl+P goes to the app; no CSP violation, no page error, no update check', async () => {
    const log: string[] = [];
    const { page, errors, consoleLines } = await open('/examples/webapp/index.html', log);
    await page.waitForFunction(() => !!(globalThis as unknown as { demo?: unknown }).demo);
    // the policy is live: an inline event handler is refused (the component uses none)
    expect(await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('onclick', 'window.__bad = 1'); document.body.append(d); d.click(); d.remove(); return (window as unknown as { __bad?: number }).__bad ?? 'blocked'; })).toBe('blocked');
    await page.waitForFunction(() => (window as unknown as { __csp: string[] }).__csp.length === 1);
    await page.evaluate(() => { (window as unknown as { __csp: string[] }).__csp.length = 0; });
    consoleLines.length = 0;
    // CodeMirror in both (served from the installed kit, SRI-checked)
    expect(await page.evaluate(async () => { const { a, b } = (globalThis as unknown as { demo: Demo }).demo.editors; return [(await a.ready).engine, (await b.ready).engine]; })).toEqual(['codemirror6', 'codemirror6']);

    // two instances: chrome full has the slides tools, chrome none has no toolbar
    const tools = await page.evaluate(() => Array.from(document.querySelectorAll('.orz-editor-host')).map((h) => Array.from(h.shadowRoot!.querySelectorAll('button')).map((x) => x.getAttribute('aria-label') ?? x.textContent).filter((n) => n && /^(Theme|Ratio|AI|Save)$/.test(n))));
    expect(tools[0]).toEqual(expect.arrayContaining(['Theme', 'Ratio', 'AI', 'Save']));
    expect(tools[1]).toEqual([]);

    // save → hooks.save with the exact text; undo stays per instance
    const r = await page.evaluate(async () => {
      const demo = (globalThis as unknown as { demo: Demo }).demo;
      const { a, b } = demo.editors;
      a.setText(`${a.getText()}Edited A.\r\n`);
      b.setText('﻿<!-- slide -->\r\n## B\r\n\r\nedited B\r\n');
      const sa = await a.save();
      const sb = await b.save();
      return { sa, sb, a: demo.store.get('a'), b: demo.store.get('b'), aText: a.getText(), bText: b.getText(), undoA: a.undo(), afterUndoA: a.getText(), bAfter: b.getText() };
    });
    expect(r.sa).toEqual({ ok: true, via: 'hook' });
    expect(r.sb).toEqual({ ok: true, via: 'hook' });
    expect(r.a).toBe(r.aText);
    expect(r.b).toBe('﻿<!-- slide -->\r\n## B\r\n\r\nedited B\r\n');
    expect(r.undoA).toBe(true);
    expect(r.afterUndoA.endsWith('Edited A.\r\n')).toBe(false);
    expect(r.bAfter).toBe(r.bText);

    // the flattened preview (A): slide dividers, the include resolved by the app, the image through resolveAsset, links as written
    const frameA = await frameShowing(page, 'resists pH change');
    expect(await frameA.evaluate(() => document.querySelectorAll('#orz-doc .orz-flat-slide').length)).toBe(3);
    expect(await frameA.evaluate(() => document.querySelector('#orz-doc img')?.getAttribute('src'))).toBe(`${site.url}/examples/webapp/figures/curve.svg`);
    // the frame's scripts and styles carry the nonce (no violation below); the slide theme is inside
    expect(await frameA.evaluate(() => Array.from(document.querySelectorAll('style')).every((s) => (s as HTMLStyleElement).nonce === 'orz-demo-nonce'))).toBe(true);
    expect(await frameA.evaluate(() => document.getElementById('orz-slide-theme')?.getAttribute('data-theme'))).toBe('orchard');
    // the link in view and clear of the live card (bottom right): scrolled to the frame's top, then clicked
    await frameA.evaluate(() => { [...document.querySelectorAll('#orz-doc a')].find((a) => a.textContent === 'week 2')!.scrollIntoView({ block: 'start' }); });
    await frameA.locator('#orz-doc a', { hasText: 'week 2' }).click();
    await page.waitForFunction(() => (globalThis as unknown as { demo: Demo }).demo.calls.some((c) => c.hook === 'resolveLink'));
    // the live slide card in the preview's corner shows the caret's slide (the image again through resolveAsset)
    await page.evaluate(() => { const a = (globalThis as unknown as { demo: Demo }).demo.editors.a; const t = a.getText(); a.select(t.indexOf('titration'), t.indexOf('titration')); });
    await frameA.waitForFunction(() => { const c = document.getElementById('orz-live'); return !!c && !c.hidden && !!c.querySelector('.orz-page > section[data-fitted]') && (c.textContent ?? '').includes('What a buffer does'); }, null, { timeout: 15_000 });
    expect(await frameA.evaluate(() => document.querySelector('#orz-live img')?.getAttribute('src'))).toBe(`${site.url}/examples/webapp/figures/curve.svg`);

    // upload, AI (whole text, through the API), AI on a selection (the app's button), uid from the app
    const more = await page.evaluate(async () => {
      const demo = (globalThis as unknown as { demo: Demo }).demo;
      const { a, b } = demo.editors;
      const up = await a.uploadAssets([new File(['png'], 'pic one.png', { type: 'image/png' })]);
      const ai = await a.requestAi('sign');
      const uid = await b.ensureUid();
      return { up, ai, aText: a.getText(), uid, bText: b.getText() };
    });
    expect(more.up).toEqual({ ok: true, inserted: ['![pic one](assets/pic%20one.png)'] });
    expect(more.ai).toEqual({ ok: true, op: 'sign' });
    expect(more.aText).toContain('![pic one](assets/pic%20one.png)');
    expect(more.aText).toContain('<!-- slide template=closing -->\n# Thank you\nSigned by the lecture app\n');
    expect(more.uid).toMatch(UID_PATTERN);
    expect(more.bText).toContain(`uid: ${more.uid}`);
    await page.evaluate(() => { const b = (globalThis as unknown as { demo: Demo }).demo.editors.b; b.focus(); const t = b.getText(); b.select(t.indexOf('edited B'), t.indexOf('edited B') + 'edited B'.length); });
    await page.getByRole('button', { name: 'AI: shout selection' }).click();
    await page.waitForFunction(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.getText().includes('EDITED B'));

    // the app's layout op: the caret's slide's first box split into columns — the marker line only, one undo step
    const before = await page.evaluate(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.getText());
    await page.getByRole('button', { name: 'Split into columns' }).click();
    const split = await page.evaluate(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.getText());
    expect(split).toContain('<!-- slide col 1/1 { body; body-2 } -->');
    const lines = (t: string): string[] => t.split(/\r?\n/);
    expect(lines(split).filter((l) => !lines(before).includes(l))).toEqual(['<!-- slide col 1/1 { body; body-2 } -->', '<!-- @body-2 -->']);
    expect(lines(before).filter((l) => !lines(split).includes(l))).toEqual(['<!-- slide -->']);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await page.evaluate(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.getText())).toBe(before);
    // single-slide editing from the app's button: the preview shows, the card enlarges into the stage; again: back
    await page.getByRole('button', { name: 'Single slide' }).click();
    await page.waitForFunction(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.slides.isPerSlide());
    expect(await page.evaluate(() => (globalThis as unknown as { demo: Demo }).demo.editors.b.getMode())).toBe('split');
    let frameB: Frame | null = null;
    for (let i = 0; i < 150 && !frameB; i++) {
      for (const f of page.frames()) {
        if (f !== page.mainFrame() && await f.evaluate(() => document.body.classList.contains('orz-stage') && (document.getElementById('orz-live')?.textContent ?? '').includes('EDITED B')).catch(() => false)) frameB = f;
      }
      if (!frameB) await page.waitForTimeout(100);
    }
    expect(frameB, 'the stage shows the quiz deck\'s slide').not.toBeNull();
    await page.getByRole('button', { name: 'Single slide' }).click();
    await frameB!.waitForFunction(() => !document.body.classList.contains('orz-stage'), null, { timeout: 15_000 });
    // the app's Save button saves the chrome-less editor through its hook
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.waitForFunction(() => { const d = (globalThis as unknown as { demo: Demo }).demo; return d.store.get('b') === d.editors.b.getText(); });

    // Cmd/Ctrl+P in an editor is the app's: the listener runs, the app page never prints
    await page.evaluate(() => { (window as unknown as { __pagePrints: number }).__pagePrints = 0; window.print = () => { (window as unknown as { __pagePrints: number }).__pagePrints++; }; });
    await page.locator('#editor-a .cm-content').first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
    await page.waitForFunction(() => (globalThis as unknown as { demo: Demo }).demo.calls.some((c) => c.hook === 'print'));
    expect(await page.evaluate(() => (window as unknown as { __pagePrints: number }).__pagePrints)).toBe(0);

    const hooks = new Set((await page.evaluate(() => (globalThis as unknown as { demo: Demo }).demo.calls)).map((c) => c.hook));
    expect([...hooks].sort()).toEqual(['ai', 'fetchInclude', 'mintUid', 'print', 'resolveAsset', 'resolveLink', 'save', 'uploadAsset']);
    // the library view: readDocument without rendering, renderPreview (the flattened deck, themed, nonce-stamped) in a sandboxed frame
    expect(await page.locator('#library li').first().textContent()).toContain('Buffers — lecture 3 (doc-webappslides01, theme orchard, 16:9)');
    const thumb = await page.locator('#thumb').getAttribute('srcdoc');
    expect(thumb).toContain('resists pH change');
    expect(thumb).toContain('<style nonce="orz-demo-nonce" data-theme="orchard">');
    expect(thumb).toContain('class="orz-flat-slide"');
    // no CSP violation, no page error, no update check in an app host
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(consoleLines.filter((l) => /Content Security Policy|Refused to/i.test(l))).toEqual([]);
    expect(errors).toEqual([]);
    expect(log.filter((u) => u.includes('release.json'))).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('[X.2] the ESM build mounts the same editor (flattened preview, live card), sets no global, exports the deck templates, the parser and the layout ops, and assembles the Node bytes (cdn; inline with the engine given)', async () => {
    const { page, errors, consoleLines } = await open('/examples/webapp/esm.html', []);
    await page.waitForFunction(() => !!(globalThis as unknown as { demo?: unknown }).demo);
    await frameShowing(page, 'ESM');
    const engine = readFileSync('browser/orz-slides.browser.js', 'utf8');
    const r = await page.evaluate(async (eng) => {
      const d = (globalThis as unknown as { demo: { editor: Ed; saved: string[]; text: string; assemble(t: string, o: unknown): Promise<string>; applyOp(t: string, i: number, op: unknown): { text: string }; parseDeck(t: string): { slides: unknown[] }; version: string; global: unknown } }).demo;
      const changed = `${d.text}\nchanged\n`;
      d.editor.setText(changed);
      const s = await d.editor.save();
      const op = d.applyOp(d.text, 1, { type: 'split', box: 'body', dir: 'row' });
      return { s, saved: d.saved, changed, global: d.global === undefined, slides: d.parseDeck(d.text).slides.length, op: op.text, cdn: await d.assemble(changed, { delivery: 'cdn' }), inline: await d.assemble(changed, { engineSource: eng }) };
    }, engine);
    expect(r.s).toEqual({ ok: true, via: 'hook' });
    expect(r.saved).toEqual([r.changed]);
    expect(r.global).toBe(true);
    expect(r.slides).toBe(2);
    expect(r.op).toContain('<!-- slide row 1/1 { body; body-2 } -->');
    expect(r.cdn === assemble(r.changed, { delivery: 'cdn' })).toBe(true);
    expect(r.inline === assemble(r.changed)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(consoleLines.filter((l) => /Content Security Policy|Refused to/i.test(l))).toEqual([]);
    expect(errors).toEqual([]);
    await page.context().close();
  }, 60_000);
});

describe('the app author\'s guide and the browser package', () => {
  it('[X.3] docs/embedding.md covers install and import (ESM and IIFE), every export, every hook, both editing modes, the layout ops, the CSP recipe, print in an app and versions; the example page carries the strict nonce policy; the types match the guide', () => {
    const doc = readFileSync('docs/embedding.md', 'utf8');
    for (const term of ['npm install orz-slides-browser', 'globalThis.OrzCarrier', 'esm/orz-slides.browser.mjs', 'mountEditor', 'assemble', 'extract', 'readDocument', 'renderPreview', 'newDocument', 'TEMPLATE_IDS',
      'save(text)', 'ai.request', 'fetchInclude', 'resolveAsset', 'uploadAsset', 'resolveLink', 'mintUid', 'nonce', 'Content-Security-Policy', "'strict-dynamic'", 'pins the component version', 'files carry their own shells',
      'flattened', 'live slide card', 'single-slide editing', 'setPerSlide', 'applyOp', 'applyEdits', 'OrzCarrier.layout', 'style-src-attr', 'fonts.gstatic.com', 'print', 'frame-src https://www.youtube.com']) {
      expect(doc, term).toContain(term);
    }
    expect(readFileSync('examples/webapp/index.html', 'utf8')).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-[^']+' 'strict-dynamic'/);
    const types = readFileSync('browser/index.d.ts', 'utf8');
    expect(types).toMatch(/mintUid\?\(\): Promise<string>/);
    expect(types).toMatch(/resolveAsset\?\(path: string\): string;/);
    expect(types).toMatch(/readonly slides: SlidesTools;/);
    expect(types).toMatch(/layout: LayoutApi;/);
    expect(doc).toMatch(/\| `mintUid\(\)` \|[^\n]*\*\*promise\*\* of a `doc-/);
    expect(doc).toMatch(/\| `resolveAsset\(path\)` \|[^\n]*\*\*synchronously\*\*[^\n]*not a promise/);
  });

  it('[X.4] the browser package is publishable: release.json names this version, kind slides, the bundle and the SHA-384 of its exact bytes, the guide is the repository\'s (scripts/check-release.mjs, its prepublishOnly, passes); its exports, files and types are those of orz-paged-browser 1.0; require() throws with the way to load it; both packages have one version', () => {
    const out = execFileSync(process.execPath, ['browser/scripts/check-release.mjs'], { encoding: 'utf8' });
    const pkg = JSON.parse(readFileSync('browser/package.json', 'utf8')) as { version: string; types: string; exports: Record<string, unknown>; files: string[]; scripts: Record<string, string> };
    const cli = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; files: string[] };
    expect(out).toContain(`orz-slides-browser ${pkg.version}: release.json matches the files`);
    expect(pkg.version).toBe(cli.version);
    expect(pkg.scripts['prepublishOnly']).toBe('node scripts/check-release.mjs');
    expect(pkg.types).toBe('index.d.ts');
    expect(pkg.exports['.']).toEqual({ types: './index.d.ts', import: './esm/orz-slides.browser.mjs', require: './require.cjs', default: './orz-slides.browser.js' });
    expect(pkg.files.sort()).toEqual(['LICENSE', 'README.md', 'docs/embedding.md', 'esm/orz-slides.browser.mjs', 'index.d.ts', 'orz-slides.browser.js', 'release.json', 'require.cjs']);
    expect(readFileSync('browser/docs/embedding.md', 'utf8')).toBe(readFileSync('docs/embedding.md', 'utf8'));
    expect(() => execFileSync(process.execPath, ['-e', "require('./browser/require.cjs')"], { stdio: 'pipe' })).toThrow(/require\(\) is not supported/);
    expect(cli.files).toContain('docs/embedding.md');
  });
});
