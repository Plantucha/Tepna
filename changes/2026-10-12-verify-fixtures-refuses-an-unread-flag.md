---
bump: patch
type: fixed
brief: none
---

`tools/verify-fixtures.mjs` now refuses a token it does not read, before it reads or writes anything. Its whole argument surface was three `process.argv.includes` lookups, so a token nobody looked up was indistinguishable from an absent one, and the default this tool falls back to is the STAMP path: a mistyped flag did not fail, it ran the full 746-group suite and wrote `verifiedUnder`. The re-bundle skill published `node tools/verify-fixtures.mjs --node <node>`, a flag that never existed, so the one documented way to verify a single node's fixtures quietly verified all of them; the skill now names the call that exists and records that there is no per-node mode. The guard is the shared `tools/argv-guard.mjs`, which prints the accepted set and exits 2 in 0.01 s. The suite's adopter-parity leg also now reads flags taken straight from `process.argv`, because the helper scan found no call sites in this tool and passed over the adoption it was asserting; 10 of the 17 adopters read a flag that way, every one of their 23 flags is declared, and a floor of 15 under the measured 22 keeps the new leg from returning to vacuity.
