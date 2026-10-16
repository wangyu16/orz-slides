# Review decks

Focused format-1 decks for looking at by hand — each exercises one area, so a
problem is easy to isolate. Upgraded from the 0.x test decks with `orz-slides
upgrade` (rebuild step 8, STATUS D-29); the texts are committed, their
`.slides.html` files are not (git-ignored: assemble them when you need them).
`tests/package.test.ts` (claim S.3) keeps every text format-1, lint-clean and
assemblable, so they never go stale.

```bash
npm run build
for f in tests/decks/*.slides.md; do node dist/cli.js assemble "$f"; done   # inline files, open offline
```

The automated tests use their own fixtures (`tests/fixtures/`: the engine
sample `sample/`, `stress/`, `settle/`, `fit/`, the 0.x files of `legacy/`)
and the shared corpus (`orz-markdown/tests/carrier-corpus/slides`).

| Deck | Theme | Focus |
|---|---|---|
| `layouts` | paper | presets (2col/3col/2row/main-side/quad), raw splits, deep nesting, track units (fr/auto/%/px), a single region, floats and z-order |
| `templates` | chalk (dark) | title v1–v6, section v1–v4, outline v1–v3, closing v1–v3, then a normal slide |
| `markdown` | architect | headings, inline formatting, lists, tables, code, blockquote, math (KaTeX, mhchem), containers |
| `plugins` | sticker | `{{mermaid}}`, `{{smiles}}`, `{{chart}}`, `{{qr}}`, `{{youtube}}`, `{{sp}}`, `{{emoji}}`, `{{space}}` |
| `overflow` | sky | fit: fits / moderate / extreme, `fit=scroll`, `fit=off`, a crowded column |
| `footer-options` | neon (dark) | deck footer, a slide's `@footer`, the title page without a footer, `bg=`, `t=`, `id=`/`class=` |
| `ratio-4x3` | orchard | a `ratio: 4:3` deck (title, 2col, quad) |
| `presenter` | sky | speaker notes, `step` and `{{attrs[.fragment]}}` fragments, the timer, slide numbers |
