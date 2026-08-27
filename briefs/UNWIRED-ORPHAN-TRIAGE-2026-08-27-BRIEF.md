<!--
  UNWIRED-ORPHAN-TRIAGE-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-27 · **Created:** 2026-08-27 · **Executes:** step (2) of the `find_unwired` sequencing (tokenize → triage → red-on-stale) · **Follows:** the tokenize fix (#1863) · **Unblocks:** SCAN 5 red-on-stale

# The 12 orphans the tokenize fix exposed — verdicts, with two reasons that were false

## 0 · Currency, and a premise correction

Measured at `b1d19676`, `HEAD..origin/main` = 0, `status --porcelain` = 0.

🔴 **The 12 are NOT outstanding — they were dispositioned inside #1863, and `find_unwired --check`
reads `0 unexplained` on current main.** The assignment described them as newly exposed and awaiting
triage; that was one commit behind. What remained is the question #1863 did *not* ask: **were those
suppressions the right verdict**, or is some of it real work? `is_expected_ring` had already proved
that class — a documented enforcement point that nothing called.

So this brief is the verdict audit, not the disposition.

## 1 · Verdicts — PRE-STATED before any file was opened

| # | function | pre-stated | actual | note |
|---|---|---|---|---|
| 1 | `is_expected_ring` | wire | **WIRED** | done in #1863 — the security rule had two implementations |
| 2 | `assemble_spool` | suppress | **suppress** | consumer is the witnessed pull; hardware-blocked |
| 3 | `hdev` | suppress | **suppress** | drift-tolerant sibling of the wired `adev` |
| 4 | `read_edf` | suppress | **suppress** | round-trip partner of the wired `write_edf` |
| 5 | `close_harvest_decision` | suppress | **suppress** | unit-2 async-shell family |
| 6 | `list_sessions` | suppress | **suppress** | unit-2 family |
| 7 | `resume_target` | suppress | **suppress** | unit-2 family |
| 8 | `compare` | suppress | **suppress** | `adapter_ab` is in `mutate.py`'s SKIP set; no entry point |
| 9 | **`pull_spool`** | correct-or-delete | **REASON CORRECTED** | its reason was FALSE |
| 10 | **`message_call_lines`** | suppress | **REASON CORRECTED** | my own #1863 reason overstated it |
| 11–12 | `verify`, `merge` | — | already dispositioned | not in the current allowlist |

**Prediction vs outcome: 7 suppress-confirmed / 2 reason corrections / 0 wire / 0 delete.** I predicted
a possible DELETE for `pull_spool`; the standing ruling (*"a wrong justification is worse than no
justification"*) and prudence both say correct instead. Deleting tested protocol code is a decision,
not a cleanup.

## 2 · `pull_spool` — the reason was factually false

It read *"the multi-round spool driver the operator probe calls"*. **Code-uses: ZERO.** Nothing calls
it; its only non-definition mention is prose in `cpap_spool.py`'s header — and that header says it was
built *because* `as11_pull.pull_spool` "was a tested protocol function wired into nothing".

Production drives the spool through `cpap_spool_caller → as11_pull.pull_spool_round → sync_spool`,
which adds the ledger / promote / cursor transaction this bare multi-round loop has no notion of. So
the function is **superseded**, and the corrected reason says so plus what would retire it.

⚠️ This was invisible from two directions at once: prose kept the name off the orphan report, so the
stale-suppression scan then read its entry as spent. A false justification hidden behind a blind spot.

## 3 · `message_call_lines` — my own suppression reason overstated it

I wrote, in #1863, that it is *"consumed through the module's documented contract"*. **It is not
consumed at all.**

`classify(minus, plus, *, in_message_call=False)`'s docstring: *"callers that have the source pass
`lineno in message_call_lines(src)` … callers that don't keep the old behaviour."* `tools/mutate_triage.py`
calls `classify(a, b)` at **both** sites without it. So every mutant on a CONTINUATION line of a
multi-line `log.info(...)` is still judged REACHABLE — the exact distortion the module's own header
quantifies (85 `print()` survivors counted as reachable).

**But it is not trivially wireable, and that is the honest blocker:** the caller has the module PATH
and not the mutant's LINE NUMBER — `mutmut_diff` yields only the `-`/`+` lines. Wiring needs the lineno
extracted first, which is a real unit. The corrected reason states that rather than implying
consumption.

## 4 · What this says about suppression reasons generally

Two of nine reasons were wrong, and **both were wrong in the same direction: they claimed a consumer
that does not exist.** One I inherited, one I wrote myself six hours earlier. A suppression is read
once when written and then trusted indefinitely, so the failure is silent by construction — which is
why every reason in this file now has to say **what would retire it**. A reason that cannot name its
own exit condition is a claim nobody will ever re-check.

## Done when

- [x] All 12 verdicts pre-stated, then checked, with the misses recorded.
- [x] `pull_spool`'s false reason corrected.
- [x] `message_call_lines`' overstated reason corrected.
- [x] `find_unwired --check` still reads 0 unexplained.
- [ ] SCAN 5 red-on-stale (step 3) — unblocked by this, and its count must be RE-MEASURED on current
      main rather than carried from the pre-tokenize draft (`claude/find-unwired-stale-allow-m3v`).
- [ ] `message_call_lines` wiring — needs the mutant lineno; its own unit.
