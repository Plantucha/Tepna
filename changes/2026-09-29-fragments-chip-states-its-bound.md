---
bump: patch
type: fixed
brief: NIGHT-0928-ERRORS-2026-09-29-BRIEF.md
---

The monitor's fragment count now states **the threshold it counted above and the seconds it actually
lost**, instead of a percentage that had rounded them away.

E10′ of the 09-28 error read. The chip showed `2 fragments · 100 %` for ECGDex on a night whose
QC-SUMMARY read `gaps_in_night: []`, so a reader could only conclude one of the two was lying. Neither
was: QC's measure is night-level over the judged session; `fragments` counts row-to-row holes wider than
`gap_s` **in one file**. Nothing on either surface said they answer different questions.

**The percentage was the part that hid the answer.** `coverage` is `1 − gaps/span` rounded to 3 dp, so
09-28's real hole — **2.8 s in 24,367.1 s** — rounded to `1.0` and printed as `100 %`. The magnitude was
measured in the same loop and thrown away by the rounding: `(1 − coverage) × span` recovers `0.0 s`, not
2.8. So `stream_stats` returns `gaps_s` beside `coverage`, the payload carries `gaps_s`/`gap_s`/`span_s`,
and the chip reads `2 fragments · gaps > 2.0 s · 2.8 s of 6.8 h` — the 0.01 % non-finding it always was.
The percentage is kept for the case where it says something: a loss large enough to survive the rounding.

**E10 as first specified would have made things worse.** It read "fragments counts source files; label it
for what it counts or count sessions from QC's `sessions`". Measured against 09-28's live payload,
`fragments` matches **neither**: ECGDex has 4 files, 1 session stamp and `fragments: 2`; MotionDex has 3
files, 3 stamps and `fragments: 1`. The label was already accurate and relabelling it "files" would have
shipped a new falsehood. The corrected item is E10′.

**Two things the tests caught, both mine.** The first plant used 1 Hz rows, whose `_cadence_gap` is
5 × 1 s = 5.0 s, so the 2.8 s hole sat *below* the cut and was correctly not counted — the test was wrong
and the code was right, recorded in the comment so the next reader does not re-derive it. And
`test_stream_stats_edge_rows_and_unreadable_paths` asserts the whole return by equality, so it caught the
new key immediately; the fix is the expectation, not a looser assertion.

`check.sh`: ruff ok, shellcheck ok, pytest ok, mypy 11 at baseline. A fresh worktree has no `.venv`, so it
runs with `PYTHON=` pointed at the primary checkout's, exactly as `check.sh`'s own header documents —
without it, missing runtime types made mypy read 21 and `NOT_COMPARABLE`.

⚠️ Inert until deployed: the box serves its own copy, so this changes nothing the owner sees until the
update timer takes the page or the owner authorises a restart.
