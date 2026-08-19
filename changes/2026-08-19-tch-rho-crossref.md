---
bump: patch
type: fixed
brief: CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md
---

**§1's proof is now visible at both call sites, so the withdrawn recommendation cannot be re-made from
the code.**

`CROSS-DOMAIN-METHODS-FOLLOWUPS` §1 proved the TCH residual correlation ρ is **not identifiable from
three sources**: the "direct measurement" is the **polarization identity**

```
corr(a−c, b−c)  ≡  ½(V_AC + V_BC − V_AB) / √(V_AC · V_BC)
```

a deterministic function of the three pairwise variances TCH already consumes. **Verified
independently here rather than quoted** — simulation over shared-latent-factor errors: direct
`0.807329359259`, identity `0.807329359259`, difference **1.3e-15**. (§1 measured 5.0e-15 on its own
seed; two seeds, same conclusion.)

The proof lived only in the brief. Both places that touch ρ now carry it:

- **`tools/tch-per-epoch-rho.mjs`** computed it under the comment *"residual correlation ECG↔PPG,
  **measured against CPAP as truth**"* — precisely the reading that produced the withdrawn
  recommendation. It now records that the value carries **zero** information beyond the variances
  returned two fields above, so its low correlation with `_tchRhoFromMotion` is **not** evidence
  against the motion proxy: it is two functions of overlapping inputs disagreeing.
- **`integrator-tch.js`** documents `opts.rho` as *"an **externally** estimated common-mode
  correlation"*. That word is load-bearing, and the most tempting source is not external — feeding this
  tool's ρ back in adds no information and cannot break the degeneracy it appears to resolve.

Comment-only; no behaviour changes. `Integrator.html` + its served copy + `provenance/Integrator.json`
re-stamped because the text is inlined.

`npm run check` with `DEX_UPLOADS`: **EXIT=0, 7926 assertions, 504 groups.**

⚠️ **A first gate run printed `CHECK_EXIT=0` and was discarded, not trusted.** It executed while a
concurrent session switched the shared checkout's HEAD, so it read an inconsistent tree — and the group
count is the tell: **501 then, 504 on the settled re-run.** Nothing in the output says whether the tree
was stable for the run's duration, so a green from a shared checkout is only as good as the exclusivity
held while it ran.
