/**
 * The surround (owner revision and decision 2026-10-15, claim T.15): the
 * page around the slide is drawn in every theme — a SOFT dark when the slide
 * theme is dark (the slide's own hue at low chroma, OKLCH L in the soft-dark
 * band), a light theme's designed tint (in the light band) — with a visible
 * edge against the slide. Before, reveal.css's white viewport covered it. Real Chrome,
 * OFFLINE (D-63: no host resolves), every one of the 14 themes:
 *
 * - the read view with a 4:3 deck in a 16:9 window (the letterbox left and
 *   right) and a 16:9 deck in a 4:3 window (above and below): the computed
 *   `#orz-view` background and the drawn letterbox pixels;
 * - the editor's single-slide stage (the live card enlarged): the drawn
 *   pixels between the stage's edge and the slide; the whole-deck view's
 *   flattened preview keeps its background (the slide's), and the live
 *   card's chrome is the surround;
 * - overview, Present and the speaker view's panes.
 *
 * `BEFORE` holds the values measured before the revision (rebuild/1.0 @
 * 63c08c8, this file): every flattened preview must keep its background, a
 * light theme's surround is its designed tint (`DESIGNED`, else BEFORE.view).
 * `SURROUND_RECORD=1` prints the measurements instead of checking them.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { assemble } from '../src/lib.js';
import { THEMES } from '../src/themes.js';
import { launchChrome, openDeck, type PageGlobal } from './helpers.js';
import { deltaE, oklchOf, SURROUND_BAND, SURROUND_LIGHT_BAND } from '../scripts/build-themes.js';

type Browser = NonNullable<Awaited<ReturnType<typeof launchChrome>>>;
type Page = import('playwright-core').Page;
type BrowserContext = import('playwright-core').BrowserContext;
type RGB = [number, number, number];

const browser = await launchChrome(); // offline (D-63)
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-surround-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;
const RECORD = process.env.SURROUND_RECORD === '1';

const deck = (theme: string, ratio: '16:9' | '4:3'): string => `{{nyml
kind: document
carrier: slides
uid: doc-surround00001
title: Surround
theme: ${theme}
ratio: ${ratio}
}}

<!-- slide -->
## The surround
A short slide: the page around it is what is measured.

<!-- slide -->
## A second slide
Two lines of text.
`;

/** The drawn colour of a few pixels around (x, y) of the page (a screenshot, decoded in the page). */
async function pixel(page: Page, x: number, y: number): Promise<RGB> {
  const png = await page.screenshot({ clip: { x: Math.round(x) - 2, y: Math.round(y) - 2, width: 4, height: 4 } });
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    const n = d.length / 4;
    return s.map((v) => Math.round(v / n)) as [number, number, number];
  }, png.toString('base64'));
}

