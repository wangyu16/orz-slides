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
  const src = slide.footer ?? deck.footer;
  if (!src) return '';
  return `<footer class="orz-footer"><div class="markdown-body">${md.render(src)}</div></footer>`;
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
  const rmap = regionMap(slide.regions);
  const body = md.render(rmap['body'] || '');
  const v = slide.templateVariant ? ` orz-v${slide.templateVariant}` : '';
  return `<section ${sectionAttrs(slide, 'template', slide.template)}>`
    + `<div class="orz-frame">`
    + `<div class="orz-template orz-template-${escapeAttr(slide.template || 'title')}${v}"><div class="markdown-body">${body}</div></div>`
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
