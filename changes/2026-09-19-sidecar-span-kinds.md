<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---
The constant-run sidecar names what a span IS — two measured kinds, `unknown` everywhere else
(owner ruling D1, 2026-09-19).

The 2026-09-19 finger-off capture (three removals, six independent off-finger stretches) settled the
question the 2026-09-18 census left open: the O2Ring's raw pleth reads **exactly 100 with no finger**
— 100.0 % of 14,982 / 5,757 / 15,023 / 2,690 / 14,961 samples, one unbroken run each — and **zero is
not idle**: 0 and 199 occurred only while worn. Three populations, two kinds:

- `absence` — the ring is not on a finger; exclude like a gap (§∅).
- `in-wear-rail` — a rail event while worn. A statement about **observation**, not mechanism: the
  capture says what 0/199 are *not*, never what they *are*.

`writers.RUN_KIND_BY_STREAM` carries the table per stream and only the values a controlled capture
established; `run_kind()` returns `unknown` for any other value or stream — the Verity's 2,096,921
rail and the ring's 99/124 stay `unknown` until someone measures them. The kind rides as a **ninth
column** (`…;closed;rule;kind`, appended so `ppgdex-dsp.js parsePinnedRuns`, which accepts ≥ 8
fields and reads by index, parses the new shape unchanged — asserted) and the rule line gains a
`kinds=` token so an empty sidecar still states what would have been named. `unit=` is the value's
physical unit and is untouched.

**Emission is unchanged, deliberately.** 100 is in-band — a worn pleth sits on it in plateaus up to
41 samples (2,492 once) — so the kind labels rows the run-length rule already chose rather than
pulling short 100-plateaus in as "absence"; plant-tested with and without the table. The deferred
`min_run` decision therefore concerns the rails alone. No refold; nothing under `/srv/tepna/captures`
is touched; no consumer reads the kind yet — that is the semantics unit the owner has not assigned.
