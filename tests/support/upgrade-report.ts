/**
 * The upgrade report (closed-loop round A, claim U.7): what a 0.x text
 * SHOWED — read with the frozen 0.8.5 parser (tests/fixtures/legacy/
 * parser-0.8.5, never edited) — against what its upgraded format-1 text
 * shows (`parseDeck`): slide count, and per slide the title, the speaker
 * notes, the footer, the floats, every region's text, the layout, the
 * template and its variant, the options; and the theme. Whitespace inside
 * texts is collapsed (the renderer collapses it too). A variant 0.x had no
 * look for counts as its first look (FMT-7).
 */
import { parseDeck as parse085 } from '../fixtures/legacy/parser-0.8.5/slide-parser.js';
import { deckTokens, parseDeck, scanMarkers } from '../../src/deck/parse.js';
import { DROPPED_THEMES, resolveTheme } from '../../src/themes.js';
import { TEMPLATES } from '../../src/deck/parse.js';

const norm = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The REGISTERED deliberate differences (each a decision, with its reason):
 * - `deck-block-applied` — a deck block 0.x did not read (not the first
 *   thing in the text) is applied by upgrade (owner default 2026-10-13);
 * - `region-joined` — a region filled twice: 0.x showed only the last fill
 *   (the rest silently dropped), 1.0 joins them and says so (`region-twice`
 *   / `duplicate-region`, owner decision 6);
 * - `marker-in-code` — 0.x split at a marker shown in a code fence
 *   (STATUS D-47); 1.0 keeps the code.
 */
export interface UpgradeReport {
  /** Differences no decision explains (must be empty). */
  unexplained: string[];
  /** Differences a registered decision explains: `reason: difference`. */
  accepted: string[];
}

/** The differences between what 0.x showed and what the upgraded text shows. */
export function upgradeReport(legacyText: string, upgradedText: string, shownTheme: string): UpgradeReport {
  const o = parse085(legacyText);
  const n = parseDeck(upgradedText);
  const report: UpgradeReport = { unexplained: [], accepted: [] };
  // what explains a difference in this text
  const blocks = scanMarkers(legacyText).filter((m) => m.type === 'deck');
  const unreadBlock = blocks.length > 0 && (blocks.length > 1 || legacyText.slice(0, blocks[0].span.from).replace(/^\ufeff/, '').trim() !== '');
  const markerInCode = deckTokens(legacyText).some((t) => (t.type === 'fence' || t.type === 'code_block') && /^ {0,3}<!--\s*(?:slide\b|@\w)/m.test(t.content));
  let slideAt = -1;
  const diffs = {
    push: (d: string): void => {
      const s = slideAt >= 0 ? n.slides[slideAt] : null;
      const joined = !!s && s.lint.some((l) => l.code === 'region-twice' || l.code === 'duplicate-region');
      if (/^theme /.test(d) && unreadBlock) report.accepted.push(`deck-block-applied: ${d}`);
      else if (markerInCode) report.accepted.push(`marker-in-code: ${d}`);
      else if (/ region /.test(d) && joined) report.accepted.push(`region-joined: ${d}`);
      else report.unexplained.push(d);
    },
  };
  const theme085 = o.config.theme || shownTheme || 'paper';
  const want = Object.prototype.hasOwnProperty.call(DROPPED_THEMES, theme085) ? DROPPED_THEMES[theme085] : (resolveTheme(theme085) ? resolveTheme(theme085) : 'paper');
  if (resolveTheme(n.config.theme) !== want && n.config.theme !== want) diffs.push(`theme ${theme085} (0.x) -> ${n.config.theme}`);
  if (o.slides.length !== n.slides.length) diffs.push(`slides ${o.slides.length} -> ${n.slides.length}`);
  const k = Math.min(o.slides.length, n.slides.length);
  for (let i = 0; i < k; i++) {
    slideAt = i;
    const a = o.slides[i];
    const b = n.slides[i];
    const at = `slide ${i + 1}`;
    if (norm(a.title) !== norm(b.title)) diffs.push(`${at} title ${JSON.stringify(a.title)} -> ${JSON.stringify(b.title)}`);
    if (norm(a.notes) !== norm(b.notes)) diffs.push(`${at} notes ${JSON.stringify(norm(a.notes).slice(0, 40))} -> ${JSON.stringify(norm(b.notes).slice(0, 40))}`);
    if (norm(a.footer) !== norm(b.footer)) diffs.push(`${at} footer differs`);
    if (a.floats.length !== b.floats.length) diffs.push(`${at} floats ${a.floats.length} -> ${b.floats.length}`);
    for (let f = 0; f < Math.min(a.floats.length, b.floats.length); f++) {
      if (norm(a.floats[f].markdown) !== norm(b.floats[f].markdown)) diffs.push(`${at} float ${f + 1} text differs`);
    }
    // 0.x showed the LAST fill of a region (its renderer's map); 1.0 joins them (owner decision 6)
    const ra = Object.fromEntries(a.regions.map((r) => [r.name, norm(r.markdown)]));
    const rb = Object.fromEntries(b.regions.map((r) => [r.name, norm(r.markdown)]));
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if ((ra[key] ?? '') !== (rb[key] ?? '')) diffs.push(`${at} region ${key}: ${JSON.stringify((ra[key] ?? '').slice(0, 50))} -> ${JSON.stringify((rb[key] ?? '').slice(0, 50))}`);
    }
    if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) diffs.push(`${at} layout ${JSON.stringify(a.layout).slice(0, 80)} -> ${JSON.stringify(b.layout).slice(0, 80)}`);
    if ((a.template ?? null) !== (b.template ?? null)) diffs.push(`${at} template ${a.template} -> ${b.template}`);
    const va = a.template && a.templateVariant && a.templateVariant <= (TEMPLATES as Record<string, number>)[a.template] ? a.templateVariant : 1;
    if (va !== (b.templateVariant ?? 1)) diffs.push(`${at} variant ${va} -> ${b.templateVariant ?? 1}`);
    for (const key of ['bg', 'transition', 'fit', 'class', 'id', 'step'] as const) {
      const x = (a.options as Record<string, unknown>)[key];
      const y = (b.options as Record<string, unknown>)[key];
      if ((x ?? null) !== (y ?? null) && !(key === 'fit' && (x ?? 'fit') === (y ?? 'fit'))) diffs.push(`${at} ${key} ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
    }
  }
  return report;
}
