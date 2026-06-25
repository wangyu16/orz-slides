/**
 * Browser entry for orz-slides — the in-file presentation engine.
 *
 * esbuild bundles this (with orz-markdown, reveal.js, the slide parser, layout
 * engine, and assembler) into a single IIFE, `dist/orz-slides.browser.js`,
 * exposing `window.orzslides`.
 *
 * On boot it reads the embedded deck source from `<script id="orz-deck">`,
 * parses + assembles it into reveal `<section>`s, initialises reveal.js, lazily
 * loads the canvas/diagram enhancers (mermaid / smiles-drawer / Chart.js) that a
 * deck actually uses, and runs the WP6 scale-to-fit pass.
 *
 * Two delivery modes (see cli.ts): `--inline` embeds this bundle in each
 * .slides.html; `--cdn` references a published copy on jsDelivr
 * (package `orz-slides-browser`).
 */
import { md } from 'orz-markdown';
import { parseDeck } from './slide-parser.js';
import { renderDeck, renderSlide } from './render-slide.js';
import Reveal from 'reveal.js';

const VERSION = typeof __ORZSLIDES_VERSION__ !== 'undefined' ? __ORZSLIDES_VERSION__ : '0.0.0';

/* ---------- enhancers (lazy-loaded by presence) ---------- */

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!src) return resolve();
    if (document.querySelector(`script[data-lib="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.setAttribute('data-lib', src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

/** Load only the enhancer libraries the rendered deck needs. */
function loadEnhancers(cfg: OrzSlidesConfig): Promise<unknown> {
  const e = (cfg && cfg.enhancers) || {};
  const jobs: Array<Promise<void>> = [];
  if (e.mermaidJs && document.querySelector('.mermaid')) jobs.push(loadScript(e.mermaidJs));
  if (e.smilesJs && document.querySelector('canvas[data-smiles]')) jobs.push(loadScript(e.smilesJs));
  if (e.chartJs && document.querySelector('canvas.orz-chart')) jobs.push(loadScript(e.chartJs));
  return Promise.all(jobs).catch(() => undefined);
}

/** Draw mermaid diagrams, smiles structures, and charts that haven't been drawn. */
function enhance(): void {
  const w = window as any;
  try {
    if (w.mermaid) {
      w.mermaid.initialize({ startOnLoad: false });
      w.mermaid.run({ querySelector: '.mermaid:not([data-processed])' });
    }
  } catch (e) { /* ignore */ }

  try {
    if (w.SmilesDrawer) {
      document.querySelectorAll<HTMLCanvasElement>('canvas[data-smiles]').forEach((c) => {
        const cc = c as any;
        if (cc.__drawn) return;
        cc.__drawn = true;
        if (cc.__ow === undefined) { cc.__ow = c.width; cc.__oh = c.height; }
        c.width = cc.__ow; c.height = cc.__oh;
        const drawer = new w.SmilesDrawer.Drawer({ width: cc.__ow, height: cc.__oh });
        const scheme = (c.getAttribute('data-smiles-theme') || 'light');
        w.SmilesDrawer.parse(c.getAttribute('data-smiles'), (tree: unknown) => {
          try { drawer.draw(tree, c, scheme, false); } catch (e) { /* ignore */ }
        });
      });
    }
  } catch (e) { /* ignore */ }

  // Charts are responsive to their container, so they must be drawn (or
  // resized) only while their slide is visible — a chart drawn in a hidden
  // (display:none) slide sizes to 0. Scope to the current slide; resize on
  // revisit.
  try {
    if (w.Chart) {
      const present: any = (Reveal.getCurrentSlide && Reveal.getCurrentSlide()) || document;
      present.querySelectorAll('canvas.orz-chart[data-chart]').forEach((c: HTMLCanvasElement) => {
        const existing = w.Chart.getChart(c);
        if (existing) { existing.resize(); return; }
        try { new w.Chart(c, JSON.parse(c.getAttribute('data-chart') || '{}')); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }

  initTabs();
}

/** Wire up `::: tabs` blocks (build the button bar, toggle panels). The
 *  orz-markdown runtime that normally does this isn't bundled into slides. */
function initTabs(): void {
  document.querySelectorAll('.tabs:not([data-js])').forEach((tabs) => {
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>(':scope > .tab'));
    if (!panels.length) return;
    const bar = document.createElement('div');
    bar.className = 'tabs-bar';
    panels.forEach((panel, i) => {
      const btn = document.createElement('button');
      btn.className = 'tabs-bar-btn' + (i === 0 ? ' active' : '');
      btn.textContent = panel.getAttribute('data-label') || 'Tab ' + (i + 1);
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.tabs-bar-btn').forEach((b) => b.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        panel.classList.add('active');
      });
      bar.appendChild(btn);
      if (i === 0) panel.classList.add('active');
    });
    tabs.insertBefore(bar, panels[0]);
    tabs.setAttribute('data-js', '');
  });
}

/* ---------- WP6 scale-to-fit ---------- */

const FIT_FLOOR = 0.6;

function fitRegion(region: HTMLElement): void {
  region.style.removeProperty('--region-scale');
  const content = region.firstElementChild as HTMLElement | null;
  if (!content) return;
  let scale = 1;
  for (let i = 0; i < 12; i++) {
    if (content.scrollHeight <= region.clientHeight + 1 && content.scrollWidth <= region.clientWidth + 1) break;
    scale -= 0.07;
    if (scale < FIT_FLOOR) { scale = FIT_FLOOR; region.style.setProperty('--region-scale', String(scale)); break; }
    region.style.setProperty('--region-scale', String(scale));
  }
  region.setAttribute('data-scale', scale.toFixed(2));
}

/** Fit every region on the currently-shown slide (only it is laid out). */
function fitCurrent(): void {
  const slide: HTMLElement | null = (Reveal.getCurrentSlide && Reveal.getCurrentSlide()) || null;
  if (!slide || slide.getAttribute('data-fit') === 'off') return;
  slide.querySelectorAll<HTMLElement>('.orz-region').forEach(fitRegion);
}

/* ---------- mount ---------- */

/** Read the embedded deck source (single source of truth). */
function deckSource(): string {
  const srcEl = document.getElementById('orz-deck');
  return (srcEl ? srcEl.textContent || '' : '').replace(/^\n/, '').replace(/\n\s*$/, '');
}

/** Assemble a deck source into `.reveal .slides`. */
function assemble(source: string): void {
  const slidesEl = document.querySelector('.reveal .slides');
  if (slidesEl) slidesEl.innerHTML = renderDeck(parseDeck(source), md);
}

const refresh = () => { enhance(); fitCurrent(); };

/** Re-render the whole deck from a (possibly edited) source, then re-sync reveal.
 *  Used by the in-file editor after structural edits. */
function renderAll(source: string): void {
  assemble(source);
  try { Reveal.sync(); } catch (e) { /* ignore */ }
  loadEnhancers((window as any).__ORZ_SLIDES__ || {}).then(refresh);
}

function mount(): void {
  const cfg: OrzSlidesConfig = (window as any).__ORZ_SLIDES__ || {};
  const deck = parseDeck(deckSource());
  assemble(deckSource());

  const ratio = (deck.config.ratio || cfg.ratio || '16:9').split(':').map(Number);
  const W = 960;
  const H = Math.round((W * (ratio[1] || 9)) / (ratio[0] || 16));

  Reveal.initialize({ width: W, height: H, margin: 0.03, minScale: 0.2, maxScale: 4, hash: true, controls: true, progress: true });
  window.orzslides.reveal = Reveal;

  const relayout = () => { try { Reveal.layout(); } catch (e) { /* ignore */ } };
  loadEnhancers(cfg).then(() => { relayout(); refresh(); });
  // Run twice per change: once immediately, once after the slide is laid out so
  // responsive charts size to a real container and fit measures correctly.
  Reveal.on('slidechanged', () => { enhance(); setTimeout(refresh, 60); });
  // Recompute reveal's scale once the inlined CSS/fonts have settled, so the
  // deck fills the screen even if the first layout ran before they loaded.
  [200, 800].forEach((t) => setTimeout(() => { relayout(); refresh(); }, t));
  window.addEventListener('resize', () => setTimeout(fitCurrent, 60));
}

window.orzslides = {
  version: VERSION,
  md,
  parseDeck,
  renderDeck,
  renderSlide,
  mount,
  renderAll,
  refresh,
  reveal: null,
};
