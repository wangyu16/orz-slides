/**
 * NODE ONLY: the layout report of `orz-slides inspect --layout` (REBUILD
 * §3c Q7, rebuild step 7) — an agent's overflow check. The deck is assembled
 * inline with this release's engine and opened in an INSTALLED Chrome
 * (headless, a fresh profile in a temporary folder); every slide is shown in
 * turn, its fit is let SETTLE (the engine's `settled()`, claim F.6), and
 * each box (`.orz-box`: the title band, every region, a template page's
 * body, every float — docs/dom-contract.md) reports its fit scale
 * (`data-scale`, 1 = unscaled, the floor 0.6) and whether its content is
 * cut (`data-clipped`); the footer reports when its one line is cut.
 *
 * No new dependency: Chrome is driven over the DevTools protocol on a pipe
 * (`--remote-debugging-pipe`: NUL-separated JSON on file descriptors 3 and
 * 4). Chrome is found at its usual places, or at `ORZ_SLIDES_CHROME`; when
 * there is none, {@link findChrome} returns null and the CLI refuses with
 * reason `no-browser`.
 *
 * Offline (`offline: true`) every host but the loopback fails to resolve
 * (as the tests run Chrome): the content libraries a deck loads from the web
 * (KaTeX, Mermaid, Chart.js, SMILES, webfonts) are then missing, and their
 * boxes are measured without them — online is the default.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDeck } from './deck/parse.js';
import { presentationOf } from './presentation.js';

/** One box of a slide, as fit left it. */
export interface LayoutBox {
  /** `title` (the title band), a region's name, `template` (a template page's body), `float 1`, `float 2`, … */
  box: string;
  /** The fit scale (`data-scale`): 1 = unscaled; never below the floor 0.6. */
  scale: number;
  /** Content is cut (at the floor, or `fit=off`): `data-clipped`. */
  clipped: boolean;
  /** `fit=scroll` and the box scrolls. */
  scroll: boolean;
}

/** One slide of the report. */
export interface LayoutSlide {
  /** 1-based. */
  slide: number;
  /** Its title (inline Markdown), or the template page's name. */
  title: string;
  /** `title` / `section` / `outline` / `closing`, or null for a normal slide. */
  template: string | null;
  /** `yes`, or `timeout` when the fit did not settle within 10 s (claim F.6). */
  settled: 'yes' | 'timeout';
  boxes: LayoutBox[];
  /** The footer's one line is cut (ellipsized). */
  footerClipped: boolean;
}

/** The layout report. */
export interface LayoutReport {
  /** The Chrome that rendered it (`Chrome/141.0.…`) and its path. */
  browser: { product: string; path: string };
  /** `online` (the default: content libraries and webfonts load from the web) or `offline`. */
  network: 'online' | 'offline';
  theme: string;
  ratio: string;
  /** The logical slide size (height 720). */
  size: { width: number; height: number };
  slides: LayoutSlide[];
  /** Boxes in all; scaled below 1; clipped (and footers cut); the smallest scale. */
  summary: { slides: number; boxes: number; scaled: number; clipped: number; footersClipped: number; minScale: number };
  /** Page errors seen while rendering. */
  errors: string[];
}

/** Where Chrome usually is (Google Chrome, then Chromium), per platform. */
export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') {
    const apps = ['/Applications', ...(env.HOME ? [join(env.HOME, 'Applications')] : [])];
    return apps.flatMap((a) => [join(a, 'Google Chrome.app/Contents/MacOS/Google Chrome'), join(a, 'Chromium.app/Contents/MacOS/Chromium')]);
  }
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter((r): r is string => !!r);
    return roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
}

/**
 * The Chrome to render with: `ORZ_SLIDES_CHROME` when set (null when that
 * path does not exist — it is never second-guessed), else the first of
 * {@link chromeCandidates} that exists; null when there is none.
 */
export function findChrome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const own = env['ORZ_SLIDES_CHROME'];
  if (own !== undefined && own !== '') return existsSync(own) ? own : null;
  return chromeCandidates(platform, env).find((p) => existsSync(p)) ?? null;
}

/** Chrome's resolver answers no host but the loopback: offline in every frame (STATUS D-63). */
const OFFLINE_ARGS = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'];

