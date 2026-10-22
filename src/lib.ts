/**
 * orz-slides — the Node library (the package's main export).
 *
 * Text format 1 (FC-18, kind `slides`): a deck is its text twin
 * (`x.slides.md`); its self-editing file (`x.slides.html`) is
 * `assemble(text)`. Everything here is the isomorphic code of
 * src/assemble.ts, src/deck/ and src/legacy.ts — the same functions the
 * browser bundle runs — except that an inline assembly needs no engine from
 * the caller: it carries this release's browser bundle (src/engine.ts, the
 * copy staged in `dist/` by the build, verified against its `release.json`),
 * so Node writes the bytes the browser writes.
 *
 * 1.0 replaces the 0.x API (`buildSlidesHtml`, `THEME_DEFS`, `selfVersion`,
 * `pkgVersion`, …; FC-09): content (title, theme, ratio, footer, metadata)
 * comes only from the text's header, and a new text comes from
 * `newDocument({ template })`. For apps and agents the library also exports
 * the deck parser (`parseDeck`), the layout ops the per-slide editor uses
 * (`applyOp`, `slideMap`, … — src/layout-ops.ts: one op → minimal text edits
 * on marker lines), `inspect` (and, Node only, `inspectLayout`: the fit
 * report of a deck rendered in an installed Chrome) and the upgrade report
 * (`upgradeReport`: what an upgraded 0.x deck shows against what 0.8.5
 * showed). The CLI (`src/cli.ts`, rebuild step 7) is built on these and on
 * the kit's `orz-markdown/carrier/node`.
 */
import { VERSION as ORZ_MARKDOWN_VERSION } from 'orz-markdown/version';
import { assemble as assembleText, readDocument, type AssembleOptions } from './assemble.js';
import { upgrade as upgradeFile, type UpgradeOptions, type UpgradeResult } from './legacy.js';
import { inspect as inspectInput, type InspectOptions, type InspectReport } from './inspect.js';
import { findChrome, layoutReport, type LayoutReport } from './layout-report.js';
import { engineSource } from './engine.js';

export { extract, readDocument, newDocument, storedText, cdnBundleUrl, BUNDLE_FILE, FORMATS, type AssembleOptions, type NewDocumentOptions, type Extracted, type DocumentInfo, type Kind } from './assemble.js';
export { readLegacy, upgradeText, extractLegacy, type LegacyFile, type UpgradeResult, type UpgradeOptions, type TextUpgrade, type UpgradeTextOptions } from './legacy.js';
export { upgradeReport, reportNotes, type UpgradeReport } from './upgrade-report.js';
export { browserName, upgradeTextName, type InspectReport, type InspectOptions } from './inspect.js';
export { findChrome, chromeCandidates, layoutAdvice, type LayoutReport, type LayoutSlide, type LayoutBox } from './layout-report.js';
export { TEMPLATES, DEFAULT_TEMPLATE, TEMPLATE_IDS, type TemplateInfo } from './starters.js';
export { parseDeck, scanMarkers, TEMPLATES as SLIDE_TEMPLATES, SLIDE_OPTIONS } from './deck/parse.js';
export { planDeck, type SlidePlan } from './deck/plan.js';
export {
  applyOp, applyEdits, slideMap, partAt, blockingProblem, placeFloat, floatBox, presetOf, snapTracks, stepTracks, nameProblem, freshName,
  LayoutOpError, PRESET_CHOICES, PRESET_LABEL, TEMPLATE_LABEL, SLIDE_SIZE,
  type LayoutOp, type OpResult, type TextEdit, type FloatBox, type PresetChoice, type SlideOptionChanges, type SlideMap, type Range,
} from './layout-ops.js';
export { deckConfig, RATIOS, SECTION_NUMBERS } from './deck/config.js';
export { parseLayoutSpec, serialiseLayout, expandPreset, slideMarker, PRESETS, PRESET_REGIONS } from './deck/layout-spec.js';
export { THEMES, DEFAULT_THEME, DROPPED_THEMES, isThemeId, resolveTheme, type SlideTheme } from './themes.js';
export { sha256 } from 'orz-markdown/carrier';
export { VERSION } from './version.js';
export { engineSource, engineFiles, type EngineFiles } from './engine.js';
export type { Deck, DeckConfig, Slide, SlideLint, LayoutNode, SplitNode, RegionLeaf, Region, FloatRegion, Span, Ratio } from './types.js';

