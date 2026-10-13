/**
 * The carrier's print document (REBUILD §3c Q8): one slide per page at the
 * slide's logical size (16:9 → 1280 × 720 px pages, 4:3 → 960 × 720),
 * every fragment shown, each slide fitted as on screen; or, "with notes",
 * each page the slide over its speaker notes (pages 1280 × 1240 / 960 ×
 * 1240). It replaces reveal.js's `?print-pdf` route and is printed with the
 * kit's `printDocument` (a sandboxed frame; the page itself never prints).
 *
 * Built in the page from the text: the slides are rendered again into an
 * out-of-sight stage that carries the page's engine styles (so the theme,
 * the fonts and fit measure exactly as on screen), enhanced statically
 * (`enhanceDocument(stage, { static: true })`: charts and molecules become
 * images, diagrams and formulas are drawn), every slide is fitted, slide
 * backgrounds are set on the slides (reveal draws them elsewhere), and the
 * stage's HTML is written into a self-contained document with the engine's
 * structure and theme stylesheets inline (KaTeX's and highlight.js's from
 * their pinned URLs). The document holds no script. On paper nothing
 * scrolls: a `fit=scroll` slide is fitted; long speaker notes are set
 * smaller (to the floor) and then marked, visibly (closed-loop round A).
 * The same static pipeline gives the speaker view its copies
 * ({@link buildStaticDeck}).
 */
import { enhanceDocument, PREVIEW_CDN } from 'orz-markdown/preview-frame';
import { decorate } from './decorate.js';
import { fitBox, fitSlide } from './fit.js';
import { gridPrepare } from './grid.js';
import { renderDeckText, type DeckRenderContext, type RenderedDeck } from './render.js';
import { DECK_CSS, themeStylesheet } from './styles.js';

/** The height of a "with notes" page: the slide (720) and 520 px of notes. */
export const NOTES_PAGE_HEIGHT = 1240;

export interface PrintOptions extends DeckRenderContext {
  /** Each page: the slide over its speaker notes. */
  notes?: boolean;
  /** The document's language and title. */
  lang?: string;
  title?: string;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Move reveal's slide backgrounds (data attributes) onto the slides themselves. */
function inlineBackgrounds(root: ParentNode): void {
  for (const s of Array.from(root.querySelectorAll<HTMLElement>('section[data-background-color], section[data-background-image]'))) {
    const color = s.getAttribute('data-background-color');
    const image = s.getAttribute('data-background-image');
    if (color) s.style.background = color;
    if (image) {
      s.style.backgroundImage = `url(${JSON.stringify(image)})`;
      s.style.backgroundSize = 'cover';
      s.style.backgroundPosition = 'center';
    }
  }
}

/** Resolves when every image under `root` has loaded or failed (at most `ms`). */
export function imagesLoaded(root: ParentNode, ms: number): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const done = (): void => { if (--left <= 0) resolve(); };
    for (const i of pending) { i.addEventListener('load', done, { once: true }); i.addEventListener('error', done, { once: true }); }
    setTimeout(resolve, ms);
  });
}

/** A deck rendered statically in the page: every slide laid out, enhanced (canvases frozen to images) and fitted. */
export interface StaticDeck {
  /** The out-of-sight stage (`.reveal.orz-deck.orz-print`): `.orz-page > section.orz-slide` (+ notes). */
  stage: HTMLElement;
  rendered: RenderedDeck;
  /** The page height (the slide's, or slide + notes). */
  pageHeight: number;
  /** Take the stage out of the page. */
  remove(): void;
}

/**
 * Render a text statically in `doc` (the page; its engine styles must be
 * installed): the print document's pipeline, shared by the speaker view
 * (closed-loop round A, ENG-5/6: static copies with frozen canvases, every
 * one fitted). On paper and in a static copy nothing scrolls: a `fit=scroll`
 * slide is fitted (scaled, else marked clipped; ENG-3). With `notes`, each
 * page's notes are fitted too (ENG-4: set smaller to the floor, then
 * marked).
 */
