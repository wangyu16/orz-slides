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
/** Is the active theme dark? (drives the smiles draw scheme) */
function isDarkTheme(): boolean {
  const cfg: any = (window as any).__ORZ_SLIDES__ || {};
  const id = document.documentElement.getAttribute('data-theme') || cfg.defaultTheme;
  const t = (cfg.themes || []).find((x: any) => x.id === id);
  return !!(t && t.scheme === 'dark');
}

function enhance(): void {
  const w = window as any;
  try {
    if (w.mermaid) {
      w.mermaid.initialize({ startOnLoad: false });
      const p = w.mermaid.run({ querySelector: '.mermaid:not([data-processed])' });
      if (p && p.then) p.then(() => fitCurrent()).catch(() => undefined); // re-fit once the SVG lands
    }
  } catch (e) { /* ignore */ }

  try {
    if (w.SmilesDrawer) {
      // 'dark' draws light-coloured bonds/atoms for dark themes. Redraw when the
      // scheme changes (e.g. the user switches to a dark theme in the editor).
      const scheme = isDarkTheme() ? 'dark' : 'light';
      document.querySelectorAll<HTMLCanvasElement>('canvas[data-smiles]').forEach((c) => {
        const cc = c as any;
        // __scheme is set only once a draw succeeds; __pending guards against
        // re-clearing the canvas while a draw for this scheme is in flight.
        if (cc.__scheme === scheme || cc.__pending === scheme) return;
        cc.__pending = scheme;
        if (cc.__ow === undefined) { cc.__ow = c.width; cc.__oh = c.height; }
        c.width = cc.__ow; c.height = cc.__oh;
        const drawer = new w.SmilesDrawer.Drawer({ width: cc.__ow, height: cc.__oh });
        w.SmilesDrawer.parse(c.getAttribute('data-smiles'), (tree: unknown) => {
          try { drawer.draw(tree, c, scheme, false); cc.__scheme = scheme; } catch (e) { /* ignore */ }
          cc.__pending = null;
          fitCurrent();
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
        if (w.Chart.getChart(c)) return; // sized by fitRegionGraphics
        try {
          const cfg = JSON.parse(c.getAttribute('data-chart') || '{}');
          cfg.options = cfg.options || {};
          // Not responsive: Chart.js can't get a definite height through the grid
          // chain, so we size it explicitly to the region in fitRegionGraphics.
          cfg.options.responsive = false;
          cfg.options.maintainAspectRatio = false;
          cfg.options.animation = false;
          new w.Chart(c, cfg);
        } catch (e) { /* ignore */ }
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
    tabs.setAttribute('data-js', '1'); // match orz-markdown's runtime so it doesn't re-init (double bar)
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

/** Size mermaid SVGs to fit their region (both dimensions), keeping the diagram's
 *  aspect ratio. Font scale-to-fit can't shrink an SVG, so a tall flowchart would
 *  otherwise overflow the region. Charts fill the region via maintainAspectRatio. */
/** Space available to a graphic = region width × (region height minus the height
 *  of the OTHER content in its markdown-body) — so a caption and a diagram can
 *  share one region without the diagram overflowing. */
function availFor(region: HTMLElement, graphic: Element): { w: number; h: number } {
  const w = region.clientWidth;
  const mb = graphic.closest('.markdown-body') as HTMLElement | null;
  if (!mb) return { w, h: region.clientHeight };
  let node: Element = graphic;
  while (node.parentElement && node.parentElement !== mb) node = node.parentElement;
  let other = 0;
  Array.prototype.forEach.call(mb.children, (ch: HTMLElement) => {
    if (ch !== node) other += ch.offsetHeight;
  });
  return { w, h: Math.max(40, region.clientHeight - other - 6) };
}

function fitRegionGraphics(region: HTMLElement): void {
  if (!region.clientWidth || !region.clientHeight) return;
  region.querySelectorAll<SVGSVGElement>('.mermaid svg').forEach((svg) => {
    const av = availFor(region, svg);
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const ar = vb && vb.height ? vb.width / vb.height : 1;
    let w = av.w;
    let h = w / ar;
    if (h > av.h) { h = av.h; w = h * ar; }
    svg.style.maxWidth = 'none';
    svg.style.width = Math.floor(w) + 'px';
    svg.style.height = Math.floor(h) + 'px';
  });
  const Chart = (window as any).Chart;
  if (Chart && Chart.getChart) {
    region.querySelectorAll<HTMLCanvasElement>('canvas.orz-chart').forEach((c) => {
      const inst = Chart.getChart(c);
      if (inst) { const av = availFor(region, c); try { inst.resize(av.w, av.h); } catch (e) { /* ignore */ } }
    });
  }
}

/** Fit every region on the currently-shown slide (only it is laid out). */
function fitCurrent(): void {
  const slide: HTMLElement | null = (Reveal.getCurrentSlide && Reveal.getCurrentSlide()) || null;
  if (!slide || slide.getAttribute('data-fit') === 'off') return;
  slide.querySelectorAll<HTMLElement>('.orz-region').forEach((region) => {
    fitRegion(region);
    fitRegionGraphics(region);
  });
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
  // Diagrams/charts finish asynchronously and may settle after the first fit —
  // re-fit several times so their final size is measured into scale-to-fit.
  Reveal.on('slidechanged', () => { enhance(); [80, 500, 1400].forEach((t) => setTimeout(refresh, t)); });
  [200, 700, 1500, 2600].forEach((t) => setTimeout(() => { relayout(); refresh(); }, t));
  window.addEventListener('resize', () => setTimeout(() => { relayout(); fitCurrent(); }, 60));

  // QR code → click to view fullscreen. Capture phase + stopPropagation so this
  // runs BEFORE the embedded orz-markdown runtime's own qr-expand handler (whose
  // .qrcode-overlay geometry lives in common.css, which slides doesn't ship) —
  // otherwise the runtime intercepts the click and opens an unstyled overlay.
  document.addEventListener('click', (e) => {
    const el = e.target as Element;
    const qr = el && el.closest ? el.closest('.qrcode') : null;
    if (!qr) return;
    const svg = qr.querySelector('svg');
    if (!svg) return;
    e.stopPropagation();
    e.preventDefault();
    const overlay = document.createElement('div');
    overlay.className = 'orz-qr-overlay';
    overlay.appendChild(svg.cloneNode(true));
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); close(); } };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  }, true);
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
