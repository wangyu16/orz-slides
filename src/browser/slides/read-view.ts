/**
 * KIND-SPECIFIC (slides): the read view of an assembled `.slides.html` —
 * the deck itself (REBUILD §3c step 3): the engine of src/present/ (reveal.js
 * behind one module) in the shell's `#orz-view`, slides at the logical
 * size with the theme's chrome inside them, fit on the visible slide, keys
 * through the kit's `onKey`, Present, the speaker view, overview, the timer
 * and the print document (the kind's actions, src/browser/slides/kind.ts).
 *
 * `present(text)` applies the header's theme and ratio (the engine's styles,
 * the colour scheme, the highlight.js stylesheet) without re-rendering;
 * `render(text, ctx)` renders the deck with the file's includes and keeps
 * the current slide; edit mode hides the view (`setVisible`).
 */
import type { CarrierReadView, ReadViewContext } from 'orz-markdown/carrier/app';
import { PREVIEW_CDN, swapStylesheet } from 'orz-markdown/preview-frame';
import { readDocument } from '../../assemble.js';
import { presentationOf, SHELL_STYLESHEETS } from '../../presentation.js';
import { createDeckEngine, type DeckEngine } from '../../present/engine.js';
import { logicalSize } from '../../present/render.js';

export interface SlidesReadView extends CarrierReadView {
  readonly element: HTMLElement;
  /** The engine (Present, speaker view, overview, print — the kind's actions use it). */
  readonly engine: DeckEngine;
  render(text: string, ctx?: ReadViewContext): Promise<void>;
  present(text: string): { scheme: 'light' | 'dark' };
  onKey(event: KeyboardEvent): boolean;
  setVisible(visible: boolean): void;
  /** Go to a slide (0-based) now and after the next render (leaving edit mode: the caret's slide; rebuild step 5). */
  goTo(index: number): void;
  destroy(): void;
}

/** The page's read view (one per assembled file; null in an app's page): the editor keeps its slide (rebuild step 5). */
let active: SlidesReadView | null = null;
export function activeReadView(): SlidesReadView | null {
  return active;
}

/** The app's handle, when the kit's app runs this page (for its chrome and toasts). */
type AppHandle = { setChromeVisible?(v: boolean): void; toast?(m: string, tone?: string): void };
const appHandle = (): AppHandle | null => ((globalThis as unknown as { OrzCarrier?: { standalone?: AppHandle } }).OrzCarrier?.standalone ?? null);

/** The read view of the shell's `#orz-view` (created when the page lacks it). */
export function createReadView(doc: Document): SlidesReadView {
  let main = doc.getElementById('orz-view');
  if (!main) {
    main = doc.createElement('main');
    main.id = 'orz-view';
    main.className = 'orz-view orz-slides';
    doc.body.prepend(main);
  }
  const view = main;
  let text = '';
  // the document's facts, read once per text (FMT-8: the title and lang were a full read — parse and lint — each time)
  let facts: { text: string; title: string; lang: string } | null = null;
  const factsOf = (t: string): { title: string; lang: string } => {
    if (facts?.text !== t) {
      try { const d = readDocument(t, { kind: 'slides' }); facts = { text: t, title: d.title, lang: d.lang }; } catch { facts = { text: t, title: doc.title, lang: 'en' }; }
    }
    return facts;
  };
  const engine = createDeckEngine(view, {
    onPresent: (p) => appHandle()?.setChromeVisible?.(!p),
    notify: (m) => appHandle()?.toast?.(m),
    lang: () => factsOf(text).lang,
    title: () => factsOf(text).title,
  });

  const enableStylesheets = (): void => {
    for (const id of SHELL_STYLESHEETS) {
      const l = doc.getElementById(id);
      if (l && l.getAttribute('media') === 'not all') l.removeAttribute('media');
    }
  };

  const present = (t: string): { scheme: 'light' | 'dark' } => {
    const p = presentationOf(t);
    engine.present(p.theme, logicalSize(p.ratio));
    swapStylesheet(doc, 'orz-hljs', p.theme.scheme === 'dark' ? PREVIEW_CDN.hljsDarkCss : PREVIEW_CDN.hljsLightCss);
    enableStylesheets();
    const scheme = doc.querySelector('meta[name="color-scheme"]');
    if (scheme && scheme.getAttribute('content') !== p.theme.scheme) scheme.setAttribute('content', p.theme.scheme);
    view.setAttribute('data-orz-theme', p.theme.id);
    view.setAttribute('data-orz-ratio', p.ratio);
    const title = factsOf(t).title;
    if (doc.title !== title) doc.title = title;
    return { scheme: p.theme.scheme };
  };

  /** A slide to show once the next render is in (leaving edit mode). */
  let pending: number | null = null;
  const self: SlidesReadView = {
    element: view,
    engine,
    present,
    async render(t, ctx = {}) {
      text = t;
      present(t);
      await engine.render(t, {
        ...(ctx.includes ? { includes: ctx.includes } : {}),
        ...(ctx.fetchInclude ? { fetchInclude: ctx.fetchInclude } : {}),
      });
      // the shell's fallback line goes once the deck shows
      view.querySelector(':scope > .orz-fallback')?.remove();
      if (pending !== null) { const i = pending; pending = null; if (engine.index() !== i) engine.go(i); }
    },
    onKey: (e) => engine.onKey(e),
    setVisible: (v) => engine.setVisible(v),
    goTo(i) {
      if (!Number.isInteger(i) || i < 0) return;
      pending = i;
      engine.go(i);
    },
    destroy() {
      if (active === self) active = null;
      engine.destroy();
    },
  };
  active = self;
  return self;
}
