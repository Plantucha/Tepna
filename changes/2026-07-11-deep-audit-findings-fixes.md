<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: security
nodes: [GlucoDex, OxyDex, ECGDex, PulseDex, suite]
brief: none
---
Fix six independent deep-audit findings (DEEP-AUDIT-FINDINGS-2026-07-11): escape the GlucoDex meal label at its innerHTML sinks (stored + nutrition-CSV XSS); withhold OxyDex Readiness instead of scoring absent hypoxia as a perfect night; align ECGDex validateRR's RR bound to buildNN (2000ms) so the device cross-check is apples-to-apples; unify PulseDex's RR-plausibility upper bound to 2000ms fleet-wide; correct SignalSpec.cgm.unit to mg/dL.
