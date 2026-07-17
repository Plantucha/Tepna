<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md
---
Add a known-answer gate for the NSRR PSG ingest adapter — pins SpO₂/HR channel matching, 1 Hz resample (dropout forward-fill + leading-NaN backfill), the Clock-Contract EDF→OxyDex row conversion, AHI severity bands, and (browser lane) profusion-XML → AHI scoring; the parser had zero coverage.
