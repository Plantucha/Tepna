# Heron — unit 15: the ring's clock is synced by the read, not by the write

**1 · UNIT.** Residue row `2026-10-21-the-ring-clock-is-claimed-synced-on-an-unacknowledged-write`
(mine, logged 10-21, OPEN at `origin/main`). Board claim #1163, unit report #1166.

**2 · BRANCH + WORKTREE.** `claude/ringsync-hrn` @ `c138c47ce` in `~/wt-ringsync-hrn`, cut
from `41b77cdc6`, 0 behind `origin/main`, local and remote refs agreeing. PR **#3915, DRAFT**.

**3 · EXACT STOPPING POINT.** The unit is complete and the PR is open. Three gates ran on
`c138c47ce`: `capture-host/check.sh` EXIT=0 (11347 passed / 3 skipped, `TOTAL 29981 0 10392 0 100%`),
`npm run check` EXIT=0 over all 40 steps, and `tools/mutate_diff.py --base origin/main` EXIT=0 but
**`NOT_APPLICABLE` with `checked: 0`** — `capture.py` and `webmon.py` carry module-level exclusions
covering 404 functions, so the gate examined nothing. Four hand-planted mutants each red a test. I restored the tree from `HEAD` and `git status` prints
nothing.

The diff: `capture.py:617` adds `_OXYII_RTC_CONFIRM_S = 2.0`; `_rtc_sync` (~`:6711`) stamps the new
`ring_rtc_push` instead of `clock_synced`; the read-back (`:6072`) stamps `clock_synced` inside the
bound and clears it outside; `monitor.html` gains the three-state pill, tooltip and detail panel;
`webmon.py:477` forwards the key; six test changes across three files.

**4 · NEXT STEP.** Nothing on this unit but the owner's readying — I never undraft my own PR. The next
unit takes the next OPEN row of my lane from the ref (`node tools/residue-ids.mjs --open`), claims it
on the board, and waits for the one-PR cap to free if #3915 is still open.

**5 · OPEN QUESTIONS.**
- Kestrel owes the closure for this row against #3915, plus the seven still owed from units 9–14
  (listed in report #1166).
- I still owe three NEW rows, none logged yet: the §3 absorbed-shift defect (`capture.py:342` and `:8790`
  against `writers.py:2342`), the borrowed reason at `tools/measurement-walk.mjs:240`, and the Polar
  live producer filing one envelope per stream under one `session_id`.
- Owner decisions outstanding: the re-judge bin ruling (#1162), the NAS export (#1148), §4 of
  `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md`, and a probe night for the daemon-RSS row.

**6 · BLOCKERS.**
- The mutation gate cannot measure anything in `capture.py` until
  `MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md` lands. Any future `capture.py` unit must hand-plant
  or claim nothing; a green exit there is about a population of zero.
- The NAS corpus export is still dead, so no unit needing a real recording can run honestly here.
- `MEMORY.md` passed 24 KB on 10-25 and is cut past that, so my lead section must stay trimmed.

**7 · DOC-SEARCH QUERY.**

```
node tools/doc-search.mjs --read "the ring clock is claimed synced on an unacknowledged write"
```

Top hits: `memory/o2ring-timestamp-is-drawn.md` (0xC0 pushes host wall-clock; the RTC free-runs,
+151 s measured 2026-07-17) · `capture-host/probe_rtc_read.py` (GET_INFO [24:31] IS the RTC, so time
can be PULLED) · `capture-host/tests/test_capture_runners.py:9412` (the clock watchdog, which does
nothing when the window has measured nothing).
