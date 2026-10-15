/**
 * Editing mode (a), whole deck (rebuild step 5; claims W.1–W.9), in real
 * Chrome, OFFLINE (D-63: no host resolves; only CodeMirror is served from
 * the installed orz-markdown, as its pinned jsDelivr URL — the kit's
 * 2.4.0 is not on the CDN yet). The editor is the kit's shell with the
 * flattened preview, the live view of the caret's slide, the lints with
 * their quick fixes, and the per-slide mode's entry point.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { assemble, extract } from '../src/lib.js';
import { corpus, launchChrome } from './helpers.js';

type Browser = NonNullable<Awaited<ReturnType<typeof launchChrome>>>;
type Page = import('playwright-core').Page;
type Frame = import('playwright-core').Frame;
type BrowserContext = import('playwright-core').BrowserContext;

const browser = await launchChrome(); // offline: no host resolves (D-63)
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-editor-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;
const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(dir, 'gpc-traces.svg'));

/** The save picker: an in-memory file (OPFS is refused on file: pages); `window.__orzSaved` holds what was written. */
const PICKER_INIT = `(() => {
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value: function (o) {
    var name = (o && o.suggestedName) || 'picked.html';
    window.__orzPicked = name;
    var h = { kind: 'file', name: name,
      getFile: function () { return Promise.resolve({ text: function () { return Promise.resolve(window.__orzSaved || ''); } }); },
      createWritable: function () { var buf = ''; return Promise.resolve({ write: function (d) { buf += String(d); return Promise.resolve(); }, close: function () { window.__orzSaved = buf; return Promise.resolve(); } }); } };
    return Promise.resolve(h);
  } });
})();`;

/** A context that serves CodeMirror (and the kit's other vendored files) from the installed orz-markdown; everything else off the machine is refused. */
async function context(b: Browser, o: { picker?: boolean; viewport?: { width: number; height: number }; noCodeMirror?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await b.newContext({ viewport: o.viewport ?? { width: 1440, height: 900 } });
  if (o.picker) await ctx.addInitScript(PICKER_INIT);
  await ctx.route(/^https?:\/\//, (r) => {
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/orz-markdown@[^/]+\/(vendor\/.+)$/.exec(r.request().url());
    const f = m && !o.noCodeMirror ? join('node_modules/orz-markdown', m[1]) : '';
    if (f && existsSync(f)) return r.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': extname(f) === '.css' ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' } });
    return r.abort();
  });
  return ctx;
}

type G = { OrzCarrier: { standalone: { ready: Promise<void>; edit(): Ed; leave(): Promise<void>; editor(): Ed | null; view: { engine: { go(i: number): void; index(): number } } } } };
type Ed = {
  ready: Promise<{ engine: string }>; getText(): string; setText(t: string): void; select(a: number, b: number, o?: { scroll?: boolean }): void; focus(): void;
  undo(): boolean; redo(): boolean; isDirty(): boolean; save(): Promise<{ ok: boolean; via?: string; error?: string }>; setHeader(c: Record<string, string>): void;
  slides: { caretSlide(): number; lints(): Array<{ code: string; line?: number; fix?: unknown; level: string }>; refreshLints(): Array<{ code: string; line?: number; fix?: unknown; level: string }>; applyFix(l: { code: string; line?: number }): boolean; isLive(): boolean; setLive(on: boolean): void; isPerSlide(): boolean; setPerSlide(on: boolean): void; lastFit(): { index: number; boxes: Array<{ scale: number; clipped: boolean }>; footerCut: boolean } | null };
};

