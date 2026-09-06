<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: none
---
The oracle's overlap-split rule had two definitions.

`tools/pat-ecg-axis-residual.mjs` carried its own `oracleSplit`, under a comment that named the cause
exactly: *"pat-window-oracle.mjs oracleNight does not export its split"* — the absent abstraction
written down in the codebase's own hand.

`overlapSplit(rTimes, fTimes)` is now exported from `tools/pat-window-oracle.mjs` and `oracleNight`
consumes it, so the rule has one definition and the refusals travel with it (the self-evidencing
"no overlap" message reaches both callers instead of one degrading to a bare `null`). The consumer
keeps a thin `{refusal} → null` wrapper because its two call sites already branch on `null`; that is
a shape adapter, not a second copy.

**Deliberately NOT a call into `oracleNight`**, per the row: mode-finding and the circular-shift null
are work this consumer does not need, and that cost is why the copy was made in the first place.

Two plants, and the second exists because the first was not enough. The obvious asymmetric case has
the feet ending AFTER the R beats, so `min(R.last, F.last)` *is* `R.last` — a mutation taking `hi`
from the R train alone is behaviour-preserving there. Measured: it left the selftest at 27/27. The
mirror plant (feet starting and ending BEFORE) puts `lo` on the R train and `hi` on the feet, and
catches it: `mirror hi must come from the FEET train (1073823.94 vs 896711.35)`. One asymmetric case
constrains one endpoint; both endpoints need both directions.

Also asserted by source scan that the consumer no longer defines the rule and does import it, with a
readability check first so a missing file cannot vacuously pass both.

Neither tool is in `build-analysis.mjs TOOLS`, so no rebuild and no `verify:analysis` churn; both
already carry `tools-index` rows.
