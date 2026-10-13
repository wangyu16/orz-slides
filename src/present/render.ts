/**
 * A deck text → its slides' HTML for the engine (read view, print, speaker
 * view): includes resolved the way the kit's previews resolve them (the
 * file's `#orz-includes` record for file includes; URL includes through the
 * host's `fetchInclude`, then the record — `prepareSources`), the deck
 * parsed (src/deck/parse.ts) and rendered with orz-markdown's shared `md`
 * (plugins, twin links) in the 1.0 DOM contract (src/render-slide.ts).
 */
import { md, prepareSources } from 'orz-markdown';
import { includeRecordEnv } from 'orz-markdown/carrier/editor';
import { parseDeck } from '../deck/parse.js';
import { renderDeck, type Renderer } from '../render-slide.js';
import { slideSize } from '../presentation.js';
import { themeOf, type SlideTheme } from '../themes.js';
import type { Deck, Ratio } from '../types.js';

/** What a render reads besides the text (the read view's context). */
export interface DeckRenderContext {
  /** The file's resolved includes (`#orz-includes`): target as written → text. */
  includes?: Readonly<Record<string, string>>;
  /** A connected host's include resolution (URLs). */
  fetchInclude?(target: string): Promise<string | null>;
}

export interface RenderedDeck {
  deck: Deck;
  theme: SlideTheme;
  ratio: Ratio;
  /** The logical slide size (Q2: height 720). */
  width: number;
  height: number;
  /** The slides' `<section>`s. */
  html: string;
}

const isUrl = (t: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(t);

/** The logical slide size of a ratio (Q2: height 720 for every ratio; src/presentation.ts). */
export const logicalSize: (ratio: Ratio) => { width: number; height: number } = slideSize;

/** Render a deck text (see the module comment). */
export async function renderDeckText(text: string, ctx: DeckRenderContext = {}): Promise<RenderedDeck> {
  const rec = ctx.includes;
  const env: Record<string, unknown> = { ...includeRecordEnv(rec ?? {}), orzTwinLinks: true };
  let source = text;
  // a directive with a URL in it (prepareSources expands only the include directives among them)
  const hasUrlIncludes = /\{\{[^}\n]*[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasUrlIncludes && (typeof ctx.fetchInclude === 'function' || (rec && Object.keys(rec).some(isUrl)))) {
    const fetcher = async (url: string): Promise<string | null> => {
      if (ctx.fetchInclude) {
        try {
          const t = await ctx.fetchInclude(url);
          if (typeof t === 'string') return t;
        } catch { /* the record */ }
      }
      return rec && Object.prototype.hasOwnProperty.call(rec, url) && typeof rec[url] === 'string' ? rec[url] : null;
    };
    try {
      source = await prepareSources(text, { fetcher, includeEnv: env as never });
    } catch { /* the text as written */ }
  }
  const deck = parseDeck(source);
  const theme = themeOf(deck.config.theme);
  const { width, height } = logicalSize(deck.config.ratio);
  const html = renderDeck(deck, md as unknown as Renderer, { env, themeNumbers: theme.sectionNumbers });
  return { deck, theme, ratio: deck.config.ratio, width, height, html };
}
