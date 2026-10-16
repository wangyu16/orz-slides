# Host protocols — orz-slides

The host protocols `orz-host-save@1`, `orz-host-ai@1` and
`orz-host-include@1` are specified once for the whole orz family in
orz-markdown:
**[`spec/host-protocols.md`](https://github.com/wangyu16/orz-markdown/blob/main/spec/host-protocols.md)**
(also in the installed package: `node_modules/orz-markdown/spec/host-protocols.md`).
That document is canonical — messages, handshake, security rules on both
sides, format-1 saves, versioning. This file used to hold a copy of the save
protocol; it now lists only what is particular to orz-slides. A host
implements the protocols with orz-markdown's `embedCarrierFrame`
(`orz-markdown/carrier/shell`); the file side is built into every
`.slides.html` (orz-markdown `carrier/app`, as in every carrier). This file is
shipped in the `orz-slides` package.

## What an orz-slides file does (1.0, text format 1)

- **Kind** `slides` in every `ready` (spec §2).
- **All three protocols** are answered, and only in a frame
  (`window.parent !== window`) after the host's hello (spec §6).
- **Save** (`orz-host-save@1`, spec §3, §7): `source` is the exact text twin
  (`x.slides.md`) and `html` is `assemble(source)` with the file's delivery
  and its `#orz-includes` record — the same bytes a file save would write,
  never the rendered deck. Saves from the read view (a header setting from the
  pencil's list: Theme, Ratio, Slide numbers, Progress bar, Section numbers)
  and from the editor (both editing modes: the whole deck and single-slide
  editing) go to the host; the dirty state is posted. A hosted file never
  shows a file picker and never checks for updates. `theme` may be omitted:
  the text's header holds it. Persist the text; the HTML can always be
  regenerated.
- **AI** (`orz-host-ai@1`, spec §4): the host's operations appear as an **AI**
  menu in the file's editor. A result is shown in a review panel; the deck
  changes only when the reader applies it, as one undoable edit.
- **Include** (`orz-host-include@1`, spec §5): the read view (the deck) and
  the editor's preview and live slide ask the host for URL includes (`{{md
  https://…}}`, `{{markdown …}}`, `{{md-include …}}`); the host's answer wins,
  and the file's `#orz-includes` record (resolved at assembly) is the
  fallback. The text keeps the directive. A standalone file never fetches an
  include URL.
- Present (full screen), the speaker view (its own window) and Print run
  inside the file; a host's frame needs `allow="fullscreen"` for Present to
  go full screen, and the speaker window is a popup of the frame
  (`allow-popups` in the frame's sandbox, if any).

## Older files

orz-slides 0.x files (before text format 1, up to 0.8.5) spoke version 1 of
`orz-host-save` and, from 0.8.0, `orz-host-include` (resolving
`{{md-include https://…}}` for the editor preview while keeping the raw
directive in the saved source): their `source` is the 0.x deck source (with
its `<!-- deck … -->` block), and `theme` the file's current theme. Upgrade
them with `orz-slides upgrade` (README, "Migrating from 0.x").
