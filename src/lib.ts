/**
 * orz-slides — the Node library (the package's main export).
 *
 * Text format 1 (FC-18, kind `slides`): a deck is its text twin
 * (`x.slides.md`); its self-editing file (`x.slides.html`) is
 * `assemble(text)`. Everything here is the isomorphic code of
 * src/assemble.ts and src/deck/ — the same functions the
 * browser bundle runs — except that an inline assembly needs no engine from
 * the caller: it carries this release's browser bundle (src/engine.ts, the
 * copy staged in `dist/` by the build, verified against its `release.json`),
 * so Node writes the bytes the browser writes.
 *
 * 1.0 replaces the 0.x API (`buildSlidesHtml`, `THEME_DEFS`, `selfVersion`,
 * `pkgVersion`, …; FC-09): content (title, theme, ratio, footer, metadata)
 * comes only from the text's header. REBUILD STEP 2: the CLI (`new |
 * assemble | extract | upgrade | inspect | themes` on the kit's
 * `carrier/node`) is rebuild step 7.
 */
import { VERSION as ORZ_MARKDOWN_VERSION } from 'orz-markdown/version';
import { assemble as assembleText, type AssembleOptions } from './assemble.js';
import { engineSource } from './engine.js';

export { extract, readDocument, newDocument, storedText, cdnBundleUrl, BUNDLE_FILE, FORMATS, type AssembleOptions, type NewDocumentOptions, type Extracted, type DocumentInfo, type Kind } from './assemble.js';
export { parseDeck, scanMarkers, TEMPLATES as SLIDE_TEMPLATES, SLIDE_OPTIONS } from './deck/parse.js';
export { deckConfig, RATIOS, SECTION_NUMBERS } from './deck/config.js';
export { parseLayoutSpec, serialiseLayout, expandPreset, slideMarker, PRESETS, PRESET_REGIONS } from './deck/layout-spec.js';
export { THEMES, DEFAULT_THEME, isThemeId, resolveTheme, type SlideTheme } from './themes.js';
export { VERSION } from './version.js';
export { engineSource, engineFiles, type EngineFiles } from './engine.js';
export type { Deck, DeckConfig, Slide, SlideLint, LayoutNode, SplitNode, RegionLeaf, Region, FloatRegion, Span, Ratio } from './types.js';

/** The orz-markdown version this release renders with. */
export { ORZ_MARKDOWN_VERSION };

/** The engine of an inline assembly: the caller's, else this release's bundle. */
const withEngine = <T extends AssembleOptions>(o: T): T =>
  (o.delivery ?? 'inline') === 'inline' && o.engineSource === undefined ? { ...o, engineSource: engineSource() } : o;

/**
 * Assemble the `.slides.html` file of a text (FC-18 §8, FC-19 §2): `inline`
 * (default) carries this release's browser bundle, `cdn` loads it from
 * jsDelivr. Equal to the browser bundle's `OrzCarrier.assemble`.
 */
export function assemble(text: string, options: AssembleOptions = {}): string {
  return assembleText(text, withEngine(options));
}
