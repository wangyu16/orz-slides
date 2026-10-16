/**
 * orz-slides' extension of the FC-19 §2 surface for apps: the format-1
 * parser and the per-slide editor's PURE layout ops (src/layout-ops.ts) —
 * `OrzCarrier.layout` on the IIFE's global and on the ES module's
 * `OrzCarrier` (the ES module also exports each by name). An app applies an
 * op's minimal edits with `editor.applyEdits(r.edits, { label: r.label })`
 * (one undo step), as the layout GUI does.
 */
import { parseDeck } from '../deck/parse.js';
import { applyEdits, applyOp, LayoutOpError, PRESET_CHOICES, SLIDE_SIZE, slideMap } from '../layout-ops.js';

export const LAYOUT_API = Object.freeze({ parseDeck, applyOp, applyEdits, slideMap, LayoutOpError, PRESET_CHOICES, SLIDE_SIZE });
