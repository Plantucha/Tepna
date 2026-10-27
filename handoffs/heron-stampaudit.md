# Heron unit 25 — the relink witness reads a stamp, not a device serial

## 1 Unit
`capture-host/loss_audit.py` searched a sibling filename for a bare 14-digit run. It took an H10's device serial as the stream's start instant, so a 658 s link loss printed `quiet-end-unclassified`. The fix adds an anchored reader in `writers.py` and names the absence it cannot measure. The unit also measured why the mutation gate of record refuses this diff.

## 2 Branch and worktree
`claude/stampaudit-hrn` at `067e3f478`, PR #3920 DRAFT, worktree `~/wt-stampaudit-hrn`, base `origin/main` at `bdc34c97d`, 0 behind, tree clean. Four commits: `09e410690` the fix, `29cc76b76` six filename shapes, `8f6ce393a` the ring kills, `067e3f478` the residue row. Six files.

## 3 Exact stopping point
PR #3920 is open DRAFT, MERGEABLE, head `067e3f478`. Gates ran detached, logs in `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/`: `final-gates2.log` on `29cc76b76` and `kills.log` on `8f6ce393a`.

- The narrowed mutation of `writers.x_file_start_stamp__mutmut_*` over my two touched test files: `MUTNARROW_EXIT=0`, 26 of 26 killed, `🙁 0`. Nine survived before the six new shapes.
- `check.sh`: `CHK_EXIT=0`, 11370 passed, 3 skipped, `TOTAL … 100%`, unwired PASS, ruff and mypy PASS.
- `tools/mutate_diff.py --base origin/main`: `EXIT=2`, UNKNOWN, `checked: 4, eligible: 5`. It decided 328 mutants and one glob recorded 0 tested, so it refused. That is the staging defect of board finding #1188, not my diff.
- The gate's 328 decided mutants named ten survivors in `loss_audit`. Five sit on lines I changed. Two new shapes kill them: `kills.log` reports 34 of 34 and 129 of 129 killed, `EXIT=0` each. Four more sit on the `file` and `epochs` dict keys of `_wear_end`, which this diff does not touch.
- `npm run check` was still running when I wrote this, log `npmcheck.log`.



## 4 Next step
Read `npmcheck.log`'s sentinel. Report its verdict on the PR body. Then the next unit is the cryptography floor: board #1189 relays the owner lowering `capture-host/requirements.txt` to `cryptography>=50.0.0`, row `2026-10-18-the-cryptography-floor-is-met-by-neither-venv`. It waits for my PR slot, since #3920 holds it.

## 5 Open questions
I owe a residue row for the four pre-existing `_wear_end` survivors. Board finding #1188 asks Kestrel to log and sequence the scratch-hostile-tests row, and the remedy is a design call in the mutation program's lane. Whether `DESELECTED_TESTS` takes seven file paths or the eight tests get the repo's own `.exists()` guard is not mine to decide.

## 6 Blockers
`mutate_diff` refuses this diff with UNKNOWN for a staging reason, not for my code. `capture-host/mutation_diff.py:3123` keeps dot segments out of the scratch on purpose. `tests/test_relevance_filter.py:124` reads `.github/workflows/capture-host-ci.yml` with no guard, so mutmut's stats pass dies there with 26 null keys. So the gate of record cannot go green on this branch until someone fixes that row. The narrowed run is the honest substitute. The body states the refusal as the gate's own verdict rather than claiming a pass.

## 7 The doc-search query
`node tools/doc-search.mjs --read "the relink witness reads a 14-digit device serial as a start stamp"` → `capture-host/loss_audit.py:1268` · `capture-host/writers.py:689` `file_stamp` · `capture-host/tests/test_writers.py:591`. For the gate, `node tools/doc-search.mjs --read "mutation scratch stages root reads by name"`.
