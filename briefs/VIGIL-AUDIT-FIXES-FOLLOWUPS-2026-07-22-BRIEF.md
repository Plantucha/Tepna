<!--
  VIGIL-AUDIT-FIXES-FOLLOWUPS-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-22 · **Created:** 2026-07-22

_Follow-up to `VIGIL-AUDIT-FIXES-2026-07-21-BRIEF.md`. What the FIRST real overnight on the shipped code
(2026-07-21 → 2026-07-22, a full ~9 h session that crossed midnight) surfaced — and how each was closed._

# Vigil audit fixes — followups from the first real cross-midnight night

**Out-of-suite (`capture-host/`, Python).** The parent shipped the per-stream **coverage** feature (its #2).
The very first real overnight — which, like every sleep session begun before midnight, **crossed 00:00** —
proved the coverage math right in intent but wrong in two edge cases that only a real night could expose.
Both are fixed, verified against the live night, and hold 100% capture-host pytest coverage.

## Validated on the real crossing (parent items that WORKED)

- **#1 midnight-anchor:** the session ran 19:46 → 04:41, and `night_dir`'s start-date roll kept it capturing
  with **no truncation** — the `2026-07-21` folder grew past midnight to 02:41 and a post-midnight
  reconnect opened `2026-07-22`. `active_nights` correctly protected the live night; archive never
  mirrored-and-marked it mid-recording. The fix the parent could only reason about is now observed.
- **O2Ring auto-pull:** fired at 04:52 as the ring came off and pulled the complete onboard `.dat`
  (`20260721195054`, 95 779 B, `declared_size` matched, ~31 907 samples ≈ 8.9 h at ~1 Hz) — so the churny
  live link's ~79 % coverage is backed by a full-night backup. A manual `/api/pull` confirmed all four
  flash sessions were already on disk.

## Fixed — the two coverage edge cases the night exposed

**§1 — Intermittent-day span inflation (executed as the qc-session-span fix).** The box had also run during
the day of 07-21, so that date folder held BOTH a daytime session and the evening's — and coverage measured
each stream against the folder's whole **~20 h** mtime span, reading a stream that was streaming *right now*
as **0 % degraded** (observed live: every stream flagged 0 % while H10 ECG grew 657 lines / 3 s). Fixed by
grouping files by their `_YYYYMMDDHHMMSS_` start stamp and scoping coverage to the **current session** (a
gap wider than `_SESSION_GAP_SEC` = 1 h starts a new one). Live result: span 19.9 h → 37 min, coverage
0-18 % → 86-101 %, zero false `degraded`.

**§2 — Cross-midnight split + a stable-connection blind spot (executed as the qc-cross-midnight fix).** The
same night then exposed two coupled bugs:
1. **Split across two date folders.** `night_dir` rolls each connection into a folder by its START date, so
   an overnight begun before midnight lives in *two* folders; QC read only the current one, so every device
   that crossed midnight read low (H10 **37 %**). Fixed: when the current folder's earliest session opened
   just after midnight, **pool the previous day's folder** (gated on the near-midnight start so an ordinary
   mid-day session never re-reads a whole prior day).
2. **Start-stamp clustering split a long stable stream.** Session isolation clustered by connection *start
   stamp*, so the H10 holding **one 19:46 → 02:41 connection** (a single stamp) looked like an isolated
   point and got dropped as a "gap" though it streamed the whole time. Fixed: **merge ACTIVE INTERVALS**
   `[start, last-write]` instead of start points, so a long continuous stream stays inside the session.

Live result: span 5.4 h → **9.3 h** (the full overnight), H10 34 % → **93-96 %**, Verity ~64 % → ~93 %,
`degraded` [] — and `streams`/`missing` are session-scoped too. Regression tests cover the cross-midnight
unify, the mid-day non-pool, and the interval merge; a device can span at most one midnight (≤ 2 folders),
so pooling one previous day is complete.

## Lesson

The coverage denominator is only as honest as its notion of "the session." A synthetic test with fresh
mtimes never crosses midnight and never holds a multi-hour connection, so 100 % line coverage passed while
the metric was wrong for its PRIMARY case (every real overnight). Both fixes were found by running
`nightqc.summarize` against the **actual live folder**, not by re-reading the tests — the same
"read the real signal against physics, not the twin" discipline the Dex-side audits keep relearning.

## Open

Nothing from this thread. The parent's deliberately-declined items (`#5` per-stream stall teardown, `#6`
dead `LINK.csv` columns) and off-by-default alerts (`P7`) remain owner-decision, recorded in the parent.
