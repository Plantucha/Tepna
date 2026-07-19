<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [oxydex, ecgdex, ppgdex, pulsedex, cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`trendLabel` took its **direction** from the OLS slope and its **significance** from Mann–Kendall — so the sentence *"there is a significant trend, and it is improving"* was assembled from two different estimators.

They disagree exactly where it matters. Mann–Kendall is rank-based and robust; OLS is leverage-sensitive. A single endpoint outlier flips the slope without moving τ, and the audit measured **"improving" printed beside τ = −0.6 on 10.3 % of endpoint-outlier series**.

Direction now comes from **τ** — the statistic that decided the trend was real in the first place. `slopePerDay` is still reported separately as the magnitude; this changes which estimator names the *direction*, not what OLS is for.

Where the two disagree, the series has endpoint leverage worth knowing about, so it is **reported** (`trend.dirDisagree`) rather than silently resolved.

Gated on a case that reproduces the audit's scenario: twelve monotonically declining nights plus one large final outlier gives **τ = −0.67 at p = 0.003** (significant, declining) while the outlier drags the OLS slope to **+2.13**. `meanSpo2` is `goodDirection:'up'`, so the pre-fix label read **"improving"** — the exact contradiction. Mutation-verified: restoring OLS as the direction source reproduces `"improving"` and clears the disagreement flag. The ordinary agreeing case is asserted unchanged, so the flag is not always-on.

Applied to all five `*-cross.js` clones. `dirDisagree` is additive on the crossnight envelope, which needed forwarding through `crossnight-envelope.js`'s hand-picked `trend` projection — the same shape that hid GlucoDex's truncation field: a value added to an inner object is invisible to every consumer until the projection names it. The CPAPDex multi-night golden was regenerated for the additive field; all other fixtures reproduce byte-identical.
