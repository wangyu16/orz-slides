/**
 * Step 10, the final closed loop — theme probes over every theme, OFFLINE
 * (the fallback fonts; what `inspect --layout --offline` and a reader
 * without the network see):
 *
 * - T.16 (FINAL-ENG-1): a template page that holds only its heading — title
 *   v1–v6, section v1–v4 (short and long), outline v1–v3, closing v1–v3, at
 *   16:9 and 4:3 — is never clipped, a one-line heading is never scaled,
 *   and nothing the theme draws is cut by the template box (the page with
 *   the box's clip widened looks the same). Decorations that hang
 *   below the heading (a badge, a lozenge, a shadow, a rotation) used to
 *   take the subtitle's room, which a bare page does not have.
 * - Q.6 (FINAL-ENG-2): every text the print document adds — the notes area
 *   (its head and every kind of note text: a paragraph, strong, em, code, a
 *   link, a list item, a quote, a code block), the "cut on paper" notices and
 *   the slide's chrome on paper (its number; at 3 : 1, its own design) — reads at 4.5 : 1 or more
 *   against what is drawn behind it, printed and printed with notes, in
 *   every theme (the notes body took a dark theme's light ink on white paper).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { THEMES } from '../src/themes.js';
import { TEMPLATES } from '../src/deck/parse.js';
import { checkDeck, checkSlide, reportBoxes } from './fit-oracle.js';
import { goTo, launchChrome, loadDeck, openDeck, settled, type PageGlobal } from './helpers.js';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { textOverlaps } from './support/overprint.js';

type Page = import('playwright-core').Page;

const browser = await launchChrome();
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-final-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const real = browser ? describe : describe.skip;
const fileFor = (name: string): string => { const sub = join(dir, name); mkdirSync(sub, { recursive: true }); return join(sub, 'deck.slides.html'); };

const SHORT: Record<string, string> = { title: 'Quarterly review', section: 'Results', outline: 'Plan', closing: 'Thanks' };
const LONG = 'A much longer heading that wraps onto two lines here';
/** Heading-only template pages: every variant, a one-line heading (short) and a two-line one (long). */
const BARE: Array<{ template: string; v: number; long: boolean }> = [];
for (const [template, n] of Object.entries(TEMPLATES)) for (let v = 1; v <= n; v++) for (const long of [false, true]) BARE.push({ template, v, long });
const bareDeck = (theme: string, ratio: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: bare\ntheme: ${theme}\nratio: ${ratio}\nfooter: a footer line\n}}\n\n${BARE.map((b) => `<!-- slide template=${b.template} v=${b.v} -->\n# ${b.long ? LONG : SHORT[b.template]}\n${b.template === 'outline' ? '\n1. One\n2. Two\n' : ''}`).join('\n')}`;

/** Pixels of the current slide that change when its template box paints past its edge (what the box cuts off). */
const cutByTemplate = (page: Page): Promise<number> => cutByBoxes(page, '.orz-template');

/** More pixels than this, cut by the boxes, is a cut (unchanged since the final loop). */
const CUT_PX = 40;

/*
 * The capture discipline of the pixel oracles T.16, T.19 and T.20 (family Phase 4 follow-up G: the stamp run failed a
 * different one of them on every run — T.19 orchard; T.19 notebook + T.20 nocturne; T.16 nocturne + T.19 notebook +
 * T.20 nocturne).
 *
 * ROOT CAUSE (measured, 2026-10-20): the oracle widened the boxes' clip with `page.addStyleTag`, and a <style> element
 * fires `load` — which the engine rightly takes for a stylesheet that may change what fits (engine.ts `onSheet`): it
 * refitted the slide and unsettled it, so the "widened" shot was taken inside a refit-and-settle cycle that the probe
 * itself had started. In that cycle the slide's chrome is drawn again and re-rastered: nocturne's "Ln 10" label
 * differed by 36 px in the widened shot only, and a template edge by 5 px — together over the 40 px threshold, a
 * "cut" that was not there, at random (it depended on whether the shot landed before or after the refit's frame).
 *
 * Now:
 * - the clip is widened with a constructed stylesheet (`document.adoptedStyleSheets`): no element, no load event,
 *   no refit — only the paint changes, which is what the oracle compares;
 * - before each comparison the slide is QUIET: its fit settled, `document.fonts.ready`, every image of the slide
 *   loaded and decoded, then two animation frames painted with no refit meanwhile — else again;
 * - a capture counts only if the slide stayed settled through all three shots (a watch counts every unsettle and
 *   every refit: `data-fit-settled` dropped, `data-scale` written); otherwise it is retaken — no capture races an
 *   in-flight image or font load, or a refit;
 * - a cut is reported only when it persists in TWO valid comparisons (the second is taken when the first finds one).
 * The tolerances are unchanged: 48 per pixel (RGB sum), 40 px, the 1 px band on a box's own edge.
 */

/** Once per document: count every unsettle and every refit of the current slide (`__orzUnsettles`). */
async function watchSettle(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { __orzUnsettles?: number };
    if (g.__orzUnsettles === undefined) {
      g.__orzUnsettles = 0;
      new MutationObserver((rs) => {
        for (const r of rs) if (r.attributeName === 'data-scale' || !(r.target as Element).hasAttribute('data-fit-settled')) g.__orzUnsettles = (g.__orzUnsettles ?? 0) + 1;
      }).observe(document.querySelector('.reveal .slides')!, { attributes: true, subtree: true, attributeFilter: ['data-fit-settled', 'data-scale'] });
    }
    return g.__orzUnsettles;
  });
}

/** `n` animation frames painted (headless Chrome paints this deck at ~14 frames a second here: frames are the cost). */
const frames = (page: Page, n: number): Promise<void> => page.evaluate((k) => new Promise<void>((r) => { const f = (): void => { if (--k <= 0) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);

/** The current slide carries `data-fit-settled`. */
const isSettled = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('.reveal .slides > section.present')?.hasAttribute('data-fit-settled') === true);

/**
 * The current slide is quiet: its fit settled (the engine's `settled()` when it is not), the fonts in
 * (`document.fonts.ready`), its images loaded and decoded, then two animation frames painted — and nothing refitted
 * or unsettled meanwhile (the watch); else again.
 */
async function quiet(page: Page): Promise<void> {
  for (let k = 0; k < 10; k++) {
    const before = await watchSettle(page);
    if (!(await isSettled(page))) await settled(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const slide = document.querySelector('.reveal .slides > section.present');
      await Promise.all(Array.from(slide?.querySelectorAll('img') ?? []).map(async (img) => {
        if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
        await img.decode().catch(() => undefined);
      }));
    });
    await frames(page, 2);
    if ((await isSettled(page)) && (await watchSettle(page)) === before) return;
  }
  throw new Error('the slide never became quiet (it kept refitting for 10 rounds)');
}

/**
 * One comparison, taken while the slide stays quiet: the slide, the slide with the boxes' (`sel`) clip widened, the
 * slide again. A pixel counts when the widened shot differs from both others (a late paint between the shots is no
 * cut) and is not on a box's own edge. Retaken when the slide refitted or unsettled during the shots.
 */
async function compareOnce(page: Page, sel: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    await quiet(page);
    const before = await watchSettle(page);
    const { clip, edges } = await page.evaluate((s) => {
      const slide = document.querySelector('.reveal .slides > section.present')!;
      const r = slide.getBoundingClientRect();
      const clip = { x: Math.max(0, r.left - 40), y: Math.max(0, r.top - 40), width: r.width + 80, height: r.height + 80 };
      const edges = [...slide.querySelectorAll(s)].map((el) => {
        const b = el.getBoundingClientRect();
        return { l: b.left - clip.x, t: b.top - clip.y, r: b.right - clip.x, b: b.bottom - clip.y };
      });
      return { clip, edges };
    }, `:is(${sel})`);
    const a = await page.screenshot({ clip });
    // the clip widened, not removed: overflow: visible would lay the box out again (a flex item's minimum size) and refit
    // it, so the pictures would differ where nothing was cut; a wider overflow-clip-margin only paints more. A
    // constructed sheet, not a <style>: an element's load event would make the engine refit (the root cause above).
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      (globalThis as unknown as { __orzWiden?: CSSStyleSheet }).__orzWiden = sheet;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, `.reveal .slides > section.present :is(${sel}) { overflow-clip-margin: 4000px !important; }`);
    await frames(page, 1); // the style applied (the screenshot then renders a fresh frame of its own)
    const b = await page.screenshot({ clip });
    await page.evaluate(() => {
      const sheet = (globalThis as unknown as { __orzWiden?: CSSStyleSheet }).__orzWiden;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== sheet);
    });
    await frames(page, 1);
    const a2 = await page.screenshot({ clip });
    const stayed = (await watchSettle(page)) === before && (await isSettled(page));
    if (!stayed) {
      if (attempt < 5) continue; // the slide refitted while the shots were taken: not a valid comparison, take it again
      throw new Error(`${sel}: the slide refitted during every one of 5 captures`);
    }
    return page.evaluate(async ({ x, y, z, edges }) => {
      let w = 0;
      const load = async (d: string): Promise<Uint8ClampedArray> => {
        const img = new Image();
        img.src = `data:image/png;base64,${d}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height; w = img.width;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q, r] = [await load(x), await load(y), await load(z)];
      const differs = (u: Uint8ClampedArray, v: Uint8ClampedArray, i: number): boolean => Math.abs(u[i] - v[i]) + Math.abs(u[i + 1] - v[i + 1]) + Math.abs(u[i + 2] - v[i + 2]) > 48;
      // on a box's edge: within 1 px of one of its four sides, along that side
      const onEdge = (px: number, py: number): boolean => edges.some((e) => {
        const nearX = px >= e.l - 1 && px <= e.r + 1, nearY = py >= e.t - 1 && py <= e.b + 1;
        return (nearX && (Math.abs(py - e.t) <= 1 || Math.abs(py + 1 - e.b) <= 1)) || (nearY && (Math.abs(px - e.l) <= 1 || Math.abs(px + 1 - e.r) <= 1));
      });
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (differs(p, q, i) && differs(r, q, i)) { const k = i / 4; if (!onEdge(k % w, Math.floor(k / w))) n++; }
      return n;
    }, { x: a.toString('base64'), y: b.toString('base64'), z: a2.toString('base64'), edges });
  }
}

