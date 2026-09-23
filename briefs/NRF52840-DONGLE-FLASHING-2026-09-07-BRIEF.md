<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-09-12: the image is now `hci_uart` over USB CDC ACM, TX +20 dBm at the antenna, public address derived in firmware (`F4:CE:36:` + FICR); `hciuart-txpwr20-pub.zip` flashed to all three units, `F4:CE:36:` addresses verified on rig-x870; units #1 + #2 live on vigil as hci0/hci3 via `tepna-btattach@` and hci0's ADV decoded on hci3 (−17/−18 dBm, near-field — see done-when); **live capture on hci0 since 21:36** — ring + Verity + H10 concurrently, both Polars re-bonded (H10 by the daemon itself, 14 min later), §0b "Live capture moved to hci0") · **Residue:** 2026-09-12-h10-rebond-waits-behind-psftp-sync · **Created:** 2026-09-07

# nRF52840 dongle flashing — the runbook for the NEXT adapter (Zephyr `hci_uart` over CDC ACM + SoftDevice Controller, fixed MAC)

> **2026-09-12 — READ §0b FIRST.** The `hci_usb` recipe below is the 09-07 state and is kept because
> every board fact in §1–§3 and §7 still holds. The *image* changed twice since: the transport moved to
> `hci_uart` over USB CDC ACM on 2026-09-11 (`hci_usb` wedges on concurrent connection establishment —
> ZEPHYR-INSTRUMENT § "Task 1's FIRMWARE CHOICE"), and on 2026-09-12 the TX power was raised and the
> public address moved from a host-side runtime write into the firmware. §0b is the current recipe;
> where §3–§5 say `hci_usb` / `vigil-sdc.conf` / `vigil-main.c.patch` / `2fe3:000b`, read §0b's
> replacements.

**Read this before touching a new dongle.** Two units have been flashed so far and each cost a
session-day to a failure that gave no error message: the first (Raytac, 2026-07-26) booted into
silence because the *regulator* config of the wrong board file collapsed the rail; the second
(Holyiot-21017, 2026-09-07) flashed, enumerated, brought up HCI with the right address — and heard
**one** device, because its PA/LNA sat in TX mode on two pins the board file had given to a UART.
Both were settled by the same thing: **the schematic, read before the build.** The third adapter is on
its way. This brief is so that it takes one pass.

Companion: [`ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md`](ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md) (why the
dongle exists — the open, reflashable timing instrument; radio-timestamp bands) and
`capture-host/deploy/flash-nrf52840-hci.sh` (the vanilla-Zephyr-LL build path and its BOARD warning).
The files this brief builds from are committed under **`capture-host/deploy/nrf52840/`**.

---

## 0 · The one-page procedure

1. **Identify the board** (§1). Vendor + model + schematic. Do not build until you know: regulator
   mode, FEM present/pins, LFXO present, LED pins, DFU entry. `lsusb -v` gives the USB serial (= the
   last 6 hex of the FICR address, useful later) and tells you which firmware it ships with (§2).
2. **Pick the Zephyr board target + overlay** (§3). So far every unit maps onto
   `raytac_mdbt50q_cx_40_dongle/nrf52840` plus a per-unit overlay. If the schematic shows DC/DC
   inductors, that changes (§7).
3. **Build in the NCS workspace on rig-x870** (§4) with `vigil-sdc.conf` + `vigil-main.c.patch` +
   the unit's overlay. Check the generated `.config`/`zephyr.dts` for the three tells before packaging.
4. **Package** (§4) → `nrfutil nrf5sdk-tools pkg generate --hw-version 52 --sd-req 0x00 …`.
5. **Enter DFU** (§5): magnet / button while plugging in → red LED → `1915:521f Open DFU Bootloader`
   → `/dev/serial/by-id/usb-Nordic_Semiconductor_Open_DFU_Bootloader_<serial>-if00`.
6. **Flash** (§5) → `nrfutil nrf5sdk-tools dfu usb-serial -pkg <zip> -p <by-id port>` → "Device programmed."
7. **Verify** (§6): `2fe3:000b`, `hciconfig` shows the FICR-derived address (not `00:…`), and a
   **paired scan against hci0** hears at least as many devices. One device at −90 is the FEM tell.
8. **Record the unit** in §8's table and pin its address in `config.yaml` (owner-authorised deploy).

---

## 0b · The CURRENT image (2026-09-12): `hci_uart` over CDC ACM · +20 dBm · firmware-derived public MAC

Everything in this section was built on rig-x870 on 2026-09-12 and grep-verified in the generated
`.config`; what has **not** yet happened is marked *pending*. Three inputs, all committed under
`capture-host/deploy/nrf52840/`:

| input | file | what it does |
|---|---|---|
| Kconfig fragment | **`vigil-hciuart-holyiot-txpwr20.conf`** | `vigil-sdc.conf` (6 links · DLE 251 · 2M PHY · RSSI · LE_ENC · SDC TX/RX 6/6 · `BT_HCI_VS` · anchor-point report) **plus three lines**: `CONFIG_BT_CTLR_PRIVACY=n` · `CONFIG_CDC_ACM_SERIAL_PRODUCT_STRING="Zephyr HCI UART anchor np"` · `CONFIG_BT_CTLR_TX_PWR_ANTENNA=20`. The rationale for each is in the file's comments — read them before changing a value |
| source patch | **`vigil-hciuart-main.c.patch`** | `samples/bluetooth/hci_uart/src/main.c`: after `bt_enable_raw()`, registers a **public** BD address = Nordic OUI `F4:CE:36` + the low 24 bits of `NRF_FICR->DEVICEADDR[0]` via `bt_ctlr_set_public_addr()` (→ SDC `zephyr_write_bd_addr`). 12 added lines, no other change |
| device-tree overlay | `vigil-holyiot21017.overlay` | unchanged since 09-07 — `&uart0` off, `nrf_radio_fem` on P0.24/P0.22, 22/12 dB gains |

