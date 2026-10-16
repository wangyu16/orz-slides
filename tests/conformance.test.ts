/**
 * Rebuild step 1 — orz-markdown's carrier conformance harness
 * (`orz-markdown/carrier/conformance`, spec/conformance.md) against the REAL
 * orz-slides carrier from day one (claims H.1, H.2; REBUILD §3c step 1,
 * lesson of 3a/3b: "run the conformance harness with a next build from step
 * 1, so kit gaps show before the closed loop"):
 *
 * - `bundle` / `release`: the files the Node library inlines (dist/, staged by
 *   tests/global-setup.ts from the same build as `orz-slides-browser`'s);
 * - `assemble`: the Node library's (`src/lib.ts`: inline carries that bundle);
 * - `create`: `newDocument()` (what "New document" writes);
 * - `editor`: the opened file's own editor — `OrzCarrier.standalone.edit()`,
 *   the Edit button's path; a text other than the file's is mounted with
 *   `OrzCarrier.mountEditor` on the file's context;
 * - `protocols`: the file speaks orz-host-ai@1 and orz-host-include@1 (the
 *   kit's carrier/app);
 * - `next`: this build again with the patch number bumped;
 * - `firstRelease: true`: 1.0 is the first release of text format 1 for
 *   slides; the 0.x `orz-slides-browser` releases are pre-format files
 *   (`#orz-deck`, no `#orz-shell`, no `release.json`), which get `upgrade`, not
 *   an in-file update — `C.update.from-previous` is not applicable.
 *
 * The read view is the step-1 stub until rebuild step 3 (the engine), so
 * this run checks the kit's runtime as the slides kind uses it; at step 2
 * every check passes (C.update.from-previous not applicable). No
 * `allowSkips`: the final `[conformant]` test fails unless all checks ran in
 * real Chrome and passed. Runs as its own vitest project after the others.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_IDS, registerConformance, type CarrierTarget } from 'orz-markdown/carrier/conformance';
import { parseManifest } from 'orz-markdown/carrier/shell';
import { buildBrowser, BUNDLE_FILE } from '../build/bundle.js';
import { assemble, engineFiles, newDocument, VERSION } from '../src/lib.js';
import { OFFLINE_ARGS } from './helpers.js';

type Browser = import('playwright-core').Browser;

/** The next patch version (`0.9.3` → `0.9.4`, `1.0.0-rc.1` → `1.0.0`). */
export const bumpPatch = (v: string): string => {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(v);
  if (!m) throw new Error(`not a version: ${v}`);
  return m[4] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
};

const tmp = mkdtempSync(join(tmpdir(), 'orz-slides-conformance-'));

/** slides-specific texts for the law checks (theme, ratio and the Q3 keys in the header, the legacy meta block, markers in code, a 0.x deck block, every option). */
const SAMPLES: Record<string, string> = {
  presentation: '{{nyml\nkind: document\ncarrier: slides\nuid: doc-sample0000pres01\ntitle: Dark and square\ntheme: nocturne\nratio: 4:3\nlang: de\nslide_numbers: no\nsection_numbers: roman\n}}\n\n<!-- slide template=title -->\n# Überschrift\n\n<!-- slide 2col 3/2 step -->\n## Zwei\n<!-- @right -->\nText.\n',
  'legacy-meta': '{{nyml\nkind: meta\ntitle: An old meta block\nauthor: Someone\n}}\n\n<!-- slide -->\n## Body\n',
  'markers-in-code': '<!-- slide -->\n## Code\n\n```\n<!-- slide quad -->\n<!-- @tl -->\n```\n\n<!-- slide main-side -->\n## Two\n<!-- @side -->\n$e^{i\\pi}+1=0$ and [the next deck](part-2.slides.md)\n',
  'deck-block': '<!-- deck\ntitle: A 0.x deck block\ntheme: neon\n-->\n\n<!-- slide -->\n## Renders nothing\n',
  'unknown-theme': '{{nyml\nkind: document\ntheme: executive\nratio: 21:9\n}}\n\n<!-- slide bogus colour=red -->\nfalls back to the defaults\n',
};

