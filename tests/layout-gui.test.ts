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
/**
 * The long-task bound of the L.10 guards (D-47: a drag must never stall the page). 250 ms, raised from 200 ms on
 * 2026-10-20 (owner, family Phase 4 follow-up F): on the owner's machine the 300-slide ops at 4 × CPU throttle and the
 * 100-slide drags measured 202–225 ms, on the old base too (orz-slides@1.0.0 and before), so 200 ms flagged machine
 * noise, not a regression. The guard targets regressions of the D-47 kind (a re-parse or a redraw of the whole deck on
 * every move: seconds, not tens of ms over the line). Making the layout ops cheaper so that the margin returns under
 * 200 ms is a product item (family docs/STATUS.md D-118).
 */
const LONG_TASK_MS = 250;
let staged = false;

interface GuiState {
  slide: number; total: number; selection: unknown; boxes: string[]; floats: number; dividers: number;
  stage: { x: number; y: number; w: number; h: number; scale: number }; insets: { top: number; left: number; bottom: number; right: number };
  status: string; template: string | null; blocked: string | null; stale: boolean; strip: number[]; stripAxis: 'x' | 'y' | null;
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
async function openApp(text: string, at: string, o: { viewport?: { width: number; height: number }; touch?: boolean; noWait?: boolean } = {}): Promise<{ page: Page; ctx: BrowserContext; frame: Frame; errors: string[] }> {
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
    // saves are recorded (round B2, B2-ED-1: what a save wrote)
    const e = C.mountEditor(document.getElementById('host')!, { text: t, hooks: { save: async (x: unknown) => { const g = globalThis as unknown as { __saved?: unknown[] }; g.__saved = [...(g.__saved ?? []), x]; } } });
    (globalThis as unknown as { __ed: unknown }).__ed = e;
    return (await e.ready).engine;
  }, text);
  expect(engine).toBe('codemirror6');
  await page.evaluate((s) => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number, o?: unknown): void } }).__ed; const i = e.getText().indexOf(s); e.select(i, i, { scroll: true }); }, at);
  const frame = await previewFrame(page);
  // the single-slide view: the live card enlarged (owner decision 2026-10-14)
  await page.locator('[data-orz-slides-enlarge]').click();
  if (o.noWait) { await page.waitForTimeout(1500); return { page, ctx, frame, errors }; }
  await waitGui(page, (s) => !s.stale && s.boxes.length > 0);
  // the card's move into the stage (a 160 ms transition) is over
  await page.waitForTimeout(400);
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
    // the filmstrip beside the slide or under it (round B, GUI-4: whichever leaves the slide larger)
    expect(s.stripAxis === 'y' ? s.insets.left : s.insets.bottom).toBeGreaterThan(s.stripAxis === 'y' ? 100 : 90);
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
    expect(await page.locator('.orz-lg-bar').textContent()).toMatch(/Title page: choose a look/);
    await page.locator('.orz-lg-variant[data-variant="4"]').click();
    t = await changed(page, t);
    expect(slideOf(t, 0).templateVariant).toBe(4);
    expect(await page.locator('.orz-lg-variant[data-variant="4"]').getAttribute('aria-checked')).toBe('true');
    // the template's thumbnails are drawn by the frame under the trusted buttons
    expect(await page.frames()[1].evaluate(() => document.querySelectorAll('.orz-live-variants .orz-live-variant section').length)).toBe(6);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.10] the filmstrip on a 100-slide deck: virtualised (a few dozen rows in the DOM), a mouse drag with autoscroll moves a slide far down, Alt+Down and Alt+Up move it by one, add / duplicate / delete — each ONE undo step that restores the exact text; no long task over 250 ms during divider, float and filmstrip drags (the D-47 guard)', async () => {
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
    // the filmstrip is a column beside the slide or a row under it: the drag goes along it
    const horiz = (await state(page)).stripAxis === 'x';
    const at = (p: number): [number, number] => (horiz ? [p, item.y + item.height / 2] : [item.x + 40, p]);
    const p0 = horiz ? item.x + item.width / 2 : item.y + item.height / 2;
    await page.mouse.move(...at(p0));
    await page.mouse.down();
    await page.mouse.move(...at(p0 + 20), { steps: 3 });
    await page.mouse.move(...at(horiz ? scroll.x + scroll.width - 8 : scroll.y + scroll.height - 8), { steps: 10 });
    // autoscroll until rows past 40 show, then back off the edge (it stops) and drop on the leading edge of a row X: the slide goes to X - 1
    await expect.poll(async () => Math.max(-1, ...(await state(page)).strip), { timeout: 15_000 }).toBeGreaterThan(45);
    await page.mouse.move(...at(horiz ? scroll.x + scroll.width / 2 : scroll.y + scroll.height / 2), { steps: 3 });
    await page.waitForTimeout(300);
    const rows = (await state(page)).strip;
    const X = rows[Math.floor(rows.length / 2)];
    const row = (await page.locator(`.orz-lg-item[data-slide="${X}"]`).boundingBox())!;
    await page.mouse.move(...at((horiz ? row.x : row.y) + 3), { steps: 3 });
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
    expect(during.filter(([, d]) => d > LONG_TASK_MS)).toEqual([]);
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
    // a slide by its grip: the second slide after the third (the filmstrip a column or a row)
    const grip = (await page.locator('.orz-lg-item[data-slide="1"] .orz-lg-item-grip').boundingBox())!;
    expect(grip.width).toBeGreaterThanOrEqual(30);
    const third = (await page.locator('.orz-lg-item[data-slide="2"]').boundingBox())!;
    const horiz = (await state(page)).stripAxis === 'x';
    const g0 = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await drag(g0, horiz ? { x: third.x + third.width - 4, y: g0.y } : { x: g0.x, y: third.y + third.height - 4 });
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

/* ───────────────────────── closed-loop round B (rebuild/1.0@6accc1f): the probes of the layout GUI ───────────────────────── */