/**
 * Pixels of the current slide that change when its boxes (`sel`) paint past their edges (what the boxes cut off).
 * Pixels within 1 px of a box's own edge do not count: a box that draws its own 1 px border on its edge (Orchard's
 * title v3 panel) is re-rasterised there now and then when its clip is widened — one antialiased row, nothing past
 * the edge (step 11: 200 px on the panel's last row, 2 runs in 3) — while anything the box really cuts lies beyond it.
 * A cut must persist: the second comparison is taken when the first finds more than CUT_PX, and the smaller counts.
 */
async function cutByBoxes(page: Page, sel: string): Promise<number> {
  const first = await compareOnce(page, sel);
  return first > CUT_PX ? Math.min(first, await compareOnce(page, sel)) : first;
}

const NO_TRANSITIONS = '.reveal .slides > section, .reveal .backgrounds .slide-background { transition: none !important; }';

real('final loop: theme probes (real Chrome, offline)', () => {
  for (const t of THEMES) {
    it(`[T.16] ${t.id}: heading-only template pages (every variant, short and long heading, 16:9 and 4:3) are never clipped, a one-line heading is never scaled, and the template box cuts nothing the theme draws`, async () => {
      const bad: string[] = [];
      let open: Awaited<ReturnType<typeof openDeck>> | null = null;
      for (const ratio of ['16:9', '4:3']) {
        // one page for the theme: the second deck loads into it
        const file = fileFor(`bare-${t.id}-${ratio.replace(':', 'x')}`);
        if (!open) open = await openDeck(browser!, file, assemble(bareDeck(t.id, ratio)));
        else await loadDeck(open.page, file, assemble(bareDeck(t.id, ratio)));
        const { page, errors } = open;
        await page.addStyleTag({ content: NO_TRANSITIONS });
        // every slide once, in order: fitted when shown, the fit oracle, then the cut
        for (const [i, b] of BARE.entries()) {
          const where = `${ratio} ${b.template} v${b.v} ${b.long ? 'long' : 'short'}`;
          await goTo(page, i);
          const tpl = (await checkSlide(page, i, `${t.id} ${ratio}`)).find((x) => /orz-template/.test(x.box));
          if (!tpl) { bad.push(`${where}: no template box`); continue; }
          if (tpl.clipped) bad.push(`${where}: clipped at ${tpl.scale}`);
          else if (!b.long && b.template !== 'outline' && Number(tpl.scale) < 1) bad.push(`${where}: scaled to ${tpl.scale}`);
          const cut = await cutByTemplate(page);
          if (cut > CUT_PX) bad.push(`${where}: the template box cuts ${cut} px of what the theme draws`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
      }
      await open?.ctx.close();
      expect(bad, t.id).toEqual([]);
    }, 480_000); // chalk takes ~290 s on a busy machine (base too)
  }

  const NOTES = 'Plain sentence. **Strong** and *em* and `code` and [a link](https://example.com).\n\n- an item\n\n> a quote\n\n```\ncode block\n```';
  const printDeck = (theme: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: print\ntheme: ${theme}\nfooter: a footer line\n}}\n\n<!-- slide -->\n## A slide with notes\n\nSome text.\n\n<!-- @notes -->\n${NOTES}\n\n<!-- slide fit=off -->\n## Too much\n\n${Array.from({ length: 30 }, (_, i) => `- line ${i + 1} of a slide that is too long for its box`).join('\n')}\n\n<!-- @notes -->\n${Array.from({ length: 260 }, (_, i) => `Note sentence ${i + 1}, long enough to fill the notes area of the page.`).join(' ')}\n`;

  /** Every text the print document adds, with its ink and the median of what is drawn behind it (the text hidden). */
  async function printInks(page: Page): Promise<Array<{ what: string; ratio: number; ink: string; bg: string }>> {
    const n = await page.evaluate(() => {
      const leaves = (root: Element): Element[] => Array.from(root.querySelectorAll('*')).filter((e) => Array.from(e.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim()));
      const picked: Element[] = [];
      for (const notes of Array.from(document.querySelectorAll('.orz-print-notes'))) picked.push(...leaves(notes));
      picked.push(...Array.from(document.querySelectorAll('.orz-print-cut')));
      for (const c of Array.from(document.querySelectorAll('.orz-page section .orz-chrome'))) picked.push(...leaves(c));
      let k = 0;
      for (const e of picked) { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0) e.setAttribute('data-probe', String(k++)); }
      return k;
    });
    const out: Array<{ what: string; ratio: number; ink: string; bg: string }> = [];
    for (let k = 0; k < n; k++) {
      const box = await page.evaluate((i) => {
        const el = document.querySelector<HTMLElement>(`[data-probe="${i}"]`)!;
        el.scrollIntoView({ block: 'start' }); // its first line in view (a long note's paragraph is taller than the window)
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const fill = cs.getPropertyValue('-webkit-text-fill-color');
        const where = el.closest('.orz-print-notes') ? 'notes' : el.classList.contains('orz-print-cut') ? 'cut notice' : 'chrome';
        return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, 600), height: Math.min(r.height, 80), ink: fill && fill !== cs.color && !/rgba\(0, 0, 0, 0\)/.test(fill) ? fill : cs.color, what: `${where} <${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 24)}"` };
      }, k);
      if (box.width < 2 || box.height < 2) continue;
      const hide = await page.addStyleTag({ content: `[data-probe="${k}"], [data-probe="${k}"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }` });
      const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      await hide.evaluate((el) => (el as Element).remove());
      const r = await page.evaluate(async ({ data, ink }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const ch: number[][] = [[], [], []];
        for (let i = 0; i < px.length; i += 4) for (let q = 0; q < 3; q++) ch[q].push(px[i + q]);
        const median = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
        const probe = document.createElement('span');
        probe.style.color = ink;
        document.body.appendChild(probe);
        const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(probe).color)!;
        probe.remove();
        const a = m[4] === undefined ? 1 : Number(m[4]);
        const fg = [1, 2, 3].map((q, j) => Number(m[q]) * a + median[j] * (1 - a));
        const lum = (rgb: number[]): number => { const [rr, gg, bb] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb; };
        const [l1, l2] = [lum(fg), lum(median)].sort((x, y) => y - x);
        return { ratio: (l1 + 0.05) / (l2 + 0.05), ink: `rgb(${fg.map(Math.round).join(',')})`, bg: `rgb(${median.join(',')})` };
      }, { data: png.toString('base64'), ink: box.ink });
      out.push({ what: box.what, ...r });
    }
    return out;
  }

  for (const t of THEMES) {
    it(`[Q.6] ${t.id}: on paper every added text reads — the notes area (head, paragraph, strong, em, code, link, list, quote, code block) and the cut notices at 4.5 : 1 or more, the slide's chrome at 3 : 1 — printed and printed with notes`, async () => {
      const { page, ctx } = await openDeck(browser!, fileFor(`print-${t.id}`), assemble(printDeck(t.id)));
      const bad: string[] = [];
      for (const notes of [false, true]) {
        const doc = await page.evaluate((nn) => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.printHtml({ notes: nn }) as Promise<{ html: string }>, notes);
        const path = join(dir, `print-${t.id}-${notes ? 'notes' : 'plain'}.html`);
        writeFileSync(path, doc.html, 'utf8');
        const p = await ctx.newPage();
        await p.setViewportSize({ width: 1400, height: 1300 });
        await p.goto(`file://${path}`);
        await p.evaluate(() => document.fonts.ready);
        const inks = await printInks(p);
        expect(inks.filter((x) => x.what.startsWith('cut notice')).length, `${t.id} ${notes ? 'with notes' : 'plain'}: cut notices`).toBeGreaterThan(notes ? 1 : 0);
        if (notes) expect(inks.filter((x) => x.what.startsWith('notes')).length, t.id).toBeGreaterThan(8);
        // what print adds reads at 4.5 : 1; the slide's own chrome (the theme's on-screen design, the same on paper) at 3 : 1,
        // a separator glyph (`/`, `·`, `—`) being decoration
        for (const x of inks) if (x.what.startsWith('chrome') ? !/"[\/·|—–-]"$/.test(x.what) && x.ratio < 3 : x.ratio < 4.5) bad.push(`${notes ? 'with notes' : 'plain'}: ${x.what} ${x.ink} on ${x.bg} = ${x.ratio.toFixed(2)}`);
        await p.close();
      }
      expect(bad, t.id).toEqual([]);
      await ctx.close();
    }, 240_000);
  }

  /** A deck whose float overflows at full size (the agent lecture's callout) and one that overflows past the floor. */
  const floatDeck = (theme: string, ratio: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: floats\ntheme: ${theme}\nratio: ${ratio}\n}}\n\n<!-- slide -->\n## A float that needs to shrink\n\nThe body text of the slide.\n\n<!-- @float right=3% top=12% w=20% h=12% -->\n::: info\nCheck: pH < 7\n:::\n\n<!-- slide -->\n## A float past the floor\n\nBody.\n\n<!-- @float left=5% top=40% w=12% h=8% -->\n${Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of far too much text for this float.`).join(' ')}\n`;

  for (const t of THEMES) {
    it(`[F.8] ${t.id}: a float shrinks like every box — its drawn font size is its size at full scale times its data-scale — so an overflowing float is fitted (or, past the floor, marked clipped), never reported scaled while drawn at full size (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      for (const ratio of ['16:9', '4:3']) {
        const { page, ctx, errors } = await openDeck(browser!, fileFor(`float-${t.id}-${ratio.replace(':', 'x')}`), assemble(floatDeck(t.id, ratio)));
        await checkDeck(page, `${t.id} ${ratio}`); // no silent clipping
        for (const i of [0, 1]) {
          await goTo(page, i);
          const r = await page.evaluate((n) => {
            const f = document.querySelectorAll<HTMLElement>('.reveal .slides > section')[n]!.querySelector<HTMLElement>('.orz-float')!;
            const scale = Number(f.getAttribute('data-scale'));
            const drawn = parseFloat(getComputedStyle(f).fontSize);
            const was = f.style.getPropertyValue('--fit-scale');
            f.style.setProperty('--fit-scale', '1');
            const full = parseFloat(getComputedStyle(f).fontSize);
            if (was) f.style.setProperty('--fit-scale', was); else f.style.removeProperty('--fit-scale');
            return { scale, drawn, full, clipped: f.hasAttribute('data-clipped') };
          }, i);
          if (Math.abs(r.drawn - r.full * r.scale) > 0.6) bad.push(`${ratio} slide ${i + 1}: data-scale ${r.scale} but drawn at ${r.drawn}px of ${r.full}px`);
          if (i === 0 && r.clipped) bad.push(`${ratio} slide 1: the callout float is cut (scale ${r.scale})`);
          if (i === 1 && !(r.scale < 1)) bad.push(`${ratio} slide 2: the overflowing float was not scaled`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
        await ctx.close();
      }
      expect(bad, t.id).toEqual([]);
    }, 240_000);
  }

  const SAMPLE = readFileSync('tests/fixtures/sample/sample.slides.md', 'utf8');
  for (const t of THEMES) {
    it(`[T.17] ${t.id}: OFFLINE (no content library, no webfont: a firewall, a CDN outage) the sample deck has no silent clipping and no text over another on any slide — an undrawn diagram, chart or molecule shows its source readably (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      for (const ratio of ['16:9', '4:3']) {
        const file = fileFor(`offline-${t.id}-${ratio.replace(':', 'x')}`);
        copyFileSync('tests/fixtures/sample/gpc-traces.svg', join(file, '..', 'gpc-traces.svg'));
        const { page, ctx, errors } = await openDeck(browser!, file, assemble(SAMPLE.replace(/^theme: .*$/m, `theme: ${t.id}`).replace(/^ratio: .*$/m, `ratio: ${ratio}`)));
        await page.addStyleTag({ content: '.reveal .slides > section, .reveal .backgrounds .slide-background { transition: none !important; }' });
        await checkDeck(page, `${t.id} ${ratio}`);
        const total = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
        for (let i = 0; i < total; i++) {
          await goTo(page, i);
          for (const x of await textOverlaps(page)) bad.push(`${ratio} slide ${i + 1}: ${x}`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
        await ctx.close();
      }
      expect(bad, t.id).toEqual([]);
    }, 240_000);
  }
  // ---------- step 10, the confirming round ----------

  const URL = 'https://example.com/a/very/long/path/that/never/breaks/because/it/has/no/spaces/at/all/index.html';
  const urlDeck = (theme: string, ratio: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: url\ntheme: ${theme}\nratio: ${ratio}\n}}\n\n<!-- slide -->\n## Link\n\nSee ${URL} for details.\n\n<!-- slide -->\n## Link in a list\n\n- See ${URL} for details.\n- A second item.\n`;

  for (const t of THEMES) {
    it(`[T.18] ${t.id}: body text breaks a long URL (overflow-wrap: break-word) — a paragraph or a list item holding one is never scaled and never cut (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      for (const ratio of ['16:9', '4:3']) {
        const { page, ctx, errors } = await openDeck(browser!, fileFor(`url-${t.id}-${ratio.replace(':', 'x')}`), assemble(urlDeck(t.id, ratio)));
        const boxes = await checkDeck(page, `${t.id} ${ratio}`);
        for (const b of boxes.filter((x) => /orz-region/.test(x.box))) {
          if (b.clipped) bad.push(`${ratio} slide ${b.slide + 1}: clipped at ${b.scale}`);
          else if (Number(b.scale) < 1) bad.push(`${ratio} slide ${b.slide + 1}: scaled to ${b.scale}`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
        await ctx.close();
      }
      expect(bad, t.id).toEqual([]);
    }, 240_000);
  }

  const META = '**Yu Wang** · Department of Chemistry, University of Louisiana at Lafayette\\\nCHEM 512 · October 16, 2026 · yu.wang@example.edu';
  const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500"><rect width="1600" height="500" fill="#3b82f6"/><text x="800" y="270" font-size="80" text-anchor="middle" fill="#fff">PICTURE</text></svg>';
  /** Template pages with their content, callouts / a quote / code as a box's first child, and pictures. */
  const FULL: string[] = [
    ...[1, 2, 3, 4, 5, 6].map((v) => `<!-- slide template=title v=${v} -->\n# Polymer Chemistry in Practice: Controlled Radical Polymerization\n## A one-semester graduate seminar, week 7\n${META}\n`),
    ...[1, 2, 3, 4].map((v) => `<!-- slide template=section v=${v} -->\n# Kinetics and molecular-weight control\nWhy $M_n$ follows conversion, and how to read a GPC trace\n`),
    ...[1, 2, 3].map((v) => `<!-- slide template=outline v=${v} -->\n## Today's plan\n1. Mechanism and kinetics of RAFT\n2. Molecular-weight control and dispersity\n3. Choosing a chain transfer agent\n4. RAFT in the lab: practical tips\n5. Block copolymers and end-group fidelity\n6. Outlook and open questions\n`),
    ...[1, 2, 3].map((v) => `<!-- slide template=closing v=${v} -->\n# Thank you\n## Questions and discussion\n**Yu Wang** · yu.wang@example.edu\\\nSlides: markdown.orz.how {{qr https://markdown.orz.how}}\n`),
    ...['info', 'warning', 'danger', 'success'].map((k) => `<!-- slide -->\n## ${k} first\n::: ${k}\nA ${k} callout as the first thing on the slide.\n:::\n`),
    '<!-- slide -->\n## Quote first\n> A quote as the first thing on the slide.\n',
    '<!-- slide -->\n## Code first\n```\ncode first\n```\n',
    '<!-- slide -->\n## A picture\n\n![a picture](pic.svg)\n',
    '<!-- slide 2col -->\n## A picture beside text\n<!-- @left -->\n![a picture](pic.svg)\n<!-- @right -->\n- The picture takes the room left\n- A second line\n',
    '<!-- slide -->\n## Pictures side by side\n\n![a](pic.svg) ![b](pic.svg)\n',
  ];
  const fullDeck = (theme: string, ratio: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: full\ntheme: ${theme}\nratio: ${ratio}\nfooter: a footer line\n}}\n\n${FULL.join('\n')}`;

  for (const t of THEMES) {
    it(`[T.19] ${t.id}: no box cuts what the theme draws once it holds content — template pages with a subtitle and two meta lines, a section's subtitle, an outline, a closing {{qr}}, a callout, quote or code block as a box's first child, a picture alone, beside text and in a row: the page with every box's clip widened looks the same, and nothing is cut silently (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      let open: Awaited<ReturnType<typeof openDeck>> | null = null;
      for (const ratio of ['16:9', '4:3']) {
        const file = fileFor(`full-${t.id}-${ratio.replace(':', 'x')}`);
        writeFileSync(join(file, '..', 'pic.svg'), PICTURE, 'utf8');
        if (!open) open = await openDeck(browser!, file, assemble(fullDeck(t.id, ratio)));
        else await loadDeck(open.page, file, assemble(fullDeck(t.id, ratio)));
        const { page, errors } = open;
        await page.addStyleTag({ content: NO_TRANSITIONS });
        // every slide once, in order: fitted when shown, the fit oracle (nothing cut silently), then the cut
        // (a real cut persists in two quiet comparisons; a late paint — a picture decoded, a font swapped — does not)
        for (let i = 0; i < FULL.length; i++) {
          await goTo(page, i);
          await checkSlide(page, i, `${t.id} ${ratio}`);
          const cut = await cutByBoxes(page, '.orz-region, .orz-template, .orz-float');
          if (cut > CUT_PX) bad.push(`${ratio} slide ${i + 1} (${FULL[i].split('\n')[0]}): the boxes cut ${cut} px of what the theme draws`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
      }
      await open?.ctx.close();
      expect(bad, t.id).toEqual([]);
    }, 300_000);
  }

  /** 20 sections numbered I…XX, in four decks that turn the variants round, so every long or wide numeral meets every variant. */
  const LONG_SECS = [4, 8, 9, 10, 13, 15, 18, 20]; // IV, VIII, IX, X, XIII, XV, XVIII, XX (I…III, V…VII: T.16's pages)
  const secV = (n: number, turn: number): number => ((n - 1 + turn) % 4) + 1;
  const secDeck = (theme: string, ratio: string, turn: number): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: sections\ntheme: ${theme}\nratio: ${ratio}\nsection_numbers: roman\n}}\n\n${Array.from({ length: 20 }, (_, i) => `<!-- slide template=section v=${secV(i + 1, turn)} -->\n# Section ${i + 1}\n`).join('\n')}`;

  for (const t of THEMES) {
    it(`[T.20] ${t.id}: a roman section number of any length — IV, VIII, IX, X, XIII, XV, XVIII (the longest), XX — on every section variant is never cut by its box, never overprints the heading, and a one-line page is never scaled (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      let open: Awaited<ReturnType<typeof openDeck>> | null = null;
      for (const ratio of ['16:9', '4:3']) for (let turn = 0; turn < 4; turn++) {
        // one page for the theme: each of the 8 decks loads into it
        const file = fileFor(`sec-${t.id}-${turn}-${ratio.replace(':', 'x')}`);
        if (!open) open = await openDeck(browser!, file, assemble(secDeck(t.id, ratio, turn)));
        else await loadDeck(open.page, file, assemble(secDeck(t.id, ratio, turn)));
        const { page, errors } = open;
        await page.addStyleTag({ content: NO_TRANSITIONS });
        for (const n of LONG_SECS) {
          const where = `${ratio} section ${n} v${secV(n, turn)}`;
          await goTo(page, n - 1);
          for (const b of await reportBoxes(page, n - 1)) {
            if (b.clipped) bad.push(`${where}: clipped at ${b.scale}`);
            else if (Number(b.scale) < 1) bad.push(`${where}: scaled to ${b.scale}`);
            if (!b.clipped && b.outside.length) bad.push(`${where}: cut silently — ${b.outside.join('; ')}`);
          }
          for (const x of await textOverlaps(page)) bad.push(`${where}: ${x}`);
          const cut = await cutByTemplate(page); // a real cut persists in two quiet comparisons; a late paint does not
          if (cut > CUT_PX) bad.push(`${where}: the template box cuts ${cut} px of the number or heading`);
        }
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
      }
      await open?.ctx.close();
      expect(bad, t.id).toEqual([]);
    }, 400_000);
  }

  const F3 = '`'.repeat(3);
  const codeDeck = (theme: string, ratio: string): string => `{{nyml\nkind: document\ncarrier: slides\ntitle: code\ntheme: ${theme}\nratio: ${ratio}\n}}\n\n<!-- slide -->\n## Code\n\n${F3}js\nexport async function fetchEverything(urls, { retries = 3, timeoutMs = 10000, onProgress = () => {} } = {}) { return 1; }\n${F3}\n\n<!-- slide -->\n## Code, 80 columns\n\n${F3}python\n    results = [compute_moment(sample, order=k, weights=w) for k in range(1, 5)]\n${F3}\n`;

  for (const t of THEMES) {
    it(`[T.21] ${t.id}: code wraps the same in every theme (white-space: pre-wrap, a long line breaks anywhere) — a block holding a 110- or an 80-column line is never scaled and never cut (16:9 and 4:3)`, async () => {
      const bad: string[] = [];
      for (const ratio of ['16:9', '4:3']) {
        const { page, ctx, errors } = await openDeck(browser!, fileFor(`code-${t.id}-${ratio.replace(':', 'x')}`), assemble(codeDeck(t.id, ratio)));
        const boxes = await checkDeck(page, `${t.id} ${ratio}`);
        for (const b of boxes.filter((x) => /orz-region/.test(x.box))) {
          if (b.clipped) bad.push(`${ratio} slide ${b.slide + 1}: clipped at ${b.scale}`);
          else if (Number(b.scale) < 1) bad.push(`${ratio} slide ${b.slide + 1}: scaled to ${b.scale}`);
        }
        const ws = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal .slides > section pre code')).map((c) => `${getComputedStyle(c).whiteSpace}/${getComputedStyle(c).overflowWrap}`));
        for (const w of ws) if (w !== 'pre-wrap/anywhere') bad.push(`${ratio}: code is ${w}`);
        expect(errors, `${t.id} ${ratio}`).toEqual([]);
        await ctx.close();
      }
      expect(bad, t.id).toEqual([]);
    }, 240_000);
  }
});