/** The orz-markdown version this release renders with. */
export { ORZ_MARKDOWN_VERSION };

/** The engine of an inline assembly: the caller's, else this release's bundle. */
const withEngine = <T extends AssembleOptions>(o: T): T =>
  (o.delivery ?? 'inline') === 'inline' && o.engineSource === undefined ? { ...o, engineSource: engineSource() } : o;

/** Options of the Node {@link assemble}: the isomorphic ones, and what to do with a 0.x deck text. */
export interface NodeAssembleOptions extends AssembleOptions {
  /**
   * A text holding a `<!-- deck -->` block (an orz-slides 0.x text): `refuse` (default) throws an error whose `code`
   * is `legacy-file` — format 1 reads the deck's title, theme, ratio and footer only from the header, so the deck
   * would silently lose them; convert it with {@link upgradeText} first — `as-is` assembles it unconverted (the
   * CLI's `--force`).
   */
  legacy?: 'refuse' | 'as-is';
}

/**
 * Assemble the `.slides.html` file of a text (FC-18 §8, FC-19 §2): `inline`
 * (default) carries this release's browser bundle, `cdn` loads it from
 * jsDelivr. Equal to the browser bundle's `OrzCarrier.assemble` for every
 * format-1 text; a 0.x deck text is refused as the CLI refuses it (D-112),
 * unless `legacy: 'as-is'`.
 */
export function assemble(text: string, options: NodeAssembleOptions = {}): string {
  const { legacy, ...rest } = options;
  if (legacy !== 'as-is') {
    const block = readDocument(text, { kind: 'slides' }).lint.find((l) => l.code === 'deck-block');
    if (block) {
      throw Object.assign(new Error(`orz-slides: the text holds a <!-- deck --> block (line ${block.line ?? '?'}), an orz-slides 0.x deck text: orz-slides 1.0 reads the deck's title, theme, ratio and footer only from the header, so the deck would lose them — convert it first with upgradeText(text) (the CLI: orz-slides upgrade <deck.md>), or pass { legacy: 'as-is' }`), { code: 'legacy-file' });
    }
  }
  return assembleText(text, withEngine(rest));
}

/**
 * Upgrade an orz-slides file to text format 1 with this shell (a 0.x file's
 * `#orz-deck` source and `<!-- deck -->` block → one header; a format-1 file
 * re-assembled). Inline by default, like {@link assemble}.
 */
export function upgrade(html: string, options: UpgradeOptions = {}): UpgradeResult {
  return upgradeFile(html, withEngine(options));
}

/**
 * Inspect a text or a file of any version (the isomorphic `inspect`): an
 * inline file of this shell version is checked against this release's
 * engine (`checks.engine`), unless `options.engineSource` says otherwise;
 * when the engine cannot be read here, the check says `unverified`.
 */
export function inspect(input: string, options: InspectOptions = {}): InspectReport {
  if (options.engineSource !== undefined) return inspectInput(input, options);
  let engine: string | undefined;
  try { engine = engineSource(); } catch { engine = undefined; }
  return inspectInput(input, { ...options, ...(engine !== undefined ? { engineSource: engine } : {}) });
}

/** Options of {@link inspectLayout}. */
export interface InspectLayoutOptions {
  /** The folder the deck's relative pictures resolve against (default: the working folder). */
  baseDir?: string;
  /** Block every host but the loopback: no content library or webfont loads (default false). */
  offline?: boolean;
  /** The Chrome executable (default: {@link findChrome}). */
  chrome?: string;
  /** The whole run's limit in ms (default 10 min). */
  timeoutMs?: number;
}

/**
 * The layout report of a format-1 slides TEXT (Node only; REBUILD §3c Q7):
 * the text assembled inline with this release's engine and rendered in an
 * installed Chrome, every slide shown and settled, every box's fit scale and
 * clipping. Rejects with an error whose `code` is `no-browser` when no Chrome
 * is found (src/layout-report.ts `findChrome`).
 */
export async function inspectLayout(text: string, options: InspectLayoutOptions = {}): Promise<LayoutReport> {
  const chrome = options.chrome ?? findChrome();
  if (!chrome) throw Object.assign(new Error('orz-slides: no Chrome found (install Google Chrome or set ORZ_SLIDES_CHROME to its executable)'), { code: 'no-browser' });
  return layoutReport(assemble(text), text, { chrome, baseDir: options.baseDir ?? process.cwd(), ...(options.offline !== undefined ? { offline: options.offline } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) });
}
