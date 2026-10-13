/**
 * Rebuild step 3 — fit in real Chrome (claims F.1–F.4; STATUS D-46).
 *
 * The oracle is independent of the engine's own measure: every piece of
 * content of a box (each text line's rectangle, each image, canvas and
 * diagram) must lie inside the box and inside every element between it and
 * the box that clips its content — unless the box says `data-clipped`
 * (or scrolls, `fit=scroll`). That is "no silent clipping". Offline (the
 * file must work without the network): fonts and content libraries fall
 * back, which is exactly when fit must still hold.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { corpus, goTo, launchChrome, openDeck } from './helpers.js';
import { checkDeck } from './fit-oracle.js';

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-fit-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;

chrome('fit (real Chrome, offline)', () => {
  it('[F.1] every box of every slide of every slides corpus deck fits, is scaled to at least the floor, or says data-clipped — no silent clipping', async () => {
    for (const c of corpus('slides')) {
      const { page, ctx, errors } = await openDeck(browser!, join(dir, c.path.replace(/^slides\//, '').replace(/\.md$/, '.html')), assemble(c.text));
      const boxes = await checkDeck(page, c.path);
      expect(boxes.length, c.path).toBeGreaterThan(0);
      expect(errors, c.path).toEqual([]);
      await ctx.close();
    }
  });

  it('[F.2] D-46: a long title on title v2 (and on v1) stays inside the slide — the template page is a fitted box, nothing spills past either edge', async () => {
    const c = corpus('slides').find((x) => x.path.endsWith('title-v2-long-title.slides.md'))!;
    const { page, ctx } = await openDeck(browser!, join(dir, 'd46.slides.html'), assemble(c.text));
    for (const i of [0, 1, 2]) {
      await goTo(page, i);
      const r = await page.evaluate((n) => {
        const s = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n];
        const t = s.querySelector<HTMLElement>('.orz-template')!;
        const h1 = t.querySelector<HTMLElement>('h1')!;
        const sr = s.getBoundingClientRect();
        const hr = h1.getBoundingClientRect();
        return { scale: t.getAttribute('data-scale'), clipped: t.hasAttribute('data-clipped'), inside: hr.left >= sr.left - 1 && hr.right <= sr.right + 1 && hr.top >= sr.top - 1 && hr.bottom <= sr.bottom + 1, title: h1.textContent };
      }, i);
      expect(r.inside, `slide ${i + 1}: the title is inside the slide`).toBe(true);
      expect(r.clipped, `slide ${i + 1}`).toBe(false);
    }
    await checkDeck(page, 'D-46');
    await ctx.close();
  });

  it('[F.3] both axes: a table wider than the slide is scaled to the floor and then marked clipped; dense text is scaled; a big picture takes its column; fit=off is not scaled but marked; fit=scroll scrolls; a long section title is scaled into the page', async () => {
    const text = readFileSync('tests/fixtures/fit/wide.slides.md', 'utf8');
    const { page, ctx, errors } = await openDeck(browser!, join(dir, 'wide.slides.html'), assemble(text));
    const boxes = await checkDeck(page, 'wide');
    const region = (slide: number) => boxes.find((b) => b.slide === slide && b.box.includes('orz-region'))!;
    expect(region(0)).toMatchObject({ scale: '0.60', clipped: true });
    expect(region(1)).toMatchObject({ clipped: false });
    expect(Number(region(2).scale)).toBeLessThan(1);
    expect(region(2).clipped).toBe(false);
    expect(boxes.filter((b) => b.slide === 3).every((b) => !b.clipped)).toBe(true);
    expect(region(4)).toMatchObject({ scale: '1', clipped: true });
    expect(region(5)).toMatchObject({ scale: '1', clipped: false, scroll: true });
    const section = boxes.find((b) => b.slide === 6)!;
    expect(Number(section.scale)).toBeLessThan(1);
    expect(section.clipped).toBe(false);
    expect(region(7)).toMatchObject({ scale: '1', clipped: false });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('[F.4] the sample deck (math, code, a table, a picture, a float, a molecule, a chart and a diagram): every box fits or says so; fit runs on the visible slide only', async () => {
    const sub = join(dir, 'sample');
    rmSync(sub, { recursive: true, force: true });
    (await import('node:fs')).mkdirSync(sub);
    copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(sub, 'gpc-traces.svg'));
    const { page, ctx, errors } = await openDeck(browser!, join(sub, 'sample.slides.html'), assemble(readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8')));
    // before any navigation only the first slide was fitted
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section')).map((s) => s.hasAttribute('data-fitted')))).toEqual([true, ...Array(11).fill(false)]);
    // offline (no KaTeX stylesheet, no webfonts) a box may be cut — then it says so (online it is not: tests/engine.test.ts K.8)
    await checkDeck(page, 'sample');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
