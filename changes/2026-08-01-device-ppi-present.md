<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
The device-PPI validation lane collapsed **"you didn't load the file"** and **"you loaded it and the device wrote nothing"** into one `hasData: false`, so the UI advised *"load the device PPI file to cross-validate"* — actionable in the first case, misleading in the second, because the user already had.

Measured across this corpus it is always the second: **107 of 107** Verity `_PPI.txt` files are header-only, and **40 of 40** `_HR.txt` are all-zero. The docs' hedge ("often header-only") understates a categorical fact about this firmware — which is why PpgDex's computed PPI is not a second opinion but the only one.

`validatePPI` now returns `filePresent`, and the empty state says which situation it is: an empty file gets *"the Polar Sense wrote a header and no intervals … no action will change that on this firmware"*, and points at the foot-vs-peak fiducial agreement as the cross-check that does exist.

The first version of the gate looked the function up on the wrong namespace and reported a green **"(skipped)"** while testing nothing. It asserts the export now, so a moved surface goes red instead of quiet.