/** A minimal DevTools-protocol client over Chrome's pipe. */
class Pipe {
  private id = 0;
  private buffer = '';
  private waiting = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private listeners: Array<(method: string, params: Record<string, unknown>, sessionId?: string) => void> = [];
  private closed: Error | null = null;

  constructor(private readonly child: ChildProcess) {
    const out = child.stdio[4] as NodeJS.ReadableStream;
    out.setEncoding('utf8');
    out.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        let msg: { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
        try { msg = JSON.parse(raw); } catch { continue; }
        if (msg.id !== undefined) {
          const w = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          if (w) { if (msg.error) w.fail(new Error(msg.error.message)); else w.ok(msg.result ?? {}); }
        } else if (msg.method) for (const l of this.listeners) l(msg.method, msg.params ?? {}, msg.sessionId);
      }
    });
    const gone = (why: string): void => {
      this.closed = new Error(why);
      for (const w of this.waiting.values()) w.fail(this.closed);
      this.waiting.clear();
    };
    child.on('exit', (code, signal) => gone(`Chrome exited (${signal ?? `code ${code}`})`));
    child.on('error', (e) => gone(`Chrome could not be started: ${e.message}`));
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.id;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      (this.child.stdio[3] as NodeJS.WritableStream).write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(l: (method: string, params: Record<string, unknown>, sessionId?: string) => void): void { this.listeners.push(l); }
}

/** Reject after `ms` with `what`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((_, fail) => { timer = setTimeout(() => fail(new Error(what)), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * The page script: wait for the kit's app and the engine, then show every
 * slide in turn, let its fit settle and read every box. Plain ES2020 (it
 * runs in the page; no imports).
 */
