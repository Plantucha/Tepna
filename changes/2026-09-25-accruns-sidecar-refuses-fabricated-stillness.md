---
bump: patch
type: fixed
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

The `…_ACCRUNS.txt` validity sidecar reaches `parseSensorXYZ`, and an epoch whose window intersects a
recorded blanking run leaves the covered set with reason `blanking-run` instead of scoring IMMOBILE.

`motiondex-dsp` already guards the neighbouring door — "an uncovered epoch scores counts=0 ⇒
moving=false ⇒ counted as IMMOBILE, i.e. a recording gap fabricates stillness" — with `seen[]`. A
blanking run defeats that guard exactly: the rows ARE present so `seen` counts them, they hold one
constant so dynamic-g is ~0, and the epoch scores immobile from samples nobody measured. **Measured
on a planted night: a 30 s run manufactured a 16.7 % immobile fraction**, and the error runs toward
"still" — the direction a staging consumer acts on.

Refuse at the EPOCH (the window holding absent input), annotate at the NIGHT (`blankedEpochs` is
published so the denominator cannot shrink silently) — §∅'s line applied where the window sits, reusing
the tri-state already there rather than adding a second mechanism.

⚠️ The refusal keys on the SPAN and the file's own `min_run`, **never on `class=`**: the same Polar ACC
channel reads `class=held` in a 2026-09-08 sidecar and `class=variable` in a 2026-09-23 one, so the
field is not comparable across writer generations. The zero-order hold that repeats by design is the
O2Ring's `accraw`, a different stream. No sidecar ⇒ byte-identical: no golden output moved at all.
