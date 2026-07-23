<!--
  CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-16 (**§1 fs-fix VERIFIED on real bytes 2026-07-22:** a real
44 MB / 724,160-sample H10 ECG capture round-trips through the served suite to a valid ECGDex
`ganglior.node-export` at **fs 129.99 Hz** — the exact failure this brief's §1 fixed no longer occurs on
real data. Full `capture-host/` test suite + the ECG parity harness green. §3-open/§4.2 items remain
hardware-gated (overnight round-trip, PPG averaged-pulse cosmetics). See CAPTURE-HOST parent §11 note.)

# Capture-Host follow-ups — what the first real multi-sensor bring-up surfaced

> **What this is.** The follow-up `CAPTURE-HOST-2026-06-29-BRIEF.md §12` asks for: real captured files
> surface vendor-format quirks; capture them here. The first hardware session (2026-07-16, on
> `rig-x870` with a TP-Link UB500 dongle) took the scaffold from *unverified* to **three sensors
> streaming live concurrently** (Polar H10 ECG · Verity Sense PPG · Wellue O2Ring-S SpO₂/pulse) and
> also stood up the `HEALTH-BOX-VISION §4` hero live-view. It landed on branch
> `claude/vigil-capture-parity` (PR #129) — **all under `capture-host/`, out-of-suite, no bundle/gate
> impact.** This brief records the vendor-format quirks it found, the data-correctness bug it fixed,
> and what still blocks `CAPTURE-HOST` from flipping DONE.

## 1. The data-correctness bug (fixed) — `writers.py timestamp [ms]`
The scaffold emitted the PSL `timestamp [ms]` column **integer + absolute** (`{t_ms:.0f}`). Real Polar
Sensor Logger exports it **relative-to-recording-start and fractional** (`0.0, 7.692288, …`). Rounding
the 7.692 ms step made ECGDex's headless `parseECGText` infer **fs = 143/125 Hz instead of 130** — a
**~10 % HR error on every captured night**. Fixed to `(sensor_ns − first_sensor_ns)/1e6`; verified
against a real H10 corpus and a synthetic-frame parity harness (`capture-host/tests/ecg_parity_harness.py`)
that runs the real `polar_pmd`+`writers` through the actual ECGDex fs inference. **Lesson:** a
"suite-critical, correct"-labelled writer was neither — the only way to know was to diff against a real
vendor export, which is now encoded as a repeatable check.

## 2. Vendor-format quirks discovered (the §12 mandate)
- **Polar Verity PPG START needs CHANNELS, as a u8.** The PMD START was rejected until it carried the
  CHANNELS setting (`0x04`): omit → `0x0B ERROR_INVALID_NUMBER_OF_CHANNELS`; send it u16 → `0x05
  ERROR_INVALID_PARAMETER`. The value is a **single byte** (`04 01 04`, not `04 01 04 00`) — found by
  sweeping encodings until the control-point returned `0x00`. Sample rate 55 / resolution 22 / 4 channels
  came from the device's own `requestStreamSettings` reply. (ACC gets the same channels rule.)
- **Verity PPG streams DELTA/compressed frames** (`frame_type 0x80`), which the scaffold couldn't decode
  (it deliberately raised on non-zero frame types). Implemented `polar_pmd._decode_delta()`: reference
  sample (channels × 24-bit) + bit-packed accumulating deltas (`[deltaSize][count]` blocks, LSB-first),
  verified against 6 real frames (~55 Hz, 4 channels = 3 LEDs + ambient). This is the `POLAR-SDK-CAPTURE`
  Track-A work (reimplement `polar_pmd.py`'s acknowledged compressed-frame weak path) done for PPG.
- **The O2Ring is an OxyII / T8520 device, NOT legacy Viatom** — the biggest finding. It advertises as
  **`S8-AW <suffix>`** and exposes the legacy Viatom service (`14839ac4-…`) but **ignores every command
  on it** (connects, 0 data), because it actually speaks a separate **"OxyII"** protocol on the `e8fb`
  service. Every existing open-source O2Ring tool (`ecostech/viatom-ble`, `MackeyStingray/o2r`) — and the
  scaffold's first `viatom.py` — silently fails against it. New `capture-host/oxyii.py`: `0xA5`-framed,
  standard CRC-8 (poly 0x07, verified vs the reference known-answer), **XOR** auth (`cmd=0xFF`) → setup
  (`cmd=0x10`) → poll `cmd=0x04` for live SpO₂/HR/battery. **No bond, no AES on the live path.** Verified:
  SpO₂ 97–98 %, pulse 53 (matches the H10 ECG), battery 94 %. Ref: `github.com/nglessner/o2ring-s-protocol`.
- **The Polar H10 requires a bonded/encrypted PMD link** — an un-bonded connection drops ~1–2 s after
  connect (`AuthenticationFailed` / `NotConnected`). `capture.py` now auto-bonds (Just-Works agent) before
  PMD. RSSI/phone-contention were red herrings; the real cause was bonding.
- **BlueZ serialises connection *establishment* per adapter** — two devices connecting at once →
  `org.bluez.Error.InProgress`. Fixed with a shared `_CONNECT_LOCK` around connect only (links then run
  concurrently). Three sensors hold on the UB500 at once.

## 3. What this advanced in `CAPTURE-HOST §11` — and what still blocks DONE
Advanced (not yet ticked in the parent — this was a desktop bring-up, not the Pi):
- `tepna-capture` emits §3/§7 vendor layouts with §7 device-id filenames for **ECG (PSL `_ECG`), PPG (PSL
  `_PPG`), and SpO₂ (ViHealth CSV via `Spo2CsvWriter`)** — verified live.
- The `HEALTH-BOX-VISION §4` **hero live-view is built**: a served monitor (`webmon.py` aiohttp + SSE) with
  a device picker (bond/remember/forget) and a stream-aware live scope + analysis panel — ECG averaged
  **beat**, PPG averaged **pulse**, SpO₂/pulse **session summary**. 100 % local, no CDN.

Still open (so `CAPTURE-HOST` stays **PROPOSED**):
- **No real overnight round-trip yet** (§11's gating item): 22:00→06:00 monotonic, gap-on-disconnect, and
  each captured file routing + computing a node-export in OverDex. Only short desktop sessions were run.
- ~~**No `how-to-collect/` notes**~~ — **DONE.** `how-to-collect/verity-ppg.md` and `health-box.md` exist;
  the OxyII O2Ring is documented inside `oxydex-spo2.md` rather than a separate `o2ring-s.md`, which is
  why that filename never appeared.
- **On a real Pi**: onboard-BT disable, `hci0` bedside on an extension, `tepna.local`, suite gates green
  from that origin — untouched.

## 4. New follow-up work items (small, none blocking the PR) — *status reviewed 2026-07-18*
1. ~~**`Spo2CsvWriter` periodic flush**~~ — **DONE.** All five writer classes flush + `os.fsync()` on a
   `FLUSH_INTERVAL_S = 5.0` cadence, so at most ~5 s of tail is at risk on any stream, not just SpO₂.
2. **Sharpen the PPG averaged-pulse** — *still open, and deliberately unclaimed.* It is now a two-pass
   foot-aligned ensemble with correlation rejection (`corr > 0.85`, last 24 pulses) plus a ±60 ms foot
   re-delineation — better than the slope-detect it started as, but the alignment anchor is still the
   **foot**, which is what the long-crest complaint was about. Live-view cosmetics only: nothing computes
   a metric from it, so it stays low priority.
3. ~~**O2Ring scan-by-name**~~ — **DONE.** `_connect_scan` matches `address OR name-prefix` against
   `_O2_NAME_HINTS = ("o2ring","s8-aw","s8aw","wellue","checkme")`, so a factory reset that rotates the
   Random-Static MAC no longer strands the device. (Service-UUID / manufacturer-ID matching was not
   needed once the name hint resolved it; the config `address:` is now a hint, not a requirement.)
4. **`polar_pmd.py` ACC delta path is unexercised** — *still open (hardware-gated).* The delta decoder is
   wired for ACC (channels=3, 16-bit) but has never seen a real ACC frame; validate before trusting
   posture sidecars. Tracked in FOLLOWUPS-II as **V2**.
5. **Config drift** — `config.yaml` is now gitignored (real device MACs + local path); the options
   (`adapter`, `web`, OxyII O2Ring, `protocol: legacy`) live in the committed `config.example.yaml`.
6. **`aiohttp` is a new host dependency** — fine for the out-of-suite host; note it in the Pi provisioning.

## 5. Done when
This is a follow-up capture doc, not an executable brief; it flips DONE when items §3-still-open + §4 are
either executed or re-homed into `CAPTURE-HOST`/their own briefs. It carries no gates of its own (all work
is out-of-suite `capture-host/`).

## Cross-references
- `CAPTURE-HOST-2026-06-29-BRIEF.md` — the parent (this executes part of §3/§4/§7; §11 stays open).
- `HEALTH-BOX-VISION-2026-07-01-BRIEF.md` — §4 hero live-view, now implemented as the monitor page.
- `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` — Track A (reimplement `polar_pmd.py` weak paths); the PPG
  channels + delta-frame work is that, done for PPG from the device's own settings reply rather than the SDK.
- `CLAUDE.md` §🎙️ Capture provenance · §🔒 Clock Contract (the `timestamp [ms]` fix honors §2/§5).
- Branch `claude/vigil-capture-parity` / PR #129 — the code this brief documents.