export async function buildStaticDeck(doc: Document, text: string, o: PrintOptions = {}): Promise<StaticDeck> {
  const r = await renderDeckText(text, o);
  const pageH = o.notes ? NOTES_PAGE_HEIGHT : r.height;
  const stage = doc.createElement('div');
  stage.className = `reveal orz-deck orz-print${o.notes ? ' orz-with-notes' : ''}`;
  stage.setAttribute('data-orz-theme', r.theme.id);
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = `position:fixed;left:-200000px;top:0;visibility:hidden;pointer-events:none;--sl-w:${r.width}px;--sl-h:${r.height}px;--sl-page-h:${pageH}px;width:${r.width}px;`;
  // one page per slide: the section, then (with notes) its notes
  const tmp = doc.createElement('div');
  tmp.innerHTML = r.html;
  for (const section of Array.from(tmp.children)) {
    const page = doc.createElement('div');
    page.className = 'orz-page';
    page.appendChild(section);
    // nothing scrolls on paper: a scroll slide is fitted like any other (ENG-3)
    if (section.getAttribute('data-fit') === 'scroll') section.setAttribute('data-fit', 'fit');
    if (o.notes) {
      const notes = section.querySelector(':scope > aside.notes');
      const box = doc.createElement('div');
      box.className = 'orz-print-notes';
      box.innerHTML = `<p class="orz-print-notes-head">Notes · slide ${esc(section.getAttribute('data-n') ?? '')}</p><div class="notes-body markdown-body">${notes ? notes.innerHTML : ''}</div>`;
      page.appendChild(box);
    }
    stage.appendChild(page);
  }
  decorate(stage, { steps: false });
  inlineBackgrounds(stage);
  doc.body.appendChild(stage);
  try {
    await enhanceDocument(stage, { scheme: r.theme.scheme, static: true }).catch(() => undefined);
    try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* fonts as they are */ }
    await imagesLoaded(stage, 10_000);
    const grid = gridPrepare(doc.defaultView ?? window);
    for (const s of Array.from(stage.querySelectorAll<HTMLElement>('.orz-page > section.orz-slide'))) fitSlide(s, undefined, grid);
    for (const n of Array.from(stage.querySelectorAll<HTMLElement>('.orz-page > .orz-print-notes'))) fitBox(n);
  } catch (e) {
    stage.remove();
    throw e;
  }
  return { stage, rendered: r, pageHeight: pageH, remove: () => stage.remove() };
}

/** Build the print document of a text in `doc` (the page; its engine styles must be installed). */
export async function buildPrintDocument(doc: Document, text: string, o: PrintOptions = {}): Promise<{ html: string; pages: number; width: number; height: number }> {
  const d = await buildStaticDeck(doc, text, o);
  const r = d.rendered;
  const pageH = d.pageHeight;
  try {
    const theme = themeStylesheet(r.theme.id);
    const hljs = r.theme.scheme === 'dark' ? PREVIEW_CDN.hljsDarkCss : PREVIEW_CDN.hljsLightCss;
    const html = [
      '<!doctype html>',
      `<html lang="${esc(o.lang ?? 'en')}" class="orz-slides-print">`,
      '<head>',
      '<meta charset="utf-8">',
      `<title>${esc(o.title ?? 'Slides')}</title>`,
      `<meta name="color-scheme" content="${r.theme.scheme}">`,
      `<link rel="stylesheet" href="${esc(PREVIEW_CDN.katexCss)}">`,
      `<link rel="stylesheet" href="${esc(hljs)}">`,
      `<style>${DECK_CSS}</style>`,
      `<style>${theme.css}</style>`,
      `<style>@page { size: ${r.width}px ${pageH}px; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style>`,
      '</head>',
      '<body>',
      `<div class="${d.stage.className}" data-orz-theme="${esc(r.theme.id)}" style="--sl-w:${r.width}px;--sl-h:${r.height}px;--sl-page-h:${pageH}px;">${d.stage.innerHTML}</div>`,
      '</body>',
      '</html>',
      '',
    ].join('\n');
    return { html, pages: r.deck.slides.length, width: r.width, height: pageH };
  } finally {
    d.remove();
  }
}
