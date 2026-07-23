<!--
  CAPTURE-HOST-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-06-29

# Capture Host → the Tepna Health Box (Raspberry Pi bedside appliance)

> **What this is.** A reference architecture + procurement plan for a **single Raspberry Pi by the
> bed** that is the whole loop: it **auto-captures** the suite's raw signals every night, **serves**
> the Tepna apps to any device on the LAN, and **stores** every night on disk — a self-contained,
> 100 %-local health appliance. Read `CLAUDE.md` §🎙️ (Capture provenance) and §🔒 (Clock Contract)
> first — this brief extends them, it does not relitigate them. Per-device user-facing steps live in
> `how-to-collect/`; this is the box that produces those files automatically and runs the apps that read them.

The box plays **three roles** (§4): a **capture daemon**, a **web server** for the bundled apps, and a
**night store**. Hardware + the daemon are out-of-suite (Python/Linux); the **in-suite contract** (§7)
keeps captured files routable through the existing adapters with **zero new parser branches**. The
capture/serve scripts are a follow-on deliverable (§11).

---

## 1. Why this exists

Today's capture is **manual / on-the-run**: Polar Sensor Logger (PSL) on a phone for H10 + Verity,
ViHealth for the O2Ring, the vendor app for CGM (`CLAUDE.md` §🎙️). Fine for spot sessions, poor for
unattended sleep — you must remember to start each app, a bedside phone sleeps its radio, and nothing
coordinates the streams or holds the history. The health box flips it: **press nothing, wake up to a
complete time-aligned night already on the box, and open Tepna from your phone to see it fused.**

The rule that makes integration cheap: **the box emits files in the SAME vendor layouts the suite
already parses** (PSL `*_ECG.txt`, ViHealth O2Ring CSV, Mind Monitor Muse CSV, Lingo CGM CSV) and
**serves the existing bundled apps unchanged**. Nothing in the suite forks; only the *producer* and the
*host* are new.

---

## 2. The capture-difficulty axis (read before buying anything)

The six signals split along **two** axes — and that, not CPU, drives every decision:

- **Protocol openness** — can a generic host read the raw stream? *Open* (Polar PMD, Muse, O2Ring) →
  live BLE works. *Locked* (Lingo CGM = encrypted, activation-gated, open tools don't support Lingo,
  Abbott DMCA-chilled) → **not raw-capturable**; tap the vendor's Health export instead.
- **On-body range** — every sensor is on the body, so the radio must be **at the bed**, not in a
  closet. 2.4 GHz through a sleeping body is the #1 reliability risk — which is exactly why the
  appliance *is* the bedside box.

Freebie: **three devices record onboard** (O2Ring always; Verity & H10 partially) → onboard recording
is the **reliability backstop** under any dropped live link.

---

## 3. Per-device capture method (the heart of the rig)

| Device | Signal → Node | Capture method | Why this method | Output layout to emit |
|---|---|---|---|---|
| **Wellue O2Ring** | `spo2` → OxyDex | **Onboard recording = source of truth**; morning ViHealth/O2 Insight sync. Live BLE optional. | Records all night standalone; live link not required. | ViHealth CSV `Time,Oxygen Level,Pulse Rate,Motion`, stamp `HH:MM:SS DD/MM/YYYY` → `adapters/oxydex-spo2.js` |
| **Polar H10** | `ecg` → ECGDex | **LIVE stream — mandatory.** bleak + Polar **PMD** ECG service (~130 Hz). | H10 onboard keeps only HR/RR, **not raw ECG**. Raw ECG exists only on the live BLE stream. | PSL `*_ECG.txt`: `Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]` (the exact layout `ecgdex-dsp.js` parses) |
| **Polar Verity Sense** | `ppg` → PpgDex | **Onboard offline** (button before bed) **or** live PMD PPG/ACC. | Onboard reliable but needs a press; live needs the host. | PSL `*_PPG` / `*_ACC` / `*_HR` layout → PpgDex parsers |
| **Muse S** | `eeg` → EEGDex | **LIVE stream.** `muse-lsl` (Muse 2 / S gen 1–2) **or** `OpenMuse` (**Muse S Athena** — newer firmware changed the GATT service/characteristics and broke muse-lsl + BlueMuse). | Raw EEG is BLE-stream-only; the official app exports staged sleep, not raw. | Mind Monitor CSV (EEGDex default per `EEGDEX-BUILD-BRIEF.md`) or LSL→CSV reshaped to it |
| **Abbott Lingo** | `cgm` → GlucoDex | **NOT raw-capturable.** Lingo app stays sensor master; pull the **Health Connect (Android) / Apple Health** auto-sync export. | Encrypted, activation-gated BLE; xDrip+/Juggluco don't support Lingo; reversing it is DMCA-chilled. On-arm → no range issue anyway. | Lingo CSV `Time of Glucose Reading…, Measurement(mg/dL)` (newest-first, ±HH:MM) → `adapters/libre-cgm.js` (handles the 55–200 clip) |

