---
bump: patch
type: fixed
brief: none
---
The parse boundary was already honest, and `compute()` re-introduced the guess a thousand lines later.

`inferAccUnit` ends `return null; // nothing gravity-like — do not guess`, and `_unit` is deliberately left null when neither the header nor the magnitude oracle can decide. Then `compute()` did `var accUnit = (acc && acc._unit) || 'mg'` — reinstating exactly the guess the producer had declined to make. The file's own parse-boundary comment says replacing a declared unit with a guessed one *"is the fabrication this suite exists to prevent"*.

**The scale error it hides is 1000× for a stream actually in g**, or 9.81× for m/s². `toG`'s own header records that precise mis-scale happening here once before (`unit === 'mg'` missing a `[mG]` header → "1000× motion metrics").

**Every magnitude-derived output rides on that one variable**: body position, actigraphy, respiratory effort, and both SQIs. So the `|| 'mg'` could not simply be deleted — `toG(v, null)` returns `v` unchanged, which reads the stream as *already in g*. The unit now stays null and each of those four refuses with a named `unit-unknown` reason, slotting into the early-refusal idiom all four already had.

**Refusal, not annotation, because the classification is scale-dependent.** `classifyGravity` gates on an absolute window — `if (!(mag > 0.4) || mag > 2.0) return 'unknown'` — so the same bytes under two units give different dwell fractions. The twin pins that directly.

**The refusal is scoped**: a unit governs magnitude, not the clock. `t0Ms`, duration and sample rate still publish, so an unknown unit costs the motion metrics and nothing else.

⚠️ **Export-inert, and the corpus cannot falsify it.** Every ACC file in the corpus *and* the synthetic fixture declares `[mg]` in its header, so no recording reaches the undetermined path: regen moved 0 fixtures. That is why refusal is safe — it blanks no real night — and equally why the twin is the only coverage this fix has.

⚠️ **One existing assertion changed, and only its call — not its expectation.** `M.bodyPosition(posRows)` passed no unit and relied on `toG`'s pass-through. Its rows are `{x:0,y:0,z:1}`, i.e. one g on z; the call always meant `'g'` and simply never said so. `toG(v,'g')` returns `v` unchanged, exactly as the absent unit did, so that mutation-derived assertion's outcome is bit-for-bit what it was.

The twin's control caught its own first draft: a perfectly static fixture scores SQI conf 0 on its own merits, which would have made the refusal assertion indistinguishable from the fixture's flatness. With real movement the control reads conf 1 and the refusal reads 0. Reverting the DSP reds 3 of 7, with the old code reporting `{"h":true}` and `{"c":1,"f":[]}` — full confidence, no flags, over magnitudes whose scale it had guessed.
