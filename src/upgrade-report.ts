/**
 * The upgrade report (closed-loop round A, claim U.7; shipped since rebuild
 * step 7, claim I.6: `upgrade --json` and `inspect --json` carry it): what a
 * 0.x text SHOWED — read with the frozen 0.8.5 parser (src/legacy/
 * parser-0.8.5, never edited) — against what its upgraded format-1 text
 * shows (`parseDeck`): slide count, and per slide the title, the speaker
 * notes, the footer, the floats, every region's text, the layout, the
 * template and its variant, the options; and the theme. Whitespace inside
 * texts is collapsed (the renderer collapses it too). A variant 0.x had no
 * look for counts as its first look (FMT-7).
 */
import { parseDeck as parse085 } from './legacy/parser-0.8.5/slide-parser.js';
import { deckTokens, parseDeck, REPAIR_CODES, scanMarkers, TEMPLATES } from './deck/parse.js';
import { DROPPED_THEMES, resolveTheme } from './themes.js';

const norm = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
/** The closer upgrade's repair inserts where 0.x ended a block at the slide's (or region's) end. */
const CLOSER = /^(?:`{3,}|~{3,}|:{3,}|\$\$|-->|<\/(?:script|pre|style|textarea)>|\?>|\]\]>|>)$/;
/** Equal texts — or the upgraded one is the 0.x one plus the closer the repair added (0.x closed it there). */
const same = (a: string | undefined | null, b: string | undefined | null): boolean => {
  // an HTML comment renders nothing (0.x's unclosed one ran to the region's end)
  const shown = (s: string | undefined | null): string => norm((s ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ''));
  const x = shown(a);
  const y = shown(b);
  return x === y || (y.startsWith(`${x} `) && CLOSER.test(y.slice(x.length + 1)));
};

/**
 * The REGISTERED deliberate differences (each a decision, with its reason):
 * - `deck-block-applied` — a deck block 0.x did not read (not the first
 *   thing in the text) is applied by upgrade (owner default 2026-10-13);
 * - `region-joined` — a region filled twice: 0.x showed only the last fill
 *   (the rest silently dropped), 1.0 joins them and says so (`region-twice`
 *   / `duplicate-region`, owner decision 6);
 * - `marker-in-code` — 0.x split at a marker shown in a code fence (or in
 *   another block: a code span, a list item, a directive; STATUS D-47);
 *   1.0 keeps the block — accepted only for the slide that holds it.
 */
export interface UpgradeReport {
  /** Differences no decision explains (must be empty). */
  unexplained: string[];
  /** Differences a registered decision explains: `reason: difference`. */
  accepted: string[];
}

/** 0.x's slide split: every `<!-- slide … -->` anywhere in the text (its `splitSlides`). */
const SPLIT_085 = /<!--\s*slide\b([^>]*?)-->/g;

/**
 * The differences between what 0.x showed and what the upgraded text shows.
 *
 * Slides are ALIGNED by their marker (round A2): 0.x slide j began at the
 * j-th `<!-- slide` of the text, a 1.0 slide at a marker line, and upgrade
 * keeps every marker in order — so each 1.0 slide is paired with the 0.x
 * slide that began at its own marker. A 0.x slide with no 1.0 partner began
 * at a marker 1.0 does not split at; that is the registered `marker-in-code`
 * decision ONLY when the marker sits inside a block of the upgraded text
 * that no hygiene lint calls left open (a fence closed on purpose, an
 * indented code block, a directive, a list item, a code span), and then only
 * the 1.0 slide that holds it may differ from its partner — never the rest
 * of the deck (A2-FMT-2: a fence closed by a later slide's fence was
 * accepted deck-wide).
 */
export function upgradeReport(legacyText: string, upgradedText: string, shownTheme: string): UpgradeReport {
  const o = parse085(legacyText);
  const n = parseDeck(upgradedText);
  const report: UpgradeReport = { unexplained: [], accepted: [] };
  // what explains a difference in this text
  const blocks = scanMarkers(legacyText).filter((m) => m.type === 'deck');
  const unreadBlock = blocks.length > 0 && (blocks.length > 1 || legacyText.slice(0, blocks[0].span.from).replace(/^\ufeff/, '').trim() !== '');
  const theme085 = o.config.theme || shownTheme || 'paper';
  const want = Object.prototype.hasOwnProperty.call(DROPPED_THEMES, theme085) ? DROPPED_THEMES[theme085] : (resolveTheme(theme085) ? resolveTheme(theme085) : 'paper');
  if (resolveTheme(n.config.theme) !== want && n.config.theme !== want) {
    const d = `theme ${theme085} (0.x) -> ${n.config.theme}`;
    (unreadBlock ? report.accepted : report.unexplained).push(unreadBlock ? `deck-block-applied: ${d}` : d);
  }

  // the alignment: the 0.x split points in the upgraded text (after its header), and the 1.0 slide at each
  const text = upgradedText.replace(/\r\n?/g, '\n');
  const bodyFrom = n.slides.length > 0 ? n.slides[0].marker.from : text.length;
  const header = text.slice(0, bodyFrom).lastIndexOf('}}');
  const occ: number[] = [];
  SPLIT_085.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = SPLIT_085.exec(text)) !== null;) if (m.index > header) occ.push(m.index);
  const crlf = upgradedText.length !== text.length;
  const markerFrom = (i: number): [number, number] => {
    const s = n.slides[i];
    if (!crlf) return [s.marker.from, s.marker.to];
    // offsets of the CR LF text → the LF text
    const lf = (at: number): number => at - (upgradedText.slice(0, at).match(/\r\n/g) ?? []).length;
    return [lf(s.marker.from), lf(s.marker.to)];
  };
  const partner = n.slides.map((_, i) => { const [a, b] = markerFrom(i); return occ.findIndex((x) => x >= a && x <= b); });
  if (o.slides.length !== occ.length) report.unexplained.push(`alignment: 0.x has ${o.slides.length} slides but the upgraded text ${occ.length} 0.x split points`);
  // a split 1.0 does not make is marker-in-code when it lies inside a block no hygiene lint calls left open
  const tokens = deckTokens(text);
  const openLeft = n.lint.some((l) => REPAIR_CODES.has(l.code));
  const lineAt = (at: number): number => (text.slice(0, at).match(/\n/g) ?? []).length;
  const inBlock = (at: number): boolean => {
    const line = lineAt(at);
    const lineText = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
    if (/`/.test(lineText)) return true; // a code span
    // round A3: only a block that can SHOW a marker on purpose holds one by choice — a fence, indented code, a
    // plugin block, a list or a blockquote; never an HTML block, a $$ block or a container (no lint there is a
    // gap in the lint, not a choice: A3-FMT-2, A3-FMT-4)
    return tokens.some((t) => t.map && t.level === 0 && t.nesting !== -1 && t.map[0] <= line && line < t.map[1]
      && !/^(?:html_block|math_block|container_.*)$/.test(t.type));
  };
  const affected = new Set<number>(); // 1.0 slides that hold a split 1.0 does not make
  const paired = new Set(partner.filter((j) => j >= 0));
  for (let j = 0; j < occ.length; j++) {
    if (paired.has(j)) continue;
    const holder = partner.reduce((best, pj, i) => (pj >= 0 && pj < j ? i : best), -1);
    if (!openLeft && inBlock(occ[j])) {
      report.accepted.push(`marker-in-code: 0.x slide ${j + 1} began at a marker inside a block`);
      if (holder >= 0) affected.add(holder);
    } else report.unexplained.push(`0.x slide ${j + 1} (a marker on line ${lineAt(occ[j]) + 1} of the upgraded text) is no slide after upgrade`);
  }
  for (let i = 0; i < n.slides.length; i++) if (partner[i] < 0) report.unexplained.push(`slide ${i + 1} after upgrade has no 0.x slide`);

  for (let i = 0; i < n.slides.length; i++) {
    const j = partner[i];
    if (j < 0 || j >= o.slides.length) continue;
    const a = o.slides[j];
    const b = n.slides[i];
    const at = `slide ${i + 1}${j !== i ? ` (0.x ${j + 1})` : ''}`;
    const joined = b.lint.some((l) => l.code === 'region-twice' || l.code === 'duplicate-region');
    const push = (d: string): void => {
      if (affected.has(i)) report.accepted.push(`marker-in-code: ${d}`);
      else if (/ region /.test(d) && joined) report.accepted.push(`region-joined: ${d}`);
      else report.unexplained.push(d);
    };
    if (!same(a.title, b.title)) push(`${at} title ${JSON.stringify(a.title)} -> ${JSON.stringify(b.title)}`);
    if (!same(a.notes, b.notes)) push(`${at} notes ${JSON.stringify(norm(a.notes).slice(0, 40))} -> ${JSON.stringify(norm(b.notes).slice(0, 40))}`);
    if (!same(a.footer, b.footer)) push(`${at} footer differs`);
    if (a.floats.length !== b.floats.length) push(`${at} floats ${a.floats.length} -> ${b.floats.length}`);
    for (let f = 0; f < Math.min(a.floats.length, b.floats.length); f++) {
      if (!same(a.floats[f].markdown, b.floats[f].markdown)) push(`${at} float ${f + 1} text differs`);
    }
    // 0.x showed the LAST fill of a region (its renderer's map); 1.0 joins them (owner decision 6)
    const ra = Object.fromEntries(a.regions.map((r) => [r.name, norm(r.markdown)]));
    const rb = Object.fromEntries(b.regions.map((r) => [r.name, norm(r.markdown)]));
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (!same(ra[key], rb[key])) push(`${at} region ${key}: ${JSON.stringify((ra[key] ?? '').slice(0, 50))} -> ${JSON.stringify((rb[key] ?? '').slice(0, 50))}`);
    }
    if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) push(`${at} layout ${JSON.stringify(a.layout).slice(0, 80)} -> ${JSON.stringify(b.layout).slice(0, 80)}`);
    if ((a.template ?? null) !== (b.template ?? null)) push(`${at} template ${a.template} -> ${b.template}`);
    const va = a.template && a.templateVariant && a.templateVariant <= (TEMPLATES as Record<string, number>)[a.template] ? a.templateVariant : 1;
    if (va !== (b.templateVariant ?? 1)) push(`${at} variant ${va} -> ${b.templateVariant ?? 1}`);
    for (const key of ['bg', 'transition', 'fit', 'class', 'id', 'step'] as const) {
      const x = (a.options as Record<string, unknown>)[key];
      const y = (b.options as Record<string, unknown>)[key];
      if ((x ?? null) !== (y ?? null) && !(key === 'fit' && (x ?? 'fit') === (y ?? 'fit'))) push(`${at} ${key} ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
    }
  }
  return report;
}

/**
 * The report as lines for `notes` (`upgrade` and `inspect`): one line when
 * the upgraded deck shows what 0.8.5 showed, else one line per difference —
 * the registered decisions first named as such.
 */
export function reportNotes(r: UpgradeReport): string[] {
  if (r.unexplained.length === 0 && r.accepted.length === 0) return ['upgrade report: the upgraded deck shows what orz-slides 0.8.5 showed (slides, titles, regions, layouts, notes, footers, floats, slide options, theme)'];
  return [
    ...r.accepted.map((d) => `upgrade report: differs from 0.8.5 by a registered decision — ${d}`),
    ...r.unexplained.map((d) => `upgrade report: differs from what 0.8.5 showed — ${d}`),
  ];
}
