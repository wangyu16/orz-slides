/**
 * orz-slides 1.0 — the deck model of text format 1 (FC-18 §7.2, REBUILD §3c).
 *
 * `parseDeck(text)` (src/deck/parse.ts) reads a format-1 `slides` text into a
 * {@link Deck}: the deck config from the FC-18 header (the header IS the deck
 * config), the slides split at top-level `<!-- slide … -->` comment blocks
 * found by the kit's token scanner, and every finding as a lint. Every part
 * carries its position in the text (offsets into the text as given, 1-based
 * lines), so the layout GUI (rebuild step 6) can rewrite marker lines only.
 *
 * Changed from 0.x by design: no `<!-- deck … -->` block (lint `deck-block`),
 * markers only as top-level comment blocks, presets kept as written next to
 * the expanded tree, one region per name (duplicates are merged and an
 * error), positions on everything.
 */
import type { Lint } from 'orz-markdown/carrier';

/** The slide ratios a header's `ratio` takes (FC-18 §5.1; carrier value lint `invalid-value`). */
export type Ratio = '16:9' | '4:3';

/** How the theme numbers sections (Q3): `null` = the theme's own default. */
export type SectionNumbers = 'plain' | 'roman' | '01' | 'none';

/** The deck config: the FC-18 header's slides keys, resolved (defaults filled in; never another source). */
export interface DeckConfig {
  /** Header `title` as written (the `<title>` chain is the kit's, FC-18 §8.1). */
  title?: string;
  /** The slide theme id (an alias resolved; an unknown or absent theme is the default theme). */
  theme: string;
  /** Header `theme` as written, when set. */
  themeAsWritten?: string;
  ratio: Ratio;
  author?: string;
  /** Deck-wide footer (inline Markdown), shown on normal slides unless a slide's `@footer` replaces it. */
  footer?: string;
  /** Default reveal transition. */
  transition?: string;
  /** `slide_numbers` (Q3; a carrier key until the kit registry lists it): default yes, the theme draws them. */
  slideNumbers: boolean;
  /** `progress` (Q3; a carrier key until the kit registry lists it): default yes. */
  progress: boolean;
  /** `section_numbers` (Q3; a carrier key until the kit registry lists it): null = the theme's default. */
  sectionNumbers: SectionNumbers | null;
}

/**
 * A grid track size token, as written in the layout grammar: `2` (= 2fr),
 * `1fr`, `auto`, `30%`, `200px`, `1.5em`, `2rem`. The layout engine
 * normalizes bare numbers to `fr`.
 */
export type Track = string;

/** A layout node is either a split (row/col) or a region leaf. */
export type LayoutNode = SplitNode | RegionLeaf;

export interface SplitNode {
  kind: 'split';
  dir: 'row' | 'col';
  /** One track per child (same length as `children`). */
  tracks: Track[];
  children: LayoutNode[];
}

export interface RegionLeaf {
  kind: 'region';
  /** Region name; filled by a `<!-- @name -->` marker (or, for the first leaf, by the slide's leading text). */
  name: string;
}

/** A span of the text: offsets (`from` inclusive, `to` exclusive) and 1-based lines. */
export interface Span {
  from: number;
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 1-based line of the span's last line. */
  endLine: number;
}

/** A content region: the Markdown that fills one layout leaf. */
export interface Region {
  name: string;
  /** Its Markdown (blank lines around it trimmed; duplicates merged in order). */
  markdown: string;
  /**
   * Where its content comes from, in order: its `<!-- @name -->` marker
   * line(s) and body, or (`marker: null`) the slide's leading text.
   */
  sources: RegionSource[];
}

export interface RegionSource {
  /** The marker line, or null for the slide's leading text (the first leaf's). */
  marker: Span | null;
  /** The body (the lines after the marker up to the next marker or the slide's end); may be empty (`from === to`). */
  body: Span;
}

/** Float geometry (`<!-- @float left=… top=… w=… h=… z=… -->`): CSS lengths as written; z an integer. */
export interface FloatGeom {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  w?: string;
  h?: string;
  z?: number;
}

/** A free-positioned overlay box (`<!-- @float … -->`), outside the grid. Floats are unnamed in 1.0 (identified by order). */
export interface FloatRegion {
  geom: FloatGeom;
  markdown: string;
  /** The float's marker line. */
  marker: Span;
  body: Span;
}

/** Per-slide options from the `<!-- slide … -->` marker (FC-18 §7.2). */
export interface SlideOptions {
  /** Background colour or image URL. */
  bg?: string;
  /** Per-slide transition (`t=`). */
  transition?: string;
  /** Overflow behaviour; default `fit` (scale to fit). */
  fit?: 'fit' | 'scroll' | 'off';
  class?: string;
  id?: string;
  /** Step reveal (the bare `step` flag). */
  step?: boolean;
  /** Outline: the item marked current (Q4); 0 = none; absent = automatic. */
  here?: number;
}

/** A finding about the text: the kit's `Lint` shape, with the command that resolves it when there is one. */
export interface SlideLint extends Lint {
  /** The CLI command that resolves it (e.g. `upgrade` for a `deck-block`). */
  next?: string;
}

export type SlideKind = 'normal' | 'template';

/** The template slides (`template=…`). */
export type TemplateName = 'title' | 'section' | 'outline' | 'closing';

export interface Slide {
  /** 0-based position in the deck. */
  index: number;
  kind: SlideKind;
  /** For `kind: 'template'`. */
  template?: TemplateName;
  /** Template visual variant (`v=`). */
  templateVariant?: number;
  /** Normal slide title: the inline Markdown of the leading h2 (lifted into the title band). */
  title?: string;
  /** The leading h2's span (normal slides with a title). */
  titleSpan?: Span;
  /** The content-area layout, presets expanded (template slides: the single `body` leaf). */
  layout: LayoutNode;
  /** The layout part of the marker as written (a preset with its ratio, a raw split, or ''). */
  layoutSpec: string;
  /** The marker's option tokens as written (`bg=…`, `step`, …), in order. */
  optionTokens: string[];
  /** Content regions in order of first appearance (one per name). */
  regions: Region[];
  /** Float overlays, in declaration order. */
  floats: FloatRegion[];
  /** Slide footer Markdown (`<!-- @footer -->`), replacing the deck footer. */
  footer?: string;
  /** Speaker notes Markdown (`<!-- @notes -->`). */
  notes?: string;
  options: SlideOptions;
  /** Findings for this slide (also in `Deck.lint`). */
  lint: SlideLint[];
  /** The slide's source: from its marker line to the next marker (exclusive), trailing blank lines included. */
  raw: string;
  /** The slide's span (marker line to the line before the next marker, or the text's end). */
  span: Span;
  /** The slide marker's span. */
  marker: Span;
}

export interface Deck {
  config: DeckConfig;
  slides: Slide[];
  /** The text between the header and the first slide marker, when it holds anything (kept; lint `text-before-first-slide`). */
  preamble: Span | null;
  /** Every finding of the body (the header's are the kit's `lintHeader`), in text order. */
  lint: SlideLint[];
}

/** Grid render output of the layout engine (src/layout.ts). */
export interface GridRender {
  /** Grid container HTML; leaves are `<div class="orz-region" data-region="…">`. */
  html: string;
  /** Region names in document order (for the assembler to fill). */
  regions: string[];
}
