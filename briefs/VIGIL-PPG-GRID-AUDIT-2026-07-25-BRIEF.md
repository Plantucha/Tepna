<!--
  VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-25 · **Created:** 2026-07-25 · **Method-parent:** `AUDIT-PROMPT.md` · **Relates:** `O2RING-PPG-GAP-2026-07-22-BRIEF.md` (§1 amends its fix), `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md`

# Vigil audit — the PPG grid was inventing time, and two guards that failed open

> **Scope:** out-of-suite (`capture-host/`). No Dex bundle, no `manifestHash`, no provenance impact —
> `verify-provenance` and `Dex-Test-Suite` are untouched by this work. The gate that applies is the
> capture-host pytest suite: **947 green at baseline → 961 green after** (+14 tests, 0 regressions).
> **Method:** invariant-and-counterexample per `AUDIT-PROMPT.md`, every finding carrying a reproduction
> — a real-corpus measurement, a synthetic replay, or both. Findings that did not survive execution are
> recorded in §6 so they are not re-filed.

---

## 0. The one-paragraph story

A fix landed on 2026-07-22 to stop the O2Ring PPG record from *compressing* time across lost frames
(`O2RING-PPG-GAP §1`). It worked, and then over-corrected into the opposite failure: because it measured
each gap **frame-to-frame** and could only ever advance, it **rectified symmetric BLE arrival jitter into
monotonic fabricated time**. Over 11.18 h of real corpus the grid claimed **+210 s of elapsed time that
never happened**, while `rows/wall` sat at nominal on every single file — i.e. **nothing was actually
lost**. The daemon logged this as *"% of the session's real time was lost by the link."* It lands in the
one place that hurts: the finger-PPG timeline PpgDex derives beat intervals from. Two smaller guards were
also found failing **open** — an unreadable NTP stratum graded as `disciplined`, and a physically
impossible positive RSSI recorded as a reading. All three are fixed here, each with a test that fails
against the old code.

---

## 1. The PPG grid fabricated elapsed time (the finding) — FIXED

### 1.1 Mechanism

The O2Ring streams samples with **no device clock**, so the host lays them on a synthesized 125.738 Hz
grid indexed by a running counter. To represent real losses, `capture.py`'s PPG handler advanced that
counter when a frame arrived late:

```python
gap_s = (arr - ppg_prev_end[0]).total_seconds() - nps / O2PPG_FS
if gap_s > O2PPG_GAP_MIN_S:          # 40 ms
    ppg_idx[0] += int(round(gap_s * O2PPG_FS))
ppg_prev_end[0] = arr                # reference resets to THIS arrival
```

Two properties combine badly. The reference is the **previous frame's arrival**, and the advance is
**one-sided** — a negative gap is deliberately never rewound (rewinding would emit non-monotonic
`sensor_ns`). So across N frames the code banks every positive excursion past 40 ms and discards every
compensating negative one. Symmetric jitter is **rectified into net drift**. The threshold does not
prevent this; it *selects the tail that gets banked*.

### 1.2 Evidence — real corpus (12 largest PPG fragments, 07-20 → 07-25)

| night | `rows/wall` | `rows/dev` | `dev/wall` | verdict |
|---|---|---|---|---|
| 07-20, 07-21 | 125.74 Hz | 125.738 Hz | 1.00001 | clean |
| 07-22 | 125.71 Hz | 125.246 Hz | 1.00372 | appears |
| 07-25 | 125.66 Hz | 123.448 Hz | **1.01794** | +37.5 s fabricated |
| **TOTAL (11.18 h)** | **125.747 Hz** | **125.095 Hz** | **1.00522** | **+210 s** |

The decisive column is `rows/wall`: it sits at nominal (125.747 vs 125.738) on **every** file, so the
samples all arrived. Had 210 s of data genuinely been lost, `rows/wall` would have dropped
proportionally. It does not. Per-file the inserted gaps have median **47.7 ms** — sitting right on the
40 ms threshold, the signature of a jitter tail crossing a bound rather than of multi-sample loss.

