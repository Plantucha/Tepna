<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-12 · **Follows:** `PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md`

# The estimator exists and has never seen a real arrival

`PAT-OFFSET-ESTIMATOR` shipped two published estimators and a certificate. Everything it claims was
measured on **planted data** or on the *per-sample* columns of existing captures. The sidecar that
motivated it had not written a single row when that brief was stamped DONE. This is what execution
surfaced, in the order it should be answered.

## 1 · The first real night — the only item that is not optional

The arrival sidecar deployed 2026-08-11 (box HEAD carries #1170; `PmdArrivalLogWriter` verified
present in the deployed `writers.py` and `capture.py`; daemon active). The first `*_PMDARRIVAL.csv`
will be written by the capture that starts the evening of 2026-08-11.

- **Read values, not durations.** A sidecar that exists proves nothing — the whole reason `arrival_rows`
  and `arrival_canary` exist is that the write is wrapped in a bare `except: pass`. Check
  `nightqc.arrival_quality()`'s `rows` per device, then check the values are not degenerate.
  (Precedent: a 194-night SpO₂ claim that was 193 nights of a −1 fill.)
- **Then run `clock_offset.estimate` on it** and read `certified`. The sweep predicts **77 %**
  certification in a real night's regime (n ≥ 2000 over 8 h, jitter ≤ 30 ms) — so roughly one night in
  four legitimately refusing is the expected outcome, not a defect.
- ⚠️ **The ring leg is the one to watch.** Its `OXYLIVE_DURATION_S` pairing has never been exercised at
  all, and the whole argument for fitting rather than min-filtering rests on a drift of 1–55 ppm that
  was measured *once*, out of band.

## 1a · §1 IS ANSWERED — the first real night ran (2026-08-12)

`159,607 rows, 13.3 MB, 10 files`. Writer sound: arrivals strictly monotonic per stream, no row with
`last_sensor_ns < first_sensor_ns`, `n_samples` constant and never zero, and the five empty sidecars
are HR/RR-only sessions that never enter the PMD path, i.e. honest.

| stream | n | certified | agree | ppm |
|---|---|---|---|---|
| H10 `ecg` | 45,663 | **yes** | 4.55 ms | −20.42 |
| H10 `acc` | 36,125 | **yes** | 4.08 ms | −20.51 |
| Verity `ppg` / `acc` | 35,223 / 10,948 | **yes, after the pairing fix** | — | −19.6 / −24.2 |
| O2Ring `duration` | 24,289 | no | 22,300 ms | 5231 |

The H10's two streams agree to **0.09 ppm**, against the 0.17-worst/0.10-mean predicted from the
planted sweep and the box corpus — an independent reproduction on data that did not exist when the
prediction was made — and −20.4/−20.5 ppm is a third landing on Clock Contract §7's documented −20.3.

**Three findings carried into `PAT-PACKET-ARRIVAL` §6.2:** the pairing used the wrong column (fixed,
and it is what unblocked the Verity); the ring's counter runs at **3851 ppm**, not 1–55, so the finger
leg has no PAT-grade clock; and the 5 ms floor premise was unreachable, so the SMEARED canary arm is
retired after firing on every stream.

**§3 is now the blocker and is unchanged:** whether correcting both legs repairs the anatomical sign.
The inter-device offset is measurable for the first time (~923 ms H10↔Verity on this connection), so
the experiment can finally be run — but the ring leg may not support it.

## 2 · Is the offset actually constant within a connection?

`PAT-PACKET-ARRIVAL` §5 assumes it and says plainly that it "has not been directly tested." Within-night
σ of 29–36 ms against 2.2 s between nights is *consistent* with constancy and does not establish it.
The sidecar is what finally allows the test: fit `estimate` over the first and second halves of one
connection separately and compare. If the offset moves within a connection, the per-connection model is
wrong and the correction cannot be a single number.

## 3 · Does correcting both legs repair the anatomical sign?

**This is the actual goal and nothing has attempted it.** 7 of 10 nights are anatomically impossible —
the ankle, the longer path, reporting arrival *before* the finger. Apply the measured offset to both
legs and re-run the pairing. Success is the SIGN becoming positive on nights where it was negative, not
a better-looking number. If the sign does not repair, the per-connection offset was not the blocker and
`PAT-PACKET-ARRIVAL` §1 needs revisiting.

## 4 · What the mutation gate exposed, which is not about PAT at all

Recorded here because it was found executing this brief and would otherwise be lost:

- **`tools/mutate_diff.py` fails open.** With mutmut absent it prints *"every mutant on the changed
  functions was killed"* and `survivors: []` — zero mutants generated, reported green. It should refuse.
- **`mutation (diff-scoped)` is not a required check**, so #1170 merged red and the gaps stayed open on
  `main` until #1174. Either make it required or accept that it is advisory and check it by hand.
- **100 % statement AND branch coverage coexisted with 94 surviving mutants** on `clock_offset.py`.
  Worth remembering the next time a coverage number is offered as evidence of anything.

## 5 · Deliberately NOT proposed

- **Consuming the offset in an export.** Nothing reads `nightqc`'s `offset` yet, and it should stay that
  way until §3 shows the correction repairs the sign. A correction that has not been shown to fix the
  anatomy has no business in a `ganglior.node-export`.
- **Tuning `AGREE_MAX_MS`.** It is PAT's requirement, not a fitted parameter. If real nights certify at
  a rate far from 77 %, that is information about the capture, and the threshold moves only with an
  argument about the requirement.

## Done when

- [x] a real `*_PMDARRIVAL.csv` exists, its rows are non-degenerate, and `estimate` has been run on it
- [x] the ring leg's `OXYLIVE_DURATION_S` pairing tested — it does NOT produce a usable fit (3851 ppm)
- [ ] within-connection constancy tested by halves, and the result recorded either way
- [ ] the anatomical sign re-checked after correcting both legs
- [x] `mutate_diff.py` refuses instead of greening when mutmut is missing — **DONE 2026-08-15.**
      Two guards, because one is not enough. A **preflight** (`refusal_reason`, pure and pinned by
      `--selftest`) refuses with **exit 2** when the venv or mutmut is absent; a **post-loop** guard
      refuses when every mutmut invocation errored, which the import check cannot see. Exit 2 is
      distinct from 1 (survivors) and is **not** suppressed by `--report-only`: that flag's contract
      is about FINDINGS, and "the tool could not look" is not a finding.

      **Verified both directions on a real changed function** (`alerts.validate_webhook_url`), not
      just asserted: with the venv absent the old code printed *"every mutant on the changed
      functions was killed"* at **exit 0**, and the new code refuses at **exit 2**; with mutmut
      importable it proceeds and mutates, emitting no refusal — so the guard did not trade a false
      green for a false red.

      ⚠️ **The obvious probe is wrong, and it nearly shipped.** `-m mutmut --help` exits **1** on
      this repo's own venv while mutmut 3.7.0 is installed and imports fine (a broken
      `safe_setproctitle` import; the console script fails too, on a missing `source_paths`). A
      `--help` probe would refuse on a working machine. The probe is `python -c "import mutmut"`,
      and the reason is recorded at the function.

      Note `tools/` is outside the `--cov-fail-under=100` scope (nothing under it is imported by the
      pytest suite), so the guard is pinned by the tool's own `--selftest` rather than a new test
      file — a test importing this module would be the first, and would drag 366 uncovered lines
      into the coverage floor and red CI for an unrelated reason.

Related: [`PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md`](PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md) ·
[`PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md`](PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md) ·
[`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md)
