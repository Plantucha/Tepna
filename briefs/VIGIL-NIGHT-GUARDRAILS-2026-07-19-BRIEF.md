<!--
  VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-19 · **Created:** 2026-07-19

# Vigil night guardrails — the box protects a night without you watching

**Out-of-suite (`capture-host/`, Python).** Three operational guardrails so the bedside box stops
*silently* losing a night. A lost night on a bedside capture box is **unrecoverable**, and every failure
mode below was previously invisible until morning. All landed test-first — the capture-host pytest suite
stays at **100% coverage** (2796 statements, 774 tests).

## Why

The capture-host code was clean but had three operational blind spots, each able to waste a night with no
signal:

1. **Full disk.** The box writes ~1.2 GB/night, unattended, forever. Nothing watched free space, so a full
   filesystem turned every subsequent night into a silent loss — `StreamWriter`'s fsync just started
   failing while capture kept "running".
2. **Silent sensor / silent box.** The monitor page is a *pull* surface — you only see a dead H10 battery
   or a rebooted daemon if you go look. By morning the night is gone.
3. **Hung-but-alive daemon.** This box's signature failure (the `_OFFLINE_OP_TIMEOUT` / adapter-wedge
   saga) leaves the process running while it captures nothing. `Restart=always` never fires because
   nothing crashes.

## What landed

### 1 · Storage guard — `diskguard.py` + `capture.storage_poller`
- `disk_report(root, min_free_gb)` — free/total/pct + a `low` flag; walks up to the nearest existing
  parent so a not-yet-created root still reports its filesystem. Surfaced as `status.json` → `storage`.
- `plan_prune()` / `prune_old_nights()` — **age-based, OPT-IN** retention (`keep_nights: 0` = never
  delete). Matches only the strict `YYYY-MM-DD` night-dir shape, so `incoming/` and `stored/` are never
  touched, and **tonight's directory is always protected**. A delete that fails is skipped, never fatal.
- **Deliberately conservative:** low free space is an *alert*, never an excuse to eat recent recordings to
  chase bytes — that would trade a disk warning for an unrecoverable data loss.

### 2 · Push alerts — `alerts.py` + `capture.alert_poller`
- Generic webhook POST (`ntfy.sh` / Discord / Slack / Telegram bridge / Home Assistant — no vendor baked
  in). **Disabled by default**; only ever fires to a URL the operator put in `config.yaml`.
- `alert_poller` is **edge-triggered**: a configured sensor offline past `offline_sec` alerts *once* (a
  flapping link cannot spam), and a recovery note fires when it returns.
- Also fires on daemon (re)start (a spurious overnight restart is otherwise invisible) and on low disk.
- Alerting must NEVER take capture down — every webhook failure is swallowed; worst case is a missed
  notification, never a missed night.

### 3 · systemd watchdog — `sdnotify.py` + `capture.sd_watchdog`
- Pure-stdlib `sd_notify()` (READY=1 / WATCHDOG=1 / STOPPING=1), no-op off systemd. Handles the abstract
  namespace and swallows a bad socket.
- `sd_watchdog()` heartbeats `WATCHDOG=1` at **half** the configured `WatchdogSec` from a live-event-loop
  task, so a hung-but-alive daemon is detected and restarted by systemd — the ping proves the async loop
  is still turning, which is exactly the liveness that matters here.
- `systemd/tepna-capture.service` → `Type=notify` + `WatchdogSec=120`. `main()` sends `READY=1` once
  capture is up (so `systemctl start` unblocks on real readiness) and `STOPPING=1` on shutdown.

## Config (all optional, see `config.example.yaml`)
```yaml
storage: { keep_nights: 0, min_free_gb: 2, poll_sec: 300 }   # keep_nights 0 = never prune
alerts:  { enabled: false, webhook_url: "", offline_sec: 300, poll_sec: 60 }
```
These are **deploy config, not monitor-tunable** — kept OUT of `settings_schema.SETTINGS` on purpose, the
same reasoning that excludes `root`/`adapter` (a bad webhook or retention count set from a bedside web UI
should not be possible; edit the file).

## Done when — all met
- [x] Storage guard: disk report in `status.json`, opt-in retention prune, tonight protected, low-disk
      alert. Verified against a real filesystem.
- [x] Alerts: edge-triggered offline/recovery/start/low-disk webhook. Verified with a real aiohttp
      round-trip (2xx→True, 5xx→False) + dedupe.
- [x] systemd watchdog: `Type=notify`, READY/WATCHDOG/STOPPING. Verified against a real `AF_UNIX`
      `NOTIFY_SOCKET` (incl. abstract namespace).
- [x] `capture-host` pytest **100% coverage** (2796 stmts, 774 tests); `ruff --select E9,F` clean.
- [x] End-to-end smoke: real systemd datagram + real webhook POST + real `disk_report` all confirmed.

## Not in scope (candidate follow-ups)
- **Per-night QC summary** (rows/stream · coverage % · gaps · clock-provenance verdict) — the natural
  next signal source for the alert path; would let "did last night work?" be a glance.
- **Automated offload** of finished nights to the analysis side (kills the manual IndexedDB-into-Chrome
  staging).
- **Monitor UI** for the new `status.json.storage` block, and **web-control auth**.
- The two open decode defects (MAG `[G]` unit header · Verity delta-frame garbage rows) tracked in
  `PMD-DECODE-SCALE-AND-RATE-2026-07-19-BRIEF.md`.
