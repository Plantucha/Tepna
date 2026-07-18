<!--
  TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-07-18 · **Created:** 2026-07-18

# Test-audit findings — follow-ups (residue after executing the 42)

Follow-up to `TEST-AUDIT-FINDINGS-2026-07-18-BRIEF.md` (house `-FOLLOWUPS` pattern). Executing that brief
closed **40 of 42** hollow gates with both-direction-verified assertions. This carries the residue: one
finding with no synchronous test seam, plus the two audit surfaces that were explicitly **out of scope**
of the first (JS-only, corpus lane) pass.

## §1 — #98 `overdex-walk` paged `readEntries` (real gap, no sync seam)

The mutation `all = all.concat(slice(batch))` → `all = slice(batch)` drops every 100-entry page but the
last — a **real** bug (a directory of >100 dropped files silently loses all but the final page). It was
NOT a no-op; the design-agent could not close it because `OverDexWalk`'s directory recursion is
**async webkit-entry `readEntries`** (paged at 100), and the test lane has **no async group support**
(same limitation noted in `TEST-COVERAGE-FOLLOWUPS §5`, which left it "to render-coverage"). **Options:**
(a) add a minimal async-capable assertion path to the harness and drive a stubbed `readEntries` that pages
at 100; or (b) refactor the accumulation into a **synchronous, exported** `mergePages(pages)` helper and
pin *that* with a known-answer (2 pages of 100 → 200 entries, not 100). **Recommend (b)** — a small
export seam is testable in the existing sync lane and documents the paging invariant.

## §2 — Python `capture-host/` was NOT mutation-audited (open surface)

The first audit was **JS-only** (`run-tests.mjs`). The Python side has its own `capture-host-ci`
(`ruff --select E9,F` + pytest, 47 tests) but **no defect-injection pass** — `polar_pmd`, `oxyii`,
`writers`, `clockcfg`, `viatom`, `telemetry` are unaudited for hollow gates. **Plan:** run a Python
mutation pass (`mutmut run` or `cosmic-ray`) over `capture-host/` against the pytest suite; triage
survivors the same way (a survivor = a test that stays green under a real defect). Independent of the JS
suite and the corpus, so it won't hit the rate-limit pattern that clipped the JS deep-scout wave.

## §3 — Deep-scout second wave (fresh mutations beyond the 99)

The first pass planted a fixed 99. A **deep-scout wave** (new mutations in the under-covered clusters —
the cross-SD family beyond the 5 caught, deeper estimator/threshold/index logic) was cut off by a session
rate-limit. Re-run it to find hollow gates the first 99 didn't probe; also drive the surfaces the first
pass never exercised — **browser render-coverage**, **CSP** / **no-network** static lanes, and
`verify-provenance.html` (the browser check of `gateA_ok`/`gateB_ok` owed for #73/#74 from the parent).

## Done when

§1 closed with a sync seam + known-answer (both directions), §2 has run at least one Python mutation pass
with survivors triaged (gated or dispositioned), §3's deep-scout wave has run and its findings are either
gated or spun into a further follow-up. Each lands as its own gated PR.
