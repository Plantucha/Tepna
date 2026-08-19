---
bump: patch
type: added
---

**`KNOWN-CLOCK-ADVERSARIAL-CAPTURE` target 6 is RUN — precision/recall against injected labels, on 89 real
streams, per the preregistered criterion.** `beat-error-recovery.mjs`'s injectors now return labels
(`missLabelled`/`fpLabelled`, with the unlabelled forms as wrappers so the two cannot drift) and a pure
exported `precisionRecall` joins them to `correctRR`'s per-interval `flags` — a 1:1 join, because the
corrector substitutes and never deletes.

| injected | rate | recall (median · min) | precision (median) |
|---|---|---|---|
| missed beats | 0.1 % → 5 % | **1.000** · 0.936 | 0.26 → 0.95 |
| spurious beats | 0.1 % → 5 % | **1.000** · 0.972 | 0.58 → 0.98 |

**Recall is the verdict: the shipped corrector catches essentially every injected beat error.** The low
precision at low rates is base-rate arithmetic, proven by the null control: on uninjected real data
`correctRR` flags a median **0.20 %** of intervals — its ordinary, correct work on real ectopy — and those
count against injected-only ground truth. `P = f/(f+0.002)` reproduces the measured curve within 0.08 at
every rate. **Precision vs injected labels understates the corrector**, and that caveat now sits beside the
preregistered criterion rather than being discovered by the next reader.

Selftest grows 9 assertions: exact join controls (perfect/none/flag-all/mismatch), anti-vacuity
(`nInjected > 50` at the 5 % rate), wrapper-equals-core byte identity, and both measured legs populated.
**Precision on `nFlagged = 0` is `null`, never 1** — 0/0-as-perfect is the vacuous green this suite
catalogues.
