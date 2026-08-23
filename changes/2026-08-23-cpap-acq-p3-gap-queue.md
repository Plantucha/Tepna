<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md
---
CPAP acquisition gap-accounting layer (audit G4/G7): `cpap_ingest.py` — `classify_frame` makes a foreign-streamId or malformed StreamData frame COUNTABLE instead of silently dropped (INV7: a transport gap is represented explicitly), `GapCounters` folds each frame kind into a flat stable summary (`total_lost` excludes foreign frames — they were never ours), and `BoundedIngestQueue` records overflow rather than dropping silently under backpressure. Pure logic, 17 tests, 100% branch. Standalone module — the P1+P3 ingestion wiring into capture.py/cpap_stream.py lands as one announced touch after the feature-arm controller-race fix.
