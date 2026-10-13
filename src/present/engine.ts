/**
 * The slides engine (REBUILD §3c step 3): the ONE module that owns
 * reveal.js 5 (Q1). Everything reveal-specific stays here; the read view
 * (src/browser/slides/read-view.ts) and the kind's actions talk to this API.
 *
 * reveal.js is configured as a renderer only: `keyboard: false` (keys arrive
 * through the kit's `onKey`, {@link DeckEngine.onKey}), no controls,
 * progress bar or slide number (the theme draws its own chrome inside the
 * slide), no hash or history, no postMessage API, no scroll view, and the
 * legacy `?print-pdf` route removed from the URL before it initialises
 * (print is the carrier's print document, src/present/print.ts); options
 * given in the URL's query are overridden after it is ready. Slides render
 * at the logical size (Q2: height 720; 16:9 = 1280 × 720, 4:3 = 960 × 720)
 * and reveal scales them to the window.
 *
 * Keys ({@link DeckEngine.onKey}): → ↓ PageDown Space n — next (fragment,
 * then slide); ← ↑ PageUp Shift+Space p Backspace — previous; Home / End —
 * first / last; o or Escape — overview (Escape also leaves it, and leaves
 * Present when the browser has no full screen); s — speaker view; t — the
 * timer; f — Present.
 *
 * Fit (src/present/fit.ts) runs on the visible slide only, and SETTLES
 * (closed-loop round A, ENG-1/ENG-2; claims F.5, F.6): a slide that becomes
 * current is first given to the kit's `redrawEnhancement` (its charts,
 * molecules and diagrams drawn at its size) and then fitted; ONE
 * ResizeObserver over the current slide's box contents and a
 * MutationObserver for what is drawn into them later (a chart's frame, a
 * Mermaid SVG, an image) refit it whenever its content changes size — the
 * fit's own changes are recognised and ignored — as do fonts, stylesheets
 * (a theme's `@import`ed webfonts included) and images that finish loading.
 * The slide is SETTLED — `data-fit-settled` on its section, the `orz-fitted`
 * event on the deck root, `settled()` resolves — once the fonts, the
 * content libraries, its images and stylesheets are in, its diagrams drawn,
 * and a frame passed with nothing to refit (at most 10 s after it showed:
 * then `data-fit-settled="timeout"`).
 */
import Reveal, { type RevealApi } from 'reveal.js';
import { disposeEnhancement, enhanceDocument, redrawEnhancement } from 'orz-markdown/preview-frame';
import { printDocument } from 'orz-markdown/carrier/editor';
import { decorate } from './decorate.js';
import { fitSlide, type BoxFit } from './fit.js';
import { gridPrepare } from './grid.js';
import { buildPrintDocument, buildStaticDeck, type PrintOptions } from './print.js';
import { renderDeckText, type DeckRenderContext, type RenderedDeck } from './render.js';
import { PresenterClock, SpeakerView, TimerOverlay } from './speaker.js';
import { installStyles } from './styles.js';

/** reveal.js's options the engine always sets (and sets again after the URL's query had its say). */
const FORCED: Readonly<Record<string, unknown>> = Object.freeze({
  keyboard: false,
  controls: false,
  progress: false,
  slideNumber: false,
  hash: false,
  history: false,
  respondToHashChanges: false,
  fragmentInURL: false,
  postMessage: false,
  postMessageEvents: false,
  help: false,
  pause: false,
  embedded: true,
  center: false,
  overview: true,
  touch: true,
  previewLinks: false,
  jumpToSlide: false,
  scrollActivationWidth: null,
  view: null,
  showNotes: false,
  autoSlide: 0,
  mouseWheel: false,
});

