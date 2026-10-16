/**
 * The slide renderer: a parsed deck → the slides' HTML (one reveal.js
 * `<section>` per slide) in the 1.0 DOM contract (docs/dom-contract.md):
 *
 * - the theme chrome lives INSIDE the slide: a top slot `.orz-head` (the
 *   running head: the deck title and the current section) and a bottom slot
 *   `.orz-chrome` (the footer, the section label, the slide number and the
 *   progress bar, `--progress` on the section), honouring the header keys
 *   `slide_numbers`, `progress` and `section_numbers` (src/deck/plan.ts);
 * - every box that can overflow (`.orz-title`, `.orz-region`,
 *   `.orz-template`, `.orz-float`) carries `.orz-box`: the engine's fit pass
 *   scales it (`--fit-scale`) and reports `data-scale` / `data-clipped`;
 * - section templates carry their number (`data-sec`), outlines mark their
 *   current item (`li.orz-here`, `aria-current="step"`).
 *
 * Pure: takes the Markdown renderer (orz-markdown's `md`) so it has no
 * direct dependency on it, no DOM and no Node built-ins — the same HTML in
 * Node (unit tests) and in the browser engine (src/present/).
 */
import type { Deck, DeckConfig, FloatRegion, Region, SectionNumbers, Slide } from './types.js';
import { renderLayout } from './layout.js';
import { plainInline, planDeck, type SlidePlan } from './deck/plan.js';

/** A markdown-it token, as far as the outline marking needs it. */
interface MdToken {
  type: string;
  level: number;
  attrJoin(name: string, value: string): void;
  attrSet(name: string, value: string): void;
}

/** The Markdown renderer this module needs (orz-markdown's `md` is one). */
export interface Renderer {
  render(src: string, env?: Record<string, unknown>): string;
  renderInline?(src: string, env?: Record<string, unknown>): string;
  /** With `renderer`: lets an outline mark its current item on the tokens (else it is left unmarked). */
  parse?(src: string, env: Record<string, unknown>): MdToken[];
  renderer?: { render(tokens: MdToken[], options: unknown, env: Record<string, unknown>): string };
  options?: unknown;
}

/** Options of {@link renderDeck} / {@link renderSlide}. */
export interface RenderOptions {
  /** The render env every Markdown render gets (twin links, an include reader). */
  env?: Record<string, unknown>;
  /** The theme's default section numbering (when the header's `section_numbers` does not say). Default `01`. */
  themeNumbers?: SectionNumbers;
}

const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function regionMap(regions: Region[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of regions) m[r.name] = r.markdown;
  return m;
}

const inline = (md: Renderer, s: string, env: Record<string, unknown>): string => {
  if (!s) return '';
  return md.renderInline ? md.renderInline(s, { ...env }) : md.render(s, { ...env }).replace(/^<p>|<\/p>\s*$/g, '');
};
const block = (md: Renderer, s: string, env: Record<string, unknown>): string => (s.trim() ? md.render(s, { ...env }) : '');

/** Fill each empty `.orz-region` placeholder with its rendered Markdown. */
function fillRegions(grid: string, names: string[], rmap: Record<string, string>, md: Renderer, env: Record<string, unknown>): string {
  let html = grid;
  for (const name of names) {
    const cell = `<div class="orz-region" data-region="${esc(name)}"></div>`;
    const filled = `<div class="orz-region orz-box" data-region="${esc(name)}"><div class="markdown-body">${block(md, rmap[name] || '', env)}</div></div>`;
    html = html.replace(cell, () => filled);
  }
  return html;
}

function titleBand(slide: Slide, md: Renderer, env: Record<string, unknown>): string {
  if (!slide.title) return '';
  return `<header class="orz-title orz-box"><div class="markdown-body"><h2>${inline(md, slide.title, env)}</h2></div></header>`;
}

/** The top slot: the running head (deck title, current section). Themes show it or not (hidden by default). */
function headSlot(deck: DeckConfig, plan: SlidePlan, md: Renderer, env: Record<string, unknown>): string {
  const title = deck.title ? inline(md, deck.title, env) : '';
  return `<div class="orz-head"><span class="orz-head-deck">${title}</span>`
    + `<span class="orz-head-sec" data-sec="${esc(plan.sectionLabel)}">${esc(plan.sectionTitle)}</span></div>`;
}

