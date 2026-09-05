<!--
  VIGIL-MAINTAINER-QUICKSTART.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — first 10 minutes on the capture box) · **last-verified:** 2026-09-05

# Vigil maintainer quickstart — your first 10 minutes on the box

You have ssh'd into `vigil` (user `vigil`). This page is the box in the order you'll need it.
Everything here was verified on the box 2026-09-05; where a fact lives in a gated doc, this page
points instead of copying. **The prime directive:** `/opt/tepna` is the *deployed production
checkout* — the `tepna-capture` daemon runs FROM it. A `git pull` there is a deploy; an edit there
is a live-code edit. Never develop in it.

## Minute 1 — is capture healthy RIGHT NOW?

```sh
/opt/tepna/capture-host/.venv/bin/python /opt/tepna/capture-host/capture_status.py
```

One honest read of the daemon's own `/api/state` — a device is STREAMING only with a live rate, and
`connected` alone is not capture (the file's docstring explains why hand-rolled `ls`/`grep` lie).
The browser view is webmon on `127.0.0.1:8760` (`ssh -L 8760:127.0.0.1:8760 vigil@…` from your
machine). Raw JSON: `curl -s http://127.0.0.1:8760/api/state`. Daemon liveness:
`systemctl status tepna-capture` (read-only look; **never** restart it yourself — owner-authorized
only, and the watchdog + `tepna-update` already handle the sanctioned cases).

## Minute 2 — how was last night?

```sh
ls /srv/tepna/captures/                      # one strict YYYY-MM-DD dir per night
cat /srv/tepna/captures/<night>/QC-SUMMARY.json   # per-device × per-stream verdicts (nightqc)
```

`missing` on a stream = a header-only file (rejected PMD START / never-worn strap). `status.json` in
`/srv/tepna/captures/` is the live snapshot the daemon rewrites every 10 s; `watchdog.log` is the
wedge history.

## Minute 3 — logs: count, never tail

```sh
journalctl -u tepna-capture --since -24h | grep -o -i -E "org\.bluez\.Error\.[A-Za-z]+|timeout|wedged|reconnect" | sort | uniq -c
```

A tail of a busy log reads as whatever the last screen happened to hold (CLAUDE.md §4b). Baseline
for calibration, measured 2026-09-05: ~1000 Timeout / ~750 reconnect / ~750 wedged per 24 h was
*normal* under the single-adapter layout — alarm on the derivative, not the absolute.

## Minute 4 — the radios (three, not one — and one trap)

| hci | stick | role (see config.yaml) |
|---|---|---|
| hci0 | TP-Link UB500 (Realtek) | idle / failover; best hearing |
| hci1 | CSR dongle ("Sena") | `adapter:` — **carries all wearables** |
| hci2 | Intel AX210 | `cpap.ble_stream.adapter` — CPAP only |

⚠️ **`bluetoothctl` defaults to hci0, which is NOT the capture adapter.** An unselected `info`/
`devices` answers about the wrong radio. Always `select <adapter MAC>` first. Full roster, error
census and air-side findings: `briefs/VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md` and
`briefs/VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md`. The nRF BLE sniffer lives on
`/dev/ttyACM0` (extcap in `~/.config/wireshark/extcap/`); analyse captures with
`python3 capture-host/ble_sniff.py <pcap>` — and note **tshark on this box can only read pcaps
under `/tmp`** (AppArmor profile; copy the file there first, or a permission error masquerades as
an empty capture).

## Minute 5 — what you may do with root

```sh
sudo -n -l
```

The NOPASSWD roster is `/usr/local/lib/tepna/tepna-{clock,rssi,btreset,wifi,restart,usbreset}.sh` —
bounded, single-purpose helpers (adapter USB re-bind, clock ops, RSSI read, guarded daemon restart).
Everything else escalates to the owner — including anything that stops the daemon, pairs/unpairs a
sensor, or touches Tailscale.

## Minute 6 — deploys (they happen without you)

`tepna-update.timer` (enabled, boot + periodic, `Persistent=true`) runs the **repo-tracked**
`capture-host/tepna-update.sh`: fetch → ff-only merge → restart the daemon *only when the box is
idle* (the recording interlock blocks on `recording`/`unknown`). `/srv/tepna/.tepna-deployed-sha`
records what the running daemon was started from. So: the tree updates itself, the daemon restarts
itself at safe moments, and a "restart is owed" state is normal and self-resolving. Manual controls:
`vigil.sh status|url`, and the monitor's Deploy button (which deliberately defaults to
`--no-restart`).

## Minute 7 — if you need to change code

```sh
git -C /opt/tepna worktree add ~/wt-<task> -b claude/<task>-<3ch> origin/main
cd ~/wt-<task>/capture-host && python3 -m venv .venv \
  && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt   # BOTH files, or pytest/ruff are missing
./check.sh        # THE gate: ruff · shellcheck · pytest --cov 100% · unwired
```

Stage by explicit path, commit with `Fleet-Session:` trailer, and know the box's limits:
**no `node`** (JS gates are CI-only from here), **no `gh` and no push credentials** (commit locally,
then a rig-x870 session fetches the branch from this box over ssh and opens the PR — or ask the
owner for push auth), **`shellcheck` not installed** (that lane of `check.sh` reads exit 127 —
missing tool, not a failure; CI is the verdict). `tools/doc-search.mjs` is absent **by design**
(the bge index lives on the primary dev machine); use `git grep` + `DOCS-INDEX.md`, or relay a
semantic query to a rig-x870 session.

## Minute 8 — the standing rules that are never yours to relax

Owner-set, non-negotiable: deploys/daemon restarts are **owner-authorized only** · never send
`0xE3`/`0xEE` resets to the O2Ring · BLE identity is **address-only**, never local name · never
touch the Tailscale auth flow · Wi-Fi (`wlp1s0`) stays down — it shares the AX210 front-end with
the CPAP's radio · and CLAUDE.md §👥 governs every git action in the shared checkout.

## Minute 9 — where things live

`/opt/tepna` production checkout · `/srv/tepna/captures/<night>/` the data ·
`/srv/tepna/captures/sniffer/` air captures · `/srv/tepna/captures/status.json` live state ·
`config.yaml` (**the live one** — the `config.yaml.bak-*` pile beside it is history, not
candidates) · `/usr/local/lib/tepna/` installed root helpers · `/etc/systemd/system/tepna-*`
units/timers · `~/.local/bin` (`claude`, `tepna-sync-main.sh`) · `~/.config/systemd/user/
claude-wren.service` (respawns the resident Claude session in tmux `wren` at boot).

## Minute 10 — who else is here

You are probably not alone: agent sessions work this repo concurrently (CLAUDE.md §👥 — read it
before your first git command), a resident session ("Wren") may be attached in `tmux attach -t
wren`, and the fleet coordinator runs on rig-x870. When in doubt about a half-finished file you
didn't create: leave it, ask.
