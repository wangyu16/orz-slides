/**
 * WP5 — Assembler. A parsed `Slide` → a reveal.js `<section>` per
 * docs/dom-contract.md: title band + content grid (regions filled with
 * orz-markdown) + footer + floats + speaker notes.
 *
 * Pure: takes a markdown renderer (orz-markdown's `md`) so this module has no
 * direct orz-markdown dependency and stays unit-testable in node.
 */
import type { Slide, DeckConfig, Region, FloatRegion, Deck } from './types.js';
import { renderLayout } from './layout.js';

/** Minimal markdown renderer interface (orz-markdown's `md` satisfies it). */
export interface Renderer {
  render(src: string): string;
  renderInline?(src: string): string;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function regionMap(regions: Region[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of regions) m[r.name] = r.markdown;
  return m;
}

/** Fill each empty `.orz-region` placeholder with its rendered markdown. */
function fillRegions(grid: string, names: string[], rmap: Record<string, string>, md: Renderer): string {
  let html = grid;
  for (const name of names) {
    const src = rmap[name] || '';
    const inner = `<div class="markdown-body">${src.trim() ? md.render(src) : ''}</div>`;
    const cell = `<div class="orz-region" data-region="${escapeAttr(name)}"></div>`;
    html = html.replace(cell, `<div class="orz-region" data-region="${escapeAttr(name)}">${inner}</div>`);
  }
  return html;
}

function titleBand(slide: Slide, md: Renderer): string {
  if (!slide.title) return '';
  const inline = md.renderInline ? md.renderInline(slide.title) : md.render(slide.title).replace(/^<p>|<\/p>\s*$/g, '');
  return `<header class="orz-title"><div class="markdown-body"><h2>${inline}</h2></div></header>`;
}

function footerBand(slide: Slide, deck: DeckConfig, md: Renderer): string {
  // Per-slide @footer always wins (and shows on that slide alone). The deck-wide
  // footer shows on every slide EXCEPT the opening title page, which reads
  // cleaner without it (add a @footer to a title slide to force one).
  const isTitle = slide.kind === 'template' && (slide.template ?? 'title') === 'title';
  const src = slide.footer ?? (isTitle ? undefined : deck.footer);
  if (!src) return '';
  return `<footer class="orz-footer"><div class="markdown-body">${md.render(src)}</div></footer>`;
}

function inlineOr(md: Renderer, s: string): string {
  if (!s) return '';
  return md.renderInline ? md.renderInline(s) : md.render(s).replace(/^<p>|<\/p>\s*$/g, '');
}

/** Split a template body into its title (h1), subtitle (h2), and the rest. */
function splitFields(src: string): { title: string; subtitle: string; meta: string } {
  let title = '';
  let subtitle = '';
  const meta: string[] = [];
  for (const line of src.split('\n')) {
    const h1 = line.match(/^#\s+(.*\S)\s*$/);
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h1 && !title) title = h1[1];
    else if (h2 && !subtitle) subtitle = h2[1];
    else if (line.trim()) meta.push(line);
  }
  return { title, subtitle, meta: meta.join('\n') };
}

function floatBoxes(floats: FloatRegion[], md: Renderer): string {
  return floats.map((f) => {
    const s: string[] = ['position:absolute'];
    const g = f.geom;
    if (g.left) s.push(`left:${g.left}`);
    if (g.right) s.push(`right:${g.right}`);
    if (g.top) s.push(`top:${g.top}`);
    if (g.bottom) s.push(`bottom:${g.bottom}`);
    if (g.w) s.push(`width:${g.w}`);
    if (g.h) s.push(`height:${g.h}`);
    if (g.z != null) s.push(`z-index:${g.z}`);
    return `<div class="orz-float" style="${s.join(';')}"><div class="markdown-body">${md.render(f.markdown)}</div></div>`;
  }).join('');
}

function notesBlock(slide: Slide, md: Renderer): string {
  return slide.notes ? `<aside class="notes">${md.render(slide.notes)}</aside>` : '';
}

function sectionAttrs(slide: Slide, kind: string, template?: string): string {
  const a: string[] = [`class="orz-slide${slide.options.class ? ' ' + escapeAttr(slide.options.class) : ''}"`];
  a.push(`data-fit="${slide.options.fit || 'fit'}"`);
  a.push(`data-kind="${kind}"`);
  if (template) a.push(`data-template="${escapeAttr(template)}"`);
  if (slide.options.id) a.push(`id="${escapeAttr(slide.options.id)}"`);
  if (slide.options.transition) a.push(`data-transition="${escapeAttr(slide.options.transition)}"`);
  if (slide.options.step) a.push(`data-step="1"`);
  if (slide.options.bg) a.push(`data-background-color="${escapeAttr(slide.options.bg)}"`);
  return a.join(' ');
}

function renderNormal(slide: Slide, md: Renderer, deck: DeckConfig): string {
  const { html: grid, regions } = renderLayout(slide.layout);
  const content = fillRegions(grid, regions, regionMap(slide.regions), md);
  return `<section ${sectionAttrs(slide, 'normal')}>`
    + `<div class="orz-frame">`
    + titleBand(slide, md)
    + `<div class="orz-content">${content}</div>`
    + footerBand(slide, deck, md)
    + `</div>`
    + floatBoxes(slide.floats, md)
    + notesBlock(slide, md)
    + `</section>`;
}

function renderTemplate(slide: Slide, md: Renderer, deck: DeckConfig): string {
  const name = slide.template || 'title';
  const v = slide.templateVariant ? ` orz-v${slide.templateVariant}` : '';
  const body = regionMap(slide.regions)['body'] || '';

  let inner: string;
  if (name === 'outline') {
    inner = `<div class="orz-outline markdown-body">${md.render(body)}</div>`;
  } else if (name === 'section') {
    const f = splitFields(body);
    inner = (f.title ? `<div class="orz-section-main">${inlineOr(md, f.title)}</div>` : '')
      + (f.meta ? `<div class="orz-section-meta markdown-body">${md.render(f.meta)}</div>` : '');
  } else {
    // title / closing / unknown → title-style fields (h1 · h2 · meta)
    const f = splitFields(body);
    inner = (f.title ? `<h1 class="orz-title-main">${inlineOr(md, f.title)}</h1>` : '')
      + (f.subtitle ? `<div class="orz-title-sub">${inlineOr(md, f.subtitle)}</div>` : '')
      + (f.meta ? `<div class="orz-title-meta markdown-body">${md.render(f.meta)}</div>` : '');
  }

  return `<section ${sectionAttrs(slide, 'template', name)}>`
    + `<div class="orz-frame">`
    + `<div class="orz-template orz-template-${escapeAttr(name)}${v}">${inner}</div>`
    + footerBand(slide, deck, md)
    + `</div>`
    + floatBoxes(slide.floats, md)
    + notesBlock(slide, md)
    + `</section>`;
}

/** Render one slide to a reveal `<section>`. */
export function renderSlide(slide: Slide, md: Renderer, deck: DeckConfig): string {
  return slide.kind === 'template' ? renderTemplate(slide, md, deck) : renderNormal(slide, md, deck);
}

/** Render a whole deck's slides (joined `<section>`s for `.reveal .slides`). */
export function renderDeck(deck: Deck, md: Renderer): string {
  return deck.slides.map((s) => renderSlide(s, md, deck.config)).join('\n');
}
