# Changelog

All notable changes to **orz-slides** are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-07-08

### Added

- **Embedded agent guide.** Every generated `.slides.html` now carries an
  invisible HTML comment (top of `<body>`) telling an AI agent how to edit it —
  what the file is, where the editable deck source lives (`<script id="orz-deck">`),
  and how to fetch the official orz-slides agent skill
  (`https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md`). Invisible
  to readers; readable by any external AI app opening the file's source, so it can
  edit the deck with the correct layout grammar and a byte-identical round-trip.
