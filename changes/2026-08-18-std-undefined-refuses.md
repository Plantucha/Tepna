---
bump: patch
type: fixed
brief: FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md
---

**`std` returned `0` for fewer than two observations — the last unchecked box in FABRICATED-DEFAULTS-FLEET §7.**

The sample standard deviation of one observation is **undefined**: the denominator is `n − 1 = 0`. Returning
`0` claims *"no variability"* from data that cannot support the claim, and on an HRV surface an SDNN of
0 ms reads as a perfectly regular heart. Two sites, the last two in the fleet:

| file | was |
|---|---|
| `ppgdex-dsp.js` | `if (a.length < 2) return 0;` |
| `hrvdex-dsp.js` | `arr.length > 1 ? Math.sqrt(…) : 0` |

Both now return **`NaN`**.

**NaN, not `null`, and the choice is the whole fix.** Every caller that declines here tests with `isNaN`
or an `|| fallback`, and **both `isNaN(null)` and `isFinite(null)` are `false`** — so `null` would have
sailed through every existing guard and converted a visible refusal into an invisible one. That is the
mistake this brief exists to prevent, committed inside its own fix. `NaN` matches what each file's own
`mean` already returns for an empty array (and hrvdex's sibling `pearsonCorr` for `n < 2`), so the honest
answer was already present in both files — this is inheritance, not invention.

**This is a DEFENSIVE fix, and the evidence is measured rather than asserted.** No current public path
can reach it: `timeDomain` returns `null` under 2 and clamps `base` to ≥ 2 · `sampEn` guards `N < 60` ·
`magInterfAtSec` guards `< 3` · both hrvdex call sites pre-check `length > 1`. Verified end-to-end by
differential execution — **66 public-call comparisons across 11 exported functions on six degenerate
inputs, `origin/main` vs fixed: 0 differ.** Consistent with the brief's corpus measurement (0 exact-zero
`sdnn`/`rmssd`/`sdnnIndex` across 132 real exports), and it is why no golden needed regenerating, unlike
PpgDex #1464 where three had the fabricated `0` byte-pinned.

**So the assertions pin the reason the fix is safe, not the fix.** A new group
(`ppgdex-dsp · degenerate-refusal`, 8 legs) asserts that the *public boundary* refuses degenerate input —
`allanFromPhase` → `[]`, `detectorStability` → `null`, `riseFraction` → `null`. Testing `std` directly
would assert a line that nothing calls; this fires if any of those guards is ever removed, which is the
event that would make the fabricated `0` reachable again.

⚠️ **The anti-vacuity legs earned their place immediately.** Without them the group passes if every
function simply always refused — the mirror-image fabrication (absence invented instead of presence,
§6.2). The first draft used 16 points as "adequate input" and the leg **failed**, revealing that adequate
had been assumed rather than measured: `riseFraction` is `null` at 16 and `0.713` at 64. 64 is now the
measured floor, and `detectorStability` — which needs a different call shape — stays in the refusal legs
only, because an anti-vacuity leg that cannot be made true is not evidence.

Registry tiers untouched; a refusal fix, not a re-grading.
