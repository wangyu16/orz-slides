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
 * Fit (src/present/fit.ts) runs on the visible slide only: after a render,
 * when a slide becomes current, when fonts or images finish loading and
 * when the content libraries have drawn; a newly shown slide is also given
 * to the kit's `redrawEnhancement` (charts and molecules drawn at its size).
 */
import Reveal, { type RevealApi } from 'reveal.js';
import { disposeEnhancement, enhanceDocument, redrawEnhancement } from 'orz-markdown/preview-frame';
import { printDocument } from 'orz-markdown/carrier/editor';
import { decorate } from './decorate.js';
import { fitSlide } from './fit.js';
import { gridPrepare } from './grid.js';
import { buildPrintDocument, type PrintOptions } from './print.js';
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
  /** Fit the current slide now. */
  fitCurrent(): void;
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
  const fitCurrent = (): void => {
    const s = current();
    if (!s || host.hidden) return;
    fitSlide(s, undefined, grid);
  };
  /** Fit soon (one frame later), e.g. after an image or a font loaded. */
  const fitSoon = (): void => {
    if (fitQueued) return;
    fitQueued = win.requestAnimationFrame(() => { fitQueued = 0; if (!destroyed) { fitCurrent(); const s = current(); if (s) redrawEnhancement(s); } });
  };

  const speaker = new SpeakerView({
    slides: sections,
    index,
    size: () => ({ width: last?.width ?? 1280, height: last?.height ?? 720 }),
    styles: () => Array.from(doc.querySelectorAll('style#orz-reveal-css, style#orz-deck-css, style#orz-slide-theme, link[rel="stylesheet"]')).filter((e) => e.getAttribute('media') !== 'not all'),
    key: (e) => { onKey(e); },
    title: () => options.title?.() ?? doc.title,
  }, clock, win);

  const shown = (): void => {
    const s = current();
    if (!s) return;
    fitSlide(s, undefined, grid);
    redrawEnhancement(s);
    speaker.sync();
  };

  // images, stylesheets (KaTeX's, from the CDN, may arrive after the first fit) and fonts that finish loading change what fits
  root.addEventListener('load', (e) => { const t = e.target as Element; if (t && t.tagName === 'IMG' && current()?.contains(t)) fitSoon(); }, true);
  const onSheet = (e: Event): void => { const t = e.target as Element | null; if (t && t.tagName === 'LINK') fitSoon(); };
  doc.addEventListener('load', onSheet, true);
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
    shown();
    void enhanceDocument(slidesEl, { scheme }).then(() => { if (mine === generation && !destroyed) fitSoon(); }, () => undefined);
    void fonts?.ready?.then(() => { if (mine === generation && !destroyed) fitSoon(); });
  }

  function present(theme: { id: string; scheme: 'light' | 'dark' }, size: { width: number; height: number }): void {
    scheme = theme.scheme;
    installStyles(doc, theme.id);
    doc.documentElement.classList.add('orz-slides-page');
    root.setAttribute('data-orz-theme', theme.id);
    root.style.setProperty('--sl-w', `${size.width}px`);
    root.style.setProperty('--sl-h', `${size.height}px`);
    if (reveal?.isReady()) {
      const cfg = (reveal as unknown as { getConfig?(): { width: number; height: number } }).getConfig?.();
      if (!cfg || cfg.width !== size.width || cfg.height !== size.height) { reveal.configure({ width: size.width, height: size.height }); reveal.layout(); }
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
      doc.removeEventListener('fullscreenchange', onFullscreen);
      disposeEnhancement(slidesEl);
      try { reveal?.destroy(); } catch { /* reveal's own */ }
      root.remove();
    },
  };
}