/** The bottom slot: footer, section label, number, progress (the header keys decide number and progress). */
function chromeSlot(slide: Slide, deck: DeckConfig, plan: SlidePlan, md: Renderer, env: Record<string, unknown>): string {
  // a slide's @footer always wins (on that slide alone); the deck footer shows on every slide except the title page
  const isTitle = slide.kind === 'template' && (slide.template ?? 'title') === 'title';
  const src = slide.footer ?? (isTitle ? undefined : deck.footer);
  // its full text in a title: an ellipsized footer is still readable (round A2, A2-TH-13)
  const footer = src ? `<div class="orz-footer" title="${esc(plainInline(src))}"><div class="markdown-body">${block(md, src, env)}</div></div>` : '';
  const sec = `<span class="orz-chrome-sec" data-sec="${esc(plan.sectionLabel)}">${esc(plan.sectionTitle)}</span>`;
  const num = deck.slideNumbers ? `<span class="orz-chrome-num"><b>${plan.n}</b><i>/</i><span>${plan.total}</span></span>` : '';
  const bar = deck.progress ? '<span class="orz-chrome-bar" aria-hidden="true"></span>' : '';
  return `<div class="orz-chrome">${footer}${sec}${num}${bar}</div>`;
}

/** Split a template body into its title (h1), subtitle (h2), and the rest (0.x). */
function splitFields(src: string): { title: string; subtitle: string; meta: string } {
  let title = '';
  let subtitle = '';
  const meta: string[] = [];
  for (const line of src.split('\n')) {
    const h1 = line.match(/^#\s+(.*\S)\s*$/);
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h1 && !title) title = h1[1];
    else if (h2 && !subtitle) subtitle = h2[1];
    else meta.push(line);
  }
  return { title, subtitle, meta: meta.join('\n').trim() };
}

function floatBoxes(floats: FloatRegion[], md: Renderer, env: Record<string, unknown>): string {
  return floats.map((f) => {
    const s: string[] = [];
    const g = f.geom;
    if (g.left) s.push(`left:${g.left}`);
    if (g.right) s.push(`right:${g.right}`);
    if (g.top) s.push(`top:${g.top}`);
    if (g.bottom) s.push(`bottom:${g.bottom}`);
    if (g.w) s.push(`width:${g.w}`);
    if (g.h) s.push(`height:${g.h}`);
    if (g.z != null) s.push(`z-index:${g.z}`);
    return `<div class="orz-float orz-box" style="${esc(s.join(';'))}"><div class="markdown-body">${block(md, f.markdown, env)}</div></div>`;
  }).join('');
}

function notesBlock(slide: Slide, md: Renderer, env: Record<string, unknown>): string {
  return slide.notes ? `<aside class="notes">${block(md, slide.notes, env)}</aside>` : '';
}

/**
 * A slide background: an image (a URL or a path to an image), a CSS gradient (reveal's `data-background-gradient`:
 * as a colour it drew nothing on screen — round A3, A3-TH-7) or a colour.
 */
function background(bg: string): string {
  const image = /^(?:https?:|data:image\/|\.{0,2}\/)|\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i.test(bg.trim());
  if (image) return `data-background-image="${esc(bg)}"`;
  if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(bg.trim())) return `data-background-gradient="${esc(bg)}"`;
  return `data-background-color="${esc(bg)}"`;
}

function sectionAttrs(slide: Slide, plan: SlidePlan, kind: string, template?: string): string {
  const a: string[] = [`class="orz-slide${slide.options.class ? ' ' + esc(slide.options.class) : ''}"`];
  a.push(`data-kind="${kind}"`);
  if (template) a.push(`data-template="${esc(template)}"`);
  if (slide.templateVariant) a.push(`data-v="${slide.templateVariant}"`);
  a.push(`data-fit="${slide.options.fit || 'fit'}"`);
  a.push(`data-n="${plan.n}"`);
  a.push(`data-sec="${esc(plan.sectionLabel)}"`);
  if (slide.options.id) a.push(`id="${esc(slide.options.id)}"`);
  if (slide.options.transition) a.push(`data-transition="${esc(slide.options.transition)}"`);
  if (slide.options.step) a.push('data-step="1"');
  if (slide.options.bg) a.push(background(slide.options.bg));
  a.push(`style="--progress:${plan.progress.toFixed(4)}"`);
  return a.join(' ');
}