const HB = '{{nyml\nkind: document\ncarrier: slides\nuid: doc-layoutguiroundb\ntitle: Round B\ntheme: orchard\n}}\n\n';
/** Page rectangles of the ink (text lines, pictures) of the stage slide in the frame. */
async function inkRects(page: Page, frame: Frame): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  const ifr = (await page.locator('iframe.orz-editor__frame').boundingBox())!;
  const rs = await frame.evaluate(() => {
    const s = document.querySelector('#orz-live .orz-page > section');
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (!s) return out;
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!(n.textContent ?? '').trim()) continue;
      const el = n.parentElement!;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.orz-footer, .orz-slot, .orz-chrome, [aria-hidden="true"]')) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width > 1 && r.height > 1) out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    for (const m of Array.from(s.querySelectorAll('img, svg, canvas, video'))) { const r = m.getBoundingClientRect(); if (r.width > 1 && r.height > 1) out.push({ x: r.x, y: r.y, w: r.width, h: r.height }); }
    return out;
  });
  return rs.map((r) => ({ x: r.x + ifr.x, y: r.y + ifr.y, w: r.w, h: r.h }));
}
const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
/** The labels (name tags, fit badges) of the stage as the reader sees them now: text, opacity, page rectangle. */
const labels = (page: Page) => page.evaluate(() => {
  const host = document.querySelector('#host')!.firstElementChild as HTMLElement | null;
  const root = (host?.shadowRoot ?? document) as ParentNode;
  return Array.from(root.querySelectorAll<HTMLElement>('.orz-lg-stage :is(.orz-lg-tag, .orz-lg-badge)')).map((l) => { const r = l.getBoundingClientRect(); return { text: l.textContent ?? '', cls: l.className, box: l.parentElement?.getAttribute('data-box') ?? l.parentElement?.getAttribute('data-float') ?? '', opacity: Number(getComputedStyle(l).opacity), x: r.x, y: r.y, w: r.width, h: r.height }; });
});

