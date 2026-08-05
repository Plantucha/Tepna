<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

The `_PPI.txt` the box writes did not match a real Polar Sensor Logger export: it carried an extra
`sensor timestamp [ns]` column and put HR third where PSL puts it last. A consumer reading PSL's order
takes column 1 as the PP-interval; under our layout that was the device clock, which every interval
sanity band rejects — so a LIVE PPI stream counted zero usable beats, the exact signature of "the
Verity's PPI is dead". 21 871 real rows on the box on 2026-08-04 were affected. Verified against all
107 `_PPI.txt` files in the vendor corpus; the other seven stream headers already matched byte-for-byte
and are now gate-asserted so a future one cannot drift unnoticed.
