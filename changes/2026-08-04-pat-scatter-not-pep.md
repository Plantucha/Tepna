<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3j — the beat-to-beat scatter is **not** the pre-ejection period, so dual-site PTT does not rescue PAT.

§3i located the blocker as ~84–96 ms of scatter and could not say whether it was cardiac or downstream. PAT = PEP + PTT, and an arm→finger interval cancels PEP by construction, so it decides the question. Run over Verity-arm → O2Ring-finger (**40.6 h, 8 nights**, no ECG in the timing chain): gate-comparable `scatterIQR` median **92 ms** (53–100) against **84 ms** for ECG→foot, **1/43** windows clearing the 60 ms bar against 10/52, and **0/43** significant against a matched null.

**The scatter does not collapse — it is 8 ms worse with PEP removed.** The looseness is downstream of the heart: vascular variability, foot-detection noise, or both. **`INTEGRATOR-PAT-VASCULAR` §4's differentiator does not differentiate** — its Phase 2 ("dual-site PAT … whose difference cancels the pre-ejection-period") was parked behind a NO-GO Phase 0 and never measured; measured now in its direct form, it removes the confound and the number gets no better.

⚠ Caveat, stated because it is real and because it does not rescue the idea: the **differenced** form matches both sites to the same R-peak, while the **direct** form run here matches arm feet to finger feet — algebraically identical when matching is right, but the direct form leans on the aliasing-prone nearest-foot step, so it may be *pessimistic about coupling*. It is not pessimistic about the scatter: an IQR about the modal lag is *inflated* by mismatch, so arm→finger scatter is **≤ 92 ms** and still far above the bar. The differenced form is worth running for completeness — both legs exist — but it would have to move ~92 → ≤60 ms, and removing a confound that is demonstrably absent cannot do that.
