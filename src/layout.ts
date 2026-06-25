/**
 * WP2 — Layout engine. Layout tree → nested CSS-grid DOM.
 *
 * Takes a fully-expanded `LayoutNode` (the parser has already expanded any
 * preset alias), so this module depends only on ./types — nothing else.
 * Pure string building; no DOM API.
 *
 * See BUILD-PLAN.md WP2 and docs/dom-contract.md ("Layout grid (WP2 output)").
 */
import type { LayoutNode, GridRender, Track } from './types.js';

/** Escape a string for safe inclusion inside an HTML double-quoted attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalize a single track token: a bare number (`2`, `1.5`) becomes `<n>fr`;
 * everything else (`auto`, `1fr`, `30%`, `200px`, `minmax(…)`, …) passes
 * through unchanged.
 */
function normalizeTrack(track: Track): string {
  const trimmed = track.trim();
  // Bare number (integer or decimal) → fr unit.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}fr`;
  }
  return trimmed;
}

/** Render one node, appending region names to `regions` in document order. */
function renderNode(node: LayoutNode, regions: string[]): string {
  if (node.kind === 'region') {
    regions.push(node.name);
    return `<div class="orz-region" data-region="${escapeAttr(node.name)}"></div>`;
  }

  // SplitNode.
  const prop = node.dir === 'col' ? 'grid-template-columns' : 'grid-template-rows';
  const tracks = node.tracks.map(normalizeTrack).join(' ');
  const inner = node.children.map((child) => renderNode(child, regions)).join('');
  return `<div class="orz-split" style="display:grid;${prop}:${tracks}">${inner}</div>`;
}

/**
 * Render a layout tree to nested grid DOM with empty region cells.
 * Returns the inner HTML for `.orz-content` and the region names in order.
 */
export function renderLayout(node: LayoutNode): GridRender {
  const regions: string[] = [];
  const html = renderNode(node, regions);
  return { html, regions };
}
