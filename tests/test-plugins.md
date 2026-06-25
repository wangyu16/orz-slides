<!-- deck
title: Plugin tests
theme: poppy
footer: plugin tests · poppy
-->

<!-- slide template=title -->
# Plugin tests
## mermaid · smiles · chart · qr · youtube · span · emoji
poppy theme

<!-- slide 2col -->
## Mermaid — flowchart & sequence
<!-- @left -->
{{mermaid
graph TD
A[Start] --> B{Decision}
B -->|yes| C[Do it]
B -->|no| D[Skip]
}}
<!-- @right -->
{{mermaid
sequenceDiagram
Alice->>Bob: Hello
Bob-->>Alice: Hi there
}}

<!-- slide 3col -->
## SMILES — chemical structures
<!-- @left -->
{{smiles C1=CC=CC=C1}}
benzene
<!-- @mid -->
{{smiles CC(=O)OC1=CC=CC=C1C(=O)O}}
aspirin
<!-- @right -->
{{smiles C(=S)(SC)SC}}
xanthate

<!-- slide 2col -->
## Charts — bar & line
<!-- @left -->
{{chart
type: bar
title: Quarterly
labels: Q1, Q2, Q3, Q4
series: Revenue = 10, 14, 9, 17
series: Cost = 6, 7, 8, 9
}}
<!-- @right -->
{{chart
type: line
labels: Mon, Tue, Wed, Thu, Fri
series: Users = 20, 35, 30, 50, 45
}}

<!-- slide 2col -->
## Charts — pie & doughnut
<!-- @left -->
{{chart
type: pie
labels: A, B, C
data: 30, 50, 20
}}
<!-- @right -->
{{chart
type: doughnut
labels: X, Y, Z
data: 5, 8, 3
}}

<!-- slide 2col -->
## QR code & YouTube embed
<!-- @left -->
{{qr https://orz.how}}

Scan to visit orz.how
<!-- @right -->
{{youtube dQw4w9WgXcQ}}

<!-- slide -->
## Inline plugins — span, emoji, space
Named-style spans: {{sp[danger] ✗ Error}}, {{sp[success] ✓ Done}}, {{sp[warning] ⚠ Caution}}, {{sp[info] ℹ Note}}.

Color spans: {{sp[red] red}}, {{sp[blue] blue}}, {{sp[green] green}}.

Emoji: {{emoji tada}} {{em rocket}} {{emoji wave}}

Wide{{space 8}}gap (8 spaces inserted between the words).
