<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
**The O2Ring's PPG frames now land on the SAME arrival sidecar the Polars use, so the finger finally has
an arrival-floor axis.** Until now `_PMDARRIVAL.csv` carried only `OXYLIVE_DURATION_S` rows — one per
1 Hz vitals poll, the ring's session-second counter in the ns column — and no frame rows at all.
`pat-feasibility` builds a per-connection arrival floor from this one file shape, so no corrected PAT hat
could include the finger (residue `2026-09-28-ring-has-no-arrival-floor-axis-so-no-corrected-pat-hat`,
brief row E11). The cost is visible in the hat: chest→finger is a flat UNIFORM 200–620 ms plateau
(pair spread 137 ms) against a 60 ms-wide peak for chest→ankle, and the Verity corner refuses
UNDERPOWERED because the hat subtracts one ~400 ms-wide uniform from another.

Per delivered frame: the host arrival stamp, the DELIVERED sample count, and the ring's **own**
cumulative stream position — `oxyii.ppg_stream_offset`, `[20:24]` u32 LE, decoded since 2026-07-18 and
until now read by nothing (the vendor's SDK discards it too). A new last column `first_sample_idx`
carries it, because a position in samples is what the ring actually knows.

∅ **The two ns columns are BLANK for the ring, never 0.** It has no clock — not one we distrust, none at
all — and a 0 there reads as "this frame's first sample is at the epoch", which would let a floor be
taken against a fabricated zero and come out plausible and wrong. The writer already blanked `None`
("blank, never a fabricated 0"); this uses it rather than inventing a sentinel.

⚠️ **One file, one shape.** The sidecar is append-on-resume, so a resumed session re-opening a file that
carries the OLD six-column header would otherwise write seven-column rows under it — a file whose own
header lies about half its rows. The width is therefore read FROM THE FILE: a narrow file stays narrow
for life and drops the position; only a fresh file gets the column. The new argument is optional and
LAST, so every Polar call site is byte-identical in each field it writes.

**Nothing in the samples changes** — this adds a row to a sidecar and touches no stream. Effect begins
with the first night after the box restarts on it. The CONSUMER side (a corrected hat that reads the
ring's floor) is a separate unit.
