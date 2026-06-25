<!-- deck
title: Overflow & fit tests
theme: executive
footer: overflow tests · executive
-->

<!-- slide template=title -->
# Overflow & scale-to-fit
## fit=fit (default) · fit=scroll · fit=off
executive theme

<!-- slide -->
## Fits comfortably — no scaling expected
- Point one
- Point two
- Point three
- Point four

<!-- slide -->
## Moderate overflow — should scale down to fit
- Line 1: lorem ipsum dolor sit amet, consectetur adipiscing elit
- Line 2: sed do eiusmod tempor incididunt ut labore et dolore magna
- Line 3: ut enim ad minim veniam, quis nostrud exercitation ullamco
- Line 4: duis aute irure dolor in reprehenderit in voluptate velit
- Line 5: excepteur sint occaecat cupidatat non proident, sunt in culpa
- Line 6: qui officia deserunt mollit anim id est laborum, sed ut enim
- Line 7: perspiciatis unde omnis iste natus error sit voluptatem
- Line 8: accusantium doloremque laudantium, totam rem aperiam eaque
- Line 9: ipsa quae ab illo inventore veritatis et quasi architecto
- Line 10: beatae vitae dicta sunt explicabo, nemo enim ipsam voluptatem

<!-- slide -->
## Extreme overflow — floors at ~60% scale, then clips
- 1 lorem ipsum dolor sit amet consectetur adipiscing elit sed do
- 2 eiusmod tempor incididunt ut labore et dolore magna aliqua ut
- 3 enim ad minim veniam quis nostrud exercitation ullamco laboris
- 4 nisi ut aliquip ex ea commodo consequat duis aute irure dolor
- 5 in reprehenderit in voluptate velit esse cillum dolore eu fugiat
- 6 nulla pariatur excepteur sint occaecat cupidatat non proident
- 7 sunt in culpa qui officia deserunt mollit anim id est laborum
- 8 sed ut perspiciatis unde omnis iste natus error sit voluptatem
- 9 accusantium doloremque laudantium totam rem aperiam eaque ipsa
- 10 quae ab illo inventore veritatis et quasi architecto beatae
- 11 vitae dicta sunt explicabo nemo enim ipsam voluptatem quia
- 12 voluptas sit aspernatur aut odit aut fugit sed quia consequuntur
- 13 magni dolores eos qui ratione voluptatem sequi nesciunt neque
- 14 porro quisquam est qui dolorem ipsum quia dolor sit amet
- 15 consectetur adipisci velit sed quia non numquam eius modi
- 16 tempora incidunt ut labore et dolore magnam aliquam quaerat
- 17 voluptatem ut enim ad minima veniam quis nostrum exercitationem
- 18 ullam corporis suscipit laboriosam nisi ut aliquid ex ea
- 19 commodi consequatur quis autem vel eum iure reprehenderit qui
- 20 in ea voluptate velit esse quam nihil molestiae consequatur

<!-- slide fit=scroll -->
## fit=scroll — overflow should scroll, not scale
- 1 lorem ipsum dolor sit amet consectetur adipiscing elit
- 2 sed do eiusmod tempor incididunt ut labore et dolore
- 3 ut enim ad minim veniam quis nostrud exercitation
- 4 ullamco laboris nisi ut aliquip ex ea commodo consequat
- 5 duis aute irure dolor in reprehenderit in voluptate
- 6 velit esse cillum dolore eu fugiat nulla pariatur
- 7 excepteur sint occaecat cupidatat non proident sunt
- 8 in culpa qui officia deserunt mollit anim id est laborum
- 9 sed ut perspiciatis unde omnis iste natus error sit
- 10 voluptatem accusantium doloremque laudantium totam rem
- 11 aperiam eaque ipsa quae ab illo inventore veritatis
- 12 et quasi architecto beatae vitae dicta sunt explicabo
- 13 nemo enim ipsam voluptatem quia voluptas sit aspernatur
- 14 aut odit aut fugit sed quia consequuntur magni dolores

<!-- slide fit=off -->
## fit=off — no scaling, no scroll (content may clip)
- 1 lorem ipsum dolor sit amet consectetur adipiscing elit
- 2 sed do eiusmod tempor incididunt ut labore et dolore
- 3 ut enim ad minim veniam quis nostrud exercitation
- 4 ullamco laboris nisi ut aliquip ex ea commodo consequat
- 5 duis aute irure dolor in reprehenderit in voluptate
- 6 velit esse cillum dolore eu fugiat nulla pariatur
- 7 excepteur sint occaecat cupidatat non proident sunt
- 8 in culpa qui officia deserunt mollit anim id est laborum
- 9 sed ut perspiciatis unde omnis iste natus error sit
- 10 voluptatem accusantium doloremque laudantium totam rem
- 11 aperiam eaque ipsa quae ab illo inventore veritatis
- 12 et quasi architecto beatae vitae dicta sunt explicabo

<!-- slide 2col -->
## Per-region fit — one column overflows
<!-- @left -->
This column has far too much content and should scale down on its own:
- 1 lorem ipsum dolor sit amet consectetur adipiscing
- 2 sed do eiusmod tempor incididunt ut labore et dolore
- 3 ut enim ad minim veniam quis nostrud exercitation
- 4 ullamco laboris nisi ut aliquip ex ea commodo
- 5 duis aute irure dolor in reprehenderit in voluptate
- 6 velit esse cillum dolore eu fugiat nulla pariatur
- 7 excepteur sint occaecat cupidatat non proident
- 8 in culpa qui officia deserunt mollit anim id est
<!-- @right -->
Sparse column — should stay at full size.