/** A computed CSS colour as sRGB (any syntax Chrome serialises), null when transparent. */
function colour(page: Page | import('playwright-core').Frame, css: string): Promise<RGB | null> {
  return page.evaluate((c) => {
    if (!c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#010203';
    g.fillStyle = c;
    if (g.fillStyle === '#010203') return null; // not a colour (a gradient list, a var())
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, css);
}

const hex = (c: RGB | null): string => (c ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : 'none');
const near = (a: RGB, b: RGB, tol = 3): boolean => a.every((v, i) => Math.abs(v - b[i]) <= tol);

interface ReadView { view: string; letterbox: string; slide: string; surround: string }

/** The read view of a `ratio` deck in a window of `w` × `h`: the computed surround, a letterbox pixel, the slide's colour. */
async function readView(theme: string, ratio: '16:9' | '4:3', w: number, h: number): Promise<ReadView & { page: Page; ctx: BrowserContext }> {
  const sub = join(dir, `${theme}-${ratio.replace(':', 'x')}`);
  mkdirSync(sub, { recursive: true });
  const { page, ctx } = await openDeck(browser!, join(sub, 'deck.slides.html'), assemble(deck(theme, ratio)), { viewport: { width: w, height: h } });
  await page.addStyleTag({ content: '.reveal .slides > section { transition: none !important; }' });
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const v = document.getElementById('orz-view')!;
    const s = document.querySelector('.reveal .slides > section.present')!;
    const r = s.getBoundingClientRect();
    // the slide's colour: the theme's slide token (a theme may paint the slide on a layer of its own)
    const root = getComputedStyle(document.documentElement);
    const tone = (root.getPropertyValue('--sl-tone') || root.getPropertyValue('--sl-bg')).trim();
    return { view: getComputedStyle(v).backgroundColor, slide: tone, surround: root.getPropertyValue('--sl-surround').trim(), r: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  // the letterbox: halfway between the window's edge and the slide's, on the side with room
  const at = info.r.x > info.r.y ? { x: info.r.x / 2, y: h / 2 } : { x: w / 2, y: info.r.y / 2 };
  expect(Math.max(info.r.x, info.r.y), `${theme} ${ratio}: a letterbox`).toBeGreaterThan(40);
  const letterbox = await pixel(page, at.x, at.y);
  return { page, ctx, view: hex(await colour(page, info.view)), letterbox: hex(letterbox), slide: hex(await colour(page, info.slide)), surround: hex(await colour(page, info.surround)) };
}

/* ---------- the editor (an app page, as tests/layout-gui.test.ts) ---------- */

let staged = false;
async function openEditor(text: string): Promise<{ page: Page; ctx: BrowserContext }> {
  if (!staged) {
    copyFileSync('dist/orz-slides.browser.js', join(dir, 'orz-slides.browser.js'));
    writeFileSync(join(dir, 'app.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#host{height:100vh}</style></head><body><div id="host"></div><script src="orz-slides.browser.js"></script></body></html>');
    staged = true;
  }
  const ctx = await browser!.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.route(/^https?:\/\//, (r) => {
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/orz-markdown@[^/]+\/(vendor\/.+)$/.exec(r.request().url());
    const f = m ? join('node_modules/orz-markdown', m[1]) : '';
    if (f && existsSync(f)) return r.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': extname(f) === '.css' ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' } });
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(`file://${join(dir, 'app.html')}`);
  await page.evaluate(async (t) => {
    const C = (globalThis as unknown as { OrzCarrier: { mountEditor(el: Element, o: unknown): { ready: Promise<unknown> } } }).OrzCarrier;
    const e = C.mountEditor(document.getElementById('host')!, { text: t, hooks: { save: async () => undefined } });
    (globalThis as unknown as { __ed: unknown }).__ed = e;
    await e.ready;
  }, text);
  await page.evaluate(() => { const e = (globalThis as unknown as { __ed: { getText(): string; select(a: number, b: number, o?: unknown): void } }).__ed; const i = e.getText().indexOf('A short slide'); e.select(i, i, { scroll: true }); });
  return { page, ctx };
}

async function previewFrame(page: Page): Promise<import('playwright-core').Frame> {
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find((x) => x !== page.mainFrame());
    if (f && await f.evaluate(() => document.querySelectorAll('#orz-doc .orz-flat-slide').length).catch(() => 0) > 0 && await f.evaluate(() => !document.getElementById('orz-live')!.hidden).catch(() => false)) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('no preview frame');
}

interface EditorView { flat: string; card: string; stage: string; stageHtml: string }

/** The whole-deck view (the flattened preview's background, the live card's chrome) and the single-slide stage's surround. */
async function editorView(theme: string): Promise<EditorView & { page: Page; ctx: BrowserContext }> {
  const { page, ctx } = await openEditor(deck(theme, '16:9'));
  const frame = await previewFrame(page);
  await page.waitForTimeout(300);
  const flat = await frame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const card = await frame.evaluate(() => getComputedStyle(document.getElementById('orz-live')!).backgroundColor);
  await page.locator('[data-orz-slides-enlarge]').click();
  type S = { stage: { x: number; y: number; w: number; h: number }; insets: { top: number; left: number; right: number; bottom: number }; stale: boolean; boxes: string[] };
  const state = (): Promise<S> => page.evaluate(() => (globalThis as unknown as { __ed: { slides: { layoutGui(): { state(): S } } } }).__ed.slides.layoutGui().state());
  for (let k = 0; k < 120; k++) { const s = await state(); if (!s.stale && s.boxes.length > 0) break; await page.waitForTimeout(80); }
  await page.waitForTimeout(450); // the card's move into the stage (160 ms) is over
  const s = await state();
  const fb = (await page.locator('iframe').first().boundingBox())!;
  const vw = await frame.evaluate(() => innerWidth);
  // the stage's surround: the middle of the larger gap between the insets and the slide
  const gapX = s.stage.x - s.insets.left;
  const gapY = s.stage.y - s.insets.top;
  const at = gapX >= gapY ? { x: s.insets.left + gapX / 2, y: s.stage.y + s.stage.h / 2 } : { x: s.insets.left + (vw - s.insets.left - s.insets.right) / 2, y: s.insets.top + gapY / 2 };
  expect(Math.max(gapX, gapY), `${theme}: room around the stage`).toBeGreaterThan(20);
  const stage = await pixel(page, fb.x + at.x, fb.y + at.y);
  const stageHtml = await frame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  return { page, ctx, flat: hex(await colour(frame, flat)), card: hex(await colour(frame, card)), stage: hex(stage), stageHtml: hex(await colour(frame, stageHtml)) };
}

/**
 * Before the revision (rebuild/1.0 @ 63c08c8, measured by this file with SURROUND_RECORD=1): every theme's read view
 * (16:9 window, 4:3 deck: `view` computed, `lb43` drawn; 4:3 window, 16:9 deck: `lb169` drawn), the stage's drawn
 * surround and the flattened preview's background. The light themes must keep these; the dark themes' read view and
 * stage change (the soft-dark surround), their flattened preview does not.
 */
const BEFORE: Record<string, { view: string; lb43: string; lb169: string; stage: string; flat: string }> = {
  orchard: { view: '#f3f5ee', lb43: '#ffffff', lb169: '#ffffff', stage: '#fbfbf8', flat: '#fbfbf8' },
  sky: { view: '#eef3f8', lb43: '#ffffff', lb169: '#ffffff', stage: '#f8fafc', flat: 'none' },
  stationery: { view: '#efeee6', lb43: '#ffffff', lb169: '#ffffff', stage: '#f8f8f3', flat: 'none' },
  preprint: { view: '#e9ecf0', lb43: '#ffffff', lb169: '#ffffff', stage: '#fdfdfc', flat: '#fdfdfc' },
  'small-press': { view: '#e2d9c9', lb43: '#ffffff', lb169: '#ffffff', stage: '#eee6d8', flat: '#eee6d8' },
  notebook: { view: '#e9e3d6', lb43: '#ffffff', lb169: '#ffffff', stage: '#fcf9f2', flat: '#fcf9f2' },
  sticker: { view: '#efece4', lb43: '#ffffff', lb169: '#ffffff', stage: '#fdfcf9', flat: '#fdfcf9' },
  architect: { view: '#e6ebef', lb43: '#ffffff', lb169: '#ffffff', stage: '#f8fafb', flat: '#f8fafb' },
  paper: { view: '#e9e1d2', lb43: '#ffffff', lb169: '#ffffff', stage: '#fbf7ef', flat: '#fbf7ef' },
  // the dark themes before: reveal's white letterbox (reveal.css paints its viewport over #orz-view), the stage on the
  // slide's own colour (no edge), the live card's chrome a neutral #20232b
  inscription: { view: '#0d0f18', lb43: '#ffffff', lb169: '#ffffff', stage: '#13161f', flat: '#13161f' },
  copper: { view: '#050c12', lb43: '#ffffff', lb169: '#ffffff', stage: '#071018', flat: '#071018' },
  nocturne: { view: '#1d1e21', lb43: '#ffffff', lb169: '#ffffff', stage: '#2a2b2f', flat: '#2a2b2f' },
  chalk: { view: '#121a17', lb43: '#ffffff', lb169: '#ffffff', stage: '#1d2a25', flat: '#1d2a25' },
  neon: { view: '#060909', lb43: '#ffffff', lb169: '#ffffff', stage: '#0a0f10', flat: '#0a0f10' },
};

/**
 * The light themes' designed tints (owner decision 2026-10-15: drawn now): the layers' --sl-viewport, three of them
 * moved a step darker because they lay too close to their slide (orchard #f3f5ee ΔE 3.2, sky #eef3f8 ΔE 2.9,
 * stationery #efeee6 ΔE 3.5); the others as before.
 */
const DESIGNED: Record<string, string> = { orchard: '#eef0e9', sky: '#e9eef3', stationery: '#ecebe3' };

const parse = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const record: Record<string, unknown> = {};

chrome('the surround (owner revision 2026-10-15; real Chrome, offline)', () => {
  afterAll(() => { if (RECORD) console.log(`SURROUND ${JSON.stringify(record)}`); });

  for (const t of THEMES) {
    it(`[T.15] ${t.id} (${t.scheme}): the read view's surround, 4:3 in 16:9 and 16:9 in 4:3, and the editor's stage`, async () => {
      const a = await readView(t.id, '4:3', 1280, 720);
      await a.ctx.close();
      const b = await readView(t.id, '16:9', 960, 720);
      await b.ctx.close();
      const e = await editorView(t.id);
      await e.ctx.close();
      const m = { view: a.view, lb43: a.letterbox, lb169: b.letterbox, slide: a.slide, stage: e.stage, stageHtml: e.stageHtml, flat: e.flat, card: e.card };
      record[t.id] = m;
      if (RECORD) return;
      const before = BEFORE[t.id];
      expect(before, `${t.id}: a BEFORE value`).toBeDefined();
      // the flattened preview keeps its background (the slide's: as designed)
      expect(e.flat, `${t.id}: the flattened preview's background`).toBe(before.flat);
      // every theme: its generated surround drawn everywhere — the read view, the letterbox both ways round (it was
      // reveal's white), the stage, the live card's chrome
      expect(a.surround, `${t.id}: a generated --sl-surround`).toMatch(/^#[0-9a-f]{6}$/);
      expect(a.view, `${t.id}: the read view's surround`).toBe(a.surround);
      for (const [where, c, tol] of [['4:3 letterbox', a.letterbox, 3], ['16:9 letterbox', b.letterbox, 3], ['stage', e.stage, 3], ['live card', e.card, 1]] as const) {
        expect(near(parse(c), parse(a.surround), tol), `${t.id}: ${where} ${c} is the surround ${a.surround}`).toBe(true);
      }
      // a light theme's is its designed tint (the layer's --sl-viewport, before the revision computed but never drawn)
      if (t.scheme === 'light') expect(a.view, `${t.id}: a light theme's designed tint`).toBe(DESIGNED[t.id] ?? before.view);
      // in its band, the slide's edge visible, low chroma
      const band = t.scheme === 'dark' ? SURROUND_BAND : SURROUND_LIGHT_BAND;
      for (const [where, c] of [['read view', a.view], ['4:3 letterbox', a.letterbox], ['16:9 letterbox', b.letterbox], ['stage', e.stage], ['live card', e.card]] as const) {
        const [L] = oklchOf(parse(c));
        expect(L, `${t.id} ${where} ${c}: OKLCH L in [${band.join(', ')}]`).toBeGreaterThanOrEqual(band[0]);
        expect(L, `${t.id} ${where} ${c}: OKLCH L in [${band.join(', ')}]`).toBeLessThanOrEqual(band[1]);
        if (t.scheme === 'dark') expect(L, `${t.id} ${where}: never near black`).toBeGreaterThan(0.15);
      }
      expect(deltaE(parse(a.view), parse(a.slide)), `${t.id}: the slide's edge (${a.view} vs ${a.slide})`).toBeGreaterThanOrEqual(3);
      expect(deltaE(parse(e.stage), parse(a.slide)), `${t.id}: the slide's edge on the stage`).toBeGreaterThanOrEqual(3);
      const [, cs, hs] = oklchOf(parse(a.slide));
      const [, cv, hv] = oklchOf(parse(a.view));
      expect(cv, `${t.id}: low chroma`).toBeLessThanOrEqual(0.04);
      // a dark theme's soft dark is tinted toward the slide's own hue
      if (t.scheme === 'dark' && cs > 0.01 && cv > 0.01) expect(Math.min(Math.abs(hs - hv), 360 - Math.abs(hs - hv)), `${t.id}: the slide's hue`).toBeLessThan(20);
    });
  }

  for (const t of THEMES) {
    it(`[T.15] ${t.id}: the surround in overview, Present and the speaker view's panes is the same`, async () => {
      const a = await readView(t.id, '4:3', 1280, 720);
      const { page, ctx } = a;
      const surround = parse(a.view);
      // overview: the read view's background, around the thumbnails
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); });
      await page.keyboard.press('o');
      await page.waitForFunction(() => document.querySelector('.reveal')!.classList.contains('overview'));
      await page.waitForTimeout(900);
      const ov = await pixel(page, 6, 714);
      expect(near(ov, surround), `${t.id} overview ${hex(ov)} vs ${a.view}`).toBe(true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.reveal')!.classList.contains('overview'));
      // Present (full screen where the browser allows it): the letterbox is the surround
      await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.menu.open());
      await page.getByRole('menuitem', { name: 'Present' }).click();
      await page.waitForFunction(() => document.getElementById('orz-view')!.classList.contains('orz-presenting'));
      await page.waitForTimeout(400);
      const pr = await pixel(page, 6, 360);
      expect(near(pr, surround), `${t.id} Present ${hex(pr)} vs ${a.view}`).toBe(true);
      await page.keyboard.press('Escape');
      // the speaker view: its slide panes stand on the surround
      const popup = ctx.waitForEvent('page');
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); });
      await page.keyboard.press('s');
      const sv = await popup;
      await sv.waitForSelector('[data-sv="cur"] section.orz-slide');
      const pane = await sv.evaluate(() => getComputedStyle(document.querySelector('[data-sv="cur"]')!).backgroundColor);
      const c = await colour(sv, pane);
      expect(c && near(c, surround, 1), `${t.id} speaker pane ${hex(c)} vs ${a.view}`).toBe(true);
      await ctx.close();
    });
  }
});
