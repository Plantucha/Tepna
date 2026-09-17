---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The claim that the node DSPs collide — which decides whether the harness remedy is one page or three —
does not hold for current code.

`2026-09-16-cohort-harness-broken-since-esm` names the remedy: give `build-analysis.mjs` ownership of
`cohort-harness.html` so it inlines classicified sources. Whether that works hinges on a comment in
`nights-icc-analysis.js`:

> *"OxyDex and PulseDex collide on bare globals, so OxyDex must be its own realm"*

If true, one page cannot serve all three nodes and the remedy needs **three** generated files plus a
consumer change at every `?node=` call site.

**Measured 2026-09-17.** All three node DSPs plus their shared dependencies co-load into a **single
realm** with **zero page errors**, and `OxyDex`, `PulseDex`, `GlucoDex`, `DexKernel` are all defined.
Statically they share nothing either: **zero** overlapping `window.X =` assignments and **zero**
top-level declarations of any kind — every file is fully IIFE-wrapped.

## ⚠️ This is a load test, not an execution test

Analyses were **not run concurrently**, so a collision arising during `analyze()` — shared mutable
state, a global assigned mid-run, worker pools contending — would not have shown. The claim is
**unverified in the direction that matters**, not refuted.

What *is* established is the thing the remedy needed: nothing prevents the three from being inlined
together. Stating that boundary matters more than the result, because "co-load is clean" would
otherwise be read as "the realms are unnecessary", which this does not show.

## Why the claim was worth testing at all

Its origin is a **comment**, not a test, and it may simply predate the IIFE wrapping. That is the same
class as the header comments which had me counting five harness consumers when only one actually loads
it (#2572) — a comment that constrains an architecture and is never asserted drifts silently, and the
cost lands on whoever plans work around it.

Filed as `2026-09-17-node-realm-collision-claim-unverified`.
