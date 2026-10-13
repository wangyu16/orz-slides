/**
 * KIND-SPECIFIC (slides): the flattened render of a deck — the read view's
 * stub (rebuild step 1–2) and the editor preview until step 5 (the flattened
 * preview with slide dividers): the kit's `renderMarkdownPreviewWithIncludes`
 * (the body without its header, twin links, `data-src-line` anchors, the
 * file's includes). The slide and region markers are HTML comments: they
 * render nothing.
 */
import { renderMarkdownPreviewWithIncludes } from 'orz-markdown/carrier/editor';

export interface SlidesRenderContext {
  fetchInclude?(target: string): Promise<string | null>;
  twinLinks?: boolean;
  cache?: Map<string, unknown>;
  includes?: Readonly<Record<string, string>>;
}

/** Render a slides text to flattened HTML. */
export function renderSlides(text: string, ctx: SlidesRenderContext = {}): Promise<string> {
  return renderMarkdownPreviewWithIncludes(text, {
    ...(ctx.twinLinks === false ? { twinLinks: false } : {}),
    ...(ctx.includes ? { includes: ctx.includes } : {}),
    ...(ctx.fetchInclude ? { fetchInclude: ctx.fetchInclude } : {}),
    ...(ctx.cache ? { cache: ctx.cache } : {}),
  });
}
