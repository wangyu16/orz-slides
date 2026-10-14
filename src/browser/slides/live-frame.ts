/**
 * KIND-SPECIFIC (slides): the live view's runtime INSIDE the editor
 * preview frame (built by build/bundle.ts into a script-safe ASCII IIFE,
 * `__ORZ_SLIDES_LIVE__`, and written into the frame document by
 * src/browser/slides/frame.ts after the kit's bridge and libraries).
 *
 * The live view is the caret's slide drawn by the engine's static pipeline
 * (the print stage of src/present/print.ts: `.reveal.orz-deck.orz-print >
 * .orz-page > section`), at the logical size, scaled to its card, every
 * fragment shown, fitted (src/present/fit.ts) — so its badge says what
 * paper will show: a `fit=scroll` slide is fitted as on paper, and what is
 * cut is cut on paper.
 *
 * It speaks the kit's preview channel only as DATA (FC-19 §8.4): the shell
 * posts `orz-slides-live` (the slide's HTML, rendered by the trusted page
 * from the text — the frame never sees anything else of the editor) through
 * the bridge's page hook `window.__orzPreviewMessage`; the frame reports
 * `orz-slides-live-ready` and `orz-slides-fit` (each box's scale, clipping
 * and rectangle in logical px, the footer's cut) with
 * `window.__orzPreview.post` — window messages, which the shell treats as
 * data (a document script can forge them: at worst a wrong badge or lint,
 * never an edit, a save or a key). The step-6 stage reads the same report.
 *
 * Fit settles here as in the engine, in small: a refit one frame after
 * anything that changes the slide's content size (a drawing, an image, a
 * font, a stylesheet), at most {@link REFITS} times per render; the report
 * goes 150 ms after the last fit.
 */
import { chartAspects, decorate } from '../../present/decorate.js';
import { fitSlide } from '../../present/fit.js';
import { gridPrepare } from '../../present/grid.js';

interface LiveMessage {
  type: 'orz-slides-live';
  /** Show the card (the reader preference). */
  show: boolean;
  /** The per-slide mode's stage (rebuild step 6 seam): the card fills the pane, the flattened flow hides. */
  stage: boolean;
  /** The caret's slide: absent when only `show` / `stage` changed. */
  slide?: { key: string; html: string; theme: string; scheme: 'light' | 'dark'; width: number; height: number; index: number; total: number };
}

interface BoxReport { kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }

/** Refits per render (a drawing that never stops resizing is not refitted for ever). */
const REFITS = 24;

