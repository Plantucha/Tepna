<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

WEARABLE-DRIFT-DIRECT flipped PROPOSED -> DONE, verified against the tree rather than stamped.

A `[x]` is a claim about the day it was written, so each §6 item was re-checked in the file that would
carry it. The one CONDITIONAL in §6 was the only thing that could have blocked the flip, and it was
settled by measurement rather than by reading.

THE CONDITIONAL. §6 records: "every ppm here is measured against the CAPTURE HOST's clock. A
125/stratum capture change was in flight on 2026-08-08; if it alters how the host stamps or disciplines
time, these baselines and the maxTolerableDriftPpm verdicts citing them must be re-measured."

Rather than establish what that change was, the baseline was re-run with this brief's OWN instrument
(tools/dual-clock-rate.mjs) across nights spanning it - the direct test of the thing the caveat is about:

    night        H10 ppm   Verity ppm   inter-device
    2026-07-25    -18.7      -27.1          8.4
    2026-07-27    -20.3      -27.6          7.3
    2026-08-01    -20.9      -28.6          7.7
    2026-08-07    -21.7      -28.5          6.8      <- after
    2026-08-10    -19.8      -28.4          8.6      <- after

§7.2 claims H10 median -20.3 [-18.7..-21.6] and Verity -27.0 [-23.9..-30.2], inter-device ~6.7.
Re-measured: H10 -18.7..-21.7 (median -20.3, IDENTICAL), Verity -26.0..-28.6 (inside the stated band),
inter-device 5.7-8.6. The nights AFTER the change match the nights before it, so whatever it did, it did
not move the baseline. Caveat discharged by the measurement it asked for.

REMAINING ITEMS, each checked where it would live: the tool ships and was re-run (a two-column
regression, no beat code reached); repeatability holds across 17 days; the O2Ring's unusable timebase is
independently re-confirmed (it fails a chi-squared-weighted crystal test on 2026-08-01 at chi2red 6.30
while all 39 other device-nights pass); the no-second-clock refusal is present and fires on every short
fragment; the paper's scope note carries the correction in place ("the H10 runs -20.3 ppm and the Verity
-27.0 ppm versus the capture host ... ~7 ppm, not 90-216 (over 7 h: 202 ms, not 2.5 s)"); and the leg-C
item is superseded by §7.5, where the closure closes 4 of 4 box nights with tools/beat-leg-closure.mjs
shipped and self-tested.

The single [~] is a same-day retraction record, not an open item, and is left as-is: deleting a withdrawn
claim is how a correction chain stops being auditable.

NOT CLAIMED: the flip says every acceptance item is met, not that the drift question is closed.
CROSS-DEVICE-DRIFT-AND-CLOSURE §5 still holds one open PAT item and §7.4's estimator warning stands.

DOCS-INDEX synced via tools/sync-docs-index.mjs - the docs-ledger gate caught the stale row (check3b,
"index PROPOSED != header DONE") and named its own fix.