**Sample:** `zephyr/samples/bluetooth/hci_uart` — *not* `hci_usb`. The board's `cdc_acm_serial.dtsi`
already selects `zephyr,bt-c2h-uart = &board_cdc_acm_uart`, so no overlay change is needed for the
transport; the host sees a CDC ACM port, not an HCI device, and must `btattach` it (below).

**Build · package · flash** (rig-x870, NCS v3.4.0 workspace `/srv/data/ncs`, toolchain
`/srv/data/ncs-toolchains` — the same `toolchain-manager launch` form as §4; `ncs` below stands for
`nrfutil toolchain-manager launch --install-dir /srv/data/ncs-toolchains --chdir /srv/data/ncs --`):

```sh
cd /srv/data/ncs
git -C zephyr apply <repo>/capture-host/deploy/nrf52840/vigil-hciuart-main.c.patch   # once; `git -C zephyr diff --stat samples/bluetooth/hci_uart` must show main.c +12
ncs west build -p always --sysbuild -b raytac_mdbt50q_cx_40_dongle/nrf52840 -d build-hciuart-holyiot-txpwr20-pub \
    zephyr/samples/bluetooth/hci_uart -- \
    -DEXTRA_CONF_FILE=/srv/data/ncs/vigil-hciuart-holyiot-txpwr20.conf \
    -DEXTRA_DTC_OVERLAY_FILE=/srv/data/ncs/vigil-holyiot21017.overlay
nrfutil nrf5sdk-tools pkg generate --hw-version 52 --sd-req 0x00 --application-version 1 \
    --application build-hciuart-holyiot-txpwr20-pub/hci_uart/zephyr/zephyr.hex hciuart-txpwr20-pub.zip
# magnet → red LED → 1915:521f → by-id port (NEVER "first ttyACM": ttyACM0 on the rig is the u-blox GNSS)
nrfutil nrf5sdk-tools dfu usb-serial -pkg hciuart-txpwr20-pub.zip \
    -p /dev/serial/by-id/usb-Nordic_Semiconductor_Open_DFU_Bootloader_<DFU serial>-if00
```

Last build: FLASH 155 540 B (14.89 %), RAM 59 656 B (22.76 %). The one warning —
`unit address and first address in 'reg' (0xf0000) don't match for … partition@dc000` — is the
board's own partition map and is benign. `nrfutil` prints an "unsigned package" banner; also benign.
Zips on the rig: `hciuart-txpwr20.zip` (sha256 `655b9cc565d3c33f…`, TX only — **flashed** to
`E7FC6D6BA44E` 2026-09-12) and `hciuart-txpwr20-pub.zip` (sha256 `84c4d508cc9e2ded…`, TX + public
address — **flashed to all three units 2026-09-12 20:39**; each came up with exactly its expected
`F4:CE:36:` address after `btattach`, measured on rig-x870, see §8). Earlier: `vigil_hciuart_holyiot21017_anchor_nopriv_dfu.zip`
(2026-09-11, 155 902 B, sha256 `2012ddc2e448dc8d…`, 0 dBm, no address patch — the image the three
units ran for the 09-11 measurements).

