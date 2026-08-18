<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PPGDex]
brief: FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md
---
Closes the last open instance in the brief's §3 fleet map. `cvhrFromNN` returned `index: 0` when it
could not measure, and `0` was not free to mean that: `ppgdex-dsp.js:4759` spends it explicitly —
*"cvhrIndex=0 = none detected"* — and the suite asserts that meaning on a flat-HR record that **did**
resolve. One value cannot carry both *"looked and found no cyclic variation"* and *"could not look"*,
and the second silently read as the first.

**Latent on real data, ACTIVE in the fixtures.** 0 of 44 corpus nights trip the guards, because
`cvhrFromNN` runs once per record rather than per epoch. But **all three** committed goldens are
shorter than the 120 s guard — `rich` 39.99 s, `inverted` 39.99 s, `o2ring_finger` 40.23 s — so every
one carried the fabricated zero byte-pinned, and **GATE-B was enforcing the defect**.

**Two tests were holding it in place, both with the right principle and the wrong constant:**

- `'a 90 s recording refuses rather than guessing'` asserted `cvhrIndex === 0`. The name says refuses;
  the value pinned *is* the guess.
- `'the golden carries apnea.cvhrIndex (a NUMBER — 0 is a measurement, null is not)'` — right
  distinction, but every fixture it defended was too short to have measured anything, so the number it
  protected **was** the fabrication. It now accepts a number **or** an explicit null and rejects
  `undefined`, so a longer fixture still pins a real value.

The flat-HR and 1 %-oscillation assertions keep asserting `0`: those genuinely looked and found
nothing, and turning every zero into null would be the mirror-image error.

**Consumer sweep came back clean, and that is worth recording as a negative.** The brief warns that
fixing a guard without auditing consumers moves the fabrication (`0.6 * null` → `0` produced OxyDex's
plausible 5.7 AHI). Here every reader already refuses: `integrator-dsp.js:526` digs the field into
`cvhrIndexWave` and `:3034` requires `!= null && isFinite`, so an unmeasurable finger leg makes the
CVHR corroboration return `null` rather than compute a gap against nothing; `oxydex-fusion.js:552`
skips its tile; `fnum` renders "—". The guard was the only defect.

Goldens regenerated with `tools/regen-ppgdex-goldens.mjs`, never hand-edited — `--check` reported
**3 fixtures moved, 1 field each, `apnea.cvhrIndex: 0 → null`, nothing else**, and the tool
re-recorded the ledger itself.

Also restores an invariant this had been breaking: ECGDex's `detectCVHR` was fixed to refuse in
#1397, and the Integrator's comment says the two **must share a method** — so ECGDex refusing while
PpgDex fabricated was the broken state, not the safe one.