/** Open an assembled deck, enter edit mode and wait for CodeMirror and the preview's first render. */
async function openEditor(name: string, text: string, o: { picker?: boolean; slide?: number; viewport?: { width: number; height: number }; noCodeMirror?: boolean } = {}): Promise<{ page: Page; ctx: BrowserContext; frame: Frame; errors: string[]; path: string }> {
  const path = join(dir, name);
  writeFileSync(path, assemble(text), 'utf8');
  const ctx = await context(browser!, o);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${path}`);
  await page.waitForFunction(() => (globalThis as unknown as { OrzCarrier?: { standalone?: unknown } }).OrzCarrier?.standalone !== undefined);
  await page.evaluate(() => (globalThis as unknown as G).OrzCarrier.standalone.ready);
  if (o.slide !== undefined) {
    await page.evaluate((i) => (globalThis as unknown as G).OrzCarrier.standalone.view.engine.go(i), o.slide);
    await page.waitForFunction((i) => (globalThis as unknown as G).OrzCarrier.standalone.view.engine.index() === i, o.slide);
  }
  const engine = await page.evaluate(async () => (await (globalThis as unknown as G).OrzCarrier.standalone.edit().ready).engine);
  expect(engine).toBe(o.noCodeMirror ? 'textarea' : 'codemirror6');
  const frame = await previewFrame(page);
  return { page, ctx, frame, errors, path };
}

async function previewFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find((x) => x !== page.mainFrame());
    if (f && await f.evaluate(() => document.querySelectorAll('#orz-doc .orz-flat-slide').length).catch(() => 0) > 0) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('no flattened preview');
}

/** The live card's state in the frame. */
const liveState = (frame: Frame) => frame.evaluate(() => {
  const card = document.getElementById('orz-live')!;
  const s = card.querySelector<HTMLElement>('.orz-page > section');
  const deck = card.querySelector<HTMLElement>('.orz-live-deck')!;
  return {
    hidden: card.hidden,
    head: card.querySelector('.orz-live-n')?.textContent ?? '',
    badge: card.querySelector('.orz-live-badge')?.textContent ?? '',
    n: s?.getAttribute('data-n') ?? null,
    fitted: !!s?.hasAttribute('data-fitted'),
    w: s?.offsetWidth ?? 0, h: s?.offsetHeight ?? 0,
    scales: Array.from(s?.querySelectorAll('.orz-box') ?? []).map((b) => b.getAttribute('data-scale')),
    transform: deck.style.transform,
    cardW: card.querySelector<HTMLElement>('.orz-live-port')!.clientWidth,
    text: s?.textContent ?? '',
    stage: document.body.classList.contains('orz-stage'),
  };
});

const ed = <T>(page: Page, fn: (e: Ed) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(globalThis.OrzCarrier.standalone.editor())`) as Promise<T>;

/** A 100-slide deck of every kind of slide (no network content: lists, tables, code, math, regions, notes). */
function bigDeck(n = 100): string {
  const out = ['{{nyml', 'kind: document', 'carrier: slides', 'uid: doc-typing0100slides', 'title: A hundred slides', 'theme: orchard', 'footer: Typing test', '}}', ''];
  for (let i = 0; i < n; i++) {
    const k = i % 5;
    if (k === 0) out.push(`<!-- slide -->`, `## Slide ${i + 1}: a list`, ...Array.from({ length: 5 }, (_, j) => `- point ${j + 1} of slide ${i + 1} with a few words`), '');
    else if (k === 1) out.push(`<!-- slide 2col -->`, `## Slide ${i + 1}: two columns`, '<!-- @left -->', `Left text of slide ${i + 1}, a paragraph of moderate length to wrap.`, '<!-- @right -->', '| a | b |', '|---|---|', `| ${i} | ${i * 2} |`, '');
    else if (k === 2) out.push(`<!-- slide -->`, `## Slide ${i + 1}: code`, '```python', `def f${i}(x):`, `    return x * ${i}`, '```', '<!-- @notes -->', `Notes for slide ${i + 1}.`, '');
    else if (k === 3) out.push(`<!-- slide main-side -->`, `## Slide ${i + 1}: math`, `$$E_${i} = m c^2$$`, '<!-- @side -->', `Inline $x_${i}$ and **bold**.`, '');
    else out.push(`<!-- slide template=section -->`, `# Part ${i + 1}`, 'A section page', '');
  }
  return out.join('\n');
}

