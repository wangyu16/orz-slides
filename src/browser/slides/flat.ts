/**
 * KIND-SPECIFIC (slides): the FLATTENED render of a deck — the editor
 * preview of editing mode (a), whole deck (REBUILD §3c owner decision 1(a),
 * plan step 5). An ordinary flow, so the kit's diff preview and scroll sync
 * work as for md:
 *
 * - every slide's content in text order, in-slide layout ignored (no grid,
 *   no fit, no floats placed);
 * - a thin divider per slide (`div.orz-flat-slide`, `data-slide` its 0-based
 *   index) with its number, its title (plain text) and its layout or
 *   template, at the slide marker's line;
 * - a small label per region (`div.orz-flat-region`, `data-region`): the
 *   region a marker opens, and the slide's leading region when the layout
 *   has more than one box; floats are labelled with their geometry;
 * - the speaker notes (`aside.orz-flat-notes`) and a slide's footer
 *   (`div.orz-flat-footer`) wrapped and labelled, so they read as apart;
 * - text before the first slide (`div.orz-flat-preamble`, "not shown") and a
 *   0.x deck block (`div.orz-flat-deck`, "renders nothing") said;
 * - every block stamped with `data-src-line` — its 0-based line in the WHOLE
 *   text (the header's lines counted) — as the kit's md renderer does
 *   (orz-markdown `carrier/editor` render-md.ts), dividers and labels
 *   included, so the editor's scroll sync anchors on them.
 *
 * Markers are the parser's (src/deck/parse.ts `scanMarkers`: top-level
 * comment blocks only); a marker line the grammar does not read (a lint)
 * renders as the comment it is — nothing.
 *
 * Includes as every preview surface resolves them (the kit's
 * `previewIncludes`, FC-19 §3): a file include from the `#orz-includes`
 * record, else the host's `fetchInclude(path)`; a URL include through
 * `fetchInclude(url)`, else the record (`prepareSources`); included content
 * anchors at its directive's line.
 *
 * Isomorphic (no DOM): unit-tested in Node (tests/flat.test.ts).
 */
import { md, prepareSources } from 'orz-markdown';
import { withoutHeader } from 'orz-markdown/carrier';
import type { TwinNaming } from 'orz-markdown/carrier';
import { includeRecordEnv, previewIncludes } from 'orz-markdown/carrier/editor';
import { twinLinksEnv } from '../../present/render.js';
import { parseDeck, scanMarkers, type ScannedMarker } from '../../deck/parse.js';
import { plainInline, sectionTitleOf } from '../../deck/plan.js';
import { leaves } from '../../deck/layout-spec.js';
import type { Slide } from '../../types.js';

export interface FlatRenderContext {
  fetchInclude?(target: string): Promise<string | null>;
  /** `false`: links as written (the host resolves them); (1.1) a naming (FC-18 §8.2): the host's names; default the family's. */
  twinLinks?: boolean | TwinNaming | null;
  cache?: Map<string, unknown>;
  includes?: Readonly<Record<string, string>>;
}

/** The article class of the flattened preview (the frame's `#orz-doc`). */
export const FLAT_ARTICLE_CLASS = 'markdown-body orz-flat';

type Tok = ReturnType<typeof md.parse>[number];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Line breaks in a string (CR LF, CR and LF each count once). */
function linesIn(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) n++;
    else if (c === 13) { n++; if (s.charCodeAt(i + 1) === 10) i++; }
  }
  return n;
}

/** Block tokens without nesting that render their attributes (the kit's set). */
const STAMPED_LEAVES = new Set(['fence', 'code_block', 'hr']);

const TEMPLATE_LABEL: Readonly<Record<string, string>> = Object.freeze({ title: 'title page', section: 'section page', outline: 'outline', closing: 'closing page' });

/** A slide's title as plain text (the leading h2 of a normal slide; a template's first heading or line). */
export function slideTitle(slide: Slide): string {
  if (slide.kind === 'template') return sectionTitleOf(slide);
  return slide.title ? plainInline(slide.title) : '';
}

