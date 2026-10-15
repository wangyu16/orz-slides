/**
 * Editing mode (b), per slide: the layout GUI (rebuild step 6; claims
 * L.7–L.12) in real Chrome, OFFLINE (D-63; only CodeMirror is served from
 * the installed orz-markdown, as its pinned jsDelivr URL). An app's page
 * mounts the editor (`mountEditor` with `hooks.save`: the preview frame is
 * `sandbox="allow-scripts"`, an opaque origin) and turns on This slide; every
 * op is driven by the reader's own pointer, touch and keys.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { launchChrome } from './helpers.js';
import { parseDeck } from '../src/deck/parse.js';
import { slideMap } from '../src/layout-ops.js';

type Browser = NonNullable<Awaited<ReturnType<typeof launchChrome>>>;
type Page = import('playwright-core').Page;
type Frame = import('playwright-core').Frame;
type BrowserContext = import('playwright-core').BrowserContext;

const browser = await launchChrome(); // offline: no host resolves (D-63)
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-gui-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;
const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
let staged = false;

interface GuiState {
  slide: number; total: number; selection: unknown; boxes: string[]; floats: number; dividers: number;
  stage: { x: number; y: number; w: number; h: number; scale: number }; insets: { top: number; left: number; bottom: number; right: number };
  status: string; template: string | null; blocked: string | null; stale: boolean; strip: number[];
}

async function context(b: Browser, o: { viewport?: { width: number; height: number }; touch?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await b.newContext({ viewport: o.viewport ?? { width: 1500, height: 900 }, ...(o.touch ? { hasTouch: true } : {}) });
  await ctx.route(/^https?:\/\//, (r) => {
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/orz-markdown@[^/]+\/(vendor\/.+)$/.exec(r.request().url());
    const f = m ? join('node_modules/orz-markdown', m[1]) : '';
    if (f && existsSync(f)) return r.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': extname(f) === '.css' ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' } });
    return r.abort();
  });
  return ctx;
}

/** An app's page with the editor mounted (hooks.save), the caret at `at`, This slide on; the GUI attached and drawn. */
async function openApp(text: string, at: string, o: { viewport?: { width: number; height: number }; touch?: boolean } = {}): Promise<{ page: Page; ctx: BrowserContext; frame: Frame; errors: string[] }> {
  if (!staged) {
    copyFileSync('dist/orz-slides.browser.js', join(dir, 'orz-slides.browser.js'));
    writeFileSync(join(dir, 'app.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#host{height:100vh}</style></head><body><div id="host"></div><script src="orz-slides.browser.js"></script></body></html>');
    staged = true;
  }
  const ctx = await context(browser!, o);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${join(dir, 'app.html')}`);
  const engine = await page.evaluate(async (t) => {
    const C = (globalThis as unknown as { OrzCarrier: { mountEditor(el: Element, o: unknown): { ready: Promise<{ engine: string }> } } }).OrzCarrier;
    const e = C.mountEditor(document.getElementById('host')!, { text: t, hooks: { save: async () => undefined } });
    (globalThis as unknown as { __ed: unknown }).__ed = e;
    return (await e.ready).engine;
  }, text);
  expect(engine).toBe('codemirror6');
  await page.evaluate((s) => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number, o?: unknown): void } }).__ed; const i = e.getText().indexOf(s); e.select(i, i, { scroll: true }); }, at);
  const frame = await previewFrame(page);
  await page.locator('[data-orz-slides-per-slide]').click();
  await waitGui(page, (s) => !s.stale && s.boxes.length > 0);
  return { page, ctx, frame, errors };
}

async function previewFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find((x) => x !== page.mainFrame());
    if (f && await f.evaluate(() => document.querySelectorAll('#orz-doc .orz-flat-slide').length).catch(() => 0) > 0) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('no preview frame');
}

const ed = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(function (e) { return ${fn}; })(globalThis.__ed)`) as Promise<T>;
const state = (page: Page): Promise<GuiState> => ed<GuiState>(page, 'e.slides.layoutGui().state()');
const text = (page: Page): Promise<string> => ed<string>(page, 'e.getText()');
async function waitGui(page: Page, pred: (s: GuiState) => boolean, timeout = 10_000): Promise<GuiState> {
  const t0 = Date.now();
  let s = await state(page);
  while (!pred(s)) {
    if (Date.now() - t0 > timeout) { await page.screenshot({ path: `/tmp/lg/fail-${Date.now()}.png` }); throw new Error(`the GUI never got there: ${JSON.stringify(s)}`); }
    await page.waitForTimeout(80);
    s = await state(page);
  }
  return s;
}
/** Wait for the text to change from `before` and the stage to be redrawn for it. */
async function changed(page: Page, before: string): Promise<string> {
  await expect.poll(() => text(page), { timeout: 10_000 }).not.toBe(before);
  await waitGui(page, (s) => !s.stale);
  return text(page);
}
const slideOf = (t: string, i: number) => parseDeck(t).slides[i];
const center = async (page: Page, sel: string): Promise<{ x: number; y: number; w: number; h: number }> => {
  let b: { x: number; y: number; width: number; height: number } | null = null;
  for (let k = 0; k < 50 && !b; k++) { b = await page.locator(sel).first().boundingBox().catch(() => null); if (!b) await page.waitForTimeout(100); }
  if (!b) throw new Error(`no ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
/** Undo through the GUI's own key (the focus in the overlay), and check it restores exactly `t`. */
async function undoTo(page: Page, t: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => text(page), { timeout: 5000 }).toBe(t);
  await waitGui(page, (s) => !s.stale);
}

const TWO = `{{nyml
kind: document
carrier: slides
uid: doc-layoutgui00001
title: Layout GUI
theme: orchard
}}

<!-- slide template=title -->
# A title page
## and its subtitle

<!-- slide 2col -->
## Two boxes
Left text, a few words.
<!-- @right -->
Right text, a few more words.

<!-- slide -->
## One box
Body text.
`;

chrome('the layout GUI (real Chrome, offline; app host: the frame is an opaque origin)', () => {
  it('[L.7] This slide attaches the GUI over the sandboxed frame: toolbar, filmstrip and status beside the stage, the overlay\'s boxes on the frame\'s boxes (within 2 px, also after the pane is resized), a fit badge per box, labels outside the boxes; the stage\'s place is computed by the page (stageLayout), never asked of the frame', async () => {
    const { page, ctx, frame, errors } = await openApp(SAMPLE, '## The RAFT equilibrium');
    const s = await state(page);
    expect(s.slide).toBe(4);
    expect(s.boxes).toEqual(['left', 'right']);
    expect(s.dividers).toBe(1);
    expect(s.insets.top).toBeGreaterThan(20);
    expect(s.insets.left).toBeGreaterThan(100);
    const aligned = async (): Promise<number> => {
      const ifr = (await page.locator('iframe.orz-editor__frame').boundingBox())!;
      const inFrame = await frame.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('#orz-live .orz-page > section .orz-content .orz-region')).map((r) => { const b = r.getBoundingClientRect(); return { name: r.getAttribute('data-region'), x: b.x, y: b.y, w: b.width, h: b.height }; }));
      let worst = 0;
      for (const r of inFrame) {
        const o = (await page.locator(`.orz-lg-box--region[data-box="${r.name}"]`).boundingBox())!;
        worst = Math.max(worst, Math.abs(o.x - (ifr.x + r.x)), Math.abs(o.y - (ifr.y + r.y)), Math.abs(o.width - r.w), Math.abs(o.height - r.h));
      }
      return worst;
    };
    expect(await aligned()).toBeLessThanOrEqual(2);
    // a badge per box; labels sit outside the box (above its top edge)
    expect(await page.locator('.orz-lg-box--region .orz-lg-badge').count()).toBe(2);
    const box = (await page.locator('.orz-lg-box--region[data-box="right"]').boundingBox())!;
    const tag = (await page.locator('.orz-lg-box--region[data-box="right"] .orz-lg-tag').boundingBox())!;
    expect(tag.y + tag.height).toBeLessThanOrEqual(box.y + 0.5);
    // the pane resized (the split moved): the stage and its overlay follow
    await ed(page, 'e.setSplitRatio(0.35)');
    await page.waitForTimeout(600);
    await waitGui(page, (x) => !x.stale);
    await expect.poll(aligned, { timeout: 5000 }).toBeLessThanOrEqual(2);
    // the frame draws the stage where the page computed it
    const port = await frame.evaluate(() => { const c = document.getElementById('orz-live')!.getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width }; });
    const st = await state(page);
    const pane = (await page.locator('iframe.orz-editor__frame').boundingBox())!;
    const ui = (await page.locator('.orz-lg').boundingBox())!;
    expect(Math.abs(port.x + pane.x - (ui.x + st.stage.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(port.w - st.stage.w)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[L.8] boxes by pointer and keys — click selects the box\'s Markdown (double-click / Enter edits it), C and R split, a divider drag snaps to a simple ratio shown in a bubble, divider arrow keys step through ratios (one undo step for the run), Delete moves the text to the neighbour, the preset picker, F2 rename refusing reserved and taken names, Alt+Arrow swaps, the move menu — each ONE undo step with its changed lines flashed', async () => {
    const { page, ctx, errors } = await openApp(TWO, '## Two boxes');
    let t = await text(page);
    const t0 = t;
    // click → the box's Markdown selected (the focus stays on the stage)
    await page.locator('.orz-lg-box--region[data-box="right"]').click({ position: { x: 30, y: 30 } });
    expect(await ed(page, 'e.getText().slice(e.adapter.getSelection().from, e.adapter.getSelection().to)')).toBe('Right text, a few more words.');
    expect((await state(page)).selection).toEqual({ kind: 'box', name: 'right' });
    // C: split into columns — one line changed, one added; flashed
    await page.locator('.orz-lg-box--region[data-box="right"]').focus();
    await page.keyboard.press('c');
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('col 2/1/1 { left; right; right-2 }');
    await expect.poll(() => page.locator('.cm-line.orz-flash').count(), { timeout: 3000 }).toBeGreaterThan(0);
    expect((await state(page)).status).toMatch(/^Split right into columns — 1 line changed, 1 line added$/);
    await undoTo(page, t0);
    t = t0;
    // R on left
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await page.keyboard.press('r');
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('col 1/1 { row 1/1 { left; left-2 }; right }');
    await undoTo(page, t0);
    t = t0;
    // a divider drag to a third: 1 : 2, the bubble says so while dragging
    const d = await center(page, '.orz-lg-div');
    const st = await state(page);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    const left = (await page.locator('.orz-lg-box--region[data-box="left"]').boundingBox())!;
    const right = (await page.locator('.orz-lg-box--region[data-box="right"]').boundingBox())!;
    const third = left.x + (right.x + right.width - left.x) / 3;
    await page.mouse.move(third, d.y, { steps: 10 });
    await expect.poll(() => page.locator('.orz-lg-bubble').textContent()).toBe('1 : 2');
    await page.mouse.up();
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('2col 1/2');
    expect(st.dividers).toBe(1);
    await undoTo(page, t0);
    t = t0;
    // divider keys: two steps, written once (one undo step)
    await page.locator('.orz-lg-div').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('2col 2/1');
    await page.locator('.orz-lg-div').focus();
    await undoTo(page, t0);
    t = t0;
    // Delete: the text goes to the neighbour; the one box left is a one-track split
    await page.locator('.orz-lg-box--region[data-box="right"]').focus();
    await page.keyboard.press('Delete');
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('col 1 { left }');
    expect(slideOf(t, 1).regions.map((r) => r.markdown)).toEqual(['Left text, a few words.\n\nRight text, a few more words.']);
    await undoTo(page, t0);
    t = t0;
    // the preset picker: 3col keeps left and right, adds mid with its own (empty) marker
    await page.locator('[data-act="preset-3col"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('3col');
    expect(t).toContain('Left text, a few words.\n<!-- @mid -->\n<!-- @right -->');
    expect(await page.locator('[data-act="preset-3col"]').getAttribute('aria-checked')).toBe('true');
    await page.locator('.orz-lg-box--region[data-box="mid"]').focus();
    await undoTo(page, t0);
    t = t0;
    // F2 rename: reserved and taken names refused, a good one written (the tree is a raw split now)
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await page.keyboard.press('F2');
    const input = page.locator('.orz-lg-pop input');
    await input.fill('notes');
    await expect.poll(() => page.locator('.orz-lg-pop .orz-lg-err').textContent()).toMatch(/reserved/);
    await input.press('Enter');
    expect(await text(page)).toBe(t0);
    await input.fill('right');
    await expect.poll(() => page.locator('.orz-lg-pop .orz-lg-err').textContent()).toMatch(/already/);
    await input.fill('main');
    await input.press('Enter');
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('col 1/1 { main; right }');
    await page.locator('.orz-lg-box--region[data-box="main"]').focus();
    await undoTo(page, t0);
    t = t0;
    // Alt+ArrowRight swaps the texts (the tree and the slide marker stay)
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    t = await changed(page, t);
    expect(Object.fromEntries(slideOf(t, 1).regions.map((r) => [r.name, r.markdown]))).toEqual({ left: 'Right text, a few more words.', right: 'Left text, a few words.' });
    expect(slideOf(t, 1).layoutSpec).toBe('2col');
    await undoTo(page, t0);
    t = t0;
    // drag a name tag onto another box: swap
    const tag = await center(page, '.orz-lg-box--region[data-box="left"] .orz-lg-tag');
    const rb = await center(page, '.orz-lg-box--region[data-box="right"]');
    await page.mouse.move(tag.x, tag.y);
    await page.mouse.down();
    await page.mouse.move(rb.x, rb.y, { steps: 8 });
    await page.mouse.up();
    t = await changed(page, t);
    expect(Object.fromEntries(slideOf(t, 1).regions.map((r) => [r.name, r.markdown]))).toEqual({ left: 'Right text, a few more words.', right: 'Left text, a few words.' });
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await undoTo(page, t0);
    t = t0;
    // the move menu
    await page.locator('.orz-lg-box--region[data-box="left"]').click({ position: { x: 20, y: 30 } });
    await page.locator('[data-act="move"]').click();
    await page.locator('.orz-lg-pop [data-act="move-right"]').click();
    t = await changed(page, t);
    expect(Object.fromEntries(slideOf(t, 1).regions.filter((r) => r.markdown).map((r) => [r.name, r.markdown]))).toEqual({ right: 'Right text, a few more words.\n\nLeft text, a few words.' });
    // double-click a box: its text in the editor, focused
    await page.locator('.orz-lg-box--region[data-box="right"]').dblclick({ position: { x: 30, y: 40 } });
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.shadowRoot?.activeElement?.classList.contains('cm-content') ?? false)).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.9] floats by pointer and keys — added where they overlap no float, dragged and resized by their handles in whole % of the TEXT\'s geometry, nudged by arrows (one undo step for the run), brought forward (z=), deleted; a template slide shows its looks (frame-drawn thumbnails under trusted buttons) and refuses layout ops with the reason; the slide options (fit, background, transition, step), the notes and the footer from the toolbar', async () => {
    const { page, ctx, errors } = await openApp(TWO, '## Two boxes');
    let t = await text(page);
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    const boxes = slideMap(t, 1)!.floats.map((f) => f.box);
    expect(boxes).toHaveLength(2);
    const [a, b] = boxes;
    expect(a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h).toBe(false);
    expect((await state(page)).floats).toBe(2);
    // drag the first float by 10 % of the stage's width
    const st = await state(page);
    const f0 = await center(page, '.orz-lg-float[data-float="0"]');
    await page.mouse.move(f0.x, f0.y);
    await page.mouse.down();
    await page.mouse.move(f0.x - st.stage.w * 0.1, f0.y + st.stage.h * 0.05, { steps: 8 });
    await page.mouse.up();
    t = await changed(page, t);
    const m1 = slideMap(t, 1)!.floats[0].box;
    expect(m1.left).toBe(a.left - 10);
    expect(m1.top).toBe(a.top + 5);
    expect(m1.w).toBe(a.w);
    // its south-east handle: resize
    await page.locator('.orz-lg-float[data-float="0"]').hover();
    const h = await center(page, '.orz-lg-float[data-float="0"] .orz-lg-h[data-h="se"]');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + st.stage.w * 0.05, h.y + st.stage.h * 0.1, { steps: 6 });
    await page.mouse.up();
    t = await changed(page, t);
    const m2 = slideMap(t, 1)!.floats[0].box;
    expect([m2.left, m2.top, m2.w, m2.h]).toEqual([m1.left, m1.top, m1.w + 5, m1.h + 10]);
    // arrows: three nudges, one write, one undo step
    const before = t;
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    t = await changed(page, t);
    const m3 = slideMap(t, 1)!.floats[0].box;
    expect([m3.left, m3.top]).toEqual([m2.left + 2, m2.top + 5]);
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await undoTo(page, before);
    t = before;
    // ] brings it forward (z written), Delete deletes it
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press(']');
    t = await changed(page, t);
    expect(slideOf(t, 1).floats[0].geom.z).toBe(3);
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('Delete');
    t = await changed(page, t);
    expect(slideOf(t, 1).floats).toHaveLength(1);
    // the slide options (choices the reader clicks; one op each, the panel stays open)
    await page.locator('[data-act="options"]').click();
    await page.locator('.orz-lg-pop [data-act="opt-fit-off"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 1).options.fit).toBe('off');
    await page.locator('.orz-lg-pop input[data-opt="bg"]').fill('#f4f1ea');
    await page.locator('.orz-lg-pop input[data-opt="bg"]').press('Enter');
    t = await changed(page, t);
    expect(slideOf(t, 1).options.bg).toBe('#f4f1ea');
    await page.locator('.orz-lg-pop [data-act="opt-t-zoom"]').click();
    t = await changed(page, t);
    await page.locator('.orz-lg-pop input[data-opt="step"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 1).options).toMatchObject({ fit: 'off', bg: '#f4f1ea', transition: 'zoom', step: true });
    expect(slideOf(t, 1).layoutSpec).toBe('2col');
    expect(await page.locator('.orz-lg-pop [data-act="opt-t-zoom"]').getAttribute('aria-checked')).toBe('true');
    await page.keyboard.press('Escape');
    // notes and footer: added, then the editor on them
    await page.locator('[data-act="notes"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 1).notes).toBe('');
    await page.keyboard.type('Say this.');
    await expect.poll(async () => slideOf(await text(page), 1).notes).toBe('Say this.');
    t = await text(page);
    // a template: the looks; layout ops refused with the reason
    await page.locator('.orz-lg-item[data-slide="0"]').click();
    await waitGui(page, (s) => s.slide === 0 && s.template === 'title' && !s.stale);
    expect(await page.locator('[data-act="preset-2col"]').isVisible()).toBe(false);
    await expect.poll(() => page.locator('.orz-lg-variant').count(), { timeout: 5000 }).toBe(6);
    expect(await page.locator('.orz-lg-bar').textContent()).toMatch(/Title page: its own layout — choose its look/);
    await page.locator('.orz-lg-variant[data-variant="4"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 0).templateVariant).toBe(4);
    expect(await page.locator('.orz-lg-variant[data-variant="4"]').getAttribute('aria-checked')).toBe('true');
    // the template's thumbnails are drawn by the frame under the trusted buttons
    expect(await page.frames()[1].evaluate(() => document.querySelectorAll('.orz-live-variants .orz-live-variant section').length)).toBe(6);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.10] the filmstrip on a 100-slide deck: virtualised (a few dozen rows in the DOM), a mouse drag with autoscroll moves a slide far down, Alt+Down and Alt+Up move it by one, add / duplicate / delete — each ONE undo step that restores the exact text; no long task over 200 ms during divider, float and filmstrip drags (the D-47 guard)', async () => {
    const deck = bigDeck(100);
    const { page, ctx, errors } = await openApp(deck, 'Left text of slide 52');
    await waitGui(page, (s) => s.slide === 51);
    const s0 = await state(page);
    expect(s0.total).toBe(100);
    expect(s0.strip.length).toBeLessThanOrEqual(30);
    expect(s0.strip).toContain(51);
    // the page idle first (the editor's first lint pass and the live view's settle), as the typing test does
    await page.waitForTimeout(2500);
    // long tasks, and the drag windows (pointer down → up), in the page's clock
    await page.evaluate(() => {
      const w = window as unknown as { __lt: Array<[number, number]>; __drag: Array<[number, number]> };
      w.__lt = [];
      w.__drag = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask' });
      addEventListener('pointerdown', () => { w.__drag.push([performance.now(), Infinity]); }, true);
      addEventListener('pointerup', () => { const d = w.__drag[w.__drag.length - 1]; if (d) d[1] = performance.now(); }, true);
    });
    const t0 = await text(page);
    // drag the divider back and forth
    const d = await center(page, '.orz-lg-div');
    const tDrag = Date.now();
    await page.mouse.move(d.x, d.y);
    await page.mouse.down();
    for (let k = 0; k < 40; k++) await page.mouse.move(d.x - 120 + (k % 20) * 12, d.y);
    await page.mouse.up();
    let t = await changed(page, t0);
    const divMs = Date.now() - tDrag;
    // a float: add, then drag it around
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    const f = await center(page, '.orz-lg-float');
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    for (let k = 0; k < 40; k++) await page.mouse.move(f.x - 150 + k * 6, f.y + (k % 10) * 4);
    await page.mouse.up();
    t = await changed(page, t);
    // the filmstrip: slide 3 dragged down to 60 (autoscroll near the bottom edge)
    await ed(page, `(function () { var i = e.getText().indexOf('## Slide 3:'); e.select(i, i, { scroll: true }); })()`);
    await waitGui(page, (s) => s.slide === 2);
    const before = await text(page);
    const item = (await page.locator('.orz-lg-item[data-slide="2"]').boundingBox())!;
    const scroll = (await page.locator('.orz-lg-strip-scroll').boundingBox())!;
    await page.mouse.move(item.x + 40, item.y + item.height / 2);
    await page.mouse.down();
    await page.mouse.move(item.x + 40, item.y + item.height / 2 + 20, { steps: 3 });
    await page.mouse.move(item.x + 40, scroll.y + scroll.height - 8, { steps: 10 });
    // autoscroll until rows past 40 show, then back off the edge (it stops) and drop on the top edge of a row X: the slide goes to X - 1
    await expect.poll(async () => Math.max(-1, ...(await state(page)).strip), { timeout: 15_000 }).toBeGreaterThan(45);
    await page.mouse.move(item.x + 40, scroll.y + scroll.height / 2, { steps: 3 });
    await page.waitForTimeout(300);
    const rows = (await state(page)).strip;
    const X = rows[Math.floor(rows.length / 2)];
    const row = (await page.locator(`.orz-lg-item[data-slide="${X}"]`).boundingBox())!;
    await page.mouse.move(item.x + 40, row.y + 3, { steps: 3 });
    await page.mouse.up();
    t = await changed(page, before);
    const moved = parseDeck(t).slides.findIndex((s) => s.title === 'Slide 3: code');
    expect(moved).toBe(X - 1);
    expect(moved).toBeGreaterThan(30);
    expect(parseDeck(t).slides).toHaveLength(100);
    const { lt, drags } = await page.evaluate(() => { const w = window as unknown as { __lt: Array<[number, number]>; __drag: Array<[number, number]> }; return { lt: [...w.__lt], drags: [...w.__drag] }; });
    const during = lt.filter(([at, dur]) => drags.some(([a, b]) => at < b && at + dur > a));
    // eslint-disable-next-line no-console
    console.log(`[L.10] 100 slides: ${drags.length} drags (divider ${divMs} ms with its write); long tasks during the drags: ${during.map(([, d]) => Math.round(d)).join(', ') || 'none'}; between them (the writes, the live view, the lints): ${lt.filter((x) => !during.includes(x)).map(([, d]) => Math.round(d)).join(', ') || 'none'}`);
    expect(during.filter(([, d]) => d > 200)).toEqual([]);
    await page.locator('.orz-lg-strip-scroll').focus();
    await undoTo(page, before);
    // keys: Alt+Down, Alt+Up (each a move of one), from the filmstrip
    await waitGui(page, (s) => s.slide === 2);
    await page.locator('.orz-lg-strip-scroll').focus();
    await page.keyboard.press('Alt+ArrowDown');
    t = await changed(page, before);
    expect(parseDeck(t).slides[3].title).toBe('Slide 3: code');
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => text(page)).toBe(before);
    // add, duplicate, delete: one undo step each
    await page.locator('[data-act="slide-add"]').click();
    t = await changed(page, before);
    expect(parseDeck(t).slides).toHaveLength(101);
    expect(parseDeck(t).slides[3].title).toBe('New slide');
    await page.locator('.orz-lg-strip-scroll').focus();
    await undoTo(page, before);
    await page.locator('[data-act="slide-duplicate"]').click();
    t = await changed(page, before);
    expect(parseDeck(t).slides[3].title).toBe('Slide 3: code');
    await page.locator('.orz-lg-strip-scroll').focus();
    await undoTo(page, before);
    await page.locator('[data-act="slide-delete"]').click();
    t = await changed(page, before);
    expect(parseDeck(t).slides).toHaveLength(99);
    await page.locator('.orz-lg-strip-scroll').focus();
    await undoTo(page, before);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);

  it('[L.11] touch: on a coarse pointer the dividers, handles and buttons are larger; a finger drags a divider, a float and a slide (by its grip), and a tap selects a box', async () => {
    const { page, ctx, errors } = await openApp(TWO, '## Two boxes', { touch: true, viewport: { width: 1280, height: 860 } });
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    expect(coarse).toBe(true);
    await expect.poll(async () => (await page.locator('.orz-lg-div').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(24);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
      await touch('touchStart', from.x, from.y);
      for (let k = 1; k <= 10; k++) await touch('touchMove', from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
      await touch('touchEnd', to.x, to.y);
    };
    let t = await text(page);
    const d = await center(page, '.orz-lg-div');
    const left = (await page.locator('.orz-lg-box--region[data-box="left"]').boundingBox())!;
    const right = (await page.locator('.orz-lg-box--region[data-box="right"]').boundingBox())!;
    await drag(d, { x: left.x + ((right.x + right.width - left.x) * 2) / 3, y: d.y });
    t = await changed(page, t);
    expect(slideOf(t, 1).layoutSpec).toBe('2col 2/1');
    // a tap selects a box
    const r = await center(page, '.orz-lg-box--region[data-box="right"]');
    await page.touchscreen.tap(r.x, r.y);
    await expect.poll(async () => (await state(page)).selection).toEqual({ kind: 'box', name: 'right' });
    // a float
    await page.locator('[data-act="float-add"]').tap();
    t = await changed(page, t);
    const st = await state(page);
    const fl = await center(page, '.orz-lg-float');
    const b0 = slideMap(t, 1)!.floats[0].box;
    await drag(fl, { x: fl.x - st.stage.w * 0.2, y: fl.y });
    t = await changed(page, t);
    expect(slideMap(t, 1)!.floats[0].box.left).toBe(b0.left - 20);
    // a slide by its grip: the second slide below the third
    const grip = (await page.locator('.orz-lg-item[data-slide="1"] .orz-lg-item-grip').boundingBox())!;
    expect(grip.width).toBeGreaterThanOrEqual(30);
    const third = (await page.locator('.orz-lg-item[data-slide="2"]').boundingBox())!;
    await drag({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: grip.x + grip.width / 2, y: third.y + third.height - 4 });
    t = await changed(page, t);
    expect(parseDeck(t).slides.map((s) => s.title ?? s.template)).toEqual(['title', 'One box', 'Two boxes']);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.12] keyboard only and screen readers: Tab reaches every box, divider and float, each with its label (name, fit, keys); Arrows go from box to box; Page Down goes to the next slide; ? opens the keys panel and Escape closes it; nothing needs a pointer', async () => {
    const { page, ctx, errors } = await openApp(TWO, '## Two boxes');
    await page.locator('[data-act="float-add"]').click();
    await changed(page, TWO);
    await page.locator('.orz-lg-box--title').focus();
    const order: string[] = [];
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => { const a = (document.activeElement as HTMLElement).shadowRoot?.activeElement as HTMLElement | null; return a ? `${a.getAttribute('role')}:${a.getAttribute('aria-label')?.split('.')[0]}` : ''; }));
    }
    expect(order.slice(0, 3)).toEqual([
      expect.stringMatching(/^button:Box left, fits$/),
      expect.stringMatching(/^button:Box right, fits$/),
      expect.stringMatching(/^separator:Divider between left and right: 1 to 1$/),
    ]);
    expect(order.some((x) => /^button:Float 1 of 1, at \d+ %, \d+ %, 30 by 22 %, empty$/.test(x))).toBe(true);
    // arrows between boxes
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => ((document.activeElement as HTMLElement).shadowRoot?.activeElement as HTMLElement | null)?.getAttribute('data-box'))).toBe('right');
    // the keys panel
    await page.keyboard.press('?');
    await expect.poll(() => page.locator('.orz-lg-pop[aria-label="Keyboard shortcuts"]').count()).toBe(1);
    expect(await page.locator('.orz-lg-pop dt').count()).toBeGreaterThan(12);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('.orz-lg-pop').count()).toBe(0);
    // Page Down: the next slide
    await page.locator('.orz-lg-box--region[data-box="left"]').focus();
    await page.keyboard.press('PageDown');
    await waitGui(page, (s) => s.slide === 2);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.13] isolation: a document script in the frame forges fit reports (boxes moved, a float elsewhere), forged ops, keys and links, and the page\'s own synthetic events — the text never changes; the forged geometry only misplaces the overlay; a trusted nudge of a float writes the TEXT\'s position + 1 %, not the forged one', async () => {
    // the script captures the live slide's key from the trusted page's messages and lies with it, every 50 ms
    const LIE = "var W=window;if(!W.__lied){W.__lied=1;var k=null,b=W.__orzPreviewMessage;W.__orzPreviewMessage=function(m){try{if(m&&m.slide&&m.slide.key)k=m.slide.key}catch(x){}return b&&b(m)};setInterval(function(){if(!k||!W.__orzPreview)return;W.__orzPreview.post({type:'orz-slides-fit',key:k,index:1,boxes:[],footerCut:false,scrolls:false,parts:{regions:[{name:'left',x:900,y:600,w:100,h:50,empty:false},{name:'right',x:5,y:5,w:50,h:50,empty:false}],splits:[],title:null,content:null,template:null,footer:null,floats:[{x:1000,y:10,w:200,h:200}]}});parent.postMessage({type:'orz-slides-op',op:{type:'delete-box',box:'left'}},'*');parent.postMessage({type:'orz-preview-key',key:'Delete'},'*');parent.postMessage({type:'orz-slides-preview',splits:[{index:0,dir:'col',css:'1fr 9fr'}]},'*');try{parent.document.title='pwned'}catch(x){}},50)}";
    const deck = TWO.replace('Right text, a few more words.', `Right text, a few more words. <img src="x" onerror="${LIE}">\n<!-- @float left=10% top=20% w=20% h=20% -->\nA float.`);
    const { page, ctx, errors } = await openApp(deck, '## Two boxes');
    // the reader types on the slide: the page posts it again, and the script learns its key
    await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void; focus(): void } }).__ed; const i = e.getText().indexOf('a few words.') + 'a few words.'.length; e.select(i, i); e.focus(); });
    await page.keyboard.type(' More.');
    const t0 = await (async () => { await expect.poll(() => text(page)).toContain('a few words. More.'); return text(page); })();
    // the forged reports arrive: the overlay is misplaced (the frame may lie about geometry)
    // measured in one go in the page (the forger redraws the overlay every 50 ms)
    await expect.poll(() => page.evaluate(() => {
      const host = document.querySelector('#host')!.firstElementChild as HTMLElement | null;
      const root = (host?.shadowRoot ?? document) as ParentNode;
      const ui = root.querySelector<HTMLElement>('.orz-lg');
      const stage = root.querySelector<HTMLElement>('.orz-lg-stage');
      const box = root.querySelector<HTMLElement>('.orz-lg-box--region[data-box="left"]');
      const e = (globalThis as unknown as { __ed: { slides: { layoutGui(): { state(): { stage: { scale: number } } } } } }).__ed;
      if (!ui || !stage || !box) return -1;
      return Math.round((box.getBoundingClientRect().x - stage.getBoundingClientRect().x) / e.slides.layoutGui().state().stage.scale);
    }), { timeout: 10_000 }).toBe(900);
    await page.waitForTimeout(1000);
    expect(await text(page)).toBe(t0);
    expect(await page.title()).not.toBe('pwned');
    // synthetic events from a script in the trusted page itself: not the reader's, no op
    await page.evaluate(() => {
      const root = (document.querySelector('#host')!.firstElementChild as HTMLElement | null)?.shadowRoot ?? document;
      const all = Array.from((root as ParentNode).querySelectorAll<HTMLElement>('.orz-lg-box, .orz-lg-float, .orz-lg-div, .orz-lg-btn'));
      for (const el of all) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, composed: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, button: 0, pointerType: 'mouse' }));
      }
    });
    await page.waitForTimeout(800);
    expect(await text(page)).toBe(t0);
    // a trusted nudge of the float: its new place comes from the text (10 % → 11 %), not from the forged rectangle
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('ArrowRight');
    const t1 = await (async () => { await expect.poll(() => text(page), { timeout: 5000 }).not.toBe(t0); return text(page); })();
    expect(slideOf(t1, 1).floats[0].geom).toMatchObject({ left: '11%', top: '20%', w: '20%', h: '20%' });
    expect(t1.replace('left=11%', 'left=10%')).toBe(t0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});

/** A 100-slide deck of every kind of slide (no network content). */
function bigDeck(n = 100): string {
  const out = ['{{nyml', 'kind: document', 'carrier: slides', 'uid: doc-gui0100slides00', 'title: A hundred slides', 'theme: orchard', 'footer: Layout test', '}}', ''];
  for (let i = 0; i < n; i++) {
    const k = i % 5;
    if (k === 0) out.push('<!-- slide -->', `## Slide ${i + 1}: a list`, ...Array.from({ length: 5 }, (_, j) => `- point ${j + 1} of slide ${i + 1} with a few words`), '');
    else if (k === 1) out.push('<!-- slide 2col -->', `## Slide ${i + 1}: two columns`, `Left text of slide ${i + 1}, a paragraph of moderate length to wrap.`, '<!-- @right -->', '| a | b |', '|---|---|', `| ${i} | ${i * 2} |`, '');
    else if (k === 2) out.push('<!-- slide -->', `## Slide ${i + 1}: code`, '```python', `def f${i}(x):`, `    return x * ${i}`, '```', '<!-- @notes -->', `Notes for slide ${i + 1}.`, '');
    else if (k === 3) out.push('<!-- slide main-side -->', `## Slide ${i + 1}: math`, `$$E_${i} = m c^2$$`, '<!-- @side -->', `Inline $x_${i}$ and **bold**.`, '');
    else out.push('<!-- slide template=section -->', `# Part ${i + 1}`, 'A section page', '');
  }
  return out.join('\n');
}
