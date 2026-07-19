<!--
  VIGIL-NIGHT-GUARDRAILS-FOLLOWUPS-2026-07-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-19 · **Created:** 2026-07-19

_Follow-up of `VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF.md`._

# Vigil night guardrails — follow-ups: QC summary, bad-night alert, web-control auth, night offload

**Out-of-suite (`capture-host/`, Python).** Executes four follow-ups the parent
`VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF` left open: the **per-night QC summary**, wiring that QC verdict
into the **alert path**, an optional **shared-secret on the web control surface**, and **automated night
offload**. Landed test-first — capture-host pytest stays at **100% coverage** (2942 statements, 800 tests).

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

### 2 · Alert on a bad night — `qc_poller` + the guardrails `Notifier`
- `qc_poller` now takes the webhook notifier and fires **once per night** when a declared stream is still
  missing after `qc.alert_after_sec` (default 1 h). The **grace is essential** — a just-started night is
  legitimately empty and would false-alarm every poll — so only a night watched that long can have a
  *real* hole. Completes the "QC verdict → alert" loop the parent brief scoped.

### 3 · Web-control auth — `webmon` middleware
- Optional shared secret (`web.token`). When set, every **POST** control action
  (bond/forget/remember/pull/settings/clock) requires the token; **GET reads stay open** so the monitor
  still displays. Accepts `Authorization: Bearer <t>` or `X-Tepna-Token: <t>`, compared in **constant
  time** (`hmac.compare_digest`). Default OFF (no token → current wide-open behaviour, fine on a trusted
  home LAN).

### 4 · Automated night offload — `nightarchive.py` + `archive_poller`
- Mirrors each **completed** night (never tonight — it is still being written) to a configured `dest` (a
  NAS mount, the `tepna-web` served dir, a backup disk), so finished nights land where they get analysed —
  killing the manual copy. **Idempotent + resumable**: a per-night `.archived` marker copies a night once,
  and a partial copy re-runs only the files that differ (size check). **MIRROR, never move** — the source
  stays for the storage guard to prune on its own schedule; offload and retention are separate concerns.
  No-op unless `archive.enabled` + `archive.dest` are set.

## Done when — all met
- [x] `summarize` counts rows per configured stream, flags header-only/absent streams as `missing`, sets
      `ok`, reports totals + sidecars. Verified against the **real** `StreamWriter`/`Spo2CsvWriter` output.
- [x] `qc_poller` writes `QC-SUMMARY.json` + `status.json.qc`, creates no empty night dir, swallows errors,
      and alerts once per night past the grace.
- [x] `webmon` auth: POST needs the token when set, GET open, constant-time compare, off by default.
- [x] `nightarchive` offload: mirrors completed nights only, idempotent + resumable, never moves the source.
- [x] capture-host pytest **100% coverage** (2942 stmts, 800 tests); `ruff --select E9,F` clean.

## Not in scope (remaining)
- **Monitor UI** for `status.json.qc` / `storage` (frontend `monitor.html`, not pytest-covered) — better
  done when it can be eyeballed live.