**Net:** the box runs **one live capture process** (H10 ECG always; Verity PPG + Muse EEG when worn),
with O2Ring as a morning sync and Lingo as a periodic Health export. EEG is the highest data rate
(~256 Hz × 4–5 ch) but trivial; ECG is the only *mandatory* live stream.

### The box at a glance
```
  [ bed / body ]                         [ Raspberry Pi health box + BLE dongle ]      [ any browser on LAN ]
  O2Ring  ──onboard──── morning sync ───► ViHealth CSV ───────┐                          http://tepna.local
  Polar H10 ──BLE PMD ECG 130Hz─────────► bleak capture ──────┤                                  │
  Verity ──BLE PMD PPG / onboard────────► bleak capture ──────┼─► /srv/tepna/captures/<night>/   ▼
  Muse S ──BLE──► muse-lsl / OpenMuse ──► LSL → CSV ──────────┘        *.txt (PSL/ViHealth/   Data Unifier / OverDex
  Lingo  ──enc. BLE──► Lingo app ──► Health Connect ──► glucose CSV ──► Mind-Monitor/Lingo      → node-export
                        ▲ dongle on a USB extension cable AT THE BED       layout, device-id     (Ganglior bus, fused)
                                                                            filenames)         served from the SAME box
```

---

## 4. The health-box appliance — three roles on one Pi

Everything is a **systemd service with `Restart=always`**, journald-logged, on a Pi that boots
straight into the appliance. mDNS (Avahi) publishes **`tepna.local`** so every device reaches it by name.

| Service | Role | What it does |
|---|---|---|
| **`tepna-capture.service`** | **Capture daemon** | Python + `bleak` supervisor: connects worn devices, decodes PMD/Muse frames, arrival-timestamps, writes vendor-layout files into `captures/incoming/` with device-id filenames. Per-device reconnect loops. |
| **`tepna-web.service`** | **Web server** | Caddy/nginx (or `python3 -m http.server` to start) serving the **bundled `*.html`** apps read-only at one pinned origin `http://tepna.local`. Same-origin → the suite shares `tepna_profile` + the Integrator longitudinal store, AND `Dex-Test-Suite.html` / `verify-provenance.html` iframe gates actually run (the `GATE-LIVE-RUNNABILITY` same-origin finding). |
| **`tepna-analyze.timer`** *(optional, Phase 2)* | **Auto-analysis** | A thin nightly Node job mirroring OverDex's walk: `captures/<night>/` → `SignalAdapters.route` → each node's headless `compute()` → write `*_ganglior.json` → `IntegratorDSP` fusion → a night summary. The pieces already exist and are gate-proven ≡ the apps (`env.equiv`); only the small Node driver is new. Until it ships, analysis is the morning drag-drop below. |

### Storage layout (`/srv/tepna/`) — disk is the source of truth
```
/srv/tepna/
  app/                       # bundled Foo.html served read-only (edit .js+.src.html elsewhere, re-bundle, copy in)
  captures/
    incoming/                # capture daemon writes here (vendor layout, device-id names)
    2026-06-25/              # rolled per night by dateAnchor (Clock Contract §4)
      Polar_H10_AAAAAAAA_20260625_215300_ECG.txt
      Polar_VeritySense_BBBBBBBB_20260625_215300_PPG.txt
      O2Ring_CCCCCCCC_20260625_215300_spo2.csv      # dropped by morning ViHealth sync
      Muse_S_DDDDDDDD_20260625_215300_eeg.csv
      Lingo_20260625_cgm.csv                        # dropped by Health-export
    exports/                 # node-exports (*_ganglior.json), manual or Phase-2 auto
```
The **raw captures + node-exports on disk are durable + re-ingestible**; the browser's localStorage /
IndexedDB are a **rebuildable cache**, not the system of record (see §8 backup).

