/**
 * The deck config IS the FC-18 header (REBUILD §3c, text format 1 for
 * slides): `title theme ratio author footer transition` (FC-18 §5.1, the
 * kit's registry) and the Q3 keys `slide_numbers`, `progress`,
 * `section_numbers`, read with the kit's `readHeader` (the flat nyml reader).
 *
 * The kit's registry lists every one of them (orz-markdown 2.4.0, FC-18 §5.1
 * minor revision: `slide_numbers`, `progress`, `section_numbers`), so the
 * kit's `lintHeader` knows them; their VALUES are this carrier's to check.
 *
 * Carrier value lints (FC-18 §5.1: warnings with codes of their own, never
 * refusing a text): `invalid-value` for a `ratio` other than `16:9` / `4:3`,
 * a `transition` reveal does not have, a `slide_numbers` / `progress` that
 * is not yes or no, a `section_numbers` that is not plain, roman, 01 or none.
 *
 * Isomorphic: no Node built-ins.
 */
import { readHeader, type Header } from 'orz-markdown/carrier';
import type { DeckConfig, Ratio, SectionNumbers, SlideLint } from '../types.js';
import { DEFAULT_THEME, resolveTheme } from '../themes.js';

/** The ratios a deck takes (FC-18 §5.1, REBUILD §3c). */
export const RATIOS: readonly Ratio[] = Object.freeze(['16:9', '4:3'] as Ratio[]);
export const DEFAULT_RATIO: Ratio = '16:9';

/** The section numbering styles (Q3). */
export const SECTION_NUMBERS: readonly SectionNumbers[] = Object.freeze(['plain', 'roman', '01', 'none'] as SectionNumbers[]);

const YES = /^(?:yes|true|on)$/i;
const NO = /^(?:no|false|off)$/i;

/** The reveal transitions a header's `transition` takes. */
export const TRANSITIONS: readonly string[] = Object.freeze(['none', 'fade', 'slide', 'convex', 'concave', 'zoom']);

const own = (o: Record<string, string>, k: string): string | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k].trim() : undefined);

/** The deck config of a text: its header's keys, resolved (only the header decides; never anything else). */
export function deckConfig(text: string): DeckConfig {
  const f = readHeader(text)?.fields ?? {};
  const themeAsWritten = own(f, 'theme');
  const ratio = own(f, 'ratio');
  const sn = own(f, 'slide_numbers');
  const pr = own(f, 'progress');
  const sec = own(f, 'section_numbers');
  const str = (k: string): string | undefined => { const v = own(f, k); return v === undefined || v === '' ? undefined : v; };
  const title = str('title');
  const author = str('author');
  const footer = str('footer');
  const transition = str('transition');
  return {
    ...(title !== undefined ? { title } : {}),
    theme: (resolveTheme(themeAsWritten) ?? resolveTheme(DEFAULT_THEME)!).id,
    ...(themeAsWritten !== undefined && themeAsWritten !== '' ? { themeAsWritten } : {}),
    ratio: (RATIOS as readonly string[]).includes(ratio ?? '') ? (ratio as Ratio) : DEFAULT_RATIO,
    ...(author !== undefined ? { author } : {}),
    ...(footer !== undefined ? { footer } : {}),
    ...(transition !== undefined && TRANSITIONS.includes(transition) ? { transition } : {}),
    slideNumbers: sn === undefined || !NO.test(sn),
    progress: pr === undefined || !NO.test(pr),
    sectionNumbers: sec !== undefined && (SECTION_NUMBERS as readonly string[]).includes(sec) ? (sec as SectionNumbers) : null,
  };
}

/**
 * The carrier's value lints of a slides header (added after the kit's header
 * lint): `invalid-value` warnings for `ratio`, `transition`, `slide_numbers`,
 * `progress` and `section_numbers`. `header` is the text's header when the
 * caller has it (the kit's `readDocument` lint context), else it is read.
 */
export function headerLint(text: string, header: Header | null = readHeader(text)): SlideLint[] {
  const out: SlideLint[] = [];
  if (!header) return out;
  const entryOf = (key: string) => [...header.entries].reverse().find((e) => e.key === key);
  const check = (key: string, ok: (v: string) => boolean, takes: string): void => {
    const v = own(header.fields, key);
    if (v === undefined || ok(v)) return;
    const e = entryOf(key);
    out.push({ level: 'warning', code: 'invalid-value', key, message: `${key}: "${v}" is not a value this carrier takes (${takes})`, ...(e ? { line: e.line, from: e.valueFrom, to: e.to } : {}) });
  };
  check('ratio', (v) => (RATIOS as readonly string[]).includes(v), RATIOS.join(', '));
  check('transition', (v) => TRANSITIONS.includes(v), TRANSITIONS.join(', '));
  check('slide_numbers', (v) => YES.test(v) || NO.test(v), 'yes or no');
  check('progress', (v) => YES.test(v) || NO.test(v), 'yes or no');
  check('section_numbers', (v) => (SECTION_NUMBERS as readonly string[]).includes(v), SECTION_NUMBERS.join(', '));
  return out;
}
