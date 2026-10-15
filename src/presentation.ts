/**
 * The `slides` kind's presentation: how the header's `theme` and `ratio`
 * (FC-18 §5.1 — document data) become the shell's stylesheets and read-view
 * attributes, in one place for the assembled file (Node and browser), the
 * page's read view and the editor preview.
 *
 * The read view's slide themes live INSIDE the engine (src/present/styles.ts,
 * built by scripts/build-themes.ts), so the shell's head carries no theme
 * stylesheet — only KaTeX's and highlight.js's (non-blocking). The editor's
 * preview frame carries the same engine stylesheets (rebuild step 5,
 * src/browser/slides/frame.ts).
 *
 * Only the header decides (never anything but the text): an absent or
 * unknown theme is the default theme, an absent or unknown ratio is 16:9.
 * Isomorphic: no Node built-ins.
 */
import { PREVIEW_CDN } from 'orz-markdown/preview-frame';
import { deckConfig } from './deck/config.js';
import { themeOf, type SlideTheme } from './themes.js';
import type { Ratio } from './types.js';

/** What the header asks for, resolved. */
export interface Presentation {
  theme: SlideTheme;
  ratio: Ratio;
}

/** The presentation of a text, from its header only. */
export function presentationOf(text: string): Presentation {
  // the last text's (the editor asks per slide and per redraw: round B, GUI-11 — the header read once per text)
  if (lastPresentation?.text === text) return lastPresentation.p;
  const c = deckConfig(text);
  const p: Presentation = Object.freeze({ theme: themeOf(c.theme), ratio: c.ratio });
  lastPresentation = { text, p };
  return p;
}
let lastPresentation: { text: string; p: Presentation } | null = null;

/** The logical slide size (Q2: height 720 for every ratio). */
export function slideSize(ratio: Ratio): { width: number; height: number } {
  return ratio === '4:3' ? { width: 960, height: 720 } : { width: 1280, height: 720 };
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The shell's `<head>` part: viewport, colour scheme, KaTeX's stylesheet
 * and the highlight.js stylesheet of the scheme (`#orz-hljs`); the slide
 * theme is the engine's. `deferred` (the assembled file): written
 * `media="not all"` so a slow CDN never blocks the page; the read view
 * switches them on.
 */
export function shellHead(p: Presentation, o: { deferred?: boolean } = {}): string {
  const hljs = p.theme.scheme === 'dark' ? PREVIEW_CDN.hljsDarkCss : PREVIEW_CDN.hljsLightCss;
  const media = o.deferred ? ' media="not all"' : '';
  return [
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="color-scheme" content="${p.theme.scheme}">`,
    `<link rel="stylesheet" id="orz-katex" href="${attr(PREVIEW_CDN.katexCss)}"${media}>`,
    `<link rel="stylesheet" id="orz-hljs" href="${attr(hljs)}"${media}>`,
  ].join('\n');
}

/** The ids of the shell's stylesheets (`shellHead`), in order. */
export const SHELL_STYLESHEETS = Object.freeze(['orz-katex', 'orz-hljs'] as const);

/** What the read view holds until the engine renders: one quiet line per delivery (the same for every document). */
export const FALLBACK_LINE = 'If this page stays blank, open it in a recent browser; the deck\'s text is inside this file — see the comment at the top.';
export const FALLBACK_LINE_CDN = 'If this page stays blank, check your connection (this page loads its engine from the web) or open it in a recent browser; the deck\'s text is inside this file — see the comment at the top.';

/** The read view's markup: `#orz-view` (theme and ratio as attributes) holding the fallback line until the engine renders the deck there. */
export function readViewMarkup(p: Presentation, delivery: 'inline' | 'cdn' = 'inline'): string {
  const line = delivery === 'cdn' ? FALLBACK_LINE_CDN : FALLBACK_LINE;
  return `<main id="orz-view" class="orz-view orz-slides" data-orz-theme="${attr(p.theme.id)}" data-orz-ratio="${attr(p.ratio)}"><p class="orz-fallback" style="opacity:.6;font:14px/1.5 system-ui,sans-serif;margin:1.5em">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></main>`;
}