**The tells for THIS image** (replace §3's four; each was verified on `build-hciuart-holyiot-txpwr20-pub/hci_uart/zephyr/.config`):

```sh
B=build-hciuart-holyiot-txpwr20-pub/hci_uart/zephyr
grep -E '^CONFIG_(MPSL_FEM|MPSL_FEM_SIMPLE_GPIO|BT_CTLR_SDC_LE_POWER_CLASS_1)=y' $B/.config   # 3 lines: FEM wired, class-1 power
grep -E '^CONFIG_BT_CTLR_TX_PWR_ANTENNA=20' $B/.config                                        # the antenna figure, not the SoC one
grep -c 'BT_CTLR_PRIVACY is not set' $B/.config                                               # 1 — the 0x202d wedge fix
grep -E '^CONFIG_CLOCK_CONTROL_NRF_K32SRC_XTAL=y' $B/.config                                  # schematic has Y2
git -C zephyr diff --stat samples/bluetooth/hci_uart                                          # main.c | 12 ++++++++++++
```

Measured fact worth keeping: the `.config` of the first TX-raised build (18 dBm) differs from the
09-11 `nopriv` build in **exactly two lines** — `CONFIG_BT_CTLR_TX_PWR_ANTENNA 0→18` and
`CONFIG_BT_CTLR_SDC_LE_POWER_CLASS_1 n→y` (the second is selected automatically by the first). Nothing
else in the controller moved, so any behaviour change between those images is TX power.

**What the verified `.config` carries** (the inventory, so nobody re-greps it): `BT_LL_SOFTDEVICE=y` ·
`BT_HCI_RAW=y` · `USB_DEVICE_STACK_NEXT=y` (USBD-next still provides the CDC function) · `MPSL_FEM=y`
+ `MPSL_FEM_SIMPLE_GPIO=y` · `BT_CTLR_TX_PWR_ANTENNA=20` + `SDC_LE_POWER_CLASS_1=y` · `BT_CTLR_PRIVACY`
unset · `PHY_2M=y` · `PHY_CODED=y` · `BT_MAX_CONN=6` · `SDC_PERIPHERAL_COUNT=1` (5 central + 1
peripheral; 0 is refused by SDC's BUILD_ASSERT) · `DATA_LENGTH_MAX=251` · `BT_BUF_ACL_TX_COUNT=12` ·
`BT_BUF_EVT_RX_COUNT=16` · `SDC_TX/RX_PACKET_COUNT=6/6` · `CONN_RSSI=y` · `LE_ENC=y` · `BT_HCI_VS=y` ·
`SDC_CONN_ANCHOR_POINT_REPORT=y` · `SDC_CENTRAL_ACL_EVENT_SPACING_DEFAULT=7500` ·
`SDC_MAX_CONN_EVENT_LEN_DEFAULT=7500` · `SDC_CONN_EVENT_EXTEND_DEFAULT=y` ·
`CLOCK_CONTROL_NRF_K32SRC_XTAL=y` (`ACCURACY=50` ppm) · `MPSL_HFCLK_LATENCY=1400`. **Not set:**
`TX_PWR_DYNAMIC_CONTROL`, `SDC_QOS_CONN_EVENT_REPORT`, `SDC_QOS_CHANNEL_SURVEY`, `LE_POWER_CONTROL`,
`ADV_EXT`, `SUBRATING`, `SDC_LLPM`, `DF`, `SDC_ALLOW_PARALLEL_SCANNING_AND_INITIATING`.

**TX power, what the number means.** `TX_PWR_ANTENNA` is the figure *at the antenna*; the SDC
subtracts the overlay's 22 dB FEM TX gain to set the SoC (so +20 at the antenna is ≈ −2 dBm from the
nRF52840, whose own ceiling is +8). The RFX2401C listing tops out around +20–22 dBm, so 20 is the
board's number, not a tuning choice; 18 was flashed first as the step below it. **This changes §10's
FCC line** — we no longer run the stock 0 dBm-into-PA configuration; raising it was the owner's act.
Why raise it at all: RX on these units is ~30 dB better than the Realtek (§6 / ZEPHYR-INSTRUMENT), but
the *peripherals* have to hear the dongle too, and the small-antenna Polars did not connect. The
pre-stated pass criterion: the dongle's own advertisement heard on vigil's second adapter at
**≥ −55 dBm** (the 0 dBm image measured **−86** there). *Pending.*

**Public address, why in firmware now.** The SDC ships no factory public address. Under the 09-11
image the adapter came up from `btattach` with no usable BD address and needed a runtime
`0xFC06` vendor write per attach (ZEPHYR-INSTRUMENT § "Bring-up"); the value written there — the raw
FICR word — has bit 0 of its first on-air octet **set** on all three units (`E1`, `D9`, `E7` are all
odd), i.e. a *group* address, which is not a valid public identity and is consistent with the
per-unit top-byte mutation that section recorded as "a lookup, never a formula". The patch instead
composes a globally-administered unicast address: **`F4:CE:36` (Nordic's OUI) + the low 24 bits of
FICR `DEVICEADDR[0]`** — the same three octets that end the DFU-mode USB serial, so the expected
address is readable off the by-id port *before* the flash:

| DFU serial | expected public address after `-pub` |
|---|---|
| `E7FC6D6BA44E` | `F4:CE:36:6B:A4:4E` |
| `D967242ECD98` | `F4:CE:36:2E:CD:98` |
| `E1BFD58009C0` | `F4:CE:36:80:09:C0` |

It is written every boot (the SDC keeps it across `HCI_Reset` but not a power-cycle — hence in
`main()` after `bt_enable_raw()`, once `sdc_enable` has run), so the host-side `0xFC06` + `down`/`up`
dance is no longer needed. Consequence to plan for: BlueZ keys its adapter directory by address, so
each unit gets a **fresh identity store** on first attach — every peripheral bonded to the old
address must be **re-paired** (owner's act; the bond-selection fix that reads the kernel's address
rather than BlueZ's, #2422, is then the safety net, not the mechanism). *Pending: `hciconfig` on the
host must show the table's value with no vendor write issued.*

**Host bring-up under `hci_uart`** (per attach; the port is a CDC ACM device, product string
`Zephyr HCI UART anchor np`, found by its *application-mode* USB serial — which differs from the DFU
serial, §8):

```sh
btattach -B /dev/ttyACM<n> -S 1000000 &   # <n> resolved by application-mode USB serial (udevadm/lsusb -v), never by index
hciconfig hciN                            # expect F4:CE:36:… — no 0xFC06 write
```

`hciconfig -a` still prints `Can't read local name … (5)` — LE-only controller, benign (§2). On vigil,
attaching is one thing and *using* is another: making it the capture adapter is `config.yaml` by
address + a daemon restart = owner deploy (§9), and installing a `btattach` unit on the box is the
same class of change.

**Controller capabilities compiled in (`BT_HCI_VS=y`, SDC vendor set) — what the image can be asked
without another flash:** `zephyr_write_bd_addr` · `read_static_addresses` · `read_chip_temp` ·
`write/read_tx_power` (per-role/handle, within the class-1 ceiling) · `conn_event_extend` ·
`read_average_rssi` · `central_acl_event_spacing_set` · `event_length_set` · `scan_channel_map_set`
· `set_power_control_request_params` · `conn_anchor_point_update_event_report_enable` (the
RADIO-CLOCK-SIDECAR source) · `transmitter_carrier_test` · `set_adv_randomness` ·
`get_next_conn_event_counter`. **Needs a flash to enable:** `SDC_QOS_CONN_EVENT_REPORT` (per
connection event: `crc_ok`/`crc_error`/`nak`/`rx_timeout` **per channel**) and `SDC_QOS_CHANNEL_SURVEY`
(`int8_t channel_energy[40]`) — together they are a per-night, per-channel PER/energy sidecar, and
with `LE Set Host Channel Classification` a way to steer a link off a jammed channel. That is the
recommended *next* image once the `-pub` one is verified; do not fold it into this flash, or the TX
and address changes stop being isolated variables. Not worth chasing on this hardware: LLPM, ISO /
periodic advertising / direction finding, subrating, LE Power Control, extended advertising.

**Clock: the dongle is referenced, never steered.** vigil's `chrony` is stratum 2 off the LAN
stratum-1 server (`192.168.0.123`; measured 2026-09-12: offset +49 µs, root delay 0.45 ms, skew
0.033 ppm, frequency 4.0 ppm; NTS pool fallbacks), and the dongle has no input that could follow it —
a free-running 32 MHz HFXO plus the 50 ppm LFXO, no network, no PPS pin wired. So the radio clock is
*placed on* the host axis (SDC anchor-point reports paired with host `CLOCK_REALTIME`, `hostAxis` /
`radio_clock` — enabling the latter on vigil is owner-gated) with a residual set by USB CDC delivery
jitter (~0.1–1 ms, median-filtered per CLAUDE.md §🔒 7), not disciplined to it. True hardware
discipline would be a PPS edge into a dongle GPIO with `TIMER` capture over PPI (62.5 ns) — soldering
and an owner's deploy, not a config line. See ZEPHYR-INSTRUMENT § "2026-09-12".

**Live capture moved to hci0 (2026-09-12 21:36, owner-ordered) — what the first hour measured.**
`config.yaml`'s adapter line was re-pinned from the Sena (`00:01:95:CC:53:02`, hci1) to unit #1
(`F4:CE:36:2E:CD:98`, hci0) and the daemon restarted 21:36:53. Outcome, read off the box:

- **Three peripherals concurrently on one Zephyr link, held.** Ring connected 21:37:25 and *resumed*
  its file-set `20260912205935` (gap < 300 s — #2418's guard, live); Verity bonded fresh on hci0 and
  resumed `20260912181913` (acc 52 Hz · ppg 55 Hz/22-bit/4-ch · ppi); H10 streaming ECG+ACC from
  21:51:05. `hcitool -i hci0 con` = 3 LE links at 21:55. The `BT_MAX_CONN=6` budget is real.
- **Bonds are per-adapter in BlueZ, and that is the whole H10 story.** The Verity re-paired on the
  first connect; the H10 did not, because it *requests* security: btmon on hci0
  (`probe-h10-hci0-20260912T214207.btsnoop`, 60 s, 4 cycles) shows connect → LE features → MTU →
  service discovery → H10 `SMP: Security Request` → box `SMP: Pairing Failed, Reason: Pairing not
  supported (0x05)` (hci0 is `Pairable: no` and holds no LTK for it) → PMD writes return nothing →
  daemon `MGMT Disconnect` ~2 s in → `Disconnect Complete, Reason: Connection Terminated By Local
  Host (0x16)`. Not radio, not the connection limit — the reason code says *we* hung up.
- **The daemon healed it itself, 14 min later.** `capture.py`'s re-bond gate fires only every
  `_REBOND_EVERY = 5` iterations, and each iteration first burns the PS-FTP clock auto-sync
  (120 s budget, up to 12 `NotConnected` retries — "gave up after 129s of a 120s budget") before
  `_connect` runs, so the first `BlueZ reports no bond — re-pairing (attempt 1/72)` landed at
  21:50:40 and `re-bonded — PMD should hold again` at 21:51:03; `Paired/Bonded/Connected: yes` on
  hci0 by 21:55. No manual pair was needed. The cost (bond checked *after* a sync that needs the
  bond, ×5) is residue `2026-09-12-h10-rebond-waits-behind-psftp-sync`.
- **Delivery jitter, first look — NOT a result** (`jitterfloor.stream_jitter` half-IQR, host-minus-
  device per PMD frame, the SENA-VS-UB500-JITTER §2 method; Zephyr window 17.6 min, unmatched,
  no pre-stated bands): H10 ecg **25.0 ms** (n=483, folded) · H10 acc 25.0 (n=1528) · Verity ppg
  60.5 (n=1522) · Verity acc 210.2 · ring 38.0. Against that brief's window-matched baselines
  (H10 ecg 22.5 UB500 / 29.5 Sena) the Zephyr sits in the normal band. Tonight's own Sena window
  (19:10–21:36) read 115 ms on H10 ecg and is *not* a baseline — it carried 6 link errors and 39
  offline-op cycles. The comparison worth quoting is that brief's §8 on the next full night,
  window-matched against 08-22/23/24.
- **Still pending:** the ≥ −55 dBm criterion above in the −86 baseline's geometry (the −17/−18 dBm
  read on hci3 is near-field, see done-when). Both Polars connecting tonight does not discriminate
  either — they also held on the Sena earlier the same evening; the +20 dBm gain shows only in a
  night where the 0 dBm image failed and this one does not.

## 1 · Identify the board FIRST — the checklist that would have saved both days

The nRF52840 is the same on every dongle; the *board* is everything around it, and the build encodes
the board. Get these five facts from the vendor schematic (ask the seller — Holyiot published theirs;
Raytac's is in their datasheet). If there is no schematic, get the module marking off the can and a
photo of both PCB sides.

| fact | why it matters | how it failed here |
|---|---|---|
| **Regulator: DC/DC inductors populated or not** | `&reg0` / `&reg1 regulator-initial-mode` in the board dts. Selecting DC/DC on a board without the inductors collapses the rail before USB comes up | 2026-07-26: `nrf52840dongle` image on a Raytac → total USB silence, no bootloader, no app. Reproduces with `blinky`. Flash-script header has the full post-mortem |
| **RF front-end (PA/LNA) and its control pins** | A FEM with TXEN/RXEN needs `radio-fem-two-ctrl-pins` in dts, or MPSL never drives it and the LNA is off; worse, the board file may pull those pins the wrong way | 2026-09-07: Holyiot's RFX2401C on P0.24/P0.22; Raytac board dts puts UART RX/CTS **with pull-ups** on exactly those pins → TXEN held high, LNA off, 1 device heard vs 26 on the Realtek |
| **32.768 kHz crystal present** | `CONFIG_CLOCK_CONTROL_NRF_K32SRC_XTAL` vs `_RC`. Without a crystal and with XTAL selected LFCLK never starts and the SDC hangs | Both units have Y2 + load caps on XL1/XL2 — XTAL is right. Ruled out on 2026-07-26 as the silence cause (`K32SRC_RC=y` did not help) |
| **LED pins** | Not functional for `hci_usb` (the sample drives none), but you WILL read "no LED" as "wrong firmware". Know whether the stock firmware blinked and this one is not supposed to | 2026-09-07: "no LED light" read as wrong board; LEDs are on the same pins as the Raytac. The stock connectivity firmware blinks; `hci_usb` does not. Expected, not a fault |
| **DFU entry method** | Open bootloader entry is per board: reset button, magnet (Hall switch), or the DFU-trigger USB interface of the stock firmware | Holyiot: magnet near the reset (`HX6383` Hall sensor → `Q1` → nRESET on the schematic); no button. Trigger-over-USB needs raw-USB write (`LIBUSB_ERROR_ACCESS` as a user) — use the magnet |

Also from the schematic, for the record: which nRF pins the FEM's ANT/bypass use (RFX2401C has none —
two-pin control only), and whether there is an antenna-select resistor (chip antenna vs SMA) — the
Holyiot has only the SMA path (`U2` RF coaxial connector via `L2`/`C15`/`C16`).

## 2 · What the dongle is running — the USB-ID state machine

| USB id | name in `lsusb` | what it is | how you get out of it |
|---|---|---|---|
| `1915:c00a` | nRF52 Connectivity | Nordic connectivity firmware (pc-ble-driver serialisation) — what the Holyiot ships with. Has a CDC port **and** a DFU-trigger vendor interface. `nrfutil … dfu usb-serial` on its CDC port answers `No Response: 0x00`: that port is not the bootloader | magnet/button while plugging in |
| `1915:521f` | Open DFU Bootloader | red LED; the only state that accepts a DFU package; port appears under `/dev/serial/by-id/…Open_DFU_Bootloader_<serial>-if00` | flash, or unplug |
| `2fe3:000b` | Zephyr USBD BT HCI | the **09-07 `hci_usb`** image. `btusb` binds it as `hciN`. **No trigger interface** — after this, the magnet is the only way back to DFU | magnet/button while plugging in |
| CDC ACM, product `Zephyr HCI UART anchor np`, `/dev/ttyACM*` | Zephyr CDC ACM | the **current `hci_uart`** image (§0b). A serial port, **no `hciN` until `btattach`**; its USB serial differs from the DFU one (§8). No trigger interface either | magnet/button while plugging in |
| `/dev/ttyACM*` only, `1915:520f`-ish | stock "nRF52 USB CDC BLE demo" (Raytac out of the box) | a serial port; BlueZ never sees it | reset-button DFU |

`hciconfig -a` prints `Can't read local name on hciN: Input/output error (5)` for the Zephyr image —
LE-only controller, no BR/EDR name. Benign; ignore it.

## 3 · Board target + overlay — what is known per unit

The build is the NCS `samples/bluetooth/hci_usb` sample with the SoftDevice Controller
(`CONFIG_BT_LL_SOFTDEVICE=y`), tuned by `vigil-sdc.conf` (6 links, DLE 251, 2M PHY, RSSI, encryption,
SDC TX/RX packet count 6) and patched by `vigil-main.c.patch` (FICR `DEVICEADDR` → public BD address,
so the MAC is fixed per chip and identical on every host). Both files are in `capture-host/deploy/nrf52840/`.

| unit | Zephyr board | overlay | notes |
|---|---|---|---|
| Raytac MDBT50Q-CX (USB-C, PCB antenna) | `raytac_mdbt50q_cx_40_dongle/nrf52840` | none | LDO only (`&reg0` disabled). Open bootloader stock. The 2026-08-25 fixed-address image (`vigil_sdc_fixedaddr_dfu.zip` on the rig, sha256 `8b72b996a3dbdb9b…`) |
| **Holyiot-21017** (SMA antenna, RFX2401C PA/LNA, magnet reset) | `raytac_mdbt50q_cx_40_dongle/nrf52840` | `vigil-holyiot21017.overlay` — `&uart0 status="disabled"` + `nrf_radio_fem` (`ctx-gpios` P0.24, `crx-gpios` P0.22, 5 µs settle, tx-gain 22 dB, rx-gain 12 dB) + `&radio { fem = … }` | LEDs P0.06 / RGB P0.08-P1.09-P0.12 (same as Raytac, same as PCA10059). LFXO present. Built 2026-09-07, `vigil_sdc_holyiot21017_dfu.zip` sha256 `f40b800d95baee46…`, FLASH 154 956 B |
| next adapter | **unknown until the schematic is read** | — | if it is another 21017, the Holyiot zip is reusable as-is (the address comes from FICR, not the image) |

Why the Raytac board file is the base even for the Holyiot: same Open-bootloader partition layout
(app at `0x1000`), same LDO-only regulator, same LED pins. The only things it gets wrong for the
Holyiot are the UART pins (fixed by the overlay) and the missing FEM (added by it). A dedicated board
definition would be cleaner and is not worth the maintenance for two units.

**The three tells to check in the build output before packaging** (each one was the whole bug once):

```sh
grep -E 'CONFIG_MPSL_FEM=y|CONFIG_MPSL_FEM_SIMPLE_GPIO=y' build-<unit>/hci_usb/zephyr/.config   # FEM wired (if the unit has one)
grep -E 'K32SRC_(XTAL|RC)=y' build-<unit>/hci_usb/zephyr/.config                                # matches the schematic
grep -n -A6 'nrf_radio_fem: fem' build-<unit>/hci_usb/zephyr/zephyr.dts                         # pins are the schematic's, not the board's
strings build-<unit>/hci_usb/zephyr/zephyr.elf | grep -c 'Public BD addr'                        # 1 ⇒ the fixed-address patch is in
```

## 4 · Build + package (rig-x870 only — the NCS workspace is not in the repo)

The workspace is **NCS v3.4.0** (`nrf` + `zephyr` + `nrfxlib` + `modules`) at `/srv/data/ncs`, with
the toolchain under `/srv/data/ncs-toolchains` (`nrfutil toolchain-manager`). The `hci_usb` sample
carries the fixed-address patch as an uncommitted working-tree change (`git -C /srv/data/ncs/zephyr
diff samples/bluetooth/hci_usb` shows it; re-apply from `vigil-main.c.patch` if the tree is ever reset).

```sh
cd /srv/data/ncs
# the overlay for the unit — copy from capture-host/deploy/nrf52840/ or write a new one per §1/§3
~/.local/bin/nrfutil toolchain-manager launch --install-dir /srv/data/ncs-toolchains --chdir /srv/data/ncs -- \
  west build -p always -b raytac_mdbt50q_cx_40_dongle/nrf52840 -d build-<unit> zephyr/samples/bluetooth/hci_usb -- \
    -DEXTRA_CONF_FILE=/srv/data/ncs/vigil-sdc.conf \
    -DEXTRA_DTC_OVERLAY_FILE=/srv/data/ncs/vigil-<unit>.overlay        # omit for a Raytac
# …the §3 tells…
~/.local/bin/nrfutil nrf5sdk-tools pkg generate --hw-version 52 --sd-req 0x00 --application-version 3 \
  --application build-<unit>/hci_usb/zephyr/zephyr.hex vigil_sdc_<unit>_dfu.zip
```

`--sd-req 0x00` because there is no SoftDevice *image* (the SDC is a linked library); `--hw-version 52`
is the family. It is a sysbuild tree, so the app lives at `build-<unit>/hci_usb/zephyr/`. Build time
≈ 1 min warm. `-p always` is deliberate: a stale `.config` from a different overlay is exactly the
class of silent failure this brief exists for.

Vanilla Zephyr (open-source LL, no SDC) is the other path — `capture-host/deploy/flash-nrf52840-hci.sh`,
with its own workspace and conf. It is what the 2026-07-26 Raytac ran before the SDC cutover; use it
only if the NCS workspace is gone. It has no FEM overlay and no fixed-address patch.

## 5 · Enter DFU and flash

1. **Tell the owner "magnet now"** (Holyiot) / hold the reset button while plugging in (Raytac). Red LED,
   `lsusb` shows `1915:521f`, and the by-id port appears. The window does not time out quickly, but a
   host re-enumeration (unplug) leaves it.
2. Flash by the **by-id** path, never `/dev/ttyACM0` (another CDC device can own that name):
   ```sh
   ls /dev/serial/by-id/            # usb-Nordic_Semiconductor_Open_DFU_Bootloader_<serial>-if00
   ~/.local/bin/nrfutil nrf5sdk-tools dfu usb-serial -pkg vigil_sdc_<unit>_dfu.zip \
     -p /dev/serial/by-id/usb-Nordic_Semiconductor_Open_DFU_Bootloader_<serial>-if00
   ```
   "Device programmed." then the dongle resets into the app on its own — `2fe3:000b` within ~3 s.
3. `dialout` membership is required for the port; the trigger path (`-snr`) is **not** usable as a user
   (`LIBUSB_ERROR_ACCESS`) and is not needed — the magnet replaces it.

Failure shapes, in the order to suspect them:
- **"Device programmed." then USB silence** (no `1915`, no `2fe3`): the app ran and died → **board/regulator**
  (§1 row 1). The bootloader rejecting an image stays at `1915:521f`; silence means control transferred.
- **`2fe3:000b`, HCI up, address correct, hears ~0–1 devices at −90:** **FEM** (§1 row 2). The image is
  otherwise right; fix the overlay and reflash.
- **`2fe3:000b` but `hciconfig` shows `00:00:00:00:00:00`:** the fixed-address patch is not in the
  image. BlueZ will invent a static-random identity **per host** — the address you pin on the rig is
  not the one vigil sees. Rebuild with the patch.
- **`hci_uart` image (§0b): "Device programmed." then no `hciN` at all** — expected; it is a CDC port
  now. `btattach` it. **`hciN` exists but the address is zeros or not `F4:CE:36:…`:** the `main.c`
  patch was not in the tree at build time (`git -C zephyr diff --stat samples/bluetooth/hci_uart`
  must show `+12`); the 09-11 `0xFC06` runtime write still works as a stopgap, but rebuild.
- **Reflashing a unit that already runs Zephyr:** there is no DFU trigger in either Zephyr image —
  magnet (Holyiot) / button-while-plugging (Raytac) is the only way back to `1915:521f`.
- **`No Response: 0x00`** from `dfu usb-serial`: you are talking to the *application's* CDC port, not
  the bootloader. Magnet.

## 6 · Verify — a paired scan, not a solo one

`hciconfig hciN` for `UP RUNNING`, the address, and `ACL MTU 251:6` (DLE in the controller). Then scan
**both** adapters back to back with the same code; the Realtek (hci0 on the rig) is the control. bleak
works without root:

```sh
capture-host/.venv/bin/python - <<'PY'
import asyncio
from bleak import BleakScanner
async def scan(a):
    seen = {}
    s = BleakScanner(lambda d, ad: seen.__setitem__(d.address, ad.rssi), bluez={'adapter': a})
    await s.start(); await asyncio.sleep(10); await s.stop(); return seen
async def main():
    s1 = await scan('hci1'); s0 = await scan('hci0')
    for n, s in (('hci1', s1), ('hci0', s0)):
        r = sorted(s.values()); print(n, len(s), 'devices, floor', r[0] if r else None, 'best', r[-1] if r else None)
    c = set(s0) & set(s1); d = sorted(s1[a] - s0[a] for a in c)
    print('common', len(c), 'hci1-hci0 RSSI median', d[len(d)//2] if d else None, 'dB')
asyncio.run(main())
PY
```

Measured 2026-09-07 on the rig, 10 s each:

| adapter | devices | floor | best | vs Realtek on the 22 common devices |
|---|---|---|---|---|
| Holyiot-21017, FEM enabled | **40** | −74 | −31 | **+35 dB** median |
| Holyiot-21017, FEM *not* driven (the first flash) | 1 | −90 | −90 | — |
| Realtek hci0 (external antenna) | 26 | −105 | −85 | 0 |
| Raytac (2026-08-22, on vigil) | 38–41 | −90/−91 | −35 | — |

⚠️ **RSSI is not comparable across adapters.** +35 dB is LNA gain plus antenna plus two different RSSI
calibrations; only the *device count* and the *floor* say anything about reach. Do not write "the
Holyiot is 35 dB better" anywhere.

`bluetoothctl select` does not reliably switch the scanning adapter — that is why the script pins
`bluez={'adapter': …}` and why `capture.py` pins by address.

## 7 · If the next unit is NOT a 21017

- **Nordic PCA10059 or a clone with DC/DC inductors:** board `nrf52840dongle/nrf52840` — and then the
  Raytac-based build is the one that fails silently (same failure, opposite direction). Confirm the
  inductors on the schematic/PCB before choosing.
- **A different FEM** (SKY66112, nRF21540): `nrf/dts/bindings/radio_fem/` has the bindings; the
  nRF21540 needs `nordic,nrf21540-fem` with CSD/CPS/MODE pins, not the two-pin node. Any FEM: check
  the board file's pinctrl for the FEM's pins (the UART trap) and disable whatever holds them.
- **No FEM, PCB antenna:** the Raytac build with no overlay; expect Raytac-class numbers (§6 table).
- **Module marking only, no schematic:** MDBT50Q → Raytac path; E73 → Ebyte (`ebyte/e73_tbb` exists
  in the tree as a reference for pins); Holyiot YJ-1x0xx modules → ask for the dongle schematic, the
  module datasheet does not carry the FEM wiring.

## 8 · Unit register — addresses are FICR-fixed, one row per physical dongle

| unit | DFU-mode USB serial (by-id) | app-mode USB serial (`hci_uart` CDC) | BD address written 09-11 (`0xFC06`, raw FICR) | **public address under `-pub` (MEASURED 2026-09-12, `hciconfig` after `btattach`)** | where (2026-09-12) | image |
|---|---|---|---|---|---|---|
| Holyiot-21017 #1 | `D967242ECD98` | `B1BAA52EE6EDB771` | `99:67:24:2E:CD:98` | `F4:CE:36:2E:CD:98` ✓ (rig hci1) | rig-x870 | `hciuart-txpwr20-pub.zip` **flashed** 09-12 |
| Holyiot-21017 #2 | `E7FC6D6BA44E` | `9D08E454B242A0BF` | `E7:FC:6D:6B:A4:4E` | `F4:CE:36:6B:A4:4E` ✓ (rig hci3) | rig-x870 → vigil (the capture candidate) | `hciuart-txpwr20-pub.zip` **flashed** 09-12 (over `hciuart-txpwr20.zip`) |
| Holyiot-21017 #3 | `E1BFD58009C0` | `E8724F4F4D09CE57` | `21:BF:D5:80:09:C0` | `F4:CE:36:80:09:C0` ✓ (rig hci2) | rig-x870 (control unit) | `hciuart-txpwr20-pub.zip` **flashed** 09-12 |
| Raytac MDBT50Q-CX | — | — | was `C6:CF:3C:4E:75:F0` (pre-fixed-address), then BlueZ static-random `FA:88:98:C3:7F:E5` (08-25) | not applicable until reflashed with §0b | moved to rig-x870 2026-08-25 (ZEPHYR-INSTRUMENT); not enumerated on vigil at the 09-12 read | `vigil_sdc_fixedaddr_dfu.zip` (2026-08-25, `hci_usb`) |

Under the 09-07 `hci_usb` patch the address was the low 48 bits of `NRF_FICR->DEVICEADDR`
registered verbatim as public. **That is superseded** (§0b): the raw word is a *group* address on
every unit seen (odd first octet), so the current patch composes `F4:CE:36` + the low 24 bits. Both
schemes are FICR-derived — the address does not change when BlueZ's identity store is wiped and is
the same on every host — and in both the DFU-mode USB serial's last three octets are the unit's
FICR tail, which is how a by-id bootloader port is matched to a physical dongle before it is flashed.
The *application-mode* serial is a different number (measured on all three) — match by DFU serial
or by address, never by the CDC serial alone, and never by `ttyACM` index.

## 9 · Moving a flashed dongle to vigil

Plugging it in changes nothing: it enumerates as another `hciN`, and `capture.py` only uses adapters
it is pinned to. Making it the capture adapter is `config.yaml` (adapter by **address**, never by
`hciN` index or local name — the standing BLE-identity ruling) and a daemon restart, i.e. an
**owner-authorised deploy** through the normal path. Before switching production capture onto it, the
ZEPHYR-INSTRUMENT brief's own caution still stands: the Realtek's −102 dBm floor was an antenna
advantage, and the Holyiot is the first Zephyr unit that closes that gap — run the paired scan **on
the box** (the RF environment differs from the rig) before deciding, and record the numbers there.

What the dongle does **not** do: it is receive-side and controller-side only. Nothing here authorises
a new write path to any device; the ring, the CPAP, and the Polars are talked to exactly as before.

## 10 · Links

- Holyiot-21017 schematic (vendor PDF, sheet `21017-52840+PA(RESET)`, 2021-05-11):
  <http://www.holyiot.com/tp/2021091017064271075.pdf> — the source of every pin in §3
- Holyiot product page: <http://www.holyiot.com/eacp_view.asp?id=336>; DFU manual (magnet procedure,
  nRF Connect screenshots) ships with the unit and is on manuals.plus under "Holyiot nRF52840+PA"
- FCC ID `2ALGY-21017` (the PA-equipped product as certified). ⚠️ **Since 2026-09-12 we no longer
  run the 0 dBm default** — §0b's image sets `CONFIG_BT_CTLR_TX_PWR_ANTENNA=20` (the listing's
  maximum; 18 was flashed first). Raising it was the owner's decision; this line used to say the
  stock configuration was in use and is kept so the change is visible.
- RFX2401C: two-pin control (TXEN, RXEN; both low = sleep), ≈ +22 dB PA / ≈ 12 dB LNA — the gains in
  the overlay
- Zephyr two-pin FEM binding: `zephyr/dts/bindings/net/wireless/radio-fem-two-ctrl-pins.yaml`;
  worked examples `zephyr/boards/ezurio/bl654_dvk/bl654_dvk_nrf52840_pa.dts` (SKY66112, 22/11 dB),
  `zephyr/boards/u-blox/ubx_bmd345eval/ubx_bmd345eval_nrf52840.dts`
- MPSL FEM Kconfig: `nrf/subsys/mpsl/fem/Kconfig` (`MPSL_FEM_SIMPLE_GPIO` is what the two-pin node
  selects; it is automatic once the `nrf_radio_fem` node exists)
- Raytac board: `zephyr/boards/raytac/mdbt50q_cx_40_dongle/` — the pinctrl that owns P0.20/P0.24
  (UART TX/RX) and P0.17/P0.22 (RTS/CTS) is the trap
- nrfutil: `nrfutil install nrf5sdk-tools` (DFU + pkg) and `nrfutil install toolchain-manager`
- Community threads confirming the 21017 is nRF52840 + PA + external antenna (no pinout in them):
  <https://github.com/kardia-as/nrf-zboss-ncp/issues/11>, <https://github.com/kardia-as/zigpy-zboss/issues/16>
- Radio-timestamp goal and the pre-stated Zephyr-vs-Realtek bands (<2 ms ⇒ real second clock;
  2–50 ms ⇒ better host stamp only; >50 ms ⇒ stamp taken above the radio): ZEPHYR-INSTRUMENT brief,
  Task 1 note of 2026-09-07

## Done-when (for the next unit)

- [ ] schematic (or module marking + PCB photos) read and the five §1 facts written into §3's table **before** the build
- [ ] build passes the four §3 tells
- [ ] flashed by the by-id bootloader port; `2fe3:000b`; `hciconfig` shows a non-zero address
- [ ] paired scan (§6) recorded in the §6 table; device count ≥ the Realtek's or the reason is written down
- [ ] §8 row added with the FICR address; the address — not an `hciN` — is what gets pinned on the box

**Done-when for the 2026-09-12 image (§0b):**

- [x] `hciuart-txpwr20-pub.zip` flashed to `E7FC6D6BA44E`; after `btattach`, `hciconfig` shows
      `F4:CE:36:6B:A4:4E` with **no** `0xFC06` write issued (2026-09-12 20:40, rig-x870; ACL MTU 251:6)
- [x] survives a replug (power-cycle) — 2026-09-12 20:53: all three units re-enumerated on NEW ttys (ACM3/4/5 → 6/7/8)
      and came back with identical addresses after `btattach` by USB serial. ⚠️ `btattach` does NOT exit when its tty
      vanishes — six stale ones were found holding dead ttys; `pkill -x btattach` before re-attaching, and attach by
      `/dev/serial/by-id/usb-Zephyr_Project_Zephyr_HCI_UART_anchor_np_<app serial>-if00`, never by index
- [x] the dongle's own advertisement heard on vigil's second adapter at ≥ −55 dBm (0 dBm image: −86) —
      **measured 2026-09-12 21:23, on the box:** units #1 (`B1BAA52EE6EDB771` → `hci0 F4:CE:36:2E:CD:98`) and
      #2 (`9D08E454B242A0BF` → `hci3 F4:CE:36:6B:A4:4E`) brought up by `tepna-btattach@` from
      `/etc/tepna/btattach.map` (`--check`: 2 controllers, 0 problems; the `0xFC06` write is a same-value no-op
      under `-pub`); `hciconfig hci0 leadv 3`, passive `lescan` on hci3, 45 s `tepna-btmon.sh` capture
      (`probe-txcheck-hci3-20260912T212337.btsnoop`): **28 reports from hci0, RSSI −17/−18 dBm** (19 × −18,
      9 × −17), 6032 reports total in the window. ⚠️ Passes the letter of the line but does NOT reproduce the
      −86 baseline's geometry: the listener is the sibling dongle in the ADJACENT USB port (cm apart, near
      field), not the adapter the −86 was read on. What it proves is that the `-pub` image transmits and is
      decoded by a second radio on the box; the +20 dBm gain is only demonstrable by the Polars connecting from
      the bed (next item). Two box-side lessons: (1) under the `!` prefix a `printf … | sudo tee <file>` write
      is LOST — the pipe's stdin goes to sudo — write with `sudo sh -c "printf … > <file>"`; (2) a dongle in a
      socket the kernel never enumerates logs NOTHING (no descriptor error) — `lsusb` count is the check, and a
      reseat fixed it
