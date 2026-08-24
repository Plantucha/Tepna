---
bump: patch
type: changed
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---

`briefs/MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md` §3e — **cause ISOLATED**, closing an item that
had stood open since 2026-08-23 and whose founding evidence turned out to be a confound. Brief flipped
`IN-PROGRESS`.

**The rule, from seven runs:** the first run after a test is **ADDED** does not credit it; that run
refreshes the cache, so the *next* run is correct. A **MODIFIED** test is credited immediately.

🔴 **Run 7 is the proof and was the only experiment that could have been:** a byte-identical tree
produced the opposite verdict from run 6. Every earlier attempt changed something, so none could
separate *"the change fixed it"* from *"a second run fixed it"*.

**Where it lives:** `mutants/<module>.meta` holds `exit_code_by_key` and invalidates on
`hash_by_function_name` — **source** hashes, with tests absent from the key. §3e listed three
candidates and refused to pick; candidate 1, *"mutmut's own per-mutant result persistence"*, is the
one. That refusal was right: two of the three were wrong, and the wrong ones were the more intuitive.

⚠️ **One thing is left explicitly unexplained** rather than smoothed over: if tests are absent from the
invalidation key, a MODIFIED test should have been missed too, and run 5 shows it was not. The ADD case
is proven; the MODIFY asymmetry is measured and unexplained.

⚠️ **Three of my own earlier readings are recorded as corrections**, including the expensive one:
*"clearing the scratch fixes it"* was a **confound** — every run that appeared to prove it was also a
second-run-after-the-change. Run 7 isolated the variable by clearing nothing.

The original text is retained in full, because the reasoning it refused to do is what makes the answer
trustworthy.