/** What a slide's divider says after its title: its layout as written (or its template) and its other options. */
function slideMeta(slide: Slide): string {
  const options = slide.optionTokens.filter((o) => !/^(?:template|v)=/.test(o));
  const head = slide.kind === 'template'
    ? `${TEMPLATE_LABEL[slide.template ?? ''] ?? slide.template ?? 'template'}${slide.templateVariant ? ` v${slide.templateVariant}` : ''}`
    : slide.layoutSpec;
  return [head, ...options].filter((x) => x).join(' ');
}

function dividerHtml(slide: Slide, total: number, line: number): string {
  const title = slideTitle(slide);
  const meta = slideMeta(slide);
  return `<div class="orz-flat-slide" data-slide="${slide.index}" data-src-line="${line}" role="separator" aria-label="Slide ${slide.index + 1} of ${total}${title ? `: ${esc(title)}` : ''}">`
    + `<span class="orz-flat-n">${slide.index + 1}</span>`
    + `<span class="orz-flat-t">${title ? esc(title) : '<i>untitled</i>'}</span>`
    + (meta ? `<span class="orz-flat-meta">${esc(meta)}</span>` : '')
    + '</div>\n';
}

const label = (cls: string, text: string, line: number, extra = ''): string => `<div class="${cls}" data-src-line="${line}"${extra}><span class="orz-flat-label">${esc(text)}</span></div>\n`;

