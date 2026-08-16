---
bump: patch
type: fixed
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

`odi-bias-analysis` selected the one reference AHI definition that cannot measure the effect the
tool exists to measure.

`NSRR_AHI_VARS` is a first-match-wins preference list, and `ahi_a0h4` led it. That variable counts
hypopneas only when they carry a ≥4 % desaturation — which is exactly what a pulse-oximeter ODI
counts. Reference and estimator therefore shared a blind spot: arousal-terminated hypopneas were
absent from both sides, the two indices agreed by construction, and the tool would have reported a
small ODI-vs-AHI bias derived from a comparison it never made. Both READMEs stated the preference
explicitly ("preferring the 4%-desat definition"), so the default was documented, not accidental.

Arousal-inclusive definitions now lead (`ahi_a0h3a` → `ahi_a0h4a` → `ahi_a0h3` → `ahi_a0h4` → …),
lowest desaturation threshold first. `ahiCountsArousals()` classifies the selected variable from an
explicit list rather than a suffix regex — `rdi3p`/`poohi3` share the digit-plus-letter shape, and
guessing wrong mislabels the confound in the direction that hides it; unrecognised variables return
null and warn rather than defaulting either way.

The status pill now names the confound at the moment the reference is chosen: amber plus
"DESATURATION-ONLY reference — shares ODI's blind spot, so bias will read LOW". The variable name was
always printed, but as a neutral fact; a reader who does not know that `…h4` means "arousals not
counted" could not tell that this one choice bounds the result. Adds `.pill.warn` to the tool shell —
`setStatus` accepted any class string, so a `warn` with no CSS rule would have rendered unstyled.

A desat-only reference does not invalidate a run; it makes it a different measurement — agreement
between two desaturation-based indices — and that is what must not be reported as ODI-vs-AHI bias.
The gap between the two curves is the arousal-terminated hypopnea population, which is the finding
rather than a nuisance; the READMEs now say to report it as a secondary result.

Timing: SHHS was requested from NSRR on 2026-08-16 with up to two weeks for review, so this lands
before any real record can be run through it rather than after a number has been believed.
