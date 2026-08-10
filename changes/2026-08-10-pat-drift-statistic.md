---
bump: patch
type: fixed
brief: PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md
---

PAT gate: `driftRange` is bounded by the 450 ms pairing window and saturates there (nine box nights
over ~6 h all read 420–442), so it can neither rank nights nor fail safe. `PATGate.verdict` now weighs
`stepP95` — the p95 |Δ bin median| between bins adjacent in index — over bins qualified by match rate
and their own IQR. The 60 ms / 250 ms bars are unchanged; only the quantity compared against them
moved, and `driftRange` stays in the payload as a diagnostic. Bins previously had no minimum pair count
at all, so a bin holding one paired beat cast a full vote. Phase 0 on the box corpus goes 0 → 8 GO.
