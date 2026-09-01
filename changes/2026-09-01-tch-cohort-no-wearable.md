<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [trio-corpus]
brief: none
---
`tch-multinight`'s cohort classifier read a night with NO wearable export as `pre-host-axis` — the
marker is read off PpgDex's `quality.timingSource`, so absence of the device was indistinguishable
from absence of the field, and the 2026-09-01 refold's 46 early no-wearable nights raised a false
MIXED/CONFOUNDED banner over a single-generation corpus (visible in #2036's run).

Two changes, both in `TchCorpus` + the reader:

1. **The marker is tri-state.** `undefined` = no PpgDex export seen ⇒ NO cohort (absence of the
   wearable is not old-code evidence); `null` = a PpgDex export without the field ⇒ `pre-host-axis`
   (the genuine old-code signature); any value ⇒ `post-host-axis`. `readNightDir` now sets it.
2. **The MIXED/CONFOUNDED banner fires only when two cohorts BOTH contribute σ solutions.** A cohort
   whose nights never solved enters no median and cannot confound one; it is named in the verdict
   ("non-contributing"), not hidden.

Fail-closed is preserved and strengthened: all-uncohorted refuses as UNREADABLE (a corpus with no
wearable anywhere is indistinguishable from a reader that read none, and has no trio σ to quote),
all-legacy still refuses, and a new refusal catches the dropped-field signature directly — a SOLVED
night with no cohort is impossible on real data (a solved night has a PpgDex export), so it can only
be a reader that rebuilt its row object and lost the field, the exact first-wiring bug this module
exists to catch.

On the refolded corpus the report now reads *"all 69 cohorted night(s) from one producing code
version (46 night(s) without a wearable carry no cohort and are not old-code evidence) — medians
are corpus figures"*; medians unchanged (0.42 / 0.44 / 1.02). Selftest 30/30; the `tch-corpus ·
homogeneity` group extended to 31 assertions covering the tri-state, the solutions-gated banner,
and all three fail-closed shapes.
