/**
 * The presenter's tools: the clock and timer (T: an on-deck overlay) and
 * the speaker view (S: its own window, as in 0.8.5) — the current slide,
 * the next one, the speaker notes, the slide position, the wall clock and
 * the elapsed time with Pause / Reset. The speaker window is an
 * `about:blank` window of this page (same origin): the engine writes its
 * document and updates it directly on every slide or fragment change; keys
 * pressed there drive the deck (the same keys as the read view). Nothing is
 * exchanged by messages, and nothing of the speaker view is saved.
 */

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
  '.sv-stage{position:relative;overflow:hidden;background:#000;border:1px solid #2a2a30;border-radius:7px}',
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
    for (const el of this.src.styles()) d.head.appendChild(d.importNode(el, true));
    const style = d.createElement('style');
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
    this.sync();
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

  /** A static, fully revealed copy of a slide, scaled into a stage. */
  private stage(el: Element | null, section: HTMLElement | null): void {
    if (!el) return;
    const d = el.ownerDocument;
    const { width, height } = this.src.size();
    el.textContent = '';
    if (!section) { el.innerHTML = '<div class="sv-end">— End —</div>'; (el as HTMLElement).style.height = `${Math.round(height * ((el as HTMLElement).clientWidth / width))}px`; return; }
    const clone = d.importNode(section, true) as HTMLElement;
    clone.querySelectorAll('aside.notes').forEach((n) => n.remove());
    clone.removeAttribute('hidden');
    clone.removeAttribute('aria-hidden');
    clone.style.removeProperty('display');
    clone.style.removeProperty('top');
    clone.style.removeProperty('left');
    clone.style.removeProperty('transform');
    const color = section.getAttribute('data-background-color');
    if (color) clone.style.background = color;
    const root = d.createElement('div');
    root.className = 'reveal orz-deck orz-print';
    root.style.cssText = `--sl-w:${width}px;--sl-h:${height}px;width:${width}px;`;
    const page = d.createElement('div');
    page.className = 'orz-page';
    page.appendChild(clone);
    root.appendChild(page);
    el.appendChild(root);
    const k = (el as HTMLElement).clientWidth / width || 0.5;
    root.style.transform = `scale(${k})`;
    (el as HTMLElement).style.height = `${Math.round(height * k)}px`;
  }

  /** Show the current and next slide, the notes and the position. */
  sync(): void {
    if (!this.isOpen()) return;
    const d = this.win!.document;
    const slides = this.src.slides();
    const i = this.src.index();
    const cur = slides[i] ?? null;
    this.stage(d.querySelector('[data-sv="cur"]'), cur);
    this.stage(d.querySelector('[data-sv="next"]'), slides[i + 1] ?? null);
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

