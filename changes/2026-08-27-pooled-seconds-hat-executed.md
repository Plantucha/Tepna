---
bump: minor
type: added
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

`tools/tch-pooled-hat.mjs` (new) computes the **pooled-seconds hat** alongside the seconds-weighted and
median-over-nights estimators, plus the exact algebraic term that separates them — turning
`tch-fused-corpus`'s own printed caveat (*"a median over nights is NOT the pooled-seconds hat"*) into
something computable. 6/6 planted-truth selftest, including the identity and a demonstration that a
median differs from a seconds-weighted mean when night lengths differ. `solveNight` is now **exported**
from `tch-fused-corpus.mjs` with additive per-night pairwise moments, so the per-second alignment is
single-sourced rather than duplicated.

Executed over 54 nights / 939,566 pooled seconds against the pre-registered test in
`SENSOR-TRIO-NIGHTS-PAPER` §10.

**The identity is exact** — `σ²_pooled − σ²_weighted = ½(B_AB + B_AC − B_BC)` holds to ~1e-16 on all
three corners.

**❌ The pre-registered mechanism is REFUTED.** `B`, the between-night bias variance predicted to explain
the σ_Verity spread, is **0.1 %** of pooled variance on every pair (H10↔Verity: within 3.657, B 0.003).
The per-night pairwise biases barely vary, so pooled ≈ seconds-weighted to 0.0007 bpm. Per the
pre-stated rule this is reported as refuted, not talked up as partial.

**✅ Estimator choice is the real effect: σ_Verity spans 0.72 → 1.35 (×1.9) on identical nights** — fused
median 0.72 (n=44), unweighted median 0.95, plain median 1.14, pooled-seconds 1.35. That covers the
published 0.94–1.03 and approaches 1.42, reconciling two of the three disputed figures via
median-vs-pooled non-linearity and confidence weighting rather than between-night bias.

🔴 **3.51 is not reachable by any estimator choice over this corpus** (family spans 0.72–1.35), so it
differs in corpus, filtering or quantity — retiring an entire class of explanation.

⚠️ Side-finding: the **fused** estimator produces **10/54 negative-variance nights vs 0/54 unweighted**,
so its 0.72 is a median over n=44 — the nights its own solve failed are excluded, and the exclusion is
correlated with the quantity being estimated. Never quote the fused σ without its n and its exclusions.
