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
      // `htmlLabels: false` → SVG <text> labels, not <foreignObject> HTML. HTML
      // labels are measured via getBoundingClientRect, which reveal.js's
      // scale-to-fit transform distorts — the label boxes come out ~0-sized and
      // the text is clipped away (diagram draws, labels vanish). SVG text is
      // measured in transform-independent SVG user units, so it renders correctly
      // whatever scale the slide is at.
      w.mermaid.initialize({ startOnLoad: false, htmlLabels: false, flowchart: { htmlLabels: false } });
      // Only run mermaid on diagrams that are actually LAID OUT (visible, non-zero
      // size). reveal.js keeps off-slide sections `display:none`; rendering a
      // mermaid diagram while hidden measures its label text at zero size — the
      // boxes draw but the labels vanish — and mermaid still marks it
      // `data-processed`, so later passes skip it and it never recovers without a
      // reload. Deferring hidden diagrams lets each render correctly once its
      // slide is shown (via the slidechanged + retry passes).
      const pending = Array.prototype.filter.call(
        document.querySelectorAll('.mermaid:not([data-processed])'),
        (el: HTMLElement) => el.offsetWidth > 0 && el.offsetHeight > 0,
      ) as HTMLElement[];
      if (pending.length) {
        const p = w.mermaid.run({ nodes: pending });
        if (p && p.then) p.then(() => fitCurrent()).catch(() => undefined); // re-fit once the SVG lands
      }
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
  fixYouTube();
}

/** YouTube embeds don't reliably play from a local `file://` page: YouTube
 *  validates the embedding origin/referrer, which is null off the filesystem,
 *  so embedding-restricted videos refuse to play. When the deck is opened as a
 *  local file, swap each iframe for a clickable poster that opens the video on
 *  youtube.com (which always plays). Served over http(s) the iframe — which
 *  works there — is left untouched. The wrapper keeps its `data-md`, so
 *  copy-as-Markdown still recovers `{{youtube ...}}`. */
function fixYouTube(): void {
  if (location.protocol !== 'file:') return;
  document.querySelectorAll<HTMLElement>('.youtube-embed').forEach((box) => {
    if ((box as any).__ytFacade) return;
    const iframe = box.querySelector('iframe');
    const src = iframe ? iframe.getAttribute('src') || '' : '';
    const m = src.match(/embed\/([\w-]{6,})/);
    if (!iframe || !m) return;
    (box as any).__ytFacade = true;
    const id = m[1];
    const a = document.createElement('a');
    a.href = 'https://www.youtube.com/watch?v=' + id;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'youtube-facade';
    a.setAttribute('aria-label', 'Play video on YouTube');
    a.style.backgroundImage = "url('https://i.ytimg.com/vi/" + id + "/hqdefault.jpg')";
    a.innerHTML = '<span class="youtube-facade-play" aria-hidden="true"></span>';
    iframe.replaceWith(a);
  });
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

/** Size graphics to fit their region (both dimensions), keeping their aspect
 *  ratio. Font scale-to-fit cannot shrink pixel-sized images or SVGs, so a tall
 *  graphic would otherwise remain clipped even after the surrounding text is
 *  reduced. Charts fill the available box via maintainAspectRatio. */
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
  region.querySelectorAll<HTMLImageElement>('.markdown-body img').forEach((img) => {
    // QR graphics have their own fixed plate/overlay behavior below.
    if (img.closest('.qrcode')) return;
    const fit = () => {
      const av = availFor(region, img);
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      const attrW = Number(img.getAttribute('width')) || 0;
      const attrH = Number(img.getAttribute('height')) || 0;
      const ar = naturalW && naturalH
        ? naturalW / naturalH
        : attrW && attrH
          ? attrW / attrH
          : 1;
      // Explicit Markdown width is an author-supplied maximum, not a command to
      // overflow a smaller region. Unspecified images may use their natural size.
      const preferredW = attrW || naturalW || av.w;
      let w = Math.min(av.w, preferredW);
      let h = w / ar;
      if (h > av.h) { h = av.h; w = h * ar; }
      img.style.width = Math.max(1, Math.floor(w)) + 'px';
      img.style.height = Math.max(1, Math.floor(h)) + 'px';
      img.style.maxWidth = 'none';
    };
    if (img.complete && (img.naturalWidth || img.getAttribute('width'))) {
      fit();
    } else if (!(img as any).__orzFitOnLoad) {
      (img as any).__orzFitOnLoad = true;
      img.addEventListener('load', () => { fit(); fitCurrent(); }, { once: true });
    }
  });
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
    // Graphics need their own box fit before the text scale is measured;
    // otherwise a large fixed-pixel image can force text to the 0.6 floor while
    // remaining oversized itself.
    region.style.removeProperty('--region-scale');
    fitRegionGraphics(region);
    fitRegion(region);
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
  applyFragments(); // tag step-reveal units before reveal counts fragments
}

