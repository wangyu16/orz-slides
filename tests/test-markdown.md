<!-- deck
title: Markdown content tests
theme: architect
footer: markdown tests · architect
-->

<!-- slide template=title -->
# Markdown content
## typography · lists · tables · code · math · containers
architect theme

<!-- slide -->
## Headings & inline formatting
### h3 sub-heading
#### h4 sub-heading
Body text with **bold**, *italic*, ~~strikethrough~~, ==highlight==,
H~2~O subscript, x^2^ superscript, ++inserted++, and `inline code`.
A [link to orz.how](https://orz.how).

<!-- slide 2col -->
## Lists
<!-- @left -->
Unordered + nested:
- one
- two
  - nested a
  - nested b
- three

Task list:
- [x] done item
- [ ] todo item
<!-- @right -->
Ordered + nested:
1. first
2. second
   1. sub one
   2. sub two
3. third

<!-- slide -->
## Table — column alignment
| Left aligned | Centered | Right aligned |
|:-------------|:--------:|--------------:|
| a            | b        | c             |
| a longer cell | middle  | 1234          |
| x            | y        | 56            |

<!-- slide 2col -->
## Code & blockquote
<!-- @left -->
```python
def greet(name):
    return f"Hello, {name}!"

print(greet("world"))
```
<!-- @right -->
> A blockquote with multiple
> lines of quoted text.
>
> — attribution

<!-- slide 2col -->
## Math (KaTeX + mhchem)
<!-- @left -->
Inline: $e^{i\pi} + 1 = 0$

Display:
$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$
<!-- @right -->
Chemistry:
$$\ce{2H2 + O2 -> 2H2O}$$

Inline chem: $\ce{H2SO4}$, $\ce{CO2}$

<!-- slide -->
## Admonition containers
::: info
**Info** — an informational note.
:::
::: success
**Success** — it worked.
:::
::: warning
**Warning** — proceed with care.
:::
::: danger
**Danger** — this is risky.
:::

<!-- slide 2col -->
## Layout & utility containers
<!-- @left -->
Columns via container:
:::: cols
::: col
Column one.
:::
::: col
Column two.
:::
::::
<!-- @right -->
Spoiler:
::: spoil
Hidden content (reveals on interaction, if supported).
:::

Centered:
::: center
Centered text block.
:::

<!-- slide -->
## Tabs container (interactive — click to switch)
:::: tabs
::: tab Python
```python
print("hi")
```
:::
::: tab JavaScript
```js
console.log("hi");
```
:::
::::
