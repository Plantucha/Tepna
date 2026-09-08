<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (owner-requested 2026-09-07 — "wire up holyiot with time improvement, but keep in mind that not everybody will have same ability so original functionality must be kept"; firmware image with the anchor reports is BUILT and **FLASHED 2026-09-07 21:30** — `iProduct` reads `Zephyr USBD BT HCI anchor` on vigil, address `99:67:24:2E:CD:98` unchanged; **§5(a) MEASURED 2026-09-07 21:34: `0xfd1f enable=1` → Command Complete status 0x00 in 0.8 ms**, sent from uid 1000 on a RAW HCI socket with `CAP_NET_RAW` alone while bluetoothd kept the adapter, monitor file `/srv/tepna/captures/probe-fd1f-20260907T213441.btsnoop`; §5(b)/(c) still owed — they need a strap connected on the Holyiot) · **Created:** 2026-09-07

# Radio-clock sidecar — controller-side connection-event timestamps as an OPTIONAL second clock

**Parent:** [`ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md`](ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md) Task 1 remainder
("controller-side ACL timestamping — not in this build"). **Hardware/flash procedure:**
[`NRF52840-DONGLE-FLASHING-2026-09-07-BRIEF.md`](NRF52840-DONGLE-FLASHING-2026-09-07-BRIEF.md).
**Clock rules this inherits:** CLAUDE.md §🔒 §7 (`hostAxis`: ≥3 anchors, running median, refusal bound,
`independent`, ONE DEVICE CLOCK PER AXIS) and §∅ (absence is `null`, validity travels out-of-band in a sidecar).

## 0 · The constraint that shapes everything (owner, verbatim)

> keep in mind that not everybody will have same ability so original functionality must be kept

Read as four invariants, each of which is a Done-when item below:

1. **`capture.py` is not touched.** The collector is a separate process and a separate systemd unit; the
   capture daemon neither knows nor cares whether it runs. A box with any ordinary adapter (Realtek, CSR,
   Intel, a phone) captures exactly as today.
2. **Default OFF, opt-in by config.** `radio_clock.enabled: false` in `config.example.yaml`; the unit is
   installed but not enabled by `install-services.sh` unless the flag is on. Same shape as the AS11 shadow
   detector block (`config.example.yaml` ~line 391: "Default OFF — flip `enabled` on").
3. **Feature-detected, never assumed.** The collector proves the controller can do it (manufacturer 89 =
   Nordic AND the VS enable command returns success) before it writes a byte. On any other controller it
   exits 0 with one log line and writes **no file** — absence is the absence of a file, not an empty or
   zero-filled one.
4. **Consumers are unchanged when the sidecar is absent.** Every existing fixture's output stays
   byte-identical (`verify-fixtures`); `timingSource`'s existing value set is untouched; the new value
   `'radio'` appears only when a sidecar was present AND passed the pre-stated bands (§4).

## 1 · What "time improvement" is, mechanically

