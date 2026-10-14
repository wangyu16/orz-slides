/**
 * The assembled file boots in real Chrome on the kit's `carrier/app`
 * (claims R.1–R.2): the read view is the deck (rebuild step 3's engine).
 * The network is closed (only file: loads): the file must boot offline.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { VERSION } from '../src/version.js';
import { corpus, launchChrome } from './helpers.js';

const browser = await launchChrome(); // offline: no host resolves (D-63)
const dir = mkdtempSync(join(tmpdir(), 'orz-slides-standalone-'));
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });
const chrome = browser ? describe : describe.skip;

async function open(name: string, html: string) {
  const path = join(dir, name);
  writeFileSync(path, html, 'utf8');
  const ctx = await browser!.newContext();
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${path}`);
  await page.waitForFunction(() => (globalThis as unknown as { OrzCarrier?: { standalone?: { ready: Promise<void> } } }).OrzCarrier?.standalone !== undefined);
  await page.evaluate(() => (globalThis as unknown as { OrzCarrier: { standalone: { ready: Promise<void> } } }).OrzCarrier.standalone.ready);
  return { page, ctx, errors };
}

chrome('the assembled file (real Chrome, offline)', () => {
  it('[R.1] every slides corpus deck boots: OrzCarrier is the slides carrier of this version, the read view is the deck (one slide per marker, the fallback line gone), the pencil handle is there, no page error', async () => {
    for (const c of corpus('slides')) {
      const { page, ctx, errors } = await open(c.path.replace(/^slides\//, '').replace(/\.md$/, '.html'), assemble(c.text));
      const g = await page.evaluate(() => { const C = (globalThis as unknown as { OrzCarrier: { kind: string; version: string; formats: number[] } }).OrzCarrier; return { kind: C.kind, version: C.version, formats: C.formats }; });
      expect(g).toEqual({ kind: 'slides', version: VERSION, formats: [1] });
      await page.waitForFunction(() => !document.querySelector('#orz-view .orz-fallback') && !!document.querySelector('#orz-view .reveal.ready .slides > section.present'));
      expect(await page.locator('#orz-view .reveal .slides > section.orz-slide').count(), c.path).toBe(c.slideCount);
      expect(await page.title(), c.path).toBe(c.derivedTitle);
      expect(await page.getByRole('button', { name: 'Edit and more', exact: true }).count()).toBe(1);
      expect(errors, c.path).toEqual([]);
      await ctx.close();
    }
  });

  it('[R.2] Edit mounts the kit\'s editor on the exact text (clean) and hides the deck; Done shows it again; the read view follows a header setting (theme)', async () => {
    const text = corpus('slides').find((c) => c.path.endsWith('every-layout.slides.md'))!.text;
    const { page, ctx, errors } = await open('edit.slides.html', assemble(text));
    const got = await page.evaluate(() => {
      const app = (globalThis as unknown as { OrzCarrier: { standalone: { edit(): { getText(): string; isDirty(): boolean } } } }).OrzCarrier.standalone;
      const ed = app.edit();
      return { text: ed.getText(), dirty: ed.isDirty() };
    });
    expect(got.text === text).toBe(true);
    expect(got.dirty).toBe(false);
    expect(await page.evaluate(() => document.getElementById('orz-view')!.hidden)).toBe(true);
    await page.evaluate(async () => { await (globalThis as unknown as { OrzCarrier: { standalone: { leave(): Promise<void> } } }).OrzCarrier.standalone.leave(); });
    expect(await page.evaluate(() => document.getElementById('orz-view')!.hidden)).toBe(false);
    await page.evaluate(() => (globalThis as unknown as { OrzCarrier: { standalone: { setSetting(c: Record<string, string>): void } } }).OrzCarrier.standalone.setSetting({ theme: 'nocturne' }));
    await page.waitForFunction(() => document.getElementById('orz-view')?.getAttribute('data-orz-theme') === 'nocturne');
    const after = await page.evaluate(() => (globalThis as unknown as { OrzCarrier: { standalone: { getText(): string; isDirty(): boolean } } }).OrzCarrier.standalone.getText());
    expect(after).toContain('theme: nocturne');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
