<!-- SPDX-License-Identifier: Apache-2.0 -->
# Heron — unit `firstrow`

**Unit.** Part (a) of residue row `2026-09-22-filename-stamp-still-wrong-for-other-consumers`, on the
O2Ring rail: the live acquisition envelope dated its artifact by the capture process start.

**Branch + worktree.** `claude/firstrow-hrn` in `~/wt-firstrow-hrn`, cut from `origin/main` @
`9d346e5c5`. One commit over seven paths.

**Exact stopping point.** `capture-host/check.sh` under the primary checkout's venv interpreter reads
`EXIT=0`, all gates green, `TOTAL 30492 0 10620 0 100%`, and `Required test coverage of 100% reached`.
Three plants each red by name, and `git diff` restored the shipped tree after each revert. The PR opens
as a DRAFT, and Kestrel undrafts it against the repo-wide cap.

**Next step.** Ask Kestrel on thread 8 to undraft. Then take no further unit until the owner orders one.

**Open questions.**
- Does part (a) now discharge the row? The code exists on both rails, but the row's evidence asks for a
  night and a deploy, and the deploy stays the owner's. I left the state cell OPEN.
- Board #373 measured half (a) as "no code owed". That holds for a sidecar that only restates a start.
  It does not cover the ring's `end_time_ms`. That field derives from the start, so it exists in no
  byte.

**Blockers.** The ring's own host-rail population resists measurement on this machine. This checkout
tracks no host-written `*_SPO2.csv` and no acquisition envelope, and the capture corpus lives on the box. So
the PR presents the structural finding plus a test-measured arithmetic amplification. It does not borrow
part (a)'s 18.7 h, which came from Polar stream files.

**The doc-search query.** `capture filename stamp written from the session start rather than the first
sample` → board #1195 · board #373 · `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md` · census
row `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify`.

**Measured, and worth carrying forward.** This checkout tracks 42 vendor-app exports of the ring's
SpO2 CSV. Every name agrees with its own first data row to the second: min 0 s, median 0 s, max
0 s. The vendor's writer names from the first sample. The host's writer names from the process start.

Fleet-Session: Heron


## §2026-10-27 evening — the mutation gate, and the three survivors no input separates

**Where it stands.** CI's `mutation (diff-scoped)` redded #4019 with 25 survivors in the 6 functions
this branch changed. I reproduced the gate locally at the same head and it named the same 25. The gate
scopes to the FUNCTION, not the line, so adding two fields to `Spo2CsvWriter.__init__` and two
parameters to `assemble_live` pulled every pre-existing line of both into scope.

**22 are killable, and now die by name.** `tests/test_ring_first_row_stamp.py` gains 11 legs over the
constructor and the envelope's identity fields: the resume test at one byte and at zero, the open mode,
the open-writer registry joined and left, the `ROW LOST` line naming its file, the 64 KiB buffer
observed by two checkpoints, and the sentinels a `None` kwarg would replace. A 25-case plant harness
confirms each kill reds the leg that is ABOUT it.

**3 are unkillable, and the ledger says so with a committed battery.**
`capture-host/tools/probe_firstrow_equivalence.py` drives each mutant as a separate module from a copy
of the real source: 240 writer cases and 864 envelope cases. Its four canaries per unit — mutants a
committed test already kills — read 30, 90, 60 and 60 of 240, and 864, 864, 576 and 144 of 864, so the
battery has demonstrated it can see. The three candidates read 0 of 240, 0 of 240 and 0 of 864.
`tools/mutate-equivalence.json` carries them as two `no-distinguishing-input` entries under
`Spo2CsvWriter.__init__` and one `untestable-by-design` entry under a new `acq_evidence_o2ring.py` key.

**The new ledger key costs a ratchet line.** `tests/test_equivalence_ledger.py` asserts the RATCHET
names every module the ledger carries, and its docstring says an addition is meant to fail: "adding the
line is the same edit as adding the module." Until I added it, the gate REFUSED writers.py — a red
baseline makes mutmut call every mutant killed, so it reported nothing rather than a pass.

🔴 **The lesson of the window: a stale `__pycache__` outlives a source restore.** An earlier local gate
run left bytecode written 0.145 s before `writers.py` inside the same whole second at a matching size,
and Python's freshness test is (mtime to the second, size). It presented as an impossible measurement —
`id(self)` disagreeing with `f_locals['self']` in one frame — and as a red leg on a clean tree, which
sent me hunting a defect in `close()` that does not exist. Memory:
`hand-applied-mutants-need-a-pycache-purge` §2026-10-27.

**Gates on the head `b07dcb8c0`.** `node tools/mutate_diff.py --base origin/main` reads `EXIT=0` and
`status PASS`: generated 159, decided 159, killed 153, survived 4, excused 4, undecided 0. The fourth
excused entry is a pre-existing `Spo2CsvWriter.write` flush-boundary row from an earlier unit, in scope
because the gate scopes to the function. `capture-host/check.sh` under the primary checkout's venv
interpreter reads `EXIT=0`, all gates green, `TOTAL 30492 0 10620 0 100%`, and `Required test coverage
of 100% reached`, with 11563 passed and 3 skipped. `npm run check` reads `EXIT=0` and `✓ check — all 41
steps passed`, 14571 assertions over 834 groups, GATE A all 9 bundles matching, GATE B 26 fixtures
reproducible. A per-commit scan for the `home-path` rule reads 0 added lines on both commits.

**The coverage pin costs a second full run.** `coverage_scope.py` sits inside the floor it enforces, so
editing the pin re-runs the whole script. Budget two `check.sh` runs for any unit that adds a
`tools/*.py`.

**Unit, branch, worktree.** Unit 103 `firstrow`, residue row
`2026-09-22-filename-stamp-still-wrong-for-other-consumers` part (a), claim #1700. Branch
`claude/firstrow-hrn` in `~/wt-firstrow-hrn`, base `9d346e5c5`, two commits: `6bbc1f43e` (the repair)
and `b07dcb8c0` (the mutation work, five paths, 463 insertions). PR #4019, OPEN as a DRAFT.

**Exact stopping point.** I pushed `b07dcb8c0`, reported the resolution at
`#4019 issuecomment-6450685508` and at board #1710, and appended this section. At the push CI read
13 pass, 12 pending, 2 skipping, with `secret-scan` SUCCESS and `mutation (diff-scoped)` IN_PROGRESS.

**Next step.** Read `gh pr checks 4019` as an aggregate bucket count, never off a tail. Then take no
new unit: Kestrel ordered me to finish this one, write the handoff and wait for an order.

**Open questions.** The undraft stays Kestrel's call, asked at board #1704 and repeated at #1710. The
row's own evidence asks for a night and a deploy on the capture box, which I cannot witness, so I left
the row OPEN and said so.

**Blockers.** A deploy to vigil stays owner-authorized, so the repaired naming reaches a real capture
only when the owner deploys. Nothing blocks the code or the gates.

**The doc-search query that finds this.** `node tools/doc-search.mjs --read "ring envelope dates its
artifact by the SpO2 CSV first row"`, and for the gate lesson `"mutation gate scopes to the function
not the line"`.
