<!--
  VIGIL-GPS-STRATUM1.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — the capture box as a stratum-1 clock on its own GPS: wiring, bring-up, what it measures, how it is served and read) · **last-verified:** 2026-10-10 · **Brief:** `briefs/VIGIL-GPS-STRATUM1-2026-10-10-BRIEF.md`

# Vigil as a stratum-1 clock — u-blox M10 1PPS into the ThinkCentre M900 Tiny

The Clock Contract (`CLAUDE.md` §🔒) makes the capture box's wall clock the source of every capture stamp. Until 2026-10-10 that clock was a stratum-2 client of the NTP250. It is now a **stratum-1 server disciplined by its own GPS pulse**, in the same shape as the digipi, and the LAN has three independent GPS-disciplined clocks.

## 1 · What was built (and what the first-night script got wrong)

| part | signal | path | result |
|---|---|---|---|
| **PPS** (1 Hz, 100 ms high, 3.3 V TTL) | the exact start of each second | module PPS → **220 Ω** → DB9 pin 1 (DCD) of the Tiny's native 16550 UART (`/dev/ttyS0`, COM header FRU 04X2733) over one Cat6 pair | kernel-timestamped `/dev/pps0` events, µs-class latency |
| **NMEA** (which second it is) + **power** | labels the seconds; 3.3 V ≈ 30–50 mA | module TX/RX/VCC/GND over a short ribbon to a CP2102 USB-TTL at the module; USB to the Tiny → `/dev/ttyUSB0` | **38400 baud** (the M10 default; the REV F sheet said 9600 and that read as garbage) |
| ground | one net | module · DB9 pin 5 · CP2102 (the USB loop is expected and harmless) | |
| no MAX3232 | — | DCD is a PC *input*; 0/3.3 V reads as de-asserted/asserted through its ~5 kΩ pull-down; the 220 Ω limits fault current and costs ≈0.14 V | |

