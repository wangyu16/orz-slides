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
import { stageLayout, type Rect, type StageInsets } from './stage-geometry.js';

interface LiveMessage {
  type: 'orz-slides-live';
  /** Show the card (the reader preference). */
  show: boolean;
  /** The per-slide mode's stage (rebuild step 6 seam): the card fills the pane, the flattened flow hides. */
  stage: boolean;
  /** The caret's slide: absent when only `show` / `stage` changed. */
  slide?: { key: string; html: string; theme: string; scheme: 'light' | 'dark'; width: number; height: number; index: number; total: number };
  /**
   * The stage's place (rebuild step 6): the insets the trusted page keeps for its own chrome — the
   * stage is {@link stageLayout} of them, computed the same way on both sides — and a template's
   * variant thumbnails (the slide's HTML with each `v=`), drawn under it.
   */
  layout?: { insets: StageInsets; variants?: Array<{ v: number; html: string }> };
}

/**
 * A drag preview from the trusted page (data: styles for the slide shown, never text): a split's
 * tracks (`index`: the split's place in document order) or a float's box (% of the slide). `reset`
 * puts back what the slide had.
 */
interface PreviewMessage {
  type: 'orz-slides-preview';
  key: string;
  splits?: Array<{ index: number; dir: 'row' | 'col'; css: string }>;
  floats?: Array<{ index: number; left: number; top: number; w: number; h: number }>;
  reset?: boolean;
}

interface BoxReport { kind: string; name: string; scale: number; clipped: boolean; x: number; y: number; w: number; h: number }

