# archive — the 0.x design documents

These documents describe orz-slides before the 1.0 rebuild (text format 1,
the orz-markdown carrier kit). They are kept for their history and as the
specification some of the code was written from; **they are not the current
truth** — where they disagree with the README, the skill, `docs/` or the
code, those win.

| File | What it was | Still true | The current truth |
|---|---|---|---|
| `DESIGN.md` | the 0.x source of truth: goals, file model, authoring syntax, pipeline, overflow, the in-file app, delivery, themes, packages, the agent skill, roadmap, decisions | slides written in orz-markdown with comment markers (`<!-- slide … -->`, `<!-- @region -->`, `<!-- @float … -->`), the recursive split grammar and its presets, the heading rule (one leading `##` per normal slide, `#` on title pages), structure-page templates, scale-to-fit with a floor and `fit=scroll`/`off`, reveal.js for the deck mechanics, the text as the single source of truth | [README.md](../README.md), [the skill](../orz-slides-skills/SKILL.md), [docs/dom-contract.md](../docs/dom-contract.md), [docs/embedding.md](../docs/embedding.md), [CLAUDE.md](../CLAUDE.md); orz-markdown `spec/FC-18-text-format-1.md` §7.2; the family plan `../../docs/REBUILD.md` §3c |
| `BUILD-PLAN.md` | the 0.x module map (work packages WP0–WP10) and build order | nothing (done, then rebuilt) | [notes/CLAIMS.md](../notes/CLAIMS.md) (what is built and proven), [CLAUDE.md](../CLAUDE.md) (the architecture) |

What 1.0 changed against these documents: the `<!-- deck … -->` block is the
text's `{{nyml}}` header (format 1); the file holds the text in `#orz-src`
(`#orz-deck`, `text/orz-slides` and `__ORZ_SLIDES__` are gone); the logical
slide is 1280 × 720 (16:9) or 960 × 720 (4:3), no longer 960 × 540; the
7 themes became 14 (10 derived from orz-markdown's themes, 4 updated 0.x
themes; executive, poppy and sage dropped, mapped by `upgrade`); the per-slide
pop-out editor became the kit's editor with two editing modes (the whole deck
beside a flattened preview with a live slide card; single-slide editing with
the layout GUI); morphdom, the auto-hiding deck bar, the presentation-only
export and vertical sub-slides were dropped; PDF is the browser's print of the
carrier's print document (with or without notes).