const refresh = () => {
  enhance();
  // The single-slide editor re-render replaces a section's innerHTML (dropping
  // fragment classes) and syncs before calling refresh — re-tag and re-sync.
  if (applyFragments()) { try { Reveal.sync(); } catch (e) { /* ignore */ } }
  fitCurrent();
};

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

  deckW = W;
  deckH = H;
  Reveal.initialize({
    width: W, height: H, margin: 0.03, minScale: 0.2, maxScale: 4,
    hash: true, controls: true, progress: true, slideNumber: 'c/t',
  });
  window.orzslides.reveal = Reveal;

  // Presenter keybindings (shown in reveal's '?' help): S = speaker view,
  // T = on-deck clock/timer overlay.
  try {
    Reveal.addKeyBinding({ keyCode: 83, key: 'S', description: 'Speaker view' }, openSpeaker);
    Reveal.addKeyBinding({ keyCode: 84, key: 'T', description: 'Toggle timer/clock' }, toggleDeckTimer);
  } catch (e) { /* ignore */ }
  // Keep the speaker window in step with the deck.
  Reveal.on('slidechanged', syncSpeaker);
  Reveal.on('fragmentshown', syncSpeaker);
  Reveal.on('fragmenthidden', syncSpeaker);

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

/* ---------- fragments (step-reveal) ---------- */

/** The reveal-step units inside a region body: list items reveal individually,
 *  other top-level blocks reveal as a whole — in document order. */
function stepUnits(body: HTMLElement): HTMLElement[] {
  const units: HTMLElement[] = [];
  Array.prototype.forEach.call(body.children, (child: HTMLElement) => {
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      Array.prototype.forEach.call(child.children, (li: HTMLElement) => {
        if (li.tagName.toLowerCase() === 'li') units.push(li);
      });
    } else {
      units.push(child);
    }
  });
  return units;
}

/** Tag the content of every `step` slide with reveal's `fragment` class.
 *  Idempotent; returns true if it added any new fragment (so the caller can
 *  re-sync reveal). Manual `{{attrs[.fragment]}}` blocks are left untouched. */
function applyFragments(): boolean {
  let added = false;
  document.querySelectorAll<HTMLElement>('section[data-step] .orz-region .markdown-body').forEach((body) => {
    stepUnits(body).forEach((el) => {
      if (!el.classList.contains('fragment')) { el.classList.add('fragment'); added = true; }
    });
  });
  return added;
}

/* ---------- presenter clock / timer ---------- */

let deckW = 960;
let deckH = 540;
let tickTimer = 0;
let deckTimerEl: HTMLElement | null = null;
let speakerWin: Window | null = null;

const clock = {
  startMs: 0,
  accumMs: 0,
  running: false,
  start(): void { if (!this.running) { this.startMs = Date.now(); this.running = true; } },
  pause(): void { if (this.running) { this.accumMs += Date.now() - this.startMs; this.running = false; } },
  toggle(): void { if (this.running) this.pause(); else this.start(); },
  reset(): void { this.accumMs = 0; this.startMs = Date.now(); },
  elapsed(): number { return this.accumMs + (this.running ? Date.now() - this.startMs : 0); },
};

