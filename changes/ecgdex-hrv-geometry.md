---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

ECGDex exposes `triangularIndex` and `fragmentation` (additive export) so the HRV geometry metrics
can be gated by known answer. Both were pseudo-tested — computed by `analyze` on every run and
asserted by nothing, with even `N / maxC` inverted to `maxC / N` passing the committed golden. Now
pinned against the Task Force 1996 definition (total NN ÷ histogram height at 1/128 s bins) and the
PIP/IALS/PSS run-length algebra, all hand-derived. Verified by re-applying the mutants: 7 killed,
1 documented as equivalent.
