<!--
  MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-25 · **Owner-issued directive** (relayed via the coordinator session) · **Interlocks:** `MUTATION-PROGRAM-2026-08-09-BRIEF.md`, `MUTATION-PIPELINE-INTEGRITY` · **Affects:** `tools/mutation-crawl.mjs` (`DEFAULT_FLEET`), per-file co-load configs

# Mutation fleet expansion — beyond the nine DSPs

`DEFAULT_FLEET` has been the same nine `*-dsp.js` files since the programme began. The owner's
directive is to widen it, with the local model lane working the new files through the existing
crawl → probe → draft machinery, which the overnight budget absorbs.

**The one-line core is `DEFAULT_FLEET`. The real work is the per-file co-load recipes.**

---

## 0 · 🔒 DESIGN INVARIANT — the model widens what is SEARCHED, never what DECIDES

Ratified with the coordinator session, 2026-08-25, and recorded here because the directive's phrasing
("the model lane is the workhorse") could reasonably be read more broadly:

> **The local model participates in the probe and draft paths only. Drafts remain human-read
> proposals; the gates stay the arbiter.** Widening the fleet widens what the model *searches* — never
> what decides correctness.

This is the same rule the suite's own evidence policy states from the other end (§📚's *no fabricated
authority*): a proposal is not a verdict, and a tool that suggests an assertion has not thereby
validated one. **The local inference server stays out of every verification path.**

## 1 · PHASE 1 — `clock.js` + `manifest-gate.js` (tonight, with the re-crawls)

Both are pure, maximally load-bearing (every timestamp in the fleet; the provenance gate itself), and
need near-zero harness work — `clock.js` loads standalone.

**⚠️ `manifest-gate.js` carries ONE deliberate NUL byte**, which makes `file(1)` report it as `data`
and causes plain `grep` to skip it silently (the fleet memory is *grep-cannot-see-manifest-gate*; use
`git grep`). The directive rightly asked that the sweep be *verified* to generate mutants there rather
than assumed to — the examined-nothing check applied to the expansion itself. **Verified 2026-08-25:**

| file | mutants generated | notes |
|---|---|---|
| `clock.js` | **190** | loads standalone |
| `manifest-gate.js` | **69** | the NUL does not impede the generator |

## 2 · PHASE 2 — the 20 cross / registry / fusion / edf / coimport files (this week)

**Measured, not estimated — 20, not ~19:**

- **cross (5):** `cpapdex-cross.js` · `ecgdex-cross.js` · `oxydex-cross.js` · `ppgdex-cross.js` · `pulsedex-cross.js`
- **registry (9):** `cpapdex-` · `ecgdex-` · `glucodex-` · `hrvdex-` · `motiondex-` · `oxydex-` · `ppgdex-` · `pulsedex-registry.js`, plus the shared **`metric-registry.js`**
- **fusion (2):** `cpapdex-fusion.js` · ~~`oxydex-fusion.js`~~ → **reclassified to Phase 3, see §2a**
- **edf (1):** `cpapdex-edf.js` — **priority**, a binary parser
- **coimport / co-load (3):** `cpapdex-coimport.js` · `crossnight-envelope.js` · `dex-coload.js`

**Priority two: `cpapdex-edf.js` and the `*-cross.js` crossnight stats** — user-facing math, and the
EDF parser is binary-input code where a surviving mutant is least likely to be caught by eye.

**Each needs a co-load recipe.** `dex-coload.js`'s `shared:` lists are the reference for what must be
loaded alongside; `registry-defs-parity` tells you which registries pair with which `*-cross.js`.
⚠️ Note that `dex-coload.js` and `metric-registry.js` are themselves **in the list** — they are shared
spine, so a mutant there moves many nodes at once, and their recipes are not node-local.

### 2a · RECIPE SURVEY — measured 2026-08-25, and the answer is that there is barely any recipe work

The brief above says *"the real work is the per-file co-load recipes."* Measured, **it is not.** All 20
files were loaded into the crawl realm on the existing `SPINE`
(`clock.js · kernel-constants.js · metric-registry.js · dex-export.js · signal-frame.js`):

**All 20 load without throwing, and 17 expose their own handle** — `CpapEdf`, `CPAPCross`, `ECGCross`,
`OXYCross`, `PPGCross`, `PulseCross`, `CpapFusion`, `CpapCoimport`, `CrossNightEnvelope`, and each
`*Registry`. **No extra co-load is required for any of them.** The recipe work the directive
anticipated is largely absent, which is worth knowing before budgeting a week for it.

