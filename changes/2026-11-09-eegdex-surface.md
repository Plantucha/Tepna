---
bump: minor
type: added
brief: EEGDEX-BUILD-BRIEF.md
---

Build the EEGDex app surface. The two test lanes now execute it. Before this change, the EEGDex DSP ran under `tools/eegdex-selftest.mjs` only, and no gate runs that tool. The node lane held the file's TEXT in its source list and nothing executed it, so a throw in `analyze` left every lane green. Both lanes now load the DSP and the render, and eight groups assert on `env.EEGDSP` and `env.EEGUI`. Each loader turns a load failure into a console line, so the availability assert is the thing that makes a broken module red.

`nightBands` publishes all five band shares and their sum. The five medians are independent, and the bands stop at 30 Hz while the total power runs to 45 Hz. On the deterministic synthetic the shares sum to 51.7 %, not 100 %. The bar draws each share at its own width, and the note states the sum and names the unfilled remainder. A bar that fills its own width would state a proportion that no epoch has.

The node registry gains `deltaRel`, `sigmaRel` and `betaRel`. Three of the five shares had no registry entry. `EegRegistry.badgeForLabel` mints an `experimental` badge for an unknown label, so an unregistered share got a fabricated grade.

`compute` carries the EDF physical dimension through to the surface. The power tile prints a squared unit only when the header declares one. For a frame that declares no dimension, the tile says the amplitude unit is undeclared.

The ingest tests build an EDF byte by byte. The digital range equals the physical range. The reader's scale is then exactly 1, and a decoded sample reads back as the integer written. The ingest names six refusals. A seventh header defect throws out of the reader, and `eegdex-app.js` catches that throw and shows the reader's own message.

EEGDex ships no bundle, and this unit does not register it as a shipped app. The brief asks for one public EEG recording through `ingestEDF` first.