### Morning workflow
1. Take the sensors off (links drop cleanly; daemon idles).
2. Drop the two non-live files into tonight's folder: **O2Ring** (ViHealth export) + **Lingo** (Health
   Connect / Apple Health export). The live streams (ECG/PPG/EEG) are already there.
3. From any device open **`http://tepna.local/OverDex.html`** (or `Data Unifier.html`), point it at the
   night's folder → a fused `ganglior.node-export`. Or open a single node (`OxyDex.html`, …) directly.
4. *(Phase 2)* the nightly job already produced the exports + Integrator summary — just open the
   Integrator and read last night.

---

## 5. Hardware & bill of materials (Raspberry Pi)

**Platform: Raspberry Pi 5 (8 GB)** — silent, low-power, bedside-friendly, and the lingua franca of
always-on sensor rigs (every `bleak`/muse-lsl guide targets it; ARM Linux runs the whole stack). *(A
mini-PC e.g. EliteDesk 800 Mini is the x86 alternative if you want enterprise build or Proxmox
double-duty — then run capture in a VM with USB passthrough, never an LXC, and still keep it bedside.)*

**Why a dongle when the Pi 5/4 already have onboard BLE?** The onboard radio works (the Pi 5/4 carry
BT 5.0/BLE on their wireless module), but (1) its antenna is a fixed PCB trace you **can't move to the
bed** — and can't upgrade without voiding the Pi's FCC cert — so it can't win the body-attenuation
fight §2 calls the #1 risk; (2) it shares the 2.4 GHz path with onboard Wi-Fi; and (3) its controller
isn't what you'd bet 3+ unattended overnight links on. A dongle on a USB extension at the bed fixes all
three — so we **disable onboard BT** (below) and use the dongle. The version number on the dongle
buys little here: on a Pi you ride the host **BlueZ** stack regardless, so chipset + Linux-driver
maturity + antenna placement decide reliability, not BT 5.3 vs 6.0.

| Item | Pick | Note |
|---|---|---|
| Board | Raspberry Pi 5, 8 GB | Pi 4 8 GB also fine. |
| **Storage** | **NVMe HAT + small NVMe SSD** *(or USB-SSD on Pi 4)* | **Never run logging off a microSD** — continuous writes corrupt it. The one real Pi weakness; an SSD removes it. |
| **BLE dongle (primary — plug-and-play)** | **TP-Link UB500 Plus** — Realtek **RTL8761B**, BT 5.3 + BLE, flip-up antenna | **Verified:** the "Plus" shares the same chip + USB-ID (`2357:0604`) as the proven UB500 — BT 5.3 is a spec bump on the *same silicon*, so its Linux story is identical. Current Pi OS (kernel ≥5.16) = plug-and-play; older kernel = enumerates in `lsusb` but **won't scan** (`firmware … error -2`) → drop `rtl8761b_fw.bin`+`_config.bin` into `/lib/firmware/rtl_bt/` (or symlink the `rtl8761b`/`rtl8761bu` names to match what `dmesg` asks for), reboot. The flip-up antenna rotates but is **not** detachable — placement is via the USB extension below, not a pigtail. The **plug-and-play / ~3–5-link tier** (fine for our 3 streams); not the multi-link champion — see alt. **Disable the Pi's onboard BT** to avoid two `hci` devices. |
| **dongle alt (multi-link upgrade)** | **Raytac MDBT50Q-CX** — nRF52840 USB-C, Open-bootloader, flashed Zephyr `hci_usb` | The nRF *is* the controller → you **own the connection ceiling** (the real multi-link win). First-class Zephyr board (`raytac_mdbt50q_cx_40_dongle/nrf52840`); ships with Nordic's Open bootloader so you DFU-flash over USB with `nrfutil` — **no J-Link/SWD needed**. ⚠️ **Not plug-and-play, and "many links" needs *tuning*, not just flashing:** stock `hci_usb` drops links after ~10–20 s / caps at a few → raise `CONFIG_BT_MAX_CONN` + ACL buffer counts (and sane connection intervals) in the build to hold 3 streams overnight. USB-C → needs a C-to-A adapter/extension; onboard PCB antenna (no RP-SMA). Nordic's own **PCA10059** dongle is the interchangeable equivalent if you prefer the canonical board. |
| **USB extension** | short USB-A cable | Put the dongle **at the bed**, within ~2 m, line-of-sight to the chest strap. Biggest reliability lever. |
| Power | official 27 W PSU **+ small UPS / battery HAT** | Graceful shutdown on power loss → no corrupt night. |
| Case | fan or passive | Quiet for the nightstand. |

