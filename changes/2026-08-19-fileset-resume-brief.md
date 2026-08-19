---
bump: patch
type: added
---

**`CAPTURE-FILESET-RESUME-2026-08-19-BRIEF` — P2.2 gets its own executable brief, remeasured before
proposing.** P2.2 was written off one bad night (189 O2Ring sets under a wedged adapter); the full corpus
says fragmentation is the **steady state**: **2,154 file-sets across 76 device-nights = 28.3×**, with the
Verity at a median 15 and a p90 of 238 sets per night.

⚠️ **The dominant driver is no longer the flapping link P2.2 named — it is the `drop_not_worn` duty
cycle** (drop at 180 s → recheck every 90 s → each reconnect mints a full set). That machinery is correct
and stays; its cadence sits *inside* the 300 s resume window, so resume collapses exactly the churn it
generates. A design that only handles link flaps misses the majority case, which is why the brief was
remeasured rather than inherited.

The brief carries the design (resume < window, same device+night, gap row spanning the outage; a true
outage still fragments — that fragmentation is information), five non-regression invariants each phrased
as a test (gap-accounting equality, no `t0Ms` re-anchor, sidecars unaffected, duty-cycle + doff-pull
interaction, torn-tail safety), and a Done-when that includes a real Verity duty-cycle night measured on
the box.

Measurement note: the corpus count took **three instrument corrections** — `[A-Za-z]+` excluded `H10`,
then `[0-9A-Fa-f]+` excluded the O2Ring serial `S8AW2100` (not hex). Each partial count looked complete.

No code change. Gate: docs-ledger 38/38.
