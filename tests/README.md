# Test decks

Focused `.slides.html` decks for manual review — each exercises one area so bugs
are easy to isolate. The `.md` sources are committed; the generated
`.slides.html` files are git-ignored (regenerate them, then open in a browser).

## Regenerate

```bash
# all of them
for f in tests/test-*.md; do npx tsx src/cli.ts "$f"; done

# or one
npx tsx src/cli.ts tests/test-layouts.md
```

Open the resulting `tests/test-*.slides.html` in a browser (Chrome/Edge for the
in-file editor). Math / diagrams / charts load their libraries from CDN, so
viewing needs internet.

## The decks

| Deck | Theme | Focus |
|---|---|---|
| `test-layouts` | paper | presets (2col/3col/2row/main-side/quad), raw splits, deep nesting, track units (fr/auto/%/px), single region, floats + z-order |
| `test-templates` | chalk (dark) | title v1/v2/v3, section v1/v2, outline, closing, then a normal slide |
| `test-markdown` | architect | headings, inline formatting, lists (nested/ordered/task), tables + alignment, code, blockquote, math (KaTeX + mhchem), admonition/cols/spoil/center/tabs containers |
| `test-plugins` | poppy | `{{mermaid}}`, `{{smiles}}`, `{{chart}}` (bar/line/pie/doughnut), `{{qr}}`, `{{youtube}}`, `{{sp}}`, `{{emoji}}`, `{{space}}` |
| `test-overflow` | executive | scale-to-fit: fits / moderate / extreme, `fit=scroll`, `fit=off`, per-region overflow in a column |
| `test-footer-options` | neon (dark) | deck-wide footer, per-slide `@footer` override, title-page footer suppression, `bg=`, per-slide `t=` transition, `id=`/`class=` |
| `test-ratio-4x3` | sage | a `ratio: 4:3` deck (title + 2col + quad) |

Together they cover all seven themes.
