/**
 * KIND-SPECIFIC (slides): this carrier behind the kit's standalone seam
 * (`StandaloneKind`, orz-markdown `carrier/app`, spec/carrier-app.md §3, §7)
 * — its assemble, its creation tool, its editor, its read view, its header
 * settings (Theme, Ratio), its repository (edit mode's GitHub link) and the
 * rest of its FC-19 §2 surface.
 *
 * REBUILD STEP 1–2: the read view is a stub (src/browser/slides/read-view.ts)
 * until the engine of step 3 (reveal.js in `src/present/`, the Present and
 * Print actions, `onKey` navigation).
 */
import type { StandaloneKind } from 'orz-markdown/carrier/app';
import { newDocument } from '../../assemble.js';
import { assemble, extract, formats, kind, mountEditor, readDocument, renderPreview, version } from '../carrier.js';
import { createReadView } from './read-view.js';
import { SLIDES_SETTINGS } from './settings.js';

export const SLIDES_KIND: StandaloneKind = {
  kind,
  version,
  formats,
  brand: 'orz-slides',
  assemble: (text, options) => assemble(text, options ?? {}),
  newDocument: () => newDocument(),
  mountEditor: (element, options, ctx) => mountEditor(element as unknown as HTMLElement, options as never, ctx),
  createReadView: (doc) => createReadView(doc as unknown as Document),
  settings: SLIDES_SETTINGS,
  repo: 'https://github.com/wangyu16/orz-slides',
  readDocument,
  extract,
  renderPreview: (text, options) => renderPreview(text, options ?? {}),
};