/** The page-side editor driver: the opened file's own editor (FC-19 Editor). */
const EDITOR_DRIVER = `function (text) {
  var C = globalThis.OrzCarrier;
  var app = C && C.standalone;
  if (app && app.getText() === text) return app.edit();
  var el = document.createElement('div');
  el.setAttribute('data-orz-conformance', 'editor');
  el.style.cssText = 'width: 1100px; height: 640px;';
  document.body.appendChild(el);
  return C.mountEditor(el, { text: text });
}`;

let target: CarrierTarget | null = null;

async function makeTarget(): Promise<CarrierTarget> {
  if (target) return target;
  const engine = engineFiles();
  const nextVersion = bumpPatch(VERSION);
  const next = await buildBrowser({ version: nextVersion });
  const nextDir = join(tmp, 'next');
  rmSync(nextDir, { recursive: true, force: true });
  mkdirSync(nextDir, { recursive: true });
  writeFileSync(join(nextDir, BUNDLE_FILE), next.iife, 'utf8');
  writeFileSync(join(nextDir, 'release.json'), next.release, 'utf8');
  target = {
    kind: 'slides',
    version: VERSION,
    bundle: engine.bundle,
    release: engine.release,
    assemble: (text, o) => assemble(text, o),
    create: () => newDocument({ template: 'minimal' }),
    samples: SAMPLES,
    protocols: { ai: true, include: true },
    editor: EDITOR_DRIVER,
    next: { bundle: join(nextDir, BUNDLE_FILE), release: join(nextDir, 'release.json') },
    firstRelease: true,
  };
  return target;
}

async function launch(): Promise<Browser | null> {
  try {
    const { chromium } = await import('playwright-core');
    // --allow-file-access-from-files: the origin-private file system on file: pages (real handles, C.save.copy-elsewhere)
    // offline: no host resolves in any frame (STATUS D-63)
    return await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files', ...OFFLINE_ARGS] });
  } catch {
    return null;
  }
}

const browser = await launch();
const log: string[] = [];
afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
  if (log.length) process.stdout.write(`orz-slides conformance:\n${log.map((l) => `  ${l}`).join('\n')}\n`);
});

describe('the conformance target', () => {
  beforeAll(async () => { await makeTarget(); }, 120_000);

  it('[H.2] the target is the real carrier: the library\'s engine and manifest, its assemble and newDocument, a next build with a higher version, firstRelease', async () => {
    const t = await makeTarget();
    const own = await buildBrowser();
    expect(readFileSync(t.bundle, 'utf8') === own.iife).toBe(true);
    expect(readFileSync(t.release, 'utf8')).toBe(own.release);
    expect(readFileSync(t.bundle, 'utf8') === readFileSync('browser/orz-slides.browser.js', 'utf8')).toBe(true);
    const m = parseManifest(JSON.parse(readFileSync(t.release, 'utf8')), 'slides');
    expect(m?.version).toBe(VERSION);
    const n = parseManifest(JSON.parse(readFileSync(t.next!.release, 'utf8')), 'slides');
    expect(n?.version).toBe(bumpPatch(VERSION));
    expect(bumpPatch('1.2.3')).toBe('1.2.4');
    expect(bumpPatch('1.0.0-rc.1')).toBe('1.0.0');
    // the next build differs from this one only by its version
    expect(readFileSync(t.next!.bundle, 'utf8').split(JSON.stringify(bumpPatch(VERSION))).join('V') === own.iife.split(JSON.stringify(VERSION)).join('V')).toBe(true);
    expect(t.firstRelease).toBe(true);
    expect(t.previous).toBeUndefined();
    const text = await t.create();
    expect(await t.assemble(text)).toBe(assemble(text, { engineSource: own.iife }));
    expect(CHECK_IDS.length).toBe(46);
  });
});

if (!browser) {
  // registerConformance would report every browser check skipped and fail [conformant]: say why instead of failing
  describe.skip('[H.1] orz-slides conformance (needs the installed Chrome)', () => { it('skipped', () => undefined); });
} else {
  registerConformance({ describe, it, beforeAll, afterAll }, () => makeTarget(), {
    title: '[H.1] orz-slides conformance (orz-markdown carrier harness, real Chrome)',
    // two playwright-core type copies while orz-markdown is linked from a checkout; one object at run time
    browser: browser as never,
    log: (line) => log.push(line),
  });
}