const PAGE_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms, what) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(20); } };
  await until(() => globalThis.OrzCarrier && globalThis.OrzCarrier.standalone, 30000, 'the engine (OrzCarrier)');
  await globalThis.OrzCarrier.standalone.ready;
  await until(() => document.querySelector('.reveal.orz-deck.ready .slides > section.present[data-fitted]'), 30000, 'the first slide');
  const engine = globalThis.OrzCarrier.standalone.view.engine;
  const sections = () => Array.from(document.querySelectorAll('.reveal .slides > section'));
  const out = [];
  const n = sections().length;
  for (let i = 0; i < n; i++) {
    engine.go(i);
    await until(() => { const s = sections()[i]; return !!s && s.classList.contains('present') && s.hasAttribute('data-fitted'); }, 30000, 'slide ' + (i + 1));
    if (typeof engine.settled === 'function') await engine.settled();
    const s = sections()[i];
    let floats = 0;
    const boxes = Array.from(s.querySelectorAll('.orz-box')).map((b) => ({
      box: b.classList.contains('orz-title') ? 'title' : b.classList.contains('orz-float') ? 'float ' + (++floats) : b.classList.contains('orz-region') ? (b.getAttribute('data-region') || 'body') : b.classList.contains('orz-template') ? 'template' : 'box',
      scale: Number(b.getAttribute('data-scale') || '1'),
      clipped: b.hasAttribute('data-clipped'),
      scroll: b.hasAttribute('data-scroll'),
    }));
    const footer = s.querySelector('.orz-footer');
    out.push({ settled: s.getAttribute('data-fit-settled') === 'timeout' ? 'timeout' : 'yes', boxes, footerClipped: !!footer && footer.hasAttribute('data-clipped') });
  }
  return out;
})()`;

/** Options of {@link layoutReport}. */
export interface LayoutOptions {
  /** The Chrome executable ({@link findChrome}). */
  chrome: string;
  /** The folder relative pictures resolve against (the deck text's folder). */
  baseDir: string;
  /** Block every host but the loopback (default false: online). */
  offline?: boolean;
  /** The whole run's limit (default 10 min). */
  timeoutMs?: number;
}

/**
 * Render an assembled file (`html`, of `text`) in Chrome and report every
 * slide's boxes. Throws when Chrome cannot be started or the deck does not
 * render in time.
 */
export async function layoutReport(html: string, text: string, o: LayoutOptions): Promise<LayoutReport> {
  const dir = mkdtempSync(join(tmpdir(), 'orz-slides-layout-'));
  const file = join(dir, 'deck.slides.html');
  // relative pictures resolve against the text's folder
  const base = `<base href="${pathToFileURL(o.baseDir.endsWith('/') ? o.baseDir : `${o.baseDir}/`).href.replace(/"/g, '%22')}">`;
  writeFileSync(file, /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${base}`) : html, 'utf8');
  const p = presentationOf(text);
  const size = p.ratio === '4:3' ? { width: 960, height: 720 } : { width: 1280, height: 720 };
  const args = ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--hide-scrollbars', `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${size.width},${size.height}`, ...(o.offline ? OFFLINE_ARGS : []), 'about:blank'];
  const child = spawn(o.chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  child.stderr?.resume();
  const pipe = new Pipe(child);
  const errors: string[] = [];
  try {
    return await within((async () => {
      const version = await within(pipe.send('Browser.getVersion'), 30_000, `Chrome at ${o.chrome} did not answer`);
      const { targetId } = await pipe.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
      const { sessionId } = await pipe.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
      let loaded: () => void = () => {};
      const load = new Promise<void>((ok) => { loaded = ok; });
      pipe.on((method, params, sid) => {
        if (sid !== sessionId) return;
        if (method === 'Page.loadEventFired') loaded();
        if (method === 'Runtime.exceptionThrown') {
          const d = (params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails;
          errors.push(d?.exception?.description?.split('\n')[0] ?? d?.text ?? 'a page error');
        }
      });
      await pipe.send('Page.enable', {}, sessionId);
      await pipe.send('Runtime.enable', {}, sessionId);
      await pipe.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await pipe.send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
      // the load event can wait long for a stalled webfont; the page script waits for the engine itself
      await within(load, 60_000, 'load').catch(() => {});
      const r = await pipe.send('Runtime.evaluate', { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true }, sessionId) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
      if (r.exceptionDetails) throw new Error(`the deck did not render: ${r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text ?? 'a page error'}`);
      const raw = r.result?.value as Array<Omit<LayoutSlide, 'slide' | 'title' | 'template'>>;
      const deck = parseDeck(text);
      const slides: LayoutSlide[] = raw.map((s, i) => {
        const d = deck.slides[i];
        return { slide: i + 1, title: d?.title ?? (d?.template ? `(${d.template} page)` : ''), template: d?.template ?? null, ...s };
      });
      const boxes = slides.flatMap((s) => s.boxes);
      return {
        browser: { product: String((version as { product?: string }).product ?? 'Chrome'), path: o.chrome },
        network: o.offline ? 'offline' : 'online',
        theme: p.theme.id,
        ratio: p.ratio,
        size,
        slides,
        summary: {
          slides: slides.length,
          boxes: boxes.length,
          scaled: boxes.filter((b) => b.scale < 1).length,
          clipped: boxes.filter((b) => b.clipped).length,
          footersClipped: slides.filter((s) => s.footerClipped).length,
          minScale: boxes.reduce((m, b) => Math.min(m, b.scale), 1),
        },
        errors,
      } satisfies LayoutReport;
    })(), o.timeoutMs ?? 600_000, 'the layout report took too long');
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((ok) => { if (child.exitCode !== null || child.signalCode !== null) ok(); else { child.once('exit', () => ok()); setTimeout(ok, 2000); } });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The layout report's advice: one line per clipped box or cut footer, and per slide whose fit did not settle. */
export function layoutAdvice(r: LayoutReport): string[] {
  const out: string[] = [];
  for (const s of r.slides) {
    const cut = s.boxes.filter((b) => b.clipped);
    if (cut.length > 0) out.push(`slide ${s.slide}${s.title ? ` (${s.title})` : ''}: ${cut.map((b) => b.box).join(', ')} ${cut.length === 1 ? 'is' : 'are'} cut even at the smallest scale (0.6): shorten the text, split the slide, or give the box more room (a wider split ratio, another preset)`);
    if (s.footerClipped) out.push(`slide ${s.slide}: the footer is cut to one line (ellipsized): shorten it`);
    if (s.settled === 'timeout') out.push(`slide ${s.slide}: its fit did not settle within 10 s (content still loading?): its numbers may be provisional`);
  }
  if (r.network === 'offline' && r.slides.length > 0) out.push('rendered offline: math, diagrams, charts, molecules and webfonts that load from the web were not drawn; run without --offline for the deck as the audience sees it');
  return out;
}
