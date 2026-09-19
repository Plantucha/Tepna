<!--
  docs/O2RING-FINGER-OFF-2026-09-19.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# O2Ring finger-off capture — the idle value is 100, and zero is not idle (2026-09-19)

**Status:** REFERENCE (evidence record) · **last-verified:** 2026-09-19

Owner + Wren, capture box, 2026-09-19 10:33–11:06. Pre-registered protocol; marks typed by the owner in chat and
taken from the file's own transitions.


**Pre-registered question:** what value does the raw PPG stream hold with no finger in the ring?
**Answer: 100.** Idle-baseline reading ESTABLISHED. The 100 population in the corpus is ABSENCE (no finger).
**Zero is NOT the idle state**: zeros occurred only while worn (ON1 111 · ON2 37 · ON3 360) and at the
removal moment (OFF1a 48, the finger sliding out); a settled off-finger stretch has none. The 199 rail
likewise appears only worn (longest runs 72–73 @ 199 in ON1/ON2). Three populations → two mechanisms:
100 = absence; 0 / 199 = in-wear rail events.

Six independent off-finger stretches, all at exactly 100 once settled (see fingeroff-analysis-2026-09-19.txt):
OFF1b 14,982 · OFF2a 5,757 · OFF2b 15,023 · OFF3a 2,690 · OFF3b 14,961 samples at 100 %; OFF1a 85.9 % (contains the
removal transition: 80→82→…→95→100, first 100 at sample 17). OFF2a/OFF3a: first sample after removal already 100.

**What ends an off-finger stream — both corpus quanta explained, measured three times each:**
- the daemon's doff-pull (`pull.on_doff`, settle 45 s) pauses live capture: OFF1 link lost at +33 s then pull at +58 s;
  OFF2 pull at +50 s (link kept); OFF3 pull at +25 s (link kept). → the ~5,9xx-sample (~47 s) corpus tail.
- after the pull the daemon reconnects to the off-finger ring and it streams flat 100 until its own idle timer:
  last sample 121 s / 120 s / 120 s after reconnect (`alerts.RING_IDLE_TIMER_S` = 121.9). → the 14,9xx-sample
  (~120 s) corpus tail, and the whole-file-at-100 population (a reconnect after a ≥300 s gap opens a new file).
- run-length distribution OFF: ONE run per stretch (2,690–15,023 samples). No short-run structure at all.

Segments (box clock; marks in fingeroff-marks-2026-09-19.txt — owner typed marks in chat, times taken from the file):
ON1 10:33:52–10:37:55 · OFF1 10:38:00 → link lost :33 → pull :58 → reconnect 10:39:35 → idle-off 10:41:36 ·
ON2 10:43:09–10:45:28 · OFF2 10:45:33 → pull 10:46:22 → reconnect :32 → idle-off 10:48:32 ·
ON3 10:49:25 (stayed worn to ~11:02; the 10:51:30 removal did not happen) · OFF3 11:02:25 → pull 11:02:50 →
reconnect 11:03:10 → idle-off 11:05:10.
File: fingeroff-session-20260919103348_PPG.txt (a copy is retained in the capture box's exports; the capture itself is untouched).
Second witness: OXYLIFE.csv rows at the same instants show `link lost` / `paused_for_pull` / `connecting` states.