export interface DeckEngine {
  /** The `.reveal` element. */
  readonly root: HTMLElement;
  /** Render a text (presentation follows its header); resolves when the slides show (fit on the current one). */
  render(text: string, ctx?: DeckRenderContext): Promise<void>;
  /** The last render's facts (null before the first). */
  rendered(): RenderedDeck | null;
  /** Apply the header's theme and ratio without re-rendering the slides; returns the colour scheme. */
  present(theme: { id: string; scheme: 'light' | 'dark' }, size: { width: number; height: number }): void;
  index(): number;
  total(): number;
  slides(): HTMLElement[];
  /** Go to a slide (0-based), at its start (no fragment shown). */
  go(index: number): void;
  next(): void;
  prev(): void;
  isOverview(): boolean;
  toggleOverview(on?: boolean): void;
  /** A key of the read view (the kit's `onKey`): true when the engine used it. */
  onKey(e: KeyboardEvent): boolean;
  openSpeaker(): Window | null;
  speakerWindow(): Window | null;
  toggleTimer(): void;
  isPresenting(): boolean;
  /** Present: the deck alone, full screen; `onChange(presenting)` hides / shows the page's chrome. */
  enterPresent(): Promise<void>;
  exitPresent(): void;
  /** Fit the current slide now (its content drawn at its size first); `fresh`: no box starts from its last scale. */
  fitCurrent(o?: { fresh?: boolean }): BoxFit[];
  /** Resolves when the current slide's fit has settled (see the module comment; claim F.6). */
  settled(): Promise<void>;
  /** Show or hide the deck (edit mode hides it); relayout when shown. */
  setVisible(visible: boolean): void;
  /** The print document of the last rendered text. */
  printHtml(o?: { notes?: boolean }): Promise<{ html: string; pages: number; width: number; height: number }>;
  /** Print it (the kit's `printDocument`). */
  print(o?: { notes?: boolean }): Promise<boolean>;
  destroy(): void;
}

export interface EngineOptions {
  /** Called when Present starts or ends (the read view hides the kit's chrome). */
  onPresent?(presenting: boolean): void;
  /** A message for the reader (a blocked speaker window). */
  notify?(message: string): void;
  /** The document's language (print document). */
  lang?(): string;
  /** The document's title (print document, speaker view). */
  title?(): string;
}

