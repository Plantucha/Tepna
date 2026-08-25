<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [CPAPDex]
brief: CPAPDEX-STR-SUMMARY-INGEST-2026-08-21-BRIEF.md
---
Cross-validate the device's STR Cheyne-Stokes % (`deviceCsr`) against CPAPDex's own CSL periodic-breathing % — a declare-never-correct corroboration read (`csrPbCrossCheck`, wired into `attachStrSummary`, touches no metric). The band is asymmetric by physiology, pre-stated before any real night: Cheyne-Stokes ⊂ periodic breathing, so PB ≥ CSR is benign (`pb-broader`) and a device CSR substantially exceeding our PB is the finding (`discrepancy`, we under-detected the device's CS). New `csrPbDelta` registry metric (measured), a reference-guide card, and a device-summary render line; the STR brief's item 1 is closed with evidence.
