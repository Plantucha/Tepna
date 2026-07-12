<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md
---
Three fixtures claimed "reproducible under this code" while nothing reproduced them — and one absent recording was silently deleting nine equivalence legs.

`FIXTURE-PROVENANCE.json` makes two kinds of claim: `historical: true` pins the BYTES (honest, weak), a
`manifestHash` claims the bytes are **REPRODUCIBLE by the code with that hash** (strong). **GATE B cannot
check the strong one** — it is static: it hashes the committed input, output and bundle, and never re-runs
the app. Only a dynamic equivalence leg can. And `tools/build.mjs` **re-stamps** a fixture's `manifestHash`
onto the new bundle hash every time that bundle moves — silently renewing a claim it has never checked.

**Three of 21 code-gated fixtures had no leg at all:** `OxyDex_2026-06-25_0439_summary`,
`cpapdex-2026-06-12`, `cpapdex-2026-06-16`. The repo *knew*: `FIXTURE-PROVENANCE` says in prose *"this
real-EDF fixture is NOT in the live equiv gate"*, and CLAUDE.md tells a human to remember to regenerate the
OxyDex one by hand. **Prose is not a gate.** I re-stamped two of them twice this week without ever running them.

All three now have equivalence legs. Driven against the real corpus, **all three reproduce byte-identical** —
so the ledger was telling the truth. It just had no way of knowing that, and neither did anyone else.

**The gate** (`fixture reproducibility — every code-gated fixture is actually re-run`, both runners): every
`manifestHash`-bearing fixture must have a dynamic leg that re-runs it, and every leg must point at a
fixture the ledger records. If you cannot re-run it, do not code-gate it — mark it `historical` and pin the
bytes, which is a weaker claim but a true one. Each equiv record now carries `fixtureFile`, single-sourced
in the runners, so there is no third list to drift.

Two further defects surfaced while wiring it, both of the same family:

- **One absent recording silently removed NINE equivalence legs.** In `Dex-Test-Suite.html` all nine
  real-recording legs shared a single `try{}`: the first missing file threw and every `setEquiv()` below it
  never ran, so the suite went green having quietly stopped checking them. Same class as
  `GATE-INTEGRITY-AND-DEVLOOP` ("stop the gate shrinking in silence"), this time in the equiv loader. Each
  leg now fails alone, and the fixture registers even when its input is absent.

- **`DEX_UPLOADS` was serving the ANSWER KEY.** It redirects the whole `uploads/` directory — including the
  *tracked fixture files* — so pointing it at another checkout diffs your code against **that checkout's**
  committed reference. It produced a false FAILURE the moment it was used (a checkout one merge behind still
  had `metrics.mode:"APAP"` where HEAD says `null`); a checkout stale the other way would produce a false
  PASS. The same reasoning already fixed committed *inputs* (`pairCommitted`); fixtures were the half that
  got missed. Fixtures now always resolve against the repo. **`DEX_UPLOADS` supplies recordings; it must
  never supply the answer key.**

Skip budget: +3 `corpus-absent` (the new real-recording legs), 9 → 12. Gates: headless **2234/0** on a fresh
clone and **2262/0** with the full corpus (the three new legs byte-identical); browser `?full` **all green**
(2487 passed, 11 render groups, no boot skips); build/GATE A/B/tsc/biome clean.
