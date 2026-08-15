---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`land-pr.mjs`'s `decide()` reasoned about a check's STATE without asking whether that check can BLOCK
THE MERGE. The same defect sat in both branches, in opposite directions:

    pending:  ANY pending check -> wait      should be: only a REQUIRED pending check waits
    failing:  ANY failing check -> fail      should be: only a REQUIRED failing check stops

**The pending half was already asserted in `tests/dex-tests.js` AND FAILING.** Two assertions on main
— "an ADVISORY pending check does not hold a green PR" and "…and the merge SAYS an advisory check was
still in flight" — were red. The fix they describe was documented, gated, and never in effect. The
gate was telling the truth and nobody was reading it.

The failing half was diagnosed from #1285: `mutation (diff-scoped)` failed, `land-pr` printed
`fail: 1 check(s) failed` and exited 1, and GitHub's auto-merge landed the PR minutes later unaided.
The operator is then sent to fix a PR that needed nothing. `mutation` is advisory BY DESIGN
(`mutation.yml`'s `continue-on-error`) precisely so a survivor cannot force someone to delete a
`# pragma: no cover` to go green — and a lander that stops on it re-imposes exactly that pressure.

Both branches now consult the required set, which the snapshot already read for the missing-context
rule and simply did not use here.

**FAIL-CLOSED, and `null` ≠ `0` is the load-bearing part.** `requiredPending` / `requiredFailed` are
`null` when the ruleset could not be read, and `decide` treats that as "every pending waits, every
failure blocks". Collapsing the unknown case to `0` would silently read "I could not read the
required set" as "nothing is required" — the fail-open direction that merges past a real red.

The merge verdict now SAYS `(N advisory check(s) still in flight)` rather than outrunning them
silently, which the existing assertion demanded in as many words: "merging past it silently is the
other half of the same defect — the mutation red already merges unnoticed, and a tool that quietly
outruns it makes that worse."

7 new assertions (29 in the group): a required failure stops and NAMES what to fix; an advisory red
does not stop even alongside a BEHIND branch; a mix of required and advisory still stops; an
unreadable ruleset makes every failure blocking and says so, so the degraded mode is visible.

Measured effect: three of four open PRs were `BEHIND` with auto-merge armed and zero failing checks —
stranded, not broken. A lander that stops on advisory reds turns that into a manual investigation
every time.
