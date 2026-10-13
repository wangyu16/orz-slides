/**
 * The deck plan: what the engine's chrome shows on each slide, from the
 * parsed deck alone (REBUILD §3c step 3, Q3, Q4). Pure: no DOM, no clock.
 *
 * - **Number and progress.** Slide `n` of `total` (1-based); `progress` is
 *   `(n - 1) / (total - 1)` (0 on the first slide, 1 on the last; 1 for a
 *   one-slide deck), the `--progress` the bottom slot's bar reads.
 * - **Sections.** Every `template=section` slide opens the next section,
 *   numbered automatically 1, 2, 3 …; each slide belongs to the last section
 *   opened at or before it (none before the first). The label is the number
 *   in the deck's style — header `section_numbers` (`plain` 1, `roman` I,
 *   `01` 01, `none` no label), else the theme's default.
 * - **The outline's current item.** An outline slide marks item `k` when the
 *   next section after it is section `k` (an outline before section 2 marks
 *   item 2); the slide option `here=N` overrides it, `here=0` marks none. An
 *   outline after the last section marks none.
 */
import type { Deck, SectionNumbers, Slide } from '../types.js';

/** Where one slide stands in the deck. */
export interface SlidePlan {
  /** 1-based. */
  n: number;
  total: number;
  /** 0 … 1 (see the module comment). */
  progress: number;
  /** The section this slide belongs to (1-based), or 0 before the first section. */
  section: number;
  /** The section's label in the deck's numbering style ('' for none or no section). */
  sectionLabel: string;
  /** The section's title (plain text of its first heading), '' when none. */
  sectionTitle: string;
  /** Outline slides: the item marked current (1-based), 0 for none. */
  here?: number;
}

/** A number as an upper-case roman numeral (1 … 3999; plain digits outside). */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let rest = n;
  for (const [v, s] of table) while (rest >= v) { out += s; rest -= v; }
  return out;
}

/** A section number in a numbering style. */
export function sectionLabel(n: number, style: SectionNumbers): string {
  if (n < 1 || style === 'none') return '';
  if (style === 'roman') return roman(n);
  if (style === '01') return n < 10 ? `0${n}` : String(n);
  return String(n);
}

/** The plain text of a template slide's first heading (its title field), for the chrome. */
export function sectionTitleOf(slide: Slide): string {
  const body = slide.regions.find((r) => r.name === 'body')?.markdown ?? '';
  const m = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/m.exec(body);
  const raw = m ? m[1] : (body.split('\n').find((l) => l.trim() !== '') ?? '');
  return plainInline(raw);
}

/** Inline Markdown → its plain text, roughly (emphasis, code, links and math marks dropped). */
export function plainInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~^=<>$])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The plan of every slide of a deck; `themeNumbers` is the theme's default numbering style. */
export function planDeck(deck: Deck, themeNumbers: SectionNumbers = '01'): SlidePlan[] {
  const style: SectionNumbers = deck.config.sectionNumbers ?? themeNumbers;
  const total = deck.slides.length;
  // the section each slide opens or belongs to
  let section = 0;
  let title = '';
  const sections: Array<{ section: number; title: string }> = [];
  for (const s of deck.slides) {
    if (s.kind === 'template' && s.template === 'section') {
      section += 1;
      title = sectionTitleOf(s);
    }
    sections.push({ section, title });
  }
  return deck.slides.map((s, i) => {
    const at = sections[i];
    const plan: SlidePlan = {
      n: i + 1,
      total,
      progress: total > 1 ? i / (total - 1) : 1,
      section: at.section,
      sectionLabel: sectionLabel(at.section, style),
      sectionTitle: at.section > 0 ? at.title : '',
    };
    if (s.kind === 'template' && s.template === 'outline') {
      if (s.options.here !== undefined) plan.here = s.options.here;
      else {
        // the next section after this outline
        const next = sections.slice(i + 1).find((x, k) => deck.slides[i + 1 + k].kind === 'template' && deck.slides[i + 1 + k].template === 'section');
        plan.here = next ? next.section : 0;
      }
    }
    return plan;
  });
}
