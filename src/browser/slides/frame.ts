/**
 * KIND-SPECIFIC (slides): the editor preview's frame document (FC-19 §8.4
 * pluggable preview, `preview.frameDocument`) for editing mode (a):
 *
 * - the kit's bridge first in `<head>` (it carries the frame's secret), then
 *   the kit's head (KaTeX, highlight.js, the base style), the engine's deck
 *   structure (assets/themes/deck.css) and the header's slide theme — the
 *   SAME stylesheets the deck shows in, so the live view is the slide as it
 *   presents; a derived theme's reading styles (its orz-markdown source
 *   theme) style the flattened flow, `.orz-flat` adds the dividers, labels
 *   and notes;
 * - `<article id="orz-doc">` (the default bridge renders the flattened HTML
 *   there, with the kit's diff and anchors), the live view's card
 *   (`aside#orz-live`), the kit's libraries and the live runtime
 *   (src/browser/slides/live-frame.ts), every script and style
 *   nonce-stamped.
 *
 * The theme is the editor's current one: `followPresentation` rebuilds the
 * frame when the header's theme changes (the presentation's `head` names
 * it), and this document is written for the theme the presentation was last
 * asked for.
 */
import type { PreviewFrameParts } from 'orz-markdown/carrier/editor';
import { escapeAttr } from 'orz-markdown/carrier/read';
import { presentationOf } from '../../presentation.js';
import { DECK_CSS, themeStylesheet } from '../../present/styles.js';
import { FLAT_ARTICLE_CLASS } from './flat.js';
import { LIVE_RUNTIME } from './live-source.js';

/** The frame's own layout: the flattened flow's dividers, labels, notes; the live view's card; the stage. */
export const FRAME_CSS = `
html { scroll-behavior: auto; background: var(--sl-bg, var(--bg-color, #fff)); }
html[data-scheme="dark"] { color-scheme: dark; }
:root { --orz-flat-accent: #2f6fde; --orz-flat-on-accent: #fff; --orz-live-chrome: var(--sl-surround, #ffffff); --orz-live-ink: #33363d; --orz-live-line: rgba(0,0,0,.14); }
html[data-scheme="dark"] { --orz-flat-accent: #7aa7ff; --orz-flat-on-accent: #10131a; --orz-live-chrome: var(--sl-surround, #20232b); --orz-live-ink: #d9dce3; --orz-live-line: rgba(255,255,255,.16); }
/* the single-slide stage stands on the theme's surround (owner revision and decision 2026-10-15): a dark theme's soft
   dark, a light theme's designed tint; the flattened preview keeps the slide's background */
html:has(> body.orz-stage) { background: var(--sl-surround, var(--sl-bg, var(--bg-color, #fff))); }
body.orz-live-on #orz-doc { padding-bottom: 46vh; }
.orz-flat .orz-flat-slide {
  display: flex; align-items: center; gap: .65em; margin: 2.4em 0 .9em; padding: .55em 0 0;
  border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0; text-transform: none;
  color: color-mix(in srgb, currentColor 62%, transparent);
}
.orz-flat > .orz-flat-slide:first-child { margin-top: 0; }
.orz-flat .orz-flat-n { flex: none; min-width: 1.9em; padding: 0 .5em; border-radius: 99px; text-align: center; font-variant-numeric: tabular-nums; background: color-mix(in srgb, currentColor 12%, transparent); }
.orz-flat .orz-flat-t { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.orz-flat .orz-flat-meta { flex: none; margin-left: auto; font: 400 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity: .85; }
.orz-flat .orz-flat-label {
  display: inline-block; padding: 0 .55em; border: 1px solid color-mix(in srgb, currentColor 28%, transparent); border-radius: 4px;
  font: 600 10.5px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .07em; text-transform: uppercase;
  color: color-mix(in srgb, currentColor 60%, transparent); background: transparent;
}
.orz-flat .orz-flat-region { margin: 1.1em 0 .35em; }
.orz-flat .orz-flat-float .orz-flat-label { border-style: dashed; text-transform: none; letter-spacing: .02em; }
.orz-flat .orz-flat-deck .orz-flat-label { border-color: #c2410c; color: #c2410c; }
.orz-flat .orz-flat-notes, .orz-flat .orz-flat-footer, .orz-flat .orz-flat-preamble {
  display: block; margin: 1.1em 0; padding: .55em .95em .7em; border-radius: 6px; font-size: .9em; font-style: normal;
  background: color-mix(in srgb, currentColor 5%, transparent);
}
.orz-flat .orz-flat-notes { border-left: 3px solid color-mix(in srgb, currentColor 30%, transparent); }
.orz-flat .orz-flat-footer { border: 1px dashed color-mix(in srgb, currentColor 25%, transparent); }
.orz-flat .orz-flat-preamble { border: 1px dashed color-mix(in srgb, currentColor 25%, transparent); opacity: .7; }
.orz-flat :is(.orz-flat-notes, .orz-flat-footer, .orz-flat-preamble) > .orz-flat-label { margin-bottom: .45em; }
.orz-flat :is(.orz-flat-notes, .orz-flat-footer, .orz-flat-preamble) > :last-child { margin-bottom: 0; }

.orz-live {
  position: fixed; z-index: 20; left: 0; top: 0; width: 0; box-sizing: border-box;
  border: 1px solid var(--orz-live-line); border-radius: 8px; overflow: hidden;
  /* the card enlarges into the stage and back (owner decision 2026-10-14: smooth but quick); placed by cardLayout / stageLayout */
  transition: left .16s ease-out, top .16s ease-out, width .16s ease-out, border-radius .16s;
  background: var(--orz-live-chrome); color: var(--orz-live-ink);
  box-shadow: 0 2px 6px rgba(0,0,0,.10), 0 10px 28px rgba(0,0,0,.14);
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.orz-live[hidden] { display: none; }
.orz-live-head { display: flex; align-items: center; gap: 8px; height: 28px; box-sizing: border-box; padding: 0 34px 0 8px; border-bottom: 1px solid var(--orz-live-line); }
@media (prefers-reduced-motion: reduce) { .orz-live, .orz-live-port { transition: none; } }
.orz-live-port { transition: height .16s ease-out; }
.orz-live-n { font-weight: 600; font-variant-numeric: tabular-nums; }
.orz-live-badge { margin-left: auto; padding: 0 7px; border-radius: 99px; font-weight: 600; white-space: nowrap; }
.orz-live-badge:empty { display: none; }
.orz-live-badge[data-state="ok"] { background: rgba(22,163,74,.14); color: #15803d; }
.orz-live-badge[data-state="shrunk"] { background: rgba(37,99,235,.13); color: #1d4ed8; }
.orz-live-badge[data-state="warn"] { background: rgba(217,119,6,.16); color: #b45309; }
.orz-live-badge[data-state="cut"] { background: rgba(220,38,38,.14); color: #b91c1c; }
html[data-scheme="dark"] .orz-live-badge[data-state="ok"] { color: #4ade80; }
html[data-scheme="dark"] .orz-live-badge[data-state="shrunk"] { color: #93b4ff; }
html[data-scheme="dark"] .orz-live-badge[data-state="warn"] { color: #fbbf24; }
html[data-scheme="dark"] .orz-live-badge[data-state="cut"] { color: #f87171; }
.orz-live-port { position: relative; overflow: hidden; }
.orz-live-port > .orz-live-deck { position: absolute; left: 0; top: 0; transform-origin: 0 0; margin: 0; }
body.orz-stage { overflow: hidden; }
body.orz-stage #orz-doc { display: none; }
/* the per-slide stage (rebuild step 6): placed by stage-geometry.ts, where the trusted page's overlay is */
body.orz-stage .orz-live { position: fixed; right: auto; bottom: auto; border-radius: 2px; border-color: var(--orz-live-line); box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 26px rgba(0,0,0,.10); }
body.orz-stage .orz-live-head { display: none; }
.orz-live-variants { position: fixed; inset: 0; pointer-events: none; }
body:not(.orz-stage) .orz-live-variants { display: none; }
.orz-live-variant { position: absolute; overflow: hidden; border-radius: 3px; box-shadow: 0 0 0 1px var(--orz-live-line); background: var(--orz-live-chrome); }
.orz-live-variant > .reveal { position: absolute; left: 0; top: 0; transform-origin: 0 0; margin: 0; }
`;

