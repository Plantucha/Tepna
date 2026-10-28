---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

The verdict-adoption gate ran every adopted producer under one fixed 120 s cap and reported a cap
hit as a failed adoption. Under box load that read as a red from the diff under test, and it halted
`run-check` at step 38 of 41, so steps 39 to 41 never ran.

A cap hit now says it could not look. The gate collects those paths as `unexamined` rather than as
errors, prints `⏱ UNEXAMINED <path>` with the cap, the elapsed time and the one-minute load, and
exits 2 where exit 1 still means it read a producer and the adoption failed. The summary counts
them separately, as `adopted N (validated X, unexamined Y)`.

A producer may declare its own `timeoutMs` in the manifest, bounded at 900 s. One producer needs it:
`tools/xerj-load.mjs` walks the doc-search cache in 25.5 s idle and 1 m 48.7 s at load 44, against a
median of 22 ms over the other 166. Its declared cap is twice the loaded observation, the sizing
rule `tools/workflow-timeout-guard.mjs` already states, and the sample date sits beside it.
