# Heron · unit 82 · the two literal defaults the ledger asks a ruling on are already killed

**1. Unit.** Row `2026-10-25-the-literal-defaults-decision-set-is-eighteen-not-sixteen` says a ruling
over sixteen of eighteen literal defaults leaves two mutants unkillable. I measured both. Existing
tests kill both, and they are the two kills that the parent campaign counted and never named.

**2. Branch and worktree.** `claude/twodefaults-hrn` at `5bb578267` in `~/wt-twodefaults-hrn`,
base `d2ff56c16`, two commits. PR **#3978**, DRAFT. `pr-compliance` PASS over nine checks.

Commit one carries the three prose corrections in `capture-host/tools/scan_signature_only_defaults.py`
plus the changeset `changes/2026-10-26-uncovered-names-what-it-read.md`. Commit two carries the ledger:
the row above flips to `answered #3978`, and the new row
`2026-10-26-the-two-added-defaults-are-the-parent-campaigns-unnamed-kills` closes as `fixed #3978`.

**3. Exact stopping point.** Both gates run detached from
`scratchpad/gate82.sh`, writing `gate82.log` with `CH_EXIT=`, `NPM_EXIT=` and `EXIT=` sentinels. The
waiter is background task `bmc28823i`. Neither verdict had landed when I wrote this line.

**4. Next step.** Read `CH_EXIT` and `NPM_EXIT` from `gate82.log`. Both zero means post the two
verdicts to board 7 and ask Kestrel for the undraft, because I never undraft my own PR. A red names a
STEP, so read that step's own log and never the union job's line.

**5. Open questions.** The sixteen enumerated defaults stay OPEN and each is the owner's call: delete
the default, or enter it in `capture-host/tools/mutate-equivalence.json` with the reason. The two
structurally untestable defaults stay as their row dispositions them. My claim #1508 resolves when
#3978 merges.

**6. Blockers.** None for this PR. The sixteen need an owner decision and no measurement unblocks
them.

**7. The doc-search query.** `node tools/doc-search.mjs --read "are the two unruled literal defaults
killed by existing tests"` finds `briefs/RESIDUE.md:738`, board #1204 and #1255, and
`capture-host/tests/test_literal_defaults_taken.py`.

**The measurement, so a resumer need not re-run it.** One plant per default in isolation under
`-p no:cacheprovider`. `capture.py:262` `_reanchor(shift=0.0)` planted to `1.0` reads 1 failed and
1339 passed, killed by `test_sub_threshold_jitter_is_smoothed_not_followed`. `cpap_edf.py:352`
`_pad_records(fill=0.0)` planted to `1.0` reads 1 failed, 11452 passed and 3 skipped, killed by
`test_partial_records_are_padded_with_ZERO_flow_not_one`. At the campaign base `847579168` both
killing test files and both production functions are byte-identical to the ref.
