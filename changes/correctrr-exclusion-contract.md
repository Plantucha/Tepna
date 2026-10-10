---
bump: patch
type: fixed
brief: none
---

**A passing PpgDex assertion described the opposite of what `correctRR` does.**

`tests/dex-tests.js` pinned `nn[20] ~= 2000` under the label *"the range-rejected brady PPI is
replaced by the local median (~2000), not kept at 2500"*. `correctRR` does not replace a rejected
interval — it EXCLUDES it (measured: `nn` is 39 long for 40 inputs, `keptIdx.indexOf(20) === -1`),
so index 20 holds what was `rr[21]`, and because every neighbour in the fixture is 2000, any index
lands on 2000.

Replaced with the actual contract — exclusion, an input-aligned `flags`, and reads taken THROUGH
`keptIdx` — plus a discriminating fixture (one neighbour at 1900) that makes the shift observable at
all. Proven: a `keptIdx.push(i + 1)` mutant leaves the old assertion PASSING and fails all seven new
ones.

No DSP change; `correctRR`'s behaviour is correct and unchanged. Credit to Muse, whose edit on
`rescue/2026-10-10-root-wip` caught the mislabel; that branch can be deleted once this lands.