(function live(): void {
  const W = window as unknown as Window & {
    __orzPreview?: { post(m: unknown): void };
    __orzPreviewMessage?: (m: unknown) => void;
    __orzEnhance?: () => void;
    __orzRedraw?: (el: Element) => void;
    __orzSmilesTheme?: string;
  };
  const D = document;
  const post = (m: unknown): void => { try { W.__orzPreview?.post(m); } catch { /* the bridge's */ } };

  const card = D.getElementById('orz-live') ?? D.body.appendChild(Object.assign(D.createElement('aside'), { id: 'orz-live' }));
  card.className = 'orz-live';
  card.hidden = true;
  card.setAttribute('aria-label', 'The slide at the cursor');
  card.innerHTML = '<div class="orz-live-head"><span class="orz-live-n"></span><span class="orz-live-badge" data-state="wait"></span></div><div class="orz-live-port"><div class="reveal orz-deck orz-print orz-live-deck"><div class="orz-page"></div></div></div>';
  const head = card.querySelector('.orz-live-n') as HTMLElement;
  const badge = card.querySelector('.orz-live-badge') as HTMLElement;
  const port = card.querySelector('.orz-live-port') as HTMLElement;
  const deck = card.querySelector('.orz-live-deck') as HTMLElement;
  const page = card.querySelector('.orz-page') as HTMLElement;
  const current = D.createElement('style');
  current.id = 'orz-flat-current';
  const nonce = (D.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce;
  if (nonce) current.setAttribute('nonce', nonce);
  D.head.appendChild(current);

  let shown: LiveMessage['slide'] | null = null;
  let show = false;
  let stage = false;
  let gen = 0;
  let refits = 0;
  let queued = 0;
  let reportTimer = 0;
  let scrolls = false;
  const grid = gridPrepare(W);

  const scale = (): void => {
    if (!shown) return;
    const w = port.clientWidth;
    if (!(w > 0)) return;
    const s = w / shown.width;
    port.style.height = `${Math.round(shown.height * s)}px`;
    deck.style.transform = `scale(${s})`;
  };

  const section = (): HTMLElement | null => page.querySelector(':scope > section');

  function report(): void {
    reportTimer = 0;
    const s = section();
    if (!s || !shown) return;
    const sr = s.getBoundingClientRect();
    const k = s.offsetWidth > 0 ? sr.width / s.offsetWidth : 1;
    const boxes: BoxReport[] = Array.from(s.querySelectorAll<HTMLElement>('.orz-box')).map((b) => {
      const r = b.getBoundingClientRect();
      const kind = b.classList.contains('orz-title') ? 'title' : b.classList.contains('orz-float') ? 'float' : b.classList.contains('orz-template') ? 'template' : 'region';
      return {
        kind,
        name: b.getAttribute('data-region') ?? kind,
        scale: Number(b.getAttribute('data-scale') ?? '1') || 1,
        clipped: b.hasAttribute('data-clipped'),
        x: Math.round((r.left - sr.left) / k), y: Math.round((r.top - sr.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k),
      };
    });
    const footerCut = s.querySelector('.orz-footer[data-clipped]') !== null;
    const clipped = boxes.some((b) => b.clipped);
    const min = boxes.reduce((m, b) => Math.min(m, b.scale), 1);
    badge.setAttribute('data-state', clipped ? 'cut' : footerCut ? 'warn' : min < 1 ? 'shrunk' : 'ok');
    badge.textContent = clipped ? 'cut on paper' : footerCut ? 'footer cut' : min < 1 ? `shrunk to ${Math.round(min * 100)}%` : 'fits';
    if (scrolls && !clipped) badge.textContent += ' · scrolls on screen';
    badge.title = clipped ? 'Content is cut at the smallest size (60%): shorten the slide or split it' : footerCut ? 'The footer is cut to one line' : '';
    post({ type: 'orz-slides-fit', key: shown.key, index: shown.index, boxes, footerCut, scrolls });
  }

  function fitNow(): void {
    queued = 0;
    const s = section();
    if (!s || card.hidden) return;
    chartAspects(s);
    fitSlide(s, undefined, grid);
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(report, 150) as unknown as number;
  }
  function fitSoon(): void {
    if (queued || refits >= REFITS) return;
    refits++;
    queued = requestAnimationFrame(fitNow);
  }

  // what changes the slide's content size after a fit: a drawing (an SVG, a chart frame), an image, a font, a stylesheet
  const mo = new MutationObserver((rs) => { if (rs.some((r) => r.type === 'childList' && (r.addedNodes.length > 0 || r.removedNodes.length > 0))) fitSoon(); });
  mo.observe(page, { childList: true, subtree: true });
  page.addEventListener('load', fitSoon, true);
  page.addEventListener('error', fitSoon, true);
  page.addEventListener('toggle', fitSoon, true);
  D.addEventListener('load', (e) => { const t = e.target as Element | null; if (t && (t.tagName === 'LINK' || t.tagName === 'STYLE')) fitSoon(); }, true);
  try { D.fonts.addEventListener('loadingdone', fitSoon); } catch { /* no font events */ }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { scale(); }).observe(port);

  function apply(m: LiveMessage): void {
    show = m.show === true;
    stage = m.stage === true;
    const was = card.hidden;
    D.body.classList.toggle('orz-live-on', show && !stage);
    D.body.classList.toggle('orz-stage', stage);
    card.hidden = !(show || stage);
    const sl = m.slide;
    if (sl && typeof sl.html === 'string' && (!shown || sl.key !== shown.key)) {
      const mine = ++gen;
      shown = sl;
      refits = 0;
      deck.setAttribute('data-orz-theme', String(sl.theme));
      deck.style.setProperty('--sl-w', `${sl.width}px`);
      deck.style.setProperty('--sl-h', `${sl.height}px`);
      deck.style.width = `${sl.width}px`;
      W.__orzSmilesTheme = sl.scheme === 'dark' ? 'dark' : 'light';
      page.innerHTML = sl.html;
      const s = section();
      // as on paper: nothing scrolls (a fit=scroll slide is fitted), every fragment shows
      scrolls = s?.getAttribute('data-fit') === 'scroll';
      if (s && scrolls) s.setAttribute('data-fit', 'fit');
      for (const img of Array.from(page.querySelectorAll('img'))) img.setAttribute('loading', 'eager');
      decorate(page, { steps: false });
      for (const el of Array.from(page.querySelectorAll<HTMLElement>('section[data-background-color], section[data-background-gradient], section[data-background-image]'))) {
        const c = el.getAttribute('data-background-color');
        const g = el.getAttribute('data-background-gradient');
        const im = el.getAttribute('data-background-image');
        if (c) el.style.background = c;
        if (g) el.style.background = g;
        if (im) { el.style.backgroundImage = `url(${JSON.stringify(im)})`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; }
      }
      head.textContent = `Slide ${sl.index + 1} of ${sl.total}`;
      badge.setAttribute('data-state', 'wait');
      badge.textContent = '';
      const i = Number(sl.index) | 0;
      current.textContent = `.orz-flat-slide[data-slide="${i}"]{color:var(--orz-flat-accent);border-top-color:var(--orz-flat-accent)}.orz-flat-slide[data-slide="${i}"] .orz-flat-n{background:var(--orz-flat-accent);color:var(--orz-flat-on-accent)}`;
      scale();
      try { W.__orzEnhance?.(); } catch { /* the libraries' */ }
      try { if (s) W.__orzRedraw?.(s); } catch { /* the libraries' */ }
      if (mine === gen) fitSoon();
    } else if (sl && shown && sl.index !== shown.index) {
      shown = { ...shown, index: sl.index, total: sl.total };
      head.textContent = `Slide ${sl.index + 1} of ${sl.total}`;
    }
    // shown again (or as the stage, another width): scaled and fitted again
    if (!card.hidden && (was || !sl)) { scale(); if (was) { refits = 0; fitSoon(); } }
  }

  const before = W.__orzPreviewMessage;
  W.__orzPreviewMessage = (m: unknown): void => {
    const d = m as Partial<LiveMessage> | null;
    if (d && typeof d === 'object' && d.type === 'orz-slides-live') { apply(d as LiveMessage); return; }
    if (typeof before === 'function') before(m);
  };
  post({ type: 'orz-slides-live-ready' });
})();

