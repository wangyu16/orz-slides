/**
 * The slide themes a `slides` document may name in its header `theme` key
 * (FC-18 §5.1; owner decision 5 of REBUILD §3c, 2026-10-13: 14 themes).
 *
 * - Ten are DERIVED from orz-markdown themes (the kit's `orz-markdown/themes`;
 *   scripts/build-themes.ts builds each from its source theme and its layer);
 *   their orz-markdown ids are accepted as aliases (Q5).
 * - Four are the 0.x themes kept and updated (Architect, Chalk, Neon, Paper):
 *   layers of their own over layers/content.css.
 * - Dropped: Manuscript (light-academic-1) and Trade Book (beige-decent-1) in
 *   favour of Paper (their md ids are aliases of `paper`); the 0.x themes executive, poppy and sage. `upgrade` maps
 *   the dropped 0.x ids (executive → sky, poppy → sticker, sage → orchard,
 *   src/legacy.ts); in a format-1 text they are the kit's `unknown-theme`.
 *
 * Default `orchard` (from orz-markdown's default light-neat-3, Q5).
 * Isomorphic: no Node built-ins.
 */
import { themeInfo } from 'orz-markdown/themes';

export type ThemeScheme = 'light' | 'dark';

export interface SlideTheme {
  /** The id the header's `theme` key takes. */
  id: string;
  /** The picker's name. */
  name: string;
  scheme: ThemeScheme;
  /** The orz-markdown theme it is derived from (also accepted as an alias), or null for an updated 0.x theme. */
  derivedFrom: string | null;
  /** How the theme numbers sections when the header's `section_numbers` does not say (Q3). */
  sectionNumbers: 'plain' | 'roman' | '01' | 'none';
  /** One line for `orz-slides themes` (what the theme looks like). */
  description: string;
  /** (1.1) The slide's page colour, for a picker's swatch (a derived theme: its orz-markdown theme's `paper`). */
  paper: string;
  /** (1.1) The theme's signature colour, for a picker's swatch (a derived theme: its orz-markdown theme's `accent`). */
  accent: string;
}

/** The page and signature colours of the four updated 0.x themes (their layers' `--bg` / `--paper` and `--accent`). */
const OWN_COLOURS: Readonly<Record<string, { paper: string; accent: string }>> = Object.freeze({
  architect: { paper: '#f8fafb', accent: '#2c3e50' },
  chalk: { paper: '#1d2a25', accent: '#ffd663' },
  neon: { paper: '#0a0f10', accent: '#2ef2d0' },
  paper: { paper: '#fbf7ef', accent: '#8d6e63' },
});

