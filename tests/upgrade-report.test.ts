/**
 * Closed-loop round A — the upgrade report (claim U.7): every 0.x deck the
 * family has (the legacy fixtures, and — when the sibling checkouts are
 * here — every 0.x `*.slides.html` under Demo/, coursewerk/examples,
 * output/ …) upgrades to a text that shows what 0.x showed, read by the
 * FROZEN 0.8.5 parser (tests/support/upgrade-report.ts). A difference is
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
import { readLegacy, upgrade } from '../src/legacy.js';
import { readDocument } from '../src/assemble.js';
import { parseDeck as parse085 } from './fixtures/legacy/parser-0.8.5/slide-parser.js';
import { upgradeReport } from './support/upgrade-report.js';
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
});
