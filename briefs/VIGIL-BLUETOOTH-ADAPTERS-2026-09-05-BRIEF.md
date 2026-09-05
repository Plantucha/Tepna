<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-09-05

# Vigil Bluetooth adapters + maintainer-on-the-box — measured inventory (Wren, on the box)

Owner-assigned (relayed by Kestrel 2026-09-05): sync the repo, inventory the Bluetooth adapters, and
inventory "everything that makes it easier for a maintainer to be ON the capture box". Mid-task the
owner added: **use the nRF Sniffer (1915:522a) to discover errors, inefficiencies and hallucinations**
— §4 is that census. Everything here was measured on `vigil` 2026-09-05 ~13:00–13:30 UTC unless a
window says otherwise; nothing on the running stack was changed. Repo sync (Task 1) was a **no-op**:
`/opt/tepna` clean, 0 behind `origin/main` (HEAD `4467cdb5`).

---

## 1 · Adapter inventory (three radios, all UP — not one)

`hciconfig -a` + `lsusb` + kernel log since boot (03:57:54):

| hci | USB id | chipset | BD address | BT ver | firmware | traffic since boot (RX bytes / ACL) |
|---|---|---|---|---|---|---|
| **hci0** | 2357:0604 TP-Link **UB500** | Realtek RTL8761BU | `AC:A7:F1:29:9D:1D` | 5.1 | `rtl8761bu_fw.bin`, rom v1 | 285 KB / 168 |
| **hci1** | 0a12:0001 CSR dongle (**"Sena"**) | Cambridge Silicon Radio | `00:01:95:CC:53:02` | 4.0 | dongle HCI rev 0x2031 | **117.5 MB / 1.49 M** ← the working radio |
| **hci2** | 8087:0032 Intel **AX210** | Intel | `28:0C:50:0C:18:FD` | 5.4 | `ibt-0041-0041.sfi`, v202-5.26 | 1.66 MB / 27 K |

Also on the USB bus: **1915:522a Nordic nRF Sniffer for BLE** (`/dev/ttyACM0`, cdc_acm — the §4
instrument) and **1915:f33c "O2Ring S"** — the ring itself was docked on USB (usbhid) at measure time.
`bluetoothctl` default controller is **hci0** (UB500), *not* the capture adapter — a
`bluetoothctl`-without-`select` session talks to the wrong radio by default; know this before trusting
its output. BlueZ **5.85**; `btmon` present (5.85); `rfkill` **not installed**. Kernel `btusb`
`enable_autosuspend=Y`, but every BT USB device has `power/control=on` (autosuspend defeated
per-device — `tepna-usb-autosuspend.service` exists and is the reason). No internal adapter beyond
these; no firmware reloads/resets in the kernel log since boot; the only kernel BT noise since boot:
**4× `ACL packet for unknown connection handle`, all on hci1**.

## 2 · What binds what (config + code, verified — do NOT re-derive)

- `config.yaml` `adapter: 00:01:95:CC:53:02` → the **Sena carries all wearables** (O2Ring `D1:98:62:7C:92:B3`,
  H10 `24:AC:AC:02:84:96`, Verity `24:AC:AC:0C:30:1E`); live ACL links at measure time: `hci1:70`, `hci1:76`.
- `config.yaml` `cpap.ble_stream.adapter: 28:0C:50:0C:18:FD` → the **CPAP is pinned to the Intel AX210**
  (air-confirmed in §4: the one true CPAP CONNECT_IND initiator is `28:0C:50:0C:18:FD`).
  ⚠️ `adapter_pool.py:32`'s docstring says "on this box hci0 carries the CPAP's own link" — **stale**;
  hci0 is the UB500 and the CPAP is on the AX210. One-line doc fix, folded into P5.
- **`adapter_pool.py` (#1976) is imported by nothing but its own test** (measured:
  `grep -rn "import adapter_pool"` → `tests/test_adapter_pool.py` only). Whether it is superseded by
  `PER-DEVICE-ADAPTER-PINNING` §3.3b's one-systemd-instance-per-adapter design (owner decision
  2026-08-26) or still the intended failover core needs a coordinator read — **flagged, not proposed**.
- Prior art that already covers "which radio should carry what" — read before proposing anything here:
  `PER-DEVICE-ADAPTER-PINNING-2026-08-26-BRIEF.md` (core BUILT; remainder is systemd deployment,
  owner-territory) · `RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF.md` (signal live in prod; arming
  is owner-only) · `SENA-VS-UB500-JITTER-2026-08-26` + `ADAPTER-VERDICT-IS-PER-LINK-2026-08-26`
  (REFERENCE). The UB500-hears-6×-the-Intel scan table lives in the pinning brief §1 — not repeated here.