**Avoid:** the **TP-Link UB600** — its BT 6.0 is wasted on the Pi (you ride the host BlueZ stack
regardless) and its newer Realtek silicon is **Linux-unproven**; don't substitute it for the UB500 Plus
on the "BT 6.0 / 7 devices" marketing. Also counterfeit CSR8510 (BT 4.0, marginal at 3+ links) and
no-name "BT 5.3 Windows-only" clones (often Barrot chips, **zero BlueZ support**). Chipset, not brand,
decides Linux compatibility.

**Verify dongle:** `lsusb` → `2357:0604 … TP-Link UB500 Adapter`; `dmesg | grep -i rtl` → firmware
loaded, no `error -2`; `bluetoothctl` → `scan on` finds devices. "Detected but won't scan" == missing
firmware. *(nRF path instead: after DFU-flashing `hci_usb` it appears as a Zephyr HCI controller —
not `2357:0604` — so verify with `hciconfig`/`bluetoothctl list`, not the RTL firmware check.)*

**Recommended:** ship v1 on the **UB500 Plus** (plug-and-play, proven); add the **MDBT50Q-CX** if a real
overnight ever drops a link. At ~$18 + $10, owning both buys a tuned multi-link primary **and** a
plug-and-play fallback — cheap insurance for an unattended appliance, and the onboard recordings
(O2Ring always; Verity/H10 partial, §2) remain the last-resort backstop under any dropped live link.

---

## 6. Software — the two services in detail

**Capture daemon (`tepna-capture`):**
- Python + `bleak` (clean on Linux/BlueZ; the backend muse-lsl/OpenMuse use). One async supervisor
  connects all worn devices, subscribes to notifications, **timestamps each packet on arrival from the
  host clock**, writes per-stream files. Per-device reconnect loops; onboard recording is the backstop.
- **Polar:** decode the **PMD** service — ECG (H10) and PPG/ACC (Verity); documented UUIDs + frame
  format → reshape to the PSL `*_ECG.txt` / `*_PPG` row layout on write.
- **Muse:** `muse-lsl` (Muse 2 / S) or `OpenMuse` (Muse S **Athena** — streams via `0000fe8d…`,
  multiplexed; muse-lsl/BlueMuse fail) → LSL → CSV reshaped to Mind Monitor columns.
- **O2Ring:** prefer morning ViHealth sync; optionally live-stream via the reverse-engineered protocol.
- **Lingo:** no capture code — a step that exports Health Connect / Apple Health glucose to the Lingo CSV layout.

**Web server (`tepna-web`):**
- Static server over the bundled `*.html`. Quick start `python3 -m http.server`; always-on Caddy/nginx
  systemd unit. Serve the **bundles**, never the `.src.html` + loose `.js` editing tree.
- **Pin ONE origin** (`http://tepna.local`). localStorage/IndexedDB are per-origin, so `localhost` vs
  the LAN IP vs `tepna.local` are *different* profiles/histories — choose one and always use it.
- Plain HTTP is fine: no Tepna feature needs a secure context, and `localhost` is treated as secure
  anyway. (TLS only if you later want LAN secure-context; Caddy gives it cheaply.)

---

## 7. How it lands in Tepna (the integration contract — non-negotiable)

The rules that let a captured file route with **no new parser branch**:

1. **Emit existing vendor layouts** (§3 last column). Where the box genuinely can't mimic one, add a
   new adapter per `ADD-AN-ADAPTER.md` (one adapter + one routing-table gate, no node edit) + a
   `how-to-collect/` note — never edit a shared parser to special-case the rig.
2. **Clock Contract (`CLAUDE.md` §🔒).** Write **zone-free local-civil timestamps in the vendor's
   format** (ECG `Phone timestamp` ISO `2026-06-25T21:53:00.123`, no zone → parser branch 3 → floating
   `tMs`). **NOT** raw epoch ms (viewer-tz ambiguity); **NEVER** fabricate a stamp for a dropped packet
   — **leave the gap** (missing stamp must surface as `null`, never `now()`).