/** The parts of the slide the per-slide overlay places itself over (logical px, relative to the slide). */
interface PartsReport {
  /** Every layout box, empty ones too, in document order. */
  regions: Array<Rect & { name: string; empty: boolean }>;
  /** Every split (document order = the tree's pre-order) and its children's boxes. */
  splits: Array<Rect & { dir: 'row' | 'col'; kids: Rect[] }>;
  title: Rect | null;
  content: Rect | null;
  template: Rect | null;
  footer: Rect | null;
  floats: Rect[];
}

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
  let insets: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  let variants: Array<{ v: number; html: string }> = [];
  const thumbs = D.createElement('div');
  thumbs.className = 'orz-live-variants';
  thumbs.setAttribute('aria-hidden', 'true');
  D.body.appendChild(thumbs);
  /** The styles a drag preview changed, to put back. */
  const previewed = new Map<HTMLElement, string | null>();
  let gen = 0;
  let refits = 0;
  let queued = 0;
  let reportTimer = 0;
  let scrolls = false;
  const grid = gridPrepare(W);

  const scale = (): void => {
    if (!shown) return;
    if (stage) {
      // the stage: where the trusted page computes it too (stage-geometry.ts)
      const L = stageLayout(W.innerWidth, W.innerHeight, insets, shown.width, shown.height, variants.length);
      card.style.left = `${L.port.x}px`;
      card.style.top = `${L.port.y}px`;
      card.style.width = `${L.port.w}px`;
      port.style.height = `${L.port.h}px`;
      deck.style.transform = `scale(${L.port.scale})`;
      const kids = Array.from(thumbs.children) as HTMLElement[];
      L.variants.forEach((r, i) => {
        const k = kids[i];
        if (!k) return;
        Object.assign(k.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        const dk = k.firstElementChild as HTMLElement | null;
        if (dk) dk.style.transform = `scale(${r.w / shown!.width})`;
      });
      return;
    }
    card.style.left = card.style.top = card.style.width = '';
    const w = port.clientWidth;
    if (!(w > 0)) return;
    const s = w / shown.width;
    port.style.height = `${Math.round(shown.height * s)}px`;
    deck.style.transform = `scale(${s})`;
  };

  /** The template's variant thumbnails (stage only): each its slide at the logical size, scaled down, fitted once. */
  function drawVariants(): void {
    thumbs.replaceChildren();
    if (!stage || !shown || variants.length === 0) return;
    for (const v of variants) {
      const box = D.createElement('div');
      box.className = 'orz-live-variant';
      box.innerHTML = `<div class="reveal orz-deck orz-print"><div class="orz-page">${v.html}</div></div>`;
      const dk = box.firstElementChild as HTMLElement;
      dk.setAttribute('data-orz-theme', String(shown.theme));
      dk.style.width = `${shown.width}px`;
      dk.style.setProperty('--sl-w', `${shown.width}px`);
      dk.style.setProperty('--sl-h', `${shown.height}px`);
      thumbs.appendChild(box);
      decorate(box, { steps: false });
    }
    scale();
    requestAnimationFrame(() => {
      for (const sec of Array.from(thumbs.querySelectorAll<HTMLElement>('.orz-page > section'))) { try { fitSlide(sec, undefined, grid); } catch { /* a thumbnail */ } }
    });
  }

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
    const rel = (el: Element | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round((r.left - sr.left) / k), y: Math.round((r.top - sr.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k) };
    };
    const parts: PartsReport = {
      regions: Array.from(s.querySelectorAll<HTMLElement>('.orz-content .orz-region[data-region]')).slice(0, 64).map((el) => ({ name: el.getAttribute('data-region') ?? '', empty: !(el.textContent ?? '').trim() && !el.querySelector('img,svg,canvas,table,video,iframe,hr'), ...rel(el)! })),
      splits: Array.from(s.querySelectorAll<HTMLElement>('.orz-content .orz-split')).slice(0, 64).map((el) => ({ dir: /grid-template-columns/.test(el.getAttribute('style') ?? '') ? 'col' as const : 'row' as const, kids: Array.from(el.children).map((c) => rel(c)!), ...rel(el)! })),
      title: rel(s.querySelector('.orz-title')),
      content: rel(s.querySelector('.orz-content')),
      template: rel(s.querySelector('.orz-template')),
      footer: rel(s.querySelector('.orz-footer')),
      floats: Array.from(s.querySelectorAll<HTMLElement>(':scope > .orz-float')).map((el) => rel(el)!),
    };
    const footerCut = s.querySelector('.orz-footer[data-clipped]') !== null;
    const clipped = boxes.some((b) => b.clipped);
    const min = boxes.reduce((m, b) => Math.min(m, b.scale), 1);
    badge.setAttribute('data-state', clipped ? 'cut' : footerCut ? 'warn' : min < 1 ? 'shrunk' : 'ok');
    badge.textContent = clipped ? 'cut on paper' : footerCut ? 'footer cut' : min < 1 ? `shrunk to ${Math.round(min * 100)}%` : 'fits';
    if (scrolls && !clipped) badge.textContent += ' · scrolls on screen';
    badge.title = clipped ? 'Content is cut at the smallest size (60%): shorten the slide or split it' : footerCut ? 'The footer is cut to one line' : '';
    post({ type: 'orz-slides-fit', key: shown.key, index: shown.index, boxes, footerCut, scrolls, parts });
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
    const lay = m.layout;
    let variantsChanged = false;
    if (stage && lay && typeof lay === 'object') {
      const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4000, v)) : 0);
      insets = { top: n(lay.insets?.top), right: n(lay.insets?.right), bottom: n(lay.insets?.bottom), left: n(lay.insets?.left) };
      const vs = Array.isArray(lay.variants) ? lay.variants.filter((x) => x && typeof x.html === 'string').slice(0, 8) : [];
      variantsChanged = vs.length !== variants.length || vs.some((x, i) => x.html !== variants[i]?.html);
      variants = vs;
    } else if (!stage && variants.length > 0) { variants = []; variantsChanged = true; }
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
      previewed.clear();
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
    if (variantsChanged || (sl && variants.length > 0)) drawVariants();
    else scale();
  }

  /** A drag preview (data: styles only), or putting the slide back. */
  function previewApply(m: PreviewMessage): void {
    const s = section();
    if (!s || !shown || m.key !== shown.key) return;
    const keep = (el: HTMLElement): void => { if (!previewed.has(el)) previewed.set(el, el.getAttribute('style')); };
    if (m.reset) {
      for (const [el, st] of previewed) { if (st === null) el.removeAttribute('style'); else el.setAttribute('style', st); }
      previewed.clear();
      return;
    }
    const splits = Array.from(s.querySelectorAll<HTMLElement>('.orz-content .orz-split'));
    for (const p of Array.isArray(m.splits) ? m.splits.slice(0, 64) : []) {
      const el = splits[Number(p.index) | 0];
      if (!el || typeof p.css !== 'string' || !/^[\d.\sa-z%()/-]*$/i.test(p.css)) continue;
      keep(el);
      el.style.setProperty(p.dir === 'row' ? 'grid-template-rows' : 'grid-template-columns', p.css);
    }
    const floats = Array.from(s.querySelectorAll<HTMLElement>(':scope > .orz-float'));
    for (const f of Array.isArray(m.floats) ? m.floats.slice(0, 64) : []) {
      const el = floats[Number(f.index) | 0];
      const ok = [f.left, f.top, f.w, f.h].every((v) => typeof v === 'number' && Number.isFinite(v));
      if (!el || !ok) continue;
      keep(el);
      Object.assign(el.style, { left: `${f.left}%`, top: `${f.top}%`, width: `${f.w}%`, height: `${f.h}%`, right: 'auto', bottom: 'auto' });
    }
  }
  W.addEventListener('resize', () => { if (stage) scale(); });

  const before = W.__orzPreviewMessage;
  W.__orzPreviewMessage = (m: unknown): void => {
    const d = m as Partial<LiveMessage> | null;
    if (d && typeof d === 'object' && d.type === 'orz-slides-live') { apply(d as LiveMessage); return; }
    if (d && typeof d === 'object' && (d as { type?: unknown }).type === 'orz-slides-preview') { previewApply(d as unknown as PreviewMessage); return; }
    if (typeof before === 'function') before(m);
  };
  post({ type: 'orz-slides-live-ready' });
})();

