<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
`--timing-point foot|peak` — test whether the PPG timing point explains §3f's intermittency. It does not.

§3f.4 listed two candidate explanations for coupling appearing in some windows and not others: the physiology, or the residual offset. **There is a third it did not list** — the timing point itself. The foot is the standard for PAT/PTT and what `O2RING-PPG-GAP` §3 argues for on PPI grounds, but it is also the *harder* of the two to detect in low-perfusion PPG, so windows could lose coupling because foot detection degraded rather than because anything physiological or temporal changed. `consensusBeats` already returns both series, so the question costs one argument to ask.

**Measured corpus-wide under `--scan` so the comparison is fair:** over **45 comparable windows** the two are statistically indistinguishable — paired foot − peak **−0.5 ± 5.1 points**, median **0.0**, **40/45 significant under scan for each**, mean best-scan foot 20.4 % vs peak 21.0 %. The third explanation is **not supported**: neither timing point is the limiting factor.

⚠ **The one-night version of this said the opposite.** On 2026-07-22 alone the foot scored as well or better on every comparable window and the peak lost one outright; at corpus scale the peak produces *more* scorable windows (48 vs 47) and wins slightly more head-to-heads (21 vs 12). The conclusion survives, the reason given for it did not — the fourth single-night result in this session to fail on widening.

⚠ **The two may only be compared under `--scan`.** The peak trails the foot by ~100–250 ms, enough to push a lag out of the `[PHYS_LO, PHYS_HI]` window that was calibrated for feet — a raw δ=0 comparison is rigged against peaks, and is exactly how the peak lost that fourth window. Gated three ways: a foot-like lag scores at δ≈0, a peak-like lag does **not** at the same δ, and a wide enough scan recovers it.
