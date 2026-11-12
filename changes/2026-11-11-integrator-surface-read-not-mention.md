---
bump: patch
type: fixed
brief: none
---

Ask the Integrator surface gate for a READ in blanked code, not a word anywhere in the file. Correct the two `card` keys that a prose mention had declared.

The gate accepted a word boundary over the whole of `integrator-render.js`. So `bus` and `staging` declared `card` on English. `bus` appears once inside the device-AHI card's own sentence, and `staging` in a comment and a `cite:` string. No Integrator surface reads either key.

`reads()` now blanks comments, strings, templates and regex literals before it looks. The verdict records which route blanked them. Both keys declare `export-only`, which is what they are. The gate now reds the reverse state too, an `export-only` key that render reads. Measured 2026-11-11: 25 keys, 12 `card`, 13 `export-only`, 0 of 13 read by render, selftests 14 to 23.
