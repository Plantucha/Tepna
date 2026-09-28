---
bump: patch
type: fixed
brief: PAT-HAT-DRIFT-DIFFERENCED-2026-09-27-BRIEF.md
---

PAT Classic vs Fused now shows what the worker actually decided about a night, and says which axes its hat
stands on. This follows the owner-ordered audit of 2026-09-28.

What changed:
- **The buffering-corrected lag.** The monitor's "PAT fused" link and the page's own picker now pass both
  Polar devices' arrival sidecars and ACC files, so the page shows the corrected chest → ankle lag beside the raw
  one. On 2026-09-26 that is 342 ms against 499 ms: 156 ms of link buffering had been presented as pulse
  arrival.
- **The gate verdicts.** Every leg shows its gate. chest → finger reads WINDOW-CENSORED, "not a transit time";
  it had been shown as an ordinary 407 ms lag and fed into the hat.
- **Per-leg statistics:** match rate, beat-to-beat spread, drift and censored share.
- **Both drift-removed rows,** each counted as adjacent window pairs.
- **Deltas** print 0 rather than −0.
- **The hat** states that it is solved on raw receive stamps (link buffering included) and flags a gate-rejected
  finger leg.
- **PAT Feasibility's hat cards** read the solver's per-corner status. On 09-26 the chest corner is "underpowered,
  σ < 14.4 ms", not "the independent-error model does not fit".
- **`render()` is now executed by a test** on a whole result. No test ran it before, which is how the refusal
  wording shipped.
