/**
 * orz-slides — shared types (the locked interface for all modules).
 *
 * The parser (WP1) produces a `Deck`; the layout engine (WP2) turns a
 * `LayoutNode` into grid DOM; the assembler (WP5) renders a `Slide` to a reveal
 * `<section>`. These types are the contract — do not change them without
 * updating BUILD-PLAN.md and the affected modules.
 *
 * See DESIGN.md §5 for the authoring syntax these types model, and
 * docs/dom-contract.md for the rendered DOM/CSS contract.
 */

/** Deck-level config from the leading `<!-- deck … -->` block. */
export interface DeckConfig {
  title?: string;
  /** Theme id, e.g. 'paper' | 'executive' | 'neon' … (default chosen by app). */
  theme?: string;
  /** Slide aspect ratio: '16:9' (default) | '4:3'. */
  ratio?: string;
  author?: string;
  /** Deck-wide footer (markdown/text), shown on normal slides unless overridden. */
  footer?: string;
  /** Default reveal transition. */
  transition?: string;
}

/**
 * A grid track size token, as written in the layout grammar:
 *   '2' (= 2fr) · 'auto' · '1fr' · '30%' · '200px'
 * The layout engine normalizes bare numbers to `fr`.
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
  /** Region name; filled by a `<!-- @name -->` marker. Flat + unique per slide. */
  name: string;
}

/** A content region: the markdown that fills one layout leaf. */
export interface Region {
  name: string;
  /** Raw orz-markdown for this region (rendered by the assembler). */
  markdown: string;
}

/** A free-positioned overlay box (`<!-- @float … -->`), outside the grid. */
export interface FloatRegion {
  /** Geometry; values are CSS lengths ('30%', '200px'). z defaults to order. */
  geom: {
    left?: string;
    right?: string;
    top?: string;
    bottom?: string;
    w?: string;
    h?: string;
    z?: number;
  };
  markdown: string;
}

/** Per-slide options from the `<!-- slide … -->` marker. */
export interface SlideOptions {
  /** Background color or image. */
  bg?: string;
  transition?: string;
  /** Overflow behavior; default 'fit' (scale-to-fit). */
  fit?: 'fit' | 'scroll' | 'off';
  class?: string;
  id?: string;
  /** Step-reveal: auto-tag the slide's content as reveal fragments (lists
   *  reveal per-item, other top-level blocks one at a time, in document order). */
  step?: boolean;
}

export interface LintMsg {
  level: 'error' | 'warn';
  message: string;
}

export type SlideKind = 'normal' | 'template';

export interface Slide {
  /** 0-based position in the deck. */
  index: number;
  kind: SlideKind;
  /** For kind==='template': 'title' | 'section' | 'outline' | 'closing'. */
  template?: string;
  /** Template visual variant (from `v=`). */
  templateVariant?: number;
  /**
   * Normal slide title — the markdown of the single leading h2 (without the
   * `## `), auto-lifted into the title band. Undefined if none.
   */
  title?: string;
  /** Content-area layout (normal slides). Template slides carry their own. */
  layout: LayoutNode;
  /** Content regions (by name) parsed from `<!-- @name -->` markers. */
  regions: Region[];
  /** Float overlays (`<!-- @float … -->`), in declaration order. */
  floats: FloatRegion[];
  /** Slide-level footer markdown (`<!-- @footer -->`), overrides deck footer. */
  footer?: string;
  /** Speaker notes markdown (`<!-- @notes -->`). */
  notes?: string;
  options: SlideOptions;
  /** Lint findings (heading rules, unknown regions, etc.). */
  lint: LintMsg[];
  /** Original source text of this slide (for lossless round-trip on save). */
  raw: string;
}

export interface Deck {
  config: DeckConfig;
  slides: Slide[];
}

/* ── Module interfaces (implemented by the work packages) ────────────────── */

/** WP1 — parse a deck source into a `Deck`. */
export type ParseDeck = (source: string) => Deck;

/** WP2 — expand a preset alias (+ optional ratio like '3/2') to a layout tree. */
export type ExpandPreset = (name: string, ratio?: string) => LayoutNode | null;

/** WP2 — render a layout tree to nested grid DOM with empty region cells. */
export interface GridRender {
  /** Grid container HTML; leaves are `<div class="orz-region" data-region="…">`. */
  html: string;
  /** Region names in document order (for the assembler to fill). */
  regions: string[];
}
export type RenderLayout = (node: LayoutNode) => GridRender;
