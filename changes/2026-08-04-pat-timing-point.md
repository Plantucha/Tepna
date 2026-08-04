<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
`--timing-point foot|peak` — test whether the PPG timing point explains §3f's intermittency. It does not.

§3f.4 listed two candidate explanations for coupling appearing in some windows and not others: the physiology, or the residual offset. **There is a third it did not list** — the timing point itself. The foot is the standard for PAT/PTT and what `O2RING-PPG-GAP` §3 argues for on PPI grounds, but it is also the *harder* of the two to detect in low-perfusion PPG, so windows could lose coupling because foot detection degraded rather than because anything physiological or temporal changed. `consensusBeats` already returns both series, so the question costs one argument to ask.

**Measured on 2026-07-22, under `--scan` so the comparison is fair:** foot reaches best-scan 67 / 27 / 35 / 12 % across its four windows; peak reaches 61 / — / 35 / 14 % and **loses a window entirely**. Mean strict 21 % (foot) against 19 % (peak). So the foot is as good or better, and the third explanation is **not supported** — the timing point is not the limiting factor.

⚠ **The two may only be compared under `--scan`.** The peak trails the foot by ~100–250 ms, enough to push a lag out of the `[PHYS_LO, PHYS_HI]` window that was calibrated for feet — a raw δ=0 comparison is rigged against peaks, and is exactly how the peak lost that fourth window. Gated three ways: a foot-like lag scores at δ≈0, a peak-like lag does **not** at the same δ, and a wide enough scan recovers it.
