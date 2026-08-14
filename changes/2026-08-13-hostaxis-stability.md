---
bump: minor
type: added
brief: HOSTAXIS-STABILITY-2026-08-13-BRIEF.md
---

`DexClock.hostAxis` now publishes how far to trust the `ppm` it reports, and the Allan core moves into
the spine so the fleet has one JS definition instead of a growing set.

Clock Contract §7 has always said "never quote a `ppm` without the span beside it". That was enforced
by prose plus one hand-picked threshold in ECGDex. `hostAxis.stability` computes it: overlapping Allan
deviation of the RAW host−device divergence, the noise type its slope names, and `ppmUncertainty` at
the recording's own span. Measured on real box captures — ECGDex −21.9 ± 9.3 ppm, PpgDex −32.9 ± 19.8
ppm. Both are barely 2σ from zero, which is exactly what a bare ppm could not say.

⚠️ RAW divergence, not the running-median series. The median exists to keep BLE delivery jitter out of
the correction, which is the very noise this measures; running ADEV on the smoothed series would report
how well the smoother worked and call it clock stability.

⚠️ NULL WHEN THERE IS NO SECOND CLOCK, and that is the COMMON path rather than an edge. A host column
that is the device stamp rounded (`independent:false`, spread ≤ one stamp quantum) has a "divergence"
made of quantisation; a curve over it would report rounding as clock physics. The entire phone-captured
tree reads false. Also null on a DRAWN axis even where the spine produced a curve — a synthesised ns
column makes the divergence the writer's own arithmetic.

PROMOTED, NOT COPIED. `ppgdex-dsp.js` had the only JS Allan core and `ecgdex-dsp.js` had none, so a
per-node curve would have been a fourth implementation (HOSTAXIS-STABILITY §4.3). It sits in the spine
for the same reason `parseTimestamp` does. `integrator-tch.js` keeps its own deliberately — different
domain and API — and `capture-host/allan.py` is a different language lane. A gate pins the spine copy
against the node copy byte-for-byte so they cannot drift while the duplicate remains; removing that
duplicate is the follow-up, deferred only because it changes `detectorStability`'s output shape.

THE BOUNDARY DEFECT, FIXED IN BOTH LANES IN ONE CHANGESET because this change moves the exact function.
`classify` named a noise type from a strict `<` against a POINT ESTIMATE and rounded the slope in the
record, so −0.7501 and −0.7500 printed identically with OPPOSITE types and `meaning` flipped between
"averages away" and "helps as sqrt(N)" — the field a caller branches on. Now: an edge within 1.96 SE
leaves `noise` as **null** (never a truthy `'ambiguous'`, which would pass the `if (noise)` guard
everyone writes and reintroduce the bug inside its own fix), the candidates are named so a reader sees
what is undecided, `slopeSE` is published UNCONDITIONALLY including when the type IS named, and `slope`
is unrounded in the data with rounding left to display. Both lanes return the same record shape,
including `candidates: null` on the success path.

⚠️ The SE is a LOWER BOUND — overlapping ADEV points are correlated while OLS assumes independent
residuals — and the docstrings say so, because the tempting later "cleanup" is to tighten 1.96 to 1 SE
believing that is more rigorous. It is less. The reason 1.96 is a stand-in rather than Riley EDF is
recorded as a REASON, not a TODO: EDF is a function of the noise type, so computing a confidence
interval in order to DECIDE the noise type is circular at a boundary; near an edge the honest iteration
is least likely to settle, and a classification that does not converge is the same finding as a CI that
straddles.

ECGDex also surfaces its host axis in the node export for the first time. It has always computed one —
it is what `tMsAt` rides — and never exported it, so no downstream reader could tell a disciplined ECG
axis from a device-clock one. `applied` and `tMsCorrected` both travel, because they answer different
questions: the ppm correction to `fs` is span-gated, the interpolation is not.

NOT in this change, per the brief: the 2400 s span gate is untouched (the "too permissive" claim was
measured and WITHDRAWN — 6.8-32.7 ppm uncertainty against 20-90 ppm crystal errors is marginal, not
wrong), `ppm` itself is unchanged, and nothing is gated on stability. The last two arrival diagnostics
that shipped with thresholds both fired on every stream of the first real night; a bar comes after a
τ-curve from several nights.

Export-inert: 195/195 equivalence assertions against the real corpus, including the 12 real-recording
legs. All 11 bundles re-stamped (spine change), and 23 capture-host Allan tests pass.
