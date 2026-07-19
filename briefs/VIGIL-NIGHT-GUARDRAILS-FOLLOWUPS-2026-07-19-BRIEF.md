<!--
  VIGIL-NIGHT-GUARDRAILS-FOLLOWUPS-2026-07-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-19 · **Created:** 2026-07-19

_Follow-up of `VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF.md`._

# Vigil night guardrails — follow-ups: per-night QC summary

**Out-of-suite (`capture-host/`, Python).** Executes the top follow-up
`VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF` left open: the **per-night QC summary**, the natural companion
to the alerting that shipped there. Turns "did last night actually capture?" from opening files by hand
into a glance. Landed test-first — capture-host pytest stays at **100% coverage** (2871 statements, 783
tests).

## Why

The night guardrails answered "is the box alive and does it have disk?" but not "did tonight's recording
come out **complete**?" A device can be connected and still leave a **header-only file** — a rejected PMD
START, a never-worn strap, a stream the firmware dropped. Those are indistinguishable from a real capture
until you open them, and the alert path had no signal for them.

## What landed — `nightqc.py` + `capture.qc_poller`

- **`nightqc.summarize(night_dir, devices)`** walks a night directory and rolls it up against the
  configured devices: per device × declared stream, how many **rows** landed (newlines − 1, since every
  `writers` file has exactly one header); a declared stream with **zero rows is `missing`**; `ok` is true
  only when every declared stream produced data. Also reports file/row/byte totals and which sidecars
  (LINK/CLOCK/OXYFRAME) are present.
- **Pure + cheap:** it reads filenames (`writers.capture_filename` layout —
  `<vendor>_<model>_<deviceid>_<stamp>_<STREAM>.<ext>`) and counts newlines in 1 MiB binary chunks, so a
  multi-GB ECG file is counted without loading it into memory. No vendor-format parsing.
- **`qc_poller`** summarises the CURRENT night into `status.json` (`qc`) and writes
  `<night>/QC-SUMMARY.json`. **Read-only over the tree** — it never creates a night dir, so an idle box
  makes no empty folders — and QC is observability, so any error is swallowed (never takes capture down).
- Config: `qc: { poll_sec: 600 }` (deploy-only, out of `settings_schema` like the other guardrails).

## Done when — all met
- [x] `summarize` counts rows per configured stream, flags header-only/absent streams as `missing`, sets
      `ok`, reports totals + sidecars. Verified against the **real** `StreamWriter`/`Spo2CsvWriter` output
      (exact row counts).
- [x] `qc_poller` writes `QC-SUMMARY.json` + `status.json.qc`, creates no empty night dir, swallows errors.
- [x] capture-host pytest **100% coverage** (2871 stmts, 783 tests); `ruff --select E9,F` clean.

## Not in scope (remaining, from the parent brief)
- **Alert on a bad night.** The QC verdict is now the signal, but firing it needs a "night is far enough
  in that a missing stream is real" guard (a just-started night is legitimately empty) — deferred to avoid
  false alarms.
- **Monitor UI** for `status.json.qc` (and the `storage` block from the parent).
- **Automated offload** of finished nights to the analysis side.
- **Web-control auth** on the monitor.
