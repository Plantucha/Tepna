<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [analysis]
brief: none
---
Two more band-less tools emit exactly one `tepna.verdict/1` each, criteria pre-stated with their sources —
and in both cases the tree holds no criterion, so the status is **UNKNOWN** with the reason. This empties the
adoption census's `pending` bucket: 74 adopted, 133 exempt, **0 pending**.

`tools/deep-desat-falsifier.mjs` is the standing cross-signal falsifier for called sleep stages and could not
say whether the hypothesis is falsified, because no alpha or direction-of-rejection exists anywhere. Read
rather than assumed: `DEEP-STAGE-DESAT-CONFOUND` §7.1 applies "conventional significance" in prose once —
p = 0.1325 on 29 nights against §1's p ≈ 0.03 on 14 — and then **demotes** the sign test to "a robustness
check, not the headline"; `REM-STAGING-REDESIGN` §5 and the literature policy state no alpha either. Choosing
one now, with those p-values on record, would be a threshold derived from the data it judges. Its testability
rider stays a real decision: no usable x-axis range is `NOT_APPLICABLE`, no qualifying night `NOT_RUN`.

`tools/beat-correspondence.mjs` either refused or printed an indel rate with no threshold. No brief states
what rate it passes at (dead-ends §2.7 names the measurement as outstanding, not its bar) and no regime
boundary has been shown, so per `KNIFE-EDGE` §2 / `EDR-THRESHOLD-MARGIN` §3 the sensitivity is published
rather than a band fitted to corpus numbers already on record. Its **refusals become machine-readable**: an
unidentifiable anchor or an all-planes-refused sweep is `UNKNOWN` with `result: null` and `checked: 0` — a
refusal is not a low indel rate — and an absent ECG/PPG pair is `NOT_RUN`.

Both carry a seam (`alpha`, `band`) requiring a **value and a source**, never a default and never taken from
the run; plants prove that even a strongly significant p or a near-perfect indel rate stays UNKNOWN without
one, that a value lacking a source does not count, and that given a sourced criterion each tool decides both
ways. Numeric output is byte-identical. Both also gained parseable selftest summaries and left
`selftest-all`'s `UNPARSEABLE_RATCHET` (21 and 12 assertions).
