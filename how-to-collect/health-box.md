<!--
  how-to-collect/health-box.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — the Tepna Health Box (bedside Raspberry Pi)

**What it is.** One **Raspberry Pi by the bed** that does the whole loop: **auto-captures** the night's
signals over BLE, **serves** the Tepna apps to every device on the LAN, and **stores** each night on an
SSD. 100 % local — no cloud, no CDN. Full architecture + procurement: `CAPTURE-HOST-2026-06-29-BRIEF.md`.

## Three services (systemd, `Restart=always`)
- **`tepna-capture`** — Python + `bleak` supervisor: holds the live links and writes the **existing
  vendor layouts** (see the per-device notes) into `captures/incoming/`.
- **`tepna-web`** — static server (Caddy/nginx) for the bundled apps at one pinned origin
  **`http://tepna.local`**. Same-origin = the suite shares your profile + longitudinal history *and* the
  gates run.
- **`tepna-analyze`** *(optional)* — a nightly job that pre-computes node-exports + the Integrator
  summary so you just open and read.

## What the box captures vs. what you drop in
| Signal | How it lands on the box | Note |
|---|---|---|
| **ECG** (H10) | live BLE (mandatory for raw) | `polar-h10-ecg.md` |
| **PPG** (Verity) | live BLE, or onboard offline | `verity-ppg.md` |
| **EEG** (Muse S) | live BLE (muse-lsl / OpenMuse) | `muse-eeg.md` |
| **SpO₂** (O2Ring) | morning ViHealth sync → drop in | `oxydex-spo2.md` |
| **CGM** (Lingo) | Health Connect / Apple Health export → drop in | `libre-cgm.md` — **not** raw-capturable |
| **CPAP** (AirSense 11) | SD card, or ezShare Wi-Fi SD auto-pull → drop in | `cpap-edf.md` — **not** myAir/Wi-Fi (summary only) |

## Morning workflow
1. Take the sensors off (links drop; daemon idles).
2. Drop the two non-live exports into tonight's folder: **O2Ring** (ViHealth) + **Lingo** (Health
   export). CPAP `*.edf` lands via SD/ezShare. The live streams (ECG/PPG/EEG) are already there.
3. From any device open **`http://tepna.local/OverDex.html`** → point at the night's folder → a fused
   `ganglior.node-export`. Or open a single node directly.

## Two rules that keep it honest
- **Pin ONE origin.** `localhost`, the LAN IP, and `tepna.local` are *different* storage buckets — pick
  `tepna.local` and always use it, or your history "disappears".
- **Disk is the source of truth.** `captures/` + `exports/` on the SSD are durable and re-ingestible;
  the browser's profile + longitudinal store are a **rebuildable cache** — back up the files, not the cache.

## Privacy
Health data → bind the web service to the **LAN / bedside box only**, never the open internet; reach it
remotely via **Tailscale/VPN**. The suite already minimizes PHI (scrubbed filenames, identity-free
`contentId` — `PHI-SURFACE-STATEMENT.md`).
