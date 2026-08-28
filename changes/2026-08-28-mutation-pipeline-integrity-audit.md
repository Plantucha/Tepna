---
bump: patch
type: changed
brief: MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md
---

`MUTATION-PIPELINE-INTEGRITY` §6 audited item by item against the code and the on-disk corpus —
**two of its five open items had already shipped.**

| § | item | verdict |
|---|---|---|
| 6.1 | `mutateAtLine` refuses an absent `after` | open, correctly deferred — now with a number |
| 6.2 | the MODIFY asymmetry | open, still unmeasured |
| 6.3 | scratch verdict cache, first-run control | ✅ **done — #1726** |
| 6.4 | zero-mutant-module guard | ✅ **done** — refuses on the induced failure |
| 6.5 | `before` stored `.slice(0, 120)` | open, verified present, still theoretical |

🔴 **6.3 and 6.4 were stamped in a sibling brief and left open here.**
`OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS` records both; this brief carried them as open for four days.
The work was done and stamped **where it was executed rather than where it was proposed** — the third
instance of that shape this week. When a sibling brief executes your item, the stamp is owed in both
places.

⚠️ **6.4 shipped by a different mechanism than proposed**, recorded rather than smoothed over. The
brief specified keying on `exit_code_by_key` under the glob prefix; `mutate_diff.py` keys on
`generated_count(...) == 0` plus a `_crashed` list and hands `_ran` back (`_ran -= 1`) in both cases.
The brief's objection to that route — *"the `_ran` counter cannot express it: a crashed invocation
increments it"* — is answered by decrementing rather than re-keying. A reader comparing the proposal
to the code would otherwise conclude the item was still open.

**6.1's deferral now carries a completion percentage.** It waits on crawls carrying `after` (#1723).
Measured across every `.mutation-crawl/*.crawl.json`: **181 of 2703 mutant records — 6.7 %**. The
writer is correct and the corpus has not turned over, so refusing today would still stop the pipeline
on 93 % of records. *"Deferred until crawls carry `after`"* becomes *"deferred, 6.7 % of the way"* — a
condition the next reader re-measures in one command instead of re-deriving.

6.2 was deliberately not touched: it is *"measured, unexplained, and deliberately not guessed at"*, and
an audit that has not run the measurement has nothing to add.
