---
bump: patch
type: added
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

**The parity gate both sides asked for in writing.** `capture-host/writers.py:70-73`, above `T_STUCK`:
*"This constant is the single source… If a JS side ever recomputes these spans, that constant must be
asserted equal to this one by a gate that has been shown to RED on a mismatch."* And `ppgdex-dsp.js:374`
from the other side: *"Single-sourcing with the Python writer's defaults… + a parity gate reading both
— lands with that writer; until it exists there is nothing to pair with."* The writer exists now, so
the pairing was owed.

**Four pairs already agree exactly** and are pinned so a one-sided edit reds instead of drifting:
`PIN_RAIL_SCAN_VALUES ≡ _RAIL_SCAN_VALUES` (8) · `PIN_RAIL_GAP_MAX ≡ _RAIL_GAP_MAX` (4) ·
`PIN_RAIL_SPIKE_MIN ≡ _RAIL_SPIKE_MIN` (5) · `PIN_MERGE ≡ _ANNOTATION_GAP_MAX` (8).

🔴 **The fifth is pinned as a DISAGREEMENT, with its reason — because it is a category difference, not
drift.** `PIN_MIN_RUN = 5` asks *"is this run a blanking EVENT?"*; `T_STUCK = 200` asks *"is this stream
STUCK?"* — 1.6 s at ~126 Hz. `RUN_MIN_BY_STREAM` maps **every** stream to `T_STUCK`, so the sidecar
records only runs clearing the stuck bar.

Measured 2026-09-15: of **122 stream-sidecars on disk, 118 carry zero span rows** and 4 carry one —
while the in-JS detector at 5 finds **32 407 affected intervals across 2607 files** (#2531). The two
witnesses do not disagree about the data; they answer different questions. And CLAUDE.md §∅'s own
measurement of the phenomenon — *149 runs, 105 of them ≥ 10 samples, the longest 78 (0.62 s)* — sits
entirely **below 200**, so the sidecar cannot record the thing it was built for.

⚠️ **The gate deliberately does not pick a value.** Moving either constant is an owner call with a
corpus cost; what a gate can do is make the divergence impossible to edit silently and carry the reason
beside it. It also matters for a consumer: `ppgdex-dsp.js:374` says *"THE FILE WINS for what was
observed"* — sound in general, and dangerous here, since deferring to a sidecar that is empty **by
construction** would undo the exclusion landed in #2531.

Mutation-verified in all three directions: moving the JS side of a pair reds, moving the Python side
reds, and moving the pinned disagreement (`T_STUCK`) reds. A non-vacuity assertion guards the
extractors — the first version read the rail constants from `writers.py`, where they do not live (they
are in `nightqc.py`), every Python value came back `null`, and four equalities would otherwise have
passed on nothing.

Also stamps `OPERATIONAL-MATURITY-AUDIT-2026-08-27` **DONE** for its own scope — the §1 audit and §15
ranking, re-verified against current `main`: every identifier its §2 table cites is present, and P#4's
claim is an absence that still holds (no `Manager`, `Orchestrator` or `Semaphore`). ⚠️ That stamps the
AUDIT, **not** the ROADMAP: the 2026-09-06 owner ruling keeps the roadmap open for §13/§14, which are
untouched, so *"every mechanism has an implementation"* must never be read as *"the system is
unattended-ready"*.
