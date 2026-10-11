---
bump: patch
type: fixed
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

The diff-scoped mutation gate refused whole runs (exit 2, verdict UNKNOWN) over mutants it had itself
excluded. A survivor whose diff is string-only is dropped from the required set deliberately, but a
registered equivalence claim naming it then matched neither the survivors nor the kills, fell through to
`not_decided`, and took the run down with it.

Three states are now distinct: a claim over a mutant the run does not require (`claimed_not_required`), a
claim the gate asked about and could not settle even in isolation (`claimed_unchecked`), and a claim
genuinely undecided (`not_decided`, which keeps the refusal). The first two are counted and named —
never a refusal, never a PASS — and a claimed mutant with no result now gets one isolated run before
anything is concluded about it.
