/**
 * KIND-SPECIFIC (slides): this carrier behind the kit's standalone seam
 * (`StandaloneKind`, orz-markdown `carrier/app`, spec/carrier-app.md §3, §7)
 * — its assemble, its creation tool, its editor, its read view (the deck:
 * src/browser/slides/read-view.ts on the engine of src/present/), its
 * header settings (Theme, Ratio), its actions, its repository (edit mode's
 * GitHub link) and the rest of its FC-19 §2 surface.
 *
 * Actions (items of the pencil's list; the kit adds Edit, Save, …):
 * - **Present** (`bar`): the deck alone, full screen, the chrome hidden
 *   (back on leaving full screen);
 * - **Print** (id `print`: Cmd/Ctrl+P runs it from anywhere, spec §4.8):
 *   the carrier's print document — one slide per page at the slide's size,
 *   every fragment shown — through the kit's `printDocument`; **Print with
 *   notes**: each page the slide over its speaker notes;
 * - **Speaker view** (S), **Overview** (O / Escape).
 */
import type { CarrierAction, CarrierApp, StandaloneKind } from 'orz-markdown/carrier/app';
import { newDocument } from '../../assemble.js';
import { assemble, extract, formats, kind, mountEditor, readDocument, renderPreview, version } from '../carrier.js';
import { createReadView, type SlidesReadView } from './read-view.js';
import { SLIDES_SETTINGS } from './settings.js';

/** The deck read view of the app (null before boot or in an app host). */
const deckView = (app: CarrierApp): SlidesReadView | null => {
  const v = (app as unknown as { view?: unknown }).view as SlidesReadView | undefined;
  return v && typeof v === 'object' && 'engine' in v ? v : null;
};

const fail = (app: CarrierApp, what: string) => (e: unknown): void => { app.toast(`${what} failed: ${e instanceof Error ? e.message : String(e)}`, 'error'); };

export const SLIDES_ACTIONS: readonly CarrierAction[] = Object.freeze([
  {
    id: 'present',
    label: 'Present',
    icon: 'present',
    placement: 'bar',
    run: (app: CarrierApp) => { void deckView(app)?.engine.enterPresent().catch(fail(app, 'Present')); },
  },
  {
    id: 'print',
    label: 'Print',
    icon: 'print',
    placement: 'menu',
    run: async (app: CarrierApp) => { await deckView(app)?.engine.print().catch(fail(app, 'Print')); },
  },
  {
    id: 'print-notes',
    label: 'Print with notes',
    placement: 'menu',
    run: async (app: CarrierApp) => { await deckView(app)?.engine.print({ notes: true }).catch(fail(app, 'Print with notes')); },
  },
  {
    id: 'speaker',
    label: 'Speaker view',
    placement: 'menu',
    run: (app: CarrierApp) => { deckView(app)?.engine.openSpeaker(); },
  },
  {
    id: 'overview',
    label: 'Overview',
    placement: 'menu',
    run: (app: CarrierApp) => { deckView(app)?.engine.toggleOverview(); },
  },
] as CarrierAction[]);

export const SLIDES_KIND: StandaloneKind = {
  kind,
  version,
  formats,
  brand: 'orz-slides',
  assemble: (text, options) => assemble(text, options ?? {}),
  newDocument: () => newDocument(),
  mountEditor: (element, options, ctx) => mountEditor(element as unknown as HTMLElement, options as never, ctx),
  createReadView: (doc) => createReadView(doc as unknown as Document) as never,
  settings: SLIDES_SETTINGS,
  actions: SLIDES_ACTIONS,
  repo: 'https://github.com/wangyu16/orz-slides',
  readDocument,
  extract,
  renderPreview: (text, options) => renderPreview(text, options ?? {}),
};
