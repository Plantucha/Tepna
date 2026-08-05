<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md
---

docs: arbitrate the H10 ECG rate against the vendor's own decode (PSL corpus, 50 files) — the repo
states it four different ways and none is right; measured +47 ppm, and it is a REAL clock, not a drawn
one. Plus a fleet-wide mutation ranking showing concentration predicts pass cost, and `polar_pmd` tests
grounded in a real 7.45-year device-clock offset.
