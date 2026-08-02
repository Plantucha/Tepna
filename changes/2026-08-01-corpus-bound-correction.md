<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Corrects §2.5's account of *why* the drift corpus is six nights. The original reason — "the O2Ring's live PPG capture began 2026-07-25" — is true but incomplete, and would send a reader looking in the wrong place.

Counted across every tree on disk: **raw H10 ECG on 40 dates, raw Verity PPG on 7, raw O2Ring PPG on 7** — both optical devices begin on the same date. The chest ECG is plentiful; the binding constraint is the **optical waveform**. 07-31 then falls out on a zero-row SpO₂ anchor, leaving six foldable.

And `trio-onset`'s 36 nights are not a larger corpus in disguise: **0 of 36 carry `timeseries.ppi`**. They were folded before the beat series existed, a beat series can only come from a fresh fold, and the June raw is gone from every tree.

That is the third time in one night a measurement has been bounded by raw data discarded after folding — with 2026-07-23's clock-fit night and the ODI-4 paper's corpus. The brief now names the pattern: **an export is not a substitute for its input.** Once a new field is added, every night whose raw is gone is permanently out of reach for it. No retention policy is proposed; the point is that "we still have the exports" is not an answer to the question.
