<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-23

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