Four files need a note rather than a recipe:

| file | finding | disposition |
|---|---|---|
| **`oxydex-fusion.js`** | **NOT a fusion module — a DOM-coupled page-scope render file.** Its own header: *"Loaded after `oxydex-render.js`, before `oxydex-app.js`. Shares page scope."* 5 DOM references, writes `window._ecgByDate`, injects cards at `#heroTop`, exposes no handle. | 🔴 **MOVE TO PHASE 3.** It was placed in Phase 2 by FILENAME; by nature it needs the DOM shim. |
| `cpapdex-fusion.js` | the **only** file of the 20 carrying a `typeof X !== 'undefined'` guard (1 of them) | Phase 2, but it is the one file where an incomplete realm can produce a **FALSE KILL** — the hazard the crawl's own header records. Complete its realm before trusting a kill there. |
| `metric-registry.js` | already in `SPINE`, so it is dual-loaded exactly as `clock.js` is | Phase 2, safe — the target loads after the spine and overwrites it (verified for `clock.js` in Phase 1; same mechanism). |
| `dex-coload.js` | reachable as `DexCoload`, but it is a **DATA structure** (module lists), not a function surface | Phase 2, **low yield** — mutants there edit list contents; expect few probeable functions rather than none. |

⚠️ **A correction on that last row, recorded because it is the session's recurring error in miniature.**
My probe first reported `dex-coload.js` as exposing *no handle at all*, and I nearly wrote that down as
a property of the file. It is a property of **my probe**: the filter required a global owning
`typeof === 'function'` members, and `DEX_COLOAD` owns only data. The file assigns
`root.DexCoload = DEX_COLOAD` on its last line. **An instrument's blind spot reads exactly like a
finding about the thing measured** — the same shape as every other trap in §5.

**So Phase 2's real cost is 19 files (not 20) with essentially no recipe work, one realm-completeness
caveat, and one reclassification.**

## 3 · PHASE 3 — render/app files: DEFERRED, deliberately

They need a **DOM-shim harness**, which is a build rather than a config. The browser rigs cover their
execution meanwhile, so the gap is narrower than the file count suggests. Recorded here rather than
left implicit so the deferral has a header the `docs-ledger` gate can see.

## 4 · PROPOSED, not yet ratified — a slow full-module PYTHON rotation

N `capture-host` modules per night through the worklist machinery, so the historical waves do not
fossilize. **Diff-scoped stays the CI gate**; the rotation only refreshes the floor. Recorded as
proposed — this one is the owner's to accept.

## 5 · METHOD NOTES — two traps this expansion already hit

**A number that equals its own ceiling is the ceiling, not a measurement.** The first mutant count for
both Phase 1 files came back **60 and 60** — which is exactly `mutate.mjs --limit`'s default. Re-run
uncapped they are **190 and 69**. Two files agreeing on a round number is the tell; a cap reports the
same value for everything it truncates, which is precisely what makes it look like a finding.

**Canary staleness arrives in CORRELATED BATCHES, because one commit touches several files.** Triaging
the three files due for re-crawl by *source movement since each crawl was written*:

| file | crawl | commits since | cause |
|---|---|---|---|
| `oxydex-dsp.js` | 2026-08-21 | **2** | genuine source drift |
| `integrator-dsp.js` | 2026-08-22 | **1** (#1643) | genuine source drift |
| `ppgdex-dsp.js` | 2026-08-21 | **0** | **not drift** — stale `after` vintage |

**#1643 staled `oxydex` and `integrator` together.** So canary refusals cluster by commit rather than
arriving singly, which retroactively explains why an earlier batch of four looked systematic when it
was one shared-touch change. And ppgdex having *zero* commits **rules drift out** independently,
leaving the record-vintage cause found separately in the crawl audit — two lines of evidence meeting
from opposite directions.

## 6 · Done when

- [ ] `DEFAULT_FLEET` carries Phase 1's two files and a full crawl → probe → draft cycle completes on both.
- [ ] Phase 2's 20 files each have a committed co-load recipe, `cpapdex-edf.js` and the `*-cross.js` first.
- [ ] §0's invariant holds in review: no model output reaches a verification path.
- [ ] Phase 3 and §4 remain explicitly recorded as deferred/proposed rather than silently dropped.