Today the second clock on a box capture is the **host arrival stamp** of each PMD packet (`*_PMDARRIVAL.csv`,
`writers.py PmdArrivalLogWriter`; the vendor file's `Phone timestamp` is that stamp back-timed per sample).
It reaches Python through USB → kernel → BlueZ → D-Bus → bleak, and `hostAxis` measures its spread at
**102–5124 ms on box nights** (§🔒 §7 `spreadMs`). That spread is what the running median exists to fight,
and it is why the H10↔Verity offset on a box night is only good to ~0.2 s and PAT (needs ~10 ms) is out of reach.

Nordic's SoftDevice Controller can report the **anchor point of every connection event** on its own clock —
the instant the radio actually opened the event in which the packet was received, timestamped by the
controller's 32 kHz crystal (`CONFIG_CLOCK_CONTROL_NRF_K32SRC_XTAL=y` in our build) rather than by a
kernel that saw the bytes some hundreds of milliseconds later.

| item | value (from `nrfxlib/softdevice_controller/include/sdc_hci_vs.h`, NCS v3.4.0) |
|---|---|
| enable command | `SDC_HCI_OPCODE_CMD_VS_CONN_ANCHOR_POINT_UPDATE_EVENT_REPORT_ENABLE` = **`0xfd1f`** (OGF 0x3f), param `uint8 enable` |
| event | HCI event **`0xff`** (vendor), subevent **`0x82`** `SDC_HCI_SUBEVENT_VS_CONN_ANCHOR_POINT_UPDATE_REPORT` |
| payload | `{ uint16 conn_handle, uint16 event_counter, uint64 anchor_point_us }` — "absolute time of the new anchor point in microseconds on the controller's clock" |
| cadence | one per connection interval per link, on the **central** |
| firmware gate | routed by `nrf/subsys/bluetooth/controller/hci_internal.c:1820` **only** under `CONFIG_BT_CTLR_SDC_CONN_ANCHOR_POINT_REPORT` (`Kconfig:369`) — **NOT set in the image currently flashed on the Holyiot** (`build-holyiot`); `CONFIG_BT_HCI_VS=y` is |

So the chain becomes two hops instead of one: **device sample ↔ controller anchor** (tight — the packet
was received inside that event, a few ms wide at most) and **controller clock ↔ host clock** (slow and
smoothable — the VS event's own kernel receive time against `anchor_point_us`, USB latency ~1 ms, one
offset per night). The first hop is where the improvement lives; the second is just a re-labelling.

Pre-stated expectation, to be measured not assumed: device↔anchor spread **< 2 ms** on a Polar link
(the connection interval is the only slack). If it measures > 50 ms the mechanism is not what §1 says it
is, and the brief stops there (§4 bands).

## 2 · Firmware step (rig-side; one magnet reflash — owner)

- `capture-host/deploy/nrf52840/vigil-sdc.conf` (lands with #2349) gains one line:
  ```
  # Controller-side connection-event anchor timestamps (VS event 0xff/0x82, enable opcode 0xfd1f):
  # the radio clock source the RADIO-CLOCK sidecar reads. Off by default in SDC; costs nothing until enabled per link.
  CONFIG_BT_CTLR_SDC_CONN_ANCHOR_POINT_REPORT=y
  ```
- **Built 2026-09-07 on the rig** from exactly that conf (`build-holyiot-anchor`, EXIT=0; `.config` verified
  `ANCHOR_POINT_REPORT=y` · `MPSL_FEM=y` · `K32SRC_XTAL=y`; FLASH 155 020 B / RAM 60 276 B; elf carries the
  public-address patch). Package: `/srv/data/ncs/vigil_sdc_holyiot21017_anchor_dfu.zip` (application-version
  5, sha256 `0e55c6d5efe5ca7f…`). Rig-local, not a repo artifact — the repo carries the INPUTS.
- **The image announces itself, so "is it flashed?" has an answer that can be false.** The USB product
  string is `Zephyr USBD BT HCI anchor` (`CONFIG_SAMPLE_USBD_PRODUCT`, also in `vigil-sdc.conf`); the
  predecessor reads `Zephyr USBD BT HCI`. `lsusb -d 2fe3:000b` shows it unprivileged. The USB ID
  `2fe3:000b` is the SAME before and after and is not a signal (Wren, 2026-09-07 — it was already on the
  bus, so a gate on its presence was already true).
- Flash per the dongle brief §5 (magnet → `1915:521f` → `nrfutil dfu usb-serial`). The dongle keeps its
  address (`99:67:24:2E:CD:98`, FICR-derived) so no config on vigil changes.
- **Nothing else on vigil changes.** Pinning the Holyiot as a capture adapter is a separate owner deploy
  (dongle brief §9) and is NOT required for this brief — the collector can run on the Holyiot while the
  Sena keeps capturing, as long as the Polar links it observes are on the Holyiot. See §3 "which links".
- ⚠️ **Name the adapter by ADDRESS, never by `hciN`.** Indices are enumeration order: the Holyiot was
  `hci3` while the UB500 was on the bus and became `hci0` the moment it was pulled (Wren, 2026-09-07).
  Resolve the index at run time (`hciconfig` / `btmgmt info`, match the address) — every command below
  that needs an index means "the index that currently carries `99:67:24:2E:CD:98`".

## 3 · Collector — `capture-host/radioclock.py` + `tepna-radioclock.service` (Heron)

**Lane:** capture-host (`./check.sh` gate; additive behavioural feature ⇒ changeset `minor`).

- **Source:** the HCI **monitor channel** (`AF_BLUETOOTH` / `HCI_CHANNEL_MONITOR`, what `btmon` reads) on
  the configured adapter, filtered to that index. Needs `CAP_NET_RAW` — and **that is the whole grant**: the VS
  enable goes out on a RAW HCI socket under `CAP_NET_RAW` alone (measured 2026-09-07 on vigil, uid 1000, both
  before and after the reflash; the kernel gates a vendor-OGF opcode on CAP_NET_RAW, not CAP_NET_ADMIN, and
  without it the send fails `EPERM`). `CAP_NET_ADMIN` adds nothing but a "privileged" tag on the monitor
  stream — do not grant it. Two more measured facts for the writer: `setsockopt(SOL_HCI, HCI_FILTER)` wants the
  full 16-byte `hci_ufilter` (`<IIIH2x`; 14 bytes → `EINVAL` on kernel 7.0), and **a hung controller answers
  nothing at all** — the 2026-09-07 21:20 run got the command onto the wire and no event back, because the
  Holyiot had been wedged since 20:31 (`command 0x0406 tx timeout` ×99). So the enable has FOUR outcomes,
  not three: `status 0` · `Unknown Command` · `send refused: <errno>` · **`no reply` — which is UNKNOWN, never
  "not this image"**; the collector logs it as such and retries on the next adapter reset (§∅: absence is
  null). **Separate unit** — `tepna-radioclock.service`, `User=vigil`,
  `AmbientCapabilities=CAP_NET_RAW`, `ExecStart=… radioclock.py --config …`. Do NOT widen
  `tepna-capture.service`'s capabilities for this; the whole point is that capture runs without them.
- **Feature detection, in order, before any file is opened:** (1) adapter resolved by **address** from
  `radio_clock.adapter` (never `hciN`, §BLE identity rule); (2) `HCI_Read_Local_Version` manufacturer ==
  **89** (Nordic); (3) send `0xfd1f enable=1` and require status 0x00. Any miss ⇒ log ONE line
  (`radio clock unavailable on <addr>: <reason>`), exit 0, write nothing. A non-Nordic controller is not
  an error; it is the common case.
- **Which links:** the enable is per-controller and reports every connection the controller is central
  on. Map `conn_handle → peer address` from `LE Connection Complete` / `LE Enhanced Connection Complete`
  on the same monitor stream; drop the handle on `Disconnection Complete`. Only peers listed under
  `devices:` are written; anything else is ignored (no unrelated addresses land on disk).
- **The join key is inside the packet, so `capture.py` needs no hook.** The monitor channel carries the
  ACL payload. A Polar PMD data frame is `[meas_type][8-byte LE ns since 2000-01-01][frame_type][payload]`
  (`capture-host/polar_pmd.py`, known-answer-pinned by `tests/test_polar_pmd.py`) — bytes 1..9 are the
  frame's **LAST** sample stamp (`polar_pmd.py:589` `last_ns`), which is exactly the `last_sensor_ns` column
  `PmdArrivalLogWriter` records (`capture.py:2719` writes `samples[-1].sensor_ns`) — so the sidecar reads
  the raw 8 bytes, decodes nothing, and joins to `*_PMDARRIVAL.csv` on `(device, last_sensor_ns)`: an exact
  integer identity. ⚠️ This read `first_sensor_ns` until 2026-09-07 (Heron, measured on a synthetic 3-sample
  H10 frame: raw field == `samples[-1]`, ≠ `samples[0]` by 2 sample periods). `first_sensor_ns` is a value the
  decoder BACK-TIMES from `fs` and `prev_last_ns`; a collector joining on it would have matched **zero** rows
  on every multi-sample frame, and an empty join reads exactly like a night with no correlated packets. Do
  not reimplement the back-timing in the collector to recover the first-sample key — the raw field is the key. O2Ring realtime
  frames carry no device clock and are OUT of scope for v1 (a later increment may key them on
  `(handle, event_counter)`).
- **Association of an ACL packet to its connection event:** nearest anchor with
  `anchor_point_us ≤ (pkt_host_rx − ctrl_host_offset)`, where `ctrl_host_offset` is the running median of
  `(vs_event_kernel_rx_us − anchor_point_us)` over the last 64 reports. Record which anchor was used
  (`event_counter`) so the choice is auditable; if two anchors are within `ctrl_host_offset` jitter of the
  packet, write the row with `anchor_us` blank — ambiguous is absent, not guessed.
- **Sidecar:** `<night>/<stamp>_<DEVICE>_RADIOCLOCK.csv`, header
  `Phone timestamp;device;meas;last_sensor_ns;conn_handle;event_counter;anchor_us;vs_rx_ns;acl_rx_ns`
  — `Phone timestamp` = the kernel monitor timestamp of the ACL packet rendered as the existing
  `_phone_ts` floating wall-clock (so a reader that only knows `PMDARRIVAL` can read it), `vs_rx_ns` /
  `acl_rx_ns` the raw `CLOCK_REALTIME` ns of the two monitor packets. Blank cell = not measured (never 0).
  Torn-tail / resume handling copied from `PmdArrivalLogWriter`. Rolls with `writers.night_dir` like every
  other sidecar. It is **TELEMETRY**, never a metric.
- **Tests (in `capture-host/tests/`):** feature-detect refusal on manufacturer ≠ 89 writes no file; refusal
  on enable status ≠ 0 writes no file; handle↔address map follows connect/disconnect; a synthetic monitor
  stream with 3 anchors and 2 ACL packets yields the expected `event_counter` per packet and blank
  `anchor_us` on the ambiguous case; a PMD frame's ns field is parsed at the right offset (use a real
  H10 frame from the corpus, hex-inlined). 100 % branch coverage is the lane floor.
- **`install-services.sh`:** installs the unit; `systemctl enable` only when `radio_clock.enabled` is
  true in the config it reads. `check-system-files.sh` learns the unit's expected caps.

## 4 · Consumer — the DSP side (Magpie)

**Lane:** JS (`npm run check`; compute-path change ⇒ `computeHash` moves ⇒ `verify-fixtures` on the
corpus; changeset `minor` — additive `timingSource` value).

- **`dex-ingest.js:92`** — add `RADIOCLOCK` to the sidecar-exclusion regex (both alternations) so the file
  is never mistaken for a signal; this is the generation-later defect that line's comment already names.
- **Ingest:** a `*_RADIOCLOCK.csv` beside a `_ECG.txt` / `_PPG.txt` / `_ACC.txt` is parsed into
  `rec.radioClock = { rows, anchors:[{devMs, ctrlMs, hostMs}], spreadMs, n }` keyed by device address;
  absent ⇒ the field is **absent** (not `null`-filled, not `[]`). Join on `last_sensor_ns` ≡ the vendor
  row's `sensor timestamp [ns]` for the packet's LAST sample (PpgDex/ECGDex already know packet
  boundaries — `PMDARRIVAL` consumers in `ppgdex-dsp.js` / `ecgdex-dsp.js` are the pattern).
- **Pre-stated bands on the device↔anchor residual spread (after the host-axis-style running median),
  written here before anyone measures it:**

  | measured spread | action | `timingSource` |
  |---|---|---|
  | **< 2 ms** | anchors feed `hostAxis` as the second clock in place of host stamps (`hostMs := ctrlMs + ctrl_host_offset`) | **`'radio'`** (new) |
  | 2 – 50 ms | anchors used only as a lower-jitter host stamp; existing logic unchanged | unchanged (`'device+host'`), `quality.radioSpreadMs` reported |
  | > 50 ms, or `n < 3`, or refusal | sidecar ignored | unchanged; `quality.radio = { rejected: <reason> }` |

  A `'radio'` result that came from a spread the band table does not admit is a bug, not a good night.
- **Every §🔒 §7 rule still applies to the radio anchors**: ≥3, median not fit, flat outside, refusal
  bound, ONE DEVICE CLOCK PER AXIS (a `_clockResyncs` seam splits the radio anchors exactly as it splits
  host anchors — a resync is a change of *device* clock, and the radio side does not exempt it).
- **Export:** `recording.timingSource` may now read `'radio'`; additive — and the Integrator is IN SCOPE
  for this unit, because it was checked and the pass-through claim is only half true (Magpie, 2026-09-07):
  `integrator-dsp.js:741` forwards the value verbatim, but **`:2916` marks a TCH corner `pseudo` unless the
  value is literally `'device'` or `'device+host'`** — so the BEST band would downgrade the hat to a
  heuristic badge, silently and in the safe-looking direction. Same defect as `'device+host-verified'`
  (#1643, OXYDEX-PB §3b, pinned by `tests/dex-tests.js:4707`). **A radio-disciplined axis IS a timed
  corner** (three independent clocks is what TCH wants; a radio clock is more independent than
  `device+host`, not less). Fix the *class*, not the instance: ONE exported predicate over an enumerated
  `timingSource` vocabulary (each value carries `timed: true|false`), used at `:2916`, and a test that
  reds when a value exists in any emitter without an entry — so the next value cannot be added without
  deciding. `:5833` (`=== 'host'`, host-only list) is correct as-is for `'radio'`; `pat-gate.js:131/:321`
  (`=== 'none'`) are safe. Integrator `computeHash` moves ⇒ its 3 fixtures are in the verify-fixtures run.
- **Fixtures:** a **committed** synthetic twin (an H10 `_ECG.txt` + matching `_RADIOCLOCK.csv` with a
  planted 1.3 ms spread and a planted 80 ms one) so CI exercises both the accept and reject band without
  the corpus. Then `node tools/verify-fixtures.mjs` on the corpus: **zero existing outputs move** — that is
  the byte-level form of §0.4.
- **What NOT to do:** no `!= 0` / `?? 0` anywhere in the join; a missing anchor is a missing anchor. Do not
  let `ppm` be quoted without span and `n`. Do not hand-roll a rate from the anchors — `hostAxis` only.

## 5 · Box-side verification BEFORE §3/§4 are built (Wren, physical-vigil step; ~15 min, daytime)

After the reflash (confirmed by the product string in §2, not by the USB ID): with one Polar strap
connected on **the Holyiot** (bleak `bluez={'adapter': <index resolved from its address>}`, not on the
Sena), run `btmon -i <that index>` (needs the caps — `sudo`, owner present) and confirm (a) `0xfd1f`
returns status 0x00 — **DONE 2026-09-07 21:34, status 0x00, see header**; (b) `0xff/0x82` events arrive once per connection interval with a monotonic
`anchor_point_us`, (c) the ACL packets of the strap appear on the same stream with kernel timestamps.
Record the first 20 anchors' deltas and the interval the strap negotiated. If (a) fails, the image is
wrong (check `.config`), not the design; if (b) shows anchors but no monotonicity, stop and report.
This is the first measurement of the §4 spread; write the number into this header when it exists.

## 6 · Ordering and ownership

| step | who | gate |
|---|---|---|
| conf line in `vigil-sdc.conf` (after #2349 merges) | Kestrel | docs-ledger (doc-only) |
| magnet reflash of the Holyiot | **owner** | dongle brief §5 tells |
| §5 verification on the Holyiot (by address) | Wren (owner present for `sudo btmon`) | number in this header |
| §3 collector + unit + tests + changeset | Heron | `capture-host/check.sh` |
| §4 consumer + committed twin + verify-fixtures | Magpie | `npm run check` + corpus verify |
| enable on vigil (`radio_clock.enabled: true` + `systemctl enable`) | **owner deploy** | `/api/version` + unit active |

§3 and §4 can proceed in parallel once §5 has confirmed the event shape; neither depends on the Holyiot
being pinned as capture adapter.

## Done when

- [ ] `git diff --stat origin/main -- capture-host/capture.py` is **empty** for the collector PR (§0.1).
- [ ] `radio_clock.enabled` defaults to `false`; `install-services.sh` does not enable the unit unless it is true (§0.2).
- [ ] Collector on a non-Nordic controller exits 0, logs one line, creates no file — test-backed (§0.3).
- [ ] `verify-fixtures` reports **0 outputs moved** on the corpus after the consumer lands; the committed twin reds if either band is mis-assigned (§0.4, §4).
- [ ] `dex-ingest.js` excludes `_RADIOCLOCK` (test in the existing sidecar-exclusion group).
- [x] §5(a) `0xfd1f` → status 0x00 on the flashed image (2026-09-07 21:34; `probe-fd1f-20260907T213441.btsnoop`).
- [ ] §5 spread measured and written into this header with `n` and the strap's connection interval.
- [ ] `timingSource:'radio'` appears on ≥1 real night with spread < 2 ms — or the header records the measured spread and which band it fell in, and the brief is DONE either way (a measured "no" is a result).
- [ ] Residue rows in `briefs/RESIDUE.md` for anything surfaced (O2Ring frames, the Sena-vs-Holyiot production decision).
