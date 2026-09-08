<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS (Task 1 remainder picked up 2026-09-07 → `RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md` — the SDC anchor-point report is the controller-side timestamp source; image built, reflash pending; parked 2026-09-02 — drain triage, Kestrel: the remainder is ON-BOX HARDWARE work — controller-side timestamping is a rebuild+reflash of the dongle (owner, rig-side) and the Task 2 jitter probe needs `btmon` with `CAP_NET_RAW` on vigil's free adapter, a daytime paired session the brief itself says not to run as an interrupt; nothing is blocked on repo code. Owner: Heron with the owner present; next step: Task 2 on hci2 against one beacon, Zephyr vs Realtek. Previously 2026-08-25: Task 1 flash executed on the SDC path; timestamping + Task 2 probe still open) · **Created:** 2026-08-23

# Zephyr dongle as the open BLE timing instrument — flash + jitter probe (paired daytime task)

The vigil box carries a Nordic nRF52840-class dongle running Zephyr `hci_usb` firmware (USB
`2fe3:000b`, hci2, address `C6:CF:3C:4E:75:F0`). The 2026-08-22 investigation established what it is
and what it is FOR — recorded here so the work isn't re-derived.

## What was measured (2026-08-22 night)
- **Enumeration, HCI path, RX: all healthy.** Clean scan: 38–41 unique devices, floor −90/−91 dBm,
  heard a ResMed CPAP at −35. No firmware-load games (the Realtek's original sin).
- **Address `C6:CF:3C:4E:75:F0` stable** across every power-cycle that night; baseline recorded in
  `vigil:~/zephyr-addr-history.txt`. Not yet confirmed across a reboot — check that file after the
  next natural reboot (same = no churn; different = firmware fixed-address build needed).
- **A host-side public-address pin is NOT possible** — this firmware returns `0x0c Not Supported`;
  Zephyr identifies by static-random, not public. The udev/script approach was tried and reverted.
- **⚠️ The Zephyr is NOT a capture upgrade over the Realtek.** Measured clean (capture stopped, single
  scan to avoid the back-to-back-scan `Busy` confound), the Realtek hears MORE and DEEPER: 651 ads,
  floor **−102 dBm** vs the Zephyr's −91, thanks to its external antenna. The Realtek's documented
  intermittent deafness is real but already auto-recovered by `capture.py`'s `tepna-btreset` ladder.
  So the Realtek stays on production capture; the Zephyr's value is being the only OPEN controller.
  (Three "Realtek heard 0" readings that night were all the double-scan confound, not deafness —
  the clean single scan proved it. A near-miss fabricated disproof; do not repeat the "it's deaf"
  claim without a clean single scan.)

## The role: clock-metrology instrument (what the closed radios cannot do)
This lands on the Clock-Contract / `hostAxis` / ppm-drift / Allan-deviation frontier.

> **EXECUTED 2026-08-25 (rig-x870, owner-directed) — the flash half of Task 1, on the SoftDevice
> Controller path.** The Raytac MDBT50Q-CX (moved to the rig after the vigil USB-port exoneration) now
> runs **NCS v3.4.0 `hci_usb` with Nordic's SDC** instead of the open-source Zephyr LL — verified by
> `Manufacturer: Nordic Semiconductor ASA (89)` and `CONFIG_BT_LL_SOFTDEVICE=y` in the build.
> Tuning (all grep-verified in the generated `.config`, sysbuild path `build-hci/hci_usb/zephyr/`):
> `BT_MAX_CONN=6` · DLE 251 (`ACL MTU 251:6` live at runtime vs stock's 27:3) · 2M PHY · CONN_RSSI ·
> LE_ENC · `SDC_TX/RX_PACKET_COUNT=6` (defaults are 3/2 — thin for 4 streaming centrals) ·
> `BT_HCI_VS=y`. `SDC_PERIPHERAL_COUNT=0` was tried and REFUSED by SDC's own BUILD_ASSERT
> (hci_driver.c: `CONFIG_BT_PERIPHERAL` requires ≥1), so 5 central + 1 peripheral links stand.
> Verified live: 90 s untouched survival, binds as hciN, BlueZ default, **54 devices in a 10 s scan**.
> Workspace + build recipe: `/srv/data/ncs` (toolchain `/srv/data/ncs-toolchains`, conf
> `vigil-sdc.conf`, DFU zip `vigil_sdc_dfu.zip`). DFU entry with Zephyr flashed is **hold the button
> while plugging in** — a plain press only resets (the stock firmware's press-for-DFU was app code).
> ⚠️ Flash by Nordic VENDOR ID port selection, never "first ttyACM" — ttyACM0 here is the u-blox GNSS.
> Address: BlueZ static-random `FA:88:98:C3:7F:E5` (host-side pin still impossible — `0x0c Not
> Supported` unchanged); persistence across re-plugs/hosts NOT yet observed, and SDC's
> `vs_read_static_addresses` path (BT_HCI_VS) is the candidate fixed-address mechanism to verify.
> **Still open from Task 1:** controller-side ACL/adv timestamping (not in this build) · the fixed
> static address verification · a multi-connection STREAMING soak (the scan proves RX only). Task 2
> (jitter probe) untouched. One false trail recorded so the next session doesn't re-walk it: an
> apparent post-flash crash (device vanishing from the bus) was the OWNER'S UNPLUG during DFU
> attempts — the tuned image never crashed; bisect images `build-stock`/`build-p1` exist unused.

> **2026-09-07 — second nRF52840 unit arrived on the rig, WITH an external SMA antenna (owner: "better
> timing will be possible").** Enumerates as Nordic `1915:c00a` "nRF52 Connectivity" on `/dev/ttyACM*`
> (CDC) — that is the *pc-ble-driver* connectivity image, a host-driven central, NOT a sniffer and NOT
> `hci_usb`; it needs the Task 1 image flashed over the same DFU bootloader (hold button while plugging
> in; select the port by Nordic VENDOR ID, never "first ttyACM"). Why it changes the picture: the
> Realtek's −102 dBm floor above was an ANTENNA advantage, not a chipset one — this unit removes the
> one measured reason the Zephyr lost on RX, so the "open controller + deep floor" combination now
> exists in one dongle. The timing goal is unchanged and is the still-open half of Task 1: a
> **radio-event timestamp** (`RADIO->EVENTS_END` → PPI → `TIMER` capture on the dongle's own crystal,
> ~µs) on every ACL/adv PDU, in place of host stamps that carry 0.1–0.47 s delivery jitter — which is
> the entire reason `hostAxis` needs a width-21 median. Pre-stated bands for the first comparison
> (Task 2 against one beacon, same night, both radios): controller-stamp inter-arrival spread on a
> fixed-interval advertiser **< 2 ms** ⇒ the instrument is real and `quality.timingSource` gains a
> `radio` value; **2–50 ms** ⇒ it is a better host stamp, not a new clock, keep the median; **> 50 ms**
> ⇒ the timestamp is being taken above the radio and the build is wrong. External antenna is
> receive-side only; it does not authorise any new write to a device (§🔒, standing).

### Task 1 — FLASH (physical, rig-side, owner)
Build Zephyr `hci_usb` (or `hci_uart`) with **controller-side ACL packet timestamping** enabled and a
**fixed static address** baked in (`CONFIG_BT_CTLR_*` / settings), flash on the rig via the cased
GeeekPi nRF52840 twin. Controller timestamps sit one layer below kernel HCI timestamps (which need
`CAP_NET_RAW` and carry host-scheduler jitter) — the cleaner arrival-time source the drift work wants.
Verify the Zephyr version is current (old builds had the 30 s-disconnect bug).

### Task 2 — JITTER PROBE (software, ~1 h, non-disruptive)
A tool (`tools/ble-jitter-probe.mjs` or capture-host sibling) that runs `btmon` on a chosen adapter
during a passive scan, extracts the per-advertisement HCI timestamp, and reports inter-arrival jitter
per device. Answers: this radio's delivery-jitter floor (the `spreadMs` / connection-interval
quantization `hostAxis` reasons about), and — run on Zephyr vs Realtek against the same beacon — the
radio-induced timing delta in isolation. Runs on the FREE adapter (hci2), touches neither capture nor
the Realtek. Honest scope: measures the host-side stack until Task 1 lands the controller-side source.

**Do them together** — the probe is the analysis tool for the flash's new timestamp source, so pairing
them means the instrument arrives with its instrument-reader. Neither blocks the mutation programme;
this is a deliberate daytime session, not an interrupt.

## Also on the shelf (lower priority)
- Second-radio simultaneous capture (same sensor on Realtek + Zephyr → radio timing delta for the
  reference-free σ work) — needs the Zephyr bonded, i.e. a maintenance window.
- Sniffer reflash for O2Ring/Polar protocol reverse-engineering (mutually exclusive with HCI mode).
- Sena UD100-G03 (incoming) is the reliability-insurance capture swap, A/B'd over nights vs the
  Realtek only IF its intermittent hangs become annoying — not a Zephyr concern.
