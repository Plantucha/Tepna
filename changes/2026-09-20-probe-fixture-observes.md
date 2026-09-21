---
bump: patch
type: fixed
brief: none
---

The 0x03 probe's test fixtures accepted the link arguments and dropped them — `BleakClient`'s kwargs
were swallowed by `**kw` and the no-op sleep discarded its duration — so mutants of the connect
timeout, the settle sleeps and the write mode all survived. The fixtures now observe, and three named
survivors from residue `2026-09-06-probe-mutation-survivors-are-fixture-limited` are killed.
