<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
The Polar PS-FTP client's test doubles now use what they are handed — 94 % of mutations killed, up from 75 %.

`polar_psftp.py` was the weakest module left in `capture-host/`, and every one of the 223 survivors
closed here traces to the same defect: a fake that accepted an argument and discarded it, which makes
the code computing that argument unobservable while coverage still reads 100 % because the line ran.
`_bt_disconnect` had **22 survivors out of 22 mutants** — the whole function — under a test aimed
straight at it whose fake was `async def fake(*a, **k)`. `__aenter__` had 24 under four tests, because
`BleakClient` was stubbed `lambda dev, **kw: client` and `dev` is the entire content of the
scan-then-fall-back logic.

`FakeClient` now keeps every argument (device, scan address and timeout, adapter pin, characteristic
UUIDs, write mode, query params); two stub defaults deliberately do *not* mirror production, because a
double that repeats the real default cannot tell "passed correctly" from "not passed at all". No
shipped source changed. Details, including the equivalent mutants confirmed still surviving, in
`audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md` § Third pass.