function pad2(n: number): string { return n < 10 ? '0' + n : '' + n; }
/** Elapsed ms → m:ss (or h:mm:ss past an hour). */
function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
}
function wallClock(): string {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function ensureTick(): void { if (!tickTimer) tickTimer = window.setInterval(updateClocks, 1000); }
function updateClocks(): void {
  const speakerOpen = !!(speakerWin && !speakerWin.closed);
  if (!deckTimerEl && !speakerOpen) { if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; } return; }
  updateDeckTimer();
  if (speakerOpen) {
    const d = speakerWin!.document;
    const set = (id: string, v: string) => { const el = d.getElementById(id); if (el) el.textContent = v; };
    set('sv-clock', wallClock());
    set('sv-timer', fmtElapsed(clock.elapsed()));
    set('sv-ttoggle', clock.running ? 'Pause' : 'Start');
  }
}

function updateDeckTimer(): void {
  if (!deckTimerEl) return;
  deckTimerEl.innerHTML =
    '<span class="orz-timer-clock">' + wallClock() + '</span>' +
    '<span class="orz-timer-elapsed">' + fmtElapsed(clock.elapsed()) + '</span>';
}

/** Toggle the on-deck clock + elapsed-timer overlay (T). */
function toggleDeckTimer(): void {
  if (deckTimerEl) { deckTimerEl.remove(); deckTimerEl = null; return; }
  clock.start();
  deckTimerEl = document.createElement('div');
  deckTimerEl.className = 'orz-timer';
  document.body.appendChild(deckTimerEl);
  updateDeckTimer();
  ensureTick();
}

/* ---------- speaker view (self-contained popup) ---------- */

function topSections(): HTMLElement[] {
  return Array.prototype.slice.call(document.querySelectorAll('.reveal > .slides > section')) as HTMLElement[];
}

/** A scaled, reveal-positioned-neutralised clone of a slide for preview. */
function stageHTML(section: HTMLElement | null): string {
  if (!section) return '<div class="sv-end">— End —</div>';
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('aside.notes').forEach((n) => n.remove());
  clone.classList.add('present');
  clone.removeAttribute('hidden');
  clone.style.cssText = '';
  return '<div class="reveal"><div class="slides">' + clone.outerHTML + '</div></div>';
}

function scaleStage(stage: HTMLElement): void {
  const slides = stage.querySelector('.slides') as HTMLElement | null;
  if (!slides || !stage.clientWidth) return;
  const k = stage.clientWidth / deckW;
  slides.style.transform = 'scale(' + k + ')';
  stage.style.height = deckH * k + 'px';
}

/** Push current/next preview + notes + position into the speaker window. */
function syncSpeaker(): void {
  if (!speakerWin || speakerWin.closed) return;
  const d = speakerWin.document;
  const cur = (Reveal.getCurrentSlide && Reveal.getCurrentSlide()) || null;
  const sections = topSections();
  const idx = cur ? sections.indexOf(cur) : -1;
  const next = idx >= 0 ? sections[idx + 1] || null : null;
  const curEl = d.getElementById('sv-cur');
  const nxtEl = d.getElementById('sv-nxt');
  const notesEl = d.getElementById('sv-notes');
  const posEl = d.getElementById('sv-pos');
  if (curEl) { curEl.innerHTML = stageHTML(cur); scaleStage(curEl); }
  if (nxtEl) { nxtEl.innerHTML = stageHTML(next); scaleStage(nxtEl); }
  if (notesEl) {
    const notes = cur ? cur.querySelector('aside.notes') : null;
    notesEl.innerHTML = notes && notes.innerHTML.trim() ? notes.innerHTML : '<em class="sv-nonotes">No notes for this slide.</em>';
  }
  if (posEl) posEl.textContent = (idx + 1) + ' / ' + sections.length;
}

