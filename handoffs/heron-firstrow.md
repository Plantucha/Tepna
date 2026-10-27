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
