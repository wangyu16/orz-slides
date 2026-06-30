/**
 * Phase-0 spike: parse a sample deck, assemble reveal <section>s, and emit a
 * static browser harness (reveal + enhancers + scale-to-fit). Run:
 *   npx tsx scripts/spike.ts   → out/spike.html
 * Then open out/spike.html in a browser (served, for the relative theme CSS).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { md } from 'orz-markdown';
import { parseDeck } from '../src/slide-parser.js';
import { renderDeck } from '../src/render-slide.js';

const overflow = Array.from({ length: 32 }, (_, i) =>
  `- Point ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.`
).join('\n');

const DECK = `<!-- deck
title: orz-slides spike
theme: paper
ratio: 16:9
footer: orz-slides · spike
-->

<!-- slide template=title -->
# orz-slides
## A self-contained, editable slide deck
**Dr. Yu Wang** · 2026

<!-- slide 2col 3/2 -->
## Results
<!-- @left -->
- Accuracy **92%**
- 3× faster than baseline
- Inline math: $e^{i\\pi}+1=0$
<!-- @right -->
$$\\int_0^1 x^2\\,dx = \\tfrac13$$

{{smiles C(=S)(SC)SC}}

<!-- slide row auto/1 { head; col 1/1 { a; b } } -->
## Nested layout (header over two cells)
<!-- @head -->
A header spanning the full width, with two cells below.
<!-- @a -->
{{mermaid graph LR; A-->B-->C}}
<!-- @b -->
{{chart
type: bar
labels: Q1, Q2, Q3, Q4
series: Revenue = 10, 14, 9, 17
}}

<!-- slide -->
## Float overlay
Background content fills the slide normally; the float sits on top at a fixed
spot. This is the one escape from the grid.
<!-- @float left=56% top=22% w=38% h=46% -->
> **Pull-out**
>
> Floats are positioned and sized by the author.

<!-- slide -->
## Overflow test — scale-to-fit
${overflow}
`;

const deck = parseDeck(DECK);
const sections = renderDeck(deck, md as never);
const reportLint = deck.slides.flatMap((s, i) => s.lint.map((l) => `slide ${i}: ${l.level} ${l.message}`));
if (reportLint.length) console.log('Lint:\n' + reportLint.join('\n'));

const ratio = (deck.config.ratio || '16:9').split(':').map(Number);
const W = 960;
const H = Math.round((W * ratio[1]) / ratio[0]);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${deck.config.title || 'spike'}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.0.4/reset.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.0.4/reveal.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css">
<link id="presentation-theme" rel="stylesheet" href="../assets/themes/theme-${deck.config.theme || 'paper'}.css">
</head>
<body>
<div class="reveal"><div class="slides">
${sections}
</div></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.0.4/reveal.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script src="https://unpkg.com/smiles-drawer@1.0.10/dist/smiles-drawer.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js"></script>
<script>
Reveal.initialize({ width: ${W}, height: ${H}, margin: 0.04, hash: true, controls: true });

function enhance() {
  // mermaid
  try { if (window.mermaid) { mermaid.initialize({ startOnLoad: false }); mermaid.run({ querySelector: '.mermaid:not([data-processed])' }); } } catch (e) {}
  // smiles
  try { if (window.SmilesDrawer) document.querySelectorAll('canvas[data-smiles]').forEach(function (c) {
    if (c.__d) return; c.__d = 1; if (c.__ow === undefined) { c.__ow = c.width; c.__oh = c.height; } c.width = c.__ow; c.height = c.__oh;
    var dr = new SmilesDrawer.Drawer({ width: c.__ow, height: c.__oh });
    SmilesDrawer.parse(c.getAttribute('data-smiles'), function (t) { try { dr.draw(t, c, 'light', false); } catch (e) {} });
  }); } catch (e) {}
  // charts
  try { if (window.Chart) document.querySelectorAll('canvas.orz-chart[data-chart]').forEach(function (c) {
    if (c.__d) return; c.__d = 1; try { new Chart(c, JSON.parse(c.getAttribute('data-chart'))); } catch (e) {}
  }); } catch (e) {}
}

// WP6 — scale-to-fit: shrink a region's content font until it fits (floor 60%).
function fitRegion(region) {
  region.style.removeProperty('--region-scale');
  var content = region.firstElementChild; // .markdown-body
  if (!content) return;
  var scale = 1;
  for (var i = 0; i < 10; i++) {
    if (content.scrollHeight <= region.clientHeight + 1 && content.scrollWidth <= region.clientWidth + 1) break;
    scale -= 0.07;
    if (scale < 0.6) { scale = 0.6; region.style.setProperty('--region-scale', scale); break; }
    region.style.setProperty('--region-scale', scale);
  }
  region.setAttribute('data-scale', scale.toFixed(2));
}
function fitCurrent() {
  var s = Reveal.getCurrentSlide();           // only the visible slide is laid out
  if (!s || s.getAttribute('data-fit') !== 'fit') return;
  s.querySelectorAll('.orz-region').forEach(fitRegion);
}

enhance();
// re-run after async libs settle, then fit the current slide
[150, 600, 1500].forEach(function (t) { setTimeout(function () { enhance(); fitCurrent(); }, t); });
Reveal.on('slidechanged', function () { enhance(); setTimeout(fitCurrent, 60); });
window.__fit = fitCurrent;
</script>
</body>
</html>
`;

mkdirSync('out', { recursive: true });
writeFileSync('out/spike.html', html, 'utf8');
console.log(`Wrote out/spike.html — ${deck.slides.length} slides (${W}×${H})`);
