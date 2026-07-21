<!--
  VIGIL-AUDIT-FIXES-2026-07-21-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-21 · **Created:** 2026-07-21

_Executes the findings of a 3-pass audit of `capture-host/` (errors, inconsistencies, friction spots).
Sibling of `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` — that one recorded what a running box did; this
one is a static+dynamic read of the code that supervises it._

# Vigil audit fixes — the night-boundary bug, false confidence, and one runner per link

**Out-of-suite (`capture-host/`, Python).** Test-first throughout: **100% pytest coverage** on the whole
capture-host tree (3293 stmts, 890 tests), `ruff --select E9,F` clean. One PR, findings ranked by impact.

## The two that could lose or misreport a night (HIGH)

**#1 — The night boundary was keyed on the wall clock, not the recording.** `writers.night_dir()` rolls a
night folder by the session's **start** date, so a capture that begins at 22:00 keeps appending to its
start-date folder well past midnight. But `qc_poller`, `archive_poller` and the retention guard all keyed
on `_now()`'s date — so the instant the clock ticked to 00:00 they treated the *live* night as yesterday:
QC began summarising an empty new-date folder, and (with `archive.enabled`, which the live box runs) the
archiver could mirror the in-progress night and drop its `.archived` marker **mid-recording**, truncating
it. Fix: a shared **`diskguard.active_nights(captures, settle_sec)`** — the nights with a write inside a
settle window (`_NIGHT_SETTLE_S`, config `storage.settle_sec`, default 20 min) — is now the anchor. QC
summarises the current *active* night; archive mirrors only *settled* nights and protects every active one
(a cross-midnight reconnect can leave two); retention protects all active nights. The `LINK.csv`/`CLOCK.csv`
sidecars — which opened one writer at boot and appended to that first folder **forever** (one unbounded
file, and every later night's link data in the wrong directory) — now roll per calendar day.

**#2 — "Complete" was a lie for a stream that merely trickled.** `nightqc` flagged only a **zero-row**
stream as missing, so a stream delivering 40% of its rate (the Verity IMU; a stream that died at hour one)
read green. `summarize()` now estimates each stream's **coverage** — delivered rows vs its
(configured-or-nominal) rate × the night span (from file mtimes) — flags a stream below 50% as `degraded`,
and `ok` now requires *no gap AND no trickle*. The monitor QC card and device sublines reflect it, and the
web surface now shows **`link_epoch`** (the E5 reconnect count a green "connected" dot hides) in place of
the dead `frames_dropped`/`frames_duplicated` fields.

## Runner-lifecycle correctness (MED)

**#3 — `run_polar` reset its reconnect backoff on a bare connect** (line 617), so an H10 that connected
then dropped before any data re-armed the floor every attempt and never backed off — the exact E3 bug
already fixed in `run_viatom`/`run_oxyii`. Reset moved to first-viable-data in the hold loop.

**#4 — Two runners could fight one BLE link.** `_spawn` unconditionally created a supervise task, so a hot
**re-Remember** of a running address spawned a *second* runner; **Forget** dropped the device from config
but never cancelled its runner, leaving an orphan that reconnected the dropped device every backoff. The
registry bookkeeping is now testable module-level `register_runner`/`unregister_runner`: register
cancels+replaces an incumbent on the same address, Forget cancels the runner and clears its stale status
card (new `forget_device` callback wired through `webmon`).

**#14 — `run_viatom`'s hold loop ignored `_OXYII_PAUSE`**, so an already-streaming ring held the link an
offline `.dat` pull needed (the outer idle-gate only catches it *between* sessions). It now releases like
`run_oxyii` does.

## Guardrails, config, and honesty (MED / friction)

- **#8 — Archive could fill the boot disk.** `archive_night` did `os.makedirs(dst)` with no mount check —
  a dest whose removable/NAS volume was unmounted left the mountpoint dir present-but-empty, so the tree
  got created on the *boot* filesystem and ~2 GB/night mirrored into it. `archive_poller` now requires the
  dest to already exist (the operator creates it once on the backup volume) and **skips + warns** otherwise,
  surfacing `archive.dest_present`.
- **#9/#10 — Boot facts are now on the monitor, not only in the log.** A `STATUS["host"]` block publishes
  `started_at` (a boot time that moved after dark = a spurious mid-night restart) and
  `adapter_resolved`/`adapter_ok` (a mis-pin is visible the moment it happens, not only when every connect
  quietly hangs). Surfaced as a Box card.
- **#12 — `stream.stall_sec` is now config-wired** (`_STREAM_STALL_S` was a hard constant despite the "0 =
  off" comment). **#13 — `time.provenance_poll_sec`** is now documented. **#16 — `config.example.yaml`**
  gains the previously-undocumented `time`/`stream`/`power`/`o2ring` blocks and `storage.settle_sec`.
- **#15 — `settings_schema.describe()`** lost its unused `defaults` param. **#7 — the stale "needs ATT MTU
  ≥ 517" comments** (`pull_session.py`, `capture.py`) were corrected — `oxyii.py` disproved that 2026-07-18
  (the real negotiated MTU is 247). **#11 — the README** makes the `/opt/tepna` layout explicit so it
  matches the unit's `WorkingDirectory=/opt/tepna/capture-host`.

## Deliberately NOT changed (recorded so it is not re-litigated)

- **#5 — per-stream stall teardown: declined.** The hold loop's stall watchdog is aggregate (any stream
  advancing resets the clock). Tearing the whole link down because one PMD stream died while another flows
  would trade a working ECG for a re-negotiation gamble on the H10's single shared link. The honest signal
  is **visibility**, not teardown — that is exactly what #2's per-stream `coverage`/`degraded` now provides.
- **#6 — the dead `frames_dropped`/`frames_duplicated` LINK.csv columns: left in place.** They are always
  blank, but the class docstring keeps a strict positional contract and `link_epoch` (E5) was appended
  *last* precisely so a positional reader of the first seven columns is unaffected. Removing the middle
  columns would shift `link_epoch` and risk exactly the silent corruption the contract guards against. The
  dead fields were dropped only from the `webmon` surface (replaced by `link_epoch`).
- **P7 alerts remain off by default** (design tradeoff — no webhook baked in); **B023 loop-closure
  warnings** in the runners are benign (gated by a clean disconnect) and CI only runs `E9,F`.
