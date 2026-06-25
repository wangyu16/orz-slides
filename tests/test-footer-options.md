<!-- deck
title: Footer & options tests
theme: neon
footer: DECK FOOTER — should appear on every slide
transition: fade
-->

<!-- slide template=title -->
# Footer & options
## deck footer · per-slide footer · bg · transition · id/class
neon theme (dark) — title page should have NO footer

<!-- slide -->
## Deck footer here
This slide should show the **deck-wide footer** at the bottom.
(The title page before this should have no footer.)

<!-- slide -->
## Per-slide footer override
This slide overrides the deck footer with its own.
<!-- @footer -->
THIS SLIDE'S OWN FOOTER (overrides the deck footer, this slide only)

<!-- slide -->
## Back to the deck footer
This slide should show the **deck footer again** — not the previous
slide's custom footer.

<!-- slide bg=#10243a -->
## Custom background — bg=#10243a
This slide sets a custom background color via `bg=`, overriding the theme
background. Content should remain readable.
- bullet
- bullet

<!-- slide t=zoom -->
## Per-slide transition — t=zoom
Navigate INTO this slide to see a zoom transition (deck default is fade).

<!-- slide id=special class=highlight -->
## id & class options
This `<section>` should carry `id="special"` and the class `highlight`
(inspect the DOM to confirm).
- bullet
- bullet