chrome('closed-loop round B probes (the layout GUI, real Chrome, offline)', () => {
  it('[L.12] round B, OPS-2: a run of arrow keys (a divider, a float) is written to the slide it started on — Page Down, a filmstrip click or a caret move to another slide first writes it there; the next slide is never touched', async () => {
    const deck = `${HB}<!-- slide 2col -->\n## Slide A\nLeft A\n<!-- @right -->\nRight A\n<!-- @float left=60% top=10% w=30% h=20% -->\nFloat A\n\n<!-- slide 2col -->\n## Slide B\nLeft B\n<!-- @right -->\nRight B\n<!-- @float left=10% top=50% w=30% h=20% -->\nFloat B\n`;
    const { page, ctx, errors } = await openApp(deck, '## Slide A');
    const t0 = await text(page);
    // a divider run, then Page Down at once
    await page.locator('.orz-lg-div').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('PageDown');
    await waitGui(page, (s) => s.slide === 1 && !s.stale);
    await page.waitForTimeout(900);
    let t = await text(page);
    expect(slideOf(t, 0).layoutSpec).toBe('2col 2/1');
    expect(slideOf(t, 1).layoutSpec).toBe('2col');
    // a float run, then a filmstrip click on the other slide
    await page.locator('.orz-lg-item[data-slide="0"]').click();
    await waitGui(page, (s) => s.slide === 0 && !s.stale);
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowRight');
    await page.locator('.orz-lg-item[data-slide="1"]').click();
    await waitGui(page, (s) => s.slide === 1 && !s.stale);
    await page.waitForTimeout(900);
    t = await text(page);
    expect(slideOf(t, 0).floats[0].geom).toMatchObject({ left: '63%', top: '10%' });
    expect(slideOf(t, 1).floats[0].geom).toMatchObject({ left: '10%', top: '50%' });
    expect(t).not.toBe(t0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.10] round B, OPS-5 and OPS-7: a drag that is refused (read-only) or cancelled by an undo leaves the stage as the text says — no preview left in the frame, nothing written to whatever now has the dragged float\'s number', async () => {
    const deck = `${HB}<!-- slide -->\n## Floats\nBody\n<!-- @float left=10% top=20% w=20% h=20% -->\nFloat A\n<!-- @float left=60% top=60% w=20% h=20% -->\nFloat B\n`;
    const { page, ctx, frame, errors } = await openApp(deck, '## Floats');
    const frameFloat = (k: number) => frame.evaluate((i) => { const f = document.querySelectorAll<HTMLElement>('#orz-live .orz-page > section > .orz-float')[i]; const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), style: f.getAttribute('style') ?? '' }; }, k);
    const before = await frameFloat(1);
    // read-only: the drag is refused; the frame's preview is put back
    await ed(page, 'e.setReadOnly(true)');
    const f = await center(page, '.orz-lg-float[data-float="1"]');
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    await page.mouse.move(f.x - 200, f.y - 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    expect(await text(page)).toBe(deck);
    expect(await frameFloat(1)).toEqual(before);
    await ed(page, 'e.setReadOnly(false)');
    // delete A, drag B (now float 1), undo in the middle of the drag: the drag is cancelled, A comes back, nothing moves
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('Delete');
    const t1 = await changed(page, deck);
    const g = await center(page, '.orz-lg-float[data-float="0"]');
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x - 100, g.y - 60, { steps: 6 });
    await page.keyboard.press('ControlOrMeta+z');
    await page.mouse.move(g.x - 150, g.y - 80, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    expect(t1).not.toBe(deck);
    expect(await text(page)).toBe(deck);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.9] round B, B-ED-1 and OPS-6: after Duplicate (no blank line before the next marker) a float added on the slide before stays on that slide\'s stage; a new float is the one selected even when the notes come before the floats', async () => {
    const deck = `${HB}<!-- slide -->\n## One\nBody one\n\n<!-- slide -->\n## Two\nBody two\n<!-- @notes -->\nNotes first.\n<!-- @float left=5% top=60% w=20% h=20% -->\nAn existing float\n`;
    const { page, ctx, errors } = await openApp(deck, '## Two');
    let t = await text(page);
    await page.locator('[data-act="slide-duplicate"]').click();
    t = await changed(page, t);
    await page.locator('.orz-lg-item[data-slide="1"]').click();
    await waitGui(page, (s) => s.slide === 1 && !s.stale);
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    const s = await waitGui(page, (x) => !x.stale);
    expect(s.slide).toBe(1);
    expect(slideOf(t, 1).floats.map((x) => x.markdown)).toEqual(['An existing float', '']);
    expect(s.selection).toEqual({ kind: 'float', index: 1 });
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B, GUI-1: fit and names readable at rest — a cut box is outlined in red and its "cut" badge is shown (never tucked), every box\'s name is shown, and no label at rest lies on the slide\'s text, at 1280 × 800 and 1500 × 900', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `- item ${i} with quite a few words so that it wraps onto two lines in the column`).join('\n');
    const deck = `${HB}<!-- slide 2col fit=off -->\n## Too much text\n${many}\n<!-- @right -->\nShort.\n`;
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1500, height: 900 }]) {
      const { page, ctx, frame, errors } = await openApp(deck, '## Too much', { viewport });
      await page.waitForTimeout(600);
      const ls = (await labels(page)).filter((l) => /orz-lg-(tag|badge)/.test(l.cls));
      const cut = ls.find((l) => l.text === 'cut');
      expect(cut, JSON.stringify(viewport)).toBeDefined();
      expect(cut!.opacity, JSON.stringify(viewport)).toBeGreaterThan(0.95);
      for (const name of ['left', 'right']) expect(ls.find((l) => l.text === name)?.opacity ?? 0, `${name} ${JSON.stringify(viewport)}`).toBeGreaterThan(0.95);
      expect(await page.locator('.orz-lg-box--region[data-box="left"]').getAttribute('data-fit')).toBe('cut');
      const ink = await inkRects(page, frame);
      const over = ls.filter((l) => l.opacity > 0.5 && l.text !== 'cut' && ink.some((r) => hit(l, r)));
      expect(over.map((l) => l.text), JSON.stringify(viewport)).toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    }
  }, 120_000);

  it('[L.7] round B, GUI-1 on the sample: on a normal slide every region\'s name is readable at rest at 1280 × 800 and none lies on the slide\'s text', async () => {
    const { page, ctx, frame } = await openApp(SAMPLE, '## The RAFT equilibrium', { viewport: { width: 1280, height: 800 } });
    await page.waitForTimeout(600);
    const ls = await labels(page);
    for (const name of ['left', 'right']) expect(ls.find((l) => l.text === name)?.opacity ?? 0, name).toBeGreaterThan(0.95);
    const ink = await inkRects(page, frame);
    expect(ls.filter((l) => l.opacity > 0.5 && ink.some((r) => hit(l, r))).map((l) => l.text)).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B, GUI-5: the overlay\'s outlines reach 3 : 1 against the slide in every theme (dark ones included), and the dividers are drawn at rest — on a touch screen too', async () => {
    const themes = ['orchard', 'sky', 'stationery', 'preprint', 'small-press', 'notebook', 'sticker', 'inscription', 'copper', 'nocturne', 'architect', 'chalk', 'neon', 'paper'];
    const lum = ([r, g, b]: number[]): number => { const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a: number[], b: number[]): number => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const worst: string[] = [];
    for (const th of themes) {
      const deck = `${HB.replace('theme: orchard', `theme: ${th}`)}<!-- slide 2col -->\n## Why control matters\nShort text.\n<!-- @right -->\nMore.\n`;
      const { page, ctx } = await openApp(deck, '## Why control', { viewport: { width: 1400, height: 860 } });
      await page.waitForTimeout(500);
      const b = (await page.locator('.orz-lg-box--region[data-box="right"]').boundingBox())!;
      const clip = { x: Math.round(b.x) - 4, y: Math.round(b.y + b.height * 0.45), width: 10, height: 40 };
      const shot = async (): Promise<number[][][]> => {
        const png = await page.screenshot({ clip });
        return page.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const rows: number[][][] = []; for (let y = 0; y < c.height; y++) { const row: number[][] = []; for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; row.push([d[i], d[i + 1], d[i + 2]]); } rows.push(row); } return rows; }, png.toString('base64'));
      };
      const withOverlay = await shot();
      await page.evaluate(() => { const host = document.querySelector('#host')!.firstElementChild as HTMLElement; (host.shadowRoot!.querySelector('.orz-lg-stage') as HTMLElement).style.visibility = 'hidden'; });
      const without = await shot();
      // per run of 10 rows (a dash and its gap), the strongest contrast of the outline against what is under it; the median run
      const runs: number[] = [];
      for (let y0 = 0; y0 + 10 <= withOverlay.length; y0 += 10) {
        let best = 1;
        for (let y = y0; y < y0 + 10; y++) for (let x = 0; x < withOverlay[y].length; x++) best = Math.max(best, ratio(withOverlay[y][x], without[y][x]));
        runs.push(best);
      }
      runs.sort((x, y) => x - y);
      const med = runs[Math.floor(runs.length / 2)];
      if (med < 3) worst.push(`${th} ${med.toFixed(2)}`);
      await ctx.close();
    }
    expect(worst).toEqual([]);
    // the dividers at rest: a mouse, and a touch screen (no hover)
    for (const touch of [false, true]) {
      const { page, ctx } = await openApp(TWO, '## Two boxes', { touch, viewport: { width: 1280, height: 860 } });
      const shown = await page.evaluate(() => { const host = document.querySelector('#host')!.firstElementChild as HTMLElement; const d = host.shadowRoot!.querySelector('.orz-lg-div')!; return [Number(getComputedStyle(d, '::before').opacity), Number(getComputedStyle(d, '::after').opacity)]; });
      expect(Math.max(...shown), `touch ${touch}`).toBeGreaterThanOrEqual(touch ? 0.7 : 0.35);
      await ctx.close();
    }
  }, 240_000);

  it('[L.9] round B, GUI-2: a new float avoids the slide\'s text as well as the floats — it covers no word of a full two-column slide with a long title', async () => {
    const deck = `${HB}<!-- slide 2col -->\n## A title long enough to run across most of the slide's title band\nLeft side point one runs long enough to wrap.\n\n- one\n- two\n- three\n<!-- @right -->\nRight side point one runs long enough to wrap onto lines.\n`;
    const { page, ctx, frame, errors } = await openApp(deck, '## A title long');
    let t = await text(page);
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    await page.waitForTimeout(500);
    const f = (await page.locator('.orz-lg-float[data-float="0"]').boundingBox())!;
    const fr = { x: f.x, y: f.y, w: f.width, h: f.height };
    const ink = await inkRects(page, frame);
    expect(ink.filter((r) => hit(fr, r)).length).toBe(0);
    expect(slideOf(t, 0).floats).toHaveLength(1);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B, GUI-4: the stage uses its pane — at 1500 × 900 (Split) the slide is drawn at least 0.53 of its size (it was 0.446), and the filmstrip folds away from its own head', async () => {
    const { page, ctx, errors } = await openApp(SAMPLE, '## The RAFT equilibrium');
    const s = await state(page);
    expect(s.stage.scale).toBeGreaterThanOrEqual(0.53);
    await page.locator('[data-act="strip-hide"]').click();
    const s2 = await waitGui(page, (x) => x.stripAxis === null);
    expect(s2.strip).toEqual([]);
    expect(s2.stage.scale).toBeGreaterThanOrEqual(s.stage.scale);
    // a pane where the slide is bound by its height: hiding the filmstrip makes it larger
    await ed(page, 'e.setSplitRatio(0.3)');
    await page.locator('[data-act="strip"]').click();
    const s3 = await waitGui(page, (x) => x.stripAxis !== null && !x.stale);
    await page.locator('[data-act="strip-hide"]').click();
    const s4 = await waitGui(page, (x) => x.stripAxis === null && !x.stale);
    expect(s4.stage.scale).toBeGreaterThanOrEqual(s3.stage.scale);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.8] round B, GUI-3, OPS-4: clicking the layout the slide already has keeps its sizes (and says so); a divider of three columns snaps the whole split to small whole numbers, the other divider staying where it is', async () => {
    const deck = `${HB}<!-- slide 2col 3/2 -->\n## Sized\nL\n<!-- @right -->\nR\n\n<!-- slide 3col -->\n## Three\nA\n<!-- @mid -->\nB\n<!-- @right -->\nC\n`;
    const { page, ctx, errors } = await openApp(deck, '## Sized');
    await page.locator('[data-act="preset-2col"]').click();
    await page.waitForTimeout(600);
    expect(await text(page)).toBe(deck);
    expect((await state(page)).status).toMatch(/already .*Two columns.*divider/i);
    await page.keyboard.press('PageDown');
    await waitGui(page, (s) => s.slide === 1 && !s.stale && s.dividers === 2);
    const d0 = page.locator('.orz-lg-div[data-i="0"]');
    const d1before = (await page.locator('.orz-lg-div[data-i="1"]').boundingBox())!;
    const a = await center(page, '.orz-lg-box--region[data-box="left"]');
    const c = await center(page, '.orz-lg-div[data-i="0"]');
    await d0.hover();
    await page.mouse.down();
    await page.mouse.move(c.x - a.w * 0.45, c.y, { steps: 10 });
    await page.mouse.up();
    const t = await changed(page, deck);
    const tracks = slideOf(t, 1).layout.kind === 'split' ? (slideOf(t, 1).layout as { tracks: string[] }).tracks.map(Number) : [];
    expect(tracks.every((x) => Number.isInteger(x) && x >= 1)).toBe(true);
    expect(tracks.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(12);
    const d1after = (await page.locator('.orz-lg-div[data-i="1"]').boundingBox())!;
    expect(Math.abs(d1after.x - d1before.x)).toBeLessThanOrEqual(3);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.9] round B, OPS-3: a float written in em or anchored right/bottom moves by the step the reader asked for — one Arrow moves it 1 % from where it is drawn, writes that axis only, and keeps the other axis\' em and the anchor', async () => {
    const deck = `${HB}<!-- slide -->\n## Em floats\nBody text\n<!-- @float left=1em top=8em w=12em h=3em -->\nAn em float\n<!-- @float right=5% bottom=5% -->\nA corner note\n`;
    const { page, ctx, errors } = await openApp(deck, '## Em floats');
    const st = await state(page);
    const b0 = (await page.locator('.orz-lg-float[data-float="0"]').boundingBox())!;
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('ArrowRight');
    const t1 = await changed(page, deck);
    const g = slideOf(t1, 0).floats[0].geom;
    expect(g.top).toBe('8em');
    expect(g.w).toBe('12em');
    expect(g.h).toBe('3em');
    expect(g.left).toMatch(/%$/);
    const b1 = (await page.locator('.orz-lg-float[data-float="0"]').boundingBox())!;
    expect(Math.abs(b1.x - b0.x - st.stage.w * 0.01)).toBeLessThanOrEqual(st.stage.w * 0.012);
    await page.locator('.orz-lg-float[data-float="1"]').focus();
    await page.keyboard.press('ArrowLeft');
    const t2 = await changed(page, t1);
    expect(slideOf(t2, 0).floats[1].geom).toEqual({ right: '6%', bottom: '5%' });
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.12] round B, GUI-8, GUI-9, GUI-12: the toolbar comes first in the tab order; a refusal is shown in full (two lines and its title); the words match the buttons (Add a float; the layout names); the Keys panel lists every key', async () => {
    const deck = `${HB}<!-- slide 2col -->\n## Blocked\n<div>\n<!-- @right -->\nRight\n`;
    const { page, ctx, errors } = await openApp(deck, '## Blocked');
    const s = await state(page);
    expect(s.blocked).not.toBeNull();
    const msg = page.locator('.orz-lg-msg');
    expect(await msg.getAttribute('title')).toBe(s.status);
    const m = (await msg.boundingBox())!;
    const line = await msg.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 16);
    expect(m.height).toBeGreaterThan(line * 1.5);
    expect(await page.locator('[data-act="float-add"]').getAttribute('aria-label')).toBe('Add a float');
    // DOM order is tab order: the toolbar before the filmstrip and the stage
    const order = await page.evaluate(() => { const host = document.querySelector('#host')!.firstElementChild as HTMLElement; const ui = host.shadowRoot!.querySelector('.orz-lg')!; return Array.from(ui.children).map((c) => c.className.split(' ')[0]); });
    expect(order.indexOf('orz-lg-bar')).toBeLessThan(order.indexOf('orz-lg-strip'));
    expect(order.indexOf('orz-lg-bar')).toBeLessThan(order.indexOf('orz-lg-stage'));
    await page.locator('[data-act="keys"]').click();
    const keys = await page.locator('.orz-lg-pop dt').allTextContents();
    for (const k of ['Alt+Shift+Arrows (box)', 'Delete (filmstrip)', 'Home / End (filmstrip)', 'Enter (filmstrip)', 'Space (box, float)']) expect(keys, k).toContain(k);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.10] round B, GUI-10: the filmstrip tells the slides apart — each template kind draws its own thumbnail and its name is not cut', async () => {
    const deck = `${HB}<!-- slide template=title -->\n# T\n\n<!-- slide template=section -->\n# S\n\n<!-- slide template=outline -->\n# O\n\n<!-- slide template=closing -->\n# C\n\n<!-- slide -->\n## Normal\nx\n`;
    const { page, ctx, errors } = await openApp(deck, '## Normal');
    const items = await page.evaluate(() => { const host = document.querySelector('#host')!.firstElementChild as HTMLElement; return Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>('.orz-lg-item')).slice(0, 4).map((it) => { const mini = it.querySelector('.orz-lg-mini')!; const kind = it.querySelector<HTMLElement>('.orz-lg-item-kind')!; return { mini: mini.innerHTML, cut: kind.scrollWidth > kind.clientWidth + 1, kind: kind.textContent }; }); });
    expect(new Set(items.map((x) => x.mini)).size).toBe(4);
    expect(items.filter((x) => x.cut).map((x) => x.kind)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.10] round B, GUI-11 and OPS-10: ops on a 300-slide deck at a quarter of the CPU (4 × throttled) make no long task over 250 ms', async () => {
    const deck = bigDeck(300);
    const { page, ctx, errors } = await openApp(deck, 'Left text of slide 152');
    await waitGui(page, (s) => s.slide === 151);
    await page.waitForTimeout(2500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => { const w = window as unknown as { __lt: number[] }; w.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
    let t = await text(page);
    await page.locator('[data-act="float-add"]').click();
    t = await changed(page, t);
    await page.locator('.orz-lg-box--region[data-box="right"]').focus();
    await page.keyboard.press('c');
    t = await changed(page, t);
    await page.locator('.orz-lg-strip-scroll').focus();
    await page.keyboard.press('Alt+ArrowDown');
    t = await changed(page, t);
    await page.waitForTimeout(1500);
    const lt = await page.evaluate(() => [...(window as unknown as { __lt: number[] }).__lt]);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // eslint-disable-next-line no-console
    console.log(`[L.10] GUI-11 300 slides, CPU 4×: long tasks around three ops: ${lt.join(', ') || 'none'}`);
    expect(lt.filter((d) => d > LONG_TASK_MS)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 240_000);

  it('[L.13] round B, ISO-B1, ISO-B2: the overlay\'s boxes are named from the TEXT — a document script that renames the frame\'s regions (swapped, a name with a newline, one not in the text) misnames nothing and throws nothing in the page; the preview frame of an app host is an opaque origin', async () => {
    const SWAP = "var W=window;if(!W.__sw){W.__sw=1;setInterval(function(){var r=document.querySelectorAll('#orz-live .orz-region[data-region]');if(r.length===2){r[0].setAttribute('data-region','right');r[1].setAttribute('data-region','zz\\ny')}},20)}";
    const deck = `${HB}<!-- slide 2col -->\n## Two\nLEFT-CONTENT <img src="x" onerror="${SWAP}">\n<!-- @right -->\nRIGHT-CONTENT\n`;
    const { page, ctx, errors } = await openApp(deck, '## Two');
    // a fresh report after the script ran: type on the slide
    await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void; focus(): void } }).__ed; const i = e.getText().indexOf('RIGHT-CONTENT') + 13; e.select(i, i); e.focus(); });
    await page.keyboard.type(' x');
    await page.waitForTimeout(2500);
    const boxes = await page.evaluate(() => { const host = document.querySelector('#host')!.firstElementChild as HTMLElement; return Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>('.orz-lg-box--region')).map((b) => ({ name: b.getAttribute('data-box'), x: b.getBoundingClientRect().x })); });
    expect(boxes.map((b) => b.name).sort()).toEqual(['left', 'right']);
    const left = boxes.find((b) => b.name === 'left')!;
    const right = boxes.find((b) => b.name === 'right')!;
    expect(left.x).toBeLessThan(right.x);
    for (const b of ['left', 'right']) await page.locator(`.orz-lg-box--region[data-box="${b}"]`).click({ position: { x: 20, y: 30 } });
    expect(await page.locator('iframe.orz-editor__frame').getAttribute('sandbox')).toBe('allow-scripts');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});

