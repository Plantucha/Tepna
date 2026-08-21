<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [CPAPDex]
brief: CPAPDEX-STR-SUMMARY-INGEST-2026-08-21-BRIEF.md
---
CPAPDex ingests the ResMed STR.edf daily summary (`parseStrSummary` +
`attachStrSummary`): the device-declared therapy mode, device-scored RERA
(`deviceRera`) and CSR (`deviceCsr`), and the prescription (EPR/pressure
range/ramp/mask). Three `measured`-tier registry metrics
(deviceMode / deviceRera / deviceCsr) + a badged device-summary strip.
The inferred `classifyMode` is untouched; unknown mode codes refuse a label.
Validated against the real box STR.edf (19 nights).
