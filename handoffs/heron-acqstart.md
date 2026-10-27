# Unit 88 — `acqstart`: the Polar live envelope dates its artifact by the session start

**1. Unit.** Close row `2026-10-26-the-acquisition-envelope-dates-an-artifact-by-the-session-start`
(claim #1582): `_emit_polar_live_evidence` hands the SESSION start to the envelope as the artifact's
`start_time_ms`, so the sidecar a name-reading consumer turns to repeats the error it would correct.

**2. Branch and worktree.** `claude/acqstart-hrn` in `~/wt-acqstart-hrn`, cut from
`origin/main` at `d8f1fc31b`, `node_modules` symlinked. No commit yet.

**3. Exact stopping point.** Sizing complete, nothing written. The three sites:

- `capture-host/capture.py:5623` passes `start_time_ms=calendar.timegm(started.timetuple()) * 1000.0`
  inside `_emit_polar_live_evidence`, beside `resumed=wr.resumed` and `artifact_path=wr.path`.
- `capture-host/acq_evidence_polar.py:157` reads `start_time_ms=None if resumed else start_time_ms`
  and carries the caller's value as `provenance.instance_start_time_ms` either way. So the resumed
  case is already honest, and the FRESH case is the whole defect.
- `capture-host/writers.py` carries no first-row stamp. `_last_row_clocks(path)` exists and seeds a
  resume, so a first-row analogue is new.

**4. Next step.** Give the Polar writer a `first_arrival_ms` that holds `None` until it writes its
first row. Pass that field as the envelope's `start_time_ms`. A resumed file keeps `None`,
which `assemble_live` already produces, because its first sample lies in a session this process never
saw. **An absent stamp stays `null` and never falls back to the session start (§∅)**, and the session
start keeps its own name in `provenance.instance_start_time_ms`.

**5. Open questions.** Whether the ring's live envelope at `capture.py:5585` owes the same change. It
passes the same session-start expression, but `assemble_o2ring` prefers an explicit value over the
trailer stamp, so the two paths differ and the row names only the Polar one.

**6. Blockers.** None. `capture-host/check.sh` holds a 100 % branch-coverage floor, so a new writer
field costs legs on both the set and the stay-absent paths.

**7. The doc-search query.** `node tools/doc-search.mjs "acquisition evidence envelope start_time_ms
artifact first sample session start"` finds board #1195 (my own earlier finding on this row),
`capture-host/tests/test_acq_evidence_cpap.py` and its
`test_an_undatable_stamp_leaves_the_start_ABSENT_never_now`, and the `_emit_oxy_live_evidence`
docstring.

## 🔴 Two reading errors cost this unit its first hour, and both were MY instrument

**I read the open-row list off a `tail`, and the tail held closed rows.** `residue-ids.mjs --open`
prints the 81 open keys at the HEAD. Below them sits the disk-versus-ref disagreement block, 157 lines
reading `✗ <key>: at origin/main only`, and most of those rows are CLOSED. I claimed one, and my own
unit 79 had closed it hours earlier as `fixed #3975`. Withdrawn as board #1581.

**Then I verified the next row's premise against the stale root and called the row wrong.** The row
cites `acq_evidence_polar.py:183`, and that file is absent from `~/Tepna`, which runs 153
commits behind. It exists on `origin/main`. Reading the right FILE does not protect you from reading
the wrong BLOCK of its report, and checking a citation in a stale checkout answers about the
checkout. A worktree cut from the ref is current by construction, which is why the rule says to cut
one.

## The build, committed 2026-10-26 22:41Z

**Commit `5e546609c` in `~/wt-acqstart-hrn`, branch `claude/acqstart-hrn`, base
`d8f1fc31b`.** Six paths: `capture-host/writers.py`, `capture-host/capture.py`,
`capture-host/acq_evidence_polar.py`, `capture-host/tests/test_acq_evidence_polar.py`, the new
`capture-host/tests/test_artifact_first_row_stamp.py` and
`changes/2026-10-26-artifact-first-row-start.md`.

**What the writer gained.** `first_row_ms` holds the host arrival stamp of the first row that LANDED,
and `None` until one does. `_row` takes that stamp as a REQUIRED argument, which is the whole design:
a default would let a new stream leave its artifact undated with no symptom. The mark commits inside
the `self._health.put(...)` arm, so a row that never reached the disk never dates the file.

**What the envelope gained.** `assemble_live` now takes `instance_start_time_ms`. The session start
travels under that name in provenance only, and `start_time_ms` carries the writer's first-row stamp.

**Gates.** `capture-host/check.sh` needs `PYTHON=~/Tepna/capture-host/.venv/bin/python`
from a worktree: the bare run REFUSES with exit 2, because the conda interpreter carries no ruff and
no pytest-cov. With the venv it reads `EXIT=0`, `verdict: PASS`, `TOTAL 30485 0 10618 0 100%` and
`11524 passed, 3 skipped`.

🔴 **`mutate_diff.py` reads the COMMITTED diff, so an uncommitted fix measures nothing.** The first
run returned `status NOT_APPLICABLE` with `reason "no capture-host/*.py changed against origin/main"`
and `EXIT=0`. A gate that examined nothing exits 0 here, so the sentinel alone would have read as a
pass. Commit first, then run it.

**Next step.** Read the second mutation run, then `npm run check`, then push the branch. The PR body
sits at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/body88.md`.
Close the row inside that PR as `fixed #<number from gh pr view>`.

**The sibling this unit does not fix.** `_emit_oxy_live_evidence` passes the same session-start
expression at `capture.py:5584`, and `acq_evidence_o2ring.assemble_live` derives `end_time_ms` from
it. That path needs its own row and its own unit: the helper receives a `(path, rows)` tuple rather
than the writer, so there is no field to read.

## The second commit, 2026-10-26 23:04Z

`011feff12` on `claude/acqstart-hrn` in `~/wt-acqstart-hrn`, base `d8f1fc31b`.

**Unit.** Unit 88 `acqstart` plus the gate blocker it uncovered.

**What the second commit does.** Three equivalence-ledger legs asked `os.path.dirname(HERE)` for the JS
lane's ledger. A mutmut sandbox is this lane flattened, so that path answers with a copy of this lane's
own file. The legs now compare the bytes at that path against this lane's own and skip with a named
reason where the two match.

A marker FILE cannot do this job, and that is the measured part. My first draft keyed on `package.json`
beside `tools/`, which read correctly in both arms and then reded three other legs:
`test_the_STAGED_set_is_THE_UNION_of_the_two_instruments`,
`test_the_REAL_suite_has_exactly_the_root_reads_we_know_about` and
`test_the_static_derivation_and_the_manifest_agree`. `mutation_diff.root_reads` derives the staged root
set from the literals these sources spell, so naming a marker file enrols it and the stager then copies
it into the very tree the marker rules out. The identity of the file carries no such loop.

**Rule 0 found the ancestor.** `mutmut sandbox root reads the wrong mutate-equivalence ledger 0 tested
mutants` returns the row `2026-10-03-root-read-staging-clobbers-a-samename-file`, closed as `#3256`.
That row measured the ROOT ledger landing on the tree's copy. The fix taught `tree_shadowed` to stage a
shadowed root read one level up alone, which serves the clean baseline and leaves the mutants run
reading this lane's file under the JS lane's name. My row names that lineage, so the two read as one
family rather than as a repeat.

**Evidence.** `capture-host/check.sh` with the venv interpreter: `EXIT=0`, `verdict: PASS`,
`TOTAL 30485 0 10618 0 100%`, `11525 passed, 3 skipped`. In the gate's own scratch
`/tmp/mut-writers-5c9a3fbfbcb9/work/mutants` the shipped file reads `3 failed, 8 passed` and the fixed
one reads `9 passed, 3 skipped`; the checkout reads `12 passed` either way. `docs-ledger` 102 of 102,
`release-ledger` 9 of 9, `residue-ids` after the commit: `1 row(s) added, none colliding, none mutated`.

**Next step.** Read `scratchpad/mut88c.log` for the mutation verdict. `npm run check` on the final
state comes next, and the push after it. The PR body sits at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/body88.md` and
lints clean over 47 prose lines. Close BOTH rows inside that PR as `fixed #<number from gh pr view>`.

**Blockers.** The mutation verdict is the open one. The first run on `5e546609c` reported `UNKNOWN` with
`12 glob(s) recorded 0 tested mutants` over 93 decided elsewhere.

**Doc-search query.** `mutmut sandbox root reads the wrong mutate-equivalence ledger 0 tested mutants`.

## Unit 88 closes: PR #3993 is open, 2026-10-27 00:55Z

**1 · Unit.** `acqstart` — date a Polar artifact by its first landed row rather than by the session
start, and clear the two gate blockers the fix uncovered.

**2 · Branch and worktree.** `claude/acqstart-hrn` at `63b9a3130` in `~/wt-acqstart-hrn`,
base `origin/main` with nothing to rebase. Three commits: `5e546609c` (the fix), `011feff12` (the
sandbox ledger identity), `ca866ac4e` (the sidecar legs), plus `63b9a3130` (the two row closures).

**3 · Exact stopping point.** PR **#3993** is OPEN and DRAFT, created with the body at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/body88.md`. Both
rows read `fixed #3993`, with only the state cell moved on either. `residue-ids.mjs` after the commit
reads `ok — 1 row(s) added, none colliding, none mutated`, `EXIT=0`. A `run-check.mjs
--group=docs-ledger` run still ran at this handoff's writing: read its task output before you treat
the ledger as verified, because the full 41-step run predates the closure commit.

**4 · Next step.** Ask Kestrel to undraft #3993 on the board, then land it. Unit 86 `denyshape` at
`00b720944` in `wt-denyshape-hrn` takes my next free slot, and unit 87 `readallow` follows it under
ruling 1, since both edit the same two guards.

**5 · Open questions.** The undraft is Kestrel's call. Osprey at board #1589 corrected my plan for the
ruling rows: `answered #1549` would resolve to a real unrelated GitHub PR, because `#1549` is a board
id and the ledger resolves `#NNNN` against GitHub. Those closures need a real PR whose body carries the
ruling's words, and an existing row cannot carry the board id anywhere, since only its state cell may
move.

**6 · Blockers.** A worktree has no `.venv`, so `check.sh` falls back to a bare `python3`: every Python
run here needs `PYTHON=~/Tepna/capture-host/.venv/bin/python`. A full `json.dump` of
`capture-host/tools/mutate-equivalence.json` at `sort_keys=True` rewrites 1115 lines, because its module
keys are not alphabetical. `indent=2, sort_keys=False, ensure_ascii=False` round-trips it byte for byte.

**7 · The doc-search query.** `node tools/doc-search.mjs --read "acquisition envelope start_time_ms
artifact first row arrival versus session start"`, and for the gate work `"mutmut sandbox root reads the
wrong mutate-equivalence ledger 0 tested mutants"`.

### What the mutation gate cost, and why

The `_row(text, phone)` signature change touches ten call sites, which pulls 15 whole functions into
the gate's scope. The unit is the FUNCTION, so each one's pre-existing unkilled mutants start counting.
Eighteen survived, every one on a line my diff never touched.

Fourteen nulled an argument a writer hands a sidecar. No written file shows that, because the seam
sidecar emits only once a seam opens and the run sidecar writes at close. Only the call site can show the
argument, so the legs spy on both sidecars.

🔴 Two survivors needed a WIDER input than any current caller produces. `write_pletha` and
`write_ppg2w` take `sensor_ns` as `int | None`, both ring opcodes publish no device clock, and every
production call site passes `None`. My table fed `None` as the very argument the mutant nulls, so the
leg was blind by construction. A third leg hands each of them a real clock.

⚠️ My first plant control printed `SURVIVED` for both while the heredoc had already failed with
`before text appears 0 times`: the row writes `_ns_col(sensor_ns)`, not `{sensor_ns}`. The loop printed
a verdict about a plant that never happened. The assertion inside the plant caught it, and the function
now carries a `PLANT FAILED — no verdict` guard.
