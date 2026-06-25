<!-- deck
theme: executive
title: Presenter features
ratio: 16:9
-->

<!-- slide template=title -->
<!-- @body -->
# Presenter features
## speaker view · fragments · timer · slide numbers
A test deck for the Phase-3 presenter tools.
<!-- @notes -->
Welcome. This title slide has speaker notes — they should appear in the
speaker view (press **S**). Press **T** for the on-deck timer.

<!-- slide step -->
## Step-reveal (a `step` slide)
- First point appears
- Then the second
- Then the third
- And finally the fourth
<!-- @notes -->
These bullets reveal one at a time. Use the arrow keys (here or in the
speaker window) to advance through the fragments.

<!-- slide -->
## Manual fragments
A paragraph that is always visible.

A second paragraph revealed as a step.{{attrs[.fragment]}}

A third paragraph, revealed after it.{{attrs[.fragment]}}
<!-- @notes -->
This slide uses `{{attrs[.fragment]}}` on individual paragraphs instead of
the slide-level `step` flag.

<!-- slide step 2col -->
## Two columns, stepped
<!-- @left -->
- Alpha
- Beta
- Gamma
<!-- @right -->
- One
- Two
- Three
<!-- @notes -->
Multi-region step slide: fragments reveal across regions in document order.

<!-- slide template=closing -->
<!-- @body -->
# Thank you
## Questions?
<!-- @notes -->
Closing slide. Stop the timer when you're done.