3. **Filename = device-id + 14-digit stamp**, matching PSL so `dex-ingest.js` /
   `signal-orchestrate.pairCompanions` pair sidecars by device-id + nearest stamp and `dateAnchorMs`
   reads from the name (Clock Contract §4):
   `<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>`. One device-id per physical sensor so
   cross-device pairing never mis-matches (the `ECG-INGEST-FOLLOWUPS` device-filter relies on it).
4. **EEG grade stays honest.** Single-channel staging is `emerging`, band powers `measured`
   (`EEGDEX-BUILD-BRIEF.md`); the box changes none of that.
5. **Lingo honesty.** GlucoDex already detects the 55–200 clip and flags affected metrics
   (`how-to-collect/libre-cgm.md`); the Health-export path inherits it — don't paper over the clip.
6. **Serving ≠ network egress.** "100 % local, no CDN" forbids the *app* phoning out — it makes zero
   external requests served or `file://`. A LAN HTTP server of local files is fully compatible.

---

## 8. Operations
- **Status.** The daemon writes a `status.json` (per-device: connected, samples, duration, battery,
  last error); a tiny served page or a Pi GPIO/RGB LED shows "ECG ✓ 7h12m · PPG ✓ · EEG ✗ (battery)"
  at a glance in the morning. (Optional kiosk: the box's own display shows it.)
- **Backup = re-ingest, not cache-dump.** The durable system of record is **`captures/` + `exports/`
  on the SSD** — back *those* up (rsync/Tailscale to another box). The browser's profile + Integrator
  longitudinal IndexedDB are a **rebuildable cache** (re-open OverDex on the night store to rebuild).
  Don't engineer fragile IndexedDB backups; treat the files as truth.
- **Security / privacy.** Health data → bind the web service to the **LAN/bedside box only**, never
  WAN; reach it remotely via **Tailscale/VPN**. The suite already minimizes PHI (scrubbed
  `provenance.files`/`inputs[].name`, identity-free `contentId` — `PHI-SURFACE-STATEMENT.md`); keep it on-box.
- **Time.** NTP-synced, correct local TZ — arrival stamps depend on it (Clock Contract). Stored values
  stay floating wall-clock, so viewer-tz independence still holds on any device that opens the apps.
- **Power.** SSD (not SD) + a small UPS for graceful shutdown → an overnight power blip never corrupts a night.

---

## 9. Reliability & verification checklist
- Overnight 22:00→06:00 = ~8 h **monotonic**, no 24 h jump (Clock Contract overnight test).
- Each stream's first/last rows == the raw device exactly (round-trip).
- Re-render a captured file under a changed `TZ` → identical clock (`getUTC*` viewer-independence).
- A dropped-link window shows a **gap**, not fabricated rows.
- Each captured file **routes** in OverDex / Data Unifier to its expected adapter and computes a
  `ganglior.node-export`; companion sidecars pair to the right primary (no Sense-onto-H10 cross-pair).
- The served suite is same-origin: `Dex-Test-Suite.html` all-green + `verify-provenance.html` GATE A
  clean **from the box's URL**.

## 10. Open product questions (human calls)
- Live-stream vs onboard for Verity (button tradeoff); whether to live-capture the O2Ring at all.
- **Muse model** in use (Muse 2 / S gen-2 → muse-lsl; **Athena** → OpenMuse) — flips the toolchain.
- Whether Phase-2 auto-analysis (the Node walk→compute→fusion job) is in scope or stays morning-drag-drop.
- Where the box code lives in the repo (proposed `capture-host/`, out of the bundled-app gate path) vs a sibling project.

## 11. Deliverables / Done when
This brief is the **architecture doc**. It flips to DONE only when the box exists and a real overnight
file from each live device round-trips through the served suite:

> **Scaffold landed 2026-06-30** — `capture-host/` (`capture.py` bleak supervisor + reconnect +
> `status.json`; `polar_pmd.py` PMD ECG/ACC/PPG decode — ECG full, ACC/PPG + compressed-frame
> caveats; `writers.py` vendor layouts + Clock-Contract stamps + device-id filenames;
> `config.example.yaml`, `requirements.txt`, `Caddyfile`, `systemd/` units, `README.md`) + the five
> `how-to-collect/` notes (`polar-h10-ecg`, `verity-ppg`, `muse-eeg`, `cpap-edf`, `health-box`).
> Remaining = **hardware bring-up + on-hardware validation** (the ☐ below). Stays PROPOSED until a
> real night round-trips — never stamp DONE on unverified work.
>
> **§9 round-trip PROVEN on REAL captured data 2026-07-22** (on `rig-x870`, the daemon running under
> a `systemd --user` service). The core "each captured file routes + computes a node-export" gate — the
> hardest desk-verifiable item — now passes on real multi-hour captures, not the prior short desktop
> sessions: a **44 MB / 724,160-sample H10 ECG** file (92.9 min) routes `polar-h10-ecg` (conf 0.90) →
> `ECGDex.compute()` → valid `ganglior.node-export` (**21 R-peak events, fs 129.99 Hz** — the FOLLOWUPS-I
> §1 fs-fix holds on real bytes, not 143/125), and a **3,865-row O2Ring SpO₂** ViHealth CSV (64.5 min)
> routes `oxydex-spo2` (conf 0.80) → `OxyDex.compute()` → node-export (meanSpo₂ 96.1 %, min 94, HR 48.8).
> Clock Contract verified on the ECG file (relative/fractional `timestamp [ms]`, sensor column monotonic).
> The **entire `capture-host/` test suite is green** (~40 files, 1000+ assertions) + the ECG parity
> harness passes. **STILL BLOCKING DONE (all physical/hardware-gated):** a single *continuous overnight*
> 22:00→06:00 round-trip (tonight's sessions are segmented per BLE reconnect); FOLLOWUPS-II V1–V5 (PSL
> byte-diffs, an OH1, an observed NTP step, the clock sudoers rule); real-*Pi* bring-up (this is a desktop
> rig). The persistent service is now set up, so tonight's capture produces the gating overnight.
- ☐ Pi provisioned: SSD, correct TZ + NTP, onboard BT off, dongle up as `hci0` bedside on an extension.
- ☐ `tepna-capture` (bleak supervisor + reconnect + systemd) emitting §3/§7 layouts with §7 filenames.
- ☐ `tepna-web` serving the bundled apps at the pinned `http://tepna.local`; suite gates green from that URL.
- ☐ Night-store layout (`/srv/tepna/captures/<night>/`) + a `status.json`/status surface.
- ☐ New `how-to-collect/` notes: `polar-h10-ecg.md`, `verity-ppg.md`, `muse-eeg.md`, and a
  `health-box.md` overview (mirror the existing note style; cross-link from `How to Collect Data.html`).
- ☐ A captured file from **each** live device routes + computes a node-export; §9 checks pass.
- ☐ Any genuinely new layout landed as an adapter + routing-table gate (`ADD-AN-ADAPTER.md`) with the
  Clock-Contract regex, **`Dex-Test-Suite.html` all-green**, and a `how-to-collect/` note — never by editing a shared `parseTimestamp`.
- ☐ *(optional)* `tepna-analyze` nightly Node job; gate its output ≡ the served-app node-export.

## 12. Expected follow-up
Real captured files will surface vendor-format quirks (PMD frame edge cases, Muse Athena preset
specifics, ViHealth column drift). Capture them in `CAPTURE-HOST-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` and add
each exact column/timestamp format to the relevant `*-dsp.js` parser by regex as encountered (Clock
Contract §2). If nothing surfaces, say so in this brief's header rather than spawning an empty follow-up.

---

## Cross-references
- `HEALTH-BOX-VISION-2026-07-01-BRIEF.md` — the **product-vision layer** on top of this architecture (names the box **Tepna Vigil**, the phased capability model, the hero live view, the context/night-story surface). This brief owns the *how*; that one owns the *what & why*.
- `CLAUDE.md` §🎙️ Capture provenance (PSL — the manual method this automates) · §🔒 Clock Contract
- `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` (why same-origin serving makes the gates run)
- `how-to-collect/oxydex-spo2.md` (O2Ring) · `how-to-collect/libre-cgm.md` (Lingo/Libre CGM)
- `EEGDEX-BUILD-BRIEF.md` (Muse node, Mind Monitor default, `emerging` staging grade)
- `GlucoDex-BUILD-BRIEF.md` · `ECGDex-BUILD-BRIEF.md` · `PPGDex-BUILD-BRIEF.md`
- `ADD-AN-ADAPTER.md` (the new-vendor path) · `ECG-INGEST-FOLLOWUPS-2026-06-28-BRIEF.md` (device-id companion pairing)
- `ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md` (real PSL `*_ECG.txt` shape + the startup-transient gotcha live capture will reproduce)
- `PHI-SURFACE-STATEMENT.md` (the on-box privacy posture)
