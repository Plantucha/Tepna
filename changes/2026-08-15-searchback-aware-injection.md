---
bump: minor
type: added
---

`attenuateAndRecover` — the searchback-aware half of the artificial-star test, and it **reverses the sign
of §7.3's caveat and triples its magnitude**.

Gap-planted injection puts the template into a gap ≥350 ms from any beat, which cannot benefit from
Pan–Tompkins' searchback — so §7.3 argued measured completeness *understates* in-rhythm performance and the
≤ 1.4 % bound was "plausibly well below". Attenuating **real beats in place** (excise the beat's own fitted
waveform, re-insert the leave-one-out average at that amplitude × α, scattered 5 % so every scored beat
keeps unmodified neighbours) measures it directly. At matched **measured** SNR ≈ 30: in-rhythm **2.6 %**
against gap-planted **94.7 %**. Convolved over the real-beat SNR distribution, measured the same way:

    in-rhythm  → 1.56 % miss rate
    gap-planted → 0.53 %        (~3x)

1.56 % against `KNOWN-CLOCK-ADVERSARIAL-CAPTURE`'s 0.5 % → 114 % rMSSD inflation.

**The mechanism is measured, not proposed.** Attenuating a beat *and its neighbours* lifts recovery from
1.2 % to 84 % — monotone in k — so full-amplitude neighbours holding the adaptive threshold high explains
the whole discrepancy, with no appeal to searchback.

**⚠️ THE α = 1 CONTROL WAS VACUOUS AND COULD NOT FAIL.** `residual = window − fitted` reconstructed as
`residual + α·fitted` is bit-identical to the original at α = 1 for **any** template — a check reporting
success about something it never examined, in the one place put there to prevent that. Leave-one-out does
not fix it (the identity is structural); removing one object and inserting a *different* one does.
`editDelta` is published and gated at **> 0**, with the retired construction's ~1e-13 computed alongside so
the contrast cannot decay into a comment.

**⚠️ AND THE SNR AXIS WAS NOMINAL, NOT MEASURED — a defect in this instrument, worth ~3×.** Template
subtraction leaves a beat-shaped, beat-positioned residual: at α = 0 the local peak/noise falls 55.9 → 13.1,
not to 0. So α = 0 is not silence, and the nominal axis reported signal as absent that the detector could
still see. Surfaced by asking where the α = 0 "fabrications" land — a median **15.4 ms** from the true beat
position (~2 samples), not the **±507 ms** RR midpoint an interval-inference would give. They were never
inventions; they were the residual.

**The morphology alternative was raised in review and is excluded by measurement.** `residual + α·template`
leaves the residual at full size, so a refusal might have been "that no longer looks like a beat" rather
than threshold. A second construction that scales the beat *with* its morphology (`baseline + α·(window −
baseline)`, also a true removal at α = 0) gives **1.73 %** against template-scaling's 1.56 % — agreement to
~11 %, moving the number up rather than down. The ~3× stands with the alternative excluded.

**Four review rounds each corrected this work in a different direction**, and every version was defensible
when written: *searchback does not rescue* (α = 0 has nothing to rescue) → *the detector does not
hallucinate* (true at nb = 0, quoted for nb = 2) → *the detector fabricates 10.7 %* (they are correctly-placed
residuals) → *the in-rhythm penalty is threshold* (confounded with morphology until separated). The shape
is identical each time: **a claim that was true for the condition it was written in,
then quoted for a condition it had never seen.**

§7.3's paragraph is corrected in place, carried here by agreement with that brief's author so one brief is
not edited by two sessions on one day.

Gate: `beat-injection` — 12 assertions on the attenuation core.
