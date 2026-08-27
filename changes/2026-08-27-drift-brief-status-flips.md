---
bump: patch
type: changed
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

Both drift briefs' headers now say what the measurement concluded, instead of their pre-conclusion states.

**`CROSS-DEVICE-DRIFT-FOLLOWUPS` → DONE.** 4 `[x]`, 1 `[~]`, **zero open**. The partial item declares
itself not closable from inside: *"Closing this half needs σ_y computed in `dual-clock-rate`, which is a
separate work-unit"* — and `dual-clock-rate` computes no per-fragment uncertainty at all, so the shared
verdict correctly takes its no-uncertainties branch. Recorded as a **deferred sub-item inside a DONE
brief** (§📌 permits exactly that) rather than holding a whole brief open on another one's work.

**`CROSS-DEVICE-DRIFT-AND-CLOSURE` → PROPOSED (deferred), not DONE.** 8 `[x]`, 1 `[⛔]`, zero open. §📌's
status vocabulary is exactly five values and **BLOCKED is not one of them**, so a brief whose only
remainder is blocked is parked with the reason inline. Flipping it to DONE would claim work that has not
happened.

Both flips cite the finding that produced them: the closure's passing set is an artifact of weak tests.
Verdicts separated **perfectly by band width** — the three PASSes held the three widest bands (9.64 /
12.49 / 20.56), the two FAILs the two tightest (4.16 / 0.71), no overlap. **A dispersion-derived band used
as an inclusion gate anti-selects for measurement quality**, so every night where the test had power, the
closure failed. 2026-08-24 "passed" on a ±20.56 ppm band, wider than the entire measured spread of device
rates — computable, and carrying no information.

So the box does **not** unblock by widening bands or adding more nights of the same kind: it needs nights
with ≥2 fragments per device **and** consistent legs. The present corpus is mostly single-fragment (H10 on
20 of 33 nights, Verity on 18).

DOCS-INDEX rows updated to match both headers (the `docs-ledger` check3b gate requires it, and caught the
mismatch mid-edit). ⚠️ The index patch is applied **by line with an identity assertion**, because
`PROPOSED 2026-08-17` matches **two** rows — a blind string replace would have restamped an unrelated
brief.
