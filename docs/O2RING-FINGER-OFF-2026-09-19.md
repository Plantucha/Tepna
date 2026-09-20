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

---

# Evening (18:29–19:01) — the converse, pre-registered: what the WORN ring emits under disturbance

Pre-registration written 18:29:57 before any data; three tests, scored against it. Marks typed by the owner in chat;
times taken from the files' own transitions. Captures untouched.

## A · H10 GATT table — Unit A complete
Connected 18:37:15 (reconnect backoff up to 180 s). 22 characteristics, **no 0x2B2A** (prediction held — hash-less like the
Verity), `2a26` firmware revision present, `2a38` body-sensor-location, the same five Polar vendor UUIDs as the Verity at
different handles. Worn-vs-off comparison NOT TESTABLE: the strap advertises only on skin contact. The ring's 00:22
`recorded_at` survived the 06:06 deploy — #2662 proven in production.

## B · Ring rail mechanism — the predictions were wrong in one consistent way
Valid stimuli: shake · occlusion (finger compressed below the ring) · phone flashlight against the finger · half-off.
Invalid: "press the ring" (rigid — scored as HANDLING); first "lamp" (no source — NO STIMULUS). Runs ≥ 5 samples, the
`156` beat marker excluded:

| segment | n | 0-runs n / max | 199-runs n / max | 100-runs n / max | longest run |
|---|---|---|---|---|---|
| baseline (worn, still) | 7,405 | 1 / 39 | 0 / 0 | 2 / 11 | 44 @ 108 |
| handling (invalid press) | 11,118 | 7 / 146 | 6 / 72 | 21 / 344 | 344 @ 100 |
| no-stimulus (invalid lamp) | 6,997 | 9 / 53 | 4 / 65 | 30 / 135 | 135 @ 100 |
| shake | 6,998 | 0 / 0 | 2 / 20 | 12 / 136 | 136 @ 100 |
| half-off | 7,750 | 1 / 22 | 2 / 20 | 4 / 9 | 54 @ 97 |
| occlude | 6,370 | 11 / 80 | 6 / 37 | 27 / 99 | 99 @ 100 |
| flashlight | 6,491 | 7 / 108 | 10 / 81 | 25 / **672** | 672 @ 100 |

- lamp → sustained 199: **not supported** (199 runs max 81, always paired with zero runs and flat-100).
- shake → 0: **not supported** (no zero runs; full-scale swings, 83 beat markers in 56 s, two short 199 runs).
- occlusion: pulsatility collapsed toward 100; 11 zero runs, 6 199-runs; beats fell to 17 in 51 s.
- half-off: nothing — still worn. Baseline carried one spontaneous 39-sample zero run.

**Observation, no mechanism attached:** 0 and 199 arrive TOGETHER as short full-scale excursions whenever the pulsatile
signal is disturbed or lost, and the stream drops to FLAT 100 in the same episodes — the same rest value as no-finger.
So **off-finger ⇒ 100 (morning) does not give 100 ⇒ off-finger**: 100 means "no pulsatile AC signal", of which no-finger
is one cause. And no stimulus produced a steady rail.

## C · Verity — no idle constant
On the charger the unit is OFF (every charger-session file has 0 rows). Powered on, desk, sensor up: it streams
ambient-light noise (ch0 ≈ +235,000 … +248,000, ~290 distinct values per 300 samples). On the ankle (19:17, `worn=True`):
a live signal at ch0 ≈ −388,849 … −361,701 (p2p 27,148, longest run 2). Both states vary; nothing pins. `unknown` in the
kind table was the evidenced answer, and D5 removed the table.

## D · Bracketing of every ring 100-run ≥ T_STUCK in the corpus — the D5 basis
164 runs, 140 files, **55 census ring-nights** (57 night dirs; 56 with ring PPG; 50 carry ≥ 1 such run). Window 375 samples
(3 s) each side; "pulsatile" = ≥ 2 `156` markers and ≥ 20 distinct values.

| bucket | runs | samples | nights | length min / median / max |
|---|---|---|---|---|
| bracketed (pulsatile both sides = worn) | 3 | 4,600 | 3 | 221 / 411 / 3,968 |
| one-sided at FILE START (start-of-stream idle) | 30 | — | — | 225 / 250 / 7,375 |
| one-sided mid-file (13 before-only · 1 after-only · 8 neither) | 22 | — | ≤ 22 | 207 … 5,515 |
| end-of-file (reconnect-to-off-finger tail) | 80 | 709,988 | 45 | 201 / 6,930 / 27,712 |
| whole-file (reconnect opened a new file) | 29 | 281,952 | 21 | 325 / 14,851 / 15,053 |

The #2675 `absence` label was demonstrably wrong on 3 (2026-08-05 · 08-31 · 09-11; ≈ 0.05/night), undecidable on 22,
consistent with idle on 139/164 — resolved by FILE POSITION, not by the value. Owner re-ruling D5: the sidecar emits the
measurement (`bracket=<before>/<after>`, `varied` · `flat` · `unavailable`) and names nothing.