/** Create the engine in `host` (the read view's element): a `.reveal > .slides` deck. */
export function createDeckEngine(host: HTMLElement, options: EngineOptions = {}): DeckEngine {
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  const root = doc.createElement('div');
  root.className = 'reveal orz-deck';
  const slidesEl = doc.createElement('div');
  slidesEl.className = 'slides';
  root.appendChild(slidesEl);
  host.appendChild(root);

  let reveal: RevealApi | null = null;
  let ready: Promise<unknown> | null = null;
  let last: RenderedDeck | null = null;
  let lastText = '';
  let lastCtx: DeckRenderContext = {};
  let generation = 0;
  let destroyed = false;
  let presenting = false;
  let scheme: 'light' | 'dark' = 'light';
  let fitQueued = 0;

  const clock = new PresenterClock();
  const timer = new TimerOverlay(clock, doc);

  const sections = (): HTMLElement[] => Array.from(slidesEl.children).filter((e): e is HTMLElement => e.tagName === 'SECTION');
  const current = (): HTMLElement | null => (reveal?.isReady() ? reveal.getCurrentSlide() ?? null : sections()[0] ?? null);
  const index = (): number => (reveal?.isReady() ? reveal.getIndices().h : 0);

  const grid = gridPrepare(win);

  /* ── the fit settles (closed-loop round A) ── */
  const SETTLE_MAX_MS = 10_000;
  let frame = 0;
  let lastFitFrame = -1;
  let dirty = false;
  let shownAt = 0;
  let loop = 0;
  let enhanced = false;
  let watchedSlide: HTMLElement | null = null;
  const sizes = new WeakMap<Element, [number, number]>();
  const failedSheets = new WeakSet<Element>();
  const settleWaiters: Array<() => void> = [];

  /** What a box holds that can change size after a fit: its blocks, pictures, drawings, code, tables, formulas. */
  const WATCH = ':scope .orz-box, :scope .orz-box > .markdown-body > *, :scope .orz-template > *, :scope .orz-box :is(img, canvas, .mermaid, .orz-chart-frame, pre, table, .katex-display)';
  const ro: ResizeObserver | null = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver((entries) => {
    if (destroyed) return;
    for (const e of entries) {
      const t = e.target as HTMLElement;
      const b = e.borderBoxSize?.[0];
      const w = b ? b.inlineSize : t.offsetWidth;
      const h = b ? b.blockSize : t.offsetHeight;
      const was = sizes.get(t);
      // the fit's own result was recorded when it ended: only a change since then refits
      if (!was || Math.abs(was[0] - w) > 1 || Math.abs(was[1] - h) > 1) { dirty = true; fitSoon(); return; }
    }
  }) : null;
  const mo: MutationObserver | null = typeof win.MutationObserver === 'function' ? new win.MutationObserver((records) => {
    if (destroyed) return;
    if (records.some((r) => r.type === 'childList' && (r.addedNodes.length > 0 || r.removedNodes.length > 0))) { dirty = true; fitSoon(); }
  }) : null;

  /** Observe the current slide's box contents, with their sizes as the fit left them. */
  function watch(s: HTMLElement): void {
    if (watchedSlide !== s) {
      ro?.disconnect();
      mo?.disconnect();
      watchedSlide = s;
      mo?.observe(s, { childList: true, subtree: true });
    }
    for (const el of Array.from(s.querySelectorAll<HTMLElement>(WATCH))) {
      sizes.set(el, [el.offsetWidth, el.offsetHeight]);
      ro?.observe(el, { box: 'border-box' });
    }
    // what the fit itself changed in the tree is no news
    mo?.takeRecords();
  }

  /**
   * Fit the current slide now and watch it; `redraw`: its content is drawn
   * at its size first (a slide just shown — its charts, molecules and
   * diagrams waited for it). A refit needs no redraw: what is drawn is sized
   * in CSS (em) and follows the scale at once; the drawings are redrawn
   * sharp once the slide settles.
   */
  const fitNow = (o: { fresh?: boolean; redraw?: boolean } = {}): BoxFit[] => {
    const s = current();
    if (!s || host.hidden) return [];
    if (o.redraw) redrawEnhancement(s);
    const out = fitSlide(s, undefined, grid, o);
    watch(s);
    lastFitFrame = frame;
    dirty = false;
    startSettle();
    return out;
  };
  const fitCurrent = (o: { fresh?: boolean } = {}): BoxFit[] => fitNow(o);

  /** Fit soon (one frame later): a font, stylesheet or image loaded, or the slide's content changed size. */
  const fitSoon = (): void => {
    current()?.removeAttribute('data-fit-settled');
    startSettle();
    if (fitQueued) return;
    fitQueued = win.requestAnimationFrame(() => { fitQueued = 0; if (!destroyed) fitNow(); });
  };

  /** Everything the current slide waits for is in. */
  function quiet(s: HTMLElement): boolean {
    if (fitQueued || dirty || frame - lastFitFrame < 2) return false;
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts && fonts.status !== 'loaded') return false;
    if (!enhanced) return false;
    if (Array.from(s.querySelectorAll('img')).some((i) => !i.complete)) return false;
    for (const l of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
      if (l.media === 'not all' || failedSheets.has(l)) continue;
      if (!l.sheet) return false;
    }
    // a diagram the library is drawing (the library loaded, its SVG not yet in)
    const mm = (win as unknown as { mermaid?: { run?: unknown } }).mermaid;
    if (mm && typeof mm.run === 'function' && s.querySelector('.orz-box .mermaid:not(:has(svg))')) return false;
    return true;
  }

  function startSettle(): void {
    if (loop || destroyed) return;
    loop = win.requestAnimationFrame(tick);
  }
  function tick(): void {
    loop = 0;
    frame++;
    if (destroyed) return;
    const s = current();
    if (!s) { flushSettled(); return; }
    if (host.hidden) return; // resumes when shown (setVisible refits)
    if (!s.hasAttribute('data-fit-settled')) {
      const timeout = performance.now() - shownAt > SETTLE_MAX_MS;
      if (!quiet(s) && !timeout) { startSettle(); return; }
      s.setAttribute('data-fit-settled', timeout && !quiet(s) ? 'timeout' : '');
      // drawings at the final scale (their layout is CSS: no refit follows)
      redrawEnhancement(s);
      root.dispatchEvent(new CustomEvent('orz-fitted', { detail: { index: index(), timeout: s.getAttribute('data-fit-settled') === 'timeout' } }));
    }
    flushSettled();
  }
  function flushSettled(): void {
    const s = current();
    if (s && (!s.hasAttribute('data-fit-settled') || fitQueued || dirty)) { startSettle(); return; }
    for (const w of settleWaiters.splice(0)) w();
  }
  /** Resolves when the current slide is settled, looked at two frames on (an action's resizes have been seen). */
  function settled(): Promise<void> {
    return new Promise((resolve) => {
      let n = 0;
      const step = (): void => {
        if (destroyed) { resolve(); return; }
        if (++n < 3) { win.requestAnimationFrame(step); return; }
        settleWaiters.push(resolve);
        startSettle();
      };
      win.requestAnimationFrame(step);
    });
  }

  /* the speaker view's slides: static copies from the print pipeline (ENG-5/6), built while it is open */
  let copies: { generation: number; html: string[] } | null = null;
  let building = false;
  let rebuild = false;
  const buildCopies = async (): Promise<void> => {
    if (building) { rebuild = true; return; }
    if (!speaker.isOpen() || lastText === '') return;
    building = true;
    const gen = generation;
    try {
      const d = await buildStaticDeck(doc, lastText, { ...lastCtx });
      try {
        const html = Array.from(d.stage.querySelectorAll<HTMLElement>('.orz-page > section.orz-slide')).map((x) => x.outerHTML);
        if (gen === generation && !destroyed) { copies = { generation: gen, html }; speaker.sync(); }
      } finally { d.remove(); }
    } catch { /* the live copies stand in */ } finally {
      building = false;
      if (rebuild && !destroyed) { rebuild = false; void buildCopies(); }
    }
  };

  const speaker = new SpeakerView({
    slides: sections,
    index,
    size: () => ({ width: last?.width ?? 1280, height: last?.height ?? 720 }),
    styles: () => Array.from(doc.querySelectorAll('style#orz-reveal-css, style#orz-deck-css, style#orz-slide-theme, link[rel="stylesheet"]')).filter((e) => e.getAttribute('media') !== 'not all'),
    key: (e) => { onKey(e); },
    title: () => options.title?.() ?? doc.title,
    copy: (i) => (copies && copies.generation === generation ? copies.html[i] ?? null : null),
  }, clock, win);

  const shown = (): void => {
    const s = current();
    if (!s) return;
    shownAt = performance.now();
    s.removeAttribute('data-fit-settled');
    fitNow({ redraw: true });
    speaker.sync();
  };

  // images, stylesheets (KaTeX's from the CDN, and a theme <style>'s @import of its webfonts) and fonts that
  // finish loading change what fits; a stylesheet that failed is not waited for
  root.addEventListener('load', (e) => { const t = e.target as Element; if (t && t.tagName === 'IMG' && current()?.contains(t)) fitSoon(); }, true);
  root.addEventListener('error', (e) => { const t = e.target as Element; if (t && t.tagName === 'IMG' && current()?.contains(t)) fitSoon(); }, true);
  const onSheet = (e: Event): void => {
    const t = e.target as Element | null;
    if (!t || (t.tagName !== 'LINK' && t.tagName !== 'STYLE')) return;
    if (e.type === 'error') failedSheets.add(t);
    fitSoon();
  };
  doc.addEventListener('load', onSheet, true);
  doc.addEventListener('error', onSheet, true);
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  const onFonts = (): void => fitSoon();
  fonts?.addEventListener?.('loadingdone', onFonts);

  const onFullscreen = (): void => {
    if (presenting && !doc.fullscreenElement) exitPresent();
  };
  doc.addEventListener('fullscreenchange', onFullscreen);

  async function boot(width: number, height: number, transition: string | undefined): Promise<void> {
    // the legacy print route reads the URL's query: never let it take the deck
    try {
      if (/print-pdf/i.test(win.location.search)) win.history.replaceState(win.history.state, '', win.location.pathname + win.location.hash);
    } catch { /* a sandboxed page: reveal's print view stays possible, harmless */ }
    reveal = new Reveal(root, {
      ...FORCED,
      width, height,
      margin: 0.04, minScale: 0.05, maxScale: 4,
      transition: transition ?? 'slide',
      backgroundTransition: 'fade',
      // reveal's own view distance: a slide out of it is display: none, and the kit (orz-markdown
      // 2.4.0) draws its diagrams and charts when it is laid out again (redrawEnhancement on show)
    });
    ready = reveal.initialize();
    await ready;
    reveal.configure({ ...FORCED });
    reveal.on('slidechanged', () => shown());
    reveal.on('fragmentshown', () => speaker.sync());
    reveal.on('fragmenthidden', () => speaker.sync());
    reveal.on('overviewhidden', () => shown());
  }

  async function render(text: string, ctx: DeckRenderContext = {}): Promise<void> {
    const mine = ++generation;
    const r = await renderDeckText(text, ctx);
    if (mine !== generation || destroyed) return;
    lastText = text;
    lastCtx = ctx;
    const was = index();
    present(r.theme, { width: r.width, height: r.height });
    disposeEnhancement(slidesEl);
    slidesEl.innerHTML = r.html;
    decorate(slidesEl);
    last = r;
    if (!reveal) await boot(r.width, r.height, r.deck.config.transition);
    else {
      reveal.configure({ width: r.width, height: r.height, transition: r.deck.config.transition ?? 'slide' });
      reveal.sync();
      reveal.slide(Math.min(was, Math.max(0, sections().length - 1)), 0);
    }
    if (mine !== generation || destroyed) return;
    reveal!.layout();
    enhanced = false;
    shown();
    if (speaker.isOpen()) void buildCopies();
    const done = (): void => { if (mine === generation && !destroyed) { enhanced = true; fitSoon(); } };
    void enhanceDocument(slidesEl, { scheme }).then(done, done);
    void fonts?.ready?.then(() => { if (mine === generation && !destroyed) fitSoon(); });
  }

  function present(theme: { id: string; scheme: 'light' | 'dark' }, size: { width: number; height: number }): void {
    const changed = root.getAttribute('data-orz-theme') !== theme.id || root.style.getPropertyValue('--sl-w') !== `${size.width}px` || root.style.getPropertyValue('--sl-h') !== `${size.height}px`;
    scheme = theme.scheme;
    installStyles(doc, theme.id);
    doc.documentElement.classList.add('orz-slides-page');
    root.setAttribute('data-orz-theme', theme.id);
    root.style.setProperty('--sl-w', `${size.width}px`);
    root.style.setProperty('--sl-h', `${size.height}px`);
    if (reveal?.isReady()) {
      const cfg = (reveal as unknown as { getConfig?(): { width: number; height: number } }).getConfig?.();
      if (!cfg || cfg.width !== size.width || cfg.height !== size.height) { reveal.configure({ width: size.width, height: size.height }); reveal.layout(); }
      // another theme or size: the current slide fits again (and settles again); the speaker's copies are made again
      if (changed) {
        fitSoon();
        if (speaker.isOpen()) { copies = null; void buildCopies(); }
      }
    }
  }

  function go(i: number): void {
    if (!reveal?.isReady()) return;
    // from the slide's start: no fragment shown yet
    reveal.slide(Math.max(0, Math.min(i, sections().length - 1)), 0, -1);
  }

  function toggleOverview(on?: boolean): void {
    if (!reveal?.isReady()) return;
    reveal.toggleOverview(on);
  }

  async function enterPresent(): Promise<void> {
    if (presenting) return;
    presenting = true;
    host.classList.add('orz-presenting');
    options.onPresent?.(true);
    try {
      if (host.requestFullscreen && doc.fullscreenEnabled) await host.requestFullscreen();
    } catch { /* no full screen here (an iframe without allowfullscreen): presenting in the page, Escape leaves */ }
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    try { host.focus({ preventScroll: true }); } catch { /* not focusable */ }
    win.setTimeout(() => { reveal?.layout(); fitSoon(); }, 60);
  }

  function exitPresent(): void {
    if (!presenting) return;
    presenting = false;
    host.classList.remove('orz-presenting');
    if (doc.fullscreenElement === host) void doc.exitFullscreen().catch(() => undefined);
    options.onPresent?.(false);
    win.setTimeout(() => { reveal?.layout(); }, 60);
  }

  function openSpeaker(): Window | null {
    const w = speaker.open();
    if (!w) options.notify?.('The speaker view could not open: allow pop-ups for this page, then press S again.');
    else if (!copies || copies.generation !== generation) void buildCopies();
    return w;
  }

  function onKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;
    if (!reveal?.isReady()) return false;
    const k = e.key;
    let used = true;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey) || k === 'n' || k === 'N') reveal.next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey) || k === 'p' || k === 'P' || k === 'Backspace') reveal.prev();
    else if (k === 'Home') go(0);
    else if (k === 'End') go(sections().length - 1);
    else if (k === 'Escape') {
      if (reveal.isOverview()) toggleOverview(false);
      else if (presenting) exitPresent();
      else toggleOverview(true);
    } else if (k === 'o' || k === 'O') toggleOverview();
    else if (k === 'Enter' && reveal.isOverview()) toggleOverview(false);
    else if (k === 's' || k === 'S') openSpeaker();
    else if (k === 't' || k === 'T') timer.toggle();
    else if (k === 'f' || k === 'F') { if (presenting) exitPresent(); else void enterPresent(); }
    else used = false;
    if (used) e.preventDefault();
    return used;
  }

  async function printHtml(o: { notes?: boolean } = {}): Promise<{ html: string; pages: number; width: number; height: number }> {
    const p: PrintOptions = { ...lastCtx, notes: o.notes === true, lang: options.lang?.() ?? (doc.documentElement.lang || 'en'), title: options.title?.() ?? doc.title };
    return buildPrintDocument(doc, lastText, p);
  }

  return {
    root,
    render,
    rendered: () => last,
    present,
    index,
    total: () => sections().length,
    slides: sections,
    go,
    next: () => reveal?.next(),
    prev: () => reveal?.prev(),
    isOverview: () => !!reveal?.isReady() && reveal.isOverview(),
    toggleOverview,
    onKey,
    openSpeaker,
    speakerWindow: () => speaker.window(),
    toggleTimer: () => timer.toggle(),
    isPresenting: () => presenting,
    enterPresent,
    exitPresent,
    fitCurrent,
    settled,
    setVisible(visible: boolean): void {
      host.hidden = !visible;
      if (visible) win.setTimeout(() => { reveal?.layout(); fitSoon(); }, 0);
    },
    printHtml,
    async print(o: { notes?: boolean } = {}): Promise<boolean> {
      const { html } = await printHtml(o);
      return printDocument(html, { title: o.notes ? 'Print slides with notes' : 'Print slides' });
    },
    destroy(): void {
      destroyed = true;
      generation++;
      exitPresent();
      speaker.close();
      timer.hide();
      fonts?.removeEventListener?.('loadingdone', onFonts);
      doc.removeEventListener('load', onSheet, true);
      doc.removeEventListener('error', onSheet, true);
      ro?.disconnect();
      mo?.disconnect();
      if (loop) win.cancelAnimationFrame(loop);
      for (const w of settleWaiters.splice(0)) w();
      doc.removeEventListener('fullscreenchange', onFullscreen);
      disposeEnhancement(slidesEl);
      try { reveal?.destroy(); } catch { /* reveal's own */ }
      root.remove();
    },
  };
}
