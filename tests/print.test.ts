/**
 * Rebuild step 3 — the print document in real Chrome (claims Q.1–Q.3; Q8
 * of REBUILD §3c): the carrier's print document instead of reveal.js's
 * `?print-pdf`, printed through the kit's `printDocument`.
 *
 * The document is printed to PDF by Chrome itself (`page.pdf` with the
 * document's own `@page` size): the page count and the page size are read
 * from the PDF. 1 CSS px = 0.75 pt.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { corpus, launchChrome, openDeck, type PageGlobal } from './helpers.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-print-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;

const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');

/** The page sizes of a PDF (pt), in order. */
function pdfPages(pdf: Buffer): Array<[number, number]> {
  const s = pdf.toString('latin1');
  const out: Array<[number, number]> = [];
  for (const m of s.matchAll(/\/Type\s*\/Page(?![s\w])[\s\S]*?\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)) out.push([Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])]);
  return out;
}

async function printHtml(page: Page, notes = false): Promise<{ html: string; pages: number; width: number; height: number }> {
  return page.evaluate((n) => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.printHtml({ notes: n }) as Promise<{ html: string; pages: number; width: number; height: number }>, notes);
}

/** Print a document to PDF in a fresh page (offline: the document needs nothing it does not carry). */
async function toPdf(html: string, name: string): Promise<{ pages: Array<[number, number]>; probe: { fragments: number; hidden: number; boxes: number; unscaled: number; scripts: number } }> {
  const path = join(dir, name);
  writeFileSync(path, html, 'utf8');
  const ctx = await browser!.newContext();
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  await p.goto(`file://${path}`);
  const probe = await p.evaluate(() => ({
    fragments: document.querySelectorAll('.fragment').length,
    hidden: Array.from(document.querySelectorAll('.fragment')).filter((f) => getComputedStyle(f).opacity !== '1' || getComputedStyle(f).visibility !== 'visible').length,
    boxes: document.querySelectorAll('.orz-box').length,
    unscaled: document.querySelectorAll('.orz-box:not([data-scale])').length,
    scripts: document.scripts.length,
  }));
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  await ctx.close();
  return { pages: pdfPages(pdf), probe };
}

chrome('the print document (real Chrome)', () => {
  it('[Q.1] one slide per page at the slide\'s size (16:9 → 1280 × 720 px, 4:3 → 960 × 720), every fragment shown, every box fitted, no script', async () => {
    const sub = join(dir, 'sample');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx, errors } = await openDeck(browser!, join(sub, 'sample.slides.html'), assemble(SAMPLE));
    const doc = await printHtml(page);
    expect(doc).toMatchObject({ pages: 12, width: 1280, height: 720 });
    const r = await toPdf(doc.html, 'sample/print.html');
    expect(r.pages).toHaveLength(12);
    for (const [w, h] of r.pages) { expect(w).toBeCloseTo(960, 0); expect(h).toBeCloseTo(540, 0); }
    expect(r.probe.fragments).toBe(0); // the print document carries no step: every block shows
    expect(r.probe.boxes).toBeGreaterThan(20);
    expect(r.probe.unscaled).toBe(0);
    expect(r.probe.scripts).toBe(0);
    // the print stage is gone from the page
    expect(await page.locator('.orz-print').count()).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
    // 4:3, and the manual fragments of the corpus deck show
    const nf = corpus('slides').find((c) => c.path.endsWith('notes-and-fragments.slides.md'))!;
    const d2 = await openDeck(browser!, join(dir, 'nf.slides.html'), assemble(nf.text));
    const doc2 = await printHtml(d2.page);
    expect(doc2).toMatchObject({ pages: 12, width: 960, height: 720 });
    const r2 = await toPdf(doc2.html, 'nf-print.html');
    expect(r2.pages).toHaveLength(12);
    for (const [w, h] of r2.pages) { expect(w).toBeCloseTo(720, 0); expect(h).toBeCloseTo(540, 0); }
    expect(r2.probe.fragments).toBe(2);
    expect(r2.probe.hidden).toBe(0);
    // a slide background is on the slide itself in print
    expect(doc2.html).toMatch(/data-background-color="#10243a"[^>]*style="[^"]*background: rgb\(16, 36, 58\)/);
    await d2.ctx.close();
  });

  it('[Q.2] "with notes": each page is the slide over its speaker notes (pages 1280 × 1240 px)', async () => {
    const sub = join(dir, 'notes');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx } = await openDeck(browser!, join(sub, 'sample.slides.html'), assemble(SAMPLE));
    const doc = await printHtml(page, true);
    expect(doc).toMatchObject({ pages: 12, width: 1280, height: 1240 });
    expect(doc.html).toContain('Notes · slide 1');
    expect(doc.html).toContain('The long title is deliberate');
    const r = await toPdf(doc.html, 'notes/print.html');
    expect(r.pages).toHaveLength(12);
    for (const [w, h] of r.pages) { expect(w).toBeCloseTo(960, 0); expect(h).toBeCloseTo(930, 0); }
    await ctx.close();
  });

  it('[Q.3] Print is the action with id print: Cmd/Ctrl+P in the read view prints the print document in the kit\'s sandboxed frame (never the page); Print with notes is in the pencil\'s list', async () => {
    const sub = join(dir, 'keys');
    mkdirSync(sub, { recursive: true });
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx } = await openDeck(browser!, join(sub, 'sample.slides.html'), assemble(SAMPLE));
    await page.evaluate(() => { (window as unknown as { __pagePrinted: number }).__pagePrinted = 0; window.print = () => { (window as unknown as { __pagePrinted: number }).__pagePrinted++; }; });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
    await page.waitForSelector('iframe[data-orz-print]', { state: 'attached', timeout: 30_000 });
    const frame = await page.evaluate(() => {
      const f = document.querySelector<HTMLIFrameElement>('iframe[data-orz-print]')!;
      return { sandbox: f.getAttribute('sandbox'), pages: (f.srcdoc.match(/class="orz-page"/g) ?? []).length, title: f.getAttribute('title') };
    });
    expect(frame).toEqual({ sandbox: 'allow-scripts allow-modals', pages: 12, title: 'Print slides' });
    expect(await page.evaluate(() => (window as unknown as { __pagePrinted: number }).__pagePrinted)).toBe(0);
    await page.waitForFunction(() => !document.querySelector('iframe[data-orz-print]'), null, { timeout: 60_000 });
    await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.menu.open());
    expect(await page.getByRole('menuitem', { name: 'Print with notes' }).count()).toBe(1);
    expect(await page.getByRole('menuitem', { name: 'Print', exact: true }).count()).toBe(1);
    await ctx.close();
  });
});
