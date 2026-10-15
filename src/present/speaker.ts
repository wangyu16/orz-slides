/**
 * The presenter's tools: the clock and timer (T: an on-deck overlay) and
 * the speaker view (S: its own window, as in 0.8.5) — the current slide,
 * the next one, the speaker notes, the slide position, the wall clock and
 * the elapsed time with Pause / Reset. The speaker window is an
 * `about:blank` window of this page (same origin): the engine writes its
 * document and updates it directly on every slide or fragment change; keys
 * pressed there drive the deck (the same keys as the read view). Nothing is
 * exchanged by messages, and nothing of the speaker view is saved.
 *
 * The slides it shows are STATIC copies made by the print pipeline
 * (closed-loop round A, ENG-5/6/8: `buildStaticDeck` — charts and molecules
 * frozen to images, every copy fitted, the next slide included); until they
 * are built a copy of the live slide stands in, its drawn canvases copied as
 * images and fitted in the speaker window. The page's stylesheets are synced
 * into the window on every update (a Theme switch shows there too).
 */
import { quietMedia, stillVideos } from './decorate.js';
import { fitSlide } from './fit.js';

/** The elapsed-time clock both views show. */
export class PresenterClock {
  private startMs = 0;
  private accumMs = 0;
  running = false;
  start(): void { if (!this.running) { this.startMs = Date.now(); this.running = true; } }
  pause(): void { if (this.running) { this.accumMs += Date.now() - this.startMs; this.running = false; } }
  toggle(): void { if (this.running) this.pause(); else this.start(); }
  reset(): void { this.accumMs = 0; this.startMs = Date.now(); }
  elapsed(): number { return this.accumMs + (this.running ? Date.now() - this.startMs : 0); }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Elapsed ms → m:ss (h:mm:ss past an hour). */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** The wall clock, hh:mm:ss. */
export function wallClock(d = new Date()): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** What the speaker view reads from the deck. */
export interface SpeakerSource {
  /** The deck's slides (the reveal `<section>`s), in order. */
  slides(): HTMLElement[];
  /** The current slide's index. */
  index(): number;
  /** The logical slide size. */
  size(): { width: number; height: number };
  /** The page's style and stylesheet elements to copy (engine styles, KaTeX, highlight.js). */
  styles(): Element[];
  /** A key pressed in the speaker window (the deck's key handling). */
  key(e: KeyboardEvent): void;
  /** The deck's title (the window's title). */
  title(): string;
  /** The static copy of slide `i` (its section's HTML, enhanced and fitted), when built. */
  copy?(i: number): string | null;
  /** True while the static copy of slide `i` is still being built (the pane waits for it instead of fitting a live copy). */
  pending?(i: number): boolean;
}

const SPEAKER_CSS = [
  '*{box-sizing:border-box}html,body{margin:0;height:100%;background:#16161a;color:#e8e8ea;font:14px/1.45 system-ui,-apple-system,sans-serif;overflow:hidden}',
  '.sv-top{display:flex;align-items:center;gap:18px;padding:8px 16px;background:#000;border-bottom:1px solid #2a2a30}',
  '.sv-clock{font-size:20px;font-variant-numeric:tabular-nums;opacity:.85}',
  '.sv-tbox{display:flex;align-items:center;gap:8px}.sv-tbox .sv-timer{font-size:22px;font-variant-numeric:tabular-nums;min-width:74px}',
  '.sv-tbox button{font:inherit;font-size:12px;padding:3px 10px;border:1px solid #4a4a52;background:#23232a;color:#e8e8ea;border-radius:6px;cursor:pointer}.sv-tbox button:hover{background:#30303a}',
  '.sv-pos{margin-left:auto;font-size:17px;opacity:.8;font-variant-numeric:tabular-nums}',
  '.sv-main{display:grid;grid-template-columns:1.7fr 1fr;gap:14px;padding:14px;height:calc(100% - 49px)}',
  '.sv-current{min-height:0;display:flex;flex-direction:column}.sv-side{display:grid;grid-template-rows:auto 1fr;gap:14px;min-height:0}',
  '.sv-label{font-size:11px;letter-spacing:.09em;text-transform:uppercase;opacity:.5;margin:0 0 5px}',
  '.sv-stage{position:relative;overflow:hidden;background:var(--sl-surround,#000);border:1px solid #2a2a30;border-radius:7px}',
  '.sv-stage>.reveal.orz-print{position:absolute;left:0;top:0;transform-origin:0 0}',
  '.sv-notes{background:#fbfbfa;color:#16161a;border-radius:7px;padding:16px 18px;overflow:auto;min-height:0;font-size:18px;line-height:1.5;flex:1 1 auto}',
  '.sv-notes>:first-child{margin-top:0}.sv-notes .sv-nonotes{color:#888}',
  '.sv-end{display:flex;align-items:center;justify-content:center;height:100%;opacity:.45;font-size:18px}',
].join('\n');

/** The speaker window (one per deck). */
export class SpeakerView {
  private win: Window | null = null;
  private tick = 0;
  constructor(private readonly src: SpeakerSource, private readonly clock: PresenterClock, private readonly page: Window) {}

  isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  /** The speaker window, or null. */
  window(): Window | null {
    return this.isOpen() ? this.win : null;
  }

  /** Open (or focus) the speaker window; null when the browser blocked it. */
  open(): Window | null {
    if (this.isOpen()) { this.win!.focus(); return this.win; }
    const win = this.page.open('', 'orz-slides-speaker', 'width=1280,height=800');
    if (!win) return null;
    this.win = win;
    const d = win.document;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
    d.close();
    d.title = `Speaker view — ${this.src.title()}`;
    this.syncStyles();
    const style = d.createElement('style');
    style.setAttribute('data-sv-own', '');
    style.textContent = SPEAKER_CSS;
    d.head.appendChild(style);
    d.body.innerHTML = '<div class="sv-top"><div class="sv-clock" data-sv="clock">--:--:--</div>'
      + '<div class="sv-tbox"><span class="sv-timer" data-sv="timer">0:00</span>'
      + '<button type="button" data-sv="toggle">Pause</button><button type="button" data-sv="reset">Reset</button></div>'
      + '<div class="sv-pos" data-sv="pos">– / –</div></div>'
      + '<div class="sv-main"><div class="sv-current"><div class="sv-label">Current</div><div class="sv-stage" data-sv="cur"></div></div>'
      + '<div class="sv-side"><div><div class="sv-label">Next</div><div class="sv-stage" data-sv="next"></div></div>'
      + '<div style="display:flex;flex-direction:column;min-height:0"><div class="sv-label">Notes</div><div class="sv-notes" data-sv="notes"></div></div></div></div>';
    d.querySelector('[data-sv="toggle"]')?.addEventListener('click', () => { this.clock.toggle(); this.clocks(); });
    d.querySelector('[data-sv="reset"]')?.addEventListener('click', () => { this.clock.reset(); this.clocks(); });
    d.addEventListener('keydown', (e) => {
      const t = e.target as Element | null;
      if (t && t.closest && t.closest('button')) return;
      this.src.key(e);
    });
    win.addEventListener('resize', () => this.sync());
    this.clock.start();
    this.ensureTick();
    // the panes in a task of their own (the window's stylesheets are parsed there; round A2, A2-ENG-3)
    this.page.setTimeout(() => this.sync(), 0);
    win.focus();
    return win;
  }

  close(): void {
    if (this.isOpen()) this.win!.close();
    this.win = null;
  }

  private ensureTick(): void {
    if (this.tick) return;
    this.tick = this.page.setInterval(() => {
      if (!this.isOpen()) { this.page.clearInterval(this.tick); this.tick = 0; return; }
      this.clocks();
    }, 1000);
  }

  private clocks(): void {
    if (!this.isOpen()) return;
    const d = this.win!.document;
    const set = (k: string, v: string): void => { const el = d.querySelector(`[data-sv="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
    set('clock', wallClock());
    set('timer', fmtElapsed(this.clock.elapsed()));
    set('toggle', this.clock.running ? 'Pause' : 'Start');
  }

  /**
   * The page's stylesheets in the speaker window, kept in step (ENG-8): each
   * copy (`data-sv-style`) follows its source — the same id, text, href and
   * media — new ones are added, gone ones removed. Before the window's own
   * style, so the speaker layout wins.
   */
  private syncStyles(): void {
    if (!this.isOpen()) return;
    const d = this.win!.document;
    const own = d.head.querySelector('style[data-sv-own]');
    const have = Array.from(d.head.querySelectorAll<HTMLElement>('[data-sv-style]'));
    const keep = new Set<Element>();
    this.src.styles().forEach((src, i) => {
      const key = src.id ? `#${src.id}` : `${src.tagName}:${src.getAttribute('href') ?? i}`;
      let copy = have.find((c) => c.getAttribute('data-sv-style') === key && c.tagName === src.tagName) ?? null;
      if (!copy) {
        copy = d.importNode(src, true) as HTMLElement;
        copy.setAttribute('data-sv-style', key);
        d.head.insertBefore(copy, own);
      } else {
        if (src.tagName === 'STYLE' && copy.textContent !== src.textContent) copy.textContent = src.textContent;
        for (const a of ['href', 'media', 'data-theme', 'data-theme-css']) {
          const v = src.getAttribute(a);
          if (v === null) copy.removeAttribute(a);
          else if (copy.getAttribute(a) !== v) copy.setAttribute(a, v);
        }
      }
      keep.add(copy);
    });
    for (const c of have) if (!keep.has(c)) c.remove();
  }

