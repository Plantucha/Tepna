---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Nine surviving mutants in `nightqc.x_summarize`'s gap-detection are recorded as
`no-distinguishing-input` — with a proof from `merge_sessions`, not an effort estimate.

`merge_sessions` opens a NEW session only when `st > sessions[-1][1] + gap_sec`, so consecutive
sessions satisfy `b.start > a.end + 3600` STRICTLY. Three consequences settle the whole family:

1. No before-session can end exactly at `cur[0]` and no after-session can begin exactly at `cur[1]`,
   so the boundary the `<`/`<=` and `>`/`>=` mutants move is **unreachable** — same set either way.
2. Sessions being disjoint, a before-session has `end < cur[0] < cur[1]` and an after-session has
   `end > cur[1]`, so testing `s[1]` against `cur[1]` instead of `cur[0]` partitions identically.
3. Disjointness makes ordering by start and ordering by end the SAME order, so `min`/`max` keyed on
   `s[0]`, on `s[1]`, or on the list itself (`key=None` compares element 0 first, and starts are
   unique) all select the same session.

**Probe:** 20 000 random file-sets (n 2–12, start 0–86 400 s, mtime = start + one of
{0,5,60,900,4000,20000}) through `merge_sessions`, checking every consecutive pair — sessions not
gap-separated **0**, start-order ≠ end-order **0**, `s[1] == cur[0]` **0**. The entry records the
condition that voids the class: if `merge_sessions` ever stops separating by `gap_sec`, these become
killable.

Verified against `main`: all nine drop out of the survivor list.

⚠️ **Mutant numbers are per-function, not unique.** Checking by number alone reported all nine as
still surviving — the matches were `allan.x_stability__mutmut_85` and
`nightqc.x_arrival_quality__mutmut_120`, different mutants that happen to share an index. Match the
qualified name, or the ledger's verbatim key.

The other 16 survivors in that function are genuine test gaps and are NOT classified here: `_pool`'s
near-midnight boundary, the measured-Hz path, `span` at exactly `_MIN_SPAN_SEC`, and `cov` at exactly
`_DEGRADED_BELOW`. They need fixtures, which is a separate unit.
