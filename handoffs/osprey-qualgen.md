# Osprey — unit `qualgen`: an already-written qualifier is re-decided against the generator

**Status:** DONE — merged as `30570196e` (#4048) · 2026-10-28

## Unit
Row `2026-10-28-the-qualifier-uniqueness-test-compares-entries-to-each-other-not-to-the-generator`,
ordered by Kestrel. The matcher keys an equivalence ledger entry carrying `fn` on `(fn, op, before, after)` and ignores
the line, so the write-time condition is that exactly ONE generated mutant carries that identity. The python pin compares entries to each other, so it fires only on a PAIR and never on a
lone entry standing over two sibling mutants.

Sizing found the larger half. `qualifyPlan` pushed an `fn`-carrying entry into `already` unexamined,
so nothing re-applied the condition after the write; and `ambiguousWritten`, the quantity
`makeQualifyVerdict` fails on, was the CLI tally's own initialiser with no increment anywhere — the
§4b family inside the field whose comment claims the invariant "is kept and strengthened".

## Branch + worktree
`claude/qualgen-osp` @ `2f247a91b` in `wt-qualgen-osp`, cut from `origin/main` `5527cfef4`.
Three commits: the code (`fe33da87d`), the changeset and the ledger rows (`f29cfd5eb`), the three
populations that count a new root read (`2f247a91b`).

## What changed
- `tools/reanchor-equivalence.mjs` — `qualifyPlan` looks an already-written qualifier up in the
  histogram it already builds: `n === 1` keeps it, `n > 1` is WIDE (counted into `ambiguousWritten`,
  which FAILS), `n === 0` is DEAD and only prints, because it orphans its entry and excuses nothing
  (§∅: the pass counts the two apart and never folds them). Four new selftest legs, 130 in all.
- `capture-host/tests/test_equivalence_ledger.py` — a text pin that reads the sibling's source for
  the re-decision and for the FAIL arm, the same move as the `survivorKey` pin on `tools/mutate.mjs`.
  The python lane cannot execute the condition: the capture box has no node, the suite also runs
  inside a mutmut sandbox, and a python copy of the histogram would be a second copy of the rule.
- The populations a new root read moves: `capture-host/tools/root-reads.json` (re-folded by the
  declared trace, exactly one entry), the two counts pins in
  `capture-host/tests/test_mutation_scratch_reuse.py` (35 static / 55 declared / 55 staged), and
  `tools/verdict-adoption.json`, which bins the test file as `test`/`exempt` because its status word
  sits inside the assertion that pins the FAIL arm.

## Measured
322 qualified entries at `5527cfef4`, every identity naming exactly one generated mutant
(`histogram={"1":322}`). The live pass prints `"alreadyQualified":322,"ambiguousWritten":0,
"alreadyNamingNoMutant":0,"identityCollides":17`. So today's ledger carries no live false excuse, and
the 0 is an answer rather than an initialiser. A negative control proved the new text pin fires: red
with the re-decision removed, green restored.

## Exact stopping point
`capture-host/check.sh` on `2f247a91b` reads `EXIT=0`, 11611 passed, `TOTAL 30549 0 10628 0 100%`,
all seven sub-gates ok. The full `npm run check` on the same head runs detached with an `EXIT=`
sentinel; the previous head's run reded only at step 38/41 `verify:verdict-adoption`, which this head
fixes, and steps 1-37 passed there.

## Next step
Read the sentinel, post the gate numbers as a PR comment and a board report, then ask Kestrel again on
thread 8. Kestrel undrafts #4048; I never undraft my own.

## Open questions
1. §📌 writes the read-from-the-ref rule for ledgers, and this row named a test my checkout was behind
   on. Worth saying that it bites on SOURCE too.
2. The next row Kestrel named, `2026-10-28-equivalence-prose-misnames-the-function-on-ten-entries`,
   reports a measurement with no repair in it — the prose misnames 10 of 313 and no write path
   consumes the prose, which `proseFnAgreement` already prints as a control line. That reads like
   `answered <ref>`, not a fix. Asked on thread 8 as #1879, unanswered at the stopping point.

## Blockers
None. The PR is BEHIND, which is Kodiak serialising, not a stall.

## The doc-search query
`node tools/doc-search.mjs --read "equivalence ledger qualifier fn uniqueness within a module"`
