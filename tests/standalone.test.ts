/**
 * Rebuild step 1–2 — the assembled file boots in real Chrome on the kit's
 * `carrier/app` (claims R.1–R.2). The read view is the step-1 STUB (the
 * flattened deck); the engine of step 3 replaces it. The network is closed
 * (only file: loads): the file must boot offline.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/lib.js';
import { VERSION } from '../src/version.js';
import { corpus, launchChrome } from './helpers.js';

const browser = await launchChrome();
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
  it('[R.1] every slides corpus deck boots: OrzCarrier is the slides carrier of this version, the stub read view shows the deck\'s slide titles, the pencil handle is there, no page error', async () => {
    for (const c of corpus('slides')) {
      const { page, ctx, errors } = await open(c.path.replace(/^slides\//, '').replace(/\.md$/, '.html'), assemble(c.text));
      const g = await page.evaluate(() => { const C = (globalThis as unknown as { OrzCarrier: { kind: string; version: string; formats: number[] } }).OrzCarrier; return { kind: C.kind, version: C.version, formats: C.formats }; });
      expect(g).toEqual({ kind: 'slides', version: VERSION, formats: [1] });
      await page.waitForFunction(() => !document.querySelector('#orz-doc .orz-fallback'));
      const h2 = await page.locator('#orz-doc h2').count();
      expect(h2, c.path).toBeGreaterThan(0);
      expect(await page.title(), c.path).toBe(c.derivedTitle);
      expect(await page.getByRole('button', { name: 'Edit and more', exact: true }).count()).toBe(1);
      expect(errors, c.path).toEqual([]);
      await ctx.close();
    }
  });

  it('[R.2] Edit mounts the kit\'s editor on the exact text (clean); Done leaves; the read view follows a header setting (theme)', async () => {
    const text = corpus('slides').find((c) => c.path.endsWith('every-layout.slides.md'))!.text;
    const { page, ctx, errors } = await open('edit.slides.html', assemble(text));
    const got = await page.evaluate(() => {
      const app = (globalThis as unknown as { OrzCarrier: { standalone: { edit(): { getText(): string; isDirty(): boolean } } } }).OrzCarrier.standalone;
      const ed = app.edit();
      return { text: ed.getText(), dirty: ed.isDirty() };
    });
    expect(got.text === text).toBe(true);
    expect(got.dirty).toBe(false);
    await page.evaluate(async () => { await (globalThis as unknown as { OrzCarrier: { standalone: { leave(): Promise<void> } } }).OrzCarrier.standalone.leave(); });
    await page.evaluate(() => (globalThis as unknown as { OrzCarrier: { standalone: { setSetting(c: Record<string, string>): void } } }).OrzCarrier.standalone.setSetting({ theme: 'nocturne' }));
    await page.waitForFunction(() => document.getElementById('orz-view')?.getAttribute('data-orz-theme') === 'nocturne');
    const after = await page.evaluate(() => (globalThis as unknown as { OrzCarrier: { standalone: { getText(): string; isDirty(): boolean } } }).OrzCarrier.standalone.getText());
    expect(after).toContain('theme: nocturne');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