chrome('editing mode (a), whole deck (real Chrome, offline)', () => {
  it('[W.1] Edit mounts the kit\'s editor shell for a slides document — CodeMirror, the flattened preview in the sandboxed frame with the header\'s slide theme, the slides tools (Issues, Live slide, This slide) next to the settings, the seal and the GitHub link of edit mode — and an app\'s own mountEditor (hooks.save) gets the same editor', async () => {
    const { page, ctx, frame, errors } = await openEditor('w1.slides.html', SAMPLE);
    const label = (sel: string) => page.locator(sel).getAttribute('aria-label');
    await expect.poll(() => label('[data-orz-slides-lint]'), { timeout: 10_000 }).toBe('Issues: none');
    const shell = {
      issues: await label('[data-orz-slides-lint]'), live: await label('[data-orz-slides-live]'), slide: await label('[data-orz-slides-per-slide]'),
      pressed: await page.locator('[data-orz-slides-live]').getAttribute('aria-pressed'),
      theme: await page.locator('button[aria-label="Theme"]').count() === 1,
      github: await page.locator('a[href="https://github.com/wangyu16/orz-slides"]').count() > 0 && await page.locator('a[href^="https://markdown.orz.how"]').count() > 0,
      sandbox: await page.locator('iframe').getAttribute('sandbox'),
    };
    expect(shell.issues).toBe('Issues: none');
    expect(shell.live).toBe('Live slide');
    expect(shell.slide).toBe('This slide');
    expect(shell.pressed).toBe('true');
    expect(shell.theme).toBe(true);
    expect(shell.github).toBe(true);
    expect(shell.sandbox).toMatch(/allow-scripts/);
    const f = await frame.evaluate(() => ({
      article: document.getElementById('orz-doc')!.className,
      dividers: document.querySelectorAll('#orz-doc .orz-flat-slide').length,
      theme: document.getElementById('orz-slide-theme')?.getAttribute('data-theme'),
      deckCss: !!document.getElementById('orz-deck-css'),
    }));
    expect(f).toEqual({ article: 'markdown-body orz-flat', dividers: 12, theme: 'orchard', deckCss: true });
    expect(errors).toEqual([]);
    await ctx.close();

    // an app's page: the IIFE by URL, mountEditor with hooks.save
    copyFileSync('dist/orz-slides.browser.js', join(dir, 'orz-slides.browser.js'));
    writeFileSync(join(dir, 'app.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="host" style="height:700px"></div><script src="orz-slides.browser.js"></script></body></html>');
    const ctx2 = await context(browser!);
    const app = await ctx2.newPage();
    const appErrors: string[] = [];
    app.on('pageerror', (e) => appErrors.push(String(e)));
    await app.goto(`file://${join(dir, 'app.html')}`);
    const got = await app.evaluate(async (text) => {
      const C = (globalThis as unknown as { OrzCarrier: { mountEditor(el: Element, o: unknown): Ed } }).OrzCarrier;
      const saved: string[] = [];
      const e = C.mountEditor(document.getElementById('host')!, { text, hooks: { save: async (t: string) => { saved.push(t); } } });
      (globalThis as unknown as { __saved: string[] }).__saved = saved;
      await e.ready;
      return { tools: typeof e.slides?.caretSlide, text: e.getText() === text };
    }, SAMPLE);
    expect(got).toEqual({ tools: 'function', text: true });
    const appFrame = await previewFrame(app);
    expect(await appFrame.evaluate(() => document.querySelectorAll('#orz-doc .orz-flat-slide').length)).toBe(12);
    expect(appErrors).toEqual([]);
    await ctx2.close();
  });

  it('[W.2] the flattened preview in the frame: a divider per slide with its number and title, a label per region, the speaker notes and slide footers apart, the in-slide layout ignored (no grid, no fit)', async () => {
    const c = corpus('slides').find((x) => x.path.endsWith('notes-and-fragments.slides.md'))!;
    const { page, ctx, frame, errors } = await openEditor('w2.slides.html', c.text);
    const f = await frame.evaluate(() => ({
      dividers: Array.from(document.querySelectorAll('#orz-doc > .orz-flat-slide')).map((d) => `${d.querySelector('.orz-flat-n')!.textContent} ${d.querySelector('.orz-flat-t')!.textContent}`),
      regions: Array.from(document.querySelectorAll('#orz-doc .orz-flat-region')).map((d) => d.textContent),
      notes: document.querySelectorAll('#orz-doc > aside.orz-flat-notes').length,
      footers: document.querySelectorAll('#orz-doc > .orz-flat-footer').length,
      grid: document.querySelectorAll('#orz-doc .orz-split, #orz-doc .orz-box').length,
      dividerHeight: (document.querySelector('#orz-doc > .orz-flat-slide') as HTMLElement).offsetHeight,
    }));
    expect(f.dividers.length).toBe(c.slideCount);
    expect(f.dividers[0]).toBe('1 Titration Lab Briefing');
    expect(f.dividers[3]).toBe('4 Stepped two columns');
    expect(f.regions).toEqual(expect.arrayContaining(['left', 'right']));
    const notes = (c.text.match(/<!-- @notes -->/g) ?? []).length;
    const footers = (c.text.match(/<!-- @footer -->/g) ?? []).length;
    expect(f.notes).toBe(notes);
    expect(f.footers).toBe(footers);
    expect(f.grid).toBe(0);
    expect(f.dividerHeight).toBeLessThan(40);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.3] scroll sync works as for md: the editor scrolled to a slide brings that slide\'s divider to the preview\'s top, and the reader\'s wheel in the preview scrolls the editor to the slide it shows', async () => {
    const { page, ctx, frame, errors } = await openEditor('w3.slides.html', SAMPLE);
    // the editor scrolled so that slide 5's marker is its top line
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('<!-- slide 2col 3/2 -->'); e.select(i, i, { scroll: true }); });
    const marker = page.locator('.cm-line', { hasText: '<!-- slide 2col 3/2 -->' });
    await marker.waitFor();
    await page.locator('.cm-scroller').evaluate((sc, y) => { sc.scrollTop += y - sc.getBoundingClientRect().top; }, (await marker.boundingBox())!.y);
    // the kit maps the editor's top line through the anchors (the dividers and blocks of the flattened flow)
    await frame.waitForFunction(() => {
      const d = document.querySelector<HTMLElement>('#orz-doc > .orz-flat-slide[data-slide="4"]')!;
      const top = d.getBoundingClientRect().top;
      return top > -60 && top < 160;
    }, undefined, { timeout: 10_000 });
    // the reader scrolls the preview back to slide 2: the editor follows
    // (the editor has the focus since Edit: the reader's click in the preview hands the scroll to it, as for md)
    const fb = (await page.locator('iframe').boundingBox())!;
    await page.mouse.click(fb.x + 8, fb.y + fb.height / 3);
    await page.mouse.move(fb.x + fb.width / 3, fb.y + fb.height / 3);
    for (let i = 0; i < 30; i++) {
      const top = await frame.evaluate(() => document.querySelector<HTMLElement>('#orz-doc > .orz-flat-slide[data-slide="1"]')!.getBoundingClientRect().top);
      if (top > 0) break;
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(800);
    const visible = await page.locator('.cm-scroller').evaluate((sc) => {
      const r = sc.getBoundingClientRect();
      return Array.from(sc.querySelectorAll<HTMLElement>('.cm-line')).filter((l) => { const b = l.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom; }).map((l) => l.textContent).join('\n');
    });
    expect(visible).toMatch(/slide template=outline|## Today|template=title/);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.4] the live view follows the caret: the caret\'s slide, rendered by the engine at its logical size, scaled to its card, fitted (every box reports its scale), with its fit badge; typing shows after a pause; the reader preference hides it and is remembered', async () => {
    const { page, ctx, frame, errors } = await openEditor('w4.slides.html', SAMPLE);
    const caretOn = (needle: string) => page.evaluate((s) => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf(s); e.select(i, i); e.focus(); }, needle);
    for (const [needle, i] of [['## The RAFT equilibrium', 4], ['## Choosing a RAFT agent', 10], ['# Molecular-weight control', 5]] as const) {
      await caretOn(needle);
      await frame.waitForFunction((n) => document.querySelector('#orz-live .orz-page > section')?.getAttribute('data-n') === String(n) && !!document.querySelector('#orz-live .orz-live-badge:not(:empty)'), i + 1, { timeout: 10_000 });
      const s = await liveState(frame);
      expect(s.hidden).toBe(false);
      expect(s.head).toBe(`Slide ${i + 1} of 12`);
      expect(s.fitted).toBe(true);
      expect([s.w, s.h]).toEqual([1280, 720]);
      expect(s.scales.length).toBeGreaterThan(0);
      expect(s.scales.every((x) => x !== null)).toBe(true);
      expect(Number(/scale\(([\d.]+)\)/.exec(s.transform)![1])).toBeCloseTo(s.cardW / 1280, 4);
      expect(s.badge).toMatch(/fits|shrunk to \d+%|cut on paper|footer cut/);
      await page.waitForFunction((n) => (globalThis as unknown as G).OrzCarrier.standalone.editor()!.slides.lastFit()?.index === n, i);
      expect(await ed(page, (e) => e.slides.caretSlide())).toBe(i);
    }
    // the dense slide is scaled by fit, and the badge says so
    await caretOn('## Choosing a RAFT agent');
    await frame.waitForFunction(() => /shrunk to \d+%/.test(document.querySelector('#orz-live .orz-live-badge')?.textContent ?? ''), undefined, { timeout: 10_000 });
    // typing: the live view shows it after the pause
    await page.keyboard.press('End');
    await page.keyboard.type(' zqzq');
    await frame.waitForFunction(() => (document.querySelector('#orz-live .orz-page > section')?.textContent ?? '').includes('zqzq'), undefined, { timeout: 10_000 });
    // the preference: off hides the card, and an editor opened again keeps it off
    await page.evaluate(() => { (globalThis as unknown as G).OrzCarrier.standalone.editor()!.slides.setLive(false); });
    await frame.waitForFunction(() => document.getElementById('orz-live')!.hidden);
    await page.evaluate(async () => { await (globalThis as unknown as G).OrzCarrier.standalone.leave(); (globalThis as unknown as G).OrzCarrier.standalone.edit(); });
    const again = await previewFrame(page);
    await page.waitForTimeout(800);
    expect(await ed(page, (e) => e.slides.isLive())).toBe(false);
    expect((await liveState(again)).hidden).toBe(true);
    await page.evaluate(() => { (globalThis as unknown as G).OrzCarrier.standalone.editor()!.slides.setLive(true); });
    await again.waitForFunction(() => !document.getElementById('orz-live')!.hidden && !!document.querySelector('#orz-live .orz-page > section'));
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.5] lints surface in the editor (Issues, with their count): the deck\'s own — a marker-hygiene quick fix applied from the panel is ONE undo step — and the live view\'s: a slide cut on paper and a cut footer', async () => {
    const text = SAMPLE.replace('footer: CHEM 512 · Controlled radical polymerization', 'footer: CHEM 512 · Controlled radical polymerization · Fall 2026 · University of Louisiana at Lafayette · Department of Chemistry · Room 201 · Tuesdays and Thursdays')
      + '\n<div class="note">\nA raw HTML block\n<!-- slide -->\n## Swallowed\n\n<!-- slide fit=off -->\n## Too much\n' + Array.from({ length: 30 }, (_, i) => `- item ${i + 1} with some words to fill the line`).join('\n') + '\n';
    const { page, ctx, frame, errors } = await openEditor('w5.slides.html', text);
    // the deck's lint, with its fix, in the panel
    await expect.poll(() => page.locator('[data-orz-slides-lint]').getAttribute('aria-label'), { timeout: 10_000 }).toMatch(/Issues: [1-9]/);
    const lints = await ed(page, (e) => e.slides.refreshLints().map((l) => `${l.code}:${l.fix ? 'fix' : ''}`));
    expect(lints).toContain('marker-in-html:fix');
    const before = await ed(page, (e) => e.getText());
    await page.locator('[data-orz-slides-lint]').click();
    await page.locator('.orz-slides-lint__item[data-code="marker-in-html"] [data-fix]').click();
    const after = await ed(page, (e) => e.getText());
    expect(after).toBe(before.replace('A raw HTML block\n<!-- slide -->', 'A raw HTML block\n\n<!-- slide -->'));
    expect(await ed(page, (e) => e.slides.refreshLints().some((l) => l.code === 'marker-in-html'))).toBe(false);
    expect(await ed(page, (e) => e.slides.refreshLints().filter((l) => l.code === 'unknown-option' || l.level === 'error').length)).toBe(0);
    // one undo step back to the exact text, and redo
    expect(await ed(page, (e) => e.undo())).toBe(true);
    expect(await ed(page, (e) => e.getText())).toBe(before);
    expect(await ed(page, (e) => e.redo())).toBe(true);
    expect(await ed(page, (e) => e.getText())).toBe(after);
    // the live view's lints: the caret on the fit=off slide, then on another slide with the deck footer
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('## Too much'); e.select(i, i); });
    await page.waitForFunction(() => (globalThis as unknown as G).OrzCarrier.standalone.editor()!.slides.refreshLints().some((l) => l.code === 'cut-on-paper'), undefined, { timeout: 10_000 });
    expect(await liveState(frame).then((s) => s.badge)).toBe('cut on paper');
    await page.waitForFunction(() => (globalThis as unknown as G).OrzCarrier.standalone.editor()!.slides.refreshLints().some((l) => l.code === 'footer-cut'), undefined, { timeout: 10_000 });
    const fitLints = await ed(page, (e) => e.slides.refreshLints().filter((l) => l.code === 'cut-on-paper' || l.code === 'footer-cut').map((l) => ({ code: l.code, line: l.line, level: l.level })));
    const tooMuch = after.split('\n').findIndex((l) => l === '<!-- slide fit=off -->') + 1;
    expect(fitLints).toEqual(expect.arrayContaining([{ code: 'cut-on-paper', line: tooMuch, level: 'warning' }]));
    // the deck footer's lint: one, at the first slide it is cut on (round B: every slide is checked, B-ED-3)
    expect(fitLints.filter((l) => l.code === 'footer-cut')).toHaveLength(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.6] save round trip through the editor: a format-1 text twin (BOM, CR LF) is saved byte-exact — unedited, and edited then undone; an edit is saved as the editor\'s exact text', async () => {
    const text = '﻿' + SAMPLE.replace(/\n/g, '\r\n');
    const { page, ctx, errors } = await openEditor('w6.slides.html', text, { picker: true });
    expect(await ed(page, (e) => e.getText())).toBe(text);
    const readSaved = () => page.evaluate(() => (globalThis as unknown as { __orzSaved: string }).__orzSaved);
    // edited then undone: the exact text, clean
    await page.locator('.cm-content').click();
    await page.keyboard.type('xyz');
    for (let i = 0; i < 3; i++) await ed(page, (e) => e.undo());
    expect(await ed(page, (e) => e.getText())).toBe(text);
    await page.locator('.cm-content').press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+s`);
    await page.waitForFunction(() => typeof (globalThis as unknown as { __orzSaved?: string }).__orzSaved === 'string');
    let x = extract(await readSaved())!;
    expect(x.text === text).toBe(true);
    // an edit: the saved text is the editor's, in the document's line endings and BOM
    await ed(page, (e) => { const t = e.getText(); const i = t.indexOf('## Today') + '## Today'.length; e.select(i, i); });
    await page.keyboard.type(' (edited)');
    await page.locator('.cm-content').press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+s`);
    await expect.poll(() => ed(page, (e) => e.isDirty())).toBe(false);
    x = extract(await readSaved())!;
    const now = await ed(page, (e) => e.getText());
    expect(x.text === now).toBe(true);
    expect(now).toContain('## Today (edited)\r\n');
    expect(now.startsWith('﻿')).toBe(true);
    expect(now.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.7] typing stays fast on a 100-slide deck: per-key round trip p90 ≤ 100 ms, no long task over 200 ms while typing (the live view and the lints wait for a pause, never per key); the preview and the live view catch up after', async () => {
    const deck = bigDeck(100);
    const { page, ctx, frame, errors } = await openEditor('w7.slides.html', deck);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('Left text of slide 52'); e.select(i, i, { scroll: true }); e.focus(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const w = window as unknown as { __lt: number[] };
      w.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
    });
    const trip: number[] = [];
    let typed = '';
    for (let i = 0; i < 60; i++) {
      const c = 'kq'[i % 2]!;
      const k0 = Date.now();
      await page.keyboard.type(c);
      trip.push(Date.now() - k0);
      typed += c;
      await page.waitForTimeout(i % 15 === 14 ? 700 : 110);
    }
    const lt = await page.evaluate(() => [...(window as unknown as { __lt: number[] }).__lt]);
    const ks = [...trip].sort((a, b) => a - b);
    const p90 = ks[Math.floor(ks.length * 0.9)]!;
    const t0 = Date.now();
    await frame.waitForFunction((s) => (document.getElementById('orz-doc')!.textContent ?? '').includes(s), typed, { timeout: 30_000, polling: 200 });
    await frame.waitForFunction((s) => (document.querySelector('#orz-live .orz-page > section')?.textContent ?? '').includes(s), typed, { timeout: 30_000, polling: 200 });
    // eslint-disable-next-line no-console
    console.log(`[W.7] 100 slides: per key median ${ks[30]} ms, p90 ${p90} ms, max ${ks[ks.length - 1]} ms; long tasks while typing: ${lt.join(', ') || 'none'}; preview and live view caught up ${Date.now() - t0} ms after the last key`);
    expect(p90).toBeLessThanOrEqual(100);
    expect(ks[ks.length - 1]).toBeLessThanOrEqual(250);
    expect(lt.filter((d) => d > 200)).toEqual([]);
    expect((await liveState(frame)).head).toBe('Slide 52 of 100');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);

  it('[W.8] the read view and the edit view keep the slide: Edit puts the caret on the slide the deck showed (the live view shows it), and Done returns the deck to the caret\'s slide', async () => {
    const { page, ctx, frame, errors } = await openEditor('w8.slides.html', SAMPLE, { slide: 6 });
    expect(await ed(page, (e) => e.slides.caretSlide())).toBe(6);
    const caretLine = (await page.locator('.cm-activeLine').first().textContent()) ?? '';
    expect(caretLine.startsWith('## Predicting')).toBe(true);
    await frame.waitForFunction(() => document.querySelector('#orz-live .orz-page > section')?.getAttribute('data-n') === '7', undefined, { timeout: 10_000 });
    // the caret to slide 10, then Done
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('## Choosing a RAFT agent'); e.select(i, i); });
    await page.evaluate(() => (globalThis as unknown as G).OrzCarrier.standalone.leave());
    await page.waitForFunction(() => (globalThis as unknown as G).OrzCarrier.standalone.view.engine.index() === 10 && document.querySelector('.reveal .slides > section.present')?.getAttribute('data-n') === '11', undefined, { timeout: 10_000 });
    expect(await page.evaluate(() => document.getElementById('orz-view')!.hidden)).toBe(false);
    // and back: Edit again opens on slide 11's text
    await page.evaluate(() => (globalThis as unknown as G).OrzCarrier.standalone.edit());
    expect(await ed(page, (e) => e.slides.caretSlide())).toBe(10);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.9] the per-slide mode\'s entry point (the step-6 seam): This slide dims the text outside the caret\'s slide in the SAME editor (setFocusRange; one history) and shows the slide as the stage; it follows the caret to another slide; off restores the whole deck', async () => {
    const { page, ctx, frame, errors } = await openEditor('w9.slides.html', SAMPLE);
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('## The RAFT equilibrium'); e.select(i, i, { scroll: true }); });
    await page.locator('[data-orz-slides-per-slide]').click();
    expect(await ed(page, (e) => e.slides.isPerSlide())).toBe(true);
    await frame.waitForFunction(() => document.body.classList.contains('orz-stage') && document.querySelector('#orz-live .orz-page > section')?.getAttribute('data-n') === '5', undefined, { timeout: 10_000 });
    await expect.poll(() => page.locator('.cm-content .orz-focus-outside').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await page.locator('.cm-line', { hasText: '## The RAFT equilibrium' }).locator('.orz-focus-outside').count()).toBe(0);
    // the stage follows the caret; an edit there is one undo step of the same history
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('## Why control matters'); e.select(i, i); e.focus(); });
    await frame.waitForFunction(() => document.querySelector('#orz-live .orz-page > section')?.getAttribute('data-n') === '4', undefined, { timeout: 10_000 });
    const before = await ed(page, (e) => e.getText());
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    expect(await ed(page, (e) => e.undo())).toBe(true);
    expect(await ed(page, (e) => e.getText())).toBe(before);
    await page.locator('[data-orz-slides-per-slide]').click();
    await frame.waitForFunction(() => !document.body.classList.contains('orz-stage'));
    await expect.poll(() => page.locator('.cm-content .orz-focus-outside').count()).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  /* ───────────────────────── closed-loop round B (rebuild/1.0@6accc1f): the probes of the whole-deck editor ───────────────────────── */

  const SIX = `{{nyml\nkind: document\ncarrier: slides\nuid: doc-roundbeditor01\ntitle: Caret\n}}\n\n${Array.from({ length: 6 }, (_, i) => `<!-- slide -->\n## Title ${i + 1}\n\nBody ${i + 1}\n`).join('\n')}`;

  it('[W.8] round B, B-ED-2: a header setting (Section numbers, a footer) changed while editing keeps the caret\'s slide — the live view, the per-slide stage and Done stay on it', async () => {
    const { page, ctx, frame, errors } = await openEditor('rb-caret.slides.html', SIX, { slide: 3 });
    expect(await ed(page, (e) => e.slides.caretSlide())).toBe(3);
    await ed(page, (e) => e.setHeader({ section_numbers: 'roman' }));
    await page.waitForTimeout(800);
    expect(await ed(page, (e) => e.slides.caretSlide())).toBe(3);
    await frame.waitForFunction(() => (document.querySelector('#orz-live .orz-live-n')?.textContent ?? '') === 'Slide 4 of 6', undefined, { timeout: 10_000 });
    await ed(page, (e) => e.slides.setPerSlide(true));
    await ed(page, (e) => e.setHeader({ footer: 'A footer long enough to shift everything by more than one slide marker' }));
    await page.waitForTimeout(800);
    expect(await ed(page, (e) => e.slides.caretSlide())).toBe(3);
    await ed(page, (e) => e.slides.setPerSlide(false));
    await page.evaluate(() => (globalThis as unknown as G).OrzCarrier.standalone.leave());
    await page.waitForFunction(() => (globalThis as unknown as G).OrzCarrier.standalone.view.engine.index() === 3, undefined, { timeout: 10_000 });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[W.5] round B, B-ED-3: the fit lints cover the whole deck — slides never shown at the caret are checked in idle time (one at a time, after a pause), the deck footer\'s lint names every slide it is cut on, and the panel says how many slides were checked', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `- point ${i + 1} with enough words to take a whole line of the slide`).join('\n');
    const over = Array.from({ length: 30 }, (_, i) => `- item ${i + 1} with some words`).join('\n');
    const text = `{{nyml\nkind: document\ncarrier: slides\nuid: doc-roundbeditor03\ntitle: Cut\nfooter: A deck footer that is far too long for its one line in the bottom slot of every single slide of this deck, and then some more words\n}}\n\n<!-- slide -->\n## One\nx\n\n<!-- slide -->\n## Two\nx\n\n<!-- slide -->\n## Three\nx\n\n<!-- slide -->\n## Four\n${long}\n\n<!-- slide fit=off -->\n## Five\n${over}\n\n<!-- slide -->\n## Six\nx\n`;
    const { page, ctx, errors } = await openEditor('rb-cut.slides.html', text);
    const coverage = () => ed(page, (e) => (e.slides as unknown as { fitCoverage?(): { checked: number; total: number } }).fitCoverage?.() ?? null);
    await expect.poll(coverage, { timeout: 30_000 }).toEqual({ checked: 6, total: 6 });
    const lints = await ed(page, (e) => e.slides.refreshLints().filter((l) => l.code === 'cut-on-paper' || l.code === 'footer-cut').map((l) => (l as unknown as { message: string }).message));
    expect(lints.some((m) => /slide 4 /.test(m))).toBe(true);
    expect(lints.some((m) => /slide 5 /.test(m))).toBe(true);
    expect(lints.some((m) => /slides 1, 2, 3, 4, 5 and 6/.test(m))).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[W.7] round B, B-ED-4: typing in the per-slide mode stays fast on a 300-slide deck: per key p90 ≤ 100 ms, max ≤ 250 ms, no long task over 200 ms (the layout GUI follows the typing at its pause)', async () => {
    const deck = bigDeck(300);
    const { page, ctx, errors } = await openEditor('rb-type.slides.html', deck);
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('Left text of slide 152'); e.select(i, i, { scroll: true }); e.focus(); });
    await ed(page, (e) => e.slides.setPerSlide(true));
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()!; const i = e.getText().indexOf('Left text of slide 152'); e.select(i, i); e.focus(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const w = window as unknown as { __lt: number[] }; w.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
    const trip: number[] = [];
    for (let i = 0; i < 60; i++) {
      const k0 = Date.now();
      await page.keyboard.type('kq'[i % 2]!);
      trip.push(Date.now() - k0);
      await page.waitForTimeout(i % 15 === 14 ? 700 : 110);
    }
    const lt = await page.evaluate(() => [...(window as unknown as { __lt: number[] }).__lt]);
    const ks = [...trip].sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(`[W.7] B-ED-4 300 slides, per-slide mode: per key median ${ks[30]} ms, p90 ${ks[54]} ms, max ${ks[59]} ms; long tasks: ${lt.join(', ') || 'none'}`);
    expect(ks[54]).toBeLessThanOrEqual(100);
    expect(ks[59]).toBeLessThanOrEqual(250);
    expect(lt.filter((d) => d > 200)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);

  it('[W.9] round B, B-ED-5: with the basic (textarea) editor, This slide brings the slide\'s text into view and says that the rest of the deck is not dimmed', async () => {
    const { page, ctx, errors } = await openEditor('rb-ta.slides.html', SIX, { slide: 4, noCodeMirror: true });
    await ed(page, (e) => e.slides.setPerSlide(true));
    await page.waitForTimeout(1200);
    const ta = await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()! as unknown as { root: ShadowRoot; getText(): string }; const t = e.root.querySelector('textarea')!; const i = e.getText().indexOf('## Title 5'); return { start: t.selectionStart, at: i, top: t.scrollTop, line: t.value.slice(0, i).split('\n').length - 1, lh: parseFloat(getComputedStyle(t).lineHeight) || 20, h: t.clientHeight }; });
    expect(Math.abs(ta.start - ta.at)).toBeLessThanOrEqual(12);
    expect(ta.line * ta.lh).toBeGreaterThanOrEqual(ta.top - ta.lh);
    expect(ta.line * ta.lh).toBeLessThanOrEqual(ta.top + ta.h);
    const status = await page.evaluate(() => { const e = (globalThis as unknown as G).OrzCarrier.standalone.editor()! as unknown as { root: ShadowRoot }; return e.root.querySelector('.orz-lg-msg')?.textContent ?? ''; });
    expect(status).toMatch(/not dimmed/);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});