/** The geometry of a float marker, as written (`left=… top=… w=…`). */
function floatGeometry(content: string): string {
  const m = /<!--\s*@float\b([\s\S]*?)-->/.exec(content);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Render a slides text to the flattened preview's HTML (see the module comment). */
export async function renderFlat(text: string, ctx: FlatRenderContext = {}): Promise<string> {
  const { body, offset } = withoutHeader(text);
  const lineOffset = linesIn(text.slice(0, offset));
  // includes as every preview surface resolves them (the kit's previewIncludes, FC-19 §3; final loop EI-2): a file
  // include from the record, else the host's fetchInclude(path); a URL include from fetchInclude(url), else the record
  const inc = ctx.fetchInclude || (ctx.includes && Object.keys(ctx.includes).length > 0)
    ? await previewIncludes(text, { ...(ctx.includes ? { includes: ctx.includes } : {}), ...(ctx.fetchInclude ? { fetchInclude: ctx.fetchInclude } : {}), ...(ctx.cache ? { cache: ctx.cache } : {}) })
    : null;
  const rec = inc?.includes ?? ctx.includes;
  const env: Record<string, unknown> = { ...includeRecordEnv(rec ?? {}), orzTwinLinks: twinLinksEnv(ctx.twinLinks) };

  // URL includes, as the engine resolves them, each fetched once per shell
  let source = body;
  let mapLine: ((l: number) => number) | null = null;
  const hasUrlIncludes = /\{\{[^}\n]*[a-z][a-z0-9+.-]*:\/\//i.test(body);
  if (hasUrlIncludes && inc !== null) {
    const fetcher = inc.fetcher;
    try { source = await prepareSources(body, { fetcher, includeEnv: env as never }); } catch { source = body; }
    if (source !== body) {
      const a = body.split(/\r\n?|\n/);
      const b = source.split(/\r\n?|\n/);
      let head = 0;
      while (head < a.length && head < b.length && a[head] === b[head]) head++;
      let tail = 0;
      while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
      const shift = b.length - a.length;
      mapLine = (l) => (l < head ? l : l >= b.length - tail ? l - shift : head);
    }
  }
  const lineOf = (l: number): number => (mapLine ? mapLine(l) : l) + lineOffset;

  // the deck (whole text, memoised) and its markers by their first line (0-based, whole text)
  const deck = parseDeck(text);
  const markers = new Map<number, ScannedMarker>();
  for (const m of scanMarkers(text)) markers.set(m.span.line - 1, m);
  const slideAt = new Map<number, Slide>();
  for (const s of deck.slides) slideAt.set(s.marker.line - 1, s);
  const total = deck.slides.length;
  const firstSlideLine = deck.slides.length > 0 ? deck.slides[0].marker.line - 1 : Infinity;

  const tokens = md.parse(source, env) as Tok[];
  const out: Tok[] = [];
  // a raw block of the flattened view (the renderer's html_block rule reads only `content`)
  const html = (content: string): Tok => ({ type: 'html_block', tag: '', nesting: 0, level: 0, content, block: true, map: null, attrs: null, children: null, markup: '', info: '', meta: null, hidden: false }) as unknown as Tok;
  /** The wrapper still open (notes, footer, preamble): closed before the next marker and at the end. */
  let open = '';
  const close = (): string => { const c = open; open = ''; return c; };
  /** After the title's heading of the current slide: the leading region's label. */
  let leadAfter: { line: number; label: string } | null = null;
  let preambleOpen = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // the kit's missing-include note, as in its md preview
    if (t.type === 'plugin_block' && /^(?:markdown|md|md-include)$/.test(t.info) && (t.content || '').trim()) {
      const target = (t.content || '').trim();
      t.type = 'html_block';
      t.content = `<p class="orz-include-missing" role="note" data-md="${esc(`{{${t.info} ${target}}}`)}"><small>Included file not available: ${esc(target)}</small></p>\n`;
    }
    const line = t.map ? lineOf(t.map[0]) : -1;
    // text before the first slide: said once, wrapped
    if (!preambleOpen && t.level === 0 && t.map && line < firstSlideLine && t.nesting !== -1) {
      const m = t.type === 'html_block' ? markers.get(line) : undefined;
      const blank = t.type === 'html_block' && /^\s*$/.test(t.content);
      if (!blank && m?.type !== 'deck') {
        preambleOpen = true;
        out.push(html(`<div class="orz-flat-preamble" data-src-line="${line}"><span class="orz-flat-label">${total > 0 ? 'Before the first slide (not shown)' : 'No slide marker yet: the deck has no slides'}</span>\n`));
        open = '</div>\n';
      }
    }
    if (t.level === 0 && t.type === 'html_block' && t.map) {
      const m = markers.get(line);
      if (m) {
        let rep = close();
        if (m.type === 'slide') {
          const s = slideAt.get(line);
          if (s) {
            rep += dividerHtml(s, total, line);
            const names = leaves(s.layout);
            const lead = s.regions.find((r) => r.sources.some((src) => src.marker === null));
            leadAfter = null;
            if (s.kind === 'normal' && names.length > 1 && lead) {
              const lab = { line, label: lead.name };
              if (s.titleSpan) leadAfter = { line: s.titleSpan.line - 1, label: lead.name };
              else rep += label('orz-flat-region', lab.label, line, ` data-region="${esc(lab.label)}"`);
            }
          }
        } else if (m.type === 'region') {
          const name = m.name ?? '';
          if (name === 'notes') { rep += `<aside class="orz-flat-notes" data-src-line="${line}"><span class="orz-flat-label">Speaker notes</span>\n`; open = '</aside>\n'; }
          else if (name === 'footer') { rep += `<div class="orz-flat-footer" data-src-line="${line}"><span class="orz-flat-label">Footer</span>\n`; open = '</div>\n'; }
          else if (name === 'float') { const g = floatGeometry(m.content); rep += label('orz-flat-region orz-flat-float', `float${g ? ` · ${g}` : ''}`, line, ' data-region="float"'); }
          else rep += label('orz-flat-region', name, line, ` data-region="${esc(name)}"`);
        } else if (m.type === 'deck') {
          rep += label('orz-flat-deck', '0.x deck block: renders nothing (run upgrade)', line);
        }
        t.content = rep;
        out.push(t);
        continue;
      }
    }
    if (t.map && t.block && (t.nesting === 1 || STAMPED_LEAVES.has(t.type))) t.attrSet('data-src-line', String(line));
    out.push(t);
    // the leading region's label goes right after the slide's title
    if (leadAfter && t.type === 'heading_close' && t.level === 0) {
      const opener = out.length >= 3 ? out[out.length - 3] : null;
      if (opener?.map && lineOf(opener.map[0]) === leadAfter.line) {
        out.push(html(label('orz-flat-region', leadAfter.label, leadAfter.line, ` data-region="${esc(leadAfter.label)}"`)));
        leadAfter = null;
      }
    }
  }
  const tail = close();
  if (tail) out.push(html(tail));
  return md.renderer.render(out as never, md.options, env);
}
