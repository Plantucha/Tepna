---
bump: patch
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Two canary entries for `tools/extreme-canaries.json` — `clock.js` → `_ckP2` and `xmt-fixture.js` →
`recordInto` — so a Level A run on either file cannot report a clean result from a harness that was
not actually observing anything.

**What a canary is here.** `extreme-mutate.mjs` empties the named function before sweeping and
requires the suite to notice. If it does not, the run aborts with `CANARY FAILED` rather than
reporting `PSEUDO-TESTED 0`, which is what a blind harness and a healthy file look like from the
outside. Both entries were validated by running them, not by reasoning:

```
canary PASSED — emptying _ckP2 is noticed, so the harness detects mutations
canary PASSED — emptying recordInto is noticed, so the harness detects mutations
```

`clock.js` then reports 14/14 functions executed, **13 tested, 0 pseudo-tested**; `xmt-fixture.js`
reports **1 pseudo-tested, 1 excluded, 3 tested** — its designed known-answer, with the deliberate
`calculateSomething` as the pseudo-tested one.

**Recovered from an untracked copy in the shared checkout**, where it had sat while that checkout ran
197 commits behind. It survived a cleanup pass only because the reviewer declined to delete files
they were unsure about.

⚠️ **And it nearly did not survive, for a reason worth recording.** The cleanup test was *"does this
file contain an identifier absent from `origin/main`?"* — sound for code, blind here. `"clock.js":
"_ckP2"` names two things that both already exist in main independently; it is the **mapping** that
is new. For a config, registry, manifest or lookup table, a new key→value pair is most of what any
change ever is, so that test is blind to nearly every real change in that file class. The rule
adopted in response: apply the identifier test to code, diff the parsed key→value pairs (`jq -S`)
for structured data, and never delete a data file on an identifier scan alone.
