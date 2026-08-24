---
bump: patch
type: fixed
brief: none
---

`tools/mutation-ai-probe.mjs` — **an honesty rule about RECORDING was being read as evidence of NO
DIFFERENCE.** `verdictFor` refused any separation where the real code's output exceeded 100 KB — a
correct limit on what can be *drafted* — but it sat **before** the check for a mutant that crashes.
So a mutant that died loudly against a large-output function was scored `kill:false`, reason
*"output too large to record honestly"*.

The real code had already returned cleanly at that point (both prior guards passed), so nothing about
the finding was unassertable: the assertion is *"this input must not throw"*, and its expected value
is the crash, not the 100 KB.

🔴 **The cost was a fabricated diagnosis.** Every canary case for `cpapdex`, `motiondex`, `ppgdex` and
`oxydex` hit this guard — they are exactly the fixture functions returning whole synthetic datasets
(`_synthEdfSet`, `genSyntheticACC`, `detectBeats`). The canary counted each as a miss and refused the
file with *"the source moved since the crawl"* — **untrue: three of those four had zero commits since
their crawl.** Four files were skipped all night for a reason that was not the reason.

Also removed: a `both threw` branch that was **dead code**. The orig-THREW guard returns two lines
earlier, so its second conjunct could never be true — the second dead branch found in this file
today, after the `tier:'pool'` one.

**Deliberately unchanged:** two large outputs that genuinely differ still refuse. A draft assertion
must record a reviewable expected value, and a 100 KB expectation is not one. Separating that from the
crash case is the point — the guard now refuses only what it can justify refusing.

Seven selftests, both directions. Verified by re-application: restoring the original ordering fails 3.