## 3 · Link-layer error census (daemon log; counts, not tails — windows stated)

`journalctl -u tepna-capture`, grep-o over class tokens:

| window | total lines | Timeout | reconnect | wedged | InProgress | Failed | NotReady |
|---|---|---|---|---|---|---|---|
| −24 h (2026-09-04 13:10 → 09-05 13:10 UTC) | 17,387 | 1,059 | 758 | 755 | 94 | 2 | 1 |
| since boot (03:57 → 13:10 UTC) | — | 617 | — | 417 | 51 | — | — |

Wedge attribution (−24 h, MAC tokens on `wedged` lines): **H10 544 · Verity 204** — the H10 is the
dominant wedge source, not the ring. At measure time the **Verity was disconnected and advertising at
~7.4 adv/s** (§4) while the daemon held O2Ring + H10; whether that is intended daytime behaviour or a
stuck reconnect loop is answerable from the log by whoever owns the next capture-lane unit.

## 4 · nRF-sniffer air census (owner-directed) — errors, inefficiencies, hallucinations

Instrument: nRF Sniffer via the installed Wireshark extcap (`~/.config/wireshark/extcap/`), one fresh
**360 s all-advertising capture** (`/srv/tepna/captures/sniffer/allscan-20260905-1313.pcap`, 20,824
pkts) plus re-analysis of the six 2026-09-04 `resmed-*` pcaps with `ble_sniff.py` **and** tshark
cross-checks. Findings, each verified:

- **F1 — `ble_sniff.py` counts CRC-garbage as truth (tool defect, the repo's own dominant class).**
  It never reads the nordic_ble CRC-ok flag. Measured: 10 % of the fresh capture and 14 % of the
  overnight capture (151,923/1,078,085) are CRC-bad. Its overnight report lists **262 CONNECT_IND
  pairs; tshark with `nordic_ble.crcok==1` finds 12** — 95 % of the list is bit-flip noise (e.g.
  initiator `24:2C:AC:0C:30:1E` = Verity's MAC one bit off). Same class as the two 2026-09-04 defects
  its own header documents. → P1.
- **F2 — the "overnight" capture silently died 2 h in.** `resmed-overnight-20260904-2032.pcap` spans
  **7168 s** of packets (20:32→22:32) but the file stayed open until the 03:57 reboot; mtime reads
  "the night", content is 27 % of it. `ble_sniff.py` reports no duration, so nothing surfaced it. → P1.
- **F3 — true overnight connect census (crc-ok, first 2 h):** Sena→Verity **6×** (three within 8 s at
  t≈2308–2315 = immediate drops), Sena→O2Ring 1×, AX210→ResMed 1×, plus 4 to a neighbour device.
  Air-truth for the §3 churn. H10: **0 connects** while advertising ~5/s throughout (H10 advertises
  while connected — fw supports a second link — so adv-rate alone does not prove disconnection).
- **F4 — SCAN_REQ storm: ~60 % of all captured air packets** (651k/1.078M overnight; 12,248/20,824
  fresh) are SCAN_REQs from rotating random addresses, targeted mostly at *neighbours'* devices —
  continuous active scanning (ours is active by necessity: BlueZ passive needs `--experimental` +
  or_patterns, per `probe_ring_adv.py`'s header). Inefficiency to weigh, not a defect claim: airtime +
  neighbour battery, and it competes with our own connects (`SENA-VS-UB500-JITTER` context).
- **F5 — hallucination check, O2RING-PROTOCOL §6:** the ring advertised **569 crc-ok advs in 360 s
  (~1.6/s) while docked on the charger, unworn, and BLE-connected** — "advertises only while worn" is
  falsified; and 519 of those advs carry **manufacturer id `0xF34E` payload `00`**, the id §6
  attributes to "sync after the button". Both §6 hypotheses now have measured bytes against them.
  Input for the `probe_ring_adv.py` runbook (harvest brief, #2231) — recorded here, labelled state
  `charger`, so the state machine isn't built on the quoted mask.
- **F6 — duplicate mislabeled capture:** `resmed-adv-namefilter-1826.pcap` ≡ `resmed-gatt-1756.pcap`
  (identical md5 `5f9931…`). One of the two labels describes a capture that does not exist. → P3.
- **F7 — tshark on this box can only read pcaps under `/tmp`.** `/etc/apparmor.d/tshark` (Ubuntu
  profile) grants the parent process user-tmp only; `tshark -r` on `/srv/…` or `$HOME` fails with a
  permission error that reads like a bad file. This is the exact 2026-09-04 trap `ble_sniff.py`'s
  header records ("printed nothing … it was a PERMISSION error"). Workaround: copy to `/tmp`. → P2.
- **F8 — kernel-side is clean.** No btusb resets, no firmware reloads since boot; 4 unknown-handle
  events on hci1 in 9 h. The pain is link-layer (§3), not USB/driver-layer.

## 5 · Maintainer on the box — what exists, what's missing (Task 3)

**Exists (verified on the box; use these, don't rebuild):**
- **Status**: `capture_status.py` (one honest read of `/api/state`; STREAMING ≠ connected) · webmon
  live-view `127.0.0.1:8760` (`web:` in config) · `/srv/tepna/captures/status.json`, `watchdog.log`,
  per-night `QC-SUMMARY.json` (`nightqc.py`) · `vigil.sh start/stop/status/url`.
- **Ops scripts** `capture-host/*.sh`: `check.sh` (THE gate) · `unwedge.sh` (O2Ring wedge; restores
  recording via trap) · `tepna-{btreset,clock,rssi,usbreset,wifi,restart}.sh` — installed to
  `/usr/local/lib/tepna/` with **NOPASSWD sudo** for exactly those (`sudo -n -l` verified; owner:
  "we can add more access if needed").
- **Auto-deploy exists**: `tepna-update.timer` (enabled, `OnBootSec=10min`, `Persistent=true`) →
  `tepna-update.sh` — pull alone was never the missing step; this finishes the deploy. `~/.local/bin/
  tepna-sync-main.sh` syncs a checkout safely. `/srv/tepna/.tepna-deployed-sha` records what runs.
- **Non-login PATH already contains `~/.local/bin`** (measured via `bash -c`) — the failed-launch
  ergonomic Kestrel relayed appears fixed; re-verify over ssh-exec before closing it.
- `doc-search.mjs` is **absent by design** on this box (index lives on rig-x870 only) — fallback is
  `git grep` + `DOCS-INDEX.md`, or relay a query to Kestrel. Not a defect.

**Missing / friction (proposals below):** `node` is not installed — no JS gate (not even
`docs-ledger`) can run on the box, so a docs PR from vigil rides entirely on CI. `gh` is not
installed — a session on the box can push a branch but cannot open the PR or check the queue (against the owner's "vigil must be self-sustaining",
2026-09-01) → P4. `rfkill` absent (minor; `hciconfig`/sysfs cover it). **17 `config.yaml.bak*` /
`config.yaml.pre-*` variants** sit beside the live config in the deployed tree (gitignored, so
invisible to `git status`) — a maintainer editing "the config" has 18 candidates → P6. Disk is
healthy: 51 G used / 172 G free (23 %), one volume for `/`+`/srv`+`/opt`.

## 6 · Proposals (only what §2's prior-art sweep left genuinely uncovered)

- **P1 — `ble_sniff.py`: read the nordic_ble CRC flag + report capture duration.** Filter (or
  separately count) crc-bad packets in every counter, and print first→last packet span. Would have
  caught F1 and F2 at first read. capture-host lane, test-first, `check.sh` gates it. ~1 unit.
- **P2 — `/etc/apparmor.d/local/tshark`: grant read of `/srv/tepna/captures/sniffer/**`.** Box-ops,
  root, **owner-authorized only**; until then the runbook line is "copy the pcap under /tmp first"
  (this brief is that line's home). ~10 min with owner present.
- **P3 — resolve the F6 duplicate**: whoever took the 2026-09-04 captures (Heron) confirms which label
  is real; delete or rename the other **outside** the repo (files are on-box only). No repo change.
- **P4 — install `gh` on vigil** (owner call): closes the push-but-can't-PR gap; alternative is a
  documented hand-off (box pushes branch, rig-x870 session opens PR) — which this brief exercised.
- **P5 — one-line doc fix**: correct `adapter_pool.py:32`'s "hci0 carries the CPAP" to the AX210
  (`28:0C:50:0C:18:FD`), citing this brief. Rides along with any capture-host PR touching the file
  (comment-only edit still reruns the Python gate, nothing else).
- **P6 — config backup hygiene** (owner/Heron call): move `config.yaml.bak*` clutter into a
  `config-archive/` subdir on the box. No repo change; listed because it is the first thing a new
  maintainer trips on when asked to "check the config".

Not proposed (already owned elsewhere): per-device pinning deployment (owner, systemd) · distress
failover arming (owner, one config key) · adapter A/B methodology (`adapter_ab.py`) · O2Ring
advertising state machine (harvest brief; F5 feeds it).