/** The theme the next frame document is written for (the presentation sets it; FC-19 §8.4 `frameDocument` gets no text). */
export interface FrameTheme { id: string }

/** The preview's presentation of a text (`followPresentation`): its slide theme (named in `head`, so a change rebuilds the frame) and scheme. */
export function slidesPreviewPresentation(text: string, theme: FrameTheme): { head: string; scheme: 'light' | 'dark'; articleClass: string } {
  const p = presentationOf(text);
  theme.id = p.theme.id;
  return { head: `<meta name="orz-slides-theme" content="${escapeAttr(p.theme.id)}">`, scheme: p.theme.scheme, articleClass: FLAT_ARTICLE_CLASS };
}

/** FC-19 §8.4 `preview.frameDocument` for the slides editor (see the module comment). */
export function slidesFrameDocument(parts: PreviewFrameParts, theme: FrameTheme): string {
  const n = parts.nonce ? ` nonce="${escapeAttr(parts.nonce)}"` : '';
  const t = themeStylesheet(theme.id);
  const css = (s: string): string => s.replace(/<\/(style)/gi, '<\\/$1');
  return (
    `<!doctype html><html lang="en" data-scheme="${parts.scheme}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    parts.bridge +
    parts.head +
    `<style${n} id="orz-deck-css">${css(DECK_CSS)}</style>` +
    `<style${n} id="orz-slide-theme" data-theme="${escapeAttr(t.id)}">${css(t.css)}</style>` +
    `<style${n}>${FRAME_CSS}</style>` +
    `</head><body><article id="orz-doc" class="${parts.articleClass}" data-orz-copy></article>` +
    '<aside id="orz-live" class="orz-live" hidden></aside>' +
    parts.scripts +
    `<script${n}>${LIVE_RUNTIME}</script>` +
    '</body></html>'
  );
}