  /** A static, fully revealed copy of a slide, scaled into a stage: the built copy, else the live slide's. */
  private stage(el: Element | null, section: HTMLElement | null, copy: string | null, pending = false): void {
    if (!el) return;
    const d = el.ownerDocument;
    const { width, height } = this.src.size();
    el.textContent = '';
    if (!section) { el.innerHTML = '<div class="sv-end">— End —</div>'; (el as HTMLElement).style.height = `${Math.round(height * ((el as HTMLElement).clientWidth / width))}px`; return; }
    if (!copy && pending) { el.innerHTML = '<div class="sv-end">…</div>'; (el as HTMLElement).style.height = `${Math.round(height * ((el as HTMLElement).clientWidth / width))}px`; return; }
    const root = d.createElement('div');
    root.className = 'reveal orz-deck orz-print';
    const theme = section.closest('[data-orz-theme]')?.getAttribute('data-orz-theme');
    if (theme) root.setAttribute('data-orz-theme', theme);
    root.style.cssText = `--sl-w:${width}px;--sl-h:${height}px;width:${width}px;`;
    const page = d.createElement('div');
    page.className = 'orz-page';
    root.appendChild(page);
    let clone: HTMLElement | null = null;
    if (copy) {
      page.innerHTML = copy;
      clone = page.querySelector<HTMLElement>(':scope > section');
    }
    if (!clone) {
      // the live slide, its drawn canvases as images (a DOM copy carries no pixels: ENG-5)
      clone = d.importNode(section, true) as HTMLElement;
      const live = Array.from(section.querySelectorAll('canvas'));
      Array.from(clone.querySelectorAll('canvas')).forEach((c, k) => {
        const from = live[k];
        if (!from || from.width === 0 || from.height === 0) return;
        try {
          const img = d.createElement('img');
          img.src = from.toDataURL('image/png');
          img.className = from.className;
          img.alt = from.getAttribute('aria-label') ?? '';
          img.style.width = `${from.offsetWidth}px`;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          c.replaceWith(img);
        } catch { /* a tainted canvas stays blank */ }
      });
      clone.removeAttribute('data-fit-settled');
      page.appendChild(clone);
    }
    clone.querySelectorAll('aside.notes').forEach((n) => n.remove());
    quietMedia(clone, true); // a copy never plays (A2-ENG-7)
    clone.removeAttribute('hidden');
    clone.removeAttribute('aria-hidden');
    clone.style.removeProperty('display');
    clone.style.removeProperty('top');
    clone.style.removeProperty('left');
    clone.style.removeProperty('transform');
    stillVideos(clone); // nor loads a player (A3-ENG-5)
    const color = section.getAttribute('data-background-color') ?? section.getAttribute('data-background-gradient');
    if (color) clone.style.background = color;
    const image = section.getAttribute('data-background-image');
    if (image) { clone.style.backgroundImage = `url(${JSON.stringify(image)})`; clone.style.backgroundSize = 'cover'; clone.style.backgroundPosition = 'center'; }
    el.appendChild(root);
    const k = (el as HTMLElement).clientWidth / width || 0.5;
    root.style.transform = `scale(${k})`;
    (el as HTMLElement).style.height = `${Math.round(height * k)}px`;
    // a live copy is fitted here (a slide never shown was never fitted: ENG-6); a built copy already is
    if (!copy) { try { fitSlide(clone); } catch { /* as it is */ } }
  }

  /** Show the current and next slide, the notes and the position. */
  sync(): void {
    if (!this.isOpen()) return;
    const d = this.win!.document;
    const slides = this.src.slides();
    const i = this.src.index();
    const cur = slides[i] ?? null;
    this.syncStyles();
    this.stage(d.querySelector('[data-sv="cur"]'), cur, cur ? this.src.copy?.(i) ?? null : null, this.src.pending?.(i) ?? false);
    this.stage(d.querySelector('[data-sv="next"]'), slides[i + 1] ?? null, slides[i + 1] ? this.src.copy?.(i + 1) ?? null : null, this.src.pending?.(i + 1) ?? false);
    const notesEl = d.querySelector('[data-sv="notes"]');
    if (notesEl) {
      const notes = cur ? cur.querySelector(':scope > aside.notes') : null;
      notesEl.innerHTML = notes && notes.innerHTML.trim() ? notes.innerHTML : '<em class="sv-nonotes">No notes for this slide.</em>';
    }
    const pos = d.querySelector('[data-sv="pos"]');
    if (pos) pos.textContent = `${i + 1} / ${slides.length}`;
    this.clocks();
  }
}

/** The on-deck clock and timer overlay (T). */
export class TimerOverlay {
  private el: HTMLElement | null = null;
  private tick = 0;
  constructor(private readonly clock: PresenterClock, private readonly doc: Document) {}

  isShown(): boolean { return this.el !== null; }

  toggle(): void {
    if (this.el) { this.hide(); return; }
    this.clock.start();
    this.el = this.doc.createElement('div');
    this.el.className = 'orz-timer';
    this.el.setAttribute('role', 'timer');
    this.el.innerHTML = '<span class="orz-timer-clock"></span><span class="orz-timer-elapsed"></span>';
    (this.doc.getElementById('orz-view') ?? this.doc.body).appendChild(this.el);
    this.update();
    const win = this.doc.defaultView;
    if (win && !this.tick) this.tick = win.setInterval(() => this.update(), 1000);
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    if (this.tick) { this.doc.defaultView?.clearInterval(this.tick); this.tick = 0; }
  }

  private update(): void {
    if (!this.el) return;
    (this.el.firstChild as HTMLElement).textContent = wallClock();
    (this.el.lastChild as HTMLElement).textContent = fmtElapsed(this.clock.elapsed());
  }
}

