<!--
  capture-host/README.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# tepna-capture — the Health Box services

The out-of-suite code for the **Tepna Health Box** (bedside Raspberry Pi). Architecture + rationale:
[`../CAPTURE-HOST-2026-06-29-BRIEF.md`](../CAPTURE-HOST-2026-06-29-BRIEF.md). User-facing capture
steps: [`../how-to-collect/health-box.md`](../how-to-collect/health-box.md).

Two systemd services:
- **`tepna-capture`** — `capture.py`: a `bleak` supervisor that holds the live BLE links (Polar H10
  ECG, Verity PPG/ACC), supervises the Muse child tool, and writes **existing vendor layouts** with
  device-id filenames into `/srv/tepna/captures/<night>/`.
- **`tepna-web`** — Caddy serving the bundled apps at the pinned origin **`http://tepna.local`**.

> ⚠️ **Status: scaffold, unverified on hardware.** The BLE decode (`polar_pmd.py`) follows the
> documented Polar PMD spec; ECG type-0 is decoded fully, ACC/PPG have caveats, and compressed/delta
> frames are deliberately *not* guessed (they raise, surfacing in `status.json`). **Validate against
> real frames + a PSL export before trusting a night** (test plan below). This is not gated by
> `Dex-Test-Suite.html` — that gates the in-suite JS apps; this is the producer feeding them.

## Files
```
capture-host/
  capture.py            # entrypoint: async supervisor, reconnect, status.json, Muse child
  polar_pmd.py          # PMD control + ECG/ACC/PPG frame decode (validate on hardware)
  writers.py            # vendor-layout writers + filenames + Clock Contract  (suite-critical, correct)
  config.example.yaml   # copy -> config.yaml, edit device MACs/streams
  requirements.txt
  Caddyfile             # tepna-web: serve /srv/tepna/app at http://tepna.local
  systemd/tepna-capture.service
  systemd/tepna-web.service
```

## Install (Raspberry Pi OS / Debian 12+)
```bash
# 1. System deps. A recent kernel ships the RTL8761B firmware for the TP-Link UB500 Plus.
sudo apt update && sudo apt install -y bluez avahi-daemon caddy python3-venv git
sudo hostnamectl set-hostname tepna          # -> reachable as tepna.local (mDNS)
# Disable the Pi's onboard BT so the USB dongle is the only adapter (avoid two hci devices):
echo 'dtoverlay=disable-bt' | sudo tee -a /boot/firmware/config.txt   # reboot after

# 2. Code + venv
sudo mkdir -p /opt/tepna && sudo chown "$USER" /opt/tepna
git -C /opt/tepna clone <this-repo> .         # or copy capture-host/ to /opt/tepna/capture-host
cd /opt/tepna/capture-host
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

# 3. Muse tool (only if capturing EEG) — keep OUT of the venv (liblsl ABI):
pipx install muselsl        # Muse 2 / Muse S gen 1-2
# pipx install OpenMuse     # Muse S Athena (muse-lsl/BlueMuse do NOT work on Athena)

# 4. Storage + bundled apps
sudo mkdir -p /srv/tepna/app /srv/tepna/captures/incoming /var/log/tepna
sudo chown -R "$USER" /srv/tepna /var/log/tepna
cp /opt/tepna/*.html /srv/tepna/app/          # the BUNDLED Foo.html (never the .src.html editing tree)
```

## Configure & verify the dongle
```bash
lsusb | grep 2357:0604                 # TP-Link UB500 Adapter present
dmesg | grep -i rtl                    # firmware loaded, no "error -2"
bluetoothctl scan on                   # find your sensors' MACs -> put in config.yaml
cp config.example.yaml config.yaml && $EDITOR config.yaml
```

## Run / enable
```bash
# Manual smoke test:
.venv/bin/python capture.py --config config.yaml        # watch status.json + the captures/ folder
# Install services:
sudo cp systemd/*.service /etc/systemd/system/
sudo useradd -r -s /usr/sbin/nologin tepna 2>/dev/null; sudo chown -R tepna /srv/tepna
sudo systemctl daemon-reload && sudo systemctl enable --now tepna-capture tepna-web
```
Open **http://tepna.local/** from any device on the LAN. **Pin this one origin** (not `localhost`,
not the IP) so the suite's profile + longitudinal history stay consistent.

## The integration contract (why this is cheap to land — `BRIEF §7`)
1. **Emit existing vendor layouts** — PSL `*_ECG.txt`/`_PPG`/`_ACC`, Mind-Monitor Muse CSV → no new
   parser branch. New layouts go through `ADD-AN-ADAPTER.md`, never by editing a shared parser.
2. **Clock Contract** — `Phone timestamp` is **zone-free local-civil ISO** → floating `tMs`; never raw
   epoch as primary; a dropped packet is a **gap**, never `now()`.
3. **Filenames** `<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>` → companion pairing +
   date anchor for free. One device-id per physical sensor.

## Test plan (do before trusting a night)
- **Decode parity:** capture ~30 s of H10 ECG, open the file in `ECGDex.html` → R-peaks + a sane HR.
  Capture the same window with Polar Sensor Logger and diff the row values.
- **Clock Contract:** first/last rows match wall time; re-open under a changed `TZ` → identical clock;
  a deliberate disconnect leaves a **gap**, not fabricated rows.
- **Routing:** drop a captured file into the served **OverDex** → routes to the expected node +
  computes a `ganglior.node-export`; H10 `_ACC` sidecar pairs to the ECG primary (no cross-pair).
- **Overnight:** 22:00→06:00 monotonic, ~8 h, no 24 h jump; `status.json` shows per-stream rows climbing.

When real files surface vendor-format quirks, add the exact column/timestamp regex to the relevant
`*-dsp.js` (Clock Contract §2), keep `Dex-Test-Suite.html` green, and log it in a
`CAPTURE-HOST-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`.

## Gotcha: stale bytecode on the NTFS checkout

This repo lives on an `ntfs3` mount, where timestamp behaviour can defeat Python's mtime-based
`.pyc` invalidation. Symptom: `grep` shows your edit, but `import` still returns the OLD value —
so the daemon runs stale code and tests fail against a file that looks correct.
Cost us a wrong-rate diagnosis on 2026-07-18. If behaviour disagrees with the source:

    find capture-host -name __pycache__ -type d -exec rm -rf {} +
