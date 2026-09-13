---
bump: patch
type: changed
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

E1 executed against the full SHHS1 corpus: the ECG-only stager does **not** transfer to clinical PSG.
Cohen's kappa 0.0967 +/-0.0031 over 5134 records and 505 868 epochs, against pre-stated bands of
>=0.60 transfers / 0.40-0.60 partial / <0.40 does not. The misalignment alternative was tested and
excluded by a lag scan, which is plant-verified in both directions.

The brief's §5 derived-artifact question is ruled (owner, 2026-09-13): aggregate statistics may be
committed, per-record rows and record identifiers may not.

Tooling: the worker pool now drives any scorer via `liveStat`, the kappa half-width is cluster-robust
rather than assuming independent epochs, and the stage validator can diagnose a shifted detector
rather than only grade it.
