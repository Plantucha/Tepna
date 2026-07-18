<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
Anchor `signal-orchestrate.js fnameStampMs` so a NUMERIC Polar device id is no longer parsed as the date. The unanchored regex consumed the id and kept only the month digits of the true stamp, collapsing every H10 file in a month onto one value; `pairCompanions`' nearest-stamp tiebreak then degraded to "first candidate of that kind". Measured on the real 250-file corpus: **147 of 153 companion slots paired to the wrong night** (51 ECG primaries), fixed to 153/153. Affects multi-night drops in Data Unifier + OverDex only; single-night drops were always correct, and the app path (`dex-ingest.js`) was already anchored. Adds a numeric-id two-night gate — every prior `pairCompanions` test used a lettered id, which structurally cannot reproduce this.