export const THEMES: readonly SlideTheme[] = Object.freeze(
  ([
    { id: 'orchard', name: 'Orchard', scheme: 'light', derivedFrom: 'light-neat-3', sectionNumbers: '01', description: 'off-white page, calm green, Bricolage Grotesque headings; the leaf shape' },
    { id: 'sky', name: 'Sky', scheme: 'light', derivedFrom: 'light-neat-1', sectionNumbers: '01', description: 'airy near-white with sky and teal tints, Figtree over Source Sans 3, round dots' },
    { id: 'stationery', name: 'Stationery', scheme: 'light', derivedFrom: 'light-neat-2', sectionNumbers: '01', description: 'warm paper, teal ink, Epilogue over Literata; pen strokes and punched tags' },
    { id: 'preprint', name: 'Preprint', scheme: 'light', derivedFrom: 'light-academic-2', sectionNumbers: '01', description: 'a crisp journal page: Fira Sans over Vollkorn, one navy accent, rules only' },
    { id: 'small-press', name: 'Small Press', scheme: 'light', derivedFrom: 'beige-decent-2', sectionNumbers: '01', description: 'linen stock, Josefin Sans over Cardo, bottle green; round colophon marks' },
    { id: 'notebook', name: 'Notebook', scheme: 'light', derivedFrom: 'light-playful-1', sectionNumbers: '01', description: 'a ruled school exercise book, slips stuck on the page' },
    { id: 'sticker', name: 'Sticker', scheme: 'light', derivedFrom: 'light-playful-2', sectionNumbers: '01', description: 'a dot-grid sketchbook with outlined stickers, Chewy and Patrick Hand' },
    { id: 'inscription', name: 'Inscription', scheme: 'dark', derivedFrom: 'dark-elegant-1', sectionNumbers: '01', description: 'deep navy, Cinzel capitals over Source Serif 4, one blue lozenge' },
    { id: 'copper', name: 'Copper', scheme: 'dark', derivedFrom: 'dark-elegant-2', sectionNumbers: '01', description: 'teal-black, Sora over Vollkorn, copper and violet accents' },
    { id: 'nocturne', name: 'Nocturne', scheme: 'dark', derivedFrom: 'dark-elegant-3', sectionNumbers: '01', description: 'a graphite code editor, Atkinson Hyperlegible over Charis SIL' },
    { id: 'architect', name: 'Architect', scheme: 'light', derivedFrom: null, sectionNumbers: '01', description: 'a drafting sheet: fine grid, title block, dimension lines, Barlow' },
    { id: 'chalk', name: 'Chalk', scheme: 'dark', derivedFrom: null, sectionNumbers: '01', description: 'a green-black chalkboard, Caveat titles, coloured chalk, a wooden tray' },
    { id: 'neon', name: 'Neon', scheme: 'dark', derivedFrom: null, sectionNumbers: '01', description: 'an instrument panel, phosphor cyan on near-black glass, Barlow and JetBrains Mono' },
    { id: 'paper', name: 'Paper', scheme: 'light', derivedFrom: null, sectionNumbers: 'roman', description: 'a finely printed book: brown ink on laid stock, EB Garamond, roman section numbers' },
  ] as Array<Omit<SlideTheme, 'paper' | 'accent'>>).map((t) => {
    // a derived theme shows its orz-markdown theme's colours (the kit's ThemeInfo, 2.5.0); an updated 0.x theme its own
    const c = t.derivedFrom ? themeInfo(t.derivedFrom) : OWN_COLOURS[t.id]!;
    return Object.freeze({ ...t, paper: c.paper, accent: c.accent });
  }),
);

export const DEFAULT_THEME = 'orchard';

/** The 0.x theme ids that 1.0 dropped, and the theme `upgrade` writes instead. */
export const DROPPED_THEMES: Readonly<Record<string, string>> = Object.freeze({ executive: 'sky', poppy: 'sticker', sage: 'orchard' });

/**
 * The orz-markdown themes whose slide themes were dropped in favour of Paper
 * (owner decision 5); their ids are aliases of `paper` (coordinator default
 * 2026-10-13, easy to revert: remove them here), so an md theme id copied
 * into a deck never falls back to the default.
 */
export const PAPER_ALIASES: readonly string[] = Object.freeze(['light-academic-1', 'beige-decent-1']);

/** Alias (an orz-markdown id) → slide theme id. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ...THEMES.filter((t) => t.derivedFrom).map((t) => [t.derivedFrom!, t.id] as [string, string]),
  ...PAPER_ALIASES.map((a) => [a, 'paper'] as [string, string]),
]);

/** Every value the header's `theme` accepts: the ids and their orz-markdown aliases (the lint's list). */
export const THEME_VALUES: readonly string[] = Object.freeze([...THEMES.map((t) => t.id), ...ALIASES.keys()]);

/** The slide theme an id or alias names, or null. */
export function resolveTheme(id: string | undefined | null): SlideTheme | null {
  if (typeof id !== 'string') return null;
  const key = id.trim();
  const canonical = ALIASES.get(key) ?? key;
  return THEMES.find((t) => t.id === canonical) ?? null;
}

/** True for a theme id or alias. */
export function isThemeId(id: unknown): id is string {
  return typeof id === 'string' && resolveTheme(id) !== null;
}

/** The theme an id or alias names, else the default theme. */
export function themeOf(id: string | undefined | null): SlideTheme {
  return resolveTheme(id) ?? resolveTheme(DEFAULT_THEME)!;
}

/**
 * (1.1, STATUS D-95) A CSS `background` for a theme picker's colour dot, as orz-markdown's `themeSwatch`: the slide
 * theme's page colour and its signature colour, split diagonally — every slide theme's dot differs (the chrome
 * cannot read a theme's colours without loading it). An unknown id gets the default theme's.
 */
export function themeSwatch(id: string | null | undefined): string {
  const t = themeOf(id);
  return `linear-gradient(135deg, ${t.paper} 50%, ${t.accent} 50%)`;
}
