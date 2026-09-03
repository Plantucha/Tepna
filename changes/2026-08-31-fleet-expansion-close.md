<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md
---
MUTATION-FLEET-EXPANSION closed for Phases 1 and 2, and its guard-count row corrected rather than left to be acted on.

The brief read `PROPOSED` while its first two phases were already in the tree: `DEFAULT_FLEET` carries
**30** files — 9 DSPs + Phase 1's `clock.js`/`manifest-gate.js` + Phase 2's 19 (the stated 20 minus
`oxydex-fusion.js`, which §2a reclassified to Phase 3) — and the code cites "§2" in a comment. Executed
against the brief; the status was never flipped.

**§2a's guard row was wrong and is corrected in a dated §2a-bis rather than silently rewritten.** It
claimed `cpapdex-fusion.js` was *the only* file of the 20 carrying a `typeof X !== 'undefined'` guard.
Measured: **four** do — `cpapdex-cross.js` (3), `cpapdex-edf.js` (3), `dex-coload.js` (2),
`cpapdex-fusion.js` (1).

The count was never the discriminator, and that is the part worth carrying: **what a guard TESTS decides
the hazard.** The first three guard *environment globals* (`globalThis`, `module`, `require`, `window`,
`process`, `self`) — UMD boilerplate asking "Node or browser", which an incomplete realm answers
correctly, so it cannot false-kill. Only `cpapdex-fusion.js` guards a *module dependency*
(`SignalFrame`), which is the shape that can. So §2a picked the right file for the wrong reason, and its
row invited auditing four files where one matters.

That remaining hazard is **already closed by construction**: `SignalFrame` comes from `signal-frame.js`,
which is in `mutation-crawl.mjs`'s `SPINE`, which `loadRealm` runs into the context under `existsSync`
with the file present. Traced, not re-read.

§6's cycle clause is verified **per stage** rather than inferred from fleet membership — crawl, probe and
draft artifacts all non-zero for both Phase 1 files, with sizes recorded because a present-but-empty
artifact is the vacuous pass this suite keeps finding. That evidence is local-only (`.mutation-crawl/`,
`.git/tepna-mutation/`) and cannot be cited from a fresh clone.

**Phase 3 stays DEFERRED and §4 stays PROPOSED**; the DONE header says so explicitly so it cannot be read
as covering them.
