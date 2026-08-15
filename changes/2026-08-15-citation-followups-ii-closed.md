---
bump: patch
type: changed
brief: CITATION-ATTRIBUTION-FOLLOWUPS-II-2026-08-08-BRIEF.md
---

`CITATION-ATTRIBUTION-FOLLOWUPS-II` closes. §2 and §3 were settled on 2026-08-08; §1 — the fixture
re-verification only the corpus holder could discharge — was settled on 2026-08-15.

**It was discharged in passing, not as an errand, and that is the useful part.** `verify-fixtures`
re-stamps *every* stale fixture, not only the node whose PR it is, so an unrelated PulseDex compute-path
change (#1316) settled this debt along with four other nodes'. The parent rebuilt five bundles —
Integrator · OverDex · ECGDex · PpgDex · Data Unifier. Two are orchestrators carrying no GATE-B fixtures;
the three that do were re-run against the real corpus and reproduced. `origin/main` now reads **14/14
verified under the current compute closure**.

Nothing was hand-stamped, no "export-inert" was written in prose, and the green suite was not read as
settling it — §1 named all three temptations and all three were avoided. The tool re-ran the app on the
real recordings; that is the whole of the evidence.

**One honest qualification.** The stamps certify the code as of #1316/#1317, not the citation-era
`computeHash` the parent recorded. That is correct rather than a shortfall: `verifiedUnder` names the code
that actually reproduced the bytes, and `FIXTURE-CORPUS-REACHABILITY` §4 already filed the general case as
*"the discharge is valid as of an instant, and the instant passes"* — a cost, not a hole. The debt §1
names — *these exports have never been re-run since a DSP comment moved their compute closure* — no longer
exists.

⚠️ **The first measurement of this was wrong in a way that reads right.** It reported 14/14 too, with
*different hashes*, because a pre-existing worktree directory made `git worktree add` fail and the shell
landed in another session's checkout — **482 commits behind**. A plausible answer from the wrong tree,
which would have been recorded as evidence. The check that caught it is one line:

```sh
git rev-list --count HEAD..origin/main
```

That is CLAUDE.md §👥.2b's *"measure the TREE, not the ref"* applied to worktrees: `worktree add` failing
does not stop the `cd` that follows it in the same `&&` chain from succeeding into a stale checkout.

Docs-only: no bundle, no compute path, no fixture moved.
