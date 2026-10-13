<!-- deck
title: orz-slides — demo
theme: paper
ratio: 16:9
footer: orz-slides · demo deck
-->

<!-- slide template=title -->
# orz-slides
## Self-contained, editable slide decks
**Dr. Yu Wang** · 2026

<!-- slide -->
## What it is

- One portable `.slides.html` file — presents in any browser
- Authored in **orz-markdown** with a simple layout syntax
- Region markers split a slide; content is just markdown
- Math: $e^{i\pi} + 1 = 0$, code, tables, diagrams — all work

<!-- slide 2col 3/2 -->
## Two columns

<!-- @left -->
The layout grammar splits a slide into regions:

- `2col 3/2` → two columns, 3 : 2 width
- each region holds orz-markdown
- nest `row`/`col` for any structure

<!-- @right -->
$$\int_0^1 x^2\,dx = \tfrac{1}{3}$$

{{smiles C(=S)(SC)SC}}

<!-- slide row auto/1 { head; col 1/1 { a; b } } -->
## Nested layout + charts

<!-- @head -->
A full-width header band over two cells.

<!-- @a -->
{{mermaid graph LR; Idea-->Draft-->Deck}}

<!-- @b -->
{{chart
type: bar
labels: Q1, Q2, Q3, Q4
series: Revenue = 10, 14, 9, 17
}}

<!-- slide template=section -->
# Part II — In the browser

<!-- slide -->
## Float overlay

Normal content fills the slide; a float sits on top at a fixed spot — the one
escape from the grid.

<!-- @float left=58% top=24% w=36% h=44% -->
> **Pull-out**
>
> Floats are positioned and sized by the author.

<!-- slide template=closing -->
# Thank you

Questions? · **orz.how**
