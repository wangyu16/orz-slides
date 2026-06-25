<!-- deck
title: Layout tests
theme: paper
footer: layout tests · paper
-->

<!-- slide template=title -->
# Layout tests
## presets · raw splits · nesting · floats · track units
paper theme

<!-- slide 2col -->
## 2col — equal (default)
<!-- @left -->
Left column. Equal width by default.
- bullet
- bullet
<!-- @right -->
Right column. Same width.

<!-- slide 2col 3/2 -->
## 2col 3/2 — ratio
<!-- @left -->
Left is **3** parts wide.
<!-- @right -->
Right is **2** parts.

<!-- slide 3col -->
## 3col — three equal columns
<!-- @left -->
Left
<!-- @mid -->
Middle
<!-- @right -->
Right

<!-- slide 2row -->
## 2row — stacked
<!-- @top -->
Top row.
<!-- @bottom -->
Bottom row.

<!-- slide main-side -->
## main-side — 2/1 default
<!-- @main -->
Main content area (2 parts wide).
<!-- @side -->
Side (1 part).

<!-- slide quad -->
## quad — 2×2 grid
<!-- @tl -->
Top-left
<!-- @tr -->
Top-right
<!-- @bl -->
Bottom-left
<!-- @br -->
Bottom-right

<!-- slide col 3/2 { main; aside } -->
## Raw split — col 3/2 { main; aside }
<!-- @main -->
Main region from a raw split (custom names).
<!-- @aside -->
Aside region.

<!-- slide row auto/1 { head; col 1/1 { a; b } } -->
## Nested — header band over two columns
<!-- @head -->
A header band spanning the full width (auto height).
<!-- @a -->
Cell A
<!-- @b -->
Cell B

<!-- slide col 1/1/1 { c1; row 1/1 { c2a; c2b }; c3 } -->
## Deep nesting — 3 columns, middle split into 2 rows
<!-- @c1 -->
Column 1
<!-- @c2a -->
Mid top
<!-- @c2b -->
Mid bottom
<!-- @c3 -->
Column 3

<!-- slide col 220px/1fr { sidebar; content } -->
## Track units — fixed px sidebar + 1fr
<!-- @sidebar -->
220px fixed
<!-- @content -->
1fr (fills the rest)

<!-- slide row auto/1fr/auto { banner; body; bar } -->
## Track units — auto / 1fr / auto
<!-- @banner -->
Banner (auto height, sized to content)
<!-- @body -->
Body (1fr — fills remaining vertical space)
<!-- @bar -->
Bar (auto height)

<!-- slide -->
## Single region — no markers
No region markers needed. All content flows into the primary region.
- everything here
- goes to one region

<!-- slide 2col -->
## Float overlay — one float
<!-- @left -->
Background grid content (left).
<!-- @right -->
Background grid content (right).
<!-- @float left=58% top=22% w=36% h=44% -->
> **Float** at `left=58% top=22% w=36% h=44%` — on top of the grid.

<!-- slide -->
## Two floats — z-order
Base content underneath both floats.
<!-- @float left=8% top=34% w=42% h=34% z=1 -->
::: info
Float A — z=1
:::
<!-- @float left=30% top=48% w=42% h=34% z=2 -->
::: warning
Float B — z=2 (should sit on top of A)
:::
