<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-29

# Radio failover — the DISTRESS SIGNAL, with its bands pre-stated

**One-line: the failover MECHANISM already exists and is wired; what is missing is a continuous
signal to trigger it on "can't handle its load" rather than only on "wedged", and these are its
bands, written down before a line of it is wired.**

## 1 · What already exists — do not rebuild it

`capture.py:1211`, *DUAL-RADIO FAILOVER (VIGIL-OVERNIGHT-FINDINGS P1.5)*, written after the night
`hci1` sat healthy and idle for 110 min while the pinned dongle was down:

- `failover_target(pinned_mac, adapters)` — pure; the first UP, addressable, non-pinned adapter.
- `list_adapters()` — `hciconfig -a`, returning `[]` on ANY failure, because failing over onto an
  adapter we could not confirm UP is worse than staying on the wedged one.
- `_set_active_adapter(mac)` — repoints the process-global pin; every device task resolves
  ADAPTER→hciN fresh on each reconnect, so one assignment moves capture.
- Wired at `capture.py:4363` as **L3 of the recovery ladder** (L1 clear phantom links → L2
  power-cycle ×`max_cycles` → L3 fail over), bounded by `max_failovers`, gated by
  `watchdog.failover` (default true), re-bonding every non-optional device on the spare first.

**The CPAP is already isolated and needs no work:** it reads `cpap.ble_stream.adapter`, separate
from the process-global `ADAPTER`, so a global failover does not move it.

## 2 · What is missing

| # | gap | status |
|---|---|---|
| 1 | a continuous DISTRESS signal ("can't handle its load") | **missing — this brief** |
| 2 | hysteresis (switch threshold + longer settle) | missing; there is no continuous signal to settle |
| 3 | per-link affinity in selection | missing; selection is first-up |
| 4 | every switch as an EVENT with its cause | missing — a `log.critical` and nothing else |
| 5 | selftest with a planted wedge | thin; nothing plants one end to end |

Item 4 is the one that matters most for trust: a switch that leaves only a log line is the **silent
healing** this suite keeps rediscovering — it happens, and nothing that survives the night says so.

## 3 · The measurement, per arm, before any threshold

`LINK.csv` carries `# adapter=<MAC> hci=<hciN>` in its first line, so every file is already
attributable to one adapter. Columns: `Phone timestamp;device;connected;rssi_dbm;battery_pct;
frames_dropped;frames_duplicated;link_epoch;address`.

**Normalised per NIGHT over the CONNECTED SPAN only** (first to last connected sample). Pooling whole
files instead gives `down% = 100` for a backup strap that was simply never worn — a wear artifact
read as distress, which is the shape this suite keeps catching.

| arm | device | nights | recon/h median | recon/h max | down% median | down% max |
|---|---|---|---|---|---|---|
| Sena `…CC:53:02` | Polar H10 | 5 | 0.46 | 1.36 | 35.0 | 68.1 |
| Sena | Polar Verity | 5 | 0.38 | 4.67 | 5.3 | 9.9 |
| Sena | **O2Ring** | 5 | **0.23** | **13.72** | 16.2 | 46.0 |
| UB500 `…29:9D:1D` | Polar H10 | 25 | 0.08 | 1.79 | 58.8 | 78.1 |
| UB500 | Polar Verity | 25 | 0.25 | 10.84 | 1.2 | 59.3 |
| UB500 | O2Ring | 25 | 0.13 | 0.33 | 78.3 | 78.3 |

⚠️ **The two arms are from DIFFERENT ERAS, not concurrent.** The wearables moved from the UB500 to
the Sena on 2026-08-25, so these are sequential populations. They must not be compared to each other;
each adapter is judged against its own history, which is the rule anyway.

### 3.1 Two findings that shape the design

**RECONNECT RATE IS THE SIGNAL; `down%` IS NOT.** `down%` medians of 35–78 % for the H10 and the ring
are *wear*, not distress — the strap comes off inside its own connected span. A trigger on `down%`
would fire on an ordinary night. It stays **report-only**.

**THE SIGNAL DEMONSTRABLY SEES THE STORM.** The ring's 2026-08-29 reconnect storm is the
`13.72 /h` against a median of `0.23` — roughly **60×**. That is the case the whole unit exists for,
and it is separable by a wide margin rather than by a hair. `frames_dropped` was **0 across every
file**, so it is not a usable signal here and is not proposed as one.

## 4 · PRE-STATED BANDS — written before wiring, per §📌 and the auto_stop near-miss

> **An arm is DISTRESSED for a device when that device's reconnect rate exceeds
> `max(8.0 /h, 10 × that device's own median over ≥3 nights on that adapter)`,
> sustained for a HYSTERESIS window of 900 s.**
>
> **Derivation.** The floor of 8/h sits above every non-storm observation in the table (highest is
> 4.67, Verity/Sena) and far below the storm (13.72). The 10× multiplier is what makes it
> **per-arm** rather than global — a device whose own baseline is high is not distressed by being
> itself. Both must be exceeded, so a quiet device cannot trip on a low absolute count and a noisy
> one cannot trip on its own normal.
>
> **Hysteresis 900 s.** A reconnect storm is sustained (the 08-29 storm ran five hours); a mask-off
> or a charger touch is not. 900 s is ~5× the longest legitimate reconnect cluster observed. It is
> deliberately much longer than the switch threshold is tight: the cost of switching late is a bad
> hour, the cost of flapping a device between radios all night is the night.
>
> **≥3 nights, or NO learned baseline.** With fewer, the device uses the configured order only. The
> AX210 has **zero** nights and therefore gets no affinity, no assumed superiority, and no learned
> threshold until three exist.

**These bands bind before the code that reads them exists.** A threshold picked after watching the
trace is the auto_stop near-miss again, where `0.5 L/min` came from the wrong reference state.

## 5 · The switch event

Every switch emits a record carrying **which signal fired and its value**, not merely that one
happened:

```
failover: hci0 -> hci2 | cause=reconnect-rate | device=Wellue O2Ring-S
          observed=13.7/h band=max(8.0, 10x0.23=2.3) sustained=915s
```

surfaced in `STATUS` and in QC-SUMMARY, so radio churn is visible data rather than silent healing.
A reasonless event is half-silent.

## Done when

- [ ] The distress assessor is pure, tested, and refuses (UNKNOWN) below 3 nights of baseline.
- [ ] Hysteresis pinned by a test that a single bad minute does NOT switch.
- [ ] The switch event carries cause + value + band, asserted in a test.
- [ ] A planted wedge migrates a device and emits the event — seen to fail over, not assumed.
- [ ] `down%` and `frames_dropped` are recorded as report-only, with the reason they are not triggers.
