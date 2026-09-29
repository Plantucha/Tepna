---
bump: patch
type: fixed
brief: none
---

`mmeta.generated_under_glob` counted mutants with `^\s*def`, which does not match `async def`, so it
returned 0 for every coroutine — 44 real mutants read as 0 on `wifi_uplink._run`. The caller uses the
count only to tell "nothing to mutate" (benign, pass) from "generated but never tested" (a crash,
refuse), so across 309 of capture-host's 1959 functions a genuine crash took the benign arm and the
guard passed. Third instance of one root: `^def` missed indented methods, `^\s*def` missed coroutines,
and each time the unmatched shape reported absence as a measured zero.