/** An outline body with its current item (1-based top-level item `here`) marked; 0 marks none. */
export function renderOutline(src: string, here: number, md: Renderer, env: Record<string, unknown>): string {
  if (!src.trim()) return '';
  if (here < 1 || !md.parse || !md.renderer) return md.render(src, { ...env });
  const e = { ...env };
  const tokens = md.parse(src, e);
  // the items of the first top-level list
  let item = 0;
  let inList = false;
  for (const t of tokens) {
    if (!inList && t.level === 0 && (t.type === 'ordered_list_open' || t.type === 'bullet_list_open')) { inList = true; continue; }
    if (inList && t.level === 0 && (t.type === 'ordered_list_close' || t.type === 'bullet_list_close')) break;
    if (inList && t.level === 1 && t.type === 'list_item_open') {
      item++;
      if (item === here) {
        t.attrJoin('class', 'orz-here');
        t.attrSet('aria-current', 'step');
        break;
      }
    }
  }
  return md.renderer.render(tokens, md.options, e);
}

function renderNormal(slide: Slide, plan: SlidePlan, md: Renderer, deck: DeckConfig, env: Record<string, unknown>): string {
  const { html: grid, regions } = renderLayout(slide.layout);
  const content = fillRegions(grid, regions, regionMap(slide.regions), md, env);
  return `<section ${sectionAttrs(slide, plan, 'normal')}>`
    + headSlot(deck, plan, md, env)
    + '<div class="orz-frame">'
    + titleBand(slide, md, env)
    + `<div class="orz-content">${content}</div>`
    + '</div>'
    + floatBoxes(slide.floats, md, env)
    + chromeSlot(slide, deck, plan, md, env)
    + notesBlock(slide, md, env)
    + '</section>';
}

function renderTemplate(slide: Slide, plan: SlidePlan, md: Renderer, deck: DeckConfig, env: Record<string, unknown>): string {
  const name = slide.template || 'title';
  const v = slide.templateVariant ? ` orz-v${slide.templateVariant}` : '';
  const body = regionMap(slide.regions)['body'] || '';

  let inner: string;
  if (name === 'outline') {
    inner = `<div class="orz-outline markdown-body" data-here="${plan.here ?? 0}">${renderOutline(body, plan.here ?? 0, md, env)}</div>`;
  } else if (name === 'section') {
    const f = splitFields(body);
    const head = f.title || f.subtitle;
    const meta = f.title ? [f.subtitle ? `## ${f.subtitle}` : '', f.meta].filter((x) => x).join('\n\n') : f.meta;
    inner = (head ? `<div class="orz-section-main" data-sec="${esc(plan.sectionLabel)}" data-sec-len="${[...plan.sectionLabel].length}">${inline(md, head, env)}</div>` : '')
      + (meta ? `<div class="orz-section-meta markdown-body">${block(md, meta, env)}</div>` : '');
  } else {
    // title / closing → title-style fields (h1 · h2 · meta)
    const f = splitFields(body);
    inner = (f.title ? `<h1 class="orz-title-main">${inline(md, f.title, env)}</h1>` : '')
      + (f.subtitle ? `<div class="orz-title-sub">${inline(md, f.subtitle, env)}</div>` : '')
      + (f.meta ? `<div class="orz-title-meta markdown-body">${block(md, f.meta, env)}</div>` : '');
  }

  return `<section ${sectionAttrs(slide, plan, 'template', name)}>`
    + headSlot(deck, plan, md, env)
    + '<div class="orz-frame">'
    + `<div class="orz-template orz-template-${esc(name)}${v} orz-box" data-orz-copy>${inner}</div>`
    + '</div>'
    + floatBoxes(slide.floats, md, env)
    + chromeSlot(slide, deck, plan, md, env)
    + notesBlock(slide, md, env)
    + '</section>';
}

/** Render one slide (its plan from {@link planDeck}). */
export function renderSlide(slide: Slide, plan: SlidePlan, md: Renderer, deck: DeckConfig, options: RenderOptions = {}): string {
  const env = options.env ?? {};
  return slide.kind === 'template' ? renderTemplate(slide, plan, md, deck, env) : renderNormal(slide, plan, md, deck, env);
}

/** Render a whole deck: its slides' `<section>`s, joined (for `.reveal .slides`). */
export function renderDeck(deck: Deck, md: Renderer, options: RenderOptions = {}): string {
  const plans = planDeck(deck, options.themeNumbers ?? '01');
  return deck.slides.map((s, i) => renderSlide(s, plans[i], md, deck.config, options)).join('\n');
}
