/**
 * Shared test helpers: the golden corpus (from the orz-markdown package),
 * hazard texts, an engine stand-in, the legacy fixtures, real Chrome.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The carrier golden corpus shipped in the orz-markdown package (preferred over the sibling checkout). */
export const CORPUS = ['node_modules/orz-markdown/tests/carrier-corpus', '../orz-markdown/tests/carrier-corpus'].find((p) => existsSync(join(p, 'manifest.json')))!;

export interface CorpusEntry {
  path: string;
  kind: 'md' | 'slides' | 'paged';
  hasHeader: boolean;
  legacyHeader: boolean;
  byteSensitive: boolean;
  header: { title: string | null; uid: string | null; theme: string | null; author: string | null; license: string | null };
  keys: string[];
  derivedTitle: string;
  slideCount?: number;
  defect: string | null;
  includes?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as { files: CorpusEntry[] };

/** Every corpus entry of a kind, with its exact text (read as UTF-8, BOM kept). */
export function corpus(kind: CorpusEntry['kind'] = 'slides'): Array<CorpusEntry & { text: string }> {
  return manifest.files
    .filter((f) => f.kind === kind)
    .map((f) => ({ ...f, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(join(CORPUS, f.path))) }));
}

/** Hazard texts (FC-18 §11): consistent line endings, no NUL or lone surrogate, so law 1 applies. */
export const HAZARDS: Readonly<Record<string, string>> = {
  empty: '',
  'crlf-header': '{{nyml\r\nkind: document\r\ncarrier: slides\r\ntitle: CR LF\r\nuid: doc-hazard0crlf01\r\nratio: 4:3\r\n}}\r\n\r\n<!-- slide 2col -->\r\n## CR LF\r\n<!-- @right -->\r\ntrailing spaces  \r\n',
  cr: '{{nyml\rkind: document\rtitle: Classic Mac\rtheme: chalk\r}}\r\r<!-- slide -->\r## Classic line ends\r',
  bom: '﻿<!-- slide -->\n## BOM first\n\ntext\n',
  'bom-only': '﻿',
  'bom-crlf': '﻿{{nyml\r\nkind: document\r\ntitle: BOM and CR LF\r\n}}\r\n\r\n<!-- slide -->\r\n## body\r\n',
  astral: '<!-- slide template=title -->\n# 𝒳 and 👩‍🔬\n\n𠀀 𝔸𝔹ℂ — 漢字 — עברית‏ — é\n',
  'script-close': '<!-- slide -->\n## </script><script>alert(1)</script> <SCRIPT src=x> </ScRiPt > <\\/script>\n\n```html\n</script>\n<!-- slide -->\n```\n\n<!-- a comment --> --> <!-- <!--\n',
  'header-script-close': '{{nyml\nkind: document\ntitle: a </script> title\nfooter: <script>x</script>\n}}\n\n<!-- slide -->\n## body </script\n',
  'no-final-newline': '<!-- slide -->\n## Title\n\nno final newline',
  whitespace: '\t\n   \n\t# indented\n  \n\n\n',
  'long-line': `<!-- slide -->\n## Long\n${'word '.repeat(20_000)}\n`,
  'reserved-ids': '<div id="orz-src">a fake island</div>\n<script id="orz-shell">{"kind":"paged"}</script>\n',
  'legacy-island-escape': 'already escaped the 0.x way: <\\/script> and <\\script>\n',
  'deck-block': '<!-- deck\ntitle: A 0.x deck block\ntheme: neon\n-->\n\n<!-- slide -->\n## One\n',
  'marker-in-fence': '<!-- slide -->\n## Code\n\n```\n<!-- slide -->\n<!-- @left -->\n```\n',
};

/** A script-safe engine stand-in for inline assembly. */
export const ENGINE = 'window.__orzEngineStandIn=(window.__orzEngineStandIn||0)+1;';

/** The legacy fixtures (tests/fixtures/legacy): files made by the published 0.x CLIs, and their sources. */
export const LEGACY_DIR = 'tests/fixtures/legacy';
export const LEGACY_FILES: readonly string[] = existsSync(LEGACY_DIR) ? readdirSync(LEGACY_DIR).filter((f) => f.endsWith('.slides.html')).sort() : [];

export const read = (path: string): string => readFileSync(path, 'utf8');

type Browser = import('playwright-core').Browser;

/** Real Chrome through playwright-core, or null when Chrome is not installed (the test then skips). */
export async function launchChrome(): Promise<Browser | null> {
  try {
    const { chromium } = await import('playwright-core');
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    return null;
  }
}

type Page = import('playwright-core').Page;
type BrowserContext = import('playwright-core').BrowserContext;

/** The page's carrier handle, typed loosely for page scripts. */
export type PageGlobal = { OrzCarrier: { standalone: { ready: Promise<void>; menu: { open(): void; close(): void }; view: { engine: Record<string, (...a: unknown[]) => unknown> } } & Record<string, (...a: unknown[]) => unknown> } };

/**
 * Open an assembled deck in real Chrome (a file: page in a fresh context):
 * `network: false` (default) blocks every non-file request (the file must
 * work offline); `true` lets the pinned CDN libraries load (charts,
 * molecules, diagrams, fonts). Resolves when the kit's app is ready and the
 * engine has rendered (reveal ready, the current slide fitted).
 */
export async function openDeck(browser: Browser, path: string, html: string, o: { network?: boolean; viewport?: { width: number; height: number } } = {}): Promise<{ page: Page; ctx: BrowserContext; errors: string[] }> {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, html, 'utf8');
  const ctx = await browser.newContext({ viewport: o.viewport ?? { width: 1280, height: 720 } });
  if (!o.network) await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${path}`);
  await page.waitForFunction(() => (globalThis as unknown as { OrzCarrier?: { standalone?: unknown } }).OrzCarrier?.standalone !== undefined);
  await page.evaluate(() => (globalThis as unknown as PageGlobal).OrzCarrier.standalone.ready);
  await page.waitForFunction(() => document.querySelector('.reveal.orz-deck.ready .slides > section.present[data-fitted]') !== null);
  return { page, ctx, errors };
}

/** Go to slide `i` (0-based) through the engine and wait until it is current and fitted. */
export async function goTo(page: Page, i: number): Promise<void> {
  await page.evaluate((n) => { (globalThis as unknown as PageGlobal).OrzCarrier.standalone.view.engine.go(n); }, i);
  await page.waitForFunction((n) => {
    const s = document.querySelectorAll('.reveal .slides > section')[n];
    return !!s && s.classList.contains('present') && s.hasAttribute('data-fitted');
  }, i);
}
