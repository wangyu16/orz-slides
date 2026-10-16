/**
 * Closed-loop round A — the upgrade report (claim U.7): every 0.x deck the
 * family has (the legacy fixtures, and — when the sibling checkouts are
 * here — every 0.x `*.slides.html` under Demo/, coursewerk/examples,
 * output/ …) upgrades to a text that shows what 0.x showed, read by the
 * FROZEN 0.8.5 parser (src/upgrade-report.ts). A difference is
 * either one of the registered decisions (deck block applied, region
 * joined, marker in code — each with its reason) or a failure; a deck 0.x
 * read without an error has no error after upgrade.
 *
 * Would have caught FMT-1, FMT-2, FMT-6 and FMT-7 (the auditor's prototype,
 * /tmp/round-a-format/p5.ts).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLegacy, upgrade, upgradeText } from '../src/legacy.js';
import { readDocument } from '../src/assemble.js';
import { parseDeck as parse085 } from '../src/legacy/parser-0.8.5/slide-parser.js';
import { upgradeReport } from '../src/upgrade-report.js';
import { LEGACY_DIR, LEGACY_FILES } from './helpers.js';

const FAMILY = resolve('..');
/** The family's 0.x decks outside this repository (private folders never read). */
function familyDecks(): string[] {
  if (!existsSync(join(FAMILY, 'orz-markdown'))) return [];
  try {
    const out = execFileSync('find', [FAMILY, '-name', '*.slides.html', '-not', '-path', '*/node_modules/*', '-not', '-path', `${FAMILY}/Mis/*`, '-not', '-path', `${FAMILY}/.secrets/*`, '-not', '-path', `${FAMILY}/orz-slides/*`], { encoding: 'utf8', maxBuffer: 1 << 24 });
    return out.split('\n').filter((x) => x !== '');
  } catch { return []; }
}

