---
bump: patch
type: added
brief: EEGDEX-STAGE-FORMULA-2026-11-24-BRIEF.md
---

The feature block of the EEG stage formula, the first of that brief's three PRs.
`eegdex-stage-features.js` takes one EEG derivation and gives 35 columns per 30 s
epoch, in the order of its own `EEG_NAMES`.

- It is a PORT. The coefficients of the model the next PR evaluates describe these
  35 columns and no others, so the only thing that makes the port correct is that it
  reproduces the fitting code's output cell for cell. Nothing else in the suite can
  see a drift: a wrong constant still gives 35 finite columns and still passes every
  other group, and it answers a different question than the one the fit asked. `tests/vectors/eegdex-stage-features.json` therefore holds the fitting code's
  own output over a seeded synthetic signal, and the parity group reproduces that
  signal and compares all 2100 cells. Measured: the worst relative difference over
  every measured cell is 0, and the 102 cells the fit recorded as absent are the same
  102 cells on both sides.
- No recording of any person enters this. The vector's signal comes from a seeded
  generator that the test reproduces, and the test quotes that generator, so the
  comparison cannot drift from it.
- §∅ — NaN is "not measured" and it is the one absent value this layer speaks. A
  measured 0 is legal in all 35 columns, so the comparison reads finiteness and never
  truthiness: 354 cells hold an exact 0 on both sides, and the group compares every one of them
  as a value. A
  night with no EEG signal reports 35 absent columns, never 35 zeros. The conversion
  of NaN to the suite's `null` is the next PR's, where the contract is JSON.
- One assertion the vector cannot make: a night multiplied by 3.7 gives the same row
  (worst 3.3e-5, the float32 rounding of the scaled signal). The device's µV scale is
  not verified, so a scale that leaked into one column would move that column alone.
- This PR surfaces nothing and switches nothing on. `eegdex-dsp.js` holds the band-power
  stager EEGDex ships and that stays the default. No bundle carries the new file yet,
  so no `manifestHash` and no `computeHash` move, and no fixture owes re-verification.
- BOTH test lanes list the file with itself, and both EXECUTE it: a source
  scan reads what a file says, and this one's whole claim is about what it does.
