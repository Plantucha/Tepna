<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS (2026-09-12, Kestrel: TX raised to +20 dBm at the antenna and the public address moved into firmware (`F4:CE:36` + FICR) on the `hci_uart` image — `hciuart-txpwr20-pub.zip` flashed to all three units 20:39, `F4:CE:36:` addresses verified; Polar re-pair pending; full configuration + recipe in `NRF52840-DONGLE-FLASHING-2026-09-07-BRIEF.md` §0b, the why in § "2026-09-12" below. Previously: Task 1 remainder picked up 2026-09-07 → `RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md` — the SDC anchor-point report is the controller-side timestamp source; image built, reflash pending; parked 2026-09-02 — drain triage, Kestrel: the remainder is ON-BOX HARDWARE work — controller-side timestamping is a rebuild+reflash of the dongle (owner, rig-side) and the Task 2 jitter probe needs `btmon` with `CAP_NET_RAW` on vigil's free adapter, a daytime paired session the brief itself says not to run as an interrupt; nothing is blocked on repo code. Owner: Heron with the owner present; next step: Task 2 on hci2 against one beacon, Zephyr vs Realtek. Previously 2026-08-25: Task 1 flash executed on the SDC path; timestamping + Task 2 probe still open) · **Created:** 2026-08-23

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
- 🟢 **THAT LAST BULLET IS NOW REFUTED — measured 2026-09-11, and the mechanism is the one §2 predicted.**
  The 08-23 comparison was a BARE nRF52840 against an externally-antenna'd Realtek, so it measured
  antennas, not radios — as the 2026-09-07 note above already said (*"the Realtek's −102 dBm floor was
  an ANTENNA advantage, not a chipset one"*). With the Holyiot-21017 hardware (external SMA + RFX2401C
  PA/LNA) on the FEM overlay, 40 s scans on rig-x870, counting only addresses that emit a live RSSI
  update so BlueZ cache replay cannot inflate them:

  | adapter | live peers | median RSSI | AS11 sightings |
  |---|---|---|---|
  | Realtek (control) | 22 | **−95** | 8 |
  | `99:67:24:2E:CD:98` | 82 | −66 | 66 |
  | `21:BF:D5:80:09:C0` | 44 | −59 | 24 |
  | `E7:FC:6D:6B:A4:4E` | 96 | −68 | 19 |

  ~30 dB better than the Realtek on median RSSI, on all three. **So the Zephyr IS a capture upgrade
  once it has the antenna and the front end** — and the CPAP, which the Realtek hears at the noise
  floor, sits at −53…−73 on these. One of them then opened the AS11 link unbonded (5 services / 14
  characteristics) through `_cpap_ble_connect`'s transport.
  ⚠️ **The FEM is not optional and its absence is silent.** The same units WITHOUT the overlay measured
  **0, 7 and 16 peers** — `vigil-holyiot21017.overlay` exists because the Raytac board parks the FEM in
  TX with the LNA off, and the deaf radio looks exactly like a distant one. `NRF52840-DONGLE-FLASHING`
  §troubleshooting already names this ("HCI up, address correct, hears ~0–1 devices at −90: FEM"); read
  that row before theorising about range, as this session failed to.

## Task 1's FIRMWARE CHOICE settled 2026-09-11 — `hci_usb` cannot serve capture; `hci_uart` over CDC can

⚠️ **SCOPE, because the first version of this heading said "Task 1 CONCLUDED" and that was an overreach
(Brief runner, same night).** This settles ONE open sub-item — which HCI transport the firmware uses —
and nothing else. It does not conclude Task 1, whose other remainders stand unchanged, and it does not
touch **Task 2**: the jitter probe is passive `btmon` sniffing, which establishes no connections and is
therefore untouched by a concurrency defect in connection establishment. This brief already said both
things ("*Still open from Task 1: … a multi-connection STREAMING soak (the scan proves RX only). Task 2
(jitter probe) untouched*") — so the soak named as UNPROVEN below is **that** soak, not a new finding,
and a reader must not retire a probe that still works on the strength of this section.

🔴 **THE FAILURE, on vigil, with all three sensors configured onto a Zephyr.** Two devices connecting at
once produced **one link with an EMPTY GATT snapshot** (`services=0`, the `no oxyii chars` /
`failed to discover` signature) and one `org.bluez.Error.InProgress`; then `0x200c` (LE Set Scan Enable)
stopped returning (`-110`, repeating every 2 s); then the wedge went **sticky** — sequential connects
afterwards failed too; then **`HCI Reset` (`0x0c03`) itself timed out at `-110`**; and a USB
de/re-authorize did not restore it. The devices stayed enumerated on the bus (`authorized=1`,
`lsusb` fine) while creating **no HCI device at all** — dead at the HCI layer, alive at USB.

**THE ELIMINATION CHAIN, so nobody re-walks it:**

| hypothesis | verdict |
|---|---|
| `CONFIG_BT_MAX_CONN` too low | **refuted** — it is 6, same as every prior build |
| BlueZ GATT cache not in effect | **refuted** — `Cache = always` at `main.conf:264`, bluetoothd started 09-10 21:02, *after* the 09-09 21:18 edit |
| rapid scan enable/disable | **refuted** — 6 paced cycles, 284 live RSSI samples, **0** errors |
| `CONFIG_BT_CTLR_PRIVACY=n` (our change) | **refuted** — the idle sibling ran the same image with 0 errors until it was asked to connect |

**It is the TRANSPORT, and upstream has it.** `zephyrproject-rtos/zephyr#18583`: connecting a second
peripheral *while the first is exchanging data* fails **~75 %** of the time, and either the new
connection fails **or the existing peripheral's reads stop** — and enabling `BT_DEBUG` makes it
irreproducible, i.e. a timing-sensitive race. Closed with no visible fix. Siblings: #23280 (cannot
connect to two devices), #40776 (drops after 30 s), #34593 (BlueZ), #10678 (timeout during BlueZ init),
#34659 (`k_sem_take` failures under multiple connections). ⚠️ The frequently-quoted line *"HCI over USB
is unstable by design — use UART or SPI"* is from a DevZone thread this session did **not** open; the
sample README carries no such disclaimer. Cite #18583, which was read at source.

**THE REPLACEMENT, built and measured.** `hci_uart` over USB CDC ACM — the sample README's own
§"Using a USB CDC ACM UART" — which this board already supports: `raytac_mdbt50q_cx_40_dongle` includes
`boards/common/usb/cdc_acm_serial.dtsi`, choosing `zephyr,bt-c2h-uart = &board_cdc_acm_uart`. Image:
`/srv/data/ncs/vigil_hciuart_holyiot21017_anchor_nopriv_dfu.zip` (155 902 B, sha256 `2012ddc2e448dc8dcebb…`),
carrying `MPSL_FEM=y` · anchor report `=y` · `BT_CTLR_PRIVACY` unset · `BT_MAX_CONN=6`. Only **24**
Kconfig lines differ from the `hci_usb` build and every one is USB-class plumbing — **nothing
address- or controller-related**, which is what makes the transport the isolated variable.

| | old `hci_usb` | new `hci_uart` |
|---|---|---|
| GATT discovery | `services=0` | **5 services / 14 chars**, repeatably |
| after a failed connect | never recovered | **recovered unaided** (cycle 1 timed out, 2 and 3 clean) |
| `-110` / tx timeout | yes, then unrecoverable | **0** |
| adapter afterwards | DOWN; `HCI Reset` timed out | **UP RUNNING** |
| scanning | fine | fine — 33 peers, 0 errors |

⚠️ **STILL UNPROVEN: the concurrency bug itself.** Two simultaneous connects is what killed `hci_usb`,
and the rig has no authorised pair of peripherals — the sensors live on vigil. Everything above is
"the transport carries GATT and survives repeated use", NOT "the race is fixed". Do not deploy on the
strength of this table. Note also `CONFIG_USB_DEVICE_STACK_NEXT=y` is still set: USBD-next still provides
the CDC function, so this removes the `hci_usb` class driver from the path, not the USB stack.

### Bring-up: THREE identities per dongle, none derivable from the others

The adapter is no longer auto-created. Per dongle: `btattach`, write the address, cycle.

| DFU-mode USB serial | application-mode USB serial | BD address |
|---|---|---|
| `E1BFD58009C0` | `E8724F4F4D09CE57` | `21:BF:D5:80:09:C0` |
| `D967242ECD98` | `B1BAA52EE6EDB771` | `99:67:24:2E:CD:98` |
| `E7FC6D6BA44E` | `9D08E454B242A0BF` | `E7:FC:6D:6B:A4:4E` |

🔴 **The USB serial CHANGES between DFU and application mode on the same hardware** — measured on all
three. The BD address is the only identifier stable across a mode change AND a firmware change, which
is why §2's "name the adapter by ADDRESS" is the rule that survives a reflash. The DFU serial's last
five bytes do match the BD address, but the top byte does **not** transform consistently
(`E1`→`21`, `D9`→`99`, `E7`→`E7`): a lookup, never a formula.

```sh
btattach -B /dev/ttyACM<n> -S 1000000 &          # resolve <n> by APPLICATION-mode USB serial
hcitool -i hciN cmd 0x3f 0x006 <addr, LITTLE-ENDIAN>   # 0xFC06 SDC_HCI_OPCODE_CMD_VS_ZEPHYR_WRITE_BD_ADDR
hciconfig hciN down && hciconfig hciN up         # BlueZ caches BD_ADDR at init; this re-reads it
```

- **The address write is REQUIRED, not cosmetic.** Fresh from `btattach` the controller reports
  `00:00:00:00:00:00`, and `capture._addressable()` REFUSES that — the daemon would exclude the adapter
  entirely. `btmgmt public-addr` is rejected `0x0b` (it needs the controller powered down); `0xFC06`
  is accepted with status `00`.
- **Ask the CONTROLLER, not `hciconfig`, when checking.** After the write, `hcitool cmd 0x04 0x09`
  (Read BD_ADDR) returned the new address while `hciconfig` still showed zeros — BlueZ's cached view.
  The `down`/`up` reconciles them, and the address **survives the HCI Reset** that `up` issues
  (predicted otherwise; measured, and the prediction was wrong).
- ⚠️ **Persistence across a REPLUG is untested.** It is a runtime vendor write, the same class as the
  anchor enable that does not survive a controller reset — so assume the unit must set it on every
  attach until someone measures otherwise.
- 🟢 **Superseded 2026-09-12** — the address is now written by the firmware itself on every boot
  (next section); the `0xFC06` recipe above stays as the stopgap for an unpatched image.

## 2026-09-12 — the Polars would not connect: TX power raised, public MAC moved into firmware

The 09-11 measurements above are all **receive** side: the dongle hears the Polars at −59…−68. The
Polars still failed to *connect* to it on vigil. Two causes, one on each side of the link:

- **(B) host side — kernel address ≠ BlueZ identity**, fixed in `capture-host` (#2422, merged): on
  these dongles `bluetoothctl select <kernel address>` fails *silently* onto the default controller,
  so pair/info/scan/watchdog repoints ran on the wrong adapter. `bonding.bluez_address()` +
  `select_line()` now front every entry point. A pure software defect; it stays fixed whatever the
  firmware does — and once the firmware registers a valid public address the two addresses coincide
  and the mismatch it guards against no longer arises.
- **(A) radio side — the dongle transmits at 0 dBm into a peripheral with a tiny antenna.** RX is
  asymmetric: a 22 dB PA + 12 dB LNA behind an SMA antenna hears a Polar at −60, but the Polar
  hears a 0 dBm dongle no better than it heard the Realtek. Measured as a control: the dongle's own
  advertisement, received on vigil's second adapter, sat at **−86 dBm** under the 0 dBm image. The
  fix is `CONFIG_BT_CTLR_TX_PWR_ANTENNA=20` (18 first, then 20 — the Holyiot listing's maximum; the
  SDC subtracts the overlay's FEM gain, so the SoC itself runs ≈ −2 dBm, well under its +8 ceiling,
  and `SDC_LE_POWER_CLASS_1` is selected automatically). The `.config` of the 18 dBm build differs
  from the 09-11 image in **exactly those two lines**, so TX power is the isolated variable.
  **Pre-stated pass: ≥ −55 dBm on the same receiver.** Pending.

**Why the address moved into the firmware.** The 09-11 bring-up wrote the raw FICR word as a public
address at runtime, and the value has bit 0 of its first on-air octet **set** on all three units
(`E1`/`D9`/`E7`) — a *group* address, invalid as a public identity, which is the mechanism behind the
"top byte transforms inconsistently" row above and behind BlueZ minting its own static-random
identity on some hosts. The `hci_uart` `main.c` now calls `bt_ctlr_set_public_addr()` after
`bt_enable_raw()` with **Nordic's OUI `F4:CE:36` + the low 24 bits of FICR `DEVICEADDR[0]`** — a
globally-administered unicast address, unique per die, the same on every host, no NVS, no runtime
write. It survives `HCI_Reset` but not a power-cycle, which is why it is set in `main()` rather than
once. Expected: `E7FC6D6BA44E → F4:CE:36:6B:A4:4E`, `D967242ECD98 → F4:CE:36:2E:CD:98`,
`E1BFD58009C0 → F4:CE:36:80:09:C0` (the DFU serial's last three octets *are* the FICR tail).
**Cost:** BlueZ keys its store by address, so every bond to the old address is orphaned — the Polars
are re-paired once, by the owner, and #2422 becomes the safety net rather than the mechanism.

**State at the time of writing.** `hciuart-txpwr20.zip` (TX only) is flashed on `E7FC6D6BA44E`;
`hciuart-txpwr20-pub.zip` (TX + address) is built and verified in `.config`, not yet flashed; all
three units sat in DFU mode on the rig at the last read. Build inputs are committed
(`capture-host/deploy/nrf52840/vigil-hciuart-holyiot-txpwr20.conf`, `vigil-hciuart-main.c.patch`);
the full recipe, the `.config` inventory, the vendor-command capability list and the recommended
*next* image (`SDC_QOS_CONN_EVENT_REPORT` + `SDC_QOS_CHANNEL_SURVEY` → per-channel PER/energy sidecar)
are in the flashing brief §0b and are not repeated here.

**Can the dongle be disciplined by the LAN stratum-1? No — referenced, not steered.** vigil is
stratum 2 off `192.168.0.123` (offset +49 µs, root delay 0.45 ms, skew 0.033 ppm, measured
2026-09-12), so the *host* axis is as good as this project will ever need. The dongle has no path to
follow it: a free-running 32 MHz HFXO, a 50 ppm LFXO, no network, no PPS input. What the instrument
does is what §7 of the Clock Contract already describes — the SDC's anchor-point reports are paired
with host `CLOCK_REALTIME` at delivery, so every radio event is *placed on* the host axis with a
residual equal to USB CDC delivery jitter (~0.1–1 ms, median-filtered), and the drift of the radio
crystal is measured against the host rather than removed. That is the `radio_clock` sidecar
(RADIO-CLOCK-SIDECAR brief; enabling it on vigil is owner-gated). Hardware discipline — a PPS edge
from the stratum-1's GNSS into a dongle GPIO, `TIMER` capture over PPI at 62.5 ns — is soldering and
an owner's deploy, and is not owed by anything the Polar problem needs.

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