function speakerDoc(headCss: string): string {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Speaker View — orz-slides</title>'
    + headCss
    + '<style>'
    + '*{box-sizing:border-box}html,body{margin:0;height:100%;background:#16161a;color:#e8e8ea;font:14px/1.45 system-ui,-apple-system,sans-serif}'
    + '.sv-top{display:flex;align-items:center;gap:18px;padding:8px 16px;background:#000;border-bottom:1px solid #2a2a30}'
    + '.sv-clock{font-size:20px;font-variant-numeric:tabular-nums;opacity:.85}'
    + '.sv-tbox{display:flex;align-items:center;gap:8px}.sv-tbox #sv-timer{font-size:22px;font-variant-numeric:tabular-nums;min-width:74px}'
    + '.sv-tbox button{font:inherit;font-size:12px;padding:3px 10px;border:1px solid #4a4a52;background:#23232a;color:#e8e8ea;border-radius:6px;cursor:pointer}.sv-tbox button:hover{background:#30303a}'
    + '.sv-pos{margin-left:auto;font-size:17px;opacity:.8;font-variant-numeric:tabular-nums}'
    + '.sv-main{display:grid;grid-template-columns:1.7fr 1fr;gap:14px;padding:14px;height:calc(100% - 49px)}'
    + '.sv-current{min-height:0;display:flex;flex-direction:column}.sv-side{display:grid;grid-template-rows:auto 1fr;gap:14px;min-height:0}'
    + '.sv-label{font-size:11px;letter-spacing:.09em;text-transform:uppercase;opacity:.5;margin:0 0 5px}'
    + '.sv-stage{position:relative;overflow:hidden;background:#000;border:1px solid #2a2a30;border-radius:7px}'
    + '.sv-stage .reveal{position:static;width:auto;height:auto}'
    + '.sv-stage .slides{position:absolute;left:0;top:0;width:' + deckW + 'px;height:' + deckH + 'px;transform-origin:0 0;margin:0;padding:0;text-align:left}'
    + '.sv-stage .slides>section{position:relative!important;display:block!important;left:0!important;top:0!important;transform:none!important;width:' + deckW + 'px!important;height:' + deckH + 'px!important;opacity:1!important;visibility:visible!important;background:var(--bg,#fff)}'
    + '.sv-stage .fragment{opacity:1!important;visibility:visible!important}'
    + '.sv-notes{background:#fbfbfa;color:#16161a;border-radius:7px;padding:16px 18px;overflow:auto;min-height:0;font-size:16px;line-height:1.5}'
    + '.sv-notes :first-child{margin-top:0}.sv-notes .sv-nonotes{color:#888}'
    + '.sv-end{display:flex;align-items:center;justify-content:center;height:100%;opacity:.45;font-size:18px}'
    + '</style></head><body>'
    + '<div class="sv-top"><div class="sv-clock" id="sv-clock">--:--:--</div>'
    + '<div class="sv-tbox"><span id="sv-timer">0:00</span>'
    + '<button id="sv-ttoggle">Pause</button><button id="sv-treset">Reset</button></div>'
    + '<div class="sv-pos" id="sv-pos">– / –</div></div>'
    + '<div class="sv-main"><div class="sv-current"><div class="sv-label">Current</div><div class="sv-stage" id="sv-cur"></div></div>'
    + '<div class="sv-side"><div><div class="sv-label">Next</div><div class="sv-stage" id="sv-nxt"></div></div>'
    + '<div style="display:flex;flex-direction:column;min-height:0"><div class="sv-label">Notes</div><div class="sv-notes" id="sv-notes"></div></div></div></div>'
    + '</body></html>';
}

/** Open (or focus) the speaker-view popup (S). */
function openSpeaker(): void {
  if (speakerWin && !speakerWin.closed) { speakerWin.focus(); return; }
  const win = window.open('', 'orz-speaker', 'width=1280,height=800');
  if (!win) return;
  speakerWin = win;
  const headCss = Array.prototype.slice
    .call(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n: Element) => n.outerHTML)
    .join('\n');
  win.document.open();
  win.document.write(speakerDoc(headCss));
  win.document.close();

  const d = win.document;
  const tg = d.getElementById('sv-ttoggle');
  const rs = d.getElementById('sv-treset');
  if (tg) tg.addEventListener('click', () => { clock.toggle(); updateClocks(); });
  if (rs) rs.addEventListener('click', () => { clock.reset(); updateClocks(); });
  // Drive the main deck from the speaker window.
  d.addEventListener('keydown', (ev: KeyboardEvent) => {
    const k = ev.key;
    if (k === ' ' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === 'n' || k === 'N') { ev.preventDefault(); Reveal.next(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'p' || k === 'P') { ev.preventDefault(); Reveal.prev(); }
  });
  win.addEventListener('resize', syncSpeaker);

  clock.start();
  ensureTick();
  syncSpeaker();
  win.focus();
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
  openSpeaker,
  toggleTimer: toggleDeckTimer,
  reveal: null,
};
