---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

The fleet board's runner verdict reached the page as a `<div class="meta">` inside the header: 12 px,
`--dim`, the same class and size as the host name and the URL beside it. A failing CI run renders at
18 px bold inside a bordered `.banner` block. So the one condition that puts every number below it in
doubt was the quietest element on the page.

The verdict now enters the banner list, and it enters it first, ahead of the cards whose numbers it
doubts. Measured drift takes the red level. A renderer the board could not compare with the ref takes
amber and names
the files it could not read, because "I could not look" and "they match" are opposite answers. A
renderer whose code matches the ref still raises nothing, however far behind on commits it sits.

Two pure functions carry it, `runnerBanner` and `withRunnerBanner`, with ten planted cases including
three controls. The digest line picks the red one up for free, since `summarize` already prints every
red banner.

This changes what a reader sees, not what the renderer runs. The row that asked for it stays open:
advancing the shared checkout, or pointing the unit at a dedicated one, is a deploy outside the repo.
