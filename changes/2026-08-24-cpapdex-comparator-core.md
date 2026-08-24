<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [cpapdex]
brief: CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF.md
---
CPAPDex live-vs-SD comparator core (owner-ordered). `cpapdex-cross.js` `cpapCompare`/`compareChannel`: align a BLE-live BRP channel to its device SD twin on the device clock (fine-lag xcorr on top), then scale/offset regression + Bland-Altman (bias + limits of agreement, never Pearson r); refusal-first (no-overlap / one-file / missing-channel each refuse with a reason); the alignment offset is a first-class finding, and a large clock disagreement REFUSES and quantifies it (defect detection, not align-through — the EdfSink-bug class). 11-assertion dex-tests group. The rendered surface (panel, CPAP_REGISTRY metrics, reference-guide row, windowed scale-over-time, the real live-vs-SD equiv fixture) follows.
