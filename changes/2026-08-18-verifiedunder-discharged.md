---
bump: patch
type: fixed
---

**Three corpus-backed fixtures were `UNVERIFIED` — their producing code had changed and nothing had re-run
them.** Discharged by an actual green corpus run, not by a re-stamp:

    ↻ PpgDex_2026-06-27_equiv     verifiedUnder  30037af74bb4 -> 16c93daa3a73
    ↻ HRVDex_2026-06-25_equiv     verifiedUnder  710ef1d9e5cf -> 87ff33b305d3
    ↻ HRVDex_2026-06-25_events    verifiedUnder  710ef1d9e5cf -> 87ff33b305d3

`verify-fixtures.mjs` re-ran the full suite (496 legs) against the 55-night trio corpus and every leg
reproduced its committed bytes. **The exports did NOT move** — so a re-stamp was the correct outcome and no
`regen-*-goldens` was needed. Had the suite gone red the tool stamps nothing and says so; that path was
checked before running it, not assumed.

## Whose debt, traced rather than presumed

- **PpgDex** ← `fdbcb027` *"cvhrFromNN returned 0 when it could not measure — and three goldens had it
  byte-pinned"*. Pre-existing: reproducible on clean `origin/main` before any of today's work.
- **HRVDex** ← `d511c162` *"a row with no clock came back dated to 1970"*, which landed **while this was in
  progress**. An earlier run an hour before found only the PpgDex one; this run found three.

That second point is the useful one: **this debt accrues continuously.** Every merge that touches a compute
closure creates it, and it is only visible to whoever holds the corpus — CI cannot see it, because a
contributor without the corpus cannot green it. A one-node PR must not discharge it silently, which is why
it ships here on its own rather than folded into unrelated work: `verifiedUnder` asserts *"code actually
re-ran the app and reproduced these bytes"*, and that claim belongs in a commit whose gates exercised it.

⚠️ **The tool is the only writer, deliberately.** The first run wrote into the shared root checkout; rather
than copy the value across by hand, the run was repeated **inside this worktree** so the stamp is written by
`verify-fixtures.mjs` in the branch that ships it. Hand-editing a provenance hash is exactly the false claim
the gate exists to prevent, and "I watched the tool print it" is not the same as the tool having written it
here.

`verify-fixtures --check` now reports: *every corpus-backed fixture is verified under the current compute
closure.*
