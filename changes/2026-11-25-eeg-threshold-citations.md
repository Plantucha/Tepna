<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: EEGDEX-STAGE-FORMULA-2026-11-24-BRIEF.md
nodes: [EEGDex]
---

The three published thresholds of the EEG feature block now name their sources.

`eegdex-stage-features.js` carried four slow-oscillation criteria, four spindle
thresholds and a 75 µV frontal figure, and it called each one "published" without
a citation. A reader could not check one of them. Each set now names its author,
year, journal and DOI in the comment beside it, and each DOI sits in
`audits/CITATION-VERIFICATION-2026-08-05.json`.

The comments also carry the two limits the sources state about themselves. The
2004 paper read those slow-oscillation criteria on a local average of the scalp
and not on one channel. This block therefore defaults to the scoring manual's
figure. The 2025 paper restates the manual rather than deriving the 75 µV, so the
comment names it as a restatement.

No threshold moved and no code path changed.
