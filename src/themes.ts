/**
 * The slide themes a `slides` document may name in its header `theme` key
 * (FC-18 §5.1; owner decision 5 of REBUILD §3c, 2026-10-13: 14 themes).
 *
 * - Ten are DERIVED from orz-markdown themes (the kit's `orz-markdown/themes`;
 *   the stylesheets are built in rebuild step 4 by scripts/build-themes.ts);
 *   their orz-markdown ids are accepted as aliases (Q5).
 * - Four are the 0.x themes kept and updated (Architect, Chalk, Neon, Paper).
 * - Dropped: Manuscript (light-academic-1) and Trade Book (beige-decent-1) in
 *   favour of Paper (their md ids are aliases of `paper`); the 0.x themes executive, poppy and sage. `upgrade` maps
 *   the dropped 0.x ids (executive → sky, poppy → sticker, sage → orchard,
 *   src/legacy.ts); in a format-1 text they are the kit's `unknown-theme`.
 *
 * Default `orchard` (from orz-markdown's default light-neat-3, Q5).
 * Isomorphic: no Node built-ins.
 */

export type ThemeScheme = 'light' | 'dark';

export interface SlideTheme {
  /** The id the header's `theme` key takes. */
  id: string;
  /** The picker's name. */
  name: string;
  scheme: ThemeScheme;
  /** The orz-markdown theme it is derived from (also accepted as an alias), or null for an updated 0.x theme. */
  derivedFrom: string | null;
}

export const THEMES: readonly SlideTheme[] = Object.freeze(
  [
    { id: 'orchard', name: 'Orchard', scheme: 'light', derivedFrom: 'light-neat-3' },
    { id: 'sky', name: 'Sky', scheme: 'light', derivedFrom: 'light-neat-1' },
    { id: 'stationery', name: 'Stationery', scheme: 'light', derivedFrom: 'light-neat-2' },
    { id: 'preprint', name: 'Preprint', scheme: 'light', derivedFrom: 'light-academic-2' },
    { id: 'small-press', name: 'Small Press', scheme: 'light', derivedFrom: 'beige-decent-2' },
    { id: 'notebook', name: 'Notebook', scheme: 'light', derivedFrom: 'light-playful-1' },
    { id: 'sticker', name: 'Sticker', scheme: 'light', derivedFrom: 'light-playful-2' },
    { id: 'inscription', name: 'Inscription', scheme: 'dark', derivedFrom: 'dark-elegant-1' },
    { id: 'copper', name: 'Copper', scheme: 'dark', derivedFrom: 'dark-elegant-2' },
    { id: 'nocturne', name: 'Nocturne', scheme: 'dark', derivedFrom: 'dark-elegant-3' },
    { id: 'architect', name: 'Architect', scheme: 'light', derivedFrom: null },
    { id: 'chalk', name: 'Chalk', scheme: 'dark', derivedFrom: null },
    { id: 'neon', name: 'Neon', scheme: 'dark', derivedFrom: null },
    { id: 'paper', name: 'Paper', scheme: 'light', derivedFrom: null },
  ].map((t) => Object.freeze(t as SlideTheme)),
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