### 1.3 Evidence — synthetic replay (zero loss by construction)

Feeding frames that carry **every** sample at exactly nominal rate, varying only arrival jitter:

| jitter sd | inflation | phantom gaps |
|---|---|---|
| 0 ms | +0.003% | 0 |
| 10 ms | +0.143% | 60 |
| **16.4 ms** (the value this code's own comment measured) | **+3.239%** | **1264** |
| 25 ms | +11.619% | 3866 |

### 1.4 Downstream impact

PpgDex's **`fs` survives** — it takes the *median* ns delta, and 99.8% of steps are the exact grid step.
But `relSec[i] = nsArr[i]/1e9` takes the **timeline** straight from the inflated column. At ~49 bpm on
the 07-25 file, ~23% of inter-beat intervals cross ≥1 inserted gap and are stretched by a median 48 ms on
a ~1230 ms RR. RMSSD is a **successive-difference** metric, so injected jumps hit it directly. This is
the **finger** PPG path — the leg validated against paired chest ECG.

### 1.5 The fix — anchor to the session, not the previous frame

```python
if ppg_t0[0] is None:
    ppg_t0[0] = arr - _dt.timedelta(seconds=(nps - 1) / O2PPG_FS)
target = int(round(((arr - ppg_t0[0]).total_seconds() - (nps - 1) / O2PPG_FS) * O2PPG_FS))
if target - ppg_idx[0] > O2PPG_GAP_MIN_S * O2PPG_FS:
    ...advance to target...
```

Measured against a **fixed anchor**, jitter cancels instead of accumulating: a late frame does not move
the grid while the cumulative position is still on track, so only a **persistent** deficit — a real
dropout — advances it. Still one-sided, and that asymmetry now works in the safe direction: holding
still **under-reports** a gap rather than inventing one.

**Replayed over the same real corpus, old vs new on identical frames:**

| | inflation | gaps/file |
|---|---|---|
| OLD (frame-to-frame) | **+1.05%** | hundreds |
| NEW (session-anchored) | **+0.05%** | single digits |

*(The replay reconstructs frame boundaries from the phone column, so its absolute old-side figure
differs slightly from the direct file measurement in §1.2; the old-vs-new comparison is on identical
reconstructed frames and is what the design decision rests on. The authoritative absolute number for the
shipped defect is §1.2's **+210 s / +0.52%**.)*

### 1.6 A deliberate, documented behaviour change

The anchored grid now **corrects a slow ring-vs-host rate mismatch** (measured 125.726 vs the configured
125.738 Hz). That is right, not a defect: the host clock is NTP-disciplined — stratum-1/PPS on this box,
confirmed in the CLOCK sidecar — while the ring's oscillator free-runs, so pulling the grid toward host
time restores the true span. The old `test_slow_clock_drift_does_not_accumulate_into_a_false_gap`
asserted `gaps == 0`, pinning the *mechanism*; it is replaced by
`test_slow_clock_drift_corrects_toward_the_host_clock_without_overshooting`, which pins the *outcome*
(inflation < 0.05%, correction < 0.1 s over ~8 min).

### 1.7 The log line also asserted the false conclusion

`"(%.2f%% of the session's real time was lost by the link)"` → now
`"(%.2f%% of the grid, host-clock deficit vs the session anchor)"`. A log line is evidence only if it
reports what it measured rather than what it inferred.

---

## 2. Stream shape was silently normalised, not surfaced — FIXED

`TelemetryBus.push()` did `m.chans = nch` — conforming the **declared** shape to whatever arrived.
Channel count is fixed by the hardware (`_LIVE_META`: ECG 1, PPG 4, ACC/GYRO/MAG 3, PPI 2), so a
differently-shaped frame is **decoder corruption**, and rewriting the metadata makes the UI believe the
sensor genuinely changed shape. Now: the declared shape is kept, the breach is recorded in
`shape_errors()` and surfaced as `shapeError` on `meta()`, and the malformed frame is **dropped from the
live ring** (ragged rows under one declared `chans` would be mis-plotted as real data).

**Logged, not raised — deliberately.** `push()` runs inside bleak's notification callback, *after* the
durable write and *outside* `on_pmd`'s `try/except`. A raise there escapes into the D-Bus dispatch, where
it is logged and swallowed — quieter, not louder — while changing nothing on disk. The loud channel in
this system is the monitor, so that is where the flag goes. The flag is **sticky across
unregister/re-register**, because every reconnect performs that cycle and must not launder the evidence.

**Reachability, stated honestly:** unreachable today — `BUS.register()` declares the correct width for
every stream and every push site emits a fixed one. This is a corruption *detector*, not a live bug fix.

---

## 3. An unreadable NTP stratum graded as `disciplined` (fail-open) — FIXED

`read_state` parsed `Stratum` with `.isdigit()`, so any non-integer form became `None` and fell into
`classify()`'s *"synchronised; stratum not yet reported"* branch — **which trusts**:

```
Stratum='16'    -> 16   -> holdover    absolute_ok=False
Stratum='16.0'  -> None -> disciplined absolute_ok=True   <-- FAILS OPEN
Stratum='n/a'   -> None -> disciplined absolute_ok=True   <-- FAILS OPEN
```

This is the single field gating **absolute-time trust** on a box that pushes its own clock into all three
sensors — the exact failure `host_clock.py`'s own header exists to prevent. Now parsed with `_num()`
(which also handles the suffixed forms systemd uses elsewhere) and split into two states: **reported but
unreadable → holdover**; **genuinely absent → keeps the documented benefit of the doubt** (systemd clears
`NTPMessage` on restart, so absent-but-synchronised is a real, benign state). `packet_count` moved to
`_num()` for the same reason.

---

## 4. Physically impossible RSSI recorded as a reading — FIXED

`parse_rssi` accepted `-127 <= val <= 20`. BlueZ returns `0` (occasionally a small positive) from
`HCI_Read_RSSI` when it has **no valid measurement** — a stale handle, a link being torn down. Measured
on the 2026-07-25 LINK sidecar: `0`, `+1` and `+8` dBm across three devices (5 rows of 9141). A receiver
cannot measure positive signal strength, and these poison any min/max or threshold over the column.
Bound tightened to `-127 <= val <= -1`.

An **existing test asserted `parse_rssi("RSSI return value: 0") == 0`** — the assertion encoded the bug.
It was changed deliberately, with the reason recorded inline, not edited to make a new bound pass.

---

## 5. Residue — carried to a follow-up, not fixed here

1. **Already-captured nights carry the inflated grid.** 07-22 → 07-25 O2Ring PPG files have up to +1.8%
   fabricated elapsed time baked into `sensor timestamp [ns]`. The fix is forward-only. These nights are
   still usable for anything reading `fs` (unaffected) but their beat *timelines* are stretched at each
   phantom gap. **Decision owed:** re-derive the grid offline from the phone column, or mark the affected
   files. Nothing should be re-analysed for HRV until that is settled.
2. **`capture.py` writes a fabricated `0` for an absent pulse rate** — `wr.write(now, live["spo2"],
   live["pr"] or 0, live["motion"])`. `parse_live` returns `pr: None` outside 20–250, and this is the
   vendor CSV OxyDex parses **positionally**. Verified **latent**: 0 occurrences across 110k real rows in
   six nights. **Not landed here on purpose** — the honest value is a blank, and whether OxyDex's reader
   tolerates a blank in that column is a cross-boundary question that needs `Dex-Test-Suite.html?full`,
   which is out of scope for a capture-host-only change.
3. **The O2Ring live link is thrashing** — 112 sessions on 07-25 (median 5 s, 36% of the night off-link),
   265 across the full cross-midnight night. Pre-existing and already characterised in
   `VIGIL-OVERNIGHT-FINDINGS-2026-07-24`; it is what drives the jitter this brief's §1 was rectifying.
   Consequence now measured: **`trio-batch` rejects 07-23 and 07-24 outright** (three-way overlap 0.4–0.6 h
   < 1 h) because the ring's longest continuous fragment collapsed from 65–242 min to ~34 min.
4. **The second-disk archive is not mounted** — `dest_present: false`, **0 of 10 nights mirrored**, with
   `keep_nights: 14`. Pruning begins deleting unmirrored nights in ~4 days. Unrelated to this brief but
   the most time-critical item on the box.

A follow-up brief is owed for items 1 and 2: **`VIGIL-PPG-GRID-AUDIT-FOLLOWUPS-2026-07-25-BRIEF.md`**
(not yet created — items are recorded here so nothing is lost if it is deferred).

---

## 6. Checked and found clean — do NOT re-file

Recorded so a later audit does not spend the effort again. Each was a live hypothesis that did not
survive execution:

- **ECG timing columns.** Four independent `fs` estimates (ms step, ns step, phone wall span, device
  span) agree to **0.005%**; `timestamp [ms] ≡ (ns − first_ns)/1e6` to **0 ns**; both columns monotonic.
- **Verity PPG/ACC grids.** `dev/wall` = 0.99988 and 1.00001. The §1 defect is O2Ring-specific — the
  Polar streams carry a real device clock and never touch the synthesized grid.
- **PpgDex `fs` inference.** Hypothesised corrupted by §1; **refuted** — it uses the *median* ns delta,
  which is the exact grid step. Only the timeline is affected.
- **The new `_HR`/`_RR` split** (landed 2026-07-24). `sum(RR)/wall` = 1.0001, HR↔RR agree to 0.18 bpm,
  no implausible intervals, multi-beat notifications correctly share a stamp.
- **`nightqc` coverage denominators.** Honest — the span is the merged session pooled across midnight,
  not the date folder.
- **`TelemetryBus` snapshot/push interleaving.** Not a race: neither contains an `await`, so in a
  single-threaded event loop there is no yield point between them. The snapshot *is* an exact instant.
- **SSE subscriber leak.** `unsubscribe` is in a `finally` (`webmon.py:210-212`), which runs on
  cancellation, `ConnectionResetError` and normal exit alike.
- **`time.monotonic()` running backwards.** Non-decreasing by contract; `CLOCK_MONOTONIC` pauses across
  suspend rather than rewinding. The claimed consequence also does not follow — a waveform stream with a
  negative age still evaluates its rate and reads `weak`, not `good`.
- **`telemetry.py` as a source of scientific error.** Structurally exempt: it is a live view only, its
  `push()` runs *after* the durable write, and nothing it holds is read by any Dex or reaches any
  `ganglior.node-export`.

---

## 7. What shipped

| file | change |
|---|---|
| `capture-host/capture.py` | §1 session-anchored PPG grid; honest log wording |
| `capture-host/telemetry.py` | §2 shape invariant + `shape_errors()` + `shapeError` on `meta()` |
| `capture-host/host_clock.py` | §3 `_num()` stratum/packet parse + `stratum_unparsed` → holdover |
| `capture-host/link_rssi.py` | §4 RSSI upper bound `+20` → `-1` |
| `capture-host/tests/test_o2ring_ppg_gap.py` | anchored port; **zero-loss invariant**; outcome-based drift test |
| `capture-host/tests/test_telemetry.py` | 5 shape-invariant tests |
| `capture-host/tests/test_host_clock_and_helper_path.py` | 5 fail-open tests |
| `capture-host/tests/test_link_rssi.py` | 3 bound tests + one deliberate assertion change |

**Gate:** capture-host pytest **947 → 961 green**, 0 regressions.

**Mutation-checked.** The headline new test earns its place: against the old algorithm it reports
**+3.05% inflation / 158 phantom gaps → FAIL**; against the new one **+0.026% / 1 gap → PASS**. A first
draft used bounded sinusoidal jitter that peaked at 22.6 ms — below the 40 ms threshold — and therefore
**passed under both**, reproducing this very file's original blind spot. It was replaced with seeded
Gaussian jitter at the documented sd 16.4 ms, and the test now asserts its own jitter model actually
exceeds the threshold before trusting its result.