Cat6: the blue pair carries PPS + ground, brown-white a second ground; the other pairs are **parked at both ends** (a floating conductor on the module's RX is an antenna). ≤ 10 m; the CP2102's USB lead is the real ceiling (5 m passive). An optional snap-on ferrite clamp goes around the whole Cat6 at the Tiny end, never a bead in series with PPS.

The module has no flash and the board no backup cell: receiver settings vanish at power-off and are re-applied at every gpsd start by `tepna-m10-tune.sh`.

## 2 · Detection, read-only (what proved the wiring before any root step)

As user `vigil` (dialout member), no sudo:

```
cat /sys/class/tty/ttyS0/{type,port,irq}      # 4 / 0x3F8 / 4  → 16550A, BIOS serial port 1 enabled
stty -F /dev/ttyUSB0 38400 raw; timeout 3 cat /dev/ttyUSB0 | grep '^\$G'   # $GNRMC … A … $GNGGA … ,2,12,0.54,…
python3 - <<'PY'                              # PPS on DCD without any line discipline: poll the modem bits
import fcntl,termios,struct,time,os
fd=os.open('/dev/ttyS0',os.O_RDWR|os.O_NOCTTY|os.O_NONBLOCK); last=None; rises=0; t0=time.time()
while time.time()-t0<4:
    st=struct.unpack('I',fcntl.ioctl(fd,0x5415,struct.pack('I',0)))[0]; dcd=bool(st&termios.TIOCM_CD)
    rises+= (last is not None and dcd and not last); last=dcd; time.sleep(0.002)
print(rises, 'rising edges in 4 s')           # 4
PY
```

`/proc/tty/driver/serial` is root-only; the `/sys/class/tty` files are not. `/dev/pps0` is root 0600 once attached; `/sys/class/pps/pps0/assert` (timestamp#count) is world-readable and is the honest check that pulses arrive.

## 3 · Bring-up (root, one script, idempotent)

```
sudo bash /opt/tepna/capture-host/deploy/enable-gps-stratum1.sh
```

It installs `pps-tools gpsd gpsd-clients`; `tepna-pps-ldattach.service` (`ldattach PPS /dev/ttyS0` → `/dev/pps0`, before gpsd and chrony); `/etc/default/gpsd` with `DEVICES="/dev/ttyUSB0"`, `GPSD_OPTIONS="-n -s 38400"`; the tune script as a gpsd `ExecStartPre`; and `/etc/chrony/conf.d/tepna-gps-pps.conf`:

```
refclock PPS /dev/pps0 refid PPS precision 1e-7 prefer
allow @LAN_CIDR@
ratelimit interval 3 burst 8
local stratum 10 orphan
```

`@LAN_CIDR@` is rendered at install time from `TEPNA_LAN_CIDR` or, unset, from the subnet of the box's default-route interface; the repository never carries the network layout.

**Why no `lock GPS` and no `refclock SHM`.** gpsd's u-blox SHM export was measured on digipi to stall within minutes while the fix stayed solid; `refclock PPS … lock GPS` then chained the pulse to that dead feed and the box fell back to stratum 2 without a word. Without `lock`, chrony takes the *edge* from the hardware pulse and resolves *which second* from the network sources (the NTP250 and the digipi, within microseconds). gpsd still runs for position and monitoring only; the clock does not depend on it. The first-night script used `lock GPS` + SHM; the installer retires that drop-in to `.bak-lockgps`.

## 4 · Measured (2026-10-10, EDT)

| when | selected | PPS std-dev | box vs NTP250 | notes |
|---|---|---|---|---|
| 17:00 bring-up | `^*` NTP250 | — | −1.9 µs | PPS and GPS rows appear (`#?`), 2 samples |
| 17:04 | **`#* PPS`**, stratum 1 | 2.35 µs | +365 ns ± 5.9 µs | reference ID `PPS`; RMS offset 77 µs (settling) |
| 21:30 | `#* PPS` | **0.151 µs** | −151 µs (the NTP250 now `^?`: polled, not selected) | system time 1.45 µs fast; skew 0.161 ppm; root dispersion 37 µs |

The NMEA/SHM source reads ~130–140 ms late (serial + gpsd latency); with no `lock` that number is cosmetic. NTP250's own clock jitter is 750 ns; vigil's PPS at 0.15 µs std-dev is now the tightest clock on the LAN by chrony's own measure. The C-state/governor trim (`cpupower frequency-set -g performance`, GRUB `intel_idle.max_cstate=1`) was **not** applied; compare `chronyc sourcestats` PPS std-dev a day before and after if it is ever tried.

## 5 · How it is served and read

- **Serving:** `allow <LAN subnet>` (rendered at install time) with `ratelimit`; `local stratum 10 orphan` keeps serving if every source dies (same as digipi; two orphans at stratum 10 elect by reference ID, which is what orphan mode is for). LAN clients add `server <this box> iburst` beside the NTP250 and the digipi.
- **The monitor (Clock & NTP card):** `GET /api/clock` now carries `chrony: {available, tracking: {reference, host_stratum, system_offset_s, rms_offset_us, root_dispersion_ms, skew_ppm}, sources: [{name, mode, state, stratum, poll, reach, last_rx, offset_s, adjusted_offset_s, error_s, stddev_s, span}]}` — `host_clock.read_sources()`, read-only, every quantity normalised to seconds. The card renders **Ref / Box−ref / Rate** and a table of every source *minus this box* (state spelled out, reach in octal as chrony prints it, error and std-dev). The sidebar's host-clock pill adds `vs <server> ±…` for each network server, so a box on its own PPS that disagrees with the NTP250 by milliseconds is visible without opening the card.
- **Reading the table:** a locally attached PPS should sit within a few µs of the box; LAN servers within a few hundred µs; `x falseticker` on a server means chrony thinks that server is wrong, not this box — check it against the third clock before believing either.

## 6 · Maintenance

- `ppstest /dev/pps0` (root) or `cat /sys/class/pps/pps0/assert` (anyone): the ASSERT edge is the second; the clear edge trails by 100 ms.
- A PPS that stops while the fix holds: `systemctl restart tepna-pps-ldattach`; the unit restarts itself on failure.
- If the receiver forgets its tuning (GSV/GLL/VTG back on, `gpspipe -r` chatty): `systemctl restart gpsd` re-applies it.
- Never add `lock GPS` or `refclock SHM` back (see §3). Never put a bead in series with the PPS line.
- Pin numbers: trust the ones printed on the DB9 breakout; the Tiny's cable ends in a DB9 **male**, the breakout is **female**; power the Tiny off before plugging the COM header cable.
