<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

`webmon` passes `adapter_mac` to four bonding call sites and only two were observed: `bonding.scan(None)`
and `ensure_bonded(address, None)` both survived the whole webmon suite, while the same mutation on
`bond`/`forget` reds. A sibling divergence inside the file that already fixed the family. The two
survivors are the worse pair: a bond on the wrong radio fails loudly at the next connect, but a SCAN on
the wrong radio returns an empty list that reads as "the sensor is not advertising" — and this box has
one adapter that goes deaf while the other works.
