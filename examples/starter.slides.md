{{nyml
kind: document
carrier: slides
uid: doc-iixkejze6219m7l0
title: orz-slides: a starter deck
}}

<!-- slide template=title -->
# orz-slides: a starter deck
## A subtitle
Your name · the date
<!-- @notes -->
Speaker notes: only you see them. In the read view press S for the speaker window, T for the timer, Esc for the overview.

<!-- slide template=outline -->
## Outline
1. Writing slides
2. Layouts
3. Wrapping up

<!-- slide template=section -->
# Writing slides
What a slide is made of

<!-- slide -->
## A plain slide

Every `<!-- slide -->` line starts a slide; its first `##` heading is the title.

- Write Markdown as usual: **bold**, *italic*, `code`, [links](https://markdown.orz.how)
- A slide with too much text shrinks to fit its box
- The header at the top holds the deck's title, theme, ratio and footer

<!-- slide step -->
## Points that appear one by one

- The `step` option shows list items one at a time
- Press → or Space for the next one
- Press S to see this slide's notes
<!-- @notes -->
Notes for this slide. A slide's own options go on its marker line: `step`, `bg=`, `t=`, `fit=`.

<!-- slide template=section -->
# Layouts
Splitting a slide into boxes

<!-- slide 2col -->
## Two columns
<!-- @left -->
The left box.

- `2col`, `3col`, `2row`, `main-side` and `quad` are presets
- `2col 3/2` sets the widths
<!-- @right -->
::: info
The right box. In the editor, enlarge the slide card to split, resize or delete boxes by hand.
:::

<!-- slide main-side -->
## Main and side, with a float
<!-- @main -->
| Step | What you do |
|---|---|
| 1 | Write the text |
| 2 | Assemble the file |
| 3 | Present it |
<!-- @side -->
> A side box for a note or a quote.
<!-- @float left=66% top=70% w=28% h=16% -->
A float sits over the slide.

<!-- slide row 1/3 { top; col 1/1 { left; right } } -->
## A split of your own
<!-- @top -->
A row on top, two columns under it: `row 1/3 { top; col 1/1 { left; right } }`.
<!-- @left -->
- Name every box
- Fill it with its marker
<!-- @right -->
- Nest rows and columns
- Any depth
<!-- @footer -->
This slide's own footer

<!-- slide template=section -->
# Wrapping up

<!-- slide template=closing -->
# Thank you
## Questions?
your.address@example.org
