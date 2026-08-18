---
bump: patch
type: fixed
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---

**Three corpus-backed fixtures were UNVERIFIED against the current compute closure — a release
blocker, since `tools/release.mjs` refuses to cut while any of them is.**

Written by `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` after a green real-corpus run.
Nothing hand-edited.

    PpgDex_2026-06-27_equiv    verifiedUnder  30037af74bb4 -> 16c93daa3a73
    HRVDex_2026-06-25_equiv    verifiedUnder  710ef1d9e5cf -> 87ff33b305d3
    HRVDex_2026-06-25_events   verifiedUnder  710ef1d9e5cf -> 87ff33b305d3

**Only `verifiedUnder` moved. No `outputHash` changed, so the exports did not move and no regeneration
was owed** — predictable before the run, because the recorded input hashes still matched the local
corpus byte-for-byte (`289ef2aac9fd3d66` on the PpgDex leg), which localises the drift to the compute
closure rather than to the data. Checking the input hash first is what separates "re-verify" from
"regen, then re-verify", and getting that order wrong stamps `verifiedUnder` over content the code
does not reproduce.

So a compute-path change landed on each node without a corpus re-verification. That is the debt §🔏
exists to surface: `build.mjs` re-stamps `manifestHash` on rebuild and is forbidden to write
`verifiedUnder`, so the gap opens silently and only `verify-fixtures` closes it.

Found by the literature lane while auditing something else, and correctly **not** discharged there — a
one-node PR silently re-stamping another node's provenance attributes the debt to whoever ran the tool
next, and puts a claim in a diff that did not earn it. Discharged here by the corpus holder.

`verify-fixtures --check` now reports **every corpus-backed fixture verified**, 0 outstanding.
