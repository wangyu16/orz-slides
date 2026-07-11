# Changelog

All notable changes to **orz-slides** are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [0.7.1] — 2026-07-11

### Security

- Updated build/test tooling to fixed `esbuild ^0.28.1` and `vitest ^4.1.10`
  releases. Runtime dependencies and generated document behavior are unchanged.

### Packaging

- Ship the MIT license in both npm packages and include `PROTOCOL.md` in the CLI
  tarball so installed README links remain valid.

## [0.7.0] — 2026-07-11

### Added

- Portable document metadata. Deck `title:` and `author:` seed standard
  `<head>` tags and an `#orz-meta` JSON island. Programmatic callers can pass
  richer `metadata` to `buildSlidesHtml`; host values win field by field while
  the deck footer and visible content remain unchanged. Requires
  `orz-markdown ^1.4.0`.

## [0.6.1] — 2026-07-09

### Fixed

- **Theme picker now writes into the deck source.** Picking a theme from the
  toolbar dropdown updated the runtime (`data-theme`, the rendered CSS) and the
  CodeMirror editor's syntax theme, but never touched the deck's own leading
  `<!-- deck ... -->` config block — so the pick was DOM-only state, lost the
  moment a host (or the author) read `theme:` from the saved source instead of
  a side channel. `setTheme()` now rewrites (or inserts) the `theme:` line in
  the deck config on every pick — replacing an existing line, adding one to a
  deck block that lacks it, or creating a minimal deck block if the deck had
  none at all — and keeps the open "deck settings" editor buffer in sync. The
  deck is now genuinely self-describing: its own source is always the single,
  correct statement of its current theme, standalone or hosted alike.

## [0.6.0] — 2026-07-09

### Added

- **Page-wide AI assistant (`orz-host-ai@1`).** When an embedding host
  advertises AI operations, the editor now shows an assistant: select text in
  the source editor for an "✦ Improve selection" chip, or use the new sparkle
  button in the toolbar to run an operation on the whole editor buffer (the
  current slide, or the deck config when deck-settings is open). The file sends
  the passage to the host, which returns a suggested replacement the author
  edits and applies. The file owns the UI; the host owns the model and
  governance. No host, no assistant — standalone files are unchanged. Ported
  from orz-mdhtml to match the shared protocol exactly. See `PROTOCOL.md`.
- **Theme in save.** The `orz-host-save` message now carries the file's current
  `theme` id (additive field), so a host can persist the author's theme choice
  (e.g. a course-wide default). Hosts that ignore it are unaffected.

### Docs

- Added `PROTOCOL.md` documenting `orz-host-save@1` (incl. the new `theme`
  field) and `orz-host-ai@1`, mirroring the canonical spec in orz-mdhtml.

## [0.5.0] — 2026-07-08

### Added

- **Embedded agent guide.** Every generated `.slides.html` now carries an
  invisible HTML comment (top of `<body>`) telling an AI agent how to edit it —
  what the file is, where the editable deck source lives (`<script id="orz-deck">`),
  and how to fetch the official orz-slides agent skill
  (`https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md`). Invisible
  to readers; readable by any external AI app opening the file's source, so it can
  edit the deck with the correct layout grammar and a byte-identical round-trip.
