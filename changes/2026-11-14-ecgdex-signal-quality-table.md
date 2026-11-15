---
bump: minor
type: added
brief: SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md
---

Add the per-channel signal-quality table to the ECGDex rich export, as `signalQuality`.
Each cell holds a finite value with no reason, or `null` with a named reason.
The node also reports what it did with each of the 25 sidecars the census registry declares.
The `sidecar-census` gate holds that ledger against the registry's names, files and labels.
