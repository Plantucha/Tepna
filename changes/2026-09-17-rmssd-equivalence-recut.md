---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`rmssd-equivalence.html` is re-cut. Its electrical equivalence claim reproduces; its optical figures
do not — and the A/B shows the generator is not why.

Fourth paper of six, and the first reachable only because #2582 repaired `cohort-harness.html`. Run at
the paper's stated 240 patients, yielding **220 valid windows — the published count exactly**.

| | published | **@1.9** | @2.0 |
|---|---|---|---|
| ECG−Pulse bias / r | −0.02 ms / 0.9999 | **−0.017 / 0.9999** | −0.011 / 0.9998 |
| **optical bias / r** | **≈+1 % / 0.92** | **7.46 % / 0.839** | 7.76 % / 0.817 |
| PAT excess | ≈4.0 ms | **5.84 ms** | 6.27 ms |

**The headline survives.** ECGDex and PulseDex remain statistically interchangeable — two detectors
sharing no code, signal or sampling rate, agreeing at r 0.9998.

**The optical finding does not.** The paper reports that the optical bias *"collapses to ≈+1 % and the
correlation rises to 0.92"*. It now measures **+7.8 % at r 0.82**. Per the brief's §⛔ that delta is
not attributed to the generator without the A/B — and the A/B says it isn't: at cohort-gen 1.9, the
generator this paper was published on, the optical bias is already **7.46 %**. The 1.9 → 2.0 step adds
+0.3 pp and −0.02 of r. **The move from ≈1 % to ≈7.5 % happened between publication and now at a fixed
generator.**

That claim is therefore **retracted as a current measurement** and retained as the v2.1-texture
finding it was. **What changed in the pipeline is not established and is not guessed at** — the third
paper now showing large pre-generator drift (`qrs-yield`, `nights-icc`, this).

⚠️ **Figure 1 was not regenerated.** Like `cgm-hrv-coupling`, it is an externally assembled composite
of three canvases whose layout parameters are recorded nowhere. Its optical panels therefore still show
the ≈+1 % figures this revision supersedes, and the note says so where a reader meets the figure.

`nWindows = 220` at **both** generator versions is the positive control that makes the rest
interpretable.
