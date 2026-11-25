<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: EEGDEX-STAGE-FORMULA-2026-11-24-BRIEF.md
nodes: [EEGDex]
---

A second EEG stage model file, the one of two passes, ships beside the one-pass
file, and the suite holds the port against the fit over a whole night.

The claim "a better model is a new file and no new code" now rests on a REAL
second fit and not on a synthetic one: `eeg-stage-model-two-pass-2026-11-24.json`
scores two passes, the second over 55 columns of the first pass's posterior, and
`eegdex-stage-model.js` reads it with no change. The port agrees with the
reference evaluator of the fit at 4.995e-8 over the committed 60-epoch vector and
at 4.994e-8 over a seeded 330-epoch night.

The long night is what gives the pin teeth. `pfeat55` reads means over the 40, 80
and 160 epochs before and after each epoch, so a wrong reach barely moves a short
vector: with 150 in the place of 160, the 60-epoch vector moves 4.995e-8 and the
330-epoch night moves 4.639e-2.

A model of two passes also refuses an import shorter than its reach, by name. No
epoch of a short import carries the look-back the fit read, so §∅ reads that as a
discontinuity of the window rather than as reduced coverage. The one-pass file
still scores the same short import.

The surface states both files with their hashes and says which one needs the whole
night. `THIRD-PARTY.md` covers both files in one section, because both fits read
the same 8 corpora under the same 14 fit names. The switch stays off, and every
number on the surface keeps `experimental` or lower.