describe('the upgrade report (real 0.x decks)', () => {
  it('[U.7] every 0.x deck — the fixtures and the family\'s own — upgrades to a text that shows what 0.8.5 showed (slides, titles, notes, footers, floats, regions, layouts, variants, options, theme), but for the registered decisions; no new error', () => {
    const files = [...LEGACY_FILES.map((f) => join(LEGACY_DIR, f)), join(LEGACY_DIR, 'cli-theme/neon-0.8.5.slides.html'), ...familyDecks()];
    let legacy = 0;
    const unexplained: string[] = [];
    const accepted = new Set<string>();
    for (const f of files) {
      const html = readFileSync(f, 'utf8');
      const leg = readLegacy(html);
      if (!leg) continue;
      legacy++;
      const up = upgrade(html, { delivery: 'cdn', uid: 'doc-0000000000' });
      const r = upgradeReport(leg.text, up.text, leg.defaultTheme ?? '');
      for (const d of r.unexplained) unexplained.push(`${f}: ${d}`);
      for (const a of r.accepted) accepted.add(a.split(':')[0]);
      const errors085 = parse085(leg.text).slides.some((s) => s.lint.some((l) => l.level === 'error'));
      if (!errors085) expect(readDocument(up.text).lint.filter((l) => l.level === 'error').map((l) => `${l.code}@${l.line}`), f).toEqual([]);
    }
    expect(unexplained).toEqual([]);
    expect(legacy).toBeGreaterThanOrEqual(LEGACY_FILES.length + 1);
    // the fixtures exercise the decisions the report registers
    expect([...accepted].sort()).toEqual(expect.arrayContaining(['deck-block-applied', 'marker-in-code']));
  }, 120_000);

  /*
   * Round A2: the family's real 0.x decks exercise none of the shapes A2
   * found, so a synthetic 0.x corpus runs through the same oracle; and the
   * oracle accepts `marker-in-code` only for the slide that holds the code
   * (it accepted A2-FMT-2 deck-wide). Each failed on rebuild/1.0@6d3aa97.
   */
  it('[U.7] A2: a synthetic 0.x corpus — a fence left open on every slide, a fence closed by a later slide\'s fence, ::::, $$, <pre>, an open comment, a nested spaced split, @notes:private, `key = value` on a slide marker — upgrades to what 0.8.5 showed', () => {
    let perSlide = '';
    for (let i = 1; i <= 12; i++) perSlide += `<!-- slide -->\n## S${i}\n\`\`\`\ncode ${i}\n\n`;
    const corpus: Record<string, string> = {
      perSlide,
      laterFence: '<!-- slide -->\n## A\n```python\nprint(1)\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n```js\nlet x = 1\n```\n\n<!-- slide -->\n## D\ntext\n',
      laterContainer: '<!-- slide -->\n## A\n::: info\nhello\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n::: warning\nw\n:::\n\n<!-- slide -->\n## D\ntext\n',
      fourColons: '<!-- slide -->\n## A\n:::: cols\n::: col\nx\n:::\n\n<!-- slide -->\n## B\n<!-- @notes -->\nN\n',
      math: '<!-- slide -->\n## A\n$$\nx^2\n\n<!-- slide -->\n## B\n<!-- @notes -->\nN\n',
      pre: '<!-- slide -->\n## A\n<pre>\ncode\n\n<!-- slide -->\n## B\n<!-- @notes -->\nsecret\n',
      comment: '<!-- slide -->\n## A\n<!-- TODO rework this\n\n<!-- slide -->\n## B\ntext\n',
      nestedSplit: '<!-- slide row 1 / 1 { a; col 1 / 2 { b; c } } -->\n## T\n<!-- @a -->\nA\n<!-- @b -->\nB\n<!-- @c -->\nC\n',
      notesPunct: '<!-- slide -->\n## T\n<!-- @notes:private -->\nsecret\n<!-- slide -->\n## U\n<!-- @notes(speaker) -->\ns\n',
      keyEqValue: '<!-- slide template = title V = 3 -->\n# T\n\n<!-- slide t = fade -->\n## U\n',
      codeOnPurpose: '<!-- slide -->\n## How\n```markdown\n<!-- slide 2col -->\n## Inner\n```\n\n<!-- slide -->\n## Next\nn\n',
    };
    for (const [name, src] of Object.entries(corpus)) {
      const up = upgradeText(src, { uid: 'doc-0000000000' });
      const r = upgradeReport(src, up.text, '');
      expect(r.unexplained, name).toEqual([]);
      const errors085 = parse085(src).slides.some((s) => s.lint.some((l) => l.level === 'error'));
      if (!errors085) expect(readDocument(up.text).lint.filter((l) => l.level === 'error').map((l) => `${l.code}@${l.line}`), name).toEqual([]);
    }
  });

  /*
   * Round A3 (final format pass): the shapes A3 found — a raw-text block
   * closed by a DIFFERENT tag, an open comment closed by a multi-line marker
   * — run through the oracle, and the oracle no longer reads "no lint" as
   * "on purpose" for blocks that can never show a marker (an HTML block, a
   * $$ block, a container). Each failed on rebuild/1.0@a9f4ab3.
   */
  it('[U.7] A3: the synthetic 0.x corpus gains a <pre> closed by a later <style>, a <script> closed by a later <pre>, an open comment closed by a multi-line marker, and a callout showing a marker — each upgrades to what 0.8.5 showed', () => {
    const corpus: Record<string, string> = {
      crossTag: '<!-- slide -->\n## A\n<pre>\nascii art\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n<style>\n.c{color:red}\n</style>\n',
      scriptPre: '<!-- slide -->\n## A\n<script>\nlet a\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n<pre>\nx\n</pre>\n',
      multiLine: '<!-- slide -->\n## A\n<!-- TODO rework\n\n<!-- slide\n  bg=#223 -->\n## B\n<!-- @notes -->\nPRIVATE\n',
    };
    for (const [name, src] of Object.entries(corpus)) {
      const up = upgradeText(src, { uid: 'doc-0000000000' });
      const r = upgradeReport(src, up.text, '');
      expect(r.unexplained, name).toEqual([]);
      expect(r.accepted, name).toEqual([]);
      expect(readDocument(up.text).lint.filter((l) => l.level === 'error').map((l) => `${l.code}@${l.line}`), name).toEqual([]);
    }
  });

  it('[U.7] A3: the oracle never accepts marker-in-code for a marker inside an HTML block, a $$ block or a container (no hygiene lint there is a gap in the lint, not a choice)', () => {
    const head = '{{nyml\nkind: document\ntheme: paper\n}}\n\n';
    for (const src of [
      '<!-- slide -->\n## A\n<pre>\nascii art\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n<style>\n.c{color:red}\n</style>\n',
      '<!-- slide -->\n## A\n<!-- TODO rework\n\n<!-- slide\n  bg=#223 -->\n## B\n<!-- @notes -->\nPRIVATE\n',
    ]) {
      // the text as it was (not repaired): every difference unexplained
      expect(upgradeReport(src, head + src, '').accepted.filter((a) => a.startsWith('marker-in-code')), src).toEqual([]);
      expect(upgradeReport(src, head + src, '').unexplained.length, src).toBeGreaterThan(0);
    }
  });

  it('[U.7] A2: the oracle accepts marker-in-code only for the slide that holds the code — an unrepaired fence closed by a later slide\'s fence is unexplained, a deliberate one is accepted', () => {
    const later = '<!-- slide -->\n## A\n```python\nprint(1)\n\n<!-- slide -->\n## B\n<!-- @notes -->\nPRIVATE\n\n<!-- slide -->\n## C\n```js\nlet x = 1\n```\n\n<!-- slide -->\n## D\ntext\n';
    const head = '{{nyml\nkind: document\ntheme: paper\n}}\n\n';
    expect(upgradeReport(later, head + later, '').unexplained.length).toBeGreaterThan(0);
    const purpose = '<!-- slide -->\n## How\n```markdown\n<!-- slide 2col -->\n## Inner\n```\n\n<!-- slide -->\n## Next\nn\n<!-- slide -->\n## Last\nl\n';
    const r = upgradeReport(purpose, head + purpose, '');
    expect(r.unexplained).toEqual([]);
    expect(r.accepted.every((a) => /^marker-in-code: (0\.x slide 2|slide 1 )/.test(a))).toBe(true);
    // a difference on a slide that holds no code is never accepted
    expect(upgradeReport(purpose, head + purpose.replace('## Last\nl', '## Last\nchanged'), '').unexplained).toEqual(['slide 3 (0.x 4) region body: "l" -> "changed"']);
  });
});
