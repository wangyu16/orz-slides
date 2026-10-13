/**
 * KIND-SPECIFIC (slides): the read view of an assembled `.slides.html`.
 *
 * REBUILD STEP 1–2 STUB: the deck is shown as one flattened, scrolling
 * document (the slides' Markdown in order; the markers are HTML comments and
 * render nothing) in `#orz-doc`, styled by the header theme's stand-in
 * stylesheet (src/presentation.ts) and enhanced by the kit's
 * `enhanceDocument`. Rebuild step 3 replaces it with the engine: reveal.js
 * in `src/present/`, slides at the logical size, theme chrome, fit, `onKey`
 * navigation, Present and Print.
 */
import type { CarrierReadView, ReadViewContext } from 'orz-markdown/carrier/app';
import { disposeEnhancement, enhanceDocument, PREVIEW_CDN, swapStylesheet } from 'orz-markdown/preview-frame';
import { readDocument } from '../../assemble.js';
import { presentationOf, themeHref, SHELL_STYLESHEETS } from '../../presentation.js';
import { renderSlides } from './render.js';

export interface SlidesReadView extends CarrierReadView {
  readonly element: HTMLElement;
  readonly article: HTMLElement;
  render(text: string, ctx?: ReadViewContext): Promise<void>;
}

/** The read view of the shell's `#orz-view` / `#orz-doc` (created when the page lacks them). */
export function createReadView(doc: Document): SlidesReadView {
  let main = doc.getElementById('orz-view');
  if (!main) {
    main = doc.createElement('main');
    main.id = 'orz-view';
    main.className = 'orz-view orz-slides';
    doc.body.prepend(main);
  }
  let article = doc.getElementById('orz-doc');
  if (!article) {
    article = doc.createElement('article');
    article.id = 'orz-doc';
    article.className = 'markdown-body';
    main.append(article);
  }
  let generation = 0;
  let destroyed = false;

  const enableStylesheets = (): void => {
    for (const id of SHELL_STYLESHEETS) {
      const l = doc.getElementById(id);
      if (l && l.getAttribute('media') === 'not all') l.removeAttribute('media');
    }
  };

  const present = (text: string): { scheme: 'light' | 'dark' } => {
    const p = presentationOf(text);
    swapStylesheet(doc, 'orz-theme', themeHref(p.theme));
    swapStylesheet(doc, 'orz-hljs', p.theme.scheme === 'dark' ? PREVIEW_CDN.hljsDarkCss : PREVIEW_CDN.hljsLightCss);
    enableStylesheets();
    const scheme = doc.querySelector('meta[name="color-scheme"]');
    if (scheme && scheme.getAttribute('content') !== p.theme.scheme) scheme.setAttribute('content', p.theme.scheme);
    main!.setAttribute('data-orz-theme', p.theme.id);
    main!.setAttribute('data-orz-ratio', p.ratio);
    try {
      const title = readDocument(text, { kind: 'slides' }).title;
      if (doc.title !== title) doc.title = title;
    } catch { /* the title stays */ }
    return { scheme: p.theme.scheme };
  };

  return {
    element: main,
    article,
    present,
    async render(text, ctx = {}) {
      const mine = ++generation;
      const { scheme } = present(text);
      const html = await renderSlides(text, ctx);
      if (mine !== generation || destroyed) return;
      disposeEnhancement(article!);
      article!.innerHTML = html;
      void enhanceDocument(article!, { scheme }).catch(() => undefined);
    },
    destroy() {
      destroyed = true;
      generation++;
      disposeEnhancement(article!);
    },
  };
}