- [x] the other two units (`D967242ECD98`, `E1BFD58009C0`) flashed with the same zip and §8 updated
      with measured addresses — all three match the derivation exactly
- [x] Polars re-paired to the new address on vigil and a two-peripheral concurrent connect
      survives — **2026-09-12 21:36–21:55, live capture on hci0:** Verity re-bonded on first connect,
      H10 re-bonded by the daemon's own `_REBOND_EVERY` gate at 21:51:03 (no manual pair), ring resumed
      its set; **three** LE links held on hci0 at 21:55 (§0b "Live capture moved to hci0"). The
      *overnight* soak ZEPHYR-INSTRUMENT names is a different claim and is read off the morning's
      `LINK.csv`, not off one hour
- [x] `vigil-hciuart-holyiot-txpwr20.conf` / `vigil-hciuart-main.c.patch` in the repo match what was
      built — measured 2026-09-12: the conf is byte-identical to `/srv/data/ncs/vigil-hciuart-holyiot-txpwr20.conf`
      and the patch's hunks equal `git -C /srv/data/ncs/zephyr diff samples/bluetooth/hci_uart` (12
      insertions; no separate patch file exists in the ncs tree — the diff IS the source)

Residue from this pass: `2026-09-12-h10-rebond-waits-behind-psftp-sync` (the bond is checked after five PS-FTP syncs that each need it — §0b). The RSSI-offset question (how much of +35 dB is the LNA's
12 dB vs calibration) is answerable with a fixed beacon at a fixed distance and is not owed until
someone wants to compare RSSI across adapters — which §6 says not to do.
