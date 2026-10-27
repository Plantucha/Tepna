# Heron handoff — the night judge's clock-record word list (unit 16, measurement only)

**1 · UNIT.** Row `2026-10-21-the-night-judge-counts-clock-rows-that-recorded-no-clock-write`, claimed on the board as #1167 and reported as #1168. Measurement only. #3915 holds my one open PR, so this unit opened none.

**2 · BRANCH AND WORKTREE.** None. I changed no file in any checkout. I read `/srv/tepna/captures` on vigil read-only over ssh and wrote nothing there.

**3 · EXACT STOPPING POINT.** I posted finding #1168 to thread `work`, and it lints PASS. The scratchpad holds the four measurement scripts and the finding at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/`: `bin-clocksync.py`, `trade.py`, `variants.py`, `coverage.py`, `named.py`, `finding-nightjudge.md`. They read a CLOCKSYNC glob and print counts. They hold no state.

**4 · NEXT STEP.** One line of code, once a PR slot frees. Add `"deferred-after-pause"` to `_A5_NON_RECORD_EVENTS` at `capture-host/solid_night_inputs.py:1301`. Fix two docstrings in the same diff.

`clock_records` says `deferred-absent` is "the one event word excluded" while the code excludes three. `unrecorded_shift`'s PRECEDENCE list says the recorded test is "Checked FIRST", while the code checks density first and its inline comment calls that order load-bearing.

Then add a test naming each excluded word. The suite names only `deferred-absent`, and tuple membership is not a branch, so the 100 % coverage floor never asked.

**5 · OPEN QUESTIONS.** The owner's half of the row stays his. His ruling treats a short head before the first clock-set as reduced coverage. The judge's thin-head UNKNOWN sits at `solid_night_inputs.py:1808` and the rank aggregation at `:1863`. The row's named case is a density refusal and not a thin head, so that change would leave it UNKNOWN. Whether a density refusal annotates or ranks is his call, because annotating every tripwire UNKNOWN empties the band.

**6 · BLOCKERS.** No night reachable from rig carries a `LOSS-AUDIT.json`, so `clock_records` returns None here and A5 never runs end to end on this machine. An end-to-end check of the one-word fix needs the box, or a committed fixture night. The word-list change itself needs neither.

**7 · THE DOC-SEARCH QUERY.** `node tools/doc-search.mjs --read "the night judge counts clock rows that recorded no clock write"` → `capture-host/solid_night_inputs.py:1278-1307` · `capture-host/tests/test_solid_night_inputs.py:1128-1150` · `capture-host/nightqc.py:3551`.

**THE NUMBERS, so the implementer does not re-derive them.** 54 CLOCKSYNC files, 108 device-nights, 19,455 rows, 2,685 kept. 1,360 of the kept rows landed no write, which is 51 %. `deferred-after-pause` is 968 of them and the writer's vocabulary docstring omits it.

Over 1,794 h of kept-row span the excuse window pre-excuses 14.8 % of the night today. Dropping the one word halves that to 7.5 %. The two landed words alone leave 4.9 %.

On the row's named night the H10 keeps 28 rows: 26 `deferred-after-pause`, one `uncorrectable`, one `synced`. The density arm fires on two deferrals. Drop the word and it cannot fire.

**ROWS I OWE, none logged yet.** The undocumented tenth word is a new one. Three others wait. The §3 absorbed shift at `capture.py:342` and `:8790` against `writers.py:2342`. The borrowed reason at `tools/measurement-walk.mjs:240`. The Polar live producer, which files one envelope per stream under one `session_id`.