/* ───────────────────────── closed-loop round B2 (rebuild/1.0@15c9719): the probes of the closing pass ───────────────────────── */

chrome('closed-loop round B2 probes (the layout GUI, real Chrome, offline)', () => {
  const lum = ([r, g, b]: number[]): number => { const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a: number[], b: number[]): number => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const savedTexts = (page: Page): Promise<string[]> => page.evaluate(() => ((globalThis as unknown as { __saved?: unknown[] }).__saved ?? []).map((x) => (typeof x === 'string' ? x : String((x as { text?: unknown })?.text ?? ''))));
  const inShadow = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(function () { var host = document.querySelector('#host').firstElementChild; var root = host.shadowRoot; return ${fn}; })()`) as Promise<T>;

  it('[L.12] round B2, B2-ED-1: a run of arrow keys is written before any command reads the text — Ctrl/Cmd+S saves the nudged text, the enlarge key and a click on the editor\'s toolbar write it first; Escape still cancels a run', async () => {
    const deck = `${HB}<!-- slide -->\n## Slide A\nBody A.\n\n<!-- @float left=60% top=10% w=30% h=20% -->\nFloat on A\n\n<!-- slide -->\n## Slide B\nBody B.\n`;
    const { page, ctx, errors } = await openApp(deck, '## Slide A');
    // three nudges, then Save at once: the saved text has them
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(async () => (await savedTexts(page)).length, { timeout: 5000 }).toBeGreaterThan(0);
    const saved = (await savedTexts(page)).at(-1)!;
    expect(saved.match(/@float left=\d+%/)?.[0]).toBe('@float left=63%');
    // two more, then the enlarge key (back to the whole deck): written first
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect.poll(() => ed<boolean>(page, 'e.slides.isPerSlide()')).toBe(false);
    expect((await text(page)).match(/@float left=\d+%/)?.[0]).toBe('@float left=65%');
    // in again; a run, then a pointer press on the editor's own toolbar (outside the stage): written first
    await page.locator('[data-orz-slides-enlarge]').click();
    await waitGui(page, (s) => !s.stale && s.floats === 1);
    await page.waitForTimeout(400);
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.locator('[data-orz-slides-lint]').click();
    expect((await text(page)).match(/@float left=\d+% top=\d+%/)?.[0]).toBe('@float left=65% top=11%');
    // Escape cancels a run (it is not written)
    await page.locator('.orz-lg-float[data-float="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    expect((await text(page)).match(/@float left=\d+% top=\d+%/)?.[0]).toBe('@float left=65% top=11%');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.12] round B2, B2-ED-4: a select() from code to another slide while a key run is pending writes the run on its slide and leaves the caret where the code put it', async () => {
    const deck = `${HB}<!-- slide 2col -->\n## A\nLeft A\n<!-- @right -->\nRight A\n\n<!-- slide 2col -->\n## B\nLeft B\n<!-- @right -->\nRight B\n`;
    const { page, ctx, errors } = await openApp(deck, '## A');
    await page.locator('.orz-lg-div').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void } }).__ed; const i = e.getText().indexOf('Left B'); e.select(i, i); });
    await page.waitForTimeout(1200);
    const t = await text(page);
    expect(slideOf(t, 0).layoutSpec).toBe('2col 2/1');
    expect(slideOf(t, 1).layoutSpec).toBe('2col');
    const sel = await page.evaluate(() => (globalThis as unknown as { __ed: { getSelection(): { from: number } } }).__ed.getSelection().from);
    expect(t.slice(sel, sel + 6)).toBe('Left B');
    expect(await ed<number>(page, 'e.slides.caretSlide()')).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B2, GUI2-3: a filmstrip hidden because the pane was too low comes back when the pane grows (unless the reader hid it)', async () => {
    const { page, ctx, errors } = await openApp(TWO, '## Two boxes', { viewport: { width: 1280, height: 380 } });
    expect((await state(page)).stripAxis).toBeNull();
    await page.setViewportSize({ width: 1280, height: 900 });
    await waitGui(page, (s) => s.stripAxis !== null);
    // the reader hides it: it stays hidden through a resize
    await page.locator('[data-act="strip"]').click();
    await waitGui(page, (s) => s.stripAxis === null);
    await page.setViewportSize({ width: 1280, height: 380 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(800);
    expect((await state(page)).stripAxis).toBeNull();
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B2, GUI2-4: a template\'s look captions reach 4.5 : 1 against the page around the slide in every dark theme (the soft-dark surround)', async () => {
    for (const th of ['chalk', 'copper', 'inscription', 'neon', 'nocturne']) {
      const src = SAMPLE.replace(/^theme: .*$/m, `theme: ${th}`);
      const { page, ctx, frame } = await openApp(src, '<!-- slide template=section');
      await page.waitForTimeout(600);
      const cols = await inShadow<string[]>(page, "Array.from(root.querySelectorAll('.orz-lg-variant > span')).map(function (e) { return getComputedStyle(e).color; })");
      expect(cols.length, th).toBeGreaterThan(1);
      const bg = await frame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      const rgb = await page.evaluate((list) => list.map((c) => { const x = document.createElement('canvas').getContext('2d')!; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)); }), [bg, ...cols]);
      for (const c of rgb.slice(1)) expect(ratio(c, rgb[0]), `${th}: ${JSON.stringify(c)} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      await ctx.close();
    }
  }, 240_000);

  it('[L.12] round B2, GUI2-6: the Keys panel breaks a key name only after a + or a / and lists redo (Ctrl/Cmd+Y); a template\'s note is not cut', async () => {
    const { page, ctx, errors } = await openApp(TWO, '# A title page');
    expect(await inShadow<string>(page, "(function (n) { return n.scrollWidth <= n.clientWidth + 1 ? n.textContent : 'cut: ' + n.textContent; })(Array.from(root.querySelectorAll('.orz-lg-note')).find(function (n) { return /look/.test(n.textContent); }))")).toBe('Title page: choose a look');
    await page.locator('[data-act="keys"]').click();
    const keys = await page.locator('.orz-lg-pop dt').allTextContents();
    expect(keys.some((k) => /Ctrl\/Cmd\+Y/.test(k))).toBe(true);
    // a key name breaks at a space or after a + or a /, never inside a word ("Ent|er")
    const split = await page.evaluate(() => {
      const root = (document.querySelector('#host')!.firstElementChild as HTMLElement).shadowRoot!;
      const out: string[] = [];
      for (const dt of Array.from(root.querySelectorAll('.orz-lg-pop dt'))) {
        let prevTop: number | null = null;
        let prevCh = '';
        for (const n of Array.from(dt.childNodes)) {
          if (n.nodeType !== 3) continue;
          const t = n as Text;
          for (let i = 0; i < t.length; i++) {
            const r = document.createRange();
            r.setStart(t, i);
            r.setEnd(t, i + 1);
            const q = r.getClientRects()[0];
            if (!q) continue;
            const ch = t.data[i];
            if (prevTop !== null && Math.abs(q.top - prevTop) > 2 && !/[\s+/]/.test(prevCh) && !/\s/.test(ch)) out.push(`${dt.textContent} @${i}`);
            prevTop = q.top;
            prevCh = ch;
          }
        }
      }
      return out;
    });
    expect(split).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.7] round B2, GUI2-7: a box\'s name tag stays on its own side of the box (the sample\'s two columns in Notebook at 1500 × 900: \'left\' is never drawn beside \'right\')', async () => {
    const src = SAMPLE.replace(/^theme: .*$/m, 'theme: notebook');
    const { page, ctx, errors } = await openApp(src, '## The RAFT equilibrium');
    await page.waitForTimeout(600);
    // the 'left' tag ends at least two tag widths before the right box begins (where 'right' sits)
    const g = await inShadow<{ tagR: number; tagW: number; tucked: boolean; rightL: number }>(page, "(function () { var l = root.querySelector('.orz-lg-box--region[data-box=left]'); var r = root.querySelector('.orz-lg-box--region[data-box=right]'); var t = l.querySelector(':scope > .orz-lg-tag'); var tr = t.getBoundingClientRect(); return { tagR: tr.right, tagW: tr.width, tucked: t.classList.contains('is-tucked'), rightL: r.getBoundingClientRect().left }; })()");
    if (!g.tucked) expect(g.rightL - g.tagR, JSON.stringify(g)).toBeGreaterThanOrEqual(2 * g.tagW);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('[L.13] round B2, ISO-B2-1, ISO-B2-2: a document script that forges fit reports (a region name of its own, HTML and a newline in it) and clones a float in the live slide — the Issues name boxes from the TEXT, and no float the text does not have is drawn or selected', async () => {
    const FORGE = "var W=window;if(!W.__x){W.__x=1;var ks=[];var prev=W.__orzPreviewMessage;W.__orzPreviewMessage=function(m){try{if(m&&m.slide&&m.slide.key)ks.push({key:m.slide.key,index:m.slide.index});if(m&&m.type==='orz-slides-check')ks.push({key:m.key,index:m.index});}catch(e){}return prev(m)};var NAME='EVIL<b>x</b>&lt;'+String.fromCharCode(10)+'NL';setInterval(function(){ks.forEach(function(k){parent.postMessage({type:'orz-slides-fit',key:k.key,index:k.index,boxes:[{kind:'region',name:NAME,scale:0.3,clipped:true,x:0,y:0,w:10,h:10}],footerCut:false,scrolls:false,parts:null},'*')})},200);setInterval(function(){var s=document.querySelector('#orz-live .orz-page > section');if(!s)return;var f=s.querySelectorAll('.orz-float');if(f.length===1){var c=f[0].cloneNode(true);c.style.left='5%';c.style.top='55%';f[0].parentNode.appendChild(c);}},30)}";
    const deck = `${HB}<!-- slide -->\n## Forged\nBody <img src="x" onerror="${FORGE}">\n<!-- @float left=60% top=10% w=30% h=20% -->\nThe float\n\n<!-- slide -->\n## Two\nx\n`;
    const { page, ctx } = await openApp(deck, '## Forged', { noWait: true });
    await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void; focus(): void } }).__ed; const i = e.getText().indexOf('The float') + 9; e.select(i, i); e.focus(); });
    await page.keyboard.type(' x');
    await page.waitForTimeout(3000);
    const msgs = await page.evaluate(() => (globalThis as unknown as { __ed: { slides: { refreshLints(): Array<{ code: string; message: string }> } } }).__ed.slides.refreshLints().filter((l) => l.code === 'cut-on-paper').map((l) => l.message));
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) { expect(m).not.toMatch(/EVIL|<b>|NL/); expect(m).toMatch(/its (body|box) /); }
    const s = await state(page);
    // the frame reports two floats, the text has one: the stage is stale (nothing on it acts), no second float is drawn
    expect(s.floats).toBeLessThanOrEqual(1);
    expect(await inShadow<number>(page, "root.querySelectorAll('.orz-lg-float[data-float=\"1\"]').length")).toBe(0);
    await ctx.close();
    // the clone alone (no forged report): the frame truthfully reports two floats, the text has one — none is drawn as float 2
    const DUP = "var W=window;if(!W.__d){W.__d=1;setInterval(function(){var s=document.querySelector('#orz-live .orz-page > section');if(!s)return;var f=s.querySelectorAll('.orz-float');if(f.length===1){var c=f[0].cloneNode(true);c.style.left='5%';c.style.top='55%';f[0].parentNode.appendChild(c);}},30)}";
    const deck2 = `${HB}<!-- slide -->\n## Cloned\nBody <img src="x" onerror="${DUP}">\n<!-- @float left=60% top=10% w=30% h=20% -->\nThe float\n`;
    const o2 = await openApp(deck2, '## Cloned', { noWait: true });
    await o2.page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void; focus(): void } }).__ed; const i = e.getText().indexOf('The float') + 9; e.select(i, i); e.focus(); });
    await o2.page.keyboard.type(' y');
    await o2.page.waitForTimeout(2500);
    expect(await inShadow<number>(o2.page, "root.querySelectorAll('.orz-lg-float[data-float=\"1\"]').length")).toBe(0);
    expect(o2.errors).toEqual([]);
    await o2.ctx.close();
  }, 120_000);

  it('[W.10] round B2, the owner\'s intermittent card bug: enlarge → shrink 45 times at a quarter of the CPU — by click, by key, rapid double clicks, a click right after the other, while typing, across theme changes, and while the frame\'s document is rebuilt between the enlarge and the shrink (the cause: a message the frame could not take was resent after a later one), with fit reports and idle checks running — always ends with the card in the bottom-right corner, its slide drawn, and the flattened preview back (no stage left in the pane)', async () => {
    const many = Array.from({ length: 14 }, (_, i) => `<!-- slide ${i % 2 ? '2col' : ''} -->\n## Slide ${i + 1}\nText of slide ${i + 1}${i % 2 ? '\n<!-- @right -->\nRight' : ''}\n`).join('\n');
    const deck = `${HB}${many}`;
    const { page, ctx, frame, errors } = await openApp(deck, '## Slide 3');
    await page.locator('[data-orz-slides-shrink]').click();
    await expect.poll(() => ed<boolean>(page, 'e.slides.isPerSlide()')).toBe(false);
    await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const bad: string[] = [];
    const settledCard = async (k: number, how: string): Promise<void> => {
      await page.waitForTimeout(1600);
      const f = await frame.evaluate(() => {
        const c = document.getElementById('orz-live')!;
        const r = c.getBoundingClientRect();
        const port = c.querySelector<HTMLElement>('.orz-live-port')!.getBoundingClientRect();
        const sec = c.querySelector<HTMLElement>('.orz-page > section');
        const sr = sec?.getBoundingClientRect();
        return { stage: document.body.classList.contains('orz-stage'), hidden: c.hidden, x: r.right, y: r.bottom, w: r.width, vw: innerWidth, vh: innerHeight, portH: port.height, secW: sr?.width ?? 0, doc: getComputedStyle(document.getElementById('orz-doc')!).display };
      });
      const perSlide = await ed<boolean>(page, 'e.slides.isPerSlide()');
      const btn = await page.locator('[data-orz-slides-enlarge]').boundingBox();
      if (perSlide) bad.push(`${k} ${how}: still in single-slide view`);
      if (f.stage) bad.push(`${k} ${how}: the frame still draws the stage`);
      if (f.hidden) bad.push(`${k} ${how}: the card is hidden`);
      if (f.doc === 'none') bad.push(`${k} ${how}: the flattened preview is hidden`);
      if (f.vw - f.x > 40 || f.vh - f.y > 40 || f.w > f.vw * 0.5) bad.push(`${k} ${how}: the card is not in the corner (${Math.round(f.x)},${Math.round(f.y)} w ${Math.round(f.w)} of ${f.vw}×${f.vh})`);
      if (f.portH < 30 || f.secW < 30) bad.push(`${k} ${how}: the card's slide is not drawn (port ${f.portH}, slide ${f.secW})`);
      if (!btn || Math.abs(btn.width - f.w) > 3) bad.push(`${k} ${how}: the page's card button does not lie on the card`);
    };
    const enlarged = async (): Promise<void> => { await expect.poll(() => ed<boolean>(page, 'e.slides.isPerSlide()'), { timeout: 10_000 }).toBe(true); };
    for (let k = 0; k < 45; k++) {
      const how = ['click', 'reload', 'key', 'double', 'reload', 'quick', 'typing', 'reload', 'theme'][k % 9];
      // a theme change reloads the preview frame: the enlarge and the shrink are sent while it boots again
      if (how === 'theme') await page.evaluate((t) => (globalThis as unknown as { __ed: { setHeader(h: Record<string, string>): void } }).__ed.setHeader({ theme: t }), ['nocturne', 'orchard', 'paper'][k % 3]);
      if (how === 'reload') {
        // the frame's document rebuilt (as a theme or header change does) while the slide enlarges and shrinks: the
        // messages the frame could not take must not come back after the later ones (the owner's bug)
        await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { slides: { setPerSlide(on: boolean): void }; preview: { setOptions(o: object): void } } }).__ed; e.slides.setPerSlide(true); e.preview.setOptions({}); });
        await page.waitForTimeout((k * 7) % 70);
        await page.evaluate(() => (globalThis as unknown as { __ed: { slides: { setPerSlide(on: boolean): void } } }).__ed.slides.setPerSlide(false));
        await settledCard(k, how);
        continue;
      }
      try { await page.locator('[data-orz-slides-enlarge]').click({ timeout: 8000 }); } catch {
        await page.screenshot({ path: `/tmp/card-bug-${k}.png` });
        bad.push(`${k} ${how}: the card cannot be clicked after the last shrink (${JSON.stringify(await page.locator('[data-orz-slides-enlarge]').boundingBox())}, card ui hidden ${await page.evaluate(() => (document.querySelector('#host')!.firstElementChild as HTMLElement).shadowRoot!.querySelector<HTMLElement>('[data-orz-slides-card]')?.hidden)})`);
        break;
      }
      await enlarged();
      if (how === 'quick' || how === 'theme') await page.waitForTimeout(30 + (k * 53) % 120); else await page.waitForTimeout(80 + (k * 37) % 400);
      if (how === 'key') { await page.locator('[data-orz-slides-shrink]').focus(); await page.keyboard.press('ControlOrMeta+Shift+Enter'); }
      else if (how === 'double') await page.locator('[data-orz-slides-shrink]').dblclick();
      else if (how === 'typing') {
        await page.evaluate((n) => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number): void } }).__ed; const i = e.getText().indexOf(`Text of slide ${n}`); e.select(i, i); }, 3 + (k % 5));
        await page.locator('[data-orz-slides-shrink]').click();
      } else await page.locator('[data-orz-slides-shrink]').click();
      await settledCard(k, how);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 600_000);
});
